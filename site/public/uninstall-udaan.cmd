<# : batch
@echo off
rem  Removes Udaan from this PC completely. It needs nothing else: you do not need Udaan to be running or working.
rem  Double-click this file. It asks once before it removes anything.
rem  (Technical: this one file is both a batch file and a PowerShell script.)
title Remove Udaan
powershell -NoProfile -ExecutionPolicy Bypass -Command "& ([scriptblock]::Create([IO.File]::ReadAllText('%~f0')))"
set code=%errorlevel%
if not defined UDAAN_YES pause
exit /b %code%
#>

# ---------------------------------------------------------------------------------------------------------------
# Udaan: complete removal.
#   1. stops Udaan and its helper
#   2. gives you back the Windows taskbar and desktop (and the Windows shell, if Udaan had been set as it)
#   3. runs Udaan's own uninstaller, then removes anything it leaves behind
#   4. removes Udaan's start-up entry, its udaan:// link, its shortcuts, and your Udaan data
# Your personal files (Documents, Pictures, Downloads...) are never touched. Only Udaan's own folders are removed.
# Settings for testing only: UDAAN_PRODUCT / UDAAN_ID / UDAAN_YES / UDAAN_KEEPDATA.
# ---------------------------------------------------------------------------------------------------------------
$ErrorActionPreference = 'Continue'
$product = if ($env:UDAAN_PRODUCT) { $env:UDAAN_PRODUCT } else { 'Udaan' }
$id      = if ($env:UDAAN_ID) { $env:UDAAN_ID } else { 'dev.udaan.workstation' }
if ($product -notmatch '^[A-Za-z]{3,20}$' -or $id -notmatch '^[a-z0-9.]{5,60}$') { Write-Host 'Unexpected names. Nothing was changed.'; exit 2 }
$keepData = [bool]$env:UDAAN_KEEPDATA
$real = ($product -eq 'Udaan')

Write-Host ''
Write-Host "  This will remove $product from this PC:" -ForegroundColor Cyan
Write-Host '    - the program, its shortcuts and its start-up entry'
Write-Host '    - Udaan settings, PIN, Work password, notes and wallpapers you added' -NoNewline
Write-Host $(if ($keepData) { ' (KEPT: data removal is off)' } else { '' })
Write-Host '    - your Windows taskbar and desktop come back'
Write-Host '  Your documents, pictures and other files are not touched.'
Write-Host ''
if (-not $env:UDAAN_YES) {
  $a = Read-Host '  Type YES to continue'
  if ($a -ne 'YES') { Write-Host '  Cancelled. Nothing was changed.'; exit 1 }
}

$log = New-Object System.Collections.Generic.List[string]
function Step($t) { Write-Host "  - $t"; $log.Add($t) }

# 1. stop Udaan ---------------------------------------------------------------------------------------------------
Step "Stopping $product"
# Anything running from this product's own program folder (the app, its guard and its watchdog), and the app by name.
$dirs = @((Join-Path $env:LOCALAPPDATA "Programs\$product"))
foreach ($k in @("HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\$product", "HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\$product")) {
  $loc = (Get-ItemProperty $k -ErrorAction SilentlyContinue).InstallLocation
  if ($loc) { $dirs += $loc.Trim('"') }
}
Get-Process -ErrorAction SilentlyContinue | Where-Object {
  $path = $_.Path
  $_.ProcessName -eq $product -or ($path -and ($dirs | Where-Object { $_ -and $path.StartsWith($_, [StringComparison]::OrdinalIgnoreCase) }))
} | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Milliseconds 800

# 2. give the Windows desktop back ---------------------------------------------------------------------------------
# Only when no other Udaan is still running: a second copy (a test build) must not un-hide the taskbar for the first.
$others = Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.ProcessName -like 'Udaan*' -and $_.ProcessName -ne 'shell-watchdog' }
if (-not $others) {
Step 'Restoring the Windows taskbar'
Add-Type -Namespace U -Name Tray -MemberDefinition @'
[System.Runtime.InteropServices.DllImport("user32.dll", CharSet=System.Runtime.InteropServices.CharSet.Unicode)] public static extern System.IntPtr FindWindowEx(System.IntPtr p, System.IntPtr a, string c, string w);
[System.Runtime.InteropServices.DllImport("user32.dll")] public static extern bool ShowWindow(System.IntPtr h, int n);
'@
foreach ($cls in 'Shell_TrayWnd', 'Shell_SecondaryTrayWnd') {
  $h = [U.Tray]::FindWindowEx([IntPtr]::Zero, [IntPtr]::Zero, $cls, $null)
  while ($h -ne [IntPtr]::Zero) { [void][U.Tray]::ShowWindow($h, 5); $h = [U.Tray]::FindWindowEx([IntPtr]::Zero, $h, $cls, $null) }
}
}
if ($real) {
  # If Udaan had been set as the Windows shell, put Explorer back. (Only possible when run as administrator.)
  $win = 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Winlogon'
  $shell = (Get-ItemProperty $win -Name Shell -ErrorAction SilentlyContinue).Shell
  if ($shell -and $shell -match 'udaan|watchdog') {
    try { Set-ItemProperty $win -Name Shell -Value 'explorer.exe' -ErrorAction Stop; Step 'Windows shell set back to Explorer' }
    catch { Write-Host '  ! Udaan was set as your Windows shell, and putting Explorer back needs administrator rights.' -ForegroundColor Yellow; Write-Host '    Right-click this file and choose "Run as administrator", then run it again.' -ForegroundColor Yellow }
  }
  if (-not (Get-Process explorer -ErrorAction SilentlyContinue)) { Start-Process explorer.exe }
}

