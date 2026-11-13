param([Parameter(Mandatory = $true)][ValidatePattern('^issue3-[a-z0-9-]+$')][string]$RunId, [switch]$Wait)
$ErrorActionPreference = 'Stop'
$project = $PSScriptRoot
$exe = Join-Path $project 'target/debug/issue3-windows-smoke.exe'
if (-not (Test-Path -LiteralPath $exe)) { throw 'Build the host with build.ps1 first' }
$runDir = Join-Path $project "evidence/$RunId"
if (Test-Path -LiteralPath $runDir) { throw "Use a new run id; refusing to overwrite $runDir" }
New-Item -ItemType Directory -Path $runDir | Out-Null
$env:ISSUE3_RUN_ID = $RunId
$env:ISSUE3_EVIDENCE_DIR = $runDir
$env:ISSUE3_DATA_DIR = Join-Path $runDir 'webview-data'
$process = Start-Process -FilePath $exe -WorkingDirectory $project -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $runDir 'stdout.txt') -RedirectStandardError (Join-Path $runDir 'stderr.txt')
$metadata = [ordered]@{
    runId = $RunId
    pid = $process.Id
    launchedAt = (Get-Date).ToString('o')
    executable = $exe
    sha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $exe).Hash
    evidenceDir = $runDir
    webviewData = $env:ISSUE3_DATA_DIR
}
$metadata | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $runDir 'launch.json')
$metadata | ConvertTo-Json
if ($Wait) {
    $process.WaitForExit()
    @{ exitCode = $process.ExitCode; exitedAt = (Get-Date).ToString('o') } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $runDir 'exit.json')
}
