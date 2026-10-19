// lyra-media: tiny helper that bridges Windows media controls (SMTC) to Lyra over stdin/stdout.
//
//   stdout: one JSON object per line (state changes + a slow heartbeat)
//   stdin : toggle | play | pause | next | prev | seek:<ms> | volume:<0-100>
//   args  : --app <substring>   only follow sessions whose app id contains this (default: any player)
//           --volume            also read/control the Windows master volume
//
// Event driven: no polling loop, so it sits at ~0% CPU while idle. Builds with the csc.exe that ships
// with Windows (see scripts/build-helper.ps1) — no SDK install needed.
using System;
using System.Collections.Generic;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using System.Runtime.InteropServices.WindowsRuntime;
using Windows.Foundation;
using Windows.Media.Control;
using Windows.Storage.Streams;

static class Program
{
    static string appFilter = "";
    static bool volumeEnabled;
    static GlobalSystemMediaTransportControlsSessionManager manager;
    static GlobalSystemMediaTransportControlsSession session;
    static readonly TypedEventHandler<GlobalSystemMediaTransportControlsSession, MediaPropertiesChangedEventArgs> onMedia = (x, e) => Schedule();
    static readonly TypedEventHandler<GlobalSystemMediaTransportControlsSession, PlaybackInfoChangedEventArgs> onPlayback = (x, e) => { Reconsider(); Schedule(); };
    static readonly TypedEventHandler<GlobalSystemMediaTransportControlsSession, TimelinePropertiesChangedEventArgs> onTimeline = (x, e) => Schedule();
    static readonly object gate = new object();
    static Timer debounce;
    static Timer heartbeat;
    static string thumbKey = "";
    static string thumbData;
    static string thumbSentKey = "";
    static int thumbTries;
    static readonly TextWriter stdout = new StreamWriter(Console.OpenStandardOutput(), new UTF8Encoding(false)) { AutoFlush = true };

    static void Main(string[] args)
    {
        for (int i = 0; i < args.Length; i++)
        {
            if (args[i] == "--app" && i + 1 < args.Length) appFilter = args[++i];
            else if (args[i] == "--volume") volumeEnabled = true;
        }

        manager = GlobalSystemMediaTransportControlsSessionManager.RequestAsync().AsTask().Result;
        manager.SessionsChanged += (m, e) => Rebind();
        manager.CurrentSessionChanged += (m, e) => Rebind();
        debounce = new Timer(_ => Emit(), null, Timeout.Infinite, Timeout.Infinite);
        // slow heartbeat: keeps position/volume honest without a busy loop
        heartbeat = new Timer(_ => { Reconsider(); Emit(); }, null, 5000, 5000);

        Rebind();
        WriteLine("{\"ready\":true}");

        var reader = new Thread(ReadCommands) { IsBackground = true };
        reader.Start();
        reader.Join(); // exits when stdin closes (parent gone)
    }

    static void Schedule() { debounce.Change(120, Timeout.Infinite); }


    static HashSet<string> prevPlaying = new HashSet<string>();

    static bool IsSpotify(GlobalSystemMediaTransportControlsSession s)
    {
        return s.SourceAppUserModelId.IndexOf("Spotify", StringComparison.OrdinalIgnoreCase) >= 0;
    }

    static bool IsPlaying(GlobalSystemMediaTransportControlsSession s)
    {
        try { return s.GetPlaybackInfo().PlaybackStatus == GlobalSystemMediaTransportControlsSessionPlaybackStatus.Playing; }
        catch { return false; }
    }

    // Which player to follow: one that is playing right now (Spotify first if several are), otherwise the system's
    // current session, otherwise the first one. With --app only matching players are considered.
    static GlobalSystemMediaTransportControlsSession Find()
    {
        var all = new List<GlobalSystemMediaTransportControlsSession>();
        foreach (var s in manager.GetSessions())
            if (appFilter.Length == 0 || s.SourceAppUserModelId.IndexOf(appFilter, StringComparison.OrdinalIgnoreCase) >= 0) all.Add(s);
        if (all.Count == 0) return null;
        // several players at once: a player that just started playing wins; otherwise keep the one we already follow
        var nowPlaying = new HashSet<string>();
        GlobalSystemMediaTransportControlsSession started = null, firstPlaying = null;
        foreach (var s in all)
            if (IsPlaying(s))
            {
                string id = s.SourceAppUserModelId;
                nowPlaying.Add(id);
                if (firstPlaying == null || (IsSpotify(s) && !IsSpotify(firstPlaying))) firstPlaying = s;
                if (!prevPlaying.Contains(id)) started = s;
            }
        prevPlaying = nowPlaying;
        if (started != null) return started;
        GlobalSystemMediaTransportControlsSession followed;
        lock (gate) followed = session;
        if (followed != null && nowPlaying.Contains(followed.SourceAppUserModelId))
            foreach (var s in all) if (s.SourceAppUserModelId == followed.SourceAppUserModelId) return s;
        if (firstPlaying != null) return firstPlaying;
        var cur = manager.GetCurrentSession();
        if (cur != null)
            foreach (var s in all) if (s.SourceAppUserModelId == cur.SourceAppUserModelId) return s;
        foreach (var s in all) if (IsSpotify(s)) return s;
        return all[0];
    }

