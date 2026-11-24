#requires -Version 5.1
# DyIsland DNS switch: removes the two scheduled tasks and C:\ProgramData\DyIsland\dns. It does not touch your current DNS settings.
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) { Write-Host 'Please run this as administrator.' -ForegroundColor Red; Read-Host 'Press Enter to close'; exit 1 }
foreach ($name in 'DyIsland DNS On', 'DyIsland DNS Off') { try { Unregister-ScheduledTask -TaskName $name -Confirm:$false -ErrorAction Stop } catch { } }

$root = Join-Path $env:ProgramData 'DyIsland'
$dir = Join-Path $root 'dns'
if (Test-Path -LiteralPath $dir) {
  $item = Get-Item -LiteralPath $dir -Force
  if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) {
    [IO.Directory]::Delete($dir, $false)            # a link: remove the LINK only, never what it points at
    Write-Host 'The DNS folder was a link; the link was removed (its target was not touched).' -ForegroundColor Yellow
  } else {
    Remove-Item -LiteralPath $dir -Recurse -Force
  }
}
try { if ((Test-Path -LiteralPath $root) -and -not (Get-ChildItem -LiteralPath $root -Force | Select-Object -First 1) -and -not ((Get-Item -LiteralPath $root -Force).Attributes -band [IO.FileAttributes]::ReparsePoint)) { Remove-Item -LiteralPath $root -Force } } catch { }
Write-Host 'The DyIsland DNS switch was removed. Your DNS settings were left as they are.' -ForegroundColor Green
Read-Host 'Press Enter to close'
