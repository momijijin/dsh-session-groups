# scripts/qa/run-v1.ps1
#
# V1 QA harness - one-shot verification pipeline for the V1 plugin.
#
# Phases:
#   1. setup.ps1      throw-away DSH home (.spike-homes/qa) + fixtures + profile + V1 package
#   2. integration    node --test tests/integration  (H1-H10; auto-skips until src/host lands)
#   3. client build   `node scripts/build-client.mjs` when lib/client.js is missing (esbuild installed)
#   4. smoke          HTTP + headless-browser console check against 4402
#   5. e2e            e2e/groups.spec.mjs (20-step acceptance; zero-dependency CDP runner)
#   6. audit          only dsh-session-groups.json may change; real home fingerprint unchanged
#   7. teardown       stop server + delete .spike-homes/qa (unless -KeepProfile)
#
# Exit codes: 0 = all executed phases PASS (E2E BLOCKED is recorded, not failed, unless
#             -RequireE2E), 1 = a phase FAILED, 2 = setup/harness error.

[CmdletBinding()]
param(
    [int]$Port = 4402,
    [string]$QaHome,
    [switch]$SkipSetup,
    [switch]$SkipIntegration,
    [switch]$SkipBuild,
    [switch]$SkipSmoke,
    [switch]$SkipE2E,
    [switch]$SkipAudit,
    [switch]$SkipBrowser,
    [switch]$RequireE2E,
    [switch]$KeepProfile,
    [string]$EvidenceDir
)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'common.ps1')

if (-not [string]::IsNullOrWhiteSpace($QaHome)) { Set-QaHome -Path $QaHome }
Assert-QaHome

$timestamp = Get-QaTimestamp
$evidence = Get-QaEvidenceDir -EvidenceDir $EvidenceDir
$logs = Join-Path $evidence 'logs'
if (-not (Test-Path -LiteralPath $logs)) { New-Item -ItemType Directory -Force -Path $logs | Out-Null }
$pipelineLog = Join-Path $logs "run-v1-$timestamp.log"
$repoRoot = Get-QaRepoRoot
$node = (Get-Command node -ErrorAction Stop).Source
$steps = New-Object System.Collections.ArrayList
$script:failed = $false
$script:blocked = @()

function Add-Step {
    param([string]$Name, [int]$ExitCode, [int]$Seconds, [string]$Detail, [string]$Log)
    $status = if ($ExitCode -eq 0) { 'PASS' } elseif ($ExitCode -eq 3) { 'BLOCKED' } else { 'FAIL' }
    [void]$steps.Add([pscustomobject]@{ step = $Name; exitCode = $ExitCode; seconds = $Seconds; detail = $Detail; log = $Log })
    Write-QaLogLine -Message ("[{0}] {1} (exit={2}, {3}s) {4}" -f $status, $Name, $ExitCode, $Seconds, $Detail) -LogFile $pipelineLog
    if ($ExitCode -eq 3) { $script:blocked += $Name }
    elseif ($ExitCode -ne 0) { $script:failed = $true }
}

