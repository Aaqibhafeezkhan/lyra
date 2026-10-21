// lyra-audio: captures the sound of ONE application (and its child processes) and writes it to stdout as raw PCM.
//
//   usage : lyra-audio.exe --pid <process id>        (Windows 10 build 19041 / version 2004 or newer)
//   stdout: 48 kHz, 2 channels, 16-bit signed little-endian samples, no header, written as they arrive
//   stderr: one line "ready" once capture has started, or "error: ..." and exit code 1
//
// This uses the "process loopback" part of WASAPI, so notification sounds and other programs are left out.
// Builds with the csc.exe that ships with Windows (see scripts/build-helper.ps1).
using System;
using System.IO;
using System.Runtime.InteropServices;
using System.Threading;

static class Program
{
    const int AUDCLNT_SHAREMODE_SHARED = 0;
    const int AUDCLNT_STREAMFLAGS_LOOPBACK = 0x00020000;
    const int AUDCLNT_STREAMFLAGS_EVENTCALLBACK = 0x00040000;
    const int AUDCLNT_BUFFERFLAGS_SILENT = 0x2;
    const string VIRTUAL_AUDIO_DEVICE_PROCESS_LOOPBACK = "VAD\\Process_Loopback";

    [StructLayout(LayoutKind.Sequential)]
    struct AUDIOCLIENT_ACTIVATION_PARAMS { public int ActivationType; public int TargetProcessId; public int ProcessLoopbackMode; }

    [StructLayout(LayoutKind.Sequential)]
    struct BLOB { public int cbSize; public IntPtr pBlobData; }

    [StructLayout(LayoutKind.Explicit, Size = 24)]
    struct PROPVARIANT { [FieldOffset(0)] public ushort vt; [FieldOffset(8)] public BLOB blob; }

    [StructLayout(LayoutKind.Sequential, Pack = 2)]
    struct WAVEFORMATEX { public ushort wFormatTag; public ushort nChannels; public uint nSamplesPerSec; public uint nAvgBytesPerSec; public ushort nBlockAlign; public ushort wBitsPerSample; public ushort cbSize; }

