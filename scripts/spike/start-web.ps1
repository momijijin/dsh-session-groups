# scripts/spike/start-web.ps1
#
# Gate 0 QA harness - boot the ISOLATED web UI on its own port.
#
# Isolation (M0):
#   The PATH `dsh.cmd` shim hardcodes DSH_HOME=%USERPROFILE%\.dsh. This script
#   therefore launches the packaged Desktop runtime directly with the disposable
#   DSH home:
#       <DSH Desktop.exe> --expose-internals <desktop-cli.js> --profile groups-spike --port 4402 --no-open
#   with ELECTRON_RUN_AS_NODE=1, DSH_HOME=<repo>\.spike-home, and DSH_PROFILE*/
#   DSH_SESSION_ID/DSH_WEB_URL/DSH_SHELL/DSH_DESKTOP_DEFAULT_PROFILE removed.
#   Every write the server makes lands in .spike-home (workspace.json there is a
#   frozen fixture copy; the real ~/.dsh data is untouched).
#
# The server prints a one-time auth URL with a token:
#   dsh web: http://127.0.0.1:4402/?token=...
# The first navigation to that URL sets an HttpOnly auth cookie; plain GET / without
# it returns 401. This script captures the token URL and persists it to
#   spike/qa/evidence/web.json
# for stop-web.ps1 / smoke.mjs / audit-no-host-writes.ps1.
#
# Usage:
#   pwsh -NoProfile -File scripts/spike/start-web.ps1
#   pwsh -NoProfile -File scripts/spike/start-web.ps1 -Restart
#
# Exit codes: 0 = running and healthy, 1 = failed to start / unhealthy.

[CmdletBinding()]
param(
    [int]$Port = 4402,
    [string]$Profile = 'groups-spike',
    [string]$SpikeHome,
    [int]$TimeoutSec = 120,
    [switch]$Restart,
    [string]$EvidenceDir
)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'common.ps1')

if (-not [string]::IsNullOrWhiteSpace($SpikeHome)) { Set-SpikeHome -Path $SpikeHome }
Assert-SpikeHome

$exitCode = 0
$timestamp = Get-SpikeTimestamp
$evidence = Get-SpikeEvidenceDir -EvidenceDir $EvidenceDir
$logs = Join-Path $evidence 'logs'
if (-not (Test-Path -LiteralPath $logs)) { New-Item -ItemType Directory -Force -Path $logs | Out-Null }
$webStatePath = Join-Path $evidence 'web.json'
$state = [ordered]@{
    kind         = 'gate0-web'
    createdAt    = Get-SpikeUtcNowIso
    spikeHome    = (Get-SpikeHome)
    realDshHome  = (Get-SpikeRealDshHome)
    profile      = $Profile
    port         = $Port
    pid          = $null
    runtime      = $null
    commandLine  = $null
    url          = $null
    baseUrl      = $null
    authority    = $null
    token        = $null
    outLog       = $null
    errLog       = $null
    rootStatus   = $null
    startedAt    = $null
    checks       = @()
    result       = 'FAIL'
}

function Save-WebState {
    $state.checks = @(Get-SpikeChecks)
    Write-SpikeEvidenceJson -Path $webStatePath -Data $state | Out-Null
}

