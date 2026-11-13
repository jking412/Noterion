$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
$container = 'issue-13-rustfs'
$volume = 'issue-13-object-storage-data'
$image = 'rustfs/rustfs:1.0.4@sha256:ed9210d6411d77ffceb70d94b964a3cb7d225983368bc25bebe01e995293dcc2'
$endpoint = 'http://127.0.0.1:19300'
$localDir = Join-Path $PSScriptRoot '.local'
$evidenceDir = Join-Path $PSScriptRoot 'evidence'
New-Item -ItemType Directory -Force -Path $localDir, $evidenceDir | Out-Null
$credentialsPath = Join-Path $localDir 'service.env'
$existing = docker ps -a --filter "name=^/$container$" --format '{{.Names}}'
if ($LASTEXITCODE -ne 0) { throw 'Docker Engine is unavailable; start the installed Docker Desktop and retry' }
$expectedImage = docker image inspect $image --format '{{.Id}}'
if ($LASTEXITCODE -ne 0) { throw 'Pinned reference image is not cached; do not silently select another RustFS version' }
if ($existing) {
    if (!(Test-Path -LiteralPath $credentialsPath)) { throw 'Existing Issue 13 container has no matching local credential file' }
    $owner = docker inspect --format '{{index .Config.Labels "noterion.issue"}}' $container
    if ($owner -ne '13') { throw 'Container ownership is not Issue 13' }
    $actualImage = docker inspect --format '{{.Image}}' $container
    if ($actualImage -ne $expectedImage) { throw 'Existing container does not use pinned RustFS image' }
    $bindings = docker inspect --format '{{json .HostConfig.PortBindings}}' $container | ConvertFrom-Json
    $apiBindings = @($bindings.'9000/tcp')
    if ($apiBindings.Count -ne 1 -or $apiBindings[0].HostIp -ne '127.0.0.1' -or $apiBindings[0].HostPort -ne '19300' -or @($bindings.PSObject.Properties).Count -ne 1) { throw 'Existing container is not isolated to the expected loopback port' }
    $mounts = @(docker inspect --format '{{json .Mounts}}' $container | ConvertFrom-Json)
    $data = @($mounts | Where-Object { $_.Destination -eq '/data' -and $_.Type -eq 'volume' -and $_.Name -eq $volume -and $_.RW })
    if ($data.Count -ne 1) { throw 'Existing container does not use Issue 13 data volume' }
    docker start $container | Out-Null
} else {
    $listener = Get-NetTCPConnection -LocalPort 19300 -State Listen -ErrorAction SilentlyContinue
    if ($listener) { throw 'Port 19300 is occupied; preserve the existing listener' }
    $existingVolume = docker volume ls --filter "name=^$volume$" --format '{{.Name}}'
    if ($LASTEXITCODE -ne 0) { throw 'Volume inventory failed' }
    if ($existingVolume) {
        $volumeOwner = docker volume inspect --format '{{index .Labels "noterion.issue"}}' $volume
        if ($volumeOwner -ne '13') { throw 'Volume ownership is not Issue 13' }
    }
    if (!(Test-Path -LiteralPath $credentialsPath)) {
        $random = [System.Security.Cryptography.RandomNumberGenerator]::Create()
        $keyBytes = New-Object byte[] 16
        $secretBytes = New-Object byte[] 32
        $random.GetBytes($keyBytes)
        $random.GetBytes($secretBytes)
        $random.Dispose()
        $access = 'issue13' + ([BitConverter]::ToString($keyBytes)).Replace('-', '').ToLowerInvariant()
        $secret = ([BitConverter]::ToString($secretBytes)).Replace('-', '').ToLowerInvariant()
        @("RUSTFS_ACCESS_KEY=$access", "RUSTFS_SECRET_KEY=$secret") | Set-Content -LiteralPath $credentialsPath -Encoding ascii
    }
    docker volume create --label noterion.issue=13 $volume | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Volume creation failed' }
    docker run -d --name $container --label noterion.issue=13 --restart no -p '127.0.0.1:19300:9000' --mount "type=volume,source=$volume,target=/data" --env-file $credentialsPath -e 'RUSTFS_CONSOLE_ENABLE=false' -e 'RUSTFS_OBS_LOGGER_LEVEL=error' -e 'RUSTFS_CORS_ALLOWED_ORIGINS=http://tauri.localhost' $image /data | Out-Null
}
if ($LASTEXITCODE -ne 0) { throw 'RustFS startup failed' }
$deadline = [DateTimeOffset]::UtcNow.AddSeconds(45)
$ready = $false
while ([DateTimeOffset]::UtcNow -lt $deadline) {
    try {
        $response = Invoke-WebRequest -Uri "$endpoint/health" -TimeoutSec 3
        if ($response.StatusCode -eq 200) { $ready = $true; break }
    } catch { Start-Sleep -Milliseconds 500 }
}
$record = [ordered]@{
    at = [DateTimeOffset]::UtcNow.ToString('o'); owner = 'issue-13'; container = $container; volume = $volume
    image = $image; imageId = $expectedImage; endpoint = $endpoint; healthReady = $ready
    origin = 'http://tauri.localhost'; credentials = 'Random local trial credentials in ignored .local/service.env; values intentionally omitted'
}
$record | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $evidenceDir 'service-environment.json') -Encoding utf8
if (!$ready) { throw 'RustFS did not return healthy within 45 seconds; signed API readiness must also be checked by validation host' }
Write-Output 'Issue 13 RustFS is healthy at http://127.0.0.1:19300; existing unrelated services/data preserved'
