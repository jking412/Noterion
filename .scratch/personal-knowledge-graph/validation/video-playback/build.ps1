param([switch]$SeedFromExistingCache, [switch]$Offline, [switch]$Check, [switch]$UpdateLockfile)
$ErrorActionPreference = 'Stop'
$project = $PSScriptRoot
$env:CARGO_HOME = Join-Path $project '.local/cargo-home'
$env:CARGO_TARGET_DIR = Join-Path $project 'target'
$env:CARGO_HTTP_MULTIPLEXING = 'false'
New-Item -ItemType Directory -Force -Path $env:CARGO_HOME, (Join-Path $project 'evidence') | Out-Null

if ($SeedFromExistingCache) {
    $validationRoot = Split-Path -Parent $project
    foreach ($sourceCache in @((Join-Path $validationRoot 'windows-desktop/.cargo-home'), (Join-Path $validationRoot 'object-storage/.local/cargo-home'))) {
        foreach ($part in @('cache', 'index')) {
            $source = Join-Path $sourceCache ('registry/' + $part)
            $destination = Join-Path $env:CARGO_HOME ('registry/' + $part + '/index.crates.io-1949cf8c6b5b557f')
            if (Test-Path -LiteralPath $source) {
                foreach ($registry in (Get-ChildItem -LiteralPath $source -Directory)) {
                    # All these caches contain crates.io packages. Fold mirror
                    # caches into this task's canonical source, then overlay
                    # the newer official cache from the object-storage probe.
                    & robocopy.exe $registry.FullName $destination /E /IS /IT /NFL /NDL /NJH /NJS /NP | Out-Null
                    if ($LASTEXITCODE -ge 8) { throw "Cache copy failed: $part" }
                }
            }
        }
    }
}

$vswhere = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio/Installer/vswhere.exe'
$vs = & $vswhere -latest -products '*' -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
if (-not $vs) { throw 'Visual Studio C++ x64 build tools not found' }
$devcmd = Join-Path $vs 'Common7/Tools/VsDevCmd.bat'
$environmentLines = & cmd.exe /d /s /c "`"$devcmd`" -arch=x64 -host_arch=x64 >nul && set"
if ($LASTEXITCODE -ne 0) { throw 'VsDevCmd failed' }
foreach ($line in $environmentLines) {
    if ($line -match '^([^=]+)=(.*)$') { [Environment]::SetEnvironmentVariable($matches[1], $matches[2], 'Process') }
}

Push-Location $project
try {
    $rustVersion = & rustc -V
    if ($rustVersion -notmatch '^rustc 1\.93\.1 ') { throw "Expected Rust 1.93.1, found $rustVersion" }
    $verb = if ($Check) { 'check' } else { 'build' }
    $arguments = @($verb, '--manifest-path', (Join-Path $project 'Cargo.toml'))
    if ((Test-Path -LiteralPath (Join-Path $project 'Cargo.lock')) -and -not $UpdateLockfile) { $arguments += '--locked' }
    if ($Offline) { $arguments += '--offline' }
    $log = Join-Path $project ('evidence/issue13-build-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '.txt')
    "rust=$rustVersion`ncommand=cargo $($arguments -join ' ')`n" | Set-Content -LiteralPath $log
    & cargo @arguments 2>&1 | Tee-Object -FilePath $log -Append
    if ($LASTEXITCODE -ne 0) { throw "Cargo $verb failed; see $log" }
    if (-not $Check) { Get-FileHash -Algorithm SHA256 -LiteralPath (Join-Path $project 'target/debug/issue-13-video.exe') | Format-List }
} finally { Pop-Location }
