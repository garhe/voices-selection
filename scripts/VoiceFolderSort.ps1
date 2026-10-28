Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSHOME 'Modules\Microsoft.PowerShell.Utility\Microsoft.PowerShell.Utility.psd1') -ErrorAction Stop
[Console]::InputEncoding = New-Object System.Text.UTF8Encoding($false)
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$requestData = [Console]::In.ReadToEnd() | ConvertFrom-Json
$sorterPath = Join-Path (Split-Path $PSScriptRoot -Parent) 'Sort-VoiceFolders.ps1'
$sortArguments = @{ SourcePath = $requestData.source; OutputPath = $requestData.output; Confirm = $false }
if ($requestData.mode -eq 'replace') { $sortArguments.ReplaceOriginal = $true }
if ($requestData.action -eq 'preview') {
    $sortPlan = @(& $sorterPath @sortArguments -WhatIf 6>$null)
    $responseData = @{
        wavFiles = $sortPlan.Count
        voiceFolders = @($sortPlan | ForEach-Object { Split-Path $_.Destination -Parent } | Sort-Object -Unique).Count
        renamedFiles = @($sortPlan | Where-Object Renamed).Count
        omittedFiles = @(Get-ChildItem -LiteralPath $requestData.source -Recurse -Force -File |
            Where-Object { $_.Extension -ine '.wav' }).Count
        mappings = @($sortPlan | Select-Object -First 100 | ForEach-Object {
            @{ source = $_.Source; destination = $_.Destination }
        })
    }
} elseif ($requestData.action -eq 'apply') {
    $sortResult = & $sorterPath @sortArguments 6>$null
    if ($sortResult.ReplacedSource -ne ($requestData.mode -eq 'replace')) {
        throw 'The sorter did not honor the selected mode. Check the installed sorter and reported output before continuing.'
    }
    $responseData = @{ output = $sortResult.OutputPath }
} else {
    throw 'Unknown folder sorting action.'
}
[Console]::Out.WriteLine('VOICE_SORT_JSON:' + ($responseData | ConvertTo-Json -Depth 6 -Compress))
