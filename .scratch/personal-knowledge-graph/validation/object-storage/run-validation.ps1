param([string]$Phase = 'probe')
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
$env:CARGO_HOME = Join-Path $PSScriptRoot '.local/cargo-home'
$env:CARGO_HTTP_MULTIPLEXING = 'false'
$env:CARGO_HTTP_TIMEOUT = '30'
$proxyUri = [System.Net.WebRequest]::DefaultWebProxy.GetProxy([uri]'https://index.crates.io')
if ($proxyUri.Host -ne 'index.crates.io') { $env:CARGO_HTTP_PROXY = $proxyUri.AbsoluteUri }
$serviceEnv = Join-Path $PSScriptRoot '.local/service.env'
Get-Content -LiteralPath $serviceEnv | ForEach-Object {
    $parts = $_.Split('=', 2)
    if ($parts[0] -eq 'RUSTFS_ACCESS_KEY') { $env:ISSUE10_ACCESS_KEY = $parts[1] }
    if ($parts[0] -eq 'RUSTFS_SECRET_KEY') { $env:ISSUE10_SECRET_KEY = $parts[1] }
}
try {
    cargo run --locked -- $Phase
    if ($LASTEXITCODE -ne 0) { throw "Validation phase $Phase failed (exit $LASTEXITCODE)" }
} finally {
    Remove-Item Env:ISSUE10_ACCESS_KEY -ErrorAction SilentlyContinue
    Remove-Item Env:ISSUE10_SECRET_KEY -ErrorAction SilentlyContinue
}
