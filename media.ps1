# Persistent helper: reads the Windows media session (SMTC) and prints one JSON line per second.
# Commands arrive on stdin, one per line: toggle | play | pause | next | prev | seek <seconds>
# Needs Windows PowerShell 5.1 (powershell.exe), which ships with Windows.
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type -AssemblyName System.Runtime.WindowsRuntime

$asTask = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
  $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'
})[0]
function Await($op, $type) {
  $t = $asTask.MakeGenericMethod($type).Invoke($null, @($op))
  # Never wait forever: one player that never answers must not freeze the whole helper
  if (-not $t.Wait(8000)) { throw 'a Windows media call timed out' }
  $t.Result
}

$null = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media.Control, ContentType = WindowsRuntime]
$null = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties, Windows.Media.Control, ContentType = WindowsRuntime]
$script:lastKey = ''
$script:artTries = 0
$script:artKey = ''

function Emit-None($err) {
  $script:lastKey = ''      # so art is re-sent when the same track comes back
  $script:artTries = 0
  if ($err) {
    $msg = ([string]$err); if ($msg.Length -gt 120) { $msg = $msg.Substring(0, 120) }
    [Console]::Out.WriteLine((@{ none = $true; err = $msg } | ConvertTo-Json -Compress))   # shown in the Music tab
  } else {
    [Console]::Out.WriteLine('{"none":true}')
  }
}

$null = [Windows.Storage.Streams.DataReader, Windows.Storage.Streams, ContentType = WindowsRuntime]
$null = [Windows.Storage.Streams.IInputStream, Windows.Storage.Streams, ContentType = WindowsRuntime]
$script:artLogs = 0

# Failures are written to media.log next to this script (first few only), so a missing cover is diagnosable
function Log-Art($m) {
  if ($script:artLogs -ge 24) { return }
  $script:artLogs++
  try { Add-Content -Path (Join-Path $PSScriptRoot 'media.log') -Value ('{0} art: {1}' -f (Get-Date -Format s), $m) } catch {}
}

$null = [Windows.Foundation.IAsyncInfo, Windows.Foundation, ContentType = WindowsRuntime]

# Opens the thumbnail stream. On some Windows builds PowerShell cannot resolve the stream's interface type by NAME,
# so the result type is read from the method's own return type (IAsyncOperation<T> -> T) and the usual Await is used.
# If that fails, poll the operation through IAsyncInfo ('.Status' is not visible on the bare object in PowerShell 5.1).
function Open-Thumb($thumb) {
  $op = $thumb.OpenReadAsync()
  try {
    $resultType = $thumb.GetType().GetMethod('OpenReadAsync').ReturnType.GetGenericArguments()[0]
    return (Await $op $resultType)
  } catch {
    Log-Art ('typed await failed: ' + $_.Exception.Message)
  }
  # Properties of bare WinRT objects are invisible to PowerShell 5.1, so go through reflection on the interface
  $statusProp = [Windows.Foundation.IAsyncInfo].GetProperty('Status')
  for ($i = 0; $i -lt 200 -and ([string]$statusProp.GetValue($op)) -eq 'Started'; $i++) { Start-Sleep -Milliseconds 20 }
  $final = [string]$statusProp.GetValue($op)
  if ($final -ne 'Completed') { throw ('thumbnail open ended as "' + $final + '"') }
  return $op.GetResults()
}

# Size of a WinRT stream. '.Size' reads as empty on the bare object in PowerShell 5.1, so ask the interface itself.
$null = [Windows.Storage.Streams.IRandomAccessStream, Windows.Storage.Streams, ContentType = WindowsRuntime]
function Get-StreamSize($s) {
  try { return [uint64]([Windows.Storage.Streams.IRandomAccessStream].GetProperty('Size').GetValue($s)) } catch {}
  try { return [uint64]$s.Size } catch { return [uint64]0 }
}

# Image type from the file's own first bytes (the stream's ContentType property has the same visibility problem)
function Get-Mime($b) {
  if ($b.Length -ge 4 -and $b[0] -eq 0x89 -and $b[1] -eq 0x50) { return 'image/png' }
  if ($b.Length -ge 3 -and $b[0] -eq 0xFF -and $b[1] -eq 0xD8) { return 'image/jpeg' }
  if ($b.Length -ge 3 -and $b[0] -eq 0x47 -and $b[1] -eq 0x49) { return 'image/gif' }
  if ($b.Length -ge 12 -and $b[0] -eq 0x52 -and $b[8] -eq 0x57) { return 'image/webp' }
  if ($b.Length -ge 2 -and $b[0] -eq 0x42 -and $b[1] -eq 0x4D) { return 'image/bmp' }
  return $null                                                       # not a format a browser can show: do not send it
}

