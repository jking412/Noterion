param(
    [Parameter(Mandatory = $true)]
    [string]$Destination
)
$ErrorActionPreference = 'Stop'
if ($env:OS -ne 'Windows_NT' -or -not [Environment]::Is64BitProcess) {
    throw 'WebView2 release smoke requires a Windows x64 PowerShell process.'
}

# The WebView2 Evergreen Runtime is distinct from the Edge browser. Discover its
# own registration in both machine views and the current user registration.
$clientKey = 'SOFTWARE\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}'
$locations = @(
    @{ Hive = [Microsoft.Win32.RegistryHive]::LocalMachine; View = [Microsoft.Win32.RegistryView]::Registry32; Label = 'HKLM32' },
    @{ Hive = [Microsoft.Win32.RegistryHive]::LocalMachine; View = [Microsoft.Win32.RegistryView]::Registry64; Label = 'HKLM64' },
    @{ Hive = [Microsoft.Win32.RegistryHive]::CurrentUser; View = [Microsoft.Win32.RegistryView]::Registry64; Label = 'HKCU64' }
)
$runtimes = @()
$discoveryErrors = @()
foreach ($location in $locations) {
    $baseKey = $null
    $key = $null
    try {
        $baseKey = [Microsoft.Win32.RegistryKey]::OpenBaseKey($location.Hive, $location.View)
        $key = $baseKey.OpenSubKey($clientKey)
        if ($null -eq $key) { continue }
        $registeredVersion = [string]$key.GetValue('pv')
        $parsedVersion = $null
        if ([version]::TryParse($registeredVersion, [ref]$parsedVersion) -and $parsedVersion -gt [version]'0.0.0.0') {
            $runtimes += [pscustomobject]@{ Version = $parsedVersion; Registry = "$($location.Label)\$clientKey" }
        }
    } catch {
        $discoveryErrors += "$($location.Label): $($_.Exception.Message)"
    } finally {
        if ($null -ne $key) { $key.Dispose() }
        if ($null -ne $baseKey) { $baseKey.Dispose() }
    }
}
if ($runtimes.Count -eq 0) {
    throw "No installed WebView2 Evergreen Runtime with a valid nonzero pv was found. Install Microsoft Edge WebView2 Runtime on this Windows x64 host before running release smoke. Registry discovery: $($discoveryErrors -join '; ')"
}
$runtime = $runtimes | Sort-Object -Property Version -Descending | Select-Object -First 1
$runtimeVersion = $runtime.Version.ToString()
$downloadUrl = "https://msedgedriver.microsoft.com/$runtimeVersion/edgedriver_win64.zip"
$destinationRoot = [IO.Path]::GetFullPath($Destination)
New-Item -ItemType Directory -Force -Path $destinationRoot | Out-Null
$staging = Join-Path $destinationRoot ('.download-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $staging | Out-Null
$archivePath = Join-Path $staging 'edgedriver_win64.zip'
$extractedDriver = Join-Path $staging 'msedgedriver.exe'
$driverDestination = Join-Path $destinationRoot 'msedgedriver.exe'
try {
    Write-Host "WebView2 Runtime $runtimeVersion; downloading its Windows x64 EdgeDriver."
    Invoke-WebRequest -Uri $downloadUrl -OutFile $archivePath -UseBasicParsing -TimeoutSec 60
    # Extract only the expected executable; no other archive entry can write files.
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $archive = [IO.Compression.ZipFile]::OpenRead($archivePath)
    try {
        $entries = @($archive.Entries | Where-Object { $_.FullName -eq 'msedgedriver.exe' })
        if ($entries.Count -ne 1 -or $entries[0].Length -le 0 -or $entries[0].Length -gt 100MB) {
            throw 'The Microsoft download must contain exactly one valid root msedgedriver.exe.'
        }
        [IO.Compression.ZipFileExtensions]::ExtractToFile($entries[0], $extractedDriver, $false)
    } finally { $archive.Dispose() }

    $signature = Get-AuthenticodeSignature -LiteralPath $extractedDriver
    if ($signature.Status -ne 'Valid' -or $null -eq $signature.SignerCertificate -or
        $signature.SignerCertificate.Subject -notmatch '(^|,\s*)O=Microsoft Corporation(,|$)') {
        throw "EdgeDriver must have a valid trusted Microsoft Corporation Authenticode signature. Actual status: $($signature.Status); signer: $($signature.SignerCertificate.Subject)"
    }
    $driverVersionOutput = & $extractedDriver --version
    if ($LASTEXITCODE -ne 0 -or $driverVersionOutput -notmatch 'Microsoft Edge WebDriver (\d+\.\d+\.\d+\.\d+)') {
        throw 'The downloaded Microsoft EdgeDriver did not return its expected version.'
    }
    $driverVersion = [version]$Matches[1]
    if ($driverVersion.Major -ne $runtime.Version.Major -or $driverVersion.Minor -ne $runtime.Version.Minor -or
        $driverVersion.Build -ne $runtime.Version.Build) {
        throw "EdgeDriver $driverVersion is incompatible with WebView2 Runtime $runtimeVersion; their first three version components must match."
    }
    $provenance = [ordered]@{
        checkedAtUtc = [DateTime]::UtcNow.ToString('o')
        runtimeVersion = $runtimeVersion
        runtimeRegistry = $runtime.Registry
        registeredRuntimes = @($runtimes | ForEach-Object { @{ version = $_.Version.ToString(); registry = $_.Registry } })
        discoveryErrors = $discoveryErrors
        downloadUrl = $downloadUrl
        archiveSha256 = (Get-FileHash -LiteralPath $archivePath -Algorithm SHA256).Hash.ToLowerInvariant()
        driverVersion = $driverVersion.ToString()
        driverSha256 = (Get-FileHash -LiteralPath $extractedDriver -Algorithm SHA256).Hash.ToLowerInvariant()
        signatureStatus = [string]$signature.Status
        signerSubject = $signature.SignerCertificate.Subject
        signerThumbprint = $signature.SignerCertificate.Thumbprint
    }
    Move-Item -LiteralPath $extractedDriver -Destination $driverDestination -Force
    $provenance | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $destinationRoot 'provenance.json') -Encoding utf8
    Write-Host "Verified Microsoft EdgeDriver $driverVersion; SHA256 $($provenance.driverSha256)"
    Write-Output $driverDestination
} finally {
    # Remove only this invocation's newly created staging directory.
    $resolvedStaging = [IO.Path]::GetFullPath($staging)
    $rootPrefix = $destinationRoot.TrimEnd([IO.Path]::DirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar
    if (-not $resolvedStaging.StartsWith($rootPrefix, [StringComparison]::OrdinalIgnoreCase) -or
        [IO.Path]::GetFileName($resolvedStaging) -notmatch '^\.download-[a-f0-9]{32}$') {
        throw 'Refusing cleanup outside the verified WebDriver destination.'
    }
    if (Test-Path -LiteralPath $resolvedStaging) { Remove-Item -LiteralPath $resolvedStaging -Recurse -Force }
}