try {
    Write-Host ''
    Write-Host '============================================================'
    Write-Host ' V1 QA harness - full pipeline (isolated .spike-homes/qa + 4402)'
    Write-Host '============================================================'
    Write-QaLogLine -Message ("repo: {0}" -f $repoRoot) -LogFile $pipelineLog
    Write-QaLogLine -Message ("qa home: {0} (port {1})" -f (Get-QaHome), $Port) -LogFile $pipelineLog
    Write-QaLogLine -Message ("real home (read-only): {0}" -f (Get-QaRealDshHome)) -LogFile $pipelineLog
    Assert-QaProfile -Profile $script:QaAllowedProfile
    Assert-QaPort -Port $Port

    # A previous run may have left our isolated server alive; stop it before setup
    # recreates the profile/home under it.
    if (Get-QaPortOwnerPid -Port $Port) {
        Write-QaLogLine -Message "stale harness server on port $Port detected before setup; stopping it"
        & (Join-Path $PSScriptRoot 'stop-web.ps1') -Port $Port -QaHome (Get-QaHome) -EvidenceDir $evidence *>&1 | Out-Host
    }

    # -- 1. setup -----------------------------------------------------------
    if (-not $SkipSetup) {
        Write-Host ''
        Write-Host '>>>> setup'
        $started = Get-Date
        $setupOut = Join-Path $logs "phase-setup-$timestamp.out.log"
        & (Join-Path $PSScriptRoot 'setup.ps1') -Port $Port -QaHome (Get-QaHome) -EvidenceDir $evidence *>&1 |
            Tee-Object -FilePath $setupOut | Out-Host
        $code = $LASTEXITCODE
        Add-Step -Name 'setup' -ExitCode $code -Seconds ([int]((Get-Date) - $started).TotalSeconds) -Detail '' -Log $setupOut
        if ($code -ne 0) { throw "setup failed with exit $code" }
    } else {
        Write-QaLogLine -Message 'setup skipped (-SkipSetup)'
        Add-Step -Name 'setup' -ExitCode 0 -Seconds 0 -Detail 'skipped' -Log ''
    }

    # -- 2. integration tests ----------------------------------------------
    if (-not $SkipIntegration) {
        Write-Host ''
        Write-Host '>>>> integration tests (tests/integration)'
        $started = Get-Date
        $itLog = Join-Path $logs "phase-integration-$timestamp.log"
        Push-Location $repoRoot
        try {
            & $node --test "tests/integration/**/*.test.js" 2>&1 | Tee-Object -FilePath $itLog | Out-Host
            $code = $LASTEXITCODE
        } finally { Pop-Location }
        $summary = @(Select-String -LiteralPath $itLog -Pattern '^# (pass|fail|skipped) ' -ErrorAction SilentlyContinue |
                ForEach-Object { $_.Line.Trim() }) -join '; '
        Add-Step -Name 'integration' -ExitCode $code -Seconds ([int]((Get-Date) - $started).TotalSeconds) -Detail $summary -Log $itLog
    } else {
        Add-Step -Name 'integration' -ExitCode 0 -Seconds 0 -Detail 'skipped' -Log ''
    }

    # -- 3. client build ----------------------------------------------------
    $clientEntry = Join-Path $repoRoot 'lib/client.js'
    if (-not $SkipBuild -and -not (Test-Path -LiteralPath $clientEntry -PathType Leaf)) {
        Write-Host ''
        Write-Host '>>>> build client (node scripts/build-client.mjs)'
        $started = Get-Date
        $buildLog = Join-Path $logs "phase-build-$timestamp.log"
        $esbuildPresent = Test-Path -LiteralPath (Join-Path $repoRoot 'node_modules/esbuild/package.json') -PathType Leaf
        if (-not $esbuildPresent) {
            Add-Step -Name 'build' -ExitCode 3 -Seconds 0 -Detail 'esbuild not installed (node_modules missing); E2E BLOCKED' -Log ''
        } else {
            Push-Location $repoRoot
            try {
                & $node scripts/build-client.mjs 2>&1 | Tee-Object -FilePath $buildLog | Out-Host
                $code = $LASTEXITCODE
            } finally { Pop-Location }
            Add-Step -Name 'build' -ExitCode $code -Seconds ([int]((Get-Date) - $started).TotalSeconds) -Detail '' -Log $buildLog
        }
    } else {
        Add-Step -Name 'build' -ExitCode 0 -Seconds 0 -Detail 'lib/client.js already present or skipped' -Log ''
    }

    # -- 4/5. server + smoke + e2e -----------------------------------------
    $serverRunning = $false
    try {
        Write-Host ''
        Write-Host '>>>> start-web (isolated 4402)'
        $started = Get-Date
        $startLog = Join-Path $logs "phase-start-$timestamp.out.log"
        & (Join-Path $PSScriptRoot 'start-web.ps1') -Port $Port -Profile $script:QaAllowedProfile -QaHome (Get-QaHome) -EvidenceDir $evidence *>&1 |
            Tee-Object -FilePath $startLog | Out-Host
        $code = $LASTEXITCODE
        Add-Step -Name 'start-web' -ExitCode $code -Seconds ([int]((Get-Date) - $started).TotalSeconds) -Detail '' -Log $startLog
        if ($code -ne 0) { throw "start-web failed with exit $code" }
        $serverRunning = $true

        if (-not $SkipSmoke) {
            Write-Host ''
            Write-Host '>>>> smoke'
            $started = Get-Date
            $smokeLog = Join-Path $logs "phase-smoke-$timestamp.log"
            $smokeArgs = @{
                Port           = $Port
                EvidenceDir    = $evidence
                ExpectBootContains = @('dsh-session-groups')
                ExpectSelector = ''
            }
            if ($SkipBrowser) { $smokeArgs['Browser'] = 'none' }
            & (Join-Path $PSScriptRoot 'smoke.ps1') @smokeArgs 2>&1 | Tee-Object -FilePath $smokeLog | Out-Host
            $code = $LASTEXITCODE
            Add-Step -Name 'smoke' -ExitCode $code -Seconds ([int]((Get-Date) - $started).TotalSeconds) -Detail '' -Log $smokeLog
        } else {
            Add-Step -Name 'smoke' -ExitCode 0 -Seconds 0 -Detail 'skipped' -Log ''
        }

        # -- E2E -----------------------------------------------------------
        if (-not $SkipE2E) {
            Write-Host ''
            Write-Host '>>>> e2e (20-step acceptance, zero-dependency CDP)'
            $started = Get-Date
            $e2eLog = Join-Path $evidence "e2e-$timestamp.log"
            $e2eScript = Join-Path $repoRoot 'e2e/groups.spec.mjs'
            if (-not (Test-Path -LiteralPath $e2eScript -PathType Leaf)) {
                Add-Step -Name 'e2e' -ExitCode 3 -Seconds 0 -Detail 'e2e/groups.spec.mjs missing' -Log ''
            } elseif (-not (Test-Path -LiteralPath $clientEntry -PathType Leaf)) {
                Add-Step -Name 'e2e' -ExitCode 3 -Seconds 0 -Detail 'lib/client.js missing (client build required) - E2E BLOCKED' -Log ''
            } else {
                Push-Location $repoRoot
                try {
                    & $node $e2eScript --evidence-dir $evidence --port $Port --qa-home (Get-QaHome) 2>&1 | Tee-Object -FilePath $e2eLog | Out-Host
                    $code = $LASTEXITCODE
                } finally { Pop-Location }
                Add-Step -Name 'e2e' -ExitCode $code -Seconds ([int]((Get-Date) - $started).TotalSeconds) -Detail '' -Log $e2eLog
            }
        } else {
            Add-Step -Name 'e2e' -ExitCode 0 -Seconds 0 -Detail 'skipped' -Log ''
        }

        # -- audit ---------------------------------------------------------
        if (-not $SkipAudit) {
            Write-Host ''
            Write-Host '>>>> audit (load-only)'
            $started = Get-Date
            $auditLog1 = Join-Path $logs "phase-audit-load-$timestamp.log"
            & (Join-Path $PSScriptRoot 'audit.ps1') -Mode exercise -Port $Port -QaHome (Get-QaHome) -EvidenceDir $evidence 2>&1 |
                Tee-Object -FilePath $auditLog1 | Out-Host
            $code1 = $LASTEXITCODE
            Add-Step -Name 'audit-load' -ExitCode $code1 -Seconds ([int]((Get-Date) - $started).TotalSeconds) -Detail '' -Log $auditLog1

            Write-Host ''
            Write-Host '>>>> audit (commit probe: only the record file may change)'
            $started = Get-Date
            $auditLog2 = Join-Path $logs "phase-audit-commit-$timestamp.log"
            & (Join-Path $PSScriptRoot 'audit.ps1') -Mode exercise -Port $Port -QaHome (Get-QaHome) -EvidenceDir $evidence -CommitProbe 2>&1 |
                Tee-Object -FilePath $auditLog2 | Out-Host
            $code2 = $LASTEXITCODE
            Add-Step -Name 'audit-commit' -ExitCode $code2 -Seconds ([int]((Get-Date) - $started).TotalSeconds) -Detail '' -Log $auditLog2
        } else {
            Add-Step -Name 'audit-load' -ExitCode 0 -Seconds 0 -Detail 'skipped' -Log ''
            Add-Step -Name 'audit-commit' -ExitCode 0 -Seconds 0 -Detail 'skipped' -Log ''
        }
    } catch {
        Write-Host ("PIPELINE ERROR: {0}" -f $_.Exception.Message) -ForegroundColor Red
        $failed = $true
    } finally {
        if ($serverRunning -and -not $KeepProfile) {
            Write-Host ''
            Write-Host '>>>> teardown (stop server + delete .spike-homes/qa)'
            $started = Get-Date
            $tdLog = Join-Path $logs "phase-teardown-$timestamp.log"
            & (Join-Path $PSScriptRoot 'teardown.ps1') -Port $Port -QaHome (Get-QaHome) -EvidenceDir $evidence *>&1 |
                Tee-Object -FilePath $tdLog | Out-Host
            Add-Step -Name 'teardown' -ExitCode $LASTEXITCODE -Seconds ([int]((Get-Date) - $started).TotalSeconds) -Detail '' -Log $tdLog
        } elseif ($KeepProfile) {
            Write-QaLogLine -Message 'teardown skipped (-KeepProfile): server left running, home kept'
            Add-Step -Name 'teardown' -ExitCode 0 -Seconds 0 -Detail 'skipped (-KeepProfile)' -Log ''
        }
    }

    $summaryPath = Join-Path $evidence "run-v1-$timestamp.json"
    $overall = if ($script:failed) { 'FAIL' } elseif ($script:blocked.Count -gt 0) { 'PASS-WITH-BLOCKED' } else { 'PASS' }
    if ($RequireE2E -and ($script:blocked -contains 'e2e')) { $overall = 'FAIL'; $script:failed = $true }
    Write-QaEvidenceJson -Path $summaryPath -Data ([ordered]@{
            kind = 'v1-qa-pipeline'; createdAt = Get-QaUtcNowIso; qaHome = (Get-QaHome); realDshHome = (Get-QaRealDshHome)
            port = $Port; steps = @($steps); blocked = @($script:blocked); result = $overall
        }) | Out-Null

    Write-Host ''
    Write-Host '=============================='
    Write-Host " V1 QA pipeline: $overall"
    Write-Host '=============================='
    foreach ($step in $steps) {
        $mark = switch ($step.exitCode) { 0 { 'PASS' } 3 { 'BLOCKED' } default { 'FAIL' } }
        Write-Host ('  [{0}] {1} ({2}s) {3}' -f $mark, $step.step, $step.seconds, $step.detail)
    }
    if ($script:blocked.Count -gt 0) { Write-Host ("  blocked: {0}" -f ($script:blocked -join ', ')) }
    Write-Host ("  evidence: {0}" -f $summaryPath)
    Write-Host ("  log: {0}" -f $pipelineLog)

    if ($script:failed) { exit 1 }
    exit 0
} catch {
    Write-Host ''
    Write-Host ("RUN-V1 ERROR: {0}" -f $_.Exception.Message) -ForegroundColor Red
    try {
        if (Get-QaPortOwnerPid -Port $Port) {
            & (Join-Path $PSScriptRoot 'stop-web.ps1') -Port $Port -QaHome (Get-QaHome) -EvidenceDir $evidence | Out-Host
        }
    } catch { }
    exit 2
}