# Reads a WinRT stream into a byte[]. PowerShell 5.1 will not bind the bare WinRT object to IInputStream parameters
# ("Cannot find an overload", "does not contain a method named ..."), so the PowerShell wrapper is removed and the
# exact methods are called through reflection. Three independent strategies; each failure is logged.
function Read-ViaDataReader($inputStream, $size) {
  $dr = [Windows.Storage.Streams.DataReader]
  $inT = [Windows.Storage.Streams.IInputStream]
  $inputStream = $inputStream.PSObject.BaseObject                    # harmless if it is already unwrapped
  $reader = $dr.GetConstructor([type[]]@($inT)).Invoke(@($inputStream))
  try {
    $loaded = [uint32](Await ($dr.GetMethod('LoadAsync').Invoke($reader, @([uint32]$size))) ([uint32]))
    $bytes = [byte[]]::new($loaded)                                  # a real byte[]; New-Object would hand reflection a PSObject wrapper
    $null = $dr.GetMethod('ReadBytes').Invoke($reader, @(, $bytes))
    return , $bytes
  } finally {
    try { $null = [System.IDisposable].GetMethod('Dispose').Invoke($reader, @()) } catch {}   # $null = : an uncaptured result would leak into the function's output
  }
}

function Read-StreamBytes($stream, $size) {
  $raw = $stream.PSObject.BaseObject
  $inT = [Windows.Storage.Streams.IInputStream]

  # A) .NET interop with the exact IInputStream overload
  try {
    $m = [System.IO.WindowsRuntimeStreamExtensions].GetMethod('AsStreamForRead', [type[]]@($inT))
    $net = $m.Invoke($null, @($raw))
    $ms = New-Object System.IO.MemoryStream
    $copy = $net.CopyToAsync($ms)
    if (-not $copy.Wait(8000)) { throw 'reading the thumbnail timed out' }      # a stalled stream must not freeze the helper
    if ($ms.Length -gt 0) { return , $ms.ToArray() }
    Log-Art 'A (AsStreamForRead) read 0 bytes'
  } catch { Log-Art ('A (AsStreamForRead) failed: ' + $_.Exception.Message) }

  if ($size -le 0) { return $null }

  # B) DataReader straight on the stream
  try {
    $b = Read-ViaDataReader $raw $size
    if ($b.Length -gt 0) { return , $b }
  } catch { Log-Art ('B (DataReader) failed: ' + $_.Exception.Message) }

  # C) DataReader on an input stream taken from the random-access stream
  try {
    $ras = [Windows.Storage.Streams.IRandomAccessStream]
    $in = $ras.GetMethod('GetInputStreamAt').Invoke($raw, @([uint64]0))
    $b = Read-ViaDataReader $in $size
    if ($b.Length -gt 0) { return , $b }
  } catch { Log-Art ('C (GetInputStreamAt) failed: ' + $_.Exception.Message) }

  return $null
}

function Get-Art($props) {
  try {
    if ($null -eq $props.Thumbnail) { Log-Art 'the player gave no thumbnail'; return $null }
    $stream = Open-Thumb $props.Thumbnail
    $size = Get-StreamSize $stream
    if ($size -gt 3MB) { Log-Art "thumbnail too large ($size bytes)"; return $null }
    $bytes = Read-StreamBytes $stream $size
    if ($null -eq $bytes -or $bytes.Length -eq 0) { Log-Art "no bytes read (stream size seen: $size)"; return $null }
    if ($bytes.Length -gt 3MB) { Log-Art "thumbnail too large ($($bytes.Length) bytes)"; return $null }
    $bytes = [byte[]]$bytes                                          # throws (and is logged) if anything other than bytes got in
    $mime = Get-Mime $bytes
    $head = (($bytes[0..([math]::Min(11, $bytes.Length - 1))] | ForEach-Object { '{0:X2}' -f $_ }) -join ' ')
    $tail = (($bytes[([math]::Max(0, $bytes.Length - 2))..($bytes.Length - 1)] | ForEach-Object { '{0:X2}' -f $_ }) -join ' ')
    $note = ''
    if ($mime -eq 'image/jpeg' -and $tail -ne 'FF D9') { $note = ' (JPEG does not end with FF D9: looks truncated)' }
    Log-Art ('read {0} bytes, type {1}, first bytes {2}, last bytes {3}{4}' -f $bytes.Length, $mime, $head, $tail, $note)
    if (-not $mime) { return $null }
    return 'data:' + $mime + ';base64,' + [Convert]::ToBase64String($bytes)
  } catch {
    Log-Art ('Get-Art failed: ' + $_.Exception.Message)
    return $null
  } finally {
    # One handle per attempt would leak otherwise. Reflection on the unwrapped object: the PowerShell cast fails like the other bindings did.
    # ($null = ...: MethodInfo.Invoke returns an object even for void methods, and an uncaptured value becomes part of the
    # function's output. That turned Get-Art's result into @('data:...', $null), which reached the page as "data:...," and could not decode.)
    if ($null -ne $stream) { try { $null = [System.IDisposable].GetMethod('Dispose').Invoke($stream.PSObject.BaseObject, @()) } catch {} }
  }
}

