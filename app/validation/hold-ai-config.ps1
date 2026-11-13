param([Parameter(Mandatory=$true)][string]$RunDirectory)
$ErrorActionPreference = 'Stop'
$runRoot = [IO.Path]::GetFullPath($RunDirectory)
$configPath = Join-Path $runRoot 'config/deepseek.json'
$readyPath = Join-Path $runRoot 'config-lock-ready'
$stopPath = Join-Path $runRoot 'config-lock-stop'
# A read/share-read handle permits settings reads but prevents atomic replacement.
# Only the isolated acceptance run's non-secret configuration file is opened.
$stream = [IO.File]::Open($configPath, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::Read)
try {
    [IO.File]::WriteAllText($readyPath, 'LOCKED')
    $deadline = [DateTime]::UtcNow.AddMinutes(2)
    while (!(Test-Path -LiteralPath $stopPath) -and [DateTime]::UtcNow -lt $deadline) {
        Start-Sleep -Milliseconds 100
    }
} finally { $stream.Dispose() }
