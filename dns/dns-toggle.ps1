#requires -Version 5.1
# DyIsland DNS switch: the ONLY script that changes DNS. It is copied to C:\ProgramData\DyIsland\dns by dns-setup.ps1 (a folder
# only administrators can write to) and started by two scheduled tasks that run as SYSTEM:  -Mode on  /  -Mode off.
#   on  = put each saved connection back on the DNS servers recorded at setup (your NextDNS addresses) and make sure its
#         encrypted-DNS (DoH) template is in place, exactly as recorded
#   off = put each saved connection back on automatic DNS (your ISP / router)
# It reads only the config recorded at setup, checks every value (the encrypted-DNS template must be a NextDNS address), and
# touches only the connections listed there.
param([Parameter(Mandatory = $true)][ValidateSet('on', 'off')][string]$Mode)
$ErrorActionPreference = 'Stop'

$dir = Join-Path $env:ProgramData 'DyIsland\dns'
$log = Join-Path $dir 'dns.log'
function Write-Log([string]$m) {
  try {
    if ((Test-Path $log) -and ((Get-Item $log).Length -gt 65536)) { Remove-Item $log -Force }
    Add-Content -Path $log -Value ('{0:s} {1}' -f (Get-Date), $m)
  } catch { }
}

try {
  $cfg = Get-Content -Raw -Path (Join-Path $dir 'config.json') | ConvertFrom-Json
  $ipv4Re = '^(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)$'
  $guidRe = '^\{[0-9A-Fa-f]{8}-(?:[0-9A-Fa-f]{4}-){3}[0-9A-Fa-f]{12}\}$'
  $tplRe = '^https://(?:[A-Za-z0-9-]+\.)*nextdns\.io(?::\d{1,5})?/[A-Za-z0-9._~/-]{0,128}$'     # encrypted DNS may only point at NextDNS
  $flagsRe = '^(?:0[xX][0-9A-Fa-f]{1,16}|\d{1,19})$'
  $adapters = @($cfg.adapters)
  if ($adapters.Count -lt 1 -or $adapters.Count -gt 16) { throw 'config has no adapters' }

  function Test-V6([string]$x) {
    $p = $null
    return ([System.Net.IPAddress]::TryParse($x, [ref]$p) -and $p.AddressFamily -eq [System.Net.Sockets.AddressFamily]::InterNetworkV6)
  }

  # validate EVERYTHING first, change nothing until the whole file is known to be good
  $plan = @()
  foreach ($a in $adapters) {
    if ([string]$a.guid -notmatch $guidRe) { throw 'bad adapter id in config' }
    $v4 = @($a.v4 | Where-Object { $_ } | ForEach-Object { [string]$_ })
    $v6 = @($a.v6 | Where-Object { $_ } | ForEach-Object { [string]$_ })
    foreach ($x in $v4) { if ($x -notmatch $ipv4Re) { throw 'bad IPv4 address in config' } }
    foreach ($x in $v6) { if (-not (Test-V6 $x)) { throw 'bad IPv6 address in config' } }
    if ($v4.Count -eq 0 -and $v6.Count -eq 0) { throw 'adapter without servers in config' }
    $doh = @()
    foreach ($d in @($a.doh)) {
      if (-not $d) { continue }
      $ip = [string]$d.ip
      if (($v4 -notcontains $ip) -and ($v6 -notcontains $ip)) { throw 'encrypted-DNS entry for an address that is not saved' }
      if ([string]$d.template -notmatch $tplRe) { throw 'encrypted-DNS template is not a NextDNS address' }
      if ([string]$d.flags -notmatch $flagsRe) { throw 'bad encrypted-DNS flags' }
      if (@('QWord', 'DWord') -notcontains [string]$d.kind) { throw 'bad encrypted-DNS flag type' }
      $doh += [pscustomobject]@{ Ip = $ip; Template = [string]$d.template; Flags = [Convert]::ToUInt64([string]$d.flags, $(if (([string]$d.flags) -match '^0[xX]') { 16 } else { 10 })); Kind = [string]$d.kind }
    }
    $plan += [pscustomobject]@{ Guid = [string]$a.guid; V4 = $v4; V6 = $v6; Doh = $doh }
  }

  foreach ($item in $plan) {
    $nic = Get-NetAdapter | Where-Object { $_.InterfaceGuid -eq $item.Guid } | Select-Object -First 1
    if (-not $nic) { Write-Log "adapter $($item.Guid) is not present, skipped"; continue }
    if ($Mode -eq 'off') {
      Set-DnsClientServerAddress -InterfaceIndex $nic.ifIndex -ResetServerAddresses
    } else {
      if ($item.V4.Count -gt 0) { Set-DnsClientServerAddress -InterfaceIndex $nic.ifIndex -ServerAddresses $item.V4 }
      if ($item.V6.Count -gt 0) { Set-DnsClientServerAddress -InterfaceIndex $nic.ifIndex -ServerAddresses $item.V6 }
      # the encrypted-DNS setting Windows keeps per connection and server: put back exactly what was recorded
      foreach ($d in $item.Doh) {
        $key = 'HKLM:\SYSTEM\CurrentControlSet\Services\Dnscache\InterfaceSpecificParameters\' + $item.Guid + '\DohInterfaceSettings\Doh\' + $d.Ip
        New-Item -Path $key -Force | Out-Null
        $val = if ($d.Kind -eq 'DWord') { [UInt32]$d.Flags } else { [UInt64]$d.Flags }
        New-ItemProperty -Path $key -Name 'DohFlags' -Value $val -PropertyType $d.Kind -Force | Out-Null
        New-ItemProperty -Path $key -Name 'DohTemplate' -Value $d.Template -PropertyType String -Force | Out-Null
      }
    }
  }
  Clear-DnsClientCache
  Write-Log "mode=$Mode ok"
  exit 0
} catch {
  Write-Log ("mode=$Mode FAILED: " + $_.Exception.Message)
  exit 1
}
