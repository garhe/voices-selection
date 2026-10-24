[CmdletBinding()]
param([switch]$AutoRestart)

$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot

$nodeCommand = Get-Command node.exe -ErrorAction SilentlyContinue
if ($nodeCommand) {
    $nodeDirectory = Split-Path $nodeCommand.Source
} else {
    $nodeDirectory = Join-Path $env:LOCALAPPDATA 'VoiceQualityWorkbench\runtime'
    if (-not (Test-Path (Join-Path $nodeDirectory 'node.exe'))) {
        throw 'Node.js was not found. Install Node.js 22.16+ from https://nodejs.org, reopen PowerShell, and run this script again.'
    }
}

$env:PATH = "$nodeDirectory;$env:PATH"
$npm = Join-Path $nodeDirectory 'npm.cmd'
if (-not (Test-Path $npm)) {
    throw 'npm.cmd was not found alongside Node.js. Install the full Node.js distribution.'
}
if (-not (Test-Path (Join-Path $PSScriptRoot 'node_modules'))) {
    & $npm ci
    if ($LASTEXITCODE -ne 0) { throw 'Dependency installation failed.' }
}

Write-Host 'Starting Voices Selection at http://127.0.0.1:4310 (or PORT from .env).'
if ($AutoRestart) {
    $logDirectory = Join-Path $env:LOCALAPPDATA 'VoiceQualityWorkbench\logs'
    New-Item -ItemType Directory -Path $logDirectory -Force | Out-Null
    Start-Transcript -Path (Join-Path $logDirectory 'watchdog.log') -Append | Out-Null
    $processJob = $null
    try {
        if (-not ('VoiceLabProcessJob' -as [type])) { Add-Type -Path (Join-Path $PSScriptRoot 'scripts\VoiceLabProcessJob.cs') }
        $processJob = New-Object VoiceLabProcessJob
        while ($true) {
            $oldLogs = Get-ChildItem -LiteralPath $logDirectory -Filter 'server-*.stdout.log' |
                Sort-Object LastWriteTime -Descending | Select-Object -Skip 9
            foreach ($oldLog in $oldLogs) {
                $errorLog = Join-Path $logDirectory ($oldLog.Name -replace '\.stdout\.log$', '.stderr.log')
                Remove-Item -LiteralPath $oldLog.FullName
                if (Test-Path -LiteralPath $errorLog) { Remove-Item -LiteralPath $errorLog }
            }
            $stamp = Get-Date -Format 'yyyyMMdd-HHmmss-fff'
            $outputLog = Join-Path $logDirectory "server-$stamp.stdout.log"
            $errorLog = Join-Path $logDirectory "server-$stamp.stderr.log"
            $child = Start-Process -FilePath (Join-Path $nodeDirectory 'node.exe') -ArgumentList @('--import', 'tsx', 'server\index.ts') `
                -WorkingDirectory $PSScriptRoot -NoNewWindow -PassThru -RedirectStandardOutput $outputLog -RedirectStandardError $errorLog
            try {
                $processJob.Add($child.Handle)
                Write-Host "$(Get-Date -Format o) Server started; PID $($child.Id). Logs: $outputLog"
                $child.WaitForExit()
                $code = $child.ExitCode
            } finally {
                if (-not $child.HasExited) { Stop-Process -Id $child.Id -Force }
                $child.Dispose()
            }
            Write-Warning "$(Get-Date -Format o) Server exited with code $code. Restarting in 10 seconds. See $errorLog"
            Start-Sleep -Seconds 10
        }
    } finally {
        if ($processJob) { $processJob.Dispose() }
        Stop-Transcript | Out-Null
    }
}
Write-Host 'Press Ctrl+C to stop. Configure Azure directly in the judging panel; .env is optional.'
& $npm run dev
exit $LASTEXITCODE
