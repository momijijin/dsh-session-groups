# scripts/spike/audit-no-host-writes.ps1
#
# Gate 0 QA harness - data audit inside the ISOLATED throw-away DSH home.
#
# Contract under test (docs/V1-PLAN.md D2/D10, docs/CONTRACTS.md §2 File, docs/TEST-PLAN.md §7):
#   inside <repo>\.spike-home, the only file this plugin may create or modify is
#       .spike-home\storages\dsh-session-groups.json
#   (~ plus its .bak/.tmp/.corrupt-* siblings while writing).
#   .spike-home\storages\workspace.json and the sample session logs must not change.
#   The REAL %USERPROFILE%\.dsh is never written by the harness (setup/teardown prove it);
#   it only supplies the frozen fixtures copied into .spike-home.
#
# What it hashes:
#   * .spike-home\storages\workspace.json         (content SHA256)
#   * 3 sample session directories in .spike-home (recursive per-file SHA256 manifest + dir hash)
#   * the group record file                        (content SHA256 + revision when parseable)
#   * real desktop/web/groups-spike profiles       (to prove no real profile was written)
#
# Modes:
#   baseline  snapshot only; writes spike/qa/evidence/audit-baseline-<ts>.json
#   verify    snapshot now and diff against a previous baseline (latest by default)
#   exercise  snapshot -> perform HTTP load (and optional commit) through the running
#             isolated spike server -> snapshot again -> assert only the group file changed.
#             This is the default.
#
# Usage:
#   pwsh -NoProfile -File scripts/spike/audit-no-host-writes.ps1
#   pwsh -NoProfile -File scripts/spike/audit-no-host-writes.ps1 -Mode baseline
#   pwsh -NoProfile -File scripts/spike/audit-no-host-writes.ps1 -Mode verify -BaselinePath <path>
#   pwsh -NoProfile -File scripts/spike/audit-no-host-writes.ps1 -CommitProbe
#   pwsh -NoProfile -File scripts/spike/audit-no-host-writes.ps1 -SpikeHome <repo>\.spike-home-qa
#
# Exit codes: 0 = PASS, 1 = FAIL.

