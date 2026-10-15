/**
 * Windows PowerShell 5.1 bridge to System Media Transport Controls (the Windows media overlay API).
 * Runs as one long-lived child process: prints one JSON line per tick on stdout and reads
 * commands (toggle|play|pause|next|prev|seek:<ms>) from stdin. No native modules, no account.
 */
const VOLUME_BLOCK = String.raw`
# System master volume (what the Windows volume flyout controls) via Core Audio COM interop.
$hasVol = $true
try {
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;

public static class SysVol {
  [ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")] class MMDeviceEnumeratorCom { }

  [ComImport, Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IMMDeviceEnumerator {
    int EnumAudioEndpoints(int dataFlow, int mask, out IntPtr devices);
    int GetDefaultAudioEndpoint(int dataFlow, int role, out IMMDevice device);
  }
  [ComImport, Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IMMDevice {
    int Activate(ref Guid iid, int ctx, IntPtr p, [MarshalAs(UnmanagedType.IUnknown)] out object o);
  }
  [ComImport, Guid("5CDF2C82-841E-4546-9722-0CF74078229A"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IAudioEndpointVolume {
    int RegisterControlChangeNotify(IntPtr n);
    int UnregisterControlChangeNotify(IntPtr n);
    int GetChannelCount(out uint c);
    int SetMasterVolumeLevel(float db, ref Guid ctx);
    int SetMasterVolumeLevelScalar(float level, ref Guid ctx);
    int GetMasterVolumeLevel(out float db);
    int GetMasterVolumeLevelScalar(out float level);
  }

  static IAudioEndpointVolume Endpoint() {
    var en = (IMMDeviceEnumerator)(new MMDeviceEnumeratorCom());
    IMMDevice dev; en.GetDefaultAudioEndpoint(0, 1, out dev);
    Guid iid = typeof(IAudioEndpointVolume).GUID; object o;
    dev.Activate(ref iid, 23, IntPtr.Zero, out o);
    return (IAudioEndpointVolume)o;
  }

  /// <summary>0..1, or -1 when unavailable.</summary>
  public static float Get() {
    try { float v; Endpoint().GetMasterVolumeLevelScalar(out v); return v; } catch { return -1f; }
  }

  public static bool Set(float level) {
    try { Guid ctx = Guid.Empty; Endpoint().SetMasterVolumeLevelScalar(Math.Max(0f, Math.Min(1f, level)), ref ctx); return true; } catch { return false; }
  }
}
'@
} catch {
  $hasVol = $false
  [Console]::Error.WriteLine('volume support disabled: ' + $_.Exception.Message)
}
`

/**
 * `withVolume` adds a runtime-compiled Core Audio helper. Some antivirus engines flag that pattern, so it is opt-in.
 */
