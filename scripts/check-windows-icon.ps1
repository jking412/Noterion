param(
    [Parameter(Mandatory = $true)][string]$Exe,
    [Parameter(Mandatory = $true)][string]$Output,
    [string]$WindowHandle
)
$ErrorActionPreference = 'Stop'
if ($env:OS -ne 'Windows_NT') { throw 'This check requires Windows.' }
$exePath = (Resolve-Path -LiteralPath $Exe).Path
$sourcePath = Join-Path $PSScriptRoot '../assets/brand/noterion.ico'
$sourcePath = (Resolve-Path -LiteralPath $sourcePath).Path
$nativeIconPath = Join-Path $PSScriptRoot '../app/src-tauri/icons/icon.ico'
if ((Get-FileHash -LiteralPath $sourcePath -Algorithm SHA256).Hash -ne (Get-FileHash -LiteralPath $nativeIconPath -Algorithm SHA256).Hash) {
    throw 'Native icon differs from the canonical Noterion brand icon.'
}
$outputPath = [IO.Path]::GetFullPath($Output)
if (Test-Path -LiteralPath $outputPath) { throw 'Use a new output directory; existing evidence is never overwritten.' }
New-Item -ItemType Directory -Path $outputPath | Out-Null
Add-Type -AssemblyName System.Drawing
if (-not ('NoterionIconEvidence.Native' -as [type])) {
    Add-Type -TypeDefinition @'
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
namespace NoterionIconEvidence {
    [StructLayout(LayoutKind.Sequential)]
    public struct WindowRect { public int Left, Top, Right, Bottom; }
    public static class Native {
        [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
        public static extern IntPtr LoadLibraryEx(string path, IntPtr file, uint flags);
        [DllImport("kernel32.dll", SetLastError=true)]
        public static extern bool FreeLibrary(IntPtr module);
        [DllImport("kernel32.dll", SetLastError=true)]
        private static extern IntPtr FindResource(IntPtr module, IntPtr name, IntPtr type);
        [DllImport("kernel32.dll", SetLastError=true)]
        private static extern uint SizeofResource(IntPtr module, IntPtr resource);
        [DllImport("kernel32.dll", SetLastError=true)]
        private static extern IntPtr LoadResource(IntPtr module, IntPtr resource);
        [DllImport("kernel32.dll", SetLastError=true)]
        private static extern IntPtr LockResource(IntPtr resource);
        [DllImport("user32.dll", SetLastError=true)]
        public static extern uint GetWindowThreadProcessId(IntPtr window, out uint processId);
        [DllImport("user32.dll")]
        public static extern bool IsWindow(IntPtr window);
        [DllImport("user32.dll")]
        public static extern bool IsIconic(IntPtr window);
        [DllImport("user32.dll")]
        public static extern IntPtr GetForegroundWindow();
        [DllImport("user32.dll", CharSet=CharSet.Unicode)]
        public static extern IntPtr FindWindow(string className, string windowName);
        [DllImport("user32.dll", SetLastError=true)]
        public static extern bool GetWindowRect(IntPtr window, out WindowRect rect);
        [DllImport("user32.dll", SetLastError=true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        public static extern bool PrintWindow(IntPtr window, IntPtr destinationDc, uint flags);
        [DllImport("user32.dll")]
        public static extern int GetSystemMetrics(int index);
        [DllImport("user32.dll", SetLastError=true)]
        public static extern IntPtr SetThreadDpiAwarenessContext(IntPtr context);
        [DllImport("user32.dll", SetLastError=true)]
        private static extern IntPtr SendMessageTimeout(IntPtr window, uint message,
            IntPtr wParam, IntPtr lParam, uint flags, uint timeout, out IntPtr result);
        public static IntPtr WindowIcon(IntPtr window, int kind) {
            IntPtr result;
            if (SendMessageTimeout(window, 0x007F, (IntPtr)kind, IntPtr.Zero, 2, 3000, out result) == IntPtr.Zero)
                throw new Win32Exception(Marshal.GetLastWin32Error(), "WM_GETICON failed or timed out");
            return result;
        }
        public static byte[] Resource(IntPtr module, int type, int name) {
            var resource = FindResource(module, (IntPtr)name, (IntPtr)type);
            if (resource == IntPtr.Zero) throw new Win32Exception(Marshal.GetLastWin32Error(), "Missing PE resource");
            var length = SizeofResource(module, resource);
            var pointer = LockResource(LoadResource(module, resource));
            if (length == 0 || pointer == IntPtr.Zero) throw new InvalidOperationException("Empty PE resource");
            var bytes = new byte[checked((int)length)];
            Marshal.Copy(pointer, bytes, 0, bytes.Length);
            return bytes;
        }
    }
}
'@
}
function Get-ByteHash([byte[]]$Bytes) {
    $digest = [Security.Cryptography.SHA256]::Create()
    try { return ([BitConverter]::ToString($digest.ComputeHash($Bytes))).Replace('-', '').ToLowerInvariant() }
    finally { $digest.Dispose() }
}
function Save-IconEvidence([Drawing.Icon]$Icon, [string]$Name) {
    $bitmap = $Icon.ToBitmap()
    try {
        $filename = "$Name.png"
        $bitmap.Save((Join-Path $outputPath $filename), [Drawing.Imaging.ImageFormat]::Png)
        $pixels = New-Object byte[] ($bitmap.Width * $bitmap.Height * 4)
        $index = 0
        for ($y = 0; $y -lt $bitmap.Height; $y++) {
            for ($x = 0; $x -lt $bitmap.Width; $x++) {
                $pixel = $bitmap.GetPixel($x, $y)
                $pixels[$index++] = $pixel.R; $pixels[$index++] = $pixel.G
                $pixels[$index++] = $pixel.B; $pixels[$index++] = $pixel.A
            }
        }
        return [ordered]@{ file = $filename; width = $bitmap.Width; height = $bitmap.Height; rgbaSha256 = Get-ByteHash $pixels }
    } finally { $bitmap.Dispose() }
}
function Save-ScreenEvidence([IntPtr]$Window, [string]$Name, [bool]$UsePrintWindow) {
    if ([NoterionIconEvidence.Native]::IsIconic($Window)) { throw "Cannot capture minimized $Name window." }
    # Physical coordinates prevent GetWindowRect/CopyFromScreen DPI mismatches.
    # Only this script thread is changed, and its previous context is restored.
    $previousDpi = [NoterionIconEvidence.Native]::SetThreadDpiAwarenessContext([IntPtr](-4))
    if ($previousDpi -eq [IntPtr]::Zero) { throw 'Unable to establish physical screenshot coordinates.' }
    $bitmap = $null
    $graphics = $null
    try {
        $foregroundBefore = [NoterionIconEvidence.Native]::GetForegroundWindow()
        $rect = New-Object NoterionIconEvidence.WindowRect
        if (-not [NoterionIconEvidence.Native]::GetWindowRect($Window, [ref]$rect)) { throw "Unable to read $Name window rectangle." }
        $width = $rect.Right - $rect.Left
        $height = $rect.Bottom - $rect.Top
        if ($width -le 0 -or $height -le 0) { throw "$Name has an empty screenshot rectangle." }
        $screenLeft = [NoterionIconEvidence.Native]::GetSystemMetrics(76)
        $screenTop = [NoterionIconEvidence.Native]::GetSystemMetrics(77)
        $screenRight = $screenLeft + [NoterionIconEvidence.Native]::GetSystemMetrics(78)
        $screenBottom = $screenTop + [NoterionIconEvidence.Native]::GetSystemMetrics(79)
        if (-not $UsePrintWindow -and ($rect.Left -lt $screenLeft -or $rect.Top -lt $screenTop -or $rect.Right -gt $screenRight -or $rect.Bottom -gt $screenBottom)) {
            throw "$Name rectangle is partly off screen; move it fully on screen before capture."
        }
        if ($Name -eq 'taskbar' -and ($width -lt 12 -or $height -lt 12)) { throw 'The taskbar is hidden; a visible taskbar is required for display evidence.' }
        $bitmap = [Drawing.Bitmap]::new($width, $height, [Drawing.Imaging.PixelFormat]::Format24bppRgb)
        $graphics = [Drawing.Graphics]::FromImage($bitmap)
        $capturedAt = [DateTime]::UtcNow.ToString('o')
        $printWindowSucceeded = $null
        $method = 'GetWindowRect + CopyFromScreen; exact bounded taskbar screen region'
        if ($UsePrintWindow) {
            $method = 'GetWindowRect + PrintWindow(PW_RENDERFULLCONTENT=2); specified window only'
            $destinationDc = $graphics.GetHdc()
            try { $printWindowSucceeded = [NoterionIconEvidence.Native]::PrintWindow($Window, $destinationDc, 2) }
            finally { $graphics.ReleaseHdc($destinationDc) }
        } else {
            $graphics.CopyFromScreen($rect.Left, $rect.Top, 0, 0, $bitmap.Size, [Drawing.CopyPixelOperation]::SourceCopy)
        }
        $foregroundAfter = [NoterionIconEvidence.Native]::GetForegroundWindow()
        $filename = "$Name.png"
        $destination = Join-Path $outputPath $filename
        if (-not $UsePrintWindow -or $printWindowSucceeded) { $bitmap.Save($destination, [Drawing.Imaging.ImageFormat]::Png) }
        return [ordered]@{
            file = if ($UsePrintWindow -and -not $printWindowSucceeded) { $null } else { $filename }
            windowHandle = $Window.ToInt64().ToString()
            method = $method
            printWindowSucceeded = $printWindowSucceeded
            capturedAt = $capturedAt
            completedAt = [DateTime]::UtcNow.ToString('o')
            rectangle = [ordered]@{ left = $rect.Left; top = $rect.Top; right = $rect.Right; bottom = $rect.Bottom; width = $width; height = $height }
            foregroundBefore = $foregroundBefore.ToInt64().ToString()
            foregroundAfter = $foregroundAfter.ToInt64().ToString()
            requiredForeground = $false
            pngSha256 = if ($UsePrintWindow -and -not $printWindowSucceeded) { $null } else { (Get-FileHash -LiteralPath $destination -Algorithm SHA256).Hash.ToLowerInvariant() }
        }
    } finally {
        if ($null -ne $graphics) { $graphics.Dispose() }
        if ($null -ne $bitmap) { $bitmap.Dispose() }
        [void][NoterionIconEvidence.Native]::SetThreadDpiAwarenessContext($previousDpi)
    }
}
$report = [ordered]@{
    passed = $false
    at = [DateTime]::UtcNow.ToString('o')
    exe = $exePath
    exeSha256 = (Get-FileHash -LiteralPath $exePath -Algorithm SHA256).Hash.ToLowerInvariant()
    sourceIcon = $sourcePath
    sourceIconSha256 = (Get-FileHash -LiteralPath $sourcePath -Algorithm SHA256).Hash.ToLowerInvariant()
    resourceGroup = 32512
    frames = @()
    scope = 'Read-only PE resources and shell icon extraction. With a supplied HWND: owner verification, WM_GETICON, PrintWindow client capture and bounded taskbar screen capture. No app launch, input, activation, or desktop changes.'
    limitations = 'Images require visual inspection, including whether PrintWindow rendered the WebView content. Captures preserve the observed moment and do not prove every Windows shell view or scaling mode. No Explorer or full-desktop screenshot is taken. Windows may scale window icons with a different filter from the asset exporter.'
}
$module = [IntPtr]::Zero
try {
    $ico = [IO.File]::ReadAllBytes($sourcePath)
    if ($ico.Length -lt 6 -or [BitConverter]::ToUInt16($ico, 0) -ne 0 -or [BitConverter]::ToUInt16($ico, 2) -ne 1) { throw 'Source file is not an ICO.' }
    $count = [BitConverter]::ToUInt16($ico, 4)
    if ($count -lt 2 -or $ico.Length -lt 6 + 16 * $count) { throw 'Source ICO must contain multiple valid frames.' }
    # LOAD_LIBRARY_AS_DATAFILE | LOAD_LIBRARY_AS_IMAGE_RESOURCE: never execute EXE entry points.
    $module = [NoterionIconEvidence.Native]::LoadLibraryEx($exePath, [IntPtr]::Zero, 0x22)
    if ($module -eq [IntPtr]::Zero) { throw "Unable to load PE resources: $([Runtime.InteropServices.Marshal]::GetLastWin32Error())" }
    [byte[]]$group = [NoterionIconEvidence.Native]::Resource($module, 14, 32512)
    if ($group.Length -ne 6 + 14 * $count -or [BitConverter]::ToUInt16($group, 2) -ne 1 -or [BitConverter]::ToUInt16($group, 4) -ne $count) {
        throw 'PE group icon header does not match the source ICO frame count.'
    }
    for ($frame = 0; $frame -lt $count; $frame++) {
        $sourceEntry = 6 + 16 * $frame
        $groupEntry = 6 + 14 * $frame
        # The first 12 directory bytes are common to ICO and GRPICONDIR.
        for ($field = 0; $field -lt 12; $field++) {
            if ($ico[$sourceEntry + $field] -ne $group[$groupEntry + $field]) { throw "PE icon frame $frame metadata differs from source ICO." }
        }
        $length = [BitConverter]::ToUInt32($ico, $sourceEntry + 8)
        $offset = [BitConverter]::ToUInt32($ico, $sourceEntry + 12)
        if ($length -eq 0 -or [uint64]$offset + $length -gt $ico.Length) { throw "Invalid source ICO frame $frame bounds." }
        $resourceId = [BitConverter]::ToUInt16($group, $groupEntry + 12)
        [byte[]]$embedded = [NoterionIconEvidence.Native]::Resource($module, 3, $resourceId)
        [byte[]]$source = $ico[$offset..($offset + $length - 1)]
        $sourceHash = Get-ByteHash $source
        if ($embedded.Length -ne $length -or (Get-ByteHash $embedded) -ne $sourceHash) { throw "PE icon frame $frame bytes differ from source ICO." }
        $width = if ($ico[$sourceEntry] -eq 0) { 256 } else { [int]$ico[$sourceEntry] }
        $height = if ($ico[$sourceEntry + 1] -eq 0) { 256 } else { [int]$ico[$sourceEntry + 1] }
        $report.frames += [ordered]@{ width = $width; height = $height; resourceId = $resourceId; bytes = $length; sha256 = $sourceHash; exactSourceMatch = $true }
    }
    foreach ($requiredSize in @(16, 32, 48, 256)) {
        if (-not ($report.frames | Where-Object { $_.width -eq $requiredSize -and $_.height -eq $requiredSize })) { throw "Required $requiredSize-pixel ICO frame is missing." }
    }
    $shellIcon = [Drawing.Icon]::ExtractAssociatedIcon($exePath)
    if ($null -eq $shellIcon) { throw 'Windows could not extract an associated EXE icon.' }
    try { $report.shellIcon = Save-IconEvidence $shellIcon 'exe-shell-icon' }
    finally { $shellIcon.Dispose() }
    if ($WindowHandle) {
        $numericHandle = if ($WindowHandle.StartsWith('0x', [StringComparison]::OrdinalIgnoreCase)) {
            [Convert]::ToInt64($WindowHandle.Substring(2), 16)
        } else { [long]::Parse($WindowHandle, [Globalization.CultureInfo]::InvariantCulture) }
        $window = [IntPtr]$numericHandle
        if (-not [NoterionIconEvidence.Native]::IsWindow($window)) { throw 'The supplied HWND is not a live window.' }
        [uint32]$windowProcessId = 0
        $threadId = [NoterionIconEvidence.Native]::GetWindowThreadProcessId($window, [ref]$windowProcessId)
        if ($threadId -eq 0 -or $windowProcessId -eq 0) { throw 'Unable to identify the supplied window owner.' }
        $process = Get-Process -Id $windowProcessId
        $ownerPath = $process.Path
        if (-not [string]::Equals($exePath, $ownerPath, [StringComparison]::OrdinalIgnoreCase)) { throw 'The supplied window does not belong to the specified EXE path.' }
        $report.window = [ordered]@{ handle = $numericHandle.ToString(); processId = $windowProcessId; exe = $ownerPath; icons = @() }
        foreach ($kind in @(@{ value = 1; name = 'window-big' }, @{ value = 0; name = 'window-small' })) {
            $iconHandle = [NoterionIconEvidence.Native]::WindowIcon($window, $kind.value)
            if ($iconHandle -eq [IntPtr]::Zero) { throw "WM_GETICON returned no $($kind.name) icon." }
            # Clone the borrowed HICON; never destroy the window-owned icon handle.
            $icon = [Drawing.Icon]::FromHandle($iconHandle).Clone()
            try { $report.window.icons += Save-IconEvidence $icon $kind.name }
            finally { $icon.Dispose() }
        }
        $report.window.screenshot = Save-ScreenEvidence $window 'native-window' $true
        if (-not $report.window.screenshot.printWindowSucceeded) { throw 'PrintWindow returned false; no client screenshot was saved and no screen-capture fallback was attempted.' }
        $taskbar = [NoterionIconEvidence.Native]::FindWindow('Shell_TrayWnd', $null)
        if ($taskbar -eq [IntPtr]::Zero) { throw 'Windows taskbar window was not found.' }
        $report.taskbarScreenshot = Save-ScreenEvidence $taskbar 'taskbar' $false
    }
    $report.passed = $true
    Write-Host "PASS: $count PE icon frames exactly match source ICO; shell icon extracted."
    if ($WindowHandle) { Write-Host 'PASS: verified EXE owner, big/small WM_GETICON images, PrintWindow client capture and actual taskbar screenshot.' }
} catch {
    $report.error = $_.Exception.Message
    throw
} finally {
    if ($module -ne [IntPtr]::Zero) { [void][NoterionIconEvidence.Native]::FreeLibrary($module) }
    $report | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $outputPath 'result.json') -Encoding UTF8
}
