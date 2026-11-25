# Per-app volume mixer helper. Started by DyIsland when the mixer is opened, ends when DyIsland closes its stdin (or after it goes quiet).
#   in:   LIST                       one answer line
#         SET <pid> <0-100> <0|1|->  set the volume (and mute: 1 mute, 0 unmute, - leave) of every audio session of that process' program
#   out:  MIX <base64 json>          [{ pid, name, volume, mute }] one per program that has an audio session on the default speakers
#         OK | ERR                   answer to SET
# It uses the same Windows core audio sessions the volume mixer in Settings shows. It starts, kills and types nothing and never touches the network.
param([int]$OwnPid = 0)
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
[Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDevice { int Activate(ref Guid iid, int ctx, IntPtr p, [MarshalAs(UnmanagedType.IUnknown)] out object o); }
[Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDeviceEnumerator { int EnumAudioEndpoints(int f, int s, out IntPtr d); int GetDefaultAudioEndpoint(int flow, int role, out IMMDevice d); }
[ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")] class MMDeviceEnumeratorCom { }
[Guid("77AA99A0-1BD6-484F-8BC7-2C654C9A9B6F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IAudioSessionManager2 {
  int GetAudioSessionControl(IntPtr g, int f, out IntPtr c); int GetSimpleAudioVolume(IntPtr g, int f, out IntPtr v);
  int GetSessionEnumerator(out IAudioSessionEnumerator e);
}
[Guid("E2F5BB11-0570-40CA-ACDD-3AA01277DEE8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IAudioSessionEnumerator { int GetCount(out int n); int GetSession(int i, out IAudioSessionControl2 s); }
[Guid("BFB7FF88-7239-4FC9-8FA2-07C950BE9C6D"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IAudioSessionControl2 {
  int GetState(out int s); int GetDisplayName([MarshalAs(UnmanagedType.LPWStr)] out string n); int SetDisplayName([MarshalAs(UnmanagedType.LPWStr)] string n, ref Guid g);
  int GetIconPath([MarshalAs(UnmanagedType.LPWStr)] out string p); int SetIconPath([MarshalAs(UnmanagedType.LPWStr)] string p, ref Guid g);
  int GetGroupingParam(out Guid g); int SetGroupingParam(ref Guid o, ref Guid g);
  int RegisterAudioSessionNotification(IntPtr n); int UnregisterAudioSessionNotification(IntPtr n);
  int GetSessionIdentifier([MarshalAs(UnmanagedType.LPWStr)] out string s); int GetSessionInstanceIdentifier([MarshalAs(UnmanagedType.LPWStr)] out string s);
  int GetProcessId(out uint pid); int IsSystemSoundsSession(); int SetDuckingPreference([MarshalAs(UnmanagedType.Bool)] bool d);
}
[Guid("87CE5498-68D6-44E5-9215-6DA47EF883D8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface ISimpleAudioVolume {
  int SetMasterVolume(float l, ref Guid g); int GetMasterVolume(out float l);
  int SetMute([MarshalAs(UnmanagedType.Bool)] bool m, ref Guid g); int GetMute([MarshalAs(UnmanagedType.Bool)] out bool m);
}
public class MixSession { public uint Pid; public float Vol; public bool Mute; public object Ctl; }
public static class DyMix {
  static Guid none = Guid.Empty;
  static IAudioSessionManager2 Manager() {
    var en = (IMMDeviceEnumerator)new MMDeviceEnumeratorCom(); IMMDevice dev; en.GetDefaultAudioEndpoint(0, 1, out dev);
    var iid = typeof(IAudioSessionManager2).GUID; object o; dev.Activate(ref iid, 23, IntPtr.Zero, out o); return (IAudioSessionManager2)o;
  }
  public static List<MixSession> Sessions() {
    var res = new List<MixSession>(); IAudioSessionEnumerator e; Manager().GetSessionEnumerator(out e); int n; e.GetCount(out n);
    for (int i = 0; i < n; i++) {
      IAudioSessionControl2 c; e.GetSession(i, out c); uint pid; c.GetProcessId(out pid);
      var v = (ISimpleAudioVolume)c; float l; bool m; v.GetMasterVolume(out l); v.GetMute(out m);
      res.Add(new MixSession { Pid = pid, Vol = l, Mute = m, Ctl = c });
    }
    return res;
  }
  public static void Set(object ctl, float vol, int mute) {
    var v = (ISimpleAudioVolume)ctl;
    if (vol >= 0) v.SetMasterVolume(Math.Max(0f, Math.Min(1f, vol)), ref none);
    if (mute >= 0) v.SetMute(mute == 1, ref none);
  }
}
'@

function Get-ProcName([uint32]$id) {
  if ($id -eq 0) { return 'System sounds' }
  try { return [System.Diagnostics.Process]::GetProcessById($id).ProcessName } catch { return $null }
}

$stdin = New-Object System.IO.StreamReader([Console]::OpenStandardInput())
while ($true) {
  $line = $stdin.ReadLine()
  if ($null -eq $line) { break }
  try {
    if ($line -eq 'LIST') {
      $by = [ordered]@{}
      foreach ($s in [DyMix]::Sessions()) {
        $name = Get-ProcName $s.Pid
        if ($null -eq $name) { continue }
        if (-not $by.Contains($name)) { $by[$name] = @{ pid = [int]$s.Pid; name = $name; volume = [int][Math]::Round($s.Vol * 100); mute = [bool]$s.Mute } }
        elseif (-not $s.Mute) { $by[$name].mute = $false }
      }
      $json = ConvertTo-Json -Compress -InputObject @($by.Values)
      [Console]::Out.WriteLine('MIX ' + [Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes($json)))
    }
    elseif ($line -match '^SET (\d{1,10}) (\d{1,3}|-) ([01-])$') {
      $pid0 = [uint32]$Matches[1]; $vol = if ($Matches[2] -eq "-") { -1.0 } else { [Math]::Min(100, [int]$Matches[2]) / 100.0 }; $mute = if ($Matches[3] -eq '-') { -1 } else { [int]$Matches[3] }
      $target = Get-ProcName $pid0
      $done = $false
      foreach ($s in [DyMix]::Sessions()) {
        if ($s.Pid -eq $pid0 -or ($null -ne $target -and (Get-ProcName $s.Pid) -eq $target)) { [DyMix]::Set($s.Ctl, [single]$vol, $mute); $done = $true }
      }
      [Console]::Out.WriteLine($(if ($done) { 'OK' } else { 'ERR' }))
    }
  } catch { [Console]::Out.WriteLine('ERR') }
  [Console]::Out.Flush()
}