try {
    Write-Host ''
    Write-Host '============================================================'
    Write-Host " Gate 0 QA harness - start isolated web ($Profile on port $Port)"
    Write-Host '============================================================'
    Reset-SpikeChecks
    Assert-SpikeProfile -Profile $Profile
    Assert-SpikePort -Port $Port
    Write-SpikeLogLine -Message "spike home: $(Get-SpikeHome) (server writes only here)" -LogFile (Join-Path $logs "web-$timestamp.log")
    $profileDir = Get-SpikeProfileDir -Profile $Profile
    if (-not (Test-Path -LiteralPath (Join-Path $profileDir 'package.json') -PathType Leaf)) {
        throw "isolated profile '$Profile' does not exist at $profileDir. Run scripts/spike/setup-profile.ps1 first."
    }

    # -- already running? ---------------------------------------------------
    $existingPid = Get-SpikePortOwnerPid -Port $Port
    if ($existingPid) {
        $existingState = Get-SpikeWebState -EvidenceDir $evidence
        $ownedByHarness = $existingState -and ($existingState.profile -eq $Profile) -and
            ($existingState.pid -and (Get-Process -Id ([int]$existingState.pid) -ErrorAction SilentlyContinue))
        $commandLine = Get-SpikeProcessCommandLine -ProcessId $existingPid
        if ($Restart) {
            Write-SpikeLogLine -Message "port $Port busy (pid $existingPid); -Restart requested - stopping old server"
            & (Join-Path $PSScriptRoot 'stop-web.ps1') -Port $Port -SpikeHome (Get-SpikeHome) -EvidenceDir $evidence | Out-Host
            if ($LASTEXITCODE -ne 0) { throw "could not stop existing server on port $Port" }
        } elseif ($ownedByHarness) {
            Write-SpikeLogLine -Message "server already running (pid $($existingState.pid)); reusing it"
            & (Join-Path $PSScriptRoot 'smoke.ps1') -BaseUrl $existingState.baseUrl -TokenUrl $existingState.url `
                -EvidenceDir $evidence -Browser none -NoWriteState 2>&1 | Out-Host
            $reuseSmokeCode = $LASTEXITCODE
            Add-SpikeCheck -Id 'WEB-0' -Description 'reused already-running harness server' -Pass ($reuseSmokeCode -eq 0) `
                -Detail ("pid=$($existingState.pid); reuse smoke exit=$reuseSmokeCode")
            if ($reuseSmokeCode -ne 0) { throw "existing server on port $Port failed the reuse smoke check" }
            $state.pid = $existingState.pid
            $state.url = $existingState.url
            $state.baseUrl = $existingState.baseUrl
            $state.authority = $existingState.authority
            $state.token = $existingState.token
            $state.outLog = $existingState.outLog
            $state.errLog = $existingState.errLog
            $state.runtime = $existingState.runtime
            $state.rootStatus = 200
            $state.startedAt = $existingState.startedAt
            $state.result = 'PASS'
            Save-WebState
            Write-SpikeSummary -Title 'start-web (isolated home)' -EvidencePath $webStatePath | Out-Null
            exit 0
        } else {
            throw "port $Port is already in use by pid $existingPid (not a harness-owned server). Command: $commandLine. `nUse -Restart to stop it, or pick another port."
        }
    }

    # -- launch the packaged runtime against the isolated home --------------
    $runtime = Get-SpikeDesktopRuntime
    $state.runtime = $runtime.desktopExe
    $outLog = Join-Path $logs "web-$timestamp.out.log"
    $errLog = Join-Path $logs "web-$timestamp.err.log"
    $state.outLog = $outLog
    $state.errLog = $errLog
    $state.startedAt = Get-SpikeUtcNowIso
    $dshArgs = @('--profile', $Profile, '--port', [string]$Port, '--no-open')
    $argLine = '--expose-internals "{0}" {1}' -f $runtime.desktopCli, (ConvertTo-SpikeArgLine -Arguments $dshArgs)
    $state.commandLine = ('"{0}" {1}' -f $runtime.desktopExe, $argLine)
    Write-SpikeLogLine -Message ("launching: <DSH Desktop.exe> --expose-internals <desktop-cli.js> " + ($dshArgs -join ' '))
    $process = Start-Process -FilePath $runtime.desktopExe -ArgumentList $argLine `
        -Environment (Get-SpikeRuntimeEnvironment) `
        -RedirectStandardOutput $outLog -RedirectStandardError $errLog `
        -PassThru -WindowStyle Hidden
    $state.pid = $process.Id
    Write-SpikeLogLine -Message "launcher pid=$($process.Id) (DSH_HOME=$(Get-SpikeHome))"

    # -- wait for the token URL --------------------------------------------
    $tokenInfo = Get-SpikeWebTokenInfoFromLog -OutLog $outLog -TimeoutSec $TimeoutSec
    if (-not $tokenInfo) {
        $process.Refresh()
        $exited = $process.HasExited
        $errTail = if (Test-Path -LiteralPath $errLog) { ((Get-Content -LiteralPath $errLog -Tail 20) -join "`n") } else { '' }
        $outTail = if (Test-Path -LiteralPath $outLog) { ((Get-Content -LiteralPath $outLog -Tail 20) -join "`n") } else { '' }
        throw ("server did not print a token URL within {0}s (process exited={1}).`nstdout:`n{2}`nstderr:`n{3}" -f $TimeoutSec, $exited, $outTail, $errTail)
    }
    $state.url = $tokenInfo.url
    $state.baseUrl = $tokenInfo.baseUrl
    $state.authority = $tokenInfo.authority
    $state.token = $tokenInfo.token
    Add-SpikeCheck -Id 'WEB-1' -Description 'isolated dsh web printed its token URL' -Pass $true `
        -Detail ("{0}?token=***" -f $tokenInfo.baseUrl)

    # -- wait for the auth-fenced page -------------------------------------
    $root = Wait-SpikeHttp -Url $tokenInfo.url -TimeoutSec $TimeoutSec -Accept {
        param($response)
        return ($response.StatusCode -eq 200)
    }
    $process.Refresh()
    if (-not $root) {
        throw ("web UI did not answer 200 at its token URL within {0}s (process exited={1}). See {2}" -f $TimeoutSec, $process.HasExited, $outLog)
    }
    $state.rootStatus = [int]$root.StatusCode
    $html = [string]$root.Content
    $hasRoot = $html -match '<div id="root">'
    $hasBoot = $html -match '__DSH_BOOT__'
    Add-SpikeCheck -Id 'WEB-2' -Description 'token URL returns 200 HTML for the web app' -Pass ($root.StatusCode -eq 200 -and $hasRoot) `
        -Detail ("status={0}; root-div={1}; html-bytes={2}" -f $root.StatusCode, $hasRoot, $html.Length)
    Add-SpikeCheck -Id 'WEB-3' -Description 'web app boot payload is present in HTML' -Pass $hasBoot -Detail ("__DSH_BOOT__={0}" -f $hasBoot)

    # Plain GET / must be fenced (401) - confirms we are talking to the token-auth web app.
    try {
        $fenced = Invoke-WebRequest -Uri $tokenInfo.baseUrl -UseBasicParsing -SkipHttpErrorCheck -MaximumRedirection 0 -TimeoutSec 10
        $fencedStatus = [int]$fenced.StatusCode
    } catch {
        $fencedStatus = -1
    }
    Add-SpikeCheck -Id 'WEB-4' -Description 'unauthenticated GET / is rejected (auth fence active)' -Pass ($fencedStatus -eq 401) `
        -Detail ("status={0} (expected 401)" -f $fencedStatus)

    $state.result = 'PASS'
} catch {
    Write-Host ''
    Write-Host ("START-WEB ERROR: {0}" -f $_.Exception.Message) -ForegroundColor Red
    $state.error = $_.Exception.Message
    $exitCode = 1
    if ($state.pid) {
        Write-SpikeLogLine -Message "stopping failed server tree (pid $($state.pid))"
        Stop-SpikeProcessTree -ProcessId ([int]$state.pid) | Out-Null
    }
} finally {
    if ($exitCode -eq 0 -and -not (Write-SpikeSummary -Title 'start-web (isolated home)' -EvidencePath $webStatePath)) {
        $exitCode = 1
    }
    if ($exitCode -ne 0) { $state.result = 'FAIL' }
    try { Save-WebState } catch { Write-Host ("WARN: could not write web state: {0}" -f $_.Exception.Message) }
}

if ($exitCode -eq 0) {
    Write-Host ''
    Write-Host 'Isolated web UI (local, token-scoped):'
    Write-Host ("  {0}" -f $state.url)
    Write-Host ("state file: {0}" -f $webStatePath)
}
exit $exitCode



