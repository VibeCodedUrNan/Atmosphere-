# Reports what Windows says is playing (any app that shows in the volume flyout: Spotify,
# browsers, Apple Music, VLC...) as one JSON line per second on stdout, and accepts
# "toggle" / "next" / "prev" lines on stdin. Started and stopped by main.js.
$ErrorActionPreference = 'Stop'
# Without a console window, output defaults to the old ANSI code page: accents get garbled and symbols
# like ♫ become control characters that break the JSON. main.js reads UTF-8.
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$asTask = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
  $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' } | Select-Object -First 1
function Await($op, [Type]$type) {
  $task = $asTask.MakeGenericMethod($type).Invoke($null, @($op))
  $task.Wait() | Out-Null
  $task.Result
}
$null = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media.Control, ContentType = WindowsRuntime]
$null = [Windows.Storage.Streams.IRandomAccessStreamWithContentType, Windows.Storage.Streams, ContentType = WindowsRuntime]
$mgr = Await ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]::RequestAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager])
# Called through reflection: PowerShell can't bind the WinRT stream it gets back to this method's parameter type.
$asStreamForRead = [System.IO.WindowsRuntimeStreamExtensions].GetMethod('AsStreamForRead', [type[]]@([Windows.Storage.Streams.IInputStream]))

function Read-Thumbnail($ref) {
  if (-not $ref) { return '' }
  try {
    $stream = Await ($ref.OpenReadAsync()) ([Windows.Storage.Streams.IRandomAccessStreamWithContentType])
    $ms = New-Object System.IO.MemoryStream
    $asStreamForRead.Invoke($null, @($stream)).CopyTo($ms)
    $bytes = $ms.ToArray()
    if ($bytes.Length -lt 4) { return '' }
    $type = if ($bytes[0] -eq 0x89) { 'image/png' } elseif ($bytes[0] -eq 0xFF) { 'image/jpeg' } else { 'image/bmp' }
    "data:$type;base64," + [Convert]::ToBase64String($bytes)
  } catch { '' }
}

# Windows' "current" session is the most recently used app, which may be paused while another
# app plays. Prefer one that is actually playing.
$playingStatus = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionPlaybackStatus]::Playing
function Get-ActiveSession {
  $current = $mgr.GetCurrentSession()
  if ($current -and $current.GetPlaybackInfo().PlaybackStatus -eq $playingStatus) { return $current }
  foreach ($s in $mgr.GetSessions()) { if ($s.GetPlaybackInfo().PlaybackStatus -eq $playingStatus) { return $s } }
  $current
}

# [Console]::In.ReadLineAsync() blocks on Windows PowerShell; a StreamReader over the raw stream doesn't.
$stdin = New-Object System.IO.StreamReader([Console]::OpenStandardInput())
$pending = $stdin.ReadLineAsync()
$lastKey = $null; $lastArt = ''; $artTries = 0
while ($true) {
  $session = Get-ActiveSession

  if ($pending.IsCompleted) {
    $cmd = $pending.Result
    if ($null -eq $cmd) { exit }   # main.js closed stdin: the app has quit
    if ($session) {
      try {
        switch ($cmd.Trim()) {
          'toggle' { $null = Await ($session.TryTogglePlayPauseAsync()) ([bool]) }
          'next'   { $null = Await ($session.TrySkipNextAsync()) ([bool]) }
          'prev'   { $null = Await ($session.TrySkipPreviousAsync()) ([bool]) }
        }
      } catch {}
      Start-Sleep -Milliseconds 300   # give the player a moment so the report below shows the new state
    }
    $pending = $stdin.ReadLineAsync()
  }

  $out = @{ active = $false }
  if ($session) {
    try {
      $props = Await ($session.TryGetMediaPropertiesAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties])
      $info = $session.GetPlaybackInfo()
      $time = $session.GetTimelineProperties()
      $out = @{
        active   = $true
        app      = $session.SourceAppUserModelId
        title    = $props.Title
        artist   = if ($props.Artist) { $props.Artist } else { $props.AlbumArtist }
        playing  = $info.PlaybackStatus -eq [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionPlaybackStatus]::Playing
        position = $time.Position.TotalMilliseconds
        duration = ($time.EndTime - $time.StartTime).TotalMilliseconds
        updated  = $time.LastUpdatedTime.ToUnixTimeMilliseconds()   # position was true at this moment
      }
      $key = "$($out.app)|$($out.title)|$($out.artist)"
      # Players often publish the new title before its artwork (or briefly keep the old artwork),
      # so keep re-reading the thumbnail for a few seconds after a track change and send it when it changes.
      if ($key -ne $lastKey) { $lastKey = $key; $lastArt = ''; $artTries = 8 }
      if ($artTries -gt 0) {
        $artTries--
        $art = Read-Thumbnail $props.Thumbnail
        if ($art -and $art -ne $lastArt) { $out.art = $art; $lastArt = $art }
      }
    } catch { $out = @{ active = $false } }
  }
  if (-not $out.active) { $lastKey = $null }
  [Console]::Out.WriteLine(($out | ConvertTo-Json -Compress))
  [Console]::Out.Flush()
  try { $null = $pending.Wait(1000) } catch {}   # wakes early when a control command arrives
}
