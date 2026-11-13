param(
    [Parameter(Mandatory = $true)][string]$RunDirectory,
    [int]$RootPid = 0,
    [ValidateRange(1, 86400)][int]$MaxSeconds = 120,
    [ValidateRange(25, 1000)][int]$PollMilliseconds = 100
)
$ErrorActionPreference = 'Stop'

# Read-only desktop observer. No application is launched, attached, hidden or killed.
# Stop by creating <RunDirectory>/stop-observer. Each output directory is immutable.
$runPath = [IO.Path]::GetFullPath($RunDirectory)
[void][IO.Directory]::CreateDirectory($runPath)
$eventsPath = Join-Path $runPath 'windows.jsonl'
$summaryPath = Join-Path $runPath 'window-summary.json'
if ((Test-Path -LiteralPath $eventsPath) -or (Test-Path -LiteralPath $summaryPath)) {
    throw 'Observer output exists; choose a new run directory.'
}

$compilerPath = Join-Path $runPath 'compiler-temp'
[void][IO.Directory]::CreateDirectory($compilerPath)
$previousTemp = $env:TEMP
$previousTmp = $env:TMP
$env:TEMP = $compilerPath
$env:TMP = $compilerPath
try {
Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
namespace NoterionValidation {
    public class DesktopWindow {
        public string Handle;
        public uint ProcessId;
        public string ClassName;
        public string Title;
    }
    public static class DesktopObserver {
        private delegate bool EnumWindowProc(IntPtr window, IntPtr parameter);
        [DllImport("user32.dll")] private static extern bool EnumWindows(EnumWindowProc callback, IntPtr parameter);
        [DllImport("user32.dll")] private static extern bool IsWindowVisible(IntPtr window);
        [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern int GetWindowText(IntPtr window, StringBuilder text, int length);
        [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern int GetClassName(IntPtr window, StringBuilder text, int length);
        [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr window, out uint processId);
        [DllImport("user32.dll")] private static extern IntPtr GetForegroundWindow();
        private static DesktopWindow Read(IntPtr window) {
            uint processId;
            GetWindowThreadProcessId(window, out processId);
            var title = new StringBuilder(4096);
            var className = new StringBuilder(256);
            GetWindowText(window, title, title.Capacity);
            GetClassName(window, className, className.Capacity);
            return new DesktopWindow { Handle = "0x" + window.ToInt64().ToString("x"), ProcessId = processId, ClassName = className.ToString(), Title = title.ToString() };
        }
        public static DesktopWindow[] VisibleWindows() {
            var windows = new List<DesktopWindow>();
            EnumWindows((window, parameter) => { if (IsWindowVisible(window)) windows.Add(Read(window)); return true; }, IntPtr.Zero);
            return windows.ToArray();
        }
        public static DesktopWindow Foreground() { return Read(GetForegroundWindow()); }
    }
}
'@
} finally {
    $env:TEMP = $previousTemp
    $env:TMP = $previousTmp
}

function Protect-Text([string]$Value) {
    if ($null -eq $Value) { return $null }
    $result = $Value.Replace($runPath, '<RUN>')
    if ($env:USERPROFILE) { $result = $result.Replace($env:USERPROFILE, '<USERPROFILE>') }
    # Preserve flags useful for diagnosis while omitting credentials and user directory names.
    $result = [regex]::Replace($result, '(?i)([a-z]:[\\/]Users[\\/])[^\\/\s"]+', '$1<USER>')
    $result = [regex]::Replace($result, '(?i)((?:--?|/)(?:api[-_]?key|token|password|secret|authorization)(?:=|\s+))(?:"[^"]*"|\S+)', '$1<REDACTED>')
    $result = [regex]::Replace($result, '(?i)(https?://)[^\s/@:]+:[^\s/@]+@', '$1<REDACTED>@')
    return $result
}

$writer = [IO.StreamWriter]::new($eventsPath, $false, [Text.UTF8Encoding]::new($false))
$writer.AutoFlush = $true
function Write-Event($Record) {
    $writer.WriteLine(($Record | ConvertTo-Json -Depth 8 -Compress))
}
$knownProcesses = @{}
$ownedIds = [Collections.Generic.HashSet[int]]::new()
if ($RootPid -gt 0) { [void]$ownedIds.Add($RootPid) }
$previousWindows = @{}
$previousForeground = ''
$symptoms = @{}
$foregroundChanges = 0
$processSamples = 0
$windowSamples = 0
$maximumWindowGapMs = 0.0
$lastWindowSampleMs = 0.0
$started = [DateTime]::UtcNow
$timer = [Diagnostics.Stopwatch]::StartNew()
$nextProcesses = 0.0
$processQuery = [powershell]::Create()
[void]$processQuery.AddScript('Get-CimInstance Win32_Process -ErrorAction Stop | Select-Object ProcessId, ParentProcessId, Name, ExecutablePath, CommandLine, CreationDate')
$pendingProcesses = $null
$errorMessage = $null

function Read-Window($Window) {
    $process = $knownProcesses[[int]$Window.ProcessId]
    $relevant = $Window.ClassName -eq 'ConsoleWindowClass' -or $Window.Title -match '(?i)noterion|msedgewebview2' -or ($process -and $process.Name -match '^(?i:noterion|msedgewebview2|msedgedriver|conhost|OpenConsole)\.exe$')
    [ordered]@{
        handle = $Window.Handle
        pid = [int]$Window.ProcessId
        className = $Window.ClassName
        title = $(if ($relevant) { Protect-Text $Window.Title } else { '<OTHER_WINDOW>' })
        relevant = [bool]$relevant
        processName = $(if ($process) { $process.Name } else { $null })
        associatedWithRoot = $(if ($RootPid -gt 0) { $ownedIds.Contains([int]$Window.ProcessId) } else { $null })
        webviewConsole = $Window.ClassName -eq 'ConsoleWindowClass' -and $Window.Title -match '(?i)msedgewebview2\.exe'
    }
}

try {
    Write-Event ([ordered]@{ event = 'observer-started'; at = $started.ToString('o'); observerPid = $PID; rootPid = $RootPid; pollMilliseconds = $PollMilliseconds; processPollMilliseconds = 1000; maxSeconds = $MaxSeconds; scope = 'Visible top-level windows and foreground changes. Unrelated titles are redacted. Relevant process snapshots are read-only.' })
    while ($timer.Elapsed.TotalSeconds -lt $MaxSeconds -and !(Test-Path -LiteralPath (Join-Path $runPath 'stop-observer'))) {
        $iterationStartedMs = $timer.Elapsed.TotalMilliseconds
        $at = [DateTime]::UtcNow.ToString('o')
        # CIM can take longer than one window polling interval. Query it on a
        # separate runspace so process inspection cannot stall EnumWindows.
        if ($null -eq $pendingProcesses -and $timer.Elapsed.TotalMilliseconds -ge $nextProcesses) {
            $processQuery.Streams.Error.Clear()
            $pendingProcesses = $processQuery.BeginInvoke()
            $nextProcesses = $timer.Elapsed.TotalMilliseconds + 1000
        }
        if ($null -ne $pendingProcesses -and $pendingProcesses.IsCompleted) {
            $all = @($processQuery.EndInvoke($pendingProcesses))
            $pendingProcesses = $null
            if ($processQuery.Streams.Error.Count -gt 0) { throw $processQuery.Streams.Error[0] }
            $byId = @{}
            foreach ($process in $all) { $byId[[int]$process.ProcessId] = $process }
            do {
                $changed = $false
                foreach ($process in $all) {
                    if ($ownedIds.Contains([int]$process.ParentProcessId) -and $ownedIds.Add([int]$process.ProcessId)) { $changed = $true }
                }
            } while ($changed)
            $selected = [Collections.Generic.HashSet[int]]::new()
            foreach ($process in $all) {
                if ($ownedIds.Contains([int]$process.ProcessId) -or $process.Name -match '^(?i:noterion|msedgewebview2|msedgedriver|conhost|OpenConsole)\.exe$') {
                    [void]$selected.Add([int]$process.ProcessId)
                    $parentId = [int]$process.ParentProcessId
                    while ($byId.ContainsKey($parentId) -and $selected.Add($parentId)) { $parentId = [int]$byId[$parentId].ParentProcessId }
                }
            }
            $observations = @($all | Where-Object { $selected.Contains([int]$_.ProcessId) } | ForEach-Object {
                $knownProcesses[[int]$_.ProcessId] = $_
                $isRelevant = $ownedIds.Contains([int]$_.ProcessId) -or $_.Name -match '^(?i:noterion|msedgewebview2|msedgedriver|conhost|OpenConsole)\.exe$'
                [ordered]@{ pid = [int]$_.ProcessId; parentPid = [int]$_.ParentProcessId; name = $_.Name; executablePath = Protect-Text $_.ExecutablePath; commandLine = $(if ($isRelevant) { Protect-Text $_.CommandLine } else { '<ANCESTOR_COMMAND_LINE_REDACTED>' }); createdAt = $(if ($_.CreationDate) { $_.CreationDate.ToUniversalTime().ToString('o') } else { $null }); associatedWithRoot = $(if ($RootPid -gt 0) { $ownedIds.Contains([int]$_.ProcessId) } else { $null }) }
            })
            Write-Event ([ordered]@{ event = 'process-snapshot'; at = $at; processes = $observations })
            $processSamples++
        }
        if ($windowSamples -gt 0) { $maximumWindowGapMs = [Math]::Max($maximumWindowGapMs, $timer.Elapsed.TotalMilliseconds - $lastWindowSampleMs) }
        $lastWindowSampleMs = $timer.Elapsed.TotalMilliseconds
        $currentWindows = @{}
        foreach ($window in [NoterionValidation.DesktopObserver]::VisibleWindows()) {
            $record = Read-Window $window
            if (!$record.relevant) { continue }
            $serialized = $record | ConvertTo-Json -Compress
            $currentWindows[$window.Handle] = $serialized
            if (!$previousWindows.ContainsKey($window.Handle) -or $previousWindows[$window.Handle] -ne $serialized) {
                Write-Event ([ordered]@{ event = $(if ($previousWindows.ContainsKey($window.Handle)) { 'window-changed' } else { 'window-visible' }); at = $at; window = $record })
            }
            if ($record.webviewConsole) {
                if (!$symptoms.ContainsKey($window.Handle)) {
                    $symptoms[$window.Handle] = [ordered]@{ firstSeenAt = $at; lastSeenAt = $at; samples = 0; window = $record }
                    Write-Event ([ordered]@{ event = 'webview-console-observed'; at = $at; window = $record })
                }
                $symptoms[$window.Handle].lastSeenAt = $at
                $symptoms[$window.Handle].samples++
                $symptoms[$window.Handle].window = $record
            }
        }
        foreach ($handle in $previousWindows.Keys) {
            if (!$currentWindows.ContainsKey($handle)) { Write-Event ([ordered]@{ event = 'window-no-longer-visible'; at = $at; handle = $handle }) }
        }
        $previousWindows = $currentWindows
        $foreground = Read-Window ([NoterionValidation.DesktopObserver]::Foreground())
        $foregroundKey = $foreground | ConvertTo-Json -Compress
        if ($foregroundKey -ne $previousForeground) {
            Write-Event ([ordered]@{ event = 'foreground-changed'; at = $at; window = $foreground })
            $foregroundChanges++
            $previousForeground = $foregroundKey
        }
        $windowSamples++
        $remainingMs = $PollMilliseconds - ($timer.Elapsed.TotalMilliseconds - $iterationStartedMs)
        if ($remainingMs -gt 0) { Start-Sleep -Milliseconds ([int][Math]::Ceiling($remainingMs)) }
    }
} catch {
    $errorMessage = Protect-Text $_.Exception.Message
    Write-Event ([ordered]@{ event = 'observer-error'; at = [DateTime]::UtcNow.ToString('o'); message = $errorMessage })
} finally {
    $timer.Stop()
    if ($null -ne $pendingProcesses) { $processQuery.Stop() }
    $processQuery.Dispose()
    $ownedSymptoms = @($symptoms.Values | Where-Object { $_.window.associatedWithRoot })
    $summary = [ordered]@{
        startedAt = $started.ToString('o')
        endedAt = [DateTime]::UtcNow.ToString('o')
        elapsedSeconds = [Math]::Round($timer.Elapsed.TotalSeconds, 3)
        rootPid = $RootPid
        windowSamples = $windowSamples
        maximumWindowSampleGapMilliseconds = [Math]::Round($maximumWindowGapMs, 3)
        processSamples = $processSamples
        foregroundChanges = $foregroundChanges
        observedWebviewConsoles = @($symptoms.Values)
        observedWebviewConsoleCount = $symptoms.Count
        rootAssociatedWebviewConsoleCount = $ownedSymptoms.Count
        verdict = $(if ($errorMessage) { 'ERROR' } elseif ($symptoms.Count -gt 0 -and ($RootPid -eq 0 -or $ownedSymptoms.Count -gt 0)) { 'FAIL' } elseif ($symptoms.Count -gt 0) { 'UNATTRIBUTED_CONSOLE' } else { 'NO_CONSOLE_OBSERVED' })
        error = $errorMessage
        limits = 'Window sampling is periodic, not an event trace; windows shorter than the sample interval may be missed. Console ownership can belong to conhost/OpenConsole and root attribution requires matching process ancestry. NO_CONSOLE_OBSERVED is only an observation bound, not proof of a fix. Foreground changes include legitimate user interaction. No console attachment or state changes are made.'
    }
    Write-Event ([ordered]@{ event = 'observer-stopped'; at = $summary.endedAt; verdict = $summary.verdict })
    $writer.Dispose()
    [IO.File]::WriteAllText($summaryPath, ($summary | ConvertTo-Json -Depth 8) + [Environment]::NewLine, [Text.UTF8Encoding]::new($false))
    $summary | ConvertTo-Json -Depth 8
}
if ($errorMessage) { exit 1 }
if ($summary.verdict -eq 'FAIL') { exit 2 }
if ($summary.verdict -eq 'UNATTRIBUTED_CONSOLE') { exit 3 }
