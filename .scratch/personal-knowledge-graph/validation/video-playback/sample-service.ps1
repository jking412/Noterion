param(
    [ValidateRange(1, 600)][int]$Seconds = 60,
    [ValidateRange(1, 60)][int]$IntervalSeconds = 1,
    [ValidatePattern('^[a-zA-Z0-9-]+$')][string]$Phase = 'playback',
    [string]$OutputFile = (Join-Path $PSScriptRoot 'evidence/service-resources.jsonl')
)
$ErrorActionPreference = 'Stop'
$container = 'issue-13-rustfs'
$owner = docker inspect --format '{{index .Config.Labels "noterion.issue"}}' $container
if ($LASTEXITCODE -ne 0 -or $owner -ne '13') { throw 'Sampling requires the existing Issue 13 container with its ownership label' }
$outputPath = [System.IO.Path]::GetFullPath($OutputFile)
$evidenceRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot 'evidence')) + [System.IO.Path]::DirectorySeparatorChar
if (!$outputPath.StartsWith($evidenceRoot, [System.StringComparison]::OrdinalIgnoreCase)) { throw 'Resource evidence output must remain in this validation evidence directory' }
New-Item -ItemType Directory -Force -Path (Split-Path -Parent $outputPath) | Out-Null
$clock = [System.Diagnostics.Stopwatch]::StartNew()
$count = 0
while ($clock.Elapsed.TotalSeconds -lt $Seconds) {
    $sampleStart = [DateTimeOffset]::UtcNow
    $cycleStart = $clock.Elapsed.TotalSeconds
    $raw = docker stats --no-stream --format '{{json .}}' $container
    if ($LASTEXITCODE -ne 0) { throw 'Docker stats failed for Issue 13 container' }
    $stats = $raw | ConvertFrom-Json
    if ($stats.Name -ne $container) { throw 'Docker stats returned an unexpected container' }
    $record = [ordered]@{
        at = $sampleStart.ToString('o'); collectedAt = [DateTimeOffset]::UtcNow.ToString('o')
        phase = $Phase; sample = $count; elapsedSeconds = [Math]::Round($clock.Elapsed.TotalSeconds, 3)
        samplerPid = $PID; samplerScript = $PSCommandPath; requestedDurationSeconds = $Seconds
        targetIntervalSeconds = $IntervalSeconds; container = $container
        cpuPercent = $stats.CPUPerc; memoryUsageAndLimit = $stats.MemUsage; memoryPercent = $stats.MemPerc
        networkInputOutput = $stats.NetIO; blockInputOutput = $stats.BlockIO; pids = $stats.PIDs
        units = 'Docker CLI display units preserved: percent; SI kB/MB/GB or binary KiB/MiB/GiB; input / output; memory used / limit. Counters are cumulative per container, not per request.'
    }
    ($record | ConvertTo-Json -Compress) | Add-Content -LiteralPath $outputPath -Encoding utf8
    $count += 1
    $remaining = $IntervalSeconds - ($clock.Elapsed.TotalSeconds - $cycleStart)
    if ($remaining -gt 0) { Start-Sleep -Milliseconds ([int]($remaining * 1000)) }
}
Write-Output "Recorded $count samples for $container, phase=$Phase; target interval $IntervalSeconds second(s), actual Docker CLI latency retained in timestamps"
