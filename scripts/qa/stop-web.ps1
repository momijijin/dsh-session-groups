# scripts/qa/stop-web.ps1
#
# Gate 0 QA harness - stop the isolated web server started by start-web.ps1.
#
# Safety:
#   * only stops a process tree that start-web.ps1 recorded (scripts/qa/evidence/web.json),
#     or a listener on the spike port whose command line clearly targets groups-spike;
#   * never touches port 43120 (the user's live Desktop GUI);
#   * does not delete the profile, the plugin record file, or the logs.
#
# Usage:
#   pwsh -NoProfile -File scripts/qa/stop-web.ps1
#
# Exit codes: 0 = stopped / already stopped, 1 = refusal or failure.

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
$evidence = Get-QaEvidenceDir -EvidenceDir $EvidenceDir
$webStatePath = Join-Path $evidence 'web.json'
$state = Get-QaWebState -EvidenceDir $evidence

try {
    Write-Host ''
    Write-Host '============================================================'
    Write-Host " Gate 0 QA harness - stop web (port $Port)"
    Write-Host '============================================================'
    Assert-QaPort -Port $Port
    Reset-QaChecks

    if ($state -and $state.profile -and $state.profile -ne $script:QaAllowedProfile) {
        throw ("web.json belongs to profile '{0}', not '{1}' - refusing to act." -f $state.profile, $script:QaAllowedProfile)
    }
    $stateQaHome = Get-QaProp -Object $state -Name 'spikeHome'
    if ($stateQaHome -and ([System.IO.Path]::GetFullPath([string]$stateQaHome) -ine [System.IO.Path]::GetFullPath((Get-QaHome)))) {
        throw ("web.json records spike home '{0}' but this run uses '{1}' - refusing to kill a server from another home." -f $stateQaHome, (Get-QaHome))
    }
    if ($state -and $state.port -and ([int]$state.port) -ne $Port) {
        Write-QaLogLine -Message ("web.json records port {0}, stopping requested port {1}; using {1}" -f $state.port, $Port)
    }

    $listenerPid = Get-QaPortOwnerPid -Port $Port
    $recordedPid = if ($state -and $state.pid) { [int]$state.pid } else { $null }
    $recordedAlive = [bool]($recordedPid -and (Get-Process -Id $recordedPid -ErrorAction SilentlyContinue))

    if (-not $listenerPid -and -not $recordedAlive) {
        Add-QaCheck -Id 'STOP-1' -Description 'no harness server is running' -Pass $true -Detail "port $Port is free"
        if ($state) {
            Set-QaProp -Object $state -Name 'stoppedAt' -Value (Get-QaUtcNowIso)
            Set-QaProp -Object $state -Name 'result' -Value 'STOPPED'
            Set-QaProp -Object $state -Name 'checks' -Value @(Get-QaChecks)
            Write-QaEvidenceJson -Path $webStatePath -Data $state | Out-Null
        }
        exit 0
    }

    # Decide which tree to stop and prove it is ours.
    $targetPid = $null
    if ($recordedAlive) {
        $targetPid = $recordedPid
        Add-QaCheck -Id 'STOP-1' -Description 'recorded launcher process is alive' -Pass $true -Detail ("pid=$targetPid")
    } else {
        # The launcher may have exited while a grandchild keeps the port; identify by command line.
        $commandLine = Get-QaProcessCommandLine -ProcessId $listenerPid
        $looksOurs = [bool]($commandLine -and $commandLine -match 'groups-spike')
        Add-QaCheck -Id 'STOP-1' -Description 'port listener belongs to the groups-spike harness' -Pass $looksOurs `
            -Detail ("pid=$listenerPid; command=$commandLine")
        if (-not $looksOurs) {
            throw ("port {0} is owned by pid {1} which does not look like the harness server; refusing to kill it. Command: {2}" -f $Port, $listenerPid, $commandLine)
        }
        $targetPid = $listenerPid
    }

    $stopped = Stop-QaProcessTree -ProcessId $targetPid
    Add-QaCheck -Id 'STOP-2' -Description 'server process tree stopped' -Pass $stopped -Detail ("pid=$targetPid")

    $deadline = (Get-Date).AddSeconds(15)
    while ((Get-Date) -lt $deadline) {
        if (-not (Get-QaPortOwnerPid -Port $Port)) { break }
        Start-Sleep -Milliseconds 300
    }
    $portFree = -not (Get-QaPortOwnerPid -Port $Port)
    Add-QaCheck -Id 'STOP-3' -Description "port $Port is released" -Pass $portFree

    if ($state) {
        Set-QaProp -Object $state -Name 'stoppedAt' -Value (Get-QaUtcNowIso)
        Set-QaProp -Object $state -Name 'result' -Value $(if ($stopped -and $portFree) { 'STOPPED' } else { 'FAIL' })
        Set-QaProp -Object $state -Name 'checks' -Value @(Get-QaChecks)
        Write-QaEvidenceJson -Path $webStatePath -Data $state | Out-Null
    }
} catch {
    Write-Host ''
    Write-Host ("STOP-WEB ERROR: {0}" -f $_.Exception.Message) -ForegroundColor Red
    $exitCode = 1
} finally {
    if ($exitCode -eq 0 -and -not (Write-QaSummary -Title 'stop-web' -EvidencePath $webStatePath)) {
        $exitCode = 1
    }
}

exit $exitCode




