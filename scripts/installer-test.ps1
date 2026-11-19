# Tests the Windows installer without touching a real Udaan install.
#
# It installs a TEST build (identifier dev.udaan.workstation.test, product name UdaanTest) into a temp folder,
# never launches it, and checks:
#   1. install puts the program files where it was told
#   2. data in the app's data folder survives a reinstall over the top (an update)
#   3. data survives an uninstall (data is only deleted if the person ticks the box)
#   4. the uninstaller removes the program files and its registry entry
# The real Udaan's data folder (%APPDATA%\dev.udaan.workstation) is never read or written.
#
# Usage: pwsh scripts/installer-test.ps1 -Installer <path to UdaanTest_x.y.z_x64-setup.exe> [-Update <path to a newer setup.exe>]
param(
  [Parameter(Mandatory)] [string] $Installer,
  [string] $Update
)
$ErrorActionPreference = 'Stop'
$id = 'dev.udaan.workstation.test'
$real = Join-Path $env:APPDATA 'dev.udaan.workstation'
$data = Join-Path $env:APPDATA $id
$dest = Join-Path $env:TEMP 'udaan-installer-test'
$fail = 0
function Check($ok, $what) { if ($ok) { Write-Host "  ok    $what" } else { Write-Host "  FAIL  $what" -ForegroundColor Red; $script:fail++ } }

if ($data -eq $real) { throw 'Refusing to run: the test data folder is the real one.' }
if (-not (Test-Path $Installer)) { throw "Installer not found: $Installer" }
Remove-Item $dest -Recurse -Force -ErrorAction SilentlyContinue

Write-Host '1. fresh install'
Start-Process $Installer -ArgumentList '/S', "/D=$dest" -Wait
$exe = Get-ChildItem $dest -Filter *.exe -ErrorAction SilentlyContinue | Where-Object { $_.Name -notmatch 'uninstall' } | Select-Object -First 1
Check ($null -ne $exe) 'program exe installed'
Check (Test-Path (Join-Path $dest 'uninstall.exe')) 'uninstaller installed'
Check (Test-Path 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\UdaanTest') 'uninstall registry entry written'

Write-Host '2. update over the top keeps data'
New-Item -ItemType Directory -Force $data | Out-Null
Set-Content (Join-Path $data 'settings-probe.txt') 'pin-and-notes-probe'
$over = if ($Update) { $Update } else { $Installer }
Start-Process $over -ArgumentList '/S', "/D=$dest" -Wait
Check ((Get-Content (Join-Path $data 'settings-probe.txt') -ErrorAction SilentlyContinue) -eq 'pin-and-notes-probe') 'data file intact after update'
Check ($null -ne (Get-ChildItem $dest -Filter *.exe -ErrorAction SilentlyContinue | Where-Object { $_.Name -notmatch 'uninstall' })) 'program exe still present after update'

Write-Host '3. uninstall keeps data'
Start-Process (Join-Path $dest 'uninstall.exe') -ArgumentList '/S' -Wait
Start-Sleep 2
Check ((Get-Content (Join-Path $data 'settings-probe.txt') -ErrorAction SilentlyContinue) -eq 'pin-and-notes-probe') 'data file intact after uninstall'
Check (-not (Test-Path (Join-Path $dest 'uninstall.exe'))) 'uninstaller removed itself'
Check (-not (Test-Path 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\UdaanTest')) 'uninstall registry entry removed'

Remove-Item $data -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item $dest -Recurse -Force -ErrorAction SilentlyContinue
if ($fail) { Write-Host "$fail check(s) failed" -ForegroundColor Red; exit 1 } else { Write-Host 'all checks passed' -ForegroundColor Green }
