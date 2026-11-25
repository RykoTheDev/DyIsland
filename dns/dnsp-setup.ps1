#requires -Version 5.1
# DyIsland DNS providers: setup. Run as administrator (DyIsland > Settings > Apps > DNS providers > "Install" does this; Windows shows its usual approval prompt).
# It does NOT change your DNS. It:
#   1. shows you the list of providers you chose (and checks every address again), and the connections they would apply to,
#   2. after you type y, copies dnsp-apply.ps1 into C:\ProgramData\DyIsland\dnsp (only administrators can write there) and saves the list as profiles.json,
#   3. creates the scheduled tasks "DyIsland DNSP Off" and "DyIsland DNSP 1..N" that run that script as SYSTEM and that only YOUR Windows user may start.
# Switching afterwards needs no more approvals. Adding or changing a provider runs this again. Remove everything with dnsp-remove.ps1.
param([string]$ProfilesB64 = '')
$ErrorActionPreference = 'Stop'
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) { Write-Host 'Please run this as administrator.' -ForegroundColor Red; Read-Host 'Press Enter to close'; exit 1 }
function Stop-Here([string]$msg) { Write-Host ''; Write-Host $msg -ForegroundColor Yellow; Write-Host ''; Read-Host 'Press Enter to close'; exit 1 }

$SidSystem = 'S-1-5-18'; $SidAdmins = 'S-1-5-32-544'; $SidUsers = 'S-1-5-32-545'
$SidInstaller = 'S-1-5-80-956008885-3418522649-1831038044-1853292631-2271478464'
$trusted = @($SidSystem, $SidAdmins, $SidInstaller)
function Test-SafeDir([string]$p) {
  $item = Get-Item -LiteralPath $p -Force -ErrorAction Stop
  if (-not $item.PSIsContainer) { return $false }
  if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) { return $false }
  $acl = Get-Acl -LiteralPath $p
  if ($trusted -notcontains $acl.GetOwner([Security.Principal.SecurityIdentifier]).Value) { return $false }
  $write = [Security.AccessControl.FileSystemRights]'WriteData,AppendData,WriteExtendedAttributes,WriteAttributes,Delete,DeleteSubdirectoriesAndFiles,ChangePermissions,TakeOwnership'
  foreach ($r in $acl.GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier])) {
    if ($r.AccessControlType -ne 'Allow') { continue }
    if (($r.FileSystemRights -band $write) -eq 0) { continue }
    if ($trusted -contains $r.IdentityReference.Value) { continue }
    if ($r.IdentityReference.Value -eq 'S-1-3-0' -and ($r.PropagationFlags -band [Security.AccessControl.PropagationFlags]::InheritOnly)) { continue }
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
  $sec.SetAccessRuleProtection($true, $false)
  foreach ($pair in @(@($SidSystem, 'FullControl'), @($SidAdmins, 'FullControl'), @($SidUsers, 'ReadAndExecute'))) {
    $sid = New-Object Security.Principal.SecurityIdentifier($pair[0])
    $sec.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule($sid, $pair[1], 'ContainerInherit,ObjectInherit', 'None', 'Allow')))
  }
  [void][IO.Directory]::CreateDirectory($p, $sec)
  if (-not (Test-SafeDir $p)) { throw "$p was not created safely (someone else created it first). Delete it from an administrator prompt, then run setup again." }
}

