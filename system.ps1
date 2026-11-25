# ONE persistent helper for the small system watchers (instead of a PowerShell process each). Ends when DyIsland does (stdin closes).
#   out:  VOLINIT <0-100> <0|1>      the master volume and mute state when the helper starts (never shown to the user)
#         VOL <0-100> <0|1>          the master volume or mute changed
#         BT <connected|gone> <name> a Bluetooth device connected / went away (only with -Bluetooth)
#         NOTIF <base64 json>        a new Windows notification appeared: { app, title, body } (only with -Notifications, which is opt-in in Settings)
#   in:   VOLSET <0-100>             set the master volume
#         VOLMUTE <0|1>              mute / unmute
#         FGRESTORE                  give the keyboard focus back to the window that had it before DyIsland took it (see below)
#         PASTE 1|0                  send Ctrl+V to the window that has the keyboard (1: DyIsland had the focus, give it back first). Never pastes into DyIsland itself.
# The helper notes, every round, the last window with the keyboard focus that is NOT one of DyIsland's own (OwnPid). FGRESTORE gives the focus back to it,
# but only if DyIsland still has the focus: if you already went somewhere else, nothing is pulled back. Nothing here ever blocks: the slow Windows
# calls (Bluetooth, notifications) are started and collected on later rounds, so FGRESTORE is answered within about 50 ms.
# It reads and sets the system volume (Windows core audio, the same thing the volume keys change) and the foreground window. It starts, kills
# and types nothing (except the one Ctrl+V of PASTE, which is opt-in), and never touches the network.
param([int]$OwnPid = 0, [switch]$Bluetooth, [switch]$Notifications)
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
[Guid("5CDF2C82-841E-4546-9722-0CF74078229A"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IAudioEndpointVolume {
  int RegisterControlChangeNotify(IntPtr p); int UnregisterControlChangeNotify(IntPtr p); int GetChannelCount(out uint n);
  int SetMasterVolumeLevel(float f, ref Guid g); int SetMasterVolumeLevelScalar(float f, ref Guid g);
  int GetMasterVolumeLevel(out float f); int GetMasterVolumeLevelScalar(out float f);
  int SetChannelVolumeLevel(uint c, float f, ref Guid g); int SetChannelVolumeLevelScalar(uint c, float f, ref Guid g);
  int GetChannelVolumeLevel(uint c, out float f); int GetChannelVolumeLevelScalar(uint c, out float f);
  int SetMute([MarshalAs(UnmanagedType.Bool)] bool m, ref Guid g); int GetMute([MarshalAs(UnmanagedType.Bool)] out bool m);
}
[Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDevice { int Activate(ref Guid iid, int ctx, IntPtr p, [MarshalAs(UnmanagedType.IUnknown)] out object o); }
[Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDeviceEnumerator { int EnumAudioEndpoints(int f, int s, out IntPtr d); int GetDefaultAudioEndpoint(int flow, int role, out IMMDevice d); }
[ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")] class MMDeviceEnumeratorCom { }
public static class DySys {
  static IAudioEndpointVolume ep; static Guid none = Guid.Empty;
  static bool Open() {
    try {
      var en = (IMMDeviceEnumerator)new MMDeviceEnumeratorCom(); IMMDevice dev; en.GetDefaultAudioEndpoint(0, 1, out dev);
      var iid = typeof(IAudioEndpointVolume).GUID; object o; dev.Activate(ref iid, 23, IntPtr.Zero, out o); ep = (IAudioEndpointVolume)o; return true;
    } catch { ep = null; return false; }
  }
  public static bool Read(out int pct, out bool mute) {
    pct = 0; mute = false;
    if (ep == null && !Open()) return false;
    try { float f; ep.GetMasterVolumeLevelScalar(out f); ep.GetMute(out mute); pct = (int)Math.Round(f * 100); return true; } catch { ep = null; return false; }
  }
  public static void SetVolume(int pct) { if (ep == null && !Open()) return; try { ep.SetMasterVolumeLevelScalar(Math.Max(0, Math.Min(100, pct)) / 100f, ref none); } catch { ep = null; } }
  public static void SetMute(bool m) { if (ep == null && !Open()) return; try { ep.SetMute(m, ref none); } catch { ep = null; } }
  public static void Reopen() { ep = null; }

  [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] static extern bool IsWindow(IntPtr h);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr h, int c);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr extra);
  static IntPtr saved = IntPtr.Zero;
  // Called every round: remembers the window that has the focus unless it is one of DyIsland's
  public static void Track(uint ownPid) {
    IntPtr h = GetForegroundWindow(); if (h == IntPtr.Zero) return;
    uint pid; GetWindowThreadProcessId(h, out pid); if (pid == ownPid) return;
    saved = h;
  }
  public static void CtrlV(uint ownPid) {
    IntPtr fg = GetForegroundWindow(); uint fp = 0; if (fg != IntPtr.Zero) GetWindowThreadProcessId(fg, out fp);
    if (fp == ownPid) return;                                                                       // the focus is on one of DyIsland's own windows: a paste there would land in the wrong place
    keybd_event(0x11, 0, 0, UIntPtr.Zero); keybd_event(0x56, 0, 0, UIntPtr.Zero); keybd_event(0x56, 0, 2, UIntPtr.Zero); keybd_event(0x11, 0, 2, UIntPtr.Zero);
  }
  public static bool RestoreForeground(uint ownPid) {
    IntPtr h = saved;
    if (h == IntPtr.Zero || !IsWindow(h) || !IsWindowVisible(h)) return false;
    IntPtr fg = GetForegroundWindow(); uint fpid = 0; if (fg != IntPtr.Zero) GetWindowThreadProcessId(fg, out fpid);
    if (fg != IntPtr.Zero && fpid != ownPid) return false;                                        // you already went somewhere else: do not pull the focus back
    if (IsIconic(h)) ShowWindow(h, 9);
    keybd_event(0x12, 0, 0, UIntPtr.Zero); keybd_event(0x12, 0, 2, UIntPtr.Zero);                 // a bare Alt press lets SetForegroundWindow through
    return SetForegroundWindow(h);
  }
}
'@

# stdin is read on a background task so the loop below can keep watching
$stdin = New-Object System.IO.StreamReader([Console]::OpenStandardInput())
$reader = $stdin.ReadLineAsync()
$lastPct = -1; $lastMute = $false; $first = $true; $tick = 0
$asTask = $null
if ($Bluetooth -or $Notifications) {
  try {
    Add-Type -AssemblyName System.Runtime.WindowsRuntime
    $asTask = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' })[0]
  } catch { $Bluetooth = $false; $Notifications = $false }
}

# ---- Bluetooth (polled, because Windows PowerShell 5.1 cannot subscribe to WinRT events). Started on one round, collected on a later one: never waits.
$btSeen = $null; $btTask = $null; $btStarted = [DateTime]::MinValue
if ($Bluetooth) { try { $null = [Windows.Devices.Enumeration.DeviceInformation, Windows.Devices.Enumeration, ContentType = WindowsRuntime] } catch { $Bluetooth = $false } }
function Start-BtQuery {
  $aqs = 'System.Devices.Aep.ProtocolId:="{e0cbf06c-cd8b-4647-bb8a-263b43f0f974}" AND System.Devices.Aep.IsConnected:=System.StructuredQueryType.Boolean#True'
  $op = [Windows.Devices.Enumeration.DeviceInformation]::FindAllAsync($aqs)
  $script:btTask = $asTask.MakeGenericMethod([Windows.Devices.Enumeration.DeviceInformationCollection]).Invoke($null, @($op))
  $script:btStarted = [DateTime]::UtcNow
}
function Finish-BtQuery {
  $t = $script:btTask
  if ($null -eq $t) { return }
  if (-not $t.IsCompleted) { if (([DateTime]::UtcNow - $script:btStarted).TotalSeconds -gt 20) { $script:btTask = $null }; return }
  $script:btTask = $null
  if ($t.IsFaulted -or $t.IsCanceled) { return }
  $now = @(); foreach ($d in $t.Result) { $now += [string]$d.Name }
  if ($null -ne $script:btSeen) {
    foreach ($n in $now) { if ($script:btSeen -notcontains $n -and $n) { [Console]::Out.WriteLine("BT connected $n"); [Console]::Out.Flush() } }
    foreach ($n in $script:btSeen) { if ($now -notcontains $n -and $n) { [Console]::Out.WriteLine("BT gone $n"); [Console]::Out.Flush() } }
  }
  $script:btSeen = $now
}

# ---- Windows notifications (opt-in). Reads what the notification listener shows (the same list as the Action Center); nothing is stored or logged.
$nSeen = $null; $nTask = $null; $nStarted = [DateTime]::MinValue
if ($Notifications) {
  try {
    $null = [Windows.UI.Notifications.Management.UserNotificationListener, Windows.UI.Notifications, ContentType = WindowsRuntime]
    $null = [Windows.UI.Notifications.UserNotification, Windows.UI.Notifications, ContentType = WindowsRuntime]
    $null = [Windows.UI.Notifications.NotificationKinds, Windows.UI.Notifications, ContentType = WindowsRuntime]
    $null = [Windows.UI.Notifications.KnownNotificationBindings, Windows.UI.Notifications, ContentType = WindowsRuntime]
    $nListener = [Windows.UI.Notifications.Management.UserNotificationListener]::Current
    if ([string]$nListener.GetAccessStatus() -ne 'Allowed') { $Notifications = $false }
  } catch { $Notifications = $false }
}
function Start-NotifQuery {
  $op = $nListener.GetNotificationsAsync([Windows.UI.Notifications.NotificationKinds]::Toast)
  $rt = [System.Collections.Generic.IReadOnlyList[Windows.UI.Notifications.UserNotification]]
  $script:nTask = $asTask.MakeGenericMethod($rt).Invoke($null, @($op))
  $script:nStarted = [DateTime]::UtcNow
}
function Finish-NotifQuery {
  $t = $script:nTask
  if ($null -eq $t) { return }
  if (-not $t.IsCompleted) { if (([DateTime]::UtcNow - $script:nStarted).TotalSeconds -gt 20) { $script:nTask = $null }; return }
  $script:nTask = $null
  if ($t.IsFaulted -or $t.IsCanceled) { return }
  $now = New-Object 'System.Collections.Generic.HashSet[uint32]'
  $fresh = @()
  foreach ($n in $t.Result) {
    $id = [uint32]$n.Id; [void]$now.Add($id)
    if ($null -ne $script:nSeen -and -not $script:nSeen.Contains($id)) { $fresh += $n }
  }
  $script:nSeen = $now                                                   # (the first round only learns what is already there: it is not news)
  foreach ($n in $fresh) {
    $app = ''; try { $app = [string]$n.AppInfo.DisplayInfo.DisplayName } catch {}
    $texts = @(); try { $b = $n.Notification.Visual.GetBinding([Windows.UI.Notifications.KnownNotificationBindings]::ToastGeneric); foreach ($e in $b.GetTextElements()) { $texts += [string]$e.Text } } catch {}
    $o = @{ app = $app; title = $(if ($texts.Count) { $texts[0] } else { '' }); body = $(if ($texts.Count -gt 1) { ($texts[1..($texts.Count - 1)] -join ' ') } else { '' }) }
    $json = $o | ConvertTo-Json -Compress
    [Console]::Out.WriteLine('NOTIF ' + [Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes($json))); [Console]::Out.Flush()
  }
}

while ($true) {
  if ($reader.IsCompleted) {
    if ($reader.IsFaulted -or $reader.IsCanceled) { break }
    $line = $reader.Result
    if ($null -eq $line) { break }                                      # DyIsland is gone
    $reader = $stdin.ReadLineAsync()
    try {
      if ($line -match '^VOLSET (\d{1,3})$') { [DySys]::SetVolume([int]$Matches[1]) }
      elseif ($line -match '^VOLMUTE ([01])$') { [DySys]::SetMute($Matches[1] -eq '1') }
      elseif ($line -match '^PASTE ([01])$') { if ($Matches[1] -eq '1') { $null = [DySys]::RestoreForeground([uint32]$OwnPid); Start-Sleep -Milliseconds 120 }; [DySys]::CtrlV([uint32]$OwnPid) }
      elseif ($line -eq 'FGRESTORE') { $null = [DySys]::RestoreForeground([uint32]$OwnPid) }
    } catch {}
  }
  [DySys]::Track([uint32]$OwnPid)                                       # every round: which window had the keyboard before DyIsland
  if ($tick % 3 -eq 0) {                                                # the volume is read every third round (about 150 ms)
    $pct = 0; $mute = $false
    if ([DySys]::Read([ref]$pct, [ref]$mute)) {
      if ($first) { [Console]::Out.WriteLine("VOLINIT $pct $([int]$mute)"); [Console]::Out.Flush(); $first = $false; $lastPct = $pct; $lastMute = $mute }
      elseif ($pct -ne $lastPct -or $mute -ne $lastMute) { $lastPct = $pct; $lastMute = $mute; [Console]::Out.WriteLine("VOL $pct $([int]$mute)"); [Console]::Out.Flush() }
    }
  }
  if ($tick % 120 -eq 0) { [DySys]::Reopen() }                          # the default output device can change (headphones plugged in): look it up again now and then
  try {
    if ($Bluetooth) { Finish-BtQuery; if ($tick % 300 -eq 30 -and $null -eq $btTask) { Start-BtQuery } }          # every ~15 s
    if ($Notifications) { Finish-NotifQuery; if ($tick % 30 -eq 5 -and $null -eq $nTask) { Start-NotifQuery } }     # every ~1.5 s
  } catch {}
  Start-Sleep -Milliseconds 50                                          # short, so a command (FGRESTORE) is answered at once
  $tick++
}
