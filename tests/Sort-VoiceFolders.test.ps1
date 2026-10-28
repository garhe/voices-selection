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

    $preview = @(& $scriptPath -SourcePath $source -OutputPath $output -WhatIf)
    Assert-True ($preview.Count -eq 4) 'Preview must list all four copies.'
    Assert-True (-not (Test-Path -LiteralPath $output)) 'Preview created output.'
    $result = & $scriptPath -SourcePath $source -OutputPath $output -Confirm:$false
    Assert-True (-not $result.ReplacedSource -and $result.VerifiedFiles -eq $result.WavFiles) 'Separate copy was not verified or reported replacement.'
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

    Assert-Rejected { & $scriptPath -SourcePath $source -OutputPath $output } 'Output already exists'
    Assert-Rejected { & $scriptPath -SourcePath $source -OutputPath (Join-Path $source 'nested') } 'non-overlapping'
    Assert-Rejected { & $scriptPath -SourcePath $source -OutputPath $testRoot } 'non-overlapping'

    Add-Fixture 'en-GB female VTS\11labs_v4_Alice\sample.wav' 'flat'
    Add-Fixture 'en-GB female VTS\118_08\sample.wav' 'other'
    $flat = & $scriptPath -SourcePath (Join-Path $testRoot 'en-GB female VTS') -OutputPath (Join-Path $testRoot 'custom') -Confirm:$false
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

    Add-Fixture 'replacement\es-ES [Male] VTS\NonTTS\Voice\Waves\sample.wav' 'original wav'
    Add-Fixture 'replacement\es-ES [Male] VTS\TTS\Voice\sample.wav' 'duplicate wav'
    Add-Fixture 'replacement\es-ES [Male] VTS\TTS\Other\[01].WAV' 'other wav'
    Add-Fixture 'replacement\es-ES [Male] VTS\TTS\Empty\script.txt' 'omit script'
    Add-Fixture 'replacement\es-ES [Male] VTS\notes.txt' 'omit notes'
    $replaceSource = Join-Path $testRoot 'replacement\es-ES [Male] VTS'
    $replaceParent = Split-Path $replaceSource -Parent
    $originalHashes = @(Get-ChildItem -LiteralPath $replaceSource -Recurse -File | Get-FileHash)
    $replacePreview = @(& $scriptPath -SourcePath $replaceSource -WhatIf)
    Assert-True ($replacePreview.Count -eq 3) 'Replacement preview omitted WAVs.'
    Assert-True (@(Get-ChildItem -LiteralPath $replaceParent -Force).Count -eq 1) 'Preview created staging folders.'
    foreach ($item in $replacePreview) {
        Assert-True ($item.Destination.StartsWith($replaceSource + '\')) 'Preview did not use the original destination name.'
    }
    $unchangedHashes = @(Get-ChildItem -LiteralPath $replaceSource -Recurse -File | Get-FileHash)
    Assert-True (-not (Compare-Object $originalHashes $unchangedHashes -Property Path, Hash)) 'Replacement preview changed originals.'
    $replacement = & $scriptPath -SourcePath $replaceSource -Confirm:$false
    Assert-True ($replacement.OutputPath -eq $replaceSource) 'Replacement changed collection name/path.'
    Assert-True ($replacement.ReplacedSource -and $replacement.VerifiedFiles -eq 3) 'Replacement did not verify every WAV.'
    Assert-True ($replacement.WavFiles -eq 3 -and $replacement.VoiceFolders -eq 2 -and
        $replacement.RenamedFiles -eq 1 -and $replacement.OmittedFiles -eq 2) 'Wrong replacement counts.'
    $replacementFiles = @(Get-ChildItem -LiteralPath $replaceSource -Recurse -File)
    Assert-True ($replacementFiles.Count -eq 3) 'Replacement retained non-WAVs or lost audio.'
    foreach ($file in $replacementFiles) {
        Assert-True ($file.Extension -ieq '.wav' -and $file.Directory.Parent.FullName -eq $replaceSource) 'Replacement structure is not flat.'
        $hash = (Get-FileHash -LiteralPath $file.FullName).Hash
        Assert-True (@($originalHashes | Where-Object Hash -eq $hash).Count -eq 1) 'Replacement changed audio bytes.'
    }
    Assert-True (@(Get-ChildItem -LiteralPath $replaceParent -Force).Count -eq 1) 'Successful replacement retained original or staging folders.'
    $repeat = & $scriptPath -SourcePath $replaceSource -Confirm:$false
    Assert-True ($repeat.ReplacedSource -and $repeat.WavFiles -eq 3 -and $repeat.RenamedFiles -eq 0) 'Repeated sorting changed the flat collection.'
    Assert-Rejected { & $scriptPath -SourcePath $replaceSource -OutputPath $replaceSource } 'non-overlapping'

    Add-Fixture 'copy-failure\NonTTS\Voice\locked.wav' 'locked original'
    Add-Fixture 'copy-failure\notes.txt' 'keep original note'
    $failureSource = Join-Path $testRoot 'copy-failure'
    $locked = [System.IO.File]::Open((Join-Path $failureSource 'NonTTS\Voice\locked.wav'),
        [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, [System.IO.FileShare]::None)
    try {
        Assert-Rejected { & $scriptPath -SourcePath $failureSource -Confirm:$false } 'Originals are unchanged'
    } finally {
        $locked.Dispose()
    }
    Assert-True (Test-Path -LiteralPath (Join-Path $failureSource 'NonTTS\Voice\locked.wav')) 'Copy failure removed original WAV.'
    Assert-True (Test-Path -LiteralPath (Join-Path $failureSource 'notes.txt')) 'Copy failure removed omitted original.'

    Add-Fixture 'verification-failure\Voice\sample.wav' 'verify original'
    $verificationSource = Join-Path $testRoot 'verification-failure'
    function Get-FileHash {
        [CmdletBinding()]
        param([string]$LiteralPath, [string]$Algorithm)
        $hash = Microsoft.PowerShell.Utility\Get-FileHash @PSBoundParameters
        if ($LiteralPath -like '*\.voice-sort-staged-*\*') { $hash.Hash = 'synthetic mismatch' }
        $hash
    }
    try {
        Assert-Rejected { & $scriptPath -SourcePath $verificationSource -Confirm:$false } 'SHA256 verification failed'
    } finally {
        Remove-Item -LiteralPath Function:\Get-FileHash
    }
    Assert-True ([System.IO.File]::ReadAllText((Join-Path $verificationSource 'Voice\sample.wav')) -eq 'verify original') 'Verification failure changed originals.'

    Add-Fixture 'source-changed\Voice\sample.wav' 'initial audio'
    $mutationSource = Join-Path $testRoot 'source-changed'
    function Get-FileHash {
        [CmdletBinding()]
        param([string]$LiteralPath, [string]$Algorithm)
        $hash = Microsoft.PowerShell.Utility\Get-FileHash @PSBoundParameters
        if ($LiteralPath -like '*\.voice-sort-staged-*\*') {
            [System.IO.File]::WriteAllText((Join-Path $mutationSource 'new.txt'), 'concurrent edit')
        }
        $hash
    }
    try {
        Assert-Rejected { & $scriptPath -SourcePath $mutationSource -Confirm:$false } 'Source contents changed'
    } finally {
        Remove-Item -LiteralPath Function:\Get-FileHash
    }
    Assert-True (Test-Path -LiteralPath (Join-Path $mutationSource 'new.txt')) 'Concurrent source edit was deleted.'
    Assert-True (Test-Path -LiteralPath (Join-Path $mutationSource 'Voice\sample.wav')) 'Source-change rejection removed audio.'

    Add-Fixture 'cleanup-failure\NonTTS\Voice\sample.wav' 'cleanup original'
    Add-Fixture 'cleanup-failure\note.txt' 'retained after cleanup error'
    $cleanupSource = Join-Path $testRoot 'cleanup-failure'
    function Remove-Item {
        [CmdletBinding()]
        param([string]$LiteralPath, [switch]$Recurse, [switch]$Force)
        if ((Split-Path $LiteralPath -Leaf) -like '.voice-sort-original-*') {
            throw 'Synthetic original cleanup failure'
        }
        Microsoft.PowerShell.Management\Remove-Item @PSBoundParameters
    }
    try {
        Assert-Rejected { & $scriptPath -SourcePath $cleanupSource -Confirm:$false } 'Sorted replacement is installed'
    } finally {
        Microsoft.PowerShell.Management\Remove-Item -LiteralPath Function:\Remove-Item
    }
    Assert-True ([System.IO.File]::ReadAllText((Join-Path $cleanupSource 'Voice\sample.wav')) -eq 'cleanup original') 'Cleanup failure lost the verified replacement.'
    $retained = @(Get-ChildItem -LiteralPath $testRoot -Directory -Force |
        Where-Object { $_.Name -like '.voice-sort-original-*' })
    Assert-True ($retained.Count -eq 1) 'Cleanup failure did not retain originals for recovery.'
    Assert-True (Test-Path -LiteralPath (Join-Path $retained[0].FullName 'note.txt')) 'Cleanup failure lost omitted originals.'
    Write-Host 'All voice-folder sorting tests passed.'
} finally {
    Remove-Item -LiteralPath $testRoot -Recurse -Force
}