# 3. the official uninstaller, then anything left ------------------------------------------------------------------
Step 'Running the uninstaller'
$keys = @("HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\$product", "HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\$product")
$installDirs = New-Object System.Collections.Generic.List[string]
foreach ($k in $keys) {
  $p = Get-ItemProperty $k -ErrorAction SilentlyContinue
  if ($p) {
    if ($p.InstallLocation) { $installDirs.Add(($p.InstallLocation.Trim('"'))) }
    $u = $p.UninstallString
    if ($u) { $exe = ($u -replace '^"([^"]+)".*$', '$1'); if (Test-Path $exe) { Start-Process $exe -ArgumentList '/S' -Wait -ErrorAction SilentlyContinue } }
  }
}
$installDirs.Add((Join-Path $env:LOCALAPPDATA "Programs\$product"))
foreach ($d in ($installDirs | Select-Object -Unique)) {
  # Only ever a folder named after the product, inside the user's own program folders.
  if ($d -and (Test-Path $d) -and ((Split-Path $d -Leaf) -ieq $product) -and ($d -like "$env:LOCALAPPDATA\*" -or $d -like "$env:ProgramFiles\*")) {
    Step "Removing program folder $d"
    Remove-Item $d -Recurse -Force -ErrorAction SilentlyContinue
  }
}

# 4. leftovers ------------------------------------------------------------------------------------------------------
Step 'Removing start-up entry, link and shortcuts'
Remove-ItemProperty 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run' -Name $product -ErrorAction SilentlyContinue
if ($real) { Remove-Item 'HKCU:\Software\Classes\udaan' -Recurse -Force -ErrorAction SilentlyContinue }
foreach ($k in $keys) { Remove-Item $k -Recurse -Force -ErrorAction SilentlyContinue }
Remove-Item "HKCU:\Software\$id" -Recurse -Force -ErrorAction SilentlyContinue
# The installer keeps its install folder under Software\Udaan\<product>. Remove it, and the Udaan folder if nothing else is in it.
Remove-Item "HKCU:\Software\Udaan\$product" -Recurse -Force -ErrorAction SilentlyContinue
if ((Test-Path 'HKCU:\Software\Udaan') -and -not (Get-ChildItem 'HKCU:\Software\Udaan' -ErrorAction SilentlyContinue)) { Remove-Item 'HKCU:\Software\Udaan' -Force -ErrorAction SilentlyContinue }
$lnks = @((Join-Path ([Environment]::GetFolderPath('Programs')) $product), (Join-Path ([Environment]::GetFolderPath('Programs')) "$product.lnk"), (Join-Path ([Environment]::GetFolderPath('Desktop')) "$product.lnk"))
foreach ($l in $lnks) { Remove-Item $l -Recurse -Force -ErrorAction SilentlyContinue }

if (-not $keepData) {
  Step 'Removing Udaan data'
  $dataDirs = @((Join-Path $env:APPDATA $id), (Join-Path $env:LOCALAPPDATA $id), (Join-Path $env:TEMP 'udaan-update'))
  if ($real) { $dataDirs += (Join-Path $env:APPDATA 'Udaan'); $dataDirs += (Join-Path $env:LOCALAPPDATA 'Udaan') }
  foreach ($d in $dataDirs) { if ($d -and (Test-Path $d)) { Remove-Item $d -Recurse -Force -ErrorAction SilentlyContinue } }
} else { Step 'Keeping your Udaan data' }

Write-Host ''
Write-Host "  Done. $product has been removed." -ForegroundColor Green
if (-not $env:UDAAN_YES) { Write-Host '  If the taskbar looks odd, sign out and back in.' }
exit 0
