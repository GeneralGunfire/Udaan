# Builds the Udaan installer and prepares a release. Run from the repo root:
#
#   pwsh scripts/release.ps1                 build, checksum, update site/public/latest.json
#   pwsh scripts/release.ps1 -Publish        ...and upload it as a GitHub Release (needs $env:GITHUB_TOKEN)
#   pwsh scripts/release.ps1 -SkipBuild      reuse the installer from the last build
#
# It builds into its OWN target folder (C:\udaan-release\target) so it never fights a running Udaan for
# Udaan.exe, and never touches your own install or data.
#
# What it writes:
#   dist-release\Udaan_<version>_x64-setup.exe   the installer (one file: it supports Windows 10 and 11)
#   site\public\latest.json                      version, date, installer address, size and SHA-256 for both Windows versions
#
# After it runs: commit site/public/latest.json and push it to master. The website's Download page and every
# installed Udaan's "Check for updates" read that file, so that is the moment the release goes live.
param(
  [switch] $SkipBuild,
  [switch] $Publish,
  [string] $Notes = '',
  [string] $Repo = 'GeneralGunfire/Udaan'
)
$ErrorActionPreference = 'Stop'
Set-Location (Split-Path $PSScriptRoot -Parent)

$conf = Get-Content src-tauri/tauri.conf.json -Raw | ConvertFrom-Json
$version = $conf.version
$target = 'C:\udaan-release\target'
$out = Join-Path (Get-Location) 'dist-release'
$name = "Udaan_${version}_x64-setup.exe"   # updater.rs only accepts files ending in -setup.exe

if (-not $SkipBuild) {
  Write-Host "Building Udaan $version ..."
  $env:CARGO_TARGET_DIR = $target
  $env:CARGO_BUILD_JOBS = '2'          # this PC has little memory
  pnpm tauri build --bundles nsis
  if ($LASTEXITCODE) { throw 'The build failed.' }
}
$built = Get-ChildItem (Join-Path $target "release\bundle\nsis") -Filter '*-setup.exe' -ErrorAction Stop | Sort-Object LastWriteTime | Select-Object -Last 1
if (-not $built) { throw 'No installer found. Run without -SkipBuild.' }

New-Item -ItemType Directory -Force $out | Out-Null
Copy-Item $built.FullName (Join-Path $out $name) -Force
$file = Join-Path $out $name
$sha = (Get-FileHash $file -Algorithm SHA256).Hash.ToLower()
$mb = [math]::Round((Get-Item $file).Length / 1MB)
Write-Host "Installer: $file ($mb MB)"
Write-Host "SHA-256:   $sha"

# Update the release file the website and the app both read.
$latestPath = 'site/public/latest.json'
$latest = Get-Content $latestPath -Raw | ConvertFrom-Json
$url = "https://github.com/$Repo/releases/download/v$version/$name"
$latest.version = $version
$latest.date = (Get-Date -Format 'yyyy-MM-dd')
foreach ($w in '10', '11') {
  $latest.installers.$w = [pscustomobject]@{ url = $url; size = "$mb MB"; sha256 = $sha }
}
if (-not ($latest.updates | Where-Object { $_.version -eq $version })) {
  $entry = [pscustomobject]@{ date = $latest.date; kind = 'release'; version = $version; title = "Udaan $version"; notes = @($(if ($Notes) { $Notes } else { 'See the release page for what changed.' })) }
  $latest.updates = @($entry) + @($latest.updates)
}
$latest | ConvertTo-Json -Depth 6 | Set-Content $latestPath -Encoding utf8
Write-Host "Updated $latestPath"

if ($Publish) {
  if (-not $env:GITHUB_TOKEN) { throw 'Set $env:GITHUB_TOKEN to a token with repo access to publish.' }
  $h = @{ Authorization = "Bearer $env:GITHUB_TOKEN"; Accept = 'application/vnd.github+json'; 'User-Agent' = 'udaan-release' }
  $rel = Invoke-RestMethod "https://api.github.com/repos/$Repo/releases" -Method Post -Headers $h -ContentType 'application/json' -Body (@{ tag_name = "v$version"; name = "Udaan $version"; body = $(if ($Notes) { $Notes } else { "Udaan $version" }); draft = $false; prerelease = $true } | ConvertTo-Json)
  $upload = $rel.upload_url -replace '\{.*\}', "?name=$name"
  Invoke-RestMethod $upload -Method Post -Headers $h -ContentType 'application/octet-stream' -InFile $file | Out-Null
  Write-Host "Published: $($rel.html_url)"
} else {
  Write-Host ''
  Write-Host "Next: create a GitHub Release tagged v$version and upload $name to it (or re-run with -Publish)."
}
Write-Host 'Then commit and push site/public/latest.json to master to make the release live.'
