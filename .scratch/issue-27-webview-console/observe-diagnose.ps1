param(
    [Parameter(Mandatory=$true)][string]$Run,
    [string]$Mode='launch', [string]$Scenario='launch-only', [string]$Steps='all',
    [string]$ExcludeSwitches='', [string]$BrowserArguments='', [int]$Hold=10
)
$ErrorActionPreference='Stop'
$repo=(Get-Location).Path
$evidence=Join-Path $PSScriptRoot "evidence/$Run"
if(Test-Path -LiteralPath $evidence){throw 'Choose a unique run'}
New-Item -ItemType Directory -Path $evidence | Out-Null
$observerPath=Join-Path $evidence 'observer'
$script=Join-Path $PSScriptRoot 'observe-webview-windows.ps1'
$observer=Start-Process pwsh.exe -WindowStyle Hidden -ArgumentList @('-NoProfile','-File',('"'+$script+'"'),'-RunDirectory',('"'+$observerPath+'"'),'-RootPid',"$PID",'-MaxSeconds','180') -PassThru -RedirectStandardOutput (Join-Path $evidence 'observer-stdout.txt') -RedirectStandardError (Join-Path $evidence 'observer-stderr.txt')
$harnessExit=1
try{
    $deadline=[DateTime]::UtcNow.AddSeconds(10)
    while(!(Test-Path -LiteralPath (Join-Path $observerPath 'windows.jsonl'))){if([DateTime]::UtcNow -gt $deadline){throw 'Observer failed to initialize'};Start-Sleep -Milliseconds 100}
    $arguments=@((Join-Path $PSScriptRoot 'diagnose-launch.mjs'),"--exe=$(Join-Path $repo 'app/dist-desktop/noterion.exe')","--driver=$(Join-Path $PSScriptRoot 'local/tools/msedgedriver.exe')","--output=$(Join-Path $evidence 'client')","--mode=$Mode","--scenario=$Scenario","--steps=$Steps","--hold=$Hold")
    if($ExcludeSwitches){$arguments+="--exclude-switches=$ExcludeSwitches"}
    if($BrowserArguments){$arguments+="--browser-args=$BrowserArguments"}
    & node @arguments
    $harnessExit=$LASTEXITCODE
}finally{
    [IO.File]::WriteAllText((Join-Path $observerPath 'stop-observer'),'stop')
    if(!$observer.WaitForExit(10000)){Stop-Process -Id $observer.Id}
}
Get-Content -LiteralPath (Join-Path $observerPath 'window-summary.json')
if($harnessExit -ne 0){exit $harnessExit}
exit $observer.ExitCode