export function smtcScript(withVolume: boolean): string {
  const volumeBlock = withVolume ? VOLUME_BLOCK : '$hasVol = $false'
  return String.raw`
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$null = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager,Windows.Media.Control,ContentType=WindowsRuntime]
$null = [Windows.Storage.Streams.IInputStream,Windows.Storage.Streams,ContentType=WindowsRuntime]
$null = [Windows.Storage.Streams.IRandomAccessStreamReference,Windows.Storage.Streams,ContentType=WindowsRuntime]
$null = [Windows.Storage.Streams.IRandomAccessStreamWithContentType,Windows.Storage.Streams,ContentType=WindowsRuntime]
$null = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties,Windows.Media.Control,ContentType=WindowsRuntime]

${volumeBlock}

$opName = 'IAsyncOperation' + [char]96 + '1'
$asTask = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
  $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq $opName
})[0]

function Await($op, [Type]$type) {
  $task = $asTask.MakeGenericMethod($type).Invoke($null, @($op))
  [void]$task.Wait(5000)
  if ($task.IsCompleted) { return $task.Result }
  return $null
}

function Emit($obj) {
  [Console]::Out.WriteLine(($obj | ConvertTo-Json -Compress -Depth 4))
  [Console]::Out.Flush()
}

$mgrType = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]
$propType = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties]
$streamType = [Windows.Storage.Streams.IRandomAccessStreamWithContentType]
$mgr = Await ($mgrType::RequestAsync()) $mgrType

function Get-Session {
  foreach ($s in $mgr.GetSessions()) {
    if ($s.SourceAppUserModelId -match 'Spotify') { return $s }
  }
  return $null
}

# stdin is read on a background runspace (Console.In.ReadLineAsync completes synchronously and would block)
$queue = New-Object 'System.Collections.Concurrent.ConcurrentQueue[string]'
$rs = [runspacefactory]::CreateRunspace()
$rs.Open()
$rs.SessionStateProxy.SetVariable('queue', $queue)
$reader = [powershell]::Create()
$reader.Runspace = $rs
[void]$reader.AddScript({
  while ($true) {
    $l = [Console]::In.ReadLine()
    if ($null -eq $l) { $queue.Enqueue('__eof'); break }
    $queue.Enqueue($l)
  }
})
[void]$reader.BeginInvoke()
$lastKey = ''
$thumb = $null
$thumbTries = 0
$thumbSentKey = ''

Emit @{ ready = $true }

while ($true) {
  try {
    $s = Get-Session

    $line = $null
    while ($queue.TryDequeue([ref]$line)) {
      if ($line -eq '__eof') { exit }
      if ($s) {
        switch -regex ($line) {
          '^toggle$' { [void](Await $s.TryTogglePlayPauseAsync() ([bool])) }
          '^play$'   { [void](Await $s.TryPlayAsync() ([bool])) }
          '^pause$'  { [void](Await $s.TryPauseAsync() ([bool])) }
          '^next$'   { [void](Await $s.TrySkipNextAsync() ([bool])) }
          '^prev$'   { [void](Await $s.TrySkipPreviousAsync() ([bool])) }
          '^volume:(\d+)$' { if ($hasVol) { [void][SysVol]::Set([float]([int]$Matches[1] / 100)) } }
          '^seek:(\d+)$' { [void](Await $s.TryChangePlaybackPositionAsync([int64]([int64]$Matches[1] * 10000)) ([bool])) }
        }
      }
    }

    if (-not $s) {
      Emit @{ found = $false }
    } else {
      $p = Await $s.TryGetMediaPropertiesAsync() $propType
      $tl = $s.GetTimelineProperties()
      $pb = $s.GetPlaybackInfo()
      $key = "$($p.Title)|$($p.Artist)|$($p.AlbumTitle)"
      if ($key -ne $lastKey) { $lastKey = $key; $thumb = $null; $thumbTries = 0 }

      if (-not $thumb -and $thumbTries -lt 20 -and $p.Thumbnail) {
        $thumbTries++
        try {
          $st = Await ($p.Thumbnail.OpenReadAsync()) $streamType
          if ($st) {
            # reflection: PowerShell can't bind the COM object to IInputStream directly
            $ns = [System.IO.WindowsRuntimeStreamExtensions].GetMethod('AsStreamForRead', [Type[]]@([Windows.Storage.Streams.IInputStream])).Invoke($null, @(,$st))
            $ms = New-Object System.IO.MemoryStream
            $ns.CopyTo($ms)
            $ns.Dispose()
            if ($ms.Length -gt 0) {
              $bytes = $ms.ToArray()
              $mime = 'image/jpeg'
              if ($bytes[0] -eq 0x89) { $mime = 'image/png' }
              $thumb = 'data:' + $mime + ';base64,' + [Convert]::ToBase64String($bytes)
            }
          }
        } catch { [Console]::Error.WriteLine('thumbnail: ' + $_.Exception.Message) }
      }

      $playing = ([int]$pb.PlaybackStatus -eq 4)
      $dur = ($tl.EndTime - $tl.StartTime).TotalMilliseconds
      $age = ([DateTimeOffset]::UtcNow - $tl.LastUpdatedTime).TotalMilliseconds
      $pos = $tl.Position.TotalMilliseconds
      if ($playing -and $age -gt 0 -and $age -lt 3600000) { $pos += $age }
      if ($dur -gt 0 -and $pos -gt $dur) { $pos = $dur }

      $out = @{
        found = $true
        app = $s.SourceAppUserModelId
        title = [string]$p.Title
        artist = [string]$p.Artist
        album = [string]$p.AlbumTitle
        durationMs = [int64]$dur
        positionMs = [int64]$pos
        playing = $playing
      }
      $vol = -1
      if ($hasVol) { try { $vol = [SysVol]::Get() } catch { $vol = -1 } }
      if ($vol -ge 0) { $out.volume = [int][Math]::Round($vol * 100) }
      if ($thumb -and $thumbSentKey -ne $key) { $out.thumb = $thumb; $thumbSentKey = $key }
      Emit $out
    }
  } catch {
    Emit @{ error = $_.Exception.Message }
    Start-Sleep -Milliseconds 2000
  }
  Start-Sleep -Milliseconds 500
}
`
}
