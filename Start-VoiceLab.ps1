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
Write-Host 'Press Ctrl+C to stop. Configure Azure directly in the judging panel; .env is optional.'
& $npm run dev
exit $LASTEXITCODE
