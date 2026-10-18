# scripts/qa/teardown.ps1
#
# Gate 0 QA harness - stop the isolated server and delete the throw-away DSH home.
#
# Isolation (M0): everything this harness creates lives in <repo>\.spike-home.
# Teardown deletes that WHOLE directory and nothing else. The real DSH home
# (%USERPROFILE%\.dsh) is only fingerprinted before/after to prove it is untouched.
#
# What it does:
#   1. stops the harness web server (if running);
#   2. archives the isolated profile package.json + plugin record file into evidence;
#   3. deletes <repo>\.spike-home recursively (path is re-validated: inside repo +
#      named .spike-home* + never the real DSH home);
#   4. proves the real DSH home / desktop / web profiles are unchanged by teardown;
#   5. verifies the spike port is free.
#
# It NEVER deletes:
#   * %USERPROFILE%\.dsh (real home) - not even the pre-isolation groups-spike artifact
#     that predates the M0 isolation change (reported, left for the Lead to decide);
#   * anything outside the disposable .spike-home directory.
#
# Usage:
#   pwsh -NoProfile -File scripts/qa/teardown.ps1
#   pwsh -NoProfile -File scripts/qa/teardown.ps1 -QaHome <repo>\.spike-home-qa
#
# Exit codes: 0 = PASS (disposable home gone, real home intact), 1 = failure.

[CmdletBinding()]
param(
    [int]$Port = 4402,
    [string]$QaHome,
    [string]$EvidenceDir
)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'common.ps1')

if (-not [string]::IsNullOrWhiteSpace($QaHome)) { Set-QaHome -Path $QaHome }
Assert-QaHome

$exitCode = 0
$timestamp = Get-QaTimestamp
$evidence = Get-QaEvidenceDir -EvidenceDir $EvidenceDir
$logs = Join-Path $evidence 'logs'
if (-not (Test-Path -LiteralPath $logs)) { New-Item -ItemType Directory -Force -Path $logs | Out-Null }
$teardownLog = Join-Path $logs "teardown-$timestamp.log"
$evidencePath = Join-Path $evidence "teardown-$timestamp.json"

$teardown = [ordered]@{
    kind            = 'gate0-teardown'
    createdAt       = Get-QaUtcNowIso
    spikeHome       = (Get-QaHome)
    spikeHomeRemoved = $false
    realDshHome     = (Get-QaRealDshHome)
    profile         = $script:QaAllowedProfile
    profileDir      = (Get-QaProfileDir)
    port            = $Port
    archived        = @()
    groupFile       = $null
    realHomeBefore  = $null
    realHomeAfter   = $null
    realHomeUnchanged = $null
    realHomeQaArtifact = $null
    checks          = @()
    result          = 'FAIL'
}

