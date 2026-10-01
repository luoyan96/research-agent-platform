param(
 [Parameter(Mandatory=$true)][ValidateSet('create-lab','create-account','reset-password','disable-account','inspect-account')][string]$Action,
 [Parameter(Mandatory=$true)][string]$ConfigFile,
 [Parameter(Mandatory=$true)][string]$LabId,
 [Parameter(Mandatory=$true)][string]$RequestId,
 [string]$MemberId, [string]$Username, [string]$DisplayName, [string]$LabName, [int]$ExpectedVersion
)
$ErrorActionPreference = 'Stop'
if (-not $env:OPERATOR_ID) { throw 'Set OPERATOR_ID to your host operator label first.' }
$resolvedConfig = (Resolve-Path -LiteralPath $ConfigFile).Path
$entry = Join-Path $PSScriptRoot '../apps/api/dist/operate.js'
if ($resolvedConfig.Contains('"') -or $entry.Contains('"')) { throw 'Unsupported path character' }
$payload = @{ action=$Action; requestId=$RequestId; labId=$LabId }
if ($Action -eq 'create-lab') { $payload.name=$LabName }
else { $payload.memberId=$MemberId }
if ($Action -eq 'create-account') { $payload.username=$Username; $payload.displayName=$DisplayName }
if ($Action -in @('reset-password','disable-account')) { $payload.expectedVersion=$ExpectedVersion }
$secure = $null
try {
 if ($Action -in @('create-account','reset-password')) {
  $secure = Read-Host 'New unique password (16-256 characters; not echoed)' -AsSecureString
  $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
  try { $payload.password = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer) }
  finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer) }
 }
 $start = New-Object System.Diagnostics.ProcessStartInfo
 $start.FileName = (Get-Command node).Source
 $start.Arguments = '--env-file="' + $resolvedConfig + '" "' + $entry + '"'
 $start.UseShellExecute=$false; $start.CreateNoWindow=$true
 $start.StandardInputEncoding = New-Object System.Text.UTF8Encoding($false)
 $start.RedirectStandardInput=$true; $start.RedirectStandardOutput=$true; $start.RedirectStandardError=$true
 $process = New-Object System.Diagnostics.Process
 $process.StartInfo=$start
 [void]$process.Start()
 $process.StandardInput.Write(($payload | ConvertTo-Json -Compress))
 $process.StandardInput.Close()
 $output=$process.StandardOutput.ReadToEnd(); $failure=$process.StandardError.ReadToEnd()
 $process.WaitForExit()
 Write-Output $output
 if($process.ExitCode -ne 0){ Write-Error $failure }
} finally {
 $payload.Remove('password')
 if($secure){ $secure.Dispose() }
 if($process){ $process.Dispose() }
}
