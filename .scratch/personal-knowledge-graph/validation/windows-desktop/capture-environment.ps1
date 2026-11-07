param(
    [int]$HostProcessId = 23144,
    [string]$OutputPath = (Join-Path $PSScriptRoot 'evidence/environment.json')
)

$ErrorActionPreference = 'Stop'

function Get-FileEvidence([string]$LiteralPath) {
    if (-not (Test-Path -LiteralPath $LiteralPath)) {
        return [ordered]@{ path = $LiteralPath; exists = $false }
    }
    $item = Get-Item -LiteralPath $LiteralPath
    return [ordered]@{
        path = $item.FullName
        exists = $true
        fileVersion = $item.VersionInfo.FileVersion
        productVersion = $item.VersionInfo.ProductVersion
    }
}

$os = Get-CimInstance -ClassName Win32_OperatingSystem -Property Caption,Version,BuildNumber,OSArchitecture
$hostProcess = Get-CimInstance -ClassName Win32_Process -Filter "ProcessId = $HostProcessId" -Property ProcessId,ParentProcessId,Name,ExecutablePath
$relatedProcesses = [System.Collections.Generic.List[object]]::new()
if ($hostProcess) {
    $queue = [System.Collections.Generic.Queue[uint32]]::new()
    $queue.Enqueue([uint32]$HostProcessId)
    $relatedProcesses.Add($hostProcess)
    while ($queue.Count -gt 0) {
        $parentId = $queue.Dequeue()
        $children = @(Get-CimInstance -ClassName Win32_Process -Filter "ParentProcessId = $parentId" -Property ProcessId,ParentProcessId,Name,ExecutablePath)
        foreach ($child in $children) {
            $relatedProcesses.Add($child)
            $queue.Enqueue([uint32]$child.ProcessId)
        }
    }
}

$processEvidence = @($relatedProcesses | ForEach-Object {
    [ordered]@{
        processId = $_.ProcessId
        parentProcessId = $_.ParentProcessId
        name = $_.Name
        executable = if ($_.ExecutablePath) { Get-FileEvidence $_.ExecutablePath } else { $null }
    }
})

$vsInstallation = $null
$vswherePath = 'C:\Program Files (x86)\Microsoft Visual Studio\Installer\vswhere.exe'
if (Test-Path -LiteralPath $vswherePath) {
    $matching = @((& $vswherePath -products '*' -format json -utf8 | ConvertFrom-Json) | Where-Object { $_.installationPath -eq 'D:\VS' })
    if ($matching.Count -gt 0) {
        $vsInstallation = [ordered]@{
            installationPath = $matching[0].installationPath
            installationVersion = $matching[0].installationVersion
            displayName = $matching[0].displayName
        }
    }
}

$sdkPath = 'D:\Windows Kits\10\Lib\10.0.22621.0'
$compilerPath = 'D:\VS\VC\Tools\MSVC\14.43.34808\bin\Hostx64\x64\cl.exe'
$nodePath = (Get-Command node.exe).Source
$toolEvidence = [ordered]@{
    rustc = (& rustc.exe -Vv | Out-String).Trim()
    cargo = (& cargo.exe -V | Out-String).Trim()
    node = [ordered]@{ version = (& $nodePath --version | Out-String).Trim(); executable = Get-FileEvidence $nodePath }
}

$evidence = [ordered]@{
    capturedAtUtc = [DateTimeOffset]::UtcNow.ToString('o')
    scope = 'Read-only OS/toolchain evidence plus the named Tauri host process and its descendants only. No command lines, environment variables, host name, user name or unrelated process data retained.'
    operatingSystem = [ordered]@{ caption = $os.Caption; version = $os.Version; buildNumber = $os.BuildNumber; architecture = $os.OSArchitecture }
    windowsSdk = [ordered]@{
        libraryPath = $sdkPath
        exists = (Test-Path -LiteralPath $sdkPath -PathType Container)
        kernel32LibraryExists = (Test-Path -LiteralPath (Join-Path $sdkPath 'um/x64/kernel32.lib'))
        ucrtLibraryExists = (Test-Path -LiteralPath (Join-Path $sdkPath 'ucrt/x64/ucrt.lib'))
    }
    visualStudio = $vsInstallation
    buildCompiler = Get-FileEvidence $compilerPath
    tools = $toolEvidence
    desktopAutomation = [ordered]@{
        plugin = 'computer-use'
        pluginBuild = '26.1103.32239'
        pluginBuildEvidence = 'Installed skill path: computer-use/26.1103.32239/skills/computer-use/SKILL.md'
        skyPackageVersion = $null
        skyPackageVersionNote = '@oai/sky standalone package version was not obtained. No package.json was exposed under the installed computer-use plugin directory; the package is supplied by the separate Computer Use runtime. pluginBuild identifies the inspected skill bundle, not an independently verified npm package version.'
    }
    tauriHost = [ordered]@{ requestedProcessId = $HostProcessId; observedRunning = [bool]$hostProcess; relatedProcesses = $processEvidence }
    webView2 = [ordered]@{
        evidenceKind = if (@($relatedProcesses | Where-Object { $_.Name -eq 'msedgewebview2.exe' }).Count -gt 0) { 'actual-host-descendant-processes' } else { 'no-live-host-descendant-observed' }
        note = 'Only msedgewebview2.exe processes descending from the requested Tauri host can establish the runtime actually used by this host.'
    }
}

$outputDirectory = Split-Path -Parent $OutputPath
if (-not (Test-Path -LiteralPath $outputDirectory)) { New-Item -ItemType Directory -Path $outputDirectory -Force | Out-Null }
$evidence | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $OutputPath -Encoding utf8
$evidence | ConvertTo-Json -Depth 8
