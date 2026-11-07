param([switch]$SeedFromExistingCache, [switch]$Offline)
$ErrorActionPreference = 'Stop'
$project = $PSScriptRoot
$env:CARGO_HOME = Join-Path $project '.cargo-home'
$env:CARGO_TARGET_DIR = Join-Path $project 'target'
New-Item -ItemType Directory -Force -Path $env:CARGO_HOME, (Join-Path $project 'evidence') | Out-Null

if ($SeedFromExistingCache) {
    # Read the existing package cache; all new cache files stay inside this project.
    $sourceCache = Join-Path $env:USERPROFILE '.cargo'
    foreach ($part in @('registry/cache', 'registry/index')) {
        $source = Join-Path $sourceCache $part
        $destination = Join-Path $env:CARGO_HOME $part
        if (Test-Path -LiteralPath $source) {
            & robocopy.exe $source $destination /E /NFL /NDL /NJH /NJS /NP | Out-Null
            if ($LASTEXITCODE -ge 8) { throw "Cache copy failed: $part" }
        }
    }
    $sourceConfig = Join-Path $sourceCache 'config.toml'
    if (Test-Path -LiteralPath $sourceConfig) {
        Copy-Item -LiteralPath $sourceConfig -Destination (Join-Path $env:CARGO_HOME 'config.toml')
    }
}

$vswhere = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio/Installer/vswhere.exe'
$vs = & $vswhere -latest -products '*' -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
if (-not $vs) { throw 'Visual Studio C++ x64 build tools not found' }
$devcmd = Join-Path $vs 'Common7/Tools/VsDevCmd.bat'
$environmentLines = & cmd.exe /d /s /c "`"$devcmd`" -arch=x64 -host_arch=x64 >nul && set"
if ($LASTEXITCODE -ne 0) { throw 'VsDevCmd failed' }
foreach ($line in $environmentLines) {
    if ($line -match '^([^=]+)=(.*)$') {
        [Environment]::SetEnvironmentVariable($matches[1], $matches[2], 'Process')
    }
}

Push-Location $project
try {
    $rustVersion = & rustc -V
    if ($rustVersion -notmatch '^rustc 1\.93\.1 ') { throw "Expected Rust 1.93.1, found $rustVersion" }
    $arguments = @('build', '--manifest-path', (Join-Path $project 'Cargo.toml'))
    if (Test-Path -LiteralPath (Join-Path $project 'Cargo.lock')) { $arguments += '--locked' }
    if ($Offline) { $arguments += '--offline' }
    $log = Join-Path $project ('evidence/issue3-build-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '.txt')
    "rust=$rustVersion`ncommand=cargo $($arguments -join ' ')`nCARGO_HOME=$env:CARGO_HOME`nCARGO_TARGET_DIR=$env:CARGO_TARGET_DIR`nVCToolsInstallDir=$env:VCToolsInstallDir`nWindowsSdkDir=$env:WindowsSdkDir`nWindowsSDKVersion=$env:WindowsSDKVersion" | Set-Content -LiteralPath $log
    & cargo @arguments 2>&1 | Tee-Object -FilePath $log -Append
    if ($LASTEXITCODE -ne 0) { throw "Cargo build failed; see $log" }
    Get-FileHash -Algorithm SHA256 -LiteralPath (Join-Path $project 'target/debug/issue3-windows-smoke.exe') | Format-List
} finally { Pop-Location }
