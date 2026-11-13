param([int]$RootPid, [int]$ClientPid, [string]$RunDirectory, [string]$OutputFile)
$ErrorActionPreference = 'Stop'
while (!(Test-Path -LiteralPath (Join-Path $RunDirectory 'stop-sampler'))) {
    $all = @(Get-CimInstance Win32_Process | Select-Object ProcessId, ParentProcessId, Name, WorkingSetSize, PrivatePageCount, ReadTransferCount, WriteTransferCount, KernelModeTime, UserModeTime)
    $ids = [System.Collections.Generic.HashSet[int]]::new()
    [void]$ids.Add($RootPid)
    [void]$ids.Add($ClientPid)
    do {
        $changed = $false
        foreach ($process in $all) {
            if ($ids.Contains([int]$process.ParentProcessId) -and $ids.Add([int]$process.ProcessId)) { $changed = $true }
        }
    } while ($changed)
    $owned = @($all | Where-Object { $ids.Contains([int]$_.ProcessId) })
    $disk = @(Get-ChildItem -LiteralPath $RunDirectory -Recurse -File -ErrorAction SilentlyContinue | Measure-Object -Property Length -Sum)[0].Sum
    [ordered]@{ at = [DateTime]::UtcNow.ToString('o'); rootPid = $RootPid; processes = $owned; runDiskBytes = $disk } | ConvertTo-Json -Depth 5 -Compress | Add-Content -LiteralPath $OutputFile -Encoding utf8
    Start-Sleep -Milliseconds 500
}