    // a different player started playing (or the followed one closed): switch to it
    static void Reconsider()
    {
        GlobalSystemMediaTransportControlsSession best = Find(), cur;
        lock (gate) cur = session;
        string a = best == null ? null : best.SourceAppUserModelId, b = cur == null ? null : cur.SourceAppUserModelId;
        if (a != b) Rebind(best);
    }

    static void Rebind(GlobalSystemMediaTransportControlsSession target = null)
    {
        lock (gate)
        {
            if (session != null)
            {
                try
                {
                    session.MediaPropertiesChanged -= onMedia;
                    session.PlaybackInfoChanged -= onPlayback;
                    session.TimelinePropertiesChanged -= onTimeline;
                }
                catch { }
            }
            session = target ?? Find();
            if (session != null)
            {
                session.MediaPropertiesChanged += onMedia;
                session.PlaybackInfoChanged += onPlayback;
                session.TimelinePropertiesChanged += onTimeline;
            }
            thumbKey = ""; thumbData = null; thumbTries = 0;
        }
        Schedule();
    }

    static void Emit()
    {
        try
        {
            GlobalSystemMediaTransportControlsSession s;
            lock (gate) s = session;
            if (s == null) { WriteLine("{\"found\":false}"); return; }

            var props = s.TryGetMediaPropertiesAsync().AsTask().Result;
            var tl = s.GetTimelineProperties();
            var pb = s.GetPlaybackInfo();
            string key = props.Title + "|" + props.Artist + "|" + props.AlbumTitle;
            if (key != thumbKey) { thumbKey = key; thumbData = null; thumbTries = 0; thumbSentKey = ""; }
            if (thumbData == null && thumbTries < 20 && props.Thumbnail != null)
            {
                thumbTries++;
                thumbData = ReadThumb(props.Thumbnail);
                // artwork often arrives a moment after the title: try again shortly
                if (thumbData == null) debounce.Change(700, Timeout.Infinite);
            }

            bool playing = pb.PlaybackStatus == GlobalSystemMediaTransportControlsSessionPlaybackStatus.Playing;
            double dur = (tl.EndTime - tl.StartTime).TotalMilliseconds;
            double pos = tl.Position.TotalMilliseconds;
            double age = (DateTimeOffset.UtcNow - tl.LastUpdatedTime).TotalMilliseconds;
            if (playing && age > 0 && age < 3600000) pos += age;
            if (dur > 0 && pos > dur) pos = dur;

            var sb = new StringBuilder("{\"found\":true");
            sb.Append(",\"app\":").Append(Q(s.SourceAppUserModelId));
            sb.Append(",\"title\":").Append(Q(props.Title));
            sb.Append(",\"artist\":").Append(Q(props.Artist));
            sb.Append(",\"album\":").Append(Q(props.AlbumTitle));
            sb.Append(",\"durationMs\":").Append((long)dur);
            sb.Append(",\"positionMs\":").Append((long)pos);
            sb.Append(",\"playing\":").Append(playing ? "true" : "false");
            if (volumeEnabled)
            {
                float v = SysVol.Get();
                if (v >= 0) sb.Append(",\"volume\":").Append((int)Math.Round(v * 100));
            }
            if (thumbData != null && thumbSentKey != key) { sb.Append(",\"thumb\":").Append(Q(thumbData)); thumbSentKey = key; }
            sb.Append('}');
            WriteLine(sb.ToString());
        }
        catch (Exception ex)
        {
            WriteLine("{\"error\":" + Q(ex.Message) + "}");
        }
    }