try {
    Write-Host ''
    Write-Host '============================================================'
    Write-Host ' Gate 0 QA harness - teardown isolated DSH home'
    Write-Host '============================================================'
    Reset-QaChecks
    Assert-QaProfile -Profile $script:QaAllowedProfile
    Assert-QaPort -Port $Port
    Assert-QaHome
    Write-QaLogLine -Message "tearing down: $(Get-QaHome)" -LogFile $teardownLog
    Write-QaLogLine -Message "real home (read-only): $(Get-QaRealDshHome)" -LogFile $teardownLog

    # -- 1. stop the isolated server ---------------------------------------
    $listenerPid = Get-QaPortOwnerPid -Port $Port
    if ($listenerPid) {
        Write-QaLogLine -Message "stopping harness server on port $Port (pid $listenerPid)"
        & (Join-Path $PSScriptRoot 'stop-web.ps1') -Port $Port -QaHome (Get-QaHome) -EvidenceDir $evidence | Out-Host
        $stopCode = $LASTEXITCODE
        Add-QaCheck -Id 'TD-1' -Description 'isolated web server stopped' -Pass ($stopCode -eq 0) -Detail ("stop-web exit=$stopCode")
        if ($stopCode -ne 0) { throw "stop-web.ps1 failed with exit $stopCode" }
    } else {
        Add-QaCheck -Id 'TD-1' -Description 'no isolated web server was running' -Pass $true
    }

    # -- 2. real-home snapshot before the deletion -------------------------
    $realHomeBefore = Get-QaRealHomeState
    $teardown.realHomeBefore = $realHomeBefore
    $teardown.realHomeQaArtifact = Get-QaProp -Object (Get-QaProp -Object $realHomeBefore -Name 'profiles') -Name $script:QaAllowedProfile |
        ForEach-Object { [pscustomobject]@{ exists = (Get-QaProp -Object $_ -Name 'exists'); dir = (Get-QaProp -Object $_ -Name 'dir') } }

    # -- 3. archive record-worthy files before deleting the home -----------
    $archiveDir = Join-Path $evidence "teardown-$timestamp"
    New-Item -ItemType Directory -Force -Path $archiveDir | Out-Null
    $profileDir = Get-QaProfileDir
    $profilePackagePath = Join-Path $profileDir 'package.json'
    if (Test-Path -LiteralPath $profilePackagePath -PathType Leaf) {
        $target = Join-Path $archiveDir 'groups-spike.isolated-profile-package.json'
        Copy-Item -LiteralPath $profilePackagePath -Destination $target -Force
        $teardown.archived += $target
    }
    $groupFilePath = Join-Path (Get-QaStoragesDir) $script:QaGroupFileName
    if (Test-Path -LiteralPath $groupFilePath -PathType Leaf) {
        $target = Join-Path $archiveDir $script:QaGroupFileName
        Copy-Item -LiteralPath $groupFilePath -Destination $target -Force
        $teardown.archived += $target
        $teardown.groupFile = Get-QaFileStamp -Path $target
        Add-QaCheck -Id 'TD-2' -Description 'plugin record file archived before home deletion' -Pass $true -Detail $target
    } else {
        Add-QaCheck -Id 'TD-2' -Description 'plugin record file absent (nothing to archive)' -Pass $true
    }

    # -- 4. delete ONLY the disposable home --------------------------------
    $homePath = [System.IO.Path]::GetFullPath((Get-QaHome))
    $repo = [System.IO.Path]::GetFullPath((Get-QaRepoRoot))
    $real = [System.IO.Path]::GetFullPath((Get-QaRealDshHome))
    $relative = $homePath.Substring($repo.Length).TrimStart('\', '/')
    $safe = $homePath.StartsWith($repo + [System.IO.Path]::DirectorySeparatorChar, [System.StringComparison]::OrdinalIgnoreCase) -and
        (($relative -match '^\.spike-homes[\\/][^\\/]+$') -or ((Split-Path -Leaf $homePath) -like '.spike-home*')) -and
        ($homePath.TrimEnd('\') -ine $real.TrimEnd('\'))
    Add-QaCheck -Id 'TD-3' -Description 'disposable home deletion path re-validated (repo/.spike-homes/<agent> or legacy .spike-home*, not real home)' `
        -Pass $safe -Detail $homePath
    if (-not $safe) { throw "refusing to delete '$homePath' (unsafe disposable home path)" }
    if (Test-Path -LiteralPath $homePath) {
        Remove-Item -LiteralPath $homePath -Recurse -Force
    }
    $teardown.spikeHomeRemoved = -not (Test-Path -LiteralPath $homePath)
    Add-QaCheck -Id 'TD-4' -Description 'disposable .spike-home deleted entirely' -Pass $teardown.spikeHomeRemoved -Detail $homePath

    # -- 5. prove the real DSH home is untouched ---------------------------
    $realHomeAfter = Get-QaRealHomeState
    $teardown.realHomeAfter = $realHomeAfter
    $realComparison = Test-QaRealHomeUnchanged -Before $realHomeBefore -After $realHomeAfter
    $teardown.realHomeUnchanged = $realComparison.unchanged
    Add-QaCheck -Id 'TD-5' -Description 'real DSH home unchanged by teardown (workspace.json / desktop / web / sessions)' `
        -Pass $realComparison.unchanged -Detail (($realComparison.problems + @('(no changes)'))[0])

    $portFree = -not (Get-QaPortOwnerPid -Port $Port)
    Add-QaCheck -Id 'TD-6' -Description "port $Port is free after teardown" -Pass $portFree

    # Report the pre-isolation artifact in the real home without touching it.
    if ($teardown.realHomeQaArtifact -and $teardown.realHomeQaArtifact.exists) {
        Write-Host ("  [INFO] pre-isolation artifact still exists in real home: {0} (NOT touched by this harness)" -f $teardown.realHomeQaArtifact.dir)
    }

    $teardown.result = 'PASS'
} catch {
    Write-Host ''
    Write-Host ("TEARDOWN ERROR: {0}" -f $_.Exception.Message) -ForegroundColor Red
    $teardown.error = $_.Exception.Message
    $exitCode = 1
} finally {
    if ($exitCode -eq 0 -and -not (Write-QaSummary -Title 'teardown-profile (isolated home)' -EvidencePath $evidencePath)) {
        $exitCode = 1
    }
    if ($exitCode -ne 0) { $teardown.result = 'FAIL' }
    $teardown.checks = @(Get-QaChecks)
    try { Write-QaEvidenceJson -Path $evidencePath -Data $teardown | Out-Null } catch { }
}

exit $exitCode





