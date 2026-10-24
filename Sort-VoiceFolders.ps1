<#
.SYNOPSIS
Copies a voice collection into Main folder -> Voice folders -> WAV files.
.DESCRIPTION
The source is never changed. TTS and NonTTS are optional grouping folders;
their immediate child folders are voice names. Other immediate source folders
are already voice folders. All WAV files below each voice are flattened.
The output must be a new directory outside the source tree.
.EXAMPLE
.\Sort-VoiceFolders.ps1 -SourcePath 'D:\Audio\es-ES Male VTS' -WhatIf
.EXAMPLE
.\Sort-VoiceFolders.ps1 -SourcePath 'D:\Audio\es-ES Male VTS' -OutputPath 'D:\Clean\es-ES Male VTS'
#>
[CmdletBinding(SupportsShouldProcess = $true, ConfirmImpact = 'Medium')]
param(
    [Parameter(Mandatory = $true)]
    [ValidateNotNullOrEmpty()]
    [string]$SourcePath,

    [ValidateNotNullOrEmpty()]
    [string]$OutputPath
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

function Get-CollectionFiles {
    param([System.IO.DirectoryInfo]$Directory)

    foreach ($entry in Get-ChildItem -LiteralPath $Directory.FullName -Force | Sort-Object Name) {
        Assert-NoFileSystemLink -Item $entry
        if ($entry.PSIsContainer) {
            Get-CollectionFiles -Directory $entry
        } else {
            $entry
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
if (-not $OutputPath) {
    $OutputPath = Join-Path $source.Parent.FullName ($source.Name + '-sorted')
}
$output = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($OutputPath)
$output = [System.IO.Path]::GetFullPath($output)
$separator = [System.IO.Path]::DirectorySeparatorChar
$sourcePrefix = $source.FullName.TrimEnd($separator) + $separator
$outputPrefix = $output.TrimEnd($separator) + $separator
if ($outputPrefix.StartsWith($sourcePrefix, [System.StringComparison]::OrdinalIgnoreCase) -or
    $sourcePrefix.StartsWith($outputPrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw 'Source and output must be separate, non-overlapping directories.'
}
if (Test-Path -LiteralPath $output) {
    throw "Output already exists. Choose a new output folder: $output"
}

$plan = New-Object 'System.Collections.Generic.List[object]'
$usedNames = @{}
$ignoredFiles = 0
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
        foreach ($file in Get-CollectionFiles -Directory $voice) {
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
if (-not $PSCmdlet.ShouldProcess($output, "Create a cleaned copy of $($plan.Count) WAV files (source unchanged)")) {
    $plan
    return
}

try {
    # Recheck after confirmation; never merge with an existing output collection.
    if (Test-Path -LiteralPath $output) {
        throw "Output now exists. Choose a new output folder: $output"
    }
    $null = [System.IO.Directory]::CreateDirectory($output)
    foreach ($item in $plan) {
        $null = [System.IO.Directory]::CreateDirectory([System.IO.Path]::GetDirectoryName($item.Destination))
        [System.IO.File]::Copy($item.Source, $item.Destination, $false)
    }
} catch {
    throw "Copy failed. Originals are unchanged. Output may be incomplete at '$output': $($_.Exception.Message)"
}

[pscustomobject]@{
    OutputPath = $output
    WavFiles = $plan.Count
    VoiceFolders = $usedNames.Count
    RenamedFiles = $renamedCount
    OmittedFiles = $ignoredFiles
}