    static string ReadThumb(IRandomAccessStreamReference reference)
    {
        try
        {
            using (var stream = reference.OpenReadAsync().AsTask().Result)
            {
                var net = System.IO.WindowsRuntimeStreamExtensions.AsStreamForRead(stream);
                using (var ms = new MemoryStream())
                {
                    net.CopyTo(ms);
                    if (ms.Length == 0) return null;
                    byte[] bytes = ms.ToArray();
                    string mime = bytes.Length > 3 && bytes[0] == 0x89 ? "image/png" : "image/jpeg";
                    return "data:" + mime + ";base64," + Convert.ToBase64String(bytes);
                }
            }
        }
        catch { return null; }
    }

    static void ReadCommands()
    {
        string line;
        while ((line = Console.In.ReadLine()) != null)
        {
            try { Handle(line.Trim()); } catch (Exception ex) { WriteLine("{\"error\":" + Q(ex.Message) + "}"); }
        }
    }

    static void Handle(string cmd)
    {
        GlobalSystemMediaTransportControlsSession s;
        lock (gate) s = session;
        if (cmd.StartsWith("volume:"))
        {
            int pct;
            if (volumeEnabled && int.TryParse(cmd.Substring(7), out pct)) { SysVol.Set(pct / 100f); Schedule(); }
            return;
        }
        if (s == null) return;
        if (cmd == "toggle") s.TryTogglePlayPauseAsync().AsTask().Wait(3000);
        else if (cmd == "play") s.TryPlayAsync().AsTask().Wait(3000);
        else if (cmd == "pause") s.TryPauseAsync().AsTask().Wait(3000);
        else if (cmd == "next") s.TrySkipNextAsync().AsTask().Wait(3000);
        else if (cmd == "prev") s.TrySkipPreviousAsync().AsTask().Wait(3000);
        else if (cmd.StartsWith("seek:"))
        {
            long ms;
            if (long.TryParse(cmd.Substring(5), out ms)) s.TryChangePlaybackPositionAsync(ms * 10000).AsTask().Wait(3000);
        }
        Schedule();
    }

    static void WriteLine(string s) { lock (stdout) stdout.WriteLine(s); }

    static string Q(string s)
    {
        if (s == null) return "\"\"";
        var sb = new StringBuilder("\"");
        foreach (char c in s)
        {
            switch (c)
            {
                case '"': sb.Append("\\\""); break;
                case '\\': sb.Append("\\\\"); break;
                case '\n': sb.Append("\\n"); break;
                case '\r': sb.Append("\\r"); break;
                case '\t': sb.Append("\\t"); break;
                default:
                    if (c < 0x20) sb.Append("\\u").Append(((int)c).ToString("x4"));
                    else sb.Append(c);
                    break;
            }
        }
        return sb.Append('"').ToString();
    }
}

/// <summary>Windows master volume via Core Audio (same thing the taskbar volume slider changes).</summary>
static class SysVol
{
    [ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")] class MMDeviceEnumeratorCom { }

    [ComImport, Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IMMDeviceEnumerator
    {
        int EnumAudioEndpoints(int dataFlow, int mask, out IntPtr devices);
        int GetDefaultAudioEndpoint(int dataFlow, int role, out IMMDevice device);
    }
    [ComImport, Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IMMDevice
    {
        int Activate(ref Guid iid, int ctx, IntPtr p, [MarshalAs(UnmanagedType.IUnknown)] out object o);
    }
    [ComImport, Guid("5CDF2C82-841E-4546-9722-0CF74078229A"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IAudioEndpointVolume
    {
        int RegisterControlChangeNotify(IntPtr n);
        int UnregisterControlChangeNotify(IntPtr n);
        int GetChannelCount(out uint c);
        int SetMasterVolumeLevel(float db, ref Guid ctx);
        int SetMasterVolumeLevelScalar(float level, ref Guid ctx);
        int GetMasterVolumeLevel(out float db);
        int GetMasterVolumeLevelScalar(out float level);
    }

    static IAudioEndpointVolume Endpoint()
    {
        var en = (IMMDeviceEnumerator)(new MMDeviceEnumeratorCom());
        IMMDevice dev; en.GetDefaultAudioEndpoint(0, 1, out dev);
        Guid iid = typeof(IAudioEndpointVolume).GUID; object o;
        dev.Activate(ref iid, 23, IntPtr.Zero, out o);
        return (IAudioEndpointVolume)o;
    }

    public static float Get()
    {
        try { float v; Endpoint().GetMasterVolumeLevelScalar(out v); return v; } catch { return -1f; }
    }

    public static bool Set(float level)
    {
        try { Guid ctx = Guid.Empty; Endpoint().SetMasterVolumeLevelScalar(Math.Max(0f, Math.Min(1f, level)), ref ctx); return true; } catch { return false; }
    }
}
