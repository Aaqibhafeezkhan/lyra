/**
 * Windows PowerShell 5.1 bridge to System Media Transport Controls (the Windows media overlay API).
 * Runs as one long-lived child process: prints one JSON line per tick on stdout and reads
 * commands (toggle|play|pause|next|prev|seek:<ms>) from stdin. No native modules, no account.
 */
export const SMTC_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$null = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager,Windows.Media.Control,ContentType=WindowsRuntime]
$null = [Windows.Storage.Streams.IInputStream,Windows.Storage.Streams,ContentType=WindowsRuntime]
$null = [Windows.Storage.Streams.IRandomAccessStreamReference,Windows.Storage.Streams,ContentType=WindowsRuntime]
$null = [Windows.Storage.Streams.IRandomAccessStreamWithContentType,Windows.Storage.Streams,ContentType=WindowsRuntime]
$null = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties,Windows.Media.Control,ContentType=WindowsRuntime]

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
