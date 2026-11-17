param([Parameter(ValueFromRemainingArguments = $true)][string[]]$CargoArguments = @('test', '--offline', '--locked', '--target', 'x86_64-pc-windows-msvc', 'recovery'))
$ErrorActionPreference = 'Stop'
$repositoryRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$vswhere = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio/Installer/vswhere.exe'
$vs = & $vswhere -latest -products '*' -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
if (-not $vs) { throw 'Install Visual Studio C++ x64 tools and Windows SDK' }
$devcmd = Join-Path $vs 'Common7/Tools/VsDevCmd.bat'
$environmentLines = & cmd.exe /d /s /c "`"$devcmd`" -arch=x64 -host_arch=x64 >nul && set"
if ($LASTEXITCODE -ne 0) { throw 'VsDevCmd failed' }
foreach ($line in $environmentLines) {
    if ($line -match '^([^=]+)=(.*)$') {
        [Environment]::SetEnvironmentVariable($matches[1], $matches[2], 'Process')
    }
}
$env:CARGO_TARGET_DIR = Join-Path $repositoryRoot 'app/src-tauri/target'
Push-Location (Join-Path $repositoryRoot 'app/src-tauri')
try {
    & cargo @CargoArguments
    $cargoExitCode = $LASTEXITCODE
} finally { Pop-Location }
exit $cargoExitCode
