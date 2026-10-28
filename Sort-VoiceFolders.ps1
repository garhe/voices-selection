<#
.SYNOPSIS
Sorts a voice collection into Main folder -> Voice folders -> WAV files.
.DESCRIPTION
By default, replaces the source at its original name and location after
verifying a staged copy. Original contents, including omitted non-WAV files,
are then permanently deleted. Confirmation is required by default.
Pass OutputPath to create a separate copy without changing the source.
Add ReplaceOriginal with OutputPath to install the sorted output at a new
location and permanently remove the original only after verifying the copy.
TTS and NonTTS are optional grouping folders;
their immediate child folders are voice names. Other immediate source folders
are already voice folders. All WAV files below each voice are flattened.
An explicit output must be a new directory outside the source tree.
.EXAMPLE
.\Sort-VoiceFolders.ps1 -SourcePath 'D:\Audio\es-ES Male VTS' -WhatIf
.EXAMPLE
.\Sort-VoiceFolders.ps1 -SourcePath 'D:\Audio\es-ES Male VTS' -OutputPath 'D:\Clean\es-ES Male VTS'
#>
[CmdletBinding(SupportsShouldProcess = $true, ConfirmImpact = 'High')]
param(
    [Parameter(Mandatory = $true)]
    [ValidateNotNullOrEmpty()]
    [string]$SourcePath,

    [ValidateNotNullOrEmpty()]
    [string]$OutputPath,

    [switch]$ReplaceOriginal
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Assert-NoFileSystemLink {
    param([System.IO.FileSystemInfo]$Item)

    # OneDrive placeholders are reparse points too, but have no filesystem LinkType.
    if (($Item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -and
        -not [string]::IsNullOrEmpty($Item.LinkType)) {
        throw "Links and junctions are not supported: $($Item.FullName)"
    }
}

function Get-CollectionEntries {
    param([System.IO.DirectoryInfo]$Directory)

    foreach ($entry in Get-ChildItem -LiteralPath $Directory.FullName -Force | Sort-Object Name) {
        Assert-NoFileSystemLink -Item $entry
        $entry
        if ($entry.PSIsContainer) {
            Get-CollectionEntries -Directory $entry
        }
    }
}

function Get-CollectionSnapshot {
    param([System.IO.DirectoryInfo]$Directory)

    $prefix = $Directory.FullName.TrimEnd([System.IO.Path]::DirectorySeparatorChar) +
        [System.IO.Path]::DirectorySeparatorChar
    foreach ($entry in Get-CollectionEntries -Directory $Directory) {
        [pscustomobject]@{
            Path = $entry.FullName.Substring($prefix.Length)
            IsDirectory = $entry.PSIsContainer
            Length = $(if ($entry.PSIsContainer) { 0 } else { $entry.Length })
            LastWriteTicks = $(if ($entry.PSIsContainer) { 0 } else { $entry.LastWriteTimeUtc.Ticks })
        }
    }
}

$source = Get-Item -LiteralPath $SourcePath -Force
if (-not ($source -is [System.IO.DirectoryInfo])) {
    throw 'SourcePath must be a filesystem directory.'
}
Assert-NoFileSystemLink -Item $source
if (-not $source.Parent) {
    throw 'Select a collection folder, not a drive root.'
}
$replaceSource = $ReplaceOriginal.IsPresent -or -not $PSBoundParameters.ContainsKey('OutputPath')
if (-not $PSBoundParameters.ContainsKey('OutputPath')) {
    $OutputPath = $source.FullName
}
$output = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($OutputPath)
$output = [System.IO.Path]::GetFullPath($output)
$separator = [System.IO.Path]::DirectorySeparatorChar
$sourcePrefix = $source.FullName.TrimEnd($separator) + $separator
$outputPrefix = $output.TrimEnd($separator) + $separator
$sameOutput = $outputPrefix.Equals($sourcePrefix, [System.StringComparison]::OrdinalIgnoreCase)
if (-not ($replaceSource -and $sameOutput) -and (
    $outputPrefix.StartsWith($sourcePrefix, [System.StringComparison]::OrdinalIgnoreCase) -or
    $sourcePrefix.StartsWith($outputPrefix, [System.StringComparison]::OrdinalIgnoreCase))) {
    throw 'Source and output must be separate, non-overlapping directories.'
}
if (-not ($replaceSource -and $sameOutput) -and (Test-Path -LiteralPath $output)) {
    throw "Output already exists. Choose a new output folder: $output"
}

$plan = New-Object 'System.Collections.Generic.List[object]'
$usedNames = @{}
$ignoredFiles = 0
$sourceSnapshot = @(Get-CollectionSnapshot -Directory $source)
$rootEntries = @(Get-ChildItem -LiteralPath $source.FullName -Force | Sort-Object Name)
foreach ($entry in $rootEntries) {
    Assert-NoFileSystemLink -Item $entry
    if (-not $entry.PSIsContainer) {
        if ($entry.Extension -ieq '.wav') {
            throw "WAV file has no voice folder: $($entry.FullName)"
        }
        $ignoredFiles++
        continue
    }

    $voices = @($entry)
    if ($entry.Name -in @('TTS', 'NonTTS')) {
        $voices = @()
        foreach ($child in Get-ChildItem -LiteralPath $entry.FullName -Force | Sort-Object Name) {
            Assert-NoFileSystemLink -Item $child
            if ($child.PSIsContainer) {
                $voices += $child
            } elseif ($child.Extension -ieq '.wav') {
                throw "WAV file has no voice folder: $($child.FullName)"
            } else {
                $ignoredFiles++
            }
        }
    }

    foreach ($voice in $voices) {
        foreach ($file in Get-CollectionEntries -Directory $voice | Where-Object { -not $_.PSIsContainer }) {
            if ($file.Extension -ine '.wav') {
                $ignoredFiles++
                continue
            }
            if (-not $usedNames.ContainsKey($voice.Name)) {
                $usedNames[$voice.Name] = @{}
            }
            $names = $usedNames[$voice.Name]
            $name = $file.Name
            $suffix = 2
            while ($names.ContainsKey($name)) {
                $name = '{0}__{1}{2}' -f $file.BaseName, $suffix, $file.Extension
                $suffix++
            }
            $names[$name] = $true
            $plan.Add([pscustomobject]@{
                Source = $file.FullName
                Destination = Join-Path (Join-Path $output $voice.Name) $name
                Renamed = $name -cne $file.Name
            })
        }
    }
}

if ($plan.Count -eq 0) {
    throw 'No WAV files were found in voice folders. No output was created.'
}

$renamedCount = @($plan | Where-Object Renamed).Count
Write-Host ("Plan: {0} WAV files, {1} voices, {2} duplicate names renamed; {3} non-WAV files omitted." -f
    $plan.Count, $usedNames.Count, $renamedCount, $ignoredFiles)
$operation = "Create a cleaned copy of $($plan.Count) WAV files (source unchanged)"
if ($replaceSource) {
    $operation = "Replace this collection with $($plan.Count) verified WAV files; PERMANENTLY DELETE original contents, including $ignoredFiles omitted non-WAV files"
}
if (-not $PSCmdlet.ShouldProcess($output, $operation)) {
    $plan
    return
}

$copyRoot = $output
$originalRoot = $null
if ($replaceSource) {
    $copyRoot = Join-Path ([System.IO.Path]::GetDirectoryName($output)) ('.voice-sort-staged-' + [guid]::NewGuid().ToString('N'))
    $originalRoot = Join-Path $source.Parent.FullName ('.voice-sort-original-' + [guid]::NewGuid().ToString('N'))
}

try {
    # Recheck after confirmation; never merge with an existing output collection.
    if (Test-Path -LiteralPath $copyRoot) {
        throw "Output now exists. Choose a new output folder: $copyRoot"
    }
    $null = [System.IO.Directory]::CreateDirectory($copyRoot)
    foreach ($item in $plan) {
        $destination = $item.Destination
        if ($replaceSource) {
            $destination = Join-Path $copyRoot ($item.Destination.Substring($outputPrefix.Length))
        }
        $null = [System.IO.Directory]::CreateDirectory([System.IO.Path]::GetDirectoryName($destination))
        [System.IO.File]::Copy($item.Source, $destination, $false)
        $sourceHash = (Get-FileHash -LiteralPath $item.Source -Algorithm SHA256).Hash
        $destinationHash = (Get-FileHash -LiteralPath $destination -Algorithm SHA256).Hash
        if ($sourceHash -ne $destinationHash) {
            throw "SHA256 verification failed: $($item.Source)"
        }
    }
    $currentSnapshot = @(Get-CollectionSnapshot -Directory $source)
    if (Compare-Object $sourceSnapshot $currentSnapshot -Property Path, IsDirectory, Length, LastWriteTicks -CaseSensitive) {
        throw 'Source contents changed while sorting. Close other applications and retry.'
    }
} catch {
    throw "Copy or verification failed. Originals are unchanged. Output may be incomplete at '$copyRoot': $($_.Exception.Message)"
}

if ($replaceSource) {
    $originalMoved = $false
    try {
        [System.IO.Directory]::Move($source.FullName, $originalRoot)
        $originalMoved = $true
        [System.IO.Directory]::Move($copyRoot, $output)
    } catch {
        $replacementError = $_.Exception.Message
        if ($originalMoved) {
            try {
                [System.IO.Directory]::Move($originalRoot, $source.FullName)
            } catch {
                throw "Replacement failed: $replacementError. Automatic restore also failed: $($_.Exception.Message). Originals are retained at '$originalRoot'; verified sorted files are at '$copyRoot'. Do not delete either folder until recovered."
            }
        }
        throw "Replacement failed: $replacementError. Originals remain at '$($source.FullName)'; verified sorted files are at '$copyRoot'."
    }
    try {
        $retainedOriginal = Get-Item -LiteralPath $originalRoot -Force
        Assert-NoFileSystemLink -Item $retainedOriginal
        $retainedSnapshot = @(Get-CollectionSnapshot -Directory $retainedOriginal)
        if (Compare-Object $sourceSnapshot $retainedSnapshot -Property Path, IsDirectory, Length, LastWriteTicks -CaseSensitive) {
            throw 'Original contents changed before deletion; they have been retained for inspection.'
        }
        Remove-Item -LiteralPath $originalRoot -Recurse -Force -ErrorAction Stop
    } catch {
        throw "Sorted replacement is installed at '$output', but original cleanup failed: $($_.Exception.Message). Remaining originals are at '$originalRoot'."
    }
}

[pscustomobject]@{
    OutputPath = $output
    WavFiles = $plan.Count
    VoiceFolders = $usedNames.Count
    RenamedFiles = $renamedCount
    OmittedFiles = $ignoredFiles
    ReplacedSource = $replaceSource
    VerifiedFiles = $plan.Count
}
