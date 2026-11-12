param([switch]$Offline, [switch]$Release)
$ErrorActionPreference = 'Stop'
$repository = Split-Path $PSScriptRoot
$env:CARGO_HOME = Join-Path $repository '.scratch/personal-knowledge-graph/validation/windows-desktop/.cargo-home'
$env:CARGO_TARGET_DIR = Join-Path $repository '.scratch/personal-knowledge-graph/validation/windows-desktop/target'
$vswhere = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio/Installer/vswhere.exe'
$vs = & $vswhere -latest -products '*' -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
if (-not $vs) { throw 'Install Visual Studio C++ x64 tools and Windows SDK' }
$devcmd = Join-Path $vs 'Common7/Tools/VsDevCmd.bat'
$environmentLines = & cmd.exe /d /s /c "`"$devcmd`" -arch=x64 -host_arch=x64 >nul && set"
if ($LASTEXITCODE -ne 0) { throw 'VsDevCmd failed' }
foreach ($line in $environmentLines) { if ($line -match '^([^=]+)=(.*)$') { [Environment]::SetEnvironmentVariable($matches[1], $matches[2], 'Process') } }
Push-Location $PSScriptRoot
try {
    & npm.cmd run build
    if ($LASTEXITCODE -ne 0) { throw 'Frontend build failed' }
    $arguments = @('build','--locked','--manifest-path',(Join-Path $PSScriptRoot 'src-tauri/Cargo.toml'))
    if ($Offline) { $arguments += '--offline' }
    if ($Release) { $arguments += '--release' }
    & cargo @arguments
    if ($LASTEXITCODE -ne 0) { throw 'Rust build failed' }
    $profile = if ($Release) { 'release' } else { 'debug' }
    $destination = Join-Path $PSScriptRoot 'dist-desktop'
    New-Item -ItemType Directory -Force $destination | Out-Null
    Copy-Item -LiteralPath (Join-Path $env:CARGO_TARGET_DIR "$profile/noterion.exe") -Destination $destination
    Get-FileHash -LiteralPath (Join-Path $destination 'noterion.exe') -Algorithm SHA256
} finally { Pop-Location }
