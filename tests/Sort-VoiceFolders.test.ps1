$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$scriptPath = Join-Path (Split-Path $PSScriptRoot -Parent) 'Sort-VoiceFolders.ps1'
$testRoot = Join-Path ([System.IO.Path]::GetTempPath()) ('VoiceFolderTests-' + [guid]::NewGuid().ToString('N'))
$null = [System.IO.Directory]::CreateDirectory($testRoot)

function Assert-True {
    param([bool]$Condition, [string]$Message)
    if (-not $Condition) { throw $Message }
}

function Add-Fixture {
    param([string]$RelativePath, [string]$Content)
    $path = Join-Path $testRoot $RelativePath
    $null = [System.IO.Directory]::CreateDirectory([System.IO.Path]::GetDirectoryName($path))
    [System.IO.File]::WriteAllText($path, $Content)
}

function Assert-Rejected {
    param([scriptblock]$Action, [string]$Expected)
    $caught = $false
    try {
        & $Action | Out-Null
    } catch {
        $caught = $true
        Assert-True ($_.Exception.Message -like "*$Expected*") "Unexpected error: $_"
    }
    Assert-True $caught "Expected rejection: $Expected"
}

try {
    Add-Fixture 'es-ES Male VTS\NonTTS\039_01\Waves\Callcenter\sample.wav' 'first'
    Add-Fixture 'es-ES Male VTS\NonTTS\039_01\Waves\Other\sample.wav' 'second'
    Add-Fixture 'es-ES Male VTS\NonTTS\039_01\Waves\Other\sample__2.wav' 'third'
    Add-Fixture 'es-ES Male VTS\NonTTS\039_01\Scripts\script.txt' 'script'
    Add-Fixture 'es-ES Male VTS\TTS\11labs_v3_Dani\Waves\Callcenter\[01].WAV' 'tts'
    Add-Fixture 'es-ES Male VTS\TTS\Empty\Scripts\readme.txt' 'omit'
    Add-Fixture 'es-ES Male VTS\readme.txt' 'root'
    $source = Join-Path $testRoot 'es-ES Male VTS'
    $output = Join-Path $testRoot 'es-ES Male VTS-sorted'
    $before = @(Get-ChildItem -LiteralPath $source -Recurse -File | Get-FileHash)

    $preview = @(& $scriptPath -SourcePath $source -WhatIf)
    Assert-True ($preview.Count -eq 4) 'Preview must list all four copies.'
    Assert-True (-not (Test-Path -LiteralPath $output)) 'Preview created output.'
    $result = & $scriptPath -SourcePath $source
    Assert-True ($result.WavFiles -eq 4 -and $result.VoiceFolders -eq 2) 'Wrong copy counts.'
    # PowerShell versions sort punctuation differently, changing which name is reserved first.
    $previewRenamed = @($preview | Where-Object Renamed).Count
    Assert-True ($result.RenamedFiles -eq $previewRenamed -and
        $result.RenamedFiles -in @(1, 2) -and $result.OmittedFiles -eq 3) 'Wrong rename/omit counts.'
    $files = @(Get-ChildItem -LiteralPath $output -Recurse -File)
    Assert-True ($files.Count -eq 4) 'Output lost or added files.'
    foreach ($file in $files) {
        Assert-True ($file.Extension -ieq '.wav') 'Non-WAV copied.'
        Assert-True ($file.Directory.Parent.FullName -eq $output) 'WAV not directly under a voice.'
    }
    $content = @($files | ForEach-Object { [System.IO.File]::ReadAllText($_.FullName) } | Sort-Object)
    Assert-True (($content -join ',') -eq 'first,second,third,tts') 'Duplicate-name handling lost audio content.'
    Assert-True (@(Get-ChildItem -LiteralPath $output -Directory).Count -eq 2) 'Empty/extra folders copied.'
    $after = @(Get-ChildItem -LiteralPath $source -Recurse -File | Get-FileHash)
    Assert-True (-not (Compare-Object $before $after -Property Path, Hash)) 'Originals changed.'

    Assert-Rejected { & $scriptPath -SourcePath $source } 'Output already exists'
    Assert-Rejected { & $scriptPath -SourcePath $source -OutputPath (Join-Path $source 'nested') } 'non-overlapping'
    Assert-Rejected { & $scriptPath -SourcePath $source -OutputPath $testRoot } 'non-overlapping'

    Add-Fixture 'en-GB female VTS\11labs_v4_Alice\sample.wav' 'flat'
    Add-Fixture 'en-GB female VTS\118_08\sample.wav' 'other'
    $flat = & $scriptPath -SourcePath (Join-Path $testRoot 'en-GB female VTS') -OutputPath (Join-Path $testRoot 'custom')
    Assert-True ($flat.WavFiles -eq 2 -and $flat.VoiceFolders -eq 2) 'Already-flat collection failed.'

    Add-Fixture 'invalid\orphan.wav' 'orphan'
    Assert-Rejected { & $scriptPath -SourcePath (Join-Path $testRoot 'invalid') } 'no voice folder'
    Add-Fixture 'invalid-group\TTS\orphan.wav' 'orphan'
    Assert-Rejected { & $scriptPath -SourcePath (Join-Path $testRoot 'invalid-group') } 'no voice folder'
    Add-Fixture 'no-audio\Empty\note.txt' 'empty'
    Assert-Rejected { & $scriptPath -SourcePath (Join-Path $testRoot 'no-audio') } 'No WAV files'
    Assert-True (-not (Test-Path -LiteralPath (Join-Path $testRoot 'no-audio-sorted'))) 'Empty output created.'

    $junction = Join-Path $testRoot 'linked-source'
    $null = New-Item -ItemType Junction -Path $junction -Target $source
    try {
        Assert-Rejected { & $scriptPath -SourcePath $junction -WhatIf } 'Links and junctions'
    } finally {
        [System.IO.Directory]::Delete($junction)
    }
    $nestedJunction = Join-Path $source 'NonTTS\039_01\Waves\linked'
    $null = New-Item -ItemType Junction -Path $nestedJunction -Target $source
    try {
        Assert-Rejected {
            & $scriptPath -SourcePath $source -OutputPath (Join-Path $testRoot 'reject-links') -WhatIf
        } 'Links and junctions'
    } finally {
        [System.IO.Directory]::Delete($nestedJunction)
    }
    Write-Host 'All voice-folder sorting tests passed.'
} finally {
    Remove-Item -LiteralPath $testRoot -Recurse -Force
}
