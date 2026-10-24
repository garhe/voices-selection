[CmdletBinding(SupportsShouldProcess)]
param()

$ErrorActionPreference = 'Stop'
$taskName = 'Voices Selection'
$launcher = Join-Path $PSScriptRoot 'Start-VoiceLab.ps1'
$powerShell = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
if (-not (Test-Path -LiteralPath $launcher)) { throw "Launcher not found: $launcher" }
if (-not (Test-Path -LiteralPath $powerShell)) { throw 'Windows PowerShell was not found.' }

$existing = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
if ($existing -and @($existing.Actions | Where-Object { $_.WorkingDirectory -ne $PSScriptRoot }).Count) {
    throw "A task named '$taskName' belongs to another location. It has not been changed."
}
$account = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
$action = New-ScheduledTaskAction -Execute $powerShell `
    -Argument "-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$launcher`" -AutoRestart" `
    -WorkingDirectory $PSScriptRoot
$logon = New-ScheduledTaskTrigger -AtLogOn -User $account
$retry = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 1)
$principal = New-ScheduledTaskPrincipal -UserId $account -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -ExecutionTimeLimit ([TimeSpan]::Zero) `
    -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable `
    -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)

if ($PSCmdlet.ShouldProcess("$account / $taskName", 'Register sign-in startup and automatic server recovery')) {
    Register-ScheduledTask -TaskName $taskName -Action $action -Trigger @($logon, $retry) `
        -Principal $principal -Settings $settings -Description 'Keep the local Voices Selection app running independently of VS Code. Restart the server after exit and recover the watchdog every minute.' -Force | Out-Null
    Write-Host "Registered '$taskName' for $account. It starts at sign-in and checks every minute."
    Write-Host 'Stop any manually started instance before the next minute to avoid a port conflict.'
    Write-Host "To start immediately: Start-ScheduledTask -TaskName '$taskName'"
    Write-Host "To stop automatic recovery: Disable-ScheduledTask -TaskName '$taskName'; Stop-ScheduledTask -TaskName '$taskName'"
    Write-Host "Logs: $(Join-Path $env:LOCALAPPDATA 'VoiceQualityWorkbench\logs')"
}