try {
  Write-Host 'DyIsland DNS providers: setup' -ForegroundColor Cyan
  Write-Host ''
  # 0. is this script itself somewhere ordinary programs could have edited it?
  $srcSafe = $false; try { $srcSafe = Test-SafeDir $PSScriptRoot } catch { }
  foreach ($f in 'dnsp-setup.ps1', 'dnsp-apply.ps1') { $h = (Get-FileHash -Algorithm SHA256 -LiteralPath (Join-Path $PSScriptRoot $f)).Hash; Write-Host ('  {0}  SHA-256 {1}' -f $f, $h.Substring(0, 16)) }
  Write-Host ('  running from: ' + $PSScriptRoot)
  if (-not $srcSafe) {
    Write-Host ''
    Write-Host 'This copy of DyIsland sits in a folder that ordinary programs can modify. The steps below run with administrator rights from it, so only continue if you are sure nothing has tampered with these files (for the safest result, install DyIsland somewhere only administrators can write, like C:\Program Files).' -ForegroundColor Yellow
    $t = Read-Host 'Type TRUST to continue'
    if ($t -cne 'TRUST') { Write-Host 'Nothing was changed.'; exit 0 }
  }
  Write-Host ''

  # 1. the providers you chose: decoded and checked again here, in the elevated process
  if (-not $ProfilesB64 -or $ProfilesB64 -notmatch '^[A-Za-z0-9+/=]{4,6000}$') { Stop-Here 'No provider list was passed in.' }
  $profiles = @([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($ProfilesB64)) | ConvertFrom-Json)
  if ($profiles.Count -lt 1 -or $profiles.Count -gt 8) { Stop-Here 'The list must have between 1 and 8 providers.' }
  $ipv4Re = '^(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)$'
  $dohRe = '^https://[A-Za-z0-9](?:[A-Za-z0-9.-]{0,120}[A-Za-z0-9])?(?::\d{1,5})?(?:/[A-Za-z0-9._~/-]{0,120})?$'
  function Test-V6([string]$x) { $p = $null; return ([System.Net.IPAddress]::TryParse($x, [ref]$p) -and $p.AddressFamily -eq [System.Net.Sockets.AddressFamily]::InterNetworkV6) }
  $clean = @()
  Write-Host 'These DNS providers can be switched to from DyIsland:' -ForegroundColor Green
  foreach ($p in $profiles) {
    $name = ([string]$p.name -replace '[^\w .\-+()]', '').Trim(); if (-not $name -or $name.Length -gt 40) { throw 'bad provider name' }
    $id = ([string]$p.id).ToLower(); if ($id -notmatch '^[a-z0-9-]{1,32}$') { throw 'bad provider id' }
    $v4 = @($p.v4 | Where-Object { $_ } | ForEach-Object { [string]$_ }); $v6 = @($p.v6 | Where-Object { $_ } | ForEach-Object { [string]$_ })
    if ($v4.Count -gt 4 -or $v6.Count -gt 4 -or ($v4.Count + $v6.Count) -eq 0) { throw "bad addresses for $name" }
    foreach ($x in $v4) { if ($x -notmatch $ipv4Re -or $x -match '^(0\.|127\.|255\.)') { throw "bad IPv4 address for $name" } }
    foreach ($x in $v6) { if (-not (Test-V6 $x)) { throw "bad IPv6 address for $name" } }
    $doh = [string]$p.doh; if ($doh -and $doh -notmatch $dohRe) { throw "bad encrypted-DNS address for $name" }
    Write-Host ('  {0}. {1}: {2}{3}' -f ($clean.Count + 1), $name, ((@($v4) + @($v6)) -join ', '), $(if ($doh) { '   (encrypted DNS: ' + $doh + ')' } else { '' }))
    $clean += [pscustomobject]@{ id = $id; name = $name; v4 = @($v4); v6 = @($v6); doh = $doh }
  }

  # 2. the connections the switch will change: connected, physical, on automatic IP (so "Off" can hand them back to your router)
  $adapters = @(); $skipped = @()
  foreach ($nic in @(Get-NetAdapter | Where-Object { $_.Status -eq 'Up' })) {
    if (-not $nic.HardwareInterface) { $skipped += ('  - {0}: a virtual / VPN connection (left alone)' -f $nic.Name); continue }
    $dhcp = $false; try { $dhcp = ((Get-NetIPInterface -InterfaceIndex $nic.ifIndex -AddressFamily IPv4).Dhcp -eq 'Enabled') } catch { }
    if (-not $dhcp) { $skipped += ('  - {0}: uses a fixed IP address, so "Off" would leave it with no DNS at all (left alone)' -f $nic.Name); continue }
    $adapters += [pscustomobject]@{ alias = $nic.Name; guid = $nic.InterfaceGuid }
  }
  if ($adapters.Count -eq 0) { $skipped | ForEach-Object { Write-Host $_ }; Stop-Here 'No connected, physical, automatic-IP connection was found to switch.' }
  Write-Host ''
  Write-Host 'It will change the DNS of these connections:' -ForegroundColor Green
  $adapters | ForEach-Object { Write-Host ('  - ' + $_.alias) }
  $skipped | ForEach-Object { Write-Host $_ -ForegroundColor DarkYellow }
  Write-Host ''
  Write-Host '"Automatic" returns them to automatic DNS (your ISP / router). Connections you add or plug in later are not covered: run this again.'
  $go = Read-Host 'Install? (y/n)'
  if ($go -notmatch '^[yY]') { Write-Host 'Nothing was changed.'; exit 0 }

  # 3. the script and the list, in folders only administrators can write to (verified, not assumed)
  $root = Join-Path $env:ProgramData 'DyIsland'; $dir = Join-Path $root 'dnsp'
  New-SecureDir $root; New-SecureDir $dir
  $script = Join-Path $dir 'dnsp-apply.ps1'
  Copy-Item -Force -LiteralPath (Join-Path $PSScriptRoot 'dnsp-apply.ps1') -Destination $script
  $json = [pscustomobject]@{ version = 1; adapters = $adapters; profiles = $clean } | ConvertTo-Json -Depth 6
  [IO.File]::WriteAllText((Join-Path $dir 'profiles.json'), $json, (New-Object System.Text.UTF8Encoding($false)))

  # 4. one task per provider plus "Off", run as SYSTEM, startable only by you
  $sids = @([Security.Principal.WindowsIdentity]::GetCurrent().User.Value)
  try { $cu = (Get-CimInstance Win32_ComputerSystem).UserName; if ($cu) { $s2 = (New-Object System.Security.Principal.NTAccount($cu)).Translate([System.Security.Principal.SecurityIdentifier]).Value; if ($sids -notcontains $s2) { $sids += $s2 } } } catch { }
  $sddl = 'D:(A;;FA;;;BA)(A;;FA;;;SY)' + (($sids | ForEach-Object { "(A;;GRGX;;;$_)" }) -join '')
  $psExe = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
  $svc = New-Object -ComObject 'Schedule.Service'; $svc.Connect()
  foreach ($old in (1..8 | ForEach-Object { "DyIsland DNSP $_" })) { try { Unregister-ScheduledTask -TaskName $old -Confirm:$false -ErrorAction Stop } catch { } }
  $slots = @('off') + (1..$clean.Count | ForEach-Object { [string]$_ })
  foreach ($slot in $slots) {
    $name = 'DyIsland DNSP ' + $(if ($slot -eq 'off') { 'Off' } else { $slot })
    $action = New-ScheduledTaskAction -Execute $psExe -Argument ('-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "{0}" -Slot {1}' -f $script, $slot)
    $principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
    $settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit (New-TimeSpan -Minutes 1) -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
    Register-ScheduledTask -TaskName $name -Action $action -Principal $principal -Settings $settings -Force | Out-Null
    $svc.GetFolder('\').GetTask($name).SetSecurityDescriptor($sddl, 0)
  }
  Write-Host ''
  Write-Host ('Done. DyIsland can now switch between Automatic and {0} DNS providers.' -f $clean.Count) -ForegroundColor Green
  Write-Host ('Log: ' + (Join-Path $dir 'dnsp.log'))
  Read-Host 'Press Enter to close'
} catch {
  Stop-Here ('Setup failed: ' + $_.Exception.Message)
}
