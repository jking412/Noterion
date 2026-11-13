$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
$image = docker inspect issue-10-rustfs --format '{{.Image}}'
if ($LASTEXITCODE -ne 0) { throw 'Cannot read running reference container image identity' }
$containerImageReference = docker inspect issue-10-rustfs --format '{{.Config.Image}}'
$dockerVersion = docker version --format '{{.Server.Version}}'
$environment = [ordered]@{
    captured_at_utc = [DateTime]::UtcNow.ToString('o')
    issue = 'https://github.com/jking412/Noterion/issues/10'
    baseline_commit = '69ce7671f75cad8997534a34319d67bf956d4669'
    platform = [System.Runtime.InteropServices.RuntimeInformation]::OSDescription
    architecture = [System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture.ToString()
    rustc = (rustc --version | Out-String).Trim()
    cargo = (cargo --version | Out-String).Trim()
    docker_server = $dockerVersion
    reference_image = 'rustfs/rustfs:1.0.4'
    image_id = $image
    container_image_reference = $containerImageReference
    sdk = 'aws-sdk-s3 =1.122.0'
    sdk_http_client = 'aws-smithy-http-client =1.1.13, Rustls/Ring'
    cargo_lock_sha256 = (Get-FileHash -LiteralPath Cargo.lock -Algorithm SHA256).Hash.ToLowerInvariant()
    endpoint = 'http://127.0.0.1:19100'
    region = 'us-east-1'
    force_path_style = $true
    bucket = 'issue-10-compatibility'
    prefix = 'issue-10/'
    container = 'issue-10-rustfs'
    volume = 'issue-10-object-storage-data'
    credential_values_recorded = $false
}
$environment | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath evidence/environment.json -Encoding utf8
Write-Output 'Captured public environment facts; credential values excluded'
