# scripts/spike/stop-web.ps1
#
# Gate 0 QA harness - stop the isolated web server started by start-web.ps1.
#
# Safety:
#   * only stops a process tree that start-web.ps1 recorded (spike/qa/evidence/web.json),
#     or a listener on the spike port whose command line clearly targets groups-spike;
#   * never touches port 43120 (the user's live Desktop GUI);
#   * does not delete the profile, the plugin record file, or the logs.
#
# Usage:
#   pwsh -NoProfile -File scripts/spike/stop-web.ps1
#
# Exit codes: 0 = stopped / already stopped, 1 = refusal or failure.

[CmdletBinding()]
param(
    [int]$Port = 4402,
    [string]$SpikeHome,
    [string]$EvidenceDir
)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'common.ps1')

if (-not [string]::IsNullOrWhiteSpace($SpikeHome)) { Set-SpikeHome -Path $SpikeHome }
Assert-SpikeHome

$exitCode = 0
$evidence = Get-SpikeEvidenceDir -EvidenceDir $EvidenceDir
$webStatePath = Join-Path $evidence 'web.json'
$state = Get-SpikeWebState -EvidenceDir $evidence

try {
    Write-Host ''
    Write-Host '============================================================'
    Write-Host " Gate 0 QA harness - stop web (port $Port)"
    Write-Host '============================================================'
    Assert-SpikePort -Port $Port
    Reset-SpikeChecks

    if ($state -and $state.profile -and $state.profile -ne $script:SpikeAllowedProfile) {
        throw ("web.json belongs to profile '{0}', not '{1}' - refusing to act." -f $state.profile, $script:SpikeAllowedProfile)
    }
    $stateSpikeHome = Get-SpikeProp -Object $state -Name 'spikeHome'
    if ($stateSpikeHome -and ([System.IO.Path]::GetFullPath([string]$stateSpikeHome) -ine [System.IO.Path]::GetFullPath((Get-SpikeHome)))) {
        throw ("web.json records spike home '{0}' but this run uses '{1}' - refusing to kill a server from another home." -f $stateSpikeHome, (Get-SpikeHome))
    }
    if ($state -and $state.port -and ([int]$state.port) -ne $Port) {
        Write-SpikeLogLine -Message ("web.json records port {0}, stopping requested port {1}; using {1}" -f $state.port, $Port)
    }

    $listenerPid = Get-SpikePortOwnerPid -Port $Port
    $recordedPid = if ($state -and $state.pid) { [int]$state.pid } else { $null }
    $recordedAlive = [bool]($recordedPid -and (Get-Process -Id $recordedPid -ErrorAction SilentlyContinue))

    if (-not $listenerPid -and -not $recordedAlive) {
        Add-SpikeCheck -Id 'STOP-1' -Description 'no harness server is running' -Pass $true -Detail "port $Port is free"
        if ($state) {
            Set-SpikeProp -Object $state -Name 'stoppedAt' -Value (Get-SpikeUtcNowIso)
            Set-SpikeProp -Object $state -Name 'result' -Value 'STOPPED'
            Set-SpikeProp -Object $state -Name 'checks' -Value @(Get-SpikeChecks)
            Write-SpikeEvidenceJson -Path $webStatePath -Data $state | Out-Null
        }
        exit 0
    }

    # Decide which tree to stop and prove it is ours.
    $targetPid = $null
    if ($recordedAlive) {
        $targetPid = $recordedPid
        Add-SpikeCheck -Id 'STOP-1' -Description 'recorded launcher process is alive' -Pass $true -Detail ("pid=$targetPid")
    } else {
        # The launcher may have exited while a grandchild keeps the port; identify by command line.
        $commandLine = Get-SpikeProcessCommandLine -ProcessId $listenerPid
        $looksOurs = [bool]($commandLine -and $commandLine -match 'groups-spike')
        Add-SpikeCheck -Id 'STOP-1' -Description 'port listener belongs to the groups-spike harness' -Pass $looksOurs `
            -Detail ("pid=$listenerPid; command=$commandLine")
        if (-not $looksOurs) {
            throw ("port {0} is owned by pid {1} which does not look like the harness server; refusing to kill it. Command: {2}" -f $Port, $listenerPid, $commandLine)
        }
        $targetPid = $listenerPid
    }

    $stopped = Stop-SpikeProcessTree -ProcessId $targetPid
    Add-SpikeCheck -Id 'STOP-2' -Description 'server process tree stopped' -Pass $stopped -Detail ("pid=$targetPid")

    $deadline = (Get-Date).AddSeconds(15)
    while ((Get-Date) -lt $deadline) {
        if (-not (Get-SpikePortOwnerPid -Port $Port)) { break }
        Start-Sleep -Milliseconds 300
    }
    $portFree = -not (Get-SpikePortOwnerPid -Port $Port)
    Add-SpikeCheck -Id 'STOP-3' -Description "port $Port is released" -Pass $portFree

    if ($state) {
        Set-SpikeProp -Object $state -Name 'stoppedAt' -Value (Get-SpikeUtcNowIso)
        Set-SpikeProp -Object $state -Name 'result' -Value $(if ($stopped -and $portFree) { 'STOPPED' } else { 'FAIL' })
        Set-SpikeProp -Object $state -Name 'checks' -Value @(Get-SpikeChecks)
        Write-SpikeEvidenceJson -Path $webStatePath -Data $state | Out-Null
    }
} catch {
    Write-Host ''
    Write-Host ("STOP-WEB ERROR: {0}" -f $_.Exception.Message) -ForegroundColor Red
    $exitCode = 1
} finally {
    if ($exitCode -eq 0 -and -not (Write-SpikeSummary -Title 'stop-web' -EvidencePath $webStatePath)) {
        $exitCode = 1
    }
}

exit $exitCode