function Emit-State {
  try {
    $s = $mgr.GetCurrentSession()
    if ($null -eq $s) { Emit-None; return }
    $props = Await ($s.TryGetMediaPropertiesAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties])
    $info = $s.GetPlaybackInfo()
    $tl = $s.GetTimelineProperties()
    $status = $info.PlaybackStatus.ToString()
    $pos = $tl.Position.TotalSeconds
    $dur = $tl.EndTime.TotalSeconds - $tl.StartTime.TotalSeconds
    # Only extrapolate for players that report a real timeline
    if ($status -eq 'Playing' -and $dur -gt 0 -and $tl.LastUpdatedTime.Year -gt 2000) {
      $pos += ([DateTimeOffset]::UtcNow - $tl.LastUpdatedTime).TotalSeconds
    }
    if ($dur -gt 0 -and $pos -gt $dur) { $pos = $dur }
    if ($pos -lt 0) { $pos = 0 }
    $key = "$($props.Title)|$($props.Artist)"
    $o = [ordered]@{
      title  = [string]$props.Title
      artist = [string]$props.Artist
      status = $status
      pos    = [math]::Round($pos, 1)
      dur    = [math]::Round($dur, 1)
      app    = [string]$s.SourceAppUserModelId
      key    = $key
    }
    if ($key -ne $script:artKey) { $script:artKey = $key; $script:artTries = 0 }   # tries belong to one track
    if ($key -ne $script:lastKey) {
      # Remember the track only once its art was read, or after a few failed tries (some players have none)
      $art = @(Get-Art $props | Where-Object { $_ -is [string] -and $_ }) | Select-Object -First 1   # exactly one string, whatever else leaked
      if ($art) {
        $o['art'] = [string]$art; $script:lastKey = $key; $script:artTries = 0
        Log-Art ('sending cover as one string, {0} characters, starts {1}, ends {2}' -f $art.Length, $art.Substring(0, [math]::Min(30, $art.Length)), $art.Substring([math]::Max(0, $art.Length - 6)))
      }
      else {
        $script:artTries++
        if ($script:artTries -ge 5) { $script:lastKey = $key; $script:artTries = 0 }
      }
    }
    [Console]::Out.WriteLine(($o | ConvertTo-Json -Compress))
  } catch {
    Emit-None $_.Exception.Message
  }
}

function Run-Command($line) {
  $parts = $line.Trim() -split '\s+', 2
  $s = $mgr.GetCurrentSession()
  if ($null -eq $s) { return }
  try {
    switch ($parts[0]) {
      'toggle' { Await ($s.TryTogglePlayPauseAsync()) ([bool]) | Out-Null }
      'play'   { Await ($s.TryPlayAsync()) ([bool]) | Out-Null }
      'pause'  { Await ($s.TryPauseAsync()) ([bool]) | Out-Null }
      'next'   { Await ($s.TrySkipNextAsync()) ([bool]) | Out-Null }
      'prev'   { Await ($s.TrySkipPreviousAsync()) ([bool]) | Out-Null }
      'seek'   {
        $sec = [double]$parts[1]
        Await ($s.TryChangePlaybackPositionAsync([long]($sec * 10000000))) ([bool]) | Out-Null
      }
    }
  } catch {}
}

try {
  $mgr = Await ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]::RequestAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager])
  if ($null -eq $mgr) { throw 'Windows media session manager unavailable' }
} catch {
  # Report the reason instead of dying silently; the Music tab shows it
  while ($true) { Emit-None ('Init: ' + $_.Exception.Message); Start-Sleep -Seconds 2 }
}

# Console.In is synchronized and its ReadLineAsync blocks; a StreamReader on the raw stream is truly async.
$stdin = New-Object System.IO.StreamReader([Console]::OpenStandardInput())
$reader = $stdin.ReadLineAsync()
$tick = 0
while ($true) {
  if ($reader.IsCompleted) {
    if ($reader.IsFaulted -or $reader.IsCanceled) { break }   # broken pipe: exit instead of repeating the last command
    $line = $reader.Result
    if ($null -eq $line) { break }          # parent closed stdin: exit
    $reader = $stdin.ReadLineAsync()
    Run-Command $line
    Start-Sleep -Milliseconds 150
    Emit-State
  }
  if ($tick % 4 -eq 0) { Emit-State }
  Start-Sleep -Milliseconds 250
  $tick++
}
