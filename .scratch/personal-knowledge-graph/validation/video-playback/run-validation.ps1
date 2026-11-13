param(
    [ValidateSet('upload', 'start', 'playback', 'all')][string]$Phase = 'all',
    [string]$RunId = ('issue-13-' + (Get-Date -Format 'yyyyMMdd-HHmmss'))
)
$ErrorActionPreference = 'Stop'
$project = $PSScriptRoot
$env:ISSUE13_ROOT = $project
$env:ISSUE13_EVIDENCE_DIR = Join-Path $project 'evidence'
Get-Content -LiteralPath (Join-Path $project '.local/service.env') | ForEach-Object {
    $parts = $_.Split('=', 2)
    if ($parts[0] -eq 'RUSTFS_ACCESS_KEY') { $env:ISSUE13_ACCESS_KEY = $parts[1] }
    if ($parts[0] -eq 'RUSTFS_SECRET_KEY') { $env:ISSUE13_SECRET_KEY = $parts[1] }
}
try {
    if ($Phase -in @('upload', 'all')) {
        & (Join-Path $project 'target/debug/issue-13-video.exe') --upload
        if ($LASTEXITCODE -ne 0) { throw 'Real object upload/streamed verification failed' }
    }
    if ($Phase -ne 'upload') {
        $scenario = if ($Phase -eq 'all') { 'all' } else { $Phase }
        node (Join-Path $project 'webdriver-video.mjs') "--run=$RunId" "--scenario=$scenario"
        if ($LASTEXITCODE -ne 0) { throw 'Real WebView video verification failed; see the run evidence' }
    }
} finally {
    Remove-Item Env:ISSUE13_ACCESS_KEY -ErrorAction SilentlyContinue
    Remove-Item Env:ISSUE13_SECRET_KEY -ErrorAction SilentlyContinue
}
