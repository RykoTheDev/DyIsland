#requires -Version 5.1
# DyIsland DNS switch: ONE-TIME setup. Run it as administrator (DyIsland > Settings > NextDNS switch > "Set up" does this and Windows
# shows its usual approval prompt). It does NOT change your DNS. It:
#   1. finds the connections that are using NextDNS right now (by NextDNS's addresses, 45.90.28.x / 45.90.30.x / 2a07:a8c0-1::),
#      and records their DNS servers and their encrypted-DNS (DNS over HTTPS) template exactly as Windows has them,
#   2. copies dns-toggle.ps1 into C:\ProgramData\DyIsland\dns, a folder only administrators can modify,
#   3. creates two scheduled tasks, "DyIsland DNS On" and "DyIsland DNS Off", that run that script as SYSTEM and that only
#      YOUR Windows user may start.
# Remove everything again with dns-remove.ps1 (or DyIsland > Settings > NextDNS switch > "Remove").
$ErrorActionPreference = 'Stop'

$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) { Write-Host 'Please run this as administrator.' -ForegroundColor Red; Read-Host 'Press Enter to close'; exit 1 }

function Stop-Here([string]$msg) { Write-Host ''; Write-Host $msg -ForegroundColor Yellow; Write-Host ''; Read-Host 'Press Enter to close'; exit 1 }

# ---- safe folders. Ordinary users may create folders inside C:\ProgramData, so a folder we are about to rely on could have been
# planted (or turned into a junction) beforehand. We therefore (a) create ours WITH its final permissions in one step, and (b) refuse
# to use any existing one unless it is owned by SYSTEM / Administrators, is not a link, and nobody else can write to it.
$SidSystem = 'S-1-5-18'
$SidAdmins = 'S-1-5-32-544'
$SidUsers = 'S-1-5-32-545'
$SidInstaller = 'S-1-5-80-956008885-3418522649-1831038044-1853292631-2271478464'
$trusted = @($SidSystem, $SidAdmins, $SidInstaller)
function Test-SafeDir([string]$p) {
  $item = Get-Item -LiteralPath $p -Force -ErrorAction Stop
  if (-not $item.PSIsContainer) { return $false }
  if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) { return $false }                       # a junction / symlink
  $acl = Get-Acl -LiteralPath $p
  if ($trusted -notcontains $acl.GetOwner([Security.Principal.SecurityIdentifier]).Value) { return $false }
  $write = [Security.AccessControl.FileSystemRights]'WriteData,AppendData,WriteExtendedAttributes,WriteAttributes,Delete,DeleteSubdirectoriesAndFiles,ChangePermissions,TakeOwnership'
  foreach ($r in $acl.GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier])) {
    if ($r.AccessControlType -ne 'Allow') { continue }
    if (($r.FileSystemRights -band $write) -eq 0) { continue }
    if ($trusted -contains $r.IdentityReference.Value) { continue }
    if ($r.IdentityReference.Value -eq 'S-1-3-0' -and ($r.PropagationFlags -band [Security.AccessControl.PropagationFlags]::InheritOnly)) { continue }   # CREATOR OWNER on future children only
    return $false
  }
  return $true
}
function New-SecureDir([string]$p) {
  if (Test-Path -LiteralPath $p) {
    if (Test-SafeDir $p) { return }
    throw "$p already exists and is not safe to use (it is not owned and locked down by SYSTEM / Administrators, or it is a link). Delete it from an administrator prompt, then run setup again."
  }
  $sec = New-Object Security.AccessControl.DirectorySecurity
  $sec.SetAccessRuleProtection($true, $false)                                                              # no inherited permissions
  foreach ($pair in @(@($SidSystem, 'FullControl'), @($SidAdmins, 'FullControl'), @($SidUsers, 'ReadAndExecute'))) {
    $sid = New-Object Security.Principal.SecurityIdentifier($pair[0])
    $sec.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule($sid, $pair[1], 'ContainerInherit,ObjectInherit', 'None', 'Allow')))
  }
  [void][IO.Directory]::CreateDirectory($p, $sec)                                                          # created with its permissions: no gap
  if (-not (Test-SafeDir $p)) { throw "$p was not created safely (someone else created it first). Delete it from an administrator prompt, then run setup again." }
}
function Get-StaticDns([string]$guid, [bool]$v6) {
  # the servers set BY HAND on this connection (not the ones learned from DHCP / the router): that is what the switch toggles
  $key = 'HKLM:\SYSTEM\CurrentControlSet\Services\' + $(if ($v6) { 'Tcpip6' } else { 'Tcpip' }) + '\Parameters\Interfaces\' + $guid
  try { $v = (Get-ItemProperty -LiteralPath $key -Name NameServer -ErrorAction Stop).NameServer } catch { return @() }
  return @(([string]$v) -split '[,\s;]+' | Where-Object { $_ -and ($_ -notmatch '%') })
}