    [ComImport, Guid("72A22D78-CDE4-431D-B8CC-843A71199B6D"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IActivateAudioInterfaceAsyncOperation
    {
        [PreserveSig] int GetActivateResult(out int activateResult, [MarshalAs(UnmanagedType.IUnknown)] out object activatedInterface);
    }

    [ComImport, Guid("41D949AB-9862-444A-80F6-C261334DA5EB"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IActivateAudioInterfaceCompletionHandler
    {
        [PreserveSig] int ActivateCompleted(IActivateAudioInterfaceAsyncOperation activateOperation);
    }

    [ComImport, Guid("94ea2b94-e9cc-49e0-c0ff-ee64ca8f5b90"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IAgileObject { }

    [ComImport, Guid("1CB9AD4C-DBFA-4c32-B178-C2F568A703B2"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IAudioClient
    {
        [PreserveSig] int Initialize(int shareMode, int streamFlags, long hnsBufferDuration, long hnsPeriodicity, ref WAVEFORMATEX format, IntPtr audioSessionGuid);
        [PreserveSig] int GetBufferSize(out uint bufferFrames);
        [PreserveSig] int GetStreamLatency(out long latency);
        [PreserveSig] int GetCurrentPadding(out uint padding);
        [PreserveSig] int IsFormatSupported(int shareMode, ref WAVEFORMATEX format, out IntPtr closestMatch);
        [PreserveSig] int GetMixFormat(out IntPtr format);
        [PreserveSig] int GetDevicePeriod(out long defaultPeriod, out long minimumPeriod);
        [PreserveSig] int Start();
        [PreserveSig] int Stop();
        [PreserveSig] int Reset();
        [PreserveSig] int SetEventHandle(IntPtr eventHandle);
        [PreserveSig] int GetService(ref Guid iid, [MarshalAs(UnmanagedType.IUnknown)] out object service);
    }

    [ComImport, Guid("C8ADBD64-E71E-48a0-A4DE-185C395CD317"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IAudioCaptureClient
    {
        [PreserveSig] int GetBuffer(out IntPtr data, out uint frames, out int flags, out long devicePosition, out long qpcPosition);
        [PreserveSig] int ReleaseBuffer(uint frames);
        [PreserveSig] int GetNextPacketSize(out uint frames);
    }

    [DllImport("Mmdevapi.dll", ExactSpelling = true, PreserveSig = false)]
    static extern void ActivateAudioInterfaceAsync([MarshalAs(UnmanagedType.LPWStr)] string deviceInterfacePath, ref Guid riid, IntPtr activationParams, IActivateAudioInterfaceCompletionHandler completionHandler, out IActivateAudioInterfaceAsyncOperation activationOperation);

    [DllImport("kernel32.dll")] static extern IntPtr CreateEvent(IntPtr attributes, bool manualReset, bool initialState, string name);
    [DllImport("kernel32.dll")] static extern int WaitForSingleObject(IntPtr handle, int milliseconds);

    class Handler : IActivateAudioInterfaceCompletionHandler, IAgileObject
    {
        public readonly ManualResetEvent Done = new ManualResetEvent(false);
        public int Result = -1;
        public object Interface;
        public int ActivateCompleted(IActivateAudioInterfaceAsyncOperation op)
        {
            try { op.GetActivateResult(out Result, out Interface); } catch { Result = -2; }
            Done.Set();
            return 0;
        }
    }

    static int Main(string[] args)
    {
        int pid = 0;
        for (int i = 0; i < args.Length - 1; i++) if (args[i] == "--pid") int.TryParse(args[i + 1], out pid);
        if (pid <= 0) { Console.Error.WriteLine("error: --pid is required"); return 1; }
        try { return Run(pid); }
        catch (Exception e) { Console.Error.WriteLine("error: " + e.Message); return 1; }
    }

    static int Run(int pid)
    {
        var p = new AUDIOCLIENT_ACTIVATION_PARAMS { ActivationType = 1 /* PROCESS_LOOPBACK */, TargetProcessId = pid, ProcessLoopbackMode = 0 /* INCLUDE_TARGET_PROCESS_TREE */ };
        IntPtr pParams = Marshal.AllocHGlobal(Marshal.SizeOf(typeof(AUDIOCLIENT_ACTIVATION_PARAMS)));
        Marshal.StructureToPtr(p, pParams, false);
        var pv = new PROPVARIANT { vt = 65 /* VT_BLOB */, blob = new BLOB { cbSize = Marshal.SizeOf(typeof(AUDIOCLIENT_ACTIVATION_PARAMS)), pBlobData = pParams } };
        IntPtr pPv = Marshal.AllocHGlobal(Marshal.SizeOf(typeof(PROPVARIANT)));
        Marshal.StructureToPtr(pv, pPv, false);

        var handler = new Handler();
        Guid iidClient = new Guid("1CB9AD4C-DBFA-4c32-B178-C2F568A703B2");
        IActivateAudioInterfaceAsyncOperation op;
        ActivateAudioInterfaceAsync(VIRTUAL_AUDIO_DEVICE_PROCESS_LOOPBACK, ref iidClient, pPv, handler, out op);
        if (!handler.Done.WaitOne(8000)) { Console.Error.WriteLine("error: activation timed out"); return 1; }
        if (handler.Result != 0 || handler.Interface == null) { Console.Error.WriteLine("error: could not capture that program's sound (0x" + handler.Result.ToString("X") + "). Needs Windows 10 version 2004 or newer."); return 1; }

        var client = (IAudioClient)handler.Interface;
        var fmt = new WAVEFORMATEX { wFormatTag = 1, nChannels = 2, nSamplesPerSec = 48000, wBitsPerSample = 16 };
        fmt.nBlockAlign = (ushort)(fmt.nChannels * fmt.wBitsPerSample / 8);
        fmt.nAvgBytesPerSec = fmt.nSamplesPerSec * fmt.nBlockAlign;
        int hr = client.Initialize(AUDCLNT_SHAREMODE_SHARED, AUDCLNT_STREAMFLAGS_LOOPBACK | AUDCLNT_STREAMFLAGS_EVENTCALLBACK, 200 * 10000, 0, ref fmt, IntPtr.Zero);
        if (hr != 0) { Console.Error.WriteLine("error: audio client init failed (0x" + hr.ToString("X") + ")"); return 1; }
        IntPtr ev = CreateEvent(IntPtr.Zero, false, false, null);
        client.SetEventHandle(ev);
        Guid iidCap = new Guid("C8ADBD64-E71E-48a0-A4DE-185C395CD317");
        object capObj;
        hr = client.GetService(ref iidCap, out capObj);
        if (hr != 0) { Console.Error.WriteLine("error: no capture service (0x" + hr.ToString("X") + ")"); return 1; }
        var cap = (IAudioCaptureClient)capObj;
        hr = client.Start();
        if (hr != 0) { Console.Error.WriteLine("error: start failed (0x" + hr.ToString("X") + ")"); return 1; }
        Console.Error.WriteLine("ready");

        var stdout = Console.OpenStandardOutput();
        byte[] buf = new byte[0];
        long lastData = Environment.TickCount;
        while (true)
        {
            // stop when the app that started us goes away (stdout closed)
            WaitForSingleObject(ev, 100);
            uint packet;
            while (cap.GetNextPacketSize(out packet) == 0 && packet > 0)
            {
                IntPtr data; uint frames; int flags; long dp, qpc;
                if (cap.GetBuffer(out data, out frames, out flags, out dp, out qpc) != 0) break;
                int bytes = (int)frames * fmt.nBlockAlign;
                if (buf.Length < bytes) buf = new byte[bytes];
                if ((flags & AUDCLNT_BUFFERFLAGS_SILENT) != 0) Array.Clear(buf, 0, bytes);
                else Marshal.Copy(data, buf, 0, bytes);
                cap.ReleaseBuffer(frames);
                try { stdout.Write(buf, 0, bytes); stdout.Flush(); }
                catch (IOException) { client.Stop(); return 0; }
            }
        }
    }
}
