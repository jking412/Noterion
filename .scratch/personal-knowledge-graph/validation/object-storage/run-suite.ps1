$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
& ./start-service.ps1
if (Get-NetTCPConnection -LocalPort 19110 -State Listen -ErrorAction SilentlyContinue) {
    throw 'Port 19110 is occupied; do not replace an existing listener'
}
$proxy = Start-Process -FilePath python -ArgumentList @('-B', 'tools/fault_proxy.py') -WorkingDirectory $PSScriptRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $PSScriptRoot '.local/proxy.log') -RedirectStandardError (Join-Path $PSScriptRoot '.local/proxy-errors.log') -PassThru
try {
    $listening = $false
    for ($attempt = 0; $attempt -lt 30; $attempt++) {
        if ($proxy.HasExited) { throw 'Issue 10 fault proxy exited' }
        if (Get-NetTCPConnection -LocalPort 19110 -State Listen -ErrorAction SilentlyContinue) { $listening = $true; break }
        Start-Sleep -Milliseconds 200
    }
    if (!$listening) { throw 'Issue 10 fault proxy did not start' }
    & ./run-validation.ps1 -Phase ready
    & ./run-validation.ps1 -Phase probe
    & ./run-validation.ps1 -Phase ranges
    & ./run-validation.ps1 -Phase multipart
    & ./run-validation.ps1 -Phase failures
    Remove-Item -LiteralPath (Join-Path $PSScriptRoot '.local/small.bin'),(Join-Path $PSScriptRoot '.local/multipart.bin')
    & ./run-validation.ps1 -Phase resume
    & ./start-service.ps1 -Restart
    & ./run-validation.ps1 -Phase ready
    & ./run-validation.ps1 -Phase verify
    $reports = 'ready','ranges','multipart','failures','resume','verify'
    $total = 0
    foreach ($phase in $reports) {
        $report = Get-Content -LiteralPath "evidence/$phase.json" -Raw | ConvertFrom-Json
        if (@($report.checks | Where-Object { !$_.passed }).Count) { throw "Failed assertion in $phase" }
        $total += @($report.checks).Count
    }
    Write-Output "PASS complete suite: $total assertions, plus file-upload probe"
} finally {
    if (!$proxy.HasExited) { Stop-Process -Id $proxy.Id }
}
