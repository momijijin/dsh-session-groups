# scripts/spike/cleanup-real-home.ps1
#
# Gate 0 QA harness - ONE-OFF cleanup of the pre-isolation spike artefacts that the
# earlier (M0-before) experiments left in the REAL DSH home.
#
# docs/SPIKE.md §0:
#   "真实 home 里已有的 spike 痕迹（storages/dsh-session-groups.json、真实
#    groups-spike profile）由 QA 在 Gate 0 结束后统一清理；清理前先确认路径。"
#
# What it will remove (AFTER printing every absolute path):
#   1. %USERPROFILE%\.dsh\profiles\groups-spike\        (profile created before M0 isolation)
#   2. %USERPROFILE%\.dsh\storages\dsh-session-groups.json*  (host spike record file family:
#      .json, .json.bak, .json.tmp, .json.corrupt-<ts>)
#
# Safety:
#   * DEFAULT IS DRY-RUN: prints the absolute paths and a verification plan, deletes nothing.
#     Pass -Apply to actually delete.
#   * Requires spike/host-plugin/evidence/real-home-quarantine to exist before removing the
#     storage record files (host moves its evidence there first) unless -Force is passed.
#   * Every path is validated: profile dir must be exactly <realHome>\profiles\groups-spike;
#     storage files must be named dsh-session-groups.json* directly under <realHome>\storages.
#   * The real workspace.json / sessions / desktop / web profiles are fingerprinted before
#     and after and asserted unchanged.
#   * Does NOT touch .spike-home* / .spike-homes/** (other agents' disposable homes) - they
#     are only reported.
#
# Usage:
#   pwsh -NoProfile -File scripts/spike/cleanup-real-home.ps1              # dry-run, print paths
#   pwsh -NoProfile -File scripts/spike/cleanup-real-home.ps1 -Apply       # delete
#   pwsh -NoProfile -File scripts/spike/cleanup-real-home.ps1 -Apply -Force  # skip quarantine gate
#
# Exit codes: 0 = PASS (dry-run listed, or applied+verified), 1 = FAIL/refused.

[CmdletBinding()]
param(
    [switch]$Apply,
    [switch]$Force,
    [string]$EvidenceDir
)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'common.ps1')

$exitCode = 0
$timestamp = Get-SpikeTimestamp
$evidence = Get-SpikeEvidenceDir -EvidenceDir $EvidenceDir
$logs = Join-Path $evidence 'logs'
if (-not (Test-Path -LiteralPath $logs)) { New-Item -ItemType Directory -Force -Path $logs | Out-Null }
$evidencePath = Join-Path $evidence "cleanup-real-home-$timestamp.json"
$realHome = Get-SpikeRealDshHome
$quarantineDir = Join-Path (Get-SpikeRepoRoot) 'spike\host-plugin\evidence\real-home-quarantine'

$report = [ordered]@{
    kind          = 'gate0-cleanup-real-home'
    createdAt     = Get-SpikeUtcNowIso
    apply         = [bool]$Apply
    force         = [bool]$Force
    realDshHome   = $realHome
    quarantineDir = $quarantineDir
    targets       = @()
    plannedDeletes = @()
    realHomeBefore = $null
    realHomeAfter  = $null
    checks        = @()
    result        = 'FAIL'
}

function Get-RealHomeSpikeArtifacts {
    $artifacts = @()
    # 1. pre-isolation profile (docs/SPIKE.md §0).
    $profileDir = Join-Path $realHome 'profiles\groups-spike'
    if (Test-Path -LiteralPath $profileDir -PathType Container) {
        $profileFiles = @(Get-ChildItem -LiteralPath $profileDir -Recurse -File -Force -ErrorAction SilentlyContinue)
        $artifacts += [pscustomobject]@{
            kind       = 'profile'
            path       = [System.IO.Path]::GetFullPath((Resolve-Path -LiteralPath $profileDir).Path)
            files      = $profileFiles.Count
            bytes      = [long](($profileFiles | Measure-Object -Property Length -Sum).Sum)
            removeable = $true
        }
    }
    # 2. host spike record file family under storages.
    $storages = Join-Path $realHome 'storages'
    if (Test-Path -LiteralPath $storages -PathType Container) {
        foreach ($file in @(Get-ChildItem -LiteralPath $storages -File -Force -ErrorAction SilentlyContinue |
                    Where-Object { $_.Name -like 'dsh-session-groups.json*' } | Sort-Object Name)) {
            $artifacts += [pscustomobject]@{
                kind       = 'storage-record'
                path       = [System.IO.Path]::GetFullPath($file.FullName)
                files      = 1
                bytes      = [long]$file.Length
                removeable = $true
            }
        }
    }
    return @($artifacts)
}

