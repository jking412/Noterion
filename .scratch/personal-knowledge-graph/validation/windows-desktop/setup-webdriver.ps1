$ErrorActionPreference = 'Stop'
$version = '136.0.3240.76'
$directory = Join-Path $PSScriptRoot '.tools/issue3-webdriver'
$archive = Join-Path $directory 'edgedriver_win64.zip'
New-Item -ItemType Directory -Force -Path $directory | Out-Null
Invoke-WebRequest -Uri "https://msedgedriver.microsoft.com/$version/edgedriver_win64.zip" -OutFile $archive
$expectedArchive = '62238D7201DDB1CA1F52A793A6EACA41FB68B436857D71E6B647474BD839D901'
if ((Get-FileHash -Algorithm SHA256 -LiteralPath $archive).Hash -ne $expectedArchive) { throw 'Unexpected driver archive SHA256' }
Expand-Archive -LiteralPath $archive -DestinationPath $directory -Force
$driver = Join-Path $directory 'msedgedriver.exe'
$expectedDriver = '76F549B492A89DBACEE027AC6A726836944F04645ECAA5FA9A2045C84303D6ED'
if ((Get-FileHash -Algorithm SHA256 -LiteralPath $driver).Hash -ne $expectedDriver) { throw 'Unexpected driver binary SHA256' }
& $driver --version
if ($LASTEXITCODE -ne 0) { throw 'Driver version command failed' }
