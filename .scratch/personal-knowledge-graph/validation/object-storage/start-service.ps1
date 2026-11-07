param([switch]$Restart)
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
$container = 'issue-10-rustfs'
$volume = 'issue-10-object-storage-data'
$image = 'rustfs/rustfs:1.0.4@sha256:ed9210d6411d77ffceb70d94b964a3cb7d225983368bc25bebe01e995293dcc2'
$localDir = Join-Path $PSScriptRoot '.local'
New-Item -ItemType Directory -Force -Path $localDir | Out-Null
$credentialsPath = Join-Path $localDir 'service.env'
$existing = docker ps -a --filter "name=^/$container$" --format '{{.Names}}'
if ($LASTEXITCODE -ne 0) { throw 'Docker inventory failed' }
if ($existing -and !(Test-Path -LiteralPath $credentialsPath)) {
    throw 'Existing Issue 10 container has no local credential file; do not generate mismatched credentials'
}
if (!(Test-Path -LiteralPath $credentialsPath)) {
    $random = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    $keyBytes = New-Object byte[] 16
    $secretBytes = New-Object byte[] 32
    $random.GetBytes($keyBytes)
    $random.GetBytes($secretBytes)
    $random.Dispose()
    $access = 'issue10' + ([BitConverter]::ToString($keyBytes)).Replace('-', '').ToLowerInvariant()
    $secret = ([BitConverter]::ToString($secretBytes)).Replace('-', '').ToLowerInvariant()
    @("RUSTFS_ACCESS_KEY=$access", "RUSTFS_SECRET_KEY=$secret") | Set-Content -LiteralPath $credentialsPath -Encoding ascii
}
if ($existing) {
    $owner = docker inspect --format '{{index .Config.Labels "noterion.issue"}}' $container
    if ($owner -ne '10') { throw 'Existing container ownership does not match Issue 10' }
    if ($Restart) { docker restart $container | Out-Null }
    else { docker start $container | Out-Null }
} else {
    $listener = Get-NetTCPConnection -LocalPort 19100 -State Listen -ErrorAction SilentlyContinue
    if ($listener) { throw 'Port 19100 is already occupied' }
    $existingVolume = docker volume ls --filter "name=^$volume$" --format '{{.Name}}'
    if ($LASTEXITCODE -ne 0) { throw 'Volume inventory failed' }
    if ($existingVolume) {
        $volumeOwner = docker volume inspect --format '{{index .Labels "noterion.issue"}}' $volume
        if ($volumeOwner -ne '10') { throw 'Existing volume ownership does not match Issue 10' }
    }
    docker volume create --label noterion.issue=10 $volume | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Volume creation failed' }
    docker run -d --name $container --label noterion.issue=10 --restart no -p '127.0.0.1:19100:9000' --mount "type=volume,source=$volume,target=/data" --env-file $credentialsPath -e 'RUSTFS_CONSOLE_ENABLE=false' -e 'RUSTFS_OBS_LOGGER_LEVEL=error' $image /data | Out-Null
}
if ($LASTEXITCODE -ne 0) { throw 'RustFS startup failed' }
Write-Output 'Issue 10 RustFS started at http://127.0.0.1:19100; credentials remain in ignored .local/service.env'
