# scripts/spike/run-gate0.ps1
#
# Gate 0 QA harness - one-shot pipeline.
#
# Runs, fail-fast:
#   1. setup-profile.ps1        recreate groups-spike + install the two spike plugins
#   2. start-web.ps1            boot the isolated web UI on 4402 (captures token URL)
#   3. smoke.ps1                HTTP contract + headless-browser console check
#   4. audit (load-only)        snapshot -> HTTP load -> snapshot: nothing but the record file may change
#   5. audit (-CommitProbe)     commit probe: only dsh-session-groups.json changes, revision +1
#   6. teardown-profile.ps1     stop server, delete the disposable profile, prove desktop/web untouched
#
# On failure the server is stopped but the profile + evidence are KEPT for debugging.
#
# Usage:
#   pwsh -NoProfile -File scripts/spike/run-gate0.ps1
#   pwsh -NoProfile -File scripts/spike/run-gate0.ps1 -KeepProfile -SkipBrowser
#
# Exit codes: 0 = all steps PASS, 1 = a step failed.

[CmdletBinding()]
param(
    [int]$Port = 4402,
    [string]$SpikeHome,
    [switch]$KeepProfile,
    [switch]$SkipSetup,
    [switch]$SkipSmoke,
    [switch]$SkipAudit,
    [switch]$SkipBrowser,
    [switch]$NoFixtures,
    [switch]$NoSessionFixtures,
    [switch]$AllowIncompletePlugins,
    [int]$Retries = 2,
    [string]$EvidenceDir
)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'common.ps1')

if (-not [string]::IsNullOrWhiteSpace($SpikeHome)) { Set-SpikeHome -Path $SpikeHome }
Assert-SpikeHome

$timestamp = Get-SpikeTimestamp
$evidence = Get-SpikeEvidenceDir -EvidenceDir $EvidenceDir
$logs = Join-Path $evidence 'logs'
if (-not (Test-Path -LiteralPath $logs)) { New-Item -ItemType Directory -Force -Path $logs | Out-Null }
$pipelineLog = Join-Path $logs "run-gate0-$timestamp.log"
$steps = New-Object System.Collections.ArrayList

function Invoke-Step {
    param(
        [Parameter(Mandatory)][string]$Name,
        [Parameter(Mandatory)][scriptblock]$Action
    )
    Write-Host ''
    Write-Host ('>>>> {0}' -f $Name) -ForegroundColor Cyan
    $started = Get-Date
    $scriptBlockError = $null
    try {
        & $Action
        $code = $LASTEXITCODE
        if ($null -eq $code) { $code = 0 }
    } catch {
        $scriptBlockError = $_.Exception.Message
        $code = 1
    }
    $elapsed = [int]((Get-Date) - $started).TotalSeconds
    $result = [pscustomobject]@{
        step      = $Name
        exitCode  = $code
        seconds   = $elapsed
        error     = $scriptBlockError
    }
    [void]$steps.Add($result)
    $status = if ($code -eq 0) { 'PASS' } else { 'FAIL' }
    $line = ('[{0}] {1} (exit={2}, {3}s)' -f $status, $Name, $code, $elapsed)
    Write-SpikeLogLine -Message $line -LogFile $pipelineLog
    if ($code -ne 0) { throw ("step failed: {0}{1}" -f $Name, $(if ($scriptBlockError) { " ($scriptBlockError)" } else { '' })) }
    return $code
}

