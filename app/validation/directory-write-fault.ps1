param([string]$Directory, [string]$FixtureRoot, [string]$SddlFile, [ValidateSet('deny','restore')][string]$Mode)
$ErrorActionPreference = 'Stop'
$targetPath = [IO.Path]::GetFullPath($Directory.Replace('\\?\','')).TrimEnd('\')
$fixturePath = [IO.Path]::GetFullPath($FixtureRoot.Replace('\\?\','')).TrimEnd('\')
if (!$targetPath.StartsWith($fixturePath + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'ACL fault target must remain in the isolated run fixture' }
$acl = Get-Acl -LiteralPath $targetPath
if ($Mode -eq 'deny') {
    $acl.Sddl | Set-Content -LiteralPath $SddlFile -Encoding utf8
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent().User
    $rights = [Security.AccessControl.FileSystemRights]::CreateFiles -bor [Security.AccessControl.FileSystemRights]::AppendData
    $rule = [Security.AccessControl.FileSystemAccessRule]::new($identity, $rights, [Security.AccessControl.InheritanceFlags]::None, [Security.AccessControl.PropagationFlags]::None, [Security.AccessControl.AccessControlType]::Deny)
    [void]$acl.AddAccessRule($rule)
} else {
    $saved = (Get-Content -LiteralPath $SddlFile -Raw).Trim()
    $acl.SetSecurityDescriptorSddlForm($saved)
}
Set-Acl -LiteralPath $targetPath -AclObject $acl
Write-Output $Mode