[CmdletBinding()]
param(
    [ValidateSet('baseline', 'verify', 'exercise')]
    [string]$Mode = 'exercise',
    [int]$Port = 4402,
    [string]$SpikeHome,
    [string[]]$SampleSessionDirs = @(),
    [string]$BaselinePath,
    [switch]$CommitProbe,
    [ValidateSet('auto', 'change', 'unchanged', 'any')]
    [string]$ExpectGroupFile = 'auto',
    [switch]$SkipHttp,
    [switch]$StrictStorages,
    [int]$MaxSessionAgeMinutes = 60,
    [int]$Retries = 2,
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
$sessionsRoot = Join-Path (Get-SpikeHome) 'sessions'
$workspaceJsonPath = Join-Path (Get-SpikeStoragesDir) $script:SpikeWorkspaceFileName
$groupFilePath = Join-Path (Get-SpikeStoragesDir) $script:SpikeGroupFileName
$currentSessionId = $env:DSH_SESSION_ID

# Hard guard: the audited state MUST live inside the disposable home, never the real one.
if (-not [System.IO.Path]::GetFullPath($workspaceJsonPath).StartsWith([System.IO.Path]::GetFullPath((Get-SpikeHome)), [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "audit target '$workspaceJsonPath' is not inside the disposable .spike-home; refusing to run (M0 isolation)."
}

function Get-GroupFileState {
    $stamp = Get-SpikeFileStamp -Path $groupFilePath
    $revision = $null
    $valid = $false
    $warning = $null
    if ($stamp.exists) {
        try {
            $parsed = Get-Content -LiteralPath $groupFilePath -Raw | ConvertFrom-Json
            $revision = $parsed.revision
            $valid = ($null -ne $parsed.groups)
        } catch {
            $warning = 'unparseable-json'
        }
    }
    return [ordered]@{
        path     = $groupFilePath
        exists   = $stamp.exists
        sha256   = $stamp.sha256
        length   = $stamp.length
        mtimeUtc = $stamp.mtimeUtc
        revision = $revision
        valid    = $valid
        warning  = $warning
    }
}

function Get-StoragesTopLevelState {
    $storagesDir = Get-SpikeStoragesDir
    $items = @()
    if (Test-Path -LiteralPath $storagesDir -PathType Container) {
        foreach ($child in (Get-ChildItem -LiteralPath $storagesDir -Force | Sort-Object Name)) {
            if ($child.PSIsContainer) {
                $items += [pscustomobject]@{ name = $child.Name; kind = 'dir'; sha256 = $null; length = $null }
            } else {
                $items += [pscustomobject]@{
                    name   = $child.Name
                    kind   = 'file'
                    sha256 = (Get-FileHash -LiteralPath $child.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
                    length = $child.Length
                }
            }
        }
    }
    return @($items)
}

function Resolve-SampleSessionDirs {
    param(
        [string[]]$Explicit = @(),
        [int]$MaxAgeMinutes = 60
    )

    $selected = @()
    if ($Explicit -and $Explicit.Count -gt 0) {
        foreach ($path in $Explicit) {
            if (-not (Test-Path -LiteralPath $path -PathType Container)) {
                throw "sample session dir does not exist: $path"
            }
            $full = (Resolve-Path -LiteralPath $path).Path
            if (-not $full.StartsWith($sessionsRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
                throw "sample session dir must live under $sessionsRoot (got $full)"
            }
            $selected += $full
        }
        return @($selected)
    }

    if (-not (Test-Path -LiteralPath $sessionsRoot -PathType Container)) {
        throw "sessions root not found: $sessionsRoot"
    }

    # Session ids that belong to live workspaces: avoid them for the audit samples.
    $liveIds = @()
    try {
        $workspaceJson = Get-Content -LiteralPath $workspaceJsonPath -Raw | ConvertFrom-Json
        foreach ($workspace in $workspaceJson.tables.workspaces.PSObject.Properties) {
            $liveIds += @($workspace.Value.sessionIds)
        }
    } catch { }

    $nowUtc = (Get-Date).ToUniversalTime()
    # Sessions touched less than 10 minutes ago are considered actively written by the
    # host (this QA session, agent-team sessions, ...). Compare in UTC: mixing
    # Get-Date (local) with LastWriteTimeUtc silently defeats the filter.
    $activeCutoffUtc = $nowUtc.AddMinutes(-10)
    $preferredCutoffUtc = $nowUtc.AddMinutes(-[Math]::Max(10, $MaxAgeMinutes))
    $candidates = @()
    foreach ($workspaceDir in @(Get-ChildItem -LiteralPath $sessionsRoot -Directory -Force)) {
        foreach ($sessionDir in @(Get-ChildItem -LiteralPath $workspaceDir.FullName -Directory -Force)) {
            $sessionId = $sessionDir.Name
            if ($currentSessionId -and $sessionId -eq $currentSessionId) { continue }
            $files = @(Get-ChildItem -LiteralPath $sessionDir.FullName -Recurse -File -Force -ErrorAction SilentlyContinue)
            if ($files.Count -eq 0) { continue }
            $newest = ($files | Sort-Object LastWriteTimeUtc -Descending | Select-Object -First 1).LastWriteTimeUtc
            if ($newest -gt $activeCutoffUtc) { continue }   # actively written; never audit it
            $candidates += [pscustomobject]@{
                path      = $sessionDir.FullName
                sessionId = $sessionId
                parent    = $workspaceDir.Name
                isLive    = ($liveIds -contains $sessionId)
                newestUtc = $newest
                preferred = ($newest -le $preferredCutoffUtc)
            }
        }
    }

    $orphans = @($candidates | Where-Object { -not $_.isLive } | Sort-Object newestUtc -Descending)
    $live = @($candidates | Where-Object { $_.isLive } | Sort-Object newestUtc -Descending)
    $basePool = if ($orphans.Count -ge 3) { $orphans } else { @($orphans) + @($live) }
    # Prefer samples that have been quiet for a longer time (less chance of a host write
    # racing the audit window), then the more recent-but-still-idle ones.
    $pool = @($basePool | Where-Object { $_.preferred }) + @($basePool | Where-Object { -not $_.preferred })

    # Prefer one sample per workspace-encoded directory for a broader fingerprint.
    $byParent = $pool | Group-Object parent
    $picked = @()
    foreach ($group in $byParent) {
        if ($picked.Count -ge 3) { break }
        $picked += $group.Group | Select-Object -First 1
    }
    if ($picked.Count -lt 3) {
        foreach ($candidate in $pool) {
            if ($picked.Count -ge 3) { break }
            if ($picked.path -contains $candidate.path) { continue }
            $picked += $candidate
        }
    }
    if ($picked.Count -lt 3) {
        throw ("could not find 3 auditable sample session dirs under {0} (found {1}); pass -SampleSessionDirs explicitly" -f $sessionsRoot, $picked.Count)
    }
    return @($picked | Select-Object -First 3 | ForEach-Object { $_.path })
}

function Get-AuditSnapshot {
    param(
        [Parameter(Mandatory)][string]$Label,
        [Parameter(Mandatory)][string[]]$SampleDirs
    )

    $workspaceStamp = Get-SpikeFileStamp -Path $workspaceJsonPath
    $samples = @()
    foreach ($sessionDir in $SampleDirs) {
        $manifest = @(Get-SpikeDirManifest -Path $sessionDir)
        $samples += [pscustomobject]@{
            path         = $sessionDir
            sessionId    = (Split-Path -Leaf $sessionDir)
            workspaceDir = (Split-Path -Leaf (Split-Path -Parent $sessionDir))
            fileCount    = $manifest.Count
            totalBytes   = [long](($manifest | Measure-Object -Property length -Sum).Sum)
            manifestHash = Get-SpikeManifestHash -Manifest $manifest
            files        = $manifest
        }
    }
    $profiles = [ordered]@{}
    foreach ($reserved in $script:SpikeReservedProfiles) {
        $profiles[$reserved] = Get-SpikeProfileFingerprint -ProfileName $reserved -DshHome (Get-SpikeRealDshHome)
    }

    return [ordered]@{
        kind          = 'host-write-audit-snapshot'
        label         = $Label
        createdAt     = Get-SpikeUtcNowIso
        spikeHome     = Get-SpikeHome
        realDshHome   = Get-SpikeRealDshHome
        workspaceJson = $workspaceStamp
        groupFile     = Get-GroupFileState
        sampleSessions = $samples
        storagesTopLevel = Get-StoragesTopLevelState
        profiles      = $profiles
    }
}

function Get-AuditProp {
    param($Object, [Parameter(Mandatory)][string]$Name)
    if ($null -eq $Object) { return $null }
    if ($Object -is [System.Collections.IDictionary]) { return $Object[$Name] }
    $prop = $Object.PSObject.Properties[$Name]
    if ($prop) { return $prop.Value }
    return $null
}

function Compare-AuditSnapshots {
    param(
        [Parameter(Mandatory)][object]$Baseline,
        [Parameter(Mandatory)][object]$After,
        [Parameter(Mandatory)][string]$ExpectedGroupChange
    )

    $warnings = @()
    $baselineWorkspace = Get-AuditProp -Object $Baseline -Name 'workspaceJson'
    $afterWorkspace = Get-AuditProp -Object $After -Name 'workspaceJson'

    # 1. workspace.json content must not change.
    $workspaceUnchanged = ($baselineWorkspace.sha256 -eq $afterWorkspace.sha256)
    Add-SpikeCheck -Id 'AUD-1' -Description 'workspace.json content unchanged' -Pass $workspaceUnchanged `
        -Detail ("before={0} after={1}" -f $baselineWorkspace.sha256, $afterWorkspace.sha256)

    # 2. each sample session directory must not change.
    $baselineSamples = @(Get-AuditProp -Object $Baseline -Name 'sampleSessions')
    $afterSamples = @(Get-AuditProp -Object $After -Name 'sampleSessions')
    if ($baselineSamples.Count -ne $afterSamples.Count) {
        Add-SpikeCheck -Id 'AUD-2' -Description 'sample session set is comparable' -Pass $false `
            -Detail ("baseline={0} after={1}" -f $baselineSamples.Count, $afterSamples.Count)
    } else {
        for ($i = 0; $i -lt $baselineSamples.Count; $i++) {
            $b = $baselineSamples[$i]
            $a = $afterSamples[$i]
            $sameSet = ($b.manifestHash -eq $a.manifestHash)
            Add-SpikeCheck -Id ("AUD-S{0}" -f ($i + 1)) -Description ("sample session unchanged: {0}" -f $b.sessionId) `
                -Pass $sameSet -Detail ("files={0}; bytes={1}; hash={2}" -f $a.fileCount, $a.totalBytes, $a.manifestHash)
            if (-not $sameSet) {
                $beforeFiles = @{}
                foreach ($file in @($b.files)) { $beforeFiles[$file.path] = $file.sha256 }
                foreach ($file in @($a.files)) {
                    if ($beforeFiles.ContainsKey($file.path) -and $beforeFiles[$file.path] -ne $file.sha256) {
                        $warnings += ("changed file: {0}" -f (Join-Path $b.path $file.path))
                    } elseif (-not $beforeFiles.ContainsKey($file.path)) {
                        $warnings += ("new file: {0}" -f (Join-Path $b.path $file.path))
                    }
                }
            }
        }
    }

    # 3. the plugin record file is the only storage file allowed to change.
    $beforeGroup = Get-AuditProp -Object $Baseline -Name 'groupFile'
    $afterGroup = Get-AuditProp -Object $After -Name 'groupFile'
    $groupChanged = ($beforeGroup.sha256 -ne $afterGroup.sha256) -or ($beforeGroup.exists -ne $afterGroup.exists)
    $groupExpectationMet = switch ($ExpectedGroupChange) {
        'change' { $groupChanged }
        'unchanged' { -not $groupChanged }
        default { $true }
    }
    $expectedText = switch ($ExpectedGroupChange) {
        'change' { 'expected to change' }
        'unchanged' { 'expected to stay unchanged' }
        default { 'any change accepted' }
    }
    Add-SpikeCheck -Id 'AUD-3' -Description ("dsh-session-groups.json {0}" -f $expectedText) -Pass $groupExpectationMet `
        -Detail ("exists(before={0}, after={1}); revision(before={2}, after={3}); sha(before={4}, after={5})" -f `
            $beforeGroup.exists, $afterGroup.exists, $beforeGroup.revision, $afterGroup.revision, `
            $beforeGroup.sha256, $afterGroup.sha256)
    if ($afterGroup.exists -and -not $afterGroup.valid -and -not $afterGroup.warning) {
        $warnings += 'group file exists but is not valid JSON'
    }

    # 4. desktop / web profile fingerprints untouched.
    $baselineProfiles = Get-AuditProp -Object $Baseline -Name 'profiles'
    $afterProfiles = Get-AuditProp -Object $After -Name 'profiles'
    foreach ($reserved in $script:SpikeReservedProfiles) {
        $beforeProfile = Get-AuditProp -Object $baselineProfiles -Name $reserved
        $afterProfile = Get-AuditProp -Object $afterProfiles -Name $reserved
        $beforeCanonical = Get-SpikeFingerprintCanonical -Fingerprint $beforeProfile
        $afterCanonical = Get-SpikeFingerprintCanonical -Fingerprint $afterProfile
        $same = ($beforeCanonical -eq $afterCanonical)
        Add-SpikeCheck -Id ("AUD-P-{0}" -f $reserved) -Description "$reserved profile fingerprint unchanged" -Pass $same `
            -Detail ("canonical={0}" -f $afterCanonical)
    }

    # 5. other storages files: must not change either (strict mode) / warn otherwise.
    $allowed = @($script:SpikeGroupFileName, "$($script:SpikeGroupFileName).bak", "$($script:SpikeGroupFileName).tmp")
    $beforeStorage = @{}
    foreach ($item in @(Get-AuditProp -Object $Baseline -Name 'storagesTopLevel')) {
        if ($item.kind -eq 'file') { $beforeStorage[$item.name] = $item.sha256 }
    }
    $afterStorage = @{}
    foreach ($item in @(Get-AuditProp -Object $After -Name 'storagesTopLevel')) {
        if ($item.kind -eq 'file') { $afterStorage[$item.name] = $item.sha256 }
    }
    $unexpected = @()
    foreach ($name in ($beforeStorage.Keys + $afterStorage.Keys | Sort-Object -Unique)) {
        if ($allowed -contains $name) { continue }
        if ($name -like "$($script:SpikeGroupFileName).corrupt-*") { continue }
        $beforeHash = if ($beforeStorage.ContainsKey($name)) { $beforeStorage[$name] } else { $null }
        $afterHash = if ($afterStorage.ContainsKey($name)) { $afterStorage[$name] } else { $null }
        if ($beforeHash -ne $afterHash) { $unexpected += $name }
    }
    if ($StrictStorages) {
        Add-SpikeCheck -Id 'AUD-4' -Description 'no unexpected writes in ~/.dsh/storages top level' -Pass ($unexpected.Count -eq 0) `
            -Detail ("changed: " + ($(if ($unexpected.Count) { $unexpected -join ', ' } else { '(none)' })))
    } else {
        if ($unexpected.Count -gt 0) {
            $warnings += ('non-audited storages files changed (host-side activity; not counted as a plugin write): ' + ($unexpected -join ', '))
        }
    }

    return [pscustomobject]@{
        workspaceUnchanged  = $workspaceUnchanged
        groupFileChanged    = $groupChanged
        groupExpectationMet = $groupExpectationMet
        sampleSessions      = @($afterSamples | ForEach-Object { [pscustomobject]@{ sessionId = $_.sessionId; path = $_.path; manifestHash = $_.manifestHash; fileCount = $_.fileCount; totalBytes = $_.totalBytes } })
        unexpectedStorages  = @($unexpected)
        warnings            = @($warnings)
    }
}

function Get-AuditHttpTarget {
    $state = Get-SpikeWebState -EvidenceDir $evidence
    if ($state -and $state.url -and $state.baseUrl) {
        return [pscustomobject]@{ url = $state.url; baseUrl = $state.baseUrl; token = $state.token; source = 'web.json' }
    }
    $outLog = Get-SpikeLatestFile -Directory $logs -Filter 'web-*.out.log'
    if ($outLog) {
        $info = Get-SpikeWebTokenInfoFromLog -OutLog $outLog -TimeoutSec 1
        if ($info) {
            return [pscustomobject]@{ url = $info.url; baseUrl = $info.baseUrl; token = $info.token; source = $outLog }
        }
    }
    return $null
}

function Invoke-ExerciseHttp {
    $target = Get-AuditHttpTarget
    $targetBase = $null
    $tokenSource = $null
    if ($target) {
        $targetBase = $target.baseUrl
        $tokenSource = $target.source
    }
    $result = [ordered]@{
        attempted      = $true
        target         = $targetBase
        tokenSource    = $tokenSource
        authStatus     = $null
        loadStatus     = $null
        loadOk         = $null
        revisionBefore = $null
        commitStatus   = $null
        commitOk       = $null
        revisionAfter  = $null
    }
    if (-not $target) {
        Add-SpikeCheck -Id 'AUD-5' -Description 'HTTP load probe skipped: no harness server token URL found' -Pass $false `
            -Detail 'run scripts/spike/start-web.ps1 first'
        $result.error = 'no-token-url'
        return $result
    }
    $session = New-Object Microsoft.PowerShell.Commands.WebRequestSession
    try {
        $root = Invoke-WebRequest -Uri $target.url -UseBasicParsing -WebSession $session -TimeoutSec 15 -SkipHttpErrorCheck
        $result.authStatus = [int]$root.StatusCode
        Add-SpikeCheck -Id 'AUD-5' -Description 'harness web UI reachable with auth token' -Pass ([int]$root.StatusCode -eq 200) `
            -Detail ("status={0}; source={1}" -f $root.StatusCode, $target.source)
    } catch {
        Add-SpikeCheck -Id 'AUD-5' -Description 'harness web UI reachable with auth token' -Pass $false -Detail $_.Exception.Message
        $result.error = $_.Exception.Message
        return $result
    }

    $loadUrl = $target.baseUrl + 'dsh-session-groups/load'
    try {
        $load = Invoke-WebRequest -Uri $loadUrl -UseBasicParsing -WebSession $session -TimeoutSec 15 -SkipHttpErrorCheck
        $result.loadStatus = [int]$load.StatusCode
        $bodyText = [string]$load.Content
        $parsed = $null
        try { $parsed = $bodyText | ConvertFrom-Json } catch { }
        $ok = ([int]$load.StatusCode -eq 200) -and ($parsed -and $parsed.ok -eq $true)
        $result.loadOk = [bool]$ok
        if ($parsed -and $null -ne $parsed.revision) { $result.revisionBefore = $parsed.revision }
        Add-SpikeCheck -Id 'AUD-6' -Description 'GET /dsh-session-groups/load returns 200 {ok:true}' -Pass $ok `
            -Detail ("status={0}; revision={1}; body={2}" -f $load.StatusCode, $result.revisionBefore, $bodyText.Substring(0, [Math]::Min(220, $bodyText.Length)))
    } catch {
        Add-SpikeCheck -Id 'AUD-6' -Description 'GET /dsh-session-groups/load returns 200 {ok:true}' -Pass $false -Detail $_.Exception.Message
        $result.error = $_.Exception.Message
        return $result
    }

    if ($CommitProbe) {
        $commitUrl = $target.baseUrl + 'dsh-session-groups/commit'
        try {
            $loadBody = [string]$load.Content
            $parsed = $loadBody | ConvertFrom-Json
            $payload = [ordered]@{ baseRevision = $parsed.revision; doc = $parsed.doc } | ConvertTo-Json -Depth 40 -Compress
            $commit = Invoke-WebRequest -Uri $commitUrl -Method Post -UseBasicParsing -WebSession $session `
                -ContentType 'application/json' -Body ([System.Text.Encoding]::UTF8.GetBytes($payload)) `
                -TimeoutSec 20 -SkipHttpErrorCheck
            $result.commitStatus = [int]$commit.StatusCode
            $commitBody = [string]$commit.Content
            $commitParsed = $null
            try { $commitParsed = $commitBody | ConvertFrom-Json } catch { }
            $commitOk = ([int]$commit.StatusCode -eq 200) -and ($commitParsed -and $commitParsed.ok -eq $true)
            $result.commitOk = [bool]$commitOk
            if ($commitParsed -and $null -ne $commitParsed.revision) { $result.revisionAfter = $commitParsed.revision }
            Add-SpikeCheck -Id 'AUD-7' -Description 'POST /dsh-session-groups/commit (no-op probe) returns 200' -Pass $commitOk `
                -Detail ("status={0}; revision {1} -> {2}" -f $commit.StatusCode, $result.revisionBefore, $result.revisionAfter)
        } catch {
            Add-SpikeCheck -Id 'AUD-7' -Description 'POST /dsh-session-groups/commit (no-op probe) returns 200' -Pass $false -Detail $_.Exception.Message
        }
    }
    return $result
}

function Get-ExpectedGroupChange {
    if ($ExpectGroupFile -ne 'auto') { return $ExpectGroupFile }
    if ($Mode -eq 'exercise' -and $CommitProbe -and -not $SkipHttp) { return 'change' }
    return 'unchanged'
}

# ---------------------------------------------------------------------------
# main
# ---------------------------------------------------------------------------
$evidencePath = $null
try {
    Write-Host ''
    Write-Host '============================================================'
    Write-Host " Gate 0 QA harness - data audit (mode: $Mode)"
    Write-Host '============================================================'
    Reset-SpikeChecks
    $samplePaths = @(Resolve-SampleSessionDirs -Explicit $SampleSessionDirs -MaxAgeMinutes $MaxSessionAgeMinutes)
    Write-SpikeLogLine -Message ("sample sessions: " + (($samplePaths | ForEach-Object { Split-Path -Leaf $_ }) -join ', '))
    Write-SpikeLogLine -Message ("workspace.json: {0}" -f $workspaceJsonPath)

    $expectedGroupChange = Get-ExpectedGroupChange
    $baselineSnapshot = $null
    $baselinePathToUse = $null

    if ($Mode -eq 'baseline') {
        $baselineSnapshot = Get-AuditSnapshot -Label 'baseline' -SampleDirs $samplePaths
        $baselinePathToUse = Join-Path $evidence ("audit-baseline-$timestamp.json")
        Write-SpikeEvidenceJson -Path $baselinePathToUse -Data $baselineSnapshot | Out-Null
        Add-SpikeCheck -Id 'AUD-0' -Description 'baseline snapshot recorded' -Pass $true -Detail $baselinePathToUse
        $evidencePath = $baselinePathToUse
        Write-SpikeSummary -Title "data audit (baseline)" -EvidencePath $evidencePath | Out-Null
    }
    elseif ($Mode -eq 'verify') {
        $baselinePathToUse = $BaselinePath
        if (-not $baselinePathToUse) {
            $baselinePathToUse = Get-SpikeLatestFile -Directory $evidence -Filter 'audit-baseline-*.json'
        }
        if (-not $baselinePathToUse -or -not (Test-Path -LiteralPath $baselinePathToUse -PathType Leaf)) {
            throw "no baseline found (run -Mode baseline first, or pass -BaselinePath)"
        }
        $loadedBaseline = Get-Content -LiteralPath $baselinePathToUse -Raw | ConvertFrom-Json
        # Re-audit exactly the sample dirs the baseline recorded.
        $baselineSampleDirs = @($loadedBaseline.sampleSessions | ForEach-Object { [string]$_.path })
        if ($baselineSampleDirs.Count -eq 0) { throw "baseline '$baselinePathToUse' contains no sample sessions" }
        $afterSnapshot = Get-AuditSnapshot -Label 'after' -SampleDirs $baselineSampleDirs
        $comparison = Compare-AuditSnapshots -Baseline $loadedBaseline -After $afterSnapshot -ExpectedGroupChange $expectedGroupChange
        $evidencePath = Join-Path $evidence ("audit-verify-$timestamp.json")
        Write-SpikeEvidenceJson -Path $evidencePath -Data ([ordered]@{
                kind = 'host-write-audit-verify'; createdAt = Get-SpikeUtcNowIso; mode = $Mode
                baselinePath = $baselinePathToUse; baseline = $loadedBaseline; after = $afterSnapshot
                expectedGroupChange = $expectedGroupChange; comparison = $comparison; checks = @(Get-SpikeChecks)
            }) | Out-Null
        Write-SpikeSummary -Title 'data audit (verify)' -EvidencePath $evidencePath | Out-Null
    }
    else {
        # exercise: snapshot -> HTTP probe -> snapshot -> assert.
        # The live Desktop host may legitimately rewrite workspace.json / an active
        # session while we run; if only those environmental checks fail, retry a
        # bounded number of times instead of failing the plugin.
        $maxAttempts = [Math]::Max(1, $Retries + 1)
        $attempt = 0
        $comparison = $null
        $exerciseHttp = $null
        while ($attempt -lt $maxAttempts) {
            $attempt++
            $checksBefore = Get-SpikeCheckCount
            $baselineSnapshot = Get-AuditSnapshot -Label 'baseline' -SampleDirs $samplePaths
            if ($SkipHttp) {
                Add-SpikeCheck -Id 'AUD-5' -Description 'HTTP probe skipped on request (-SkipHttp)' -Pass $true
            } else {
                $exerciseHttp = Invoke-ExerciseHttp
            }
            Start-Sleep -Milliseconds 300
            $afterSnapshot = Get-AuditSnapshot -Label 'after' -SampleDirs $samplePaths
            $comparison = Compare-AuditSnapshots -Baseline $baselineSnapshot -After $afterSnapshot -ExpectedGroupChange $expectedGroupChange
            $attemptChecks = @(@(Get-SpikeChecks) | Select-Object -Skip $checksBefore)
            $failed = @($attemptChecks | Where-Object { -not $_.pass })
            $environmental = @($failed | Where-Object { $_.id -match '^AUD-(1|S\d+)$' })
            $hardFailures = @($failed | Where-Object { $_.id -notmatch '^AUD-(1|S\d+)$' })
            if ($hardFailures.Count -eq 0 -and $environmental.Count -gt 0 -and $attempt -lt $maxAttempts) {
                Remove-SpikeChecks -Keep $checksBefore
                Write-SpikeLogLine -Message ("audit attempt {0}/{1}: host-side change detected in workspace.json/sample session; retrying" -f $attempt, $maxAttempts)
                Start-Sleep -Milliseconds 700
                continue
            }
            break
        }
        Add-SpikeCheck -Id 'AUD-0' -Description ("audit attempts used: {0}/{1}" -f $attempt, $maxAttempts) -Pass $true
        $probeSuffix = if ($CommitProbe) { 'commit' } else { 'load' }
        $evidencePath = Join-Path $evidence ("audit-exercise-$timestamp-$probeSuffix.json")
        Write-SpikeEvidenceJson -Path $evidencePath -Data ([ordered]@{
                kind = 'host-write-audit-exercise'; createdAt = Get-SpikeUtcNowIso; mode = $Mode
                attempts = $attempt; expectedGroupChange = $expectedGroupChange
                baseline = $baselineSnapshot; after = $afterSnapshot
                http = $exerciseHttp; comparison = $comparison; checks = @(Get-SpikeChecks)
            }) | Out-Null
        foreach ($warning in @($comparison.warnings)) {
            Write-Host ("  [WARN] {0}" -f $warning) -ForegroundColor Yellow
        }
        Write-SpikeSummary -Title 'data audit (exercise)' -EvidencePath $evidencePath | Out-Null
    }
} catch {
    Write-Host ''
    Write-Host ("AUDIT ERROR: {0}" -f $_.Exception.Message) -ForegroundColor Red
    Add-SpikeCheck -Id 'AUD-ERR' -Description 'audit completed without harness error' -Pass $false -Detail $_.Exception.Message
    $exitCode = 1
    if (-not $evidencePath) {
        $evidencePath = Join-Path $evidence ("audit-error-$timestamp.json")
        try {
            Write-SpikeEvidenceJson -Path $evidencePath -Data ([ordered]@{
                    kind = 'host-write-audit-error'; createdAt = Get-SpikeUtcNowIso; mode = $Mode
                    error = $_.Exception.Message; checks = @(Get-SpikeChecks)
                }) | Out-Null
        } catch { }
    }
    Write-SpikeSummary -Title 'data audit' -EvidencePath $evidencePath | Out-Null
} finally {
    $checks = @(Get-SpikeChecks)
    $failed = @($checks | Where-Object { -not $_.pass })
    if ($failed.Count -gt 0) { $exitCode = 1 }
}

exit $exitCode



