# Persistent helper: prints "1" when a full-screen app/game is in front on the PRIMARY monitor and "0" when it is not.
# It prints on every change, and repeats the current state about every 10 seconds as a heartbeat: DyIsland treats 30 seconds of
# silence as a hung helper and shows the island again. Fail-open by design: if this script cannot compile or dies, the island stays visible.
# Two checks, the same idea Chromium uses:
#   1) SHQueryUserNotificationState: 3 = exclusive Direct3D full screen, 4 = presentation mode.
#      (State 2, "busy", is deliberately NOT used: it is system-wide and can be held on by windows you cannot see.)
#   2) the foreground window covers its whole monitor and has neither a title bar (WS_CAPTION) nor a sizing frame (WS_THICKFRAME).
#      A normal window, even a maximised one, has at least one of them, so it never counts. This is what catches borderless-windowed
#      games and F11 full-screen video.
# Only the primary monitor counts, because that is where the island lives. The script also exits when DyIsland does.
param([int]$OwnPid = 0)
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Text;
public static class DyFs {
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L, T, R, B; }
  [StructLayout(LayoutKind.Sequential)] public struct MONITORINFO { public int cbSize; public RECT rcMonitor; public RECT rcWork; public int dwFlags; }
  [DllImport("shell32.dll")] static extern int SHQueryUserNotificationState(out int s);
  [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] static extern IntPtr MonitorFromWindow(IntPtr h, uint f);
  [DllImport("user32.dll")] static extern bool GetMonitorInfo(IntPtr m, ref MONITORINFO i);
  [DllImport("user32.dll")] static extern int GetWindowLong(IntPtr h, int n);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetClassName(IntPtr h, StringBuilder sb, int max);
  public static int Check(int ownPid) {
    IntPtr w = GetForegroundWindow();
    var mi = new MONITORINFO(); mi.cbSize = Marshal.SizeOf(typeof(MONITORINFO));
    bool haveMonitor = false;
    if (w != IntPtr.Zero) {
      IntPtr m = MonitorFromWindow(w, 2);                                      // MONITOR_DEFAULTTONEAREST
      if (GetMonitorInfo(m, ref mi)) {
        haveMonitor = true;
        if ((mi.dwFlags & 1) == 0) return 0;                                   // not the primary monitor: the island is not under it
      }
    }
    int s;
    if (SHQueryUserNotificationState(out s) == 0 && (s == 3 || s == 4)) return 1;
    if (w == IntPtr.Zero || !haveMonitor || !IsWindowVisible(w) || IsIconic(w)) return 0;
    uint pid; GetWindowThreadProcessId(w, out pid);
    if (ownPid != 0 && pid == (uint)ownPid) return 0;                          // never our own windows
    var cls = new StringBuilder(64); GetClassName(w, cls, 64);
    string c = cls.ToString();
    if (c == "Progman" || c == "WorkerW" || c == "Shell_TrayWnd") return 0;    // the desktop and the taskbar
    RECT r; if (!GetWindowRect(w, out r)) return 0;
    bool covers = r.L <= mi.rcMonitor.L && r.T <= mi.rcMonitor.T && r.R >= mi.rcMonitor.R && r.B >= mi.rcMonitor.B;
    bool framed = (GetWindowLong(w, -16) & 0x00C40000) != 0;                   // WS_CAPTION | WS_THICKFRAME
    return (covers && !framed) ? 1 : 0;
  }
}
'@

$reported = -1      # what the island was last told
$candidate = -1     # what the last reading said
$streak = 0
$tick = 0
while ($true) {
  if ($OwnPid -ne 0 -and -not (Get-Process -Id $OwnPid -ErrorAction SilentlyContinue)) { exit }   # DyIsland is gone: do not linger
  try { $now = [DyFs]::Check($OwnPid) } catch { $now = 0 }
  # A change only counts after two identical readings in a row (1.5 s apart), so alt-tabbing cannot flicker the island
  if ($now -eq $candidate) { $streak++ } else { $candidate = $now; $streak = 1 }
  if ($streak -ge 2 -and $candidate -ne $reported) { [Console]::Out.WriteLine($candidate); $reported = $candidate }
  elseif ($reported -ge 0 -and ($tick % 7) -eq 0) { [Console]::Out.WriteLine($reported) }            # heartbeat, about every 10 s
  $tick++
  Start-Sleep -Milliseconds 1500
}