$gate0Pass = $false
$failure = $null
try {
    Write-Host ''
    Write-Host '============================================================'
    Write-Host ' Gate 0 QA harness - full pipeline'
    Write-Host '============================================================'
    Write-SpikeLogLine -Message ("repo: {0}" -f (Get-SpikeRepoRoot)) -LogFile $pipelineLog
    Write-SpikeLogLine -Message ("isolated DSH home: {0} (port {1})" -f (Get-SpikeHome), $Port) -LogFile $pipelineLog
    Write-SpikeLogLine -Message ("real DSH home (read-only): {0}" -f (Get-SpikeRealDshHome)) -LogFile $pipelineLog
    Assert-SpikeProfile -Profile $script:SpikeAllowedProfile
    Assert-SpikePort -Port $Port

    if (-not $SkipSetup) {
        Invoke-Step -Name 'setup-profile' -Action {
            # Hashtable splatting = named parameters (an array splat would bind positionally).
            $stepArgs = @{
                Port                    = $Port
                SpikeHome               = (Get-SpikeHome)
                EvidenceDir             = $evidence
                NoFixtures              = [bool]$NoFixtures
                NoSessionFixtures       = [bool]$NoSessionFixtures
                AllowIncompletePlugins  = [bool]$AllowIncompletePlugins
            }
            & (Join-Path $PSScriptRoot 'setup-profile.ps1') @stepArgs
        }
    } else {
        Write-SpikeLogLine -Message 'setup-profile skipped (-SkipSetup)'
        $package = Read-SpikeProfilePackage
        if (-not $package) { throw 'isolated profile groups-spike not installed and -SkipSetup was set' }
        Invoke-Step -Name 'verify-profile-preexisting' -Action {
            Add-SpikeCheck -Id 'PRE-1' -Description 'pre-existing isolated groups-spike profile is present' -Pass $true
            Write-SpikeSummary -Title 'pre-existing isolated profile' | Out-Null
        }
    }

    Invoke-Step -Name 'start-web' -Action {
        & (Join-Path $PSScriptRoot 'start-web.ps1') -Port $Port -Profile $script:SpikeAllowedProfile `
            -SpikeHome (Get-SpikeHome) -EvidenceDir $evidence
    }

    if (-not $SkipSmoke) {
        Invoke-Step -Name 'smoke' -Action {
            $stepArgs = @{
                Port        = $Port
                FenceProbe  = $true
                EvidenceDir = $evidence
                Browser     = $(if ($SkipBrowser) { 'none' } else { 'auto' })
            }
            & (Join-Path $PSScriptRoot 'smoke.ps1') @stepArgs
        }
    } else {
        Write-SpikeLogLine -Message 'smoke skipped (-SkipSmoke)'
    }

    if (-not $SkipAudit) {
        Invoke-Step -Name 'audit-load-only' -Action {
            & (Join-Path $PSScriptRoot 'audit-no-host-writes.ps1') -Mode exercise -Port $Port `
                -SpikeHome (Get-SpikeHome) -EvidenceDir $evidence -Retries $Retries
        }
        Invoke-Step -Name 'audit-commit-probe' -Action {
            & (Join-Path $PSScriptRoot 'audit-no-host-writes.ps1') -Mode exercise -Port $Port -CommitProbe `
                -SpikeHome (Get-SpikeHome) -EvidenceDir $evidence -Retries $Retries
        }
    } else {
        Write-SpikeLogLine -Message 'audit skipped (-SkipAudit)'
    }

    if (-not $KeepProfile) {
        Invoke-Step -Name 'teardown-profile' -Action {
            & (Join-Path $PSScriptRoot 'teardown-profile.ps1') -Port $Port -SpikeHome (Get-SpikeHome) -EvidenceDir $evidence
        }
    } else {
        Write-SpikeLogLine -Message 'teardown skipped (-KeepProfile): server left RUNNING on port; stop it with stop-web.ps1'
    }

    $gate0Pass = $true
} catch {
    $failure = $_.Exception.Message
    Write-Host ''
    Write-Host ('GATE 0 PIPELINE FAILED: {0}' -f $failure) -ForegroundColor Red
} finally {
    if (-not $gate0Pass) {
        Write-Host ''
        Write-Host '--- cleaning up: stopping any harness server (profile + evidence kept for debugging) ---'
        try {
            if (Get-SpikePortOwnerPid -Port $Port) {
                & (Join-Path $PSScriptRoot 'stop-web.ps1') -Port $Port -SpikeHome (Get-SpikeHome) -EvidenceDir $evidence | Out-Host
            }
        } catch {
            Write-Host ("WARN: cleanup stop-web failed: {0}" -f $_.Exception.Message)
        }
    }

    Write-Host ''
    Write-Host '=============================='
    Write-Host ' Gate 0 pipeline summary'
    Write-Host '=============================='
    foreach ($step in $steps) {
        $status = if ($step.exitCode -eq 0) { 'PASS' } else { 'FAIL' }
        Write-Host ('  [{0}] {1} ({2}s)' -f $status, $step.step, $step.seconds)
    }
    if ($failure) { Write-Host ('  failure: {0}' -f $failure) }
    Write-Host ('  evidence: {0}' -f $evidence)
    Write-Host ('  pipeline log: {0}' -f $pipelineLog)

    $summaryPath = Join-Path $evidence "run-gate0-$timestamp.json"
    try {
        Write-SpikeEvidenceJson -Path $summaryPath -Data ([ordered]@{
                kind      = 'gate0-pipeline'
                createdAt = Get-SpikeUtcNowIso
                spikeHome = Get-SpikeHome
                realDshHome = Get-SpikeRealDshHome
                port      = $Port
                steps     = @($steps)
                failure   = $failure
                result    = $(if ($gate0Pass) { 'PASS' } else { 'FAIL' })
            }) | Out-Null
    } catch { }
}

Write-Host ''
if ($gate0Pass) {
    Write-Host 'GATE 0 PIPELINE: PASS' -ForegroundColor Green
    exit 0
}
Write-Host 'GATE 0 PIPELINE: FAIL' -ForegroundColor Red
exit 1



