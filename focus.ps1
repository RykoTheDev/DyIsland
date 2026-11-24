# Persistent helper: brings the window Claude Code is running in to the front (terminal, VS Code, the Claude desktop app, ...).
# Protocol (one line each way, on stdin / stdout):
#   in:   ANCHOR <requestId> <pid> <project name>       (resolve and remember which window a session runs in: sent while the hook process is still alive)
#   in:   FOCUS <requestId> <pid> <project name>        (pid = the window's process from ANCHOR, or any process of the session; the project name is only a fallback)
#   out:  <requestId> ANCHOR OK <windowPid> <topPid>   |   <requestId> ANCHOR NONE <topPid>
#   out:  <requestId> OK <how>        the window is in front
#         <requestId> FLASH <how>     Windows refused to bring it forward (it blinks in the taskbar instead)
#         <requestId> FAIL <reason>
# How the window is found: walk UP from the session's process (Claude Code -> shell -> terminal / app) and take the first process
# that owns a visible window; failing that, a terminal/editor/Claude window whose title mentions the project. Desktop shell
# processes (explorer ...) are never treated as the answer. It only ever focuses a window: it starts, kills and types nothing.
# Ends when DyIsland does (stdin closes).
param([int]$OwnPid = 0)
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
public static class DyFocus {
  public delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc p, IntPtr l);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] static extern int GetWindowLong(IntPtr h, int n);
  [DllImport("user32.dll")] static extern int GetWindowTextLength(IntPtr h);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr h, int cmd);
  [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] static extern bool BringWindowToTop(IntPtr h);
  [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr extra);
  public class Win { public IntPtr H; public uint Pid; public string Title; }
  public static List<Win> Windows() {
    var list = new List<Win>();
    EnumWindows((h, l) => {
      if (!IsWindowVisible(h)) return true;
      if ((GetWindowLong(h, -20) & 0x80) != 0) return true;                    // WS_EX_TOOLWINDOW: palettes, tray popups
      int n = GetWindowTextLength(h); if (n <= 0) return true;
      var sb = new StringBuilder(n + 1); GetWindowText(h, sb, n + 1);
      uint pid; GetWindowThreadProcessId(h, out pid);
      list.Add(new Win { H = h, Pid = pid, Title = sb.ToString() });
      return true;
    }, IntPtr.Zero);
    return list;
  }
  public static bool Focus(IntPtr h) {
    if (IsIconic(h)) ShowWindow(h, 9);                                         // SW_RESTORE
    keybd_event(0x12, 0, 0, UIntPtr.Zero); keybd_event(0x12, 0, 2, UIntPtr.Zero);   // a bare Alt press lets SetForegroundWindow through
    SetForegroundWindow(h); BringWindowToTop(h);
    return GetForegroundWindow() == h;
  }
}
'@

$skipNames = @('explorer', 'services', 'svchost', 'wininit', 'winlogon', 'csrss', 'system', 'idle', 'sihost', 'dwm', 'fontdrvhost', 'lsass', 'smss')
$hostNames = @('windowsterminal', 'wt', 'code', 'cursor', 'windsurf', 'claude', 'wezterm-gui', 'alacritty', 'mintty', 'conhost', 'openconsole', 'powershell', 'pwsh', 'cmd', 'idea64', 'pycharm64', 'webstorm64', 'rider64', 'devenv', 'zed')

function Find-Target([int]$startPid, [string]$project) {
  $procs = @{}
  foreach ($p in Get-CimInstance Win32_Process) { $procs[[int]$p.ProcessId] = $p }
  $wins = [DyFocus]::Windows() | Where-Object { $_.Pid -ne $OwnPid -and $_.Title -ne 'Program Manager' }
  # 1. climb from the session's process: the first ancestor that owns a visible window is where it runs
  $chain = New-Object System.Collections.Generic.List[int]
  $cur = $startPid; $guard = 0; $top = 0
  while ($cur -gt 4 -and $procs.ContainsKey($cur) -and $guard -lt 40) {
    $name = ([string]$procs[$cur].Name -replace '\.exe$', '').ToLower()
    if ($skipNames -contains $name) { break }
    $chain.Add($cur); $top = $cur; $cur = [int]$procs[$cur].ParentProcessId; $guard++
  }
  # console hosts (conhost / OpenConsole) are children of the shell, not parents, and own the classic console window
  $hosts = @()
  foreach ($p in $procs.Values) { if ($chain.Contains([int]$p.ParentProcessId) -and ([string]$p.Name) -match '^(conhost|OpenConsole)\.exe$') { $hosts += [int]$p.ProcessId } }
  foreach ($id in (@($chain) + $hosts)) {
    $w = $wins | Where-Object { $_.Pid -eq $id } | Select-Object -First 1
    if ($w) { return @{ Win = $w; How = 'process'; Top = $top } }
  }
  # 2. a terminal / editor / Claude window whose title mentions the project
  if ($project) {
    foreach ($w in $wins) {
      $n = if ($procs.ContainsKey([int]$w.Pid)) { ([string]$procs[[int]$w.Pid].Name -replace '\.exe$', '').ToLower() } else { '' }
      if (($hostNames -contains $n) -and $w.Title.ToLower().Contains($project.ToLower())) { return @{ Win = $w; How = 'title'; Top = $top } }
    }
  }
  return @{ Win = $null; How = 'none'; Top = $top }
}

while ($true) {
  $line = [Console]::In.ReadLine()
  if ($null -eq $line) { exit }                                              # DyIsland is gone
  $reply = '0 FAIL bad-request'
  try {
    if ($line -match '^FOCUS (\d{1,9}) (\d{1,9}) ?(.{0,60})$') {
      $rid = $Matches[1]; $pidArg = [int]$Matches[2]; $proj = ($Matches[3] -replace '[^\w .\-]', '').Trim()
      $t = Find-Target $pidArg $proj
      if (-not $t.Win) { $reply = "$rid FAIL no-window" }
      elseif ([DyFocus]::Focus($t.Win.H)) { $reply = "$rid OK $($t.How)" }
      else { $reply = "$rid FLASH $($t.How)" }
    }
    elseif ($line -match '^ANCHOR (\d{1,9}) (\d{1,9}) ?(.{0,60})$') {
      $rid = $Matches[1]; $pidArg = [int]$Matches[2]; $proj = ($Matches[3] -replace '[^\w .\-]', '').Trim()
      $t = Find-Target $pidArg $proj
      if ($t.Win) { $reply = "$rid ANCHOR OK $($t.Win.Pid) $($t.Top)" } else { $reply = "$rid ANCHOR NONE $($t.Top)" }
    }
  } catch { $reply = ($(if ($Matches -and $Matches[1]) { $Matches[1] } else { '0' }) + ' FAIL error') }
  [Console]::Out.WriteLine($reply); [Console]::Out.Flush()
}