try {
    Write-Host ''
    Write-Host '============================================================'
    Write-Host ' Gate 0 QA harness - real DSH home cleanup (pre-isolation artifacts)'
    Write-Host '============================================================'
    Reset-SpikeChecks
    Write-Host ("real DSH home: {0}" -f $realHome)
    Write-Host ("mode:          {0}" -f ($(if ($Apply) { 'APPLY (delete)' } else { 'DRY-RUN (print only; pass -Apply to delete)' })))
    Write-Host ''
    if (-not (Test-Path -LiteralPath $realHome -PathType Container)) {
        throw "real DSH home not found: $realHome"
    }
    if ([System.IO.Path]::GetFullPath($realHome) -ieq [System.IO.Path]::GetFullPath((Get-SpikeHome))) {
        throw 'refusing to clean the real DSH home because it equals the disposable spike home'
    }

    $realHomeBefore = Get-SpikeRealHomeState
    $report.realHomeBefore = $realHomeBefore

    $artifacts = @(Get-RealHomeSpikeArtifacts)
    $report.targets = $artifacts
    Write-Host 'Targets found in the REAL home:'
    if ($artifacts.Count -eq 0) {
        Write-Host '  (none - nothing to clean)'
    } else {
        foreach ($artifact in $artifacts) {
            Write-Host ('  [{0}] {1}  ({2} file(s), {3} bytes)' -f $artifact.kind, $artifact.path, $artifact.files, $artifact.bytes)
        }
    }
    Add-SpikeCheck -Id 'CLN-1' -Description 'target paths enumerated and printed' -Pass $true `
        -Detail ("{0} artifact(s)" -f $artifacts.Count)

    # Path validation: never delete anything outside the two known families.
    $validTargets = @()
    foreach ($artifact in $artifacts) {
        $full = [System.IO.Path]::GetFullPath($artifact.path)
        if ($artifact.kind -eq 'profile') {
            $expected = [System.IO.Path]::GetFullPath((Join-Path $realHome 'profiles\groups-spike'))
            $ok = ($full -ieq $expected) -and ((Split-Path -Leaf $full) -eq 'groups-spike') -and
                ((Split-Path -Leaf (Split-Path -Parent $full)) -ieq 'profiles')
        } elseif ($artifact.kind -eq 'storage-record') {
            $expectedDir = [System.IO.Path]::GetFullPath((Join-Path $realHome 'storages'))
            $ok = ((Split-Path -Parent $full) -ieq $expectedDir) -and ((Split-Path -Leaf $full) -like 'dsh-session-groups.json*')
        } else {
            $ok = $false
        }
        if ($ok) { $validTargets += $artifact } else { Add-SpikeCheck -Id 'CLN-2' -Description ("target path rejected: {0}" -f $full) -Pass $false }
    }
    Add-SpikeCheck -Id 'CLN-2' -Description 'all target paths re-validated (inside real home, known names only)' -Pass ($validTargets.Count -eq $artifacts.Count) `
        -Detail ("{0}/{1} valid" -f $validTargets.Count, $artifacts.Count)

    $recordTargets = @($validTargets | Where-Object { $_.kind -eq 'storage-record' })
    if ($recordTargets.Count -gt 0 -and -not (Test-Path -LiteralPath $quarantineDir -PathType Container) -and -not $Force) {
        throw ("host evidence quarantine not found: {0}. Ask host-engineer to move the real-home storage evidence there first, or pass -Force." -f $quarantineDir)
    }
    Add-SpikeCheck -Id 'CLN-3' -Description 'host evidence quarantine present (or waived by -Force)' `
        -Pass ((Test-Path -LiteralPath $quarantineDir -PathType Container) -or $Force -or ($recordTargets.Count -eq 0)) `
        -Detail $quarantineDir

    if (-not $Apply) {
        Write-Host ''
        Write-Host 'DRY-RUN: no files were deleted. Re-run with -Apply to delete the listed absolute paths.'
        $report.plannedDeletes = @($validTargets | ForEach-Object { $_.path })
        Add-SpikeCheck -Id 'CLN-4' -Description 'dry-run completed without deleting anything' -Pass $true
        $report.result = 'PASS-DRY-RUN'
    } else {
        foreach ($artifact in $validTargets) {
            Write-Host ('  deleting: {0}' -f $artifact.path)
            if ($artifact.kind -eq 'profile') {
                Remove-Item -LiteralPath $artifact.path -Recurse -Force
            } else {
                Remove-Item -LiteralPath $artifact.path -Force
            }
            $report.plannedDeletes += $artifact.path
        }
        $remaining = @(Get-RealHomeSpikeArtifacts)
        Add-SpikeCheck -Id 'CLN-4' -Description 'all listed spike artifacts removed from the real home' -Pass ($remaining.Count -eq 0) `
            -Detail ("remaining={0}" -f ($remaining.Count))
        $report.result = if ($remaining.Count -eq 0) { 'PASS' } else { 'FAIL' }
    }

    # Prove the rest of the real home is untouched.
    $realHomeAfter = Get-SpikeRealHomeState
    $report.realHomeAfter = $realHomeAfter
    $comparison = Test-SpikeRealHomeUnchanged -Before $realHomeBefore -After $realHomeAfter
    $expectedChange = $artifacts.Count -gt 0 -and $Apply
    if ($expectedChange -and -not $comparison.unchanged) {
        # Removal of profiles/groups-spike legitimately changes that profile fingerprint;
        # everything else (workspace.json / desktop / web / sessions) must stay identical.
        $problems = @($comparison.problems | Where-Object { $_ -ne "real profile 'groups-spike' changed" })
        $comparison = [pscustomobject]@{ unchanged = ($problems.Count -eq 0); problems = $problems }
    }
    Add-SpikeCheck -Id 'CLN-5' -Description 'real workspace.json / desktop / web / sessions unchanged' -Pass $comparison.unchanged `
        -Detail (($comparison.problems + @('(no changes)'))[0])

    # Report other disposable artefacts without touching them.
    Write-Host ''
    Write-Host 'Other disposable homes (NOT touched by this script):'
    foreach ($name in @('.spike-home', '.spike-home-client', '.spike-home-host')) {
        $path = Join-Path (Get-SpikeRepoRoot) $name
        if (Test-Path -LiteralPath $path) { Write-Host ('  legacy: {0}' -f $path) }
    }
    $homesRoot = Get-SpikeHomesRoot
    if (Test-Path -LiteralPath $homesRoot) {
        foreach ($dir in @(Get-ChildItem -LiteralPath $homesRoot -Directory -Force -ErrorAction SilentlyContinue)) {
            Write-Host ('  per-agent: {0}' -f $dir.FullName)
        }
    }
} catch {
    Write-Host ''
    Write-Host ("CLEANUP ERROR: {0}" -f $_.Exception.Message) -ForegroundColor Red
    $report.error = $_.Exception.Message
    $exitCode = 1
} finally {
    if ($exitCode -eq 0 -and -not (Write-SpikeSummary -Title 'cleanup-real-home' -EvidencePath $evidencePath)) {
        $exitCode = 1
    }
    if ($exitCode -ne 0) { $report.result = 'FAIL' }
    $report.checks = @(Get-SpikeChecks)
    try { Write-SpikeEvidenceJson -Path $evidencePath -Data $report | Out-Null } catch { }
}

exit $exitCode