try {
  Write-Host 'DyIsland DNS switch: setup' -ForegroundColor Cyan
  Write-Host ''

  # 0. where is this script running from? An administrator-run script that ordinary programs could have edited deserves a warning.
  $srcSafe = $false; try { $srcSafe = Test-SafeDir $PSScriptRoot } catch { }
  foreach ($f in 'dns-setup.ps1', 'dns-toggle.ps1') {
    $h = (Get-FileHash -Algorithm SHA256 -LiteralPath (Join-Path $PSScriptRoot $f)).Hash
    Write-Host ('  {0}  SHA-256 {1}' -f $f, $h.Substring(0, 16))
  }
  Write-Host ('  running from: ' + $PSScriptRoot)
  if (-not $srcSafe) {
    Write-Host ''
    Write-Host 'This copy of DyIsland sits in a folder that ordinary programs can modify. The steps below run with administrator rights from it, so only continue if you are sure nothing has tampered with these files (for the safest result, install DyIsland somewhere only administrators can write, like C:\Program Files).' -ForegroundColor Yellow
    $t = Read-Host 'Type TRUST to continue'
    if ($t -cne 'TRUST') { Write-Host 'Nothing was changed.'; exit 0 }
  }
  Write-Host ''

  # 1. which connections use NextDNS? NextDNS's own address ranges identify it; the DoH template Windows keeps per connection is saved too
  $next4 = '^45\.90\.(28|30)\.\d{1,3}$'
  $next6 = '^2a07:a8c[01]:'
  $tplRe = '^https://(?:[A-Za-z0-9-]+\.)*nextdns\.io(?::\d{1,5})?/[A-Za-z0-9._~/-]{0,128}$'
  $adapters = @(); $seen = @(); $skipped = @()
  foreach ($nic in @(Get-NetAdapter | Where-Object { $_.Status -eq 'Up' })) {
    $v4 = Get-StaticDns $nic.InterfaceGuid $false
    $v6 = Get-StaticDns $nic.InterfaceGuid $true
    $all = @($v4) + @($v6)
    $seen += ('  - {0}: {1}' -f $nic.Name, $(if ($all.Count) { $all -join ', ' } else { 'automatic' }))
    $uses = @($v4 | Where-Object { $_ -match $next4 }) + @($v6 | Where-Object { $_ -match $next6 })
    if ($uses.Count -eq 0) { continue }
    if (-not $nic.HardwareInterface) { $skipped += ('  - {0}: a virtual / VPN connection (left alone)' -f $nic.Name); continue }
    $dhcp = $false; try { $dhcp = ((Get-NetIPInterface -InterfaceIndex $nic.ifIndex -AddressFamily IPv4).Dhcp -eq 'Enabled') } catch { }
    if (-not $dhcp) { $skipped += ('  - {0}: uses a fixed IP address, so "Off" would leave it with no DNS at all (left alone)' -f $nic.Name); continue }
    foreach ($x in $v4) { if ($x -notmatch '^(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)$') { throw ('unexpected DNS address on ' + $nic.Name) } }
    foreach ($x in $v6) { $pp = $null; if (-not [System.Net.IPAddress]::TryParse($x, [ref]$pp) -or $pp.AddressFamily -ne [System.Net.Sockets.AddressFamily]::InterNetworkV6) { throw ('unexpected DNS address on ' + $nic.Name) } }

    $doh = @()
    $base = 'HKLM:\SYSTEM\CurrentControlSet\Services\Dnscache\InterfaceSpecificParameters\' + $nic.InterfaceGuid + '\DohInterfaceSettings\Doh'
    if (Test-Path -LiteralPath $base) {
      foreach ($k in @(Get-ChildItem -LiteralPath $base)) {
        $p = Get-ItemProperty -LiteralPath $k.PSPath
        if ($p.DohTemplate -and ([string]$p.DohTemplate) -match $tplRe -and (($v4 + $v6) -contains $k.PSChildName)) {
          $kind = 'QWord'; try { $kind = [string]$k.GetValueKind('DohFlags') } catch { }
          if (@('QWord', 'DWord') -notcontains $kind) { $kind = 'QWord' }
          $doh += [pscustomobject]@{ ip = $k.PSChildName; flags = [string]$p.DohFlags; kind = $kind; template = [string]$p.DohTemplate }
        }
      }
    }
    $adapters += [pscustomobject]@{ alias = $nic.Name; guid = $nic.InterfaceGuid; v4 = @($v4); v6 = @($v6); doh = @($doh) }
  }
  if ($adapters.Count -eq 0) {
    Write-Host 'Your connected network adapters and the DNS servers set on them by hand right now:' -ForegroundColor Yellow
    $seen | ForEach-Object { Write-Host $_ }
    $skipped | ForEach-Object { Write-Host $_ }
    Stop-Here 'None of the physical, automatic-IP connections is using a NextDNS address (45.90.28.x, 45.90.30.x or 2a07:a8c0/1::). Turn NextDNS on for your connection first (it must be ON while you run this, so the switch knows what to restore), then run this again.'
  }

  Write-Host 'These connections use NextDNS and will be switched by the tile:' -ForegroundColor Green
  foreach ($a in $adapters) {
    Write-Host ('  - {0}: {1}' -f $a.alias, ((@($a.v4) + @($a.v6)) -join ', '))
    foreach ($d in @($a.doh)) { Write-Host ('      encrypted DNS for {0}: {1}' -f $d.ip, ($d.template -replace '/[^/]{4,}$', '/<your-id>')) }
    if (@($a.doh).Count -eq 0) { Write-Host '      (no encrypted-DNS template found for this connection: the DNS servers will be restored, the encrypted template will not)' -ForegroundColor Yellow }
  }
  $skipped | ForEach-Object { Write-Host $_ -ForegroundColor DarkYellow }
  Write-Host ''
  Write-Host '"Off" returns them to automatic DNS (your ISP / router). "On" restores exactly the servers and encrypted-DNS settings above.'
  Write-Host 'Connections you add or plug in later are not covered: run setup again after adding one.'
  $go = Read-Host 'Install? (y/n)'
  if ($go -notmatch '^[yY]') { Write-Host 'Nothing was changed.'; exit 0 }

  # 2. the script + config, in folders only administrators can write to (verified, not assumed)
  $root = Join-Path $env:ProgramData 'DyIsland'
  $dir = Join-Path $root 'dns'
  New-SecureDir $root
  New-SecureDir $dir
  $script = Join-Path $dir 'dns-toggle.ps1'
  Copy-Item -Force -LiteralPath (Join-Path $PSScriptRoot 'dns-toggle.ps1') -Destination $script
  $json = [pscustomobject]@{ version = 3; adapters = $adapters } | ConvertTo-Json -Depth 6
  [IO.File]::WriteAllText((Join-Path $dir 'config.json'), $json, (New-Object System.Text.UTF8Encoding($false)))   # UTF-8 WITHOUT a byte-order mark

  # 3. two tasks, run as SYSTEM, startable only by you
  $sids = @([Security.Principal.WindowsIdentity]::GetCurrent().User.Value)                                  # the person who approved this prompt
  try {
    $cu = (Get-CimInstance Win32_ComputerSystem).UserName                                                   # the person signed in at the screen (if different)
    if ($cu) { $s2 = (New-Object System.Security.Principal.NTAccount($cu)).Translate([System.Security.Principal.SecurityIdentifier]).Value; if ($sids -notcontains $s2) { $sids += $s2 } }
  } catch { }
  $sddl = 'D:(A;;FA;;;BA)(A;;FA;;;SY)' + (($sids | ForEach-Object { "(A;;GRGX;;;$_)" }) -join '')
  $psExe = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'                       # full path: never a lookalike found through PATH
  $svc = New-Object -ComObject 'Schedule.Service'; $svc.Connect()
  foreach ($mode in 'on', 'off') {
    $name = 'DyIsland DNS ' + $(if ($mode -eq 'on') { 'On' } else { 'Off' })
    $action = New-ScheduledTaskAction -Execute $psExe -Argument ('-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "{0}" -Mode {1}' -f $script, $mode)
    $principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
    $settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit (New-TimeSpan -Minutes 1) -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
    Register-ScheduledTask -TaskName $name -Action $action -Principal $principal -Settings $settings -Force | Out-Null
    $svc.GetFolder('\').GetTask($name).SetSecurityDescriptor($sddl, 0)
  }

  Write-Host ''
  Write-Host 'Done. The DNS tile in DyIsland can now switch NextDNS on and off.' -ForegroundColor Green
  Write-Host ('Log: ' + (Join-Path $dir 'dns.log'))
  Read-Host 'Press Enter to close'
} catch {
  Stop-Here ('Setup failed: ' + $_.Exception.Message)
}
