# scripts/spike/smoke.ps1
#
# Gate 0 QA harness - minimal smoke check (PowerShell wrapper around smoke.mjs).
#
# Verifies, against the running isolated spike server on port 4402:
#   * the token-authenticated web UI answers 200;
#   * GET /dsh-session-groups/load answers 200 {ok:true, revision, doc};
#   * (optional) POST /commit works and the request fence rejects a foreign Origin;
#   * a headless Chromium loads the page with no client-plugin console error and
#     with the client plugin present in the boot payload;
#   * a screenshot is saved under spike/qa/evidence/screenshots/.
#
# The browser half is dependency-free: it launches the Chromium already cached by
# Playwright (or Edge/Chrome) and speaks CDP through Node's built-in WebSocket.
# Use -Browser none for HTTP-only smoke.
#
# Usage:
#   pwsh -NoProfile -File scripts/spike/smoke.ps1
#   pwsh -NoProfile -File scripts/spike/smoke.ps1 -Browser none
#   pwsh -NoProfile -File scripts/spike/smoke.ps1 -CommitProbe -FenceProbe
#
# Exit codes: 0 = PASS, 1 = FAIL, 2 = harness error.

[CmdletBinding()]
param(
    [int]$Port = 4402,
    [string]$BaseUrl,
    [string]$TokenUrl,
    [string]$Profile = 'groups-spike',
    [ValidateSet('auto', 'none', 'edge', 'chrome')]
    [string]$Browser = 'auto',
    [int]$TimeoutSec = 90,
    [int]$SettleSec = 4,
    [switch]$StrictConsole,
    [switch]$StrictNetwork,
    [switch]$CommitProbe,
    [switch]$FenceProbe,
    [string[]]$ExpectBootContains = @('dsh-session-groups-client-spike'),
    [string]$ExpectSelector = '[data-testid="session-groups-toggle"]',
    [string]$ExpectText,
    [string[]]$AllowConsoleError = @(),
    [switch]$NoWriteState,
    [string]$EvidenceDir
)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'common.ps1')

$exitCode = 0
$evidence = Get-SpikeEvidenceDir -EvidenceDir $EvidenceDir
try {
    Write-Host ''
    Write-Host '============================================================'
    Write-Host ' Gate 0 QA harness - smoke'
    Write-Host '============================================================'
    Assert-SpikeProfile -Profile $Profile
    Assert-SpikePort -Port $Port

    $node = Get-Command node -ErrorAction SilentlyContinue
    if (-not $node) { throw 'node (Node.js) not found on PATH' }

    $state = Get-SpikeWebState -EvidenceDir $evidence
    if (-not $TokenUrl -and -not $BaseUrl -and $state) {
        $TokenUrl = $state.url
        $BaseUrl = $state.baseUrl
    }
    if (-not $BaseUrl) { $BaseUrl = "http://127.0.0.1:$Port/" }
    if (-not $TokenUrl) {
        $outLog = Get-SpikeLatestFile -Directory (Join-Path $evidence 'logs') -Filter 'web-*.out.log'
        if ($outLog) {
            $info = Get-SpikeWebTokenInfoFromLog -OutLog $outLog -TimeoutSec 2
            if ($info) { $TokenUrl = $info.url }
        }
    }

    $smokeArgs = @(
        (Join-Path $PSScriptRoot 'smoke.mjs'),
        '--base-url', $BaseUrl,
        '--evidence-dir', $evidence,
        '--timeout-ms', ([string]($TimeoutSec * 1000)),
        '--settle-ms', ([string]($SettleSec * 1000))
    )
    if ($TokenUrl) { $smokeArgs += @('--token-url', $TokenUrl) }
    if ($Browser -eq 'none') {
        $smokeArgs += @('--browser', 'none')
    } else {
        $smokeArgs += @('--browser', $Browser)
    }
    foreach ($marker in $ExpectBootContains) { $smokeArgs += @('--expect-boot-contains', $marker) }
    if ($ExpectSelector) { $smokeArgs += @('--expect-selector', $ExpectSelector) }
    if ($ExpectText) { $smokeArgs += @('--expect-text', $ExpectText) }
    foreach ($pattern in $AllowConsoleError) { $smokeArgs += @('--allow-console-error', $pattern) }
    if ($StrictConsole) { $smokeArgs += '--strict-console' }
    if ($StrictNetwork) { $smokeArgs += '--strict-network' }
    if ($CommitProbe) { $smokeArgs += '--commit-probe' }
    if ($FenceProbe) { $smokeArgs += '--fence-probe' }

    & $node.Source @smokeArgs
    $exitCode = $LASTEXITCODE

    if ($exitCode -eq 0 -and $state -and -not $NoWriteState) {
        $state | Add-Member -NotePropertyName lastSmokeAt -NotePropertyValue (Get-SpikeUtcNowIso) -Force
        $state | Add-Member -NotePropertyName lastSmokeResult -NotePropertyValue 'PASS' -Force
        Write-SpikeEvidenceJson -Path (Join-Path $evidence 'web.json') -Data $state | Out-Null
    }
} catch {
    Write-Host ''
    Write-Host ("SMOKE ERROR: {0}" -f $_.Exception.Message) -ForegroundColor Red
    $exitCode = 2
}

if ($exitCode -eq 0) {
    Write-Host ''
    Write-Host 'Smoke PASS. Evidence: spike/qa/evidence/smoke-*.json'
}
exit $exitCode


