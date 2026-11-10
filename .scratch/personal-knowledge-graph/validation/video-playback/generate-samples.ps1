$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
$sampleDir = Join-Path $PSScriptRoot '.local/samples'
$evidenceDir = Join-Path $PSScriptRoot 'evidence'
New-Item -ItemType Directory -Force -Path $sampleDir, $evidenceDir | Out-Null
$drive = [System.IO.DriveInfo]::new([System.IO.Path]::GetPathRoot($sampleDir))
if ($drive.AvailableFreeSpace -lt 8GB) { throw 'At least 8 GiB free space is required for synthetic media and faststart temporary output' }
$versionLines = & ffmpeg -hide_banner -version
if ($LASTEXITCODE -ne 0) { throw 'ffmpeg is required' }
$version = $versionLines[0]
$definitions = @(
    @{ id = 'h264-aac'; name = 'issue-13-h264-aac.mp4'; seconds = 720; video = @('-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '10', '-pix_fmt', 'yuv420p', '-g', '60'); audio = @('-c:a', 'aac', '-b:a', '128k'); container = @('-movflags', '+faststart') },
    @{ id = 'vp9-opus'; name = 'issue-13-vp9-opus.webm'; seconds = 12; video = @('-c:v', 'libvpx-vp9', '-deadline', 'realtime', '-cpu-used', '8', '-b:v', '1M', '-pix_fmt', 'yuv420p', '-g', '60'); audio = @('-c:a', 'libopus', '-b:a', '96k'); container = @() },
    @{ id = 'ffv1-pcm'; name = 'issue-13-ffv1-pcm.mkv'; seconds = 6; video = @('-c:v', 'ffv1', '-level', '3', '-pix_fmt', 'yuv420p', '-g', '1'); audio = @('-c:a', 'pcm_s16le'); container = @() }
)
$records = @()
foreach ($definition in $definitions) {
    $destination = Join-Path $sampleDir $definition.name
    if (Test-Path -LiteralPath $destination) { throw "Sample already exists; preserve it or choose a fresh directory before regeneration: $($definition.name)" }
    $arguments = @('-hide_banner', '-nostdin', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=1280x720:rate=30', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000', '-t', [string]$definition.seconds) + $definition.video + $definition.audio + $definition.container + @($destination)
    $started = [DateTimeOffset]::UtcNow
    & ffmpeg @arguments 2> (Join-Path $sampleDir ($definition.id + '-encode.txt'))
    if ($LASTEXITCODE -ne 0) { throw "Encoding failed: $($definition.id)" }
    $elapsed = ([DateTimeOffset]::UtcNow - $started).TotalSeconds
    $probeText = & ffprobe -v error -show_format -show_streams -of json $destination
    if ($LASTEXITCODE -ne 0) { throw "ffprobe failed: $($definition.id)" }
    $probe = ($probeText -join "`n") | ConvertFrom-Json
    $packetSizes = & ffprobe -v error -show_entries packet=size -of csv=p=0 $destination
    if ($LASTEXITCODE -ne 0) { throw "Packet size inspection failed: $($definition.id)" }
    $payloadBytes = ($packetSizes | ForEach-Object { [long]$_.Trim(',') } | Measure-Object -Sum).Sum
    $decodeChecks = @()
    foreach ($second in @(0, [int]($definition.seconds / 2), ($definition.seconds - 2))) {
        & ffmpeg -hide_banner -nostdin -v error -ss $second -i $destination -t 1 -map 0:v:0 -map 0:a:0 -f null - 2> (Join-Path $sampleDir ($definition.id + '-decode-' + $second + '.txt'))
        if ($LASTEXITCODE -ne 0) { throw "Actual audio/video decode failed for $($definition.id) at $second seconds" }
        $decodeChecks += @{ seekSeconds = $second; decodedSeconds = 1; audioAndVideo = 'PASS' }
    }
    $file = Get-Item -LiteralPath $destination
    if ($definition.id -eq 'h264-aac' -and ($file.Length -lt 1000000000 -or $file.Length -gt 2000000000)) { throw "Main encoded video must be 1–2 GB; actual $($file.Length) bytes" }
    if ($payloadBytes -lt $file.Length * 0.98) { throw 'Encoded audio/video packets must account for at least 98 percent of each file' }
    $records += [ordered]@{
        id = $definition.id; file = '.local/samples/' + $definition.name; bytes = $file.Length
        sha256 = (Get-FileHash -LiteralPath $destination -Algorithm SHA256).Hash.ToLowerInvariant()
        encodedPacketBytes = $payloadBytes; generatedAt = $started.ToString('o'); encodeElapsedSeconds = $elapsed
        decodeChecks = $decodeChecks
        command = @('ffmpeg') + ($arguments | ForEach-Object { if ($_ -eq $destination) { '.local/samples/' + $definition.name } else { $_ } })
        ffprobe = $probe
    }
    Write-Output "$($definition.id): $($file.Length) bytes; encoded packets $payloadBytes; $elapsed seconds"
}
[ordered]@{
    version = 1; ffmpeg = $version; purpose = 'Issue 13 non-sensitive synthetic moving test pattern and sine wave; original generated media, no user content'
    storage = 'Ignored local files; files are actual encoded media, not sparse/padded placeholders; x264 CRF does not request constant bitrate filler'
    freeSpaceBefore = $drive.AvailableFreeSpace; samples = $records
} | ConvertTo-Json -Depth 30 | Set-Content -LiteralPath (Join-Path $evidenceDir 'samples.json') -Encoding utf8
