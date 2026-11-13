param([Parameter(Mandatory=$true)][string]$Run, [int]$Seconds = 30)
$ErrorActionPreference = 'Stop'
$repo = (Get-Location).Path
$root = Join-Path $PSScriptRoot 'local'
$local = Join-Path $root $Run
$evidence = Join-Path $PSScriptRoot "evidence/$Run"
if (Test-Path -LiteralPath $evidence) { throw 'Use a new run name' }
New-Item -ItemType Directory -Path $local,$evidence | Out-Null
$exe = Join-Path $repo 'app/dist-desktop/noterion.exe'
$env:NOTERION_CONFIG_DIR = Join-Path $local 'config'
$env:NOTERION_WEBVIEW_DIR = Join-Path $local 'profile'
Remove-Item Env:NOTERION_DEEPSEEK_KEY -ErrorAction SilentlyContinue
Remove-Item Env:TAURI_WEBVIEW_AUTOMATION -ErrorAction SilentlyContinue
Remove-Item Env:TAURI_AUTOMATION -ErrorAction SilentlyContinue
# Preserve any inherited WebView2 overrides and report only their presence.
$overrideNames = @(Get-ChildItem Env: | Where-Object Name -Match '^WEBVIEW2_' | Select-Object -ExpandProperty Name)
$observerScript = Join-Path $PSScriptRoot 'observe-webview-windows.ps1'
$observerPath = Join-Path $evidence 'observer'
$observer = Start-Process -FilePath pwsh.exe -WindowStyle Hidden -ArgumentList @('-NoProfile','-File',('"'+$observerScript+'"'),'-RunDirectory',('"'+$observerPath+'"'),'-RootPid',"$PID",'-MaxSeconds',"$($Seconds+15)") -PassThru -RedirectStandardOutput (Join-Path $evidence 'observer-stdout.txt') -RedirectStandardError (Join-Path $evidence 'observer-stderr.txt')
$client = $null
try {
    $deadline = [DateTime]::UtcNow.AddSeconds(10)
    while (!(Test-Path -LiteralPath (Join-Path $observerPath 'windows.jsonl'))) { if ([DateTime]::UtcNow -gt $deadline) { throw 'Observer did not initialize' }; Start-Sleep -Milliseconds 100 }
    $started = [DateTime]::UtcNow
    $client = Start-Process -FilePath $exe -WorkingDirectory (Split-Path $exe) -WindowStyle Normal -PassThru
    $binary = [IO.File]::ReadAllBytes($exe)
    $pe = [BitConverter]::ToInt32($binary,60)
    $subsystem = [BitConverter]::ToUInt16($binary,$pe+24+68)
    $record = [ordered]@{ run=$Run; mode='direct Start-Process GUI executable; no driver or added browser flags'; sourceHead=(& git rev-parse HEAD); exeSha256=(Get-FileHash -LiteralPath $exe -Algorithm SHA256).Hash; peSubsystem=$subsystem; clientPid=$client.Id; parentPid=$PID; startedAt=$started.ToString('o'); webviewOverrideNames=$overrideNames; observationSeconds=$Seconds }
    $record | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $evidence 'launch.json')
    Start-Sleep -Seconds $Seconds
    $client.Refresh()
    if ($client.HasExited) { throw 'Client exited unexpectedly' }
    $record.mainWindowTitle = $client.MainWindowTitle
    $record.requestedClose = $client.CloseMainWindow()
    $record.exitedAfterClose = $client.WaitForExit(10000)
    $record.completedAt = [DateTime]::UtcNow.ToString('o')
    $record | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $evidence 'launch.json')
    if (!$record.exitedAfterClose) { throw 'Client did not exit after WM_CLOSE' }
} finally {
    if ($client -and !$client.HasExited) { Stop-Process -Id $client.Id }
    [IO.File]::WriteAllText((Join-Path $observerPath 'stop-observer'),'stop')
    if (!$observer.WaitForExit(10000)) { Stop-Process -Id $observer.Id }
}
Get-Content -LiteralPath (Join-Path $observerPath 'window-summary.json')
