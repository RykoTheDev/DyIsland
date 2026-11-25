#requires -Version 5.1
# DyIsland DNS providers: removes the scheduled tasks and C:\ProgramData\DyIsland\dnsp. It does not touch your current DNS settings.
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) { Write-Host 'Please run this as administrator.' -ForegroundColor Red; Read-Host 'Press Enter to close'; exit 1 }
foreach ($name in (@('DyIsland DNSP Off') + (1..8 | ForEach-Object { "DyIsland DNSP $_" }))) { try { Unregister-ScheduledTask -TaskName $name -Confirm:$false -ErrorAction Stop } catch { } }
$dir = Join-Path (Join-Path $env:ProgramData 'DyIsland') 'dnsp'
if (Test-Path -LiteralPath $dir) {
  $item = Get-Item -LiteralPath $dir -Force
  if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) { [IO.Directory]::Delete($dir, $false) } else { Remove-Item -LiteralPath $dir -Recurse -Force }
}
Write-Host 'The DyIsland DNS provider switch was removed. Your DNS settings were left as they are.' -ForegroundColor Green
Read-Host 'Press Enter to close'
