#requires -Version 5.1
# DyIsland DNS providers: the ONLY script that changes DNS for the provider switch. dnsp-setup.ps1 copies it to C:\ProgramData\DyIsland\dnsp (a folder only
# administrators can write to) and creates scheduled tasks that run as SYSTEM and that only YOUR Windows user may start:
#   -Slot off   put every saved connection back on automatic DNS (your ISP / router)
#   -Slot 1..8  put every saved connection on the servers of profile 1..8 from profiles.json (written once, by the elevated setup)
# It reads only profiles.json, checks every value again, and touches only the connections listed there.
param([Parameter(Mandatory = $true)][ValidateSet('off', '1', '2', '3', '4', '5', '6', '7', '8')][string]$Slot)
$ErrorActionPreference = 'Stop'
$dir = Join-Path $env:ProgramData 'DyIsland\dnsp'
$log = Join-Path $dir 'dnsp.log'
function Write-Log([string]$m) {
  try { if ((Test-Path $log) -and ((Get-Item $log).Length -gt 65536)) { Remove-Item $log -Force }; Add-Content -Path $log -Value ('{0:s} {1}' -f (Get-Date), $m) } catch { }
}
try {
  $cfg = Get-Content -Raw -Path (Join-Path $dir 'profiles.json') | ConvertFrom-Json
  $ipv4Re = '^(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)$'
  $guidRe = '^\{[0-9A-Fa-f]{8}-(?:[0-9A-Fa-f]{4}-){3}[0-9A-Fa-f]{12}\}$'
  $dohRe = '^https://[A-Za-z0-9](?:[A-Za-z0-9.-]{0,120}[A-Za-z0-9])?(?::\d{1,5})?(?:/[A-Za-z0-9._~/-]{0,120})?$'
  $adapters = @($cfg.adapters); $profiles = @($cfg.profiles)
  if ($adapters.Count -lt 1 -or $adapters.Count -gt 16 -or $profiles.Count -lt 1 -or $profiles.Count -gt 8) { throw 'bad config' }
  foreach ($a in $adapters) { if ([string]$a.guid -notmatch $guidRe) { throw 'bad adapter id' } }
  function Test-V6([string]$x) { $p = $null; return ([System.Net.IPAddress]::TryParse($x, [ref]$p) -and $p.AddressFamily -eq [System.Net.Sockets.AddressFamily]::InterNetworkV6) }
  $chosen = $null
  if ($Slot -ne 'off') {
    $i = [int]$Slot - 1
    if ($i -ge $profiles.Count) { throw 'no such profile' }
    $p = $profiles[$i]
    $v4 = @($p.v4 | Where-Object { $_ } | ForEach-Object { [string]$_ }); $v6 = @($p.v6 | Where-Object { $_ } | ForEach-Object { [string]$_ })
    foreach ($x in $v4) { if ($x -notmatch $ipv4Re -or $x -match '^(0\.|127\.|255\.)') { throw 'bad IPv4 address' } }
    foreach ($x in $v6) { if (-not (Test-V6 $x)) { throw 'bad IPv6 address' } }
    if ($v4.Count -eq 0 -and $v6.Count -eq 0) { throw 'profile without servers' }
    $doh = [string]$p.doh
    if ($doh -and $doh -notmatch $dohRe) { throw 'bad encrypted-DNS template' }
    $chosen = [pscustomobject]@{ V4 = $v4; V6 = $v6; Doh = $doh }
  }
  foreach ($a in $adapters) {
    $nic = Get-NetAdapter | Where-Object { $_.InterfaceGuid -eq [string]$a.guid } | Select-Object -First 1
    if (-not $nic) { Write-Log "adapter $($a.guid) is not present, skipped"; continue }
    if ($null -eq $chosen) { Set-DnsClientServerAddress -InterfaceIndex $nic.ifIndex -ResetServerAddresses }
    else {
      Set-DnsClientServerAddress -InterfaceIndex $nic.ifIndex -ServerAddresses (@($chosen.V4) + @($chosen.V6))
    }
  }
  # encrypted DNS: Windows keeps a template per server address; (re)register this provider's, with fallback to normal DNS so a blocked DoH never leaves you offline
  if ($null -ne $chosen -and $chosen.Doh) {
    foreach ($ip in (@($chosen.V4) + @($chosen.V6))) {
      try { Remove-DnsClientDohServerAddress -ServerAddress $ip -ErrorAction SilentlyContinue } catch { }
      try { Add-DnsClientDohServerAddress -ServerAddress $ip -DohTemplate $chosen.Doh -AllowFallbackToUdp $true -AutoUpgrade $true -ErrorAction Stop | Out-Null } catch { Write-Log ('doh for ' + $ip + ' not set: ' + $_.Exception.Message) }
    }
  }
  Clear-DnsClientCache
  Write-Log "slot=$Slot ok"
  exit 0
} catch {
  Write-Log ("slot=$Slot FAILED: " + $_.Exception.Message)
  exit 1
}
