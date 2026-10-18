# scripts/spike/setup-profile.ps1
#
# Gate 0 QA harness - create the disposable, data-ISOLATED environment.
#
# Isolation (architecture review M0):
#   The PATH `dsh.cmd` shim hardcodes DSH_HOME=%USERPROFILE%\.dsh, so pointing
#   $env:DSH_HOME at another directory and calling `dsh` WOULD STILL WRITE THE REAL
#   HOME. This harness therefore launches the packaged Desktop runtime directly:
#       <DSH Desktop.exe> --expose-internals <resources\app\lib\desktop-cli.js> ...
#   with ELECTRON_RUN_AS_NODE=1 and DSH_HOME=<repo>\.spike-home.
#
# What it does:
#   1. snapshots the real DSH home (READ-ONLY) so we can prove it stays untouched:
#      real workspace.json + desktop/web/groups-spike profile fingerprints + sessions tree;
#   2. creates <repo>\.spike-home and seeds FROZEN COPIES of real data into it:
#      storages\workspace.json + sessions\** (so S1/S2 see 3 workspaces / ~25 sessions);
#   3. recreates the custom profile "groups-spike" INSIDE .spike-home from the shipped
#      web template (`--from-default-profile web --dump-config`: creates and exits);
#   4. installs spike/host-plugin and spike/client-plugin with `dsh plugin ... add link:...`
#      and verifies both are in the isolated profile's dependencies + bundle stack;
#   5. re-checks the real home fingerprints (must be byte-identical);
#   6. optionally starts the isolated web server (start-web.ps1).
#
# Usage:
#   pwsh -NoProfile -File scripts/spike/setup-profile.ps1
#   pwsh -NoProfile -File scripts/spike/setup-profile.ps1 -NoSessionFixtures -StartWeb
#   pwsh -NoProfile -File scripts/spike/setup-profile.ps1 -SpikeHome <repo>\.spike-home-qa
#
# Exit codes: 0 = PASS, 1 = FAIL, 2 = plugin package missing/incomplete.

[CmdletBinding()]
param(
    [int]$Port = 4402,
    [string]$SpikeHome,
    [switch]$SkipRecreate,
    [switch]$SkipInstall,
    [switch]$NoFixtures,
    [switch]$NoSessionFixtures,
    [switch]$AllowIncompletePlugins,
    [switch]$StartWeb,
    [int]$StartTimeoutSec = 120,
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
$setupLog = Join-Path $logs "setup-$timestamp.log"
$evidencePath = Join-Path $evidence "setup-$timestamp.json"

$setupState = [ordered]@{
    kind           = 'gate0-setup'
    createdAt      = Get-SpikeUtcNowIso
    repoRoot       = (Get-SpikeRepoRoot)
    spikeHome      = (Get-SpikeHome)
    realDshHome    = (Get-SpikeRealDshHome)
    profile        = $script:SpikeAllowedProfile
    profileDir     = (Get-SpikeProfileDir)
    port           = $Port
    dshVersion     = $null
    runtime        = $null
    fixtures       = $null
    commands       = @()
    plugins        = @()
    profilePackage = $null
    realHomeBefore = $null
    realHomeAfter  = $null
    checks         = @()
    result         = 'FAIL'
}

function Save-SetupState {
    $setupState.checks = @(Get-SpikeChecks)
    Write-SpikeEvidenceJson -Path $evidencePath -Data $setupState | Out-Null
}

try {
    Write-Host ''
    Write-Host '============================================================'
    Write-Host ' Gate 0 QA harness - setup isolated DSH home + profile'
    Write-Host '============================================================'
    Reset-SpikeChecks
    Assert-SpikeProfile -Profile $script:SpikeAllowedProfile
    Assert-SpikePort -Port $Port
    Assert-SpikeHome
    Write-SpikeLogLine -Message "repo:        $(Get-SpikeRepoRoot)" -LogFile $setupLog
    Write-SpikeLogLine -Message "spike home:  $(Get-SpikeHome)  (ALL writes land here)" -LogFile $setupLog
    Write-SpikeLogLine -Message "real home:   $(Get-SpikeRealDshHome)  (READ-ONLY: fixture source + fingerprint)" -LogFile $setupLog

    $runtime = Get-SpikeDesktopRuntime
    $setupState.runtime = $runtime
    Add-SpikeCheck -Id 'ENV-0' -Description 'packaged Desktop runtime found for isolated dsh (not the PATH shim)' -Pass $true `
        -Detail ("exe={0}; cli={1}; via {2}" -f $runtime.desktopExe, $runtime.desktopCli, $runtime.source)

    # -- 1. read-only snapshot of the real DSH home -------------------------
    $realHomeBefore = Get-SpikeRealHomeState
    $setupState.realHomeBefore = $realHomeBefore
    Add-SpikeCheck -Id 'SAFE-1' -Description 'real DSH home fingerprinted before setup (read-only)' -Pass $true `
        -Detail ("profiles={0}; sessions dirs={1}" -f (($realHomeBefore.profiles.Keys) -join ','), `
            (Get-SpikeProp -Object $realHomeBefore.sessions -Name 'sessionDirs'))

    # -- 2. create .spike-home and seed frozen fixtures ---------------------
    $spikeHome = Get-SpikeHome
    if (-not (Test-Path -LiteralPath $spikeHome)) {
        New-Item -ItemType Directory -Force -Path $spikeHome | Out-Null
    }
    Add-SpikeCheck -Id 'HOME-1' -Description 'disposable DSH home exists inside the repo' -Pass (Test-Path -LiteralPath $spikeHome) `
        -Detail $spikeHome

    if (-not $NoFixtures) {
        Write-SpikeLogLine -Message 'seeding frozen fixtures (read-only copy of real workspace.json + sessions)...' -LogFile $setupLog
        $fixtures = Copy-SpikeHomeFixtures -SkipSessions:$NoSessionFixtures
        $setupState.fixtures = $fixtures
        $fixtureOk = ($fixtures.sessionDirs -gt 0) -and $fixtures.workspaceJson
        Add-SpikeCheck -Id 'HOME-2' -Description 'frozen fixtures seeded into .spike-homes/qa (workspace.json + sessions + session_projcache)' `
            -Pass $fixtureOk -Detail ("workspace.json={0}; sessions={1} dirs/{2} files/{3} bytes; session_projcache={4}; skipped={5}" -f `
                $fixtures.workspaceJson, $fixtures.sessionDirs, $fixtures.sessionFiles, $fixtures.sessionBytes, `
                $fixtures.sessionProjCache, ($fixtures.skipped -join ','))
        if (-not $fixtureOk) { throw 'fixture seeding failed (need real workspace.json + sessions); pass -NoFixtures to skip intentionally' }
    } else {
        Write-SpikeLogLine -Message 'fixtures skipped (-NoFixtures): the isolated home stays empty' -LogFile $setupLog
        Add-SpikeCheck -Id 'HOME-2' -Description 'fixtures skipped on request (-NoFixtures)' -Pass $true
    }

    # -- 3. recreate the disposable profile inside .spike-home --------------
    $profileDir = Get-SpikeProfileDir
    if ($SkipRecreate -and (Test-Path -LiteralPath (Join-Path $profileDir 'package.json') -PathType Leaf)) {
        Write-SpikeLogLine -Message 'profile recreation skipped (-SkipRecreate)' -LogFile $setupLog
        Add-SpikeCheck -Id 'PROFILE-1' -Description 'isolated profile exists (recreate skipped on request)' -Pass $true -Detail $profileDir
    } else {
        $dumpOut = Join-Path $logs "setup-dump-config-$timestamp.out.log"
        $dumpErr = Join-Path $logs "setup-dump-config-$timestamp.err.log"
        Write-SpikeLogLine -Message 'creating isolated profile from shipped web template (--dump-config)...' -LogFile $setupLog
        $dump = Invoke-SpikeDsh -Arguments @('--profile', $script:SpikeAllowedProfile, '--from-default-profile', 'web', '--dump-config') `
            -OutLog $dumpOut -ErrLog $dumpErr -TimeoutSec 240
        $setupState.commands += [pscustomobject]@{
            command  = "dsh(iso) --profile $($script:SpikeAllowedProfile) --from-default-profile web --dump-config"
            exitCode = $dump.exitCode
            outLog   = $dumpOut
            errLog   = $dumpErr
        }
        $dumpErrTail = ''
        if (Test-Path -LiteralPath $dumpErr) { $dumpErrTail = ((Get-Content -LiteralPath $dumpErr -Tail 10) -join ' | ') }
        Add-SpikeCheck -Id 'PROFILE-1' -Description 'isolated profile created from the shipped web template' -Pass ($dump.exitCode -eq 0) `
            -Detail ("exit={0}; err={1}" -f $dump.exitCode, $dumpErrTail)
        if ($dump.exitCode -ne 0) { throw "isolated profile creation failed (see $dumpErr)" }
    }

    $profileDir = Get-SpikeProfileDir
    $profilePackage = Read-SpikeProfilePackage
    $setupState.profilePackage = $profilePackage
    $profileOk = ($null -ne $profilePackage) -and (Test-Path -LiteralPath $profileDir -PathType Container) -and
        ([System.IO.Path]::GetFullPath($profileDir).StartsWith([System.IO.Path]::GetFullPath((Get-SpikeHome)), [System.StringComparison]::OrdinalIgnoreCase))
    Add-SpikeCheck -Id 'PROFILE-2' -Description 'isolated profile package.json is readable and inside .spike-home' -Pass $profileOk -Detail $profileDir
    if (-not $profileOk) { throw "profile package.json missing under $profileDir" }

    $bundles = @()
    if ($profilePackage.dsh -and $profilePackage.dsh.profile -and $profilePackage.dsh.profile.bundles) {
        $bundles = @($profilePackage.dsh.profile.bundles)
    }
    $templateOk = ($bundles -contains '@deepseek-ai/dsh-base') -and ($bundles -contains '@deepseek-ai/dsh-web-app')
    Add-SpikeCheck -Id 'PROFILE-3' -Description 'profile bundle stack is the shipped web template' -Pass $templateOk `
        -Detail ("bundles=[{0}]" -f ($bundles -join ', '))

    # -- 4. install the two spike plugins into the isolated profile --------
    $pluginSpecs = @(Get-SpikePluginSpecs)
    $setupState.plugins = @($pluginSpecs | ForEach-Object {
            [ordered]@{
                role      = $_.role
                dir       = $_.dir
                name      = $_.name
                exists    = $_.exists
                installed = $false
                complete  = $false
            }
        })
    $missing = @($pluginSpecs | Where-Object { -not $_.exists })
    if ($missing.Count -gt 0) {
        $missingList = @($missing | ForEach-Object { $_.role }) -join ', '
        $detail = "missing package.json under: " + (@($missing | ForEach-Object { $_.dir }) -join ', ')
        Add-SpikeCheck -Id 'PLUGIN-0' -Description 'both spike plugin packages present' -Pass $false -Detail $detail
        Save-SetupState
        if (-not $AllowIncompletePlugins) {
            throw "spike plugin package(s) not found ($missingList). Expected spike/host-plugin/package.json and spike/client-plugin/package.json. Missing: $detail"
        }
    } else {
        Add-SpikeCheck -Id 'PLUGIN-0' -Description 'both spike plugin packages present' -Pass $true `
            -Detail (($pluginSpecs | ForEach-Object { $_.dir }) -join '; ')
    }

    foreach ($index in 0..($pluginSpecs.Count - 1)) {
        $spec = $pluginSpecs[$index]
        if (-not $spec.exists) { continue }
        $manifestPath = Join-Path $spec.dir 'package.json'
        $manifest = $null
        try { $manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json } catch { }
        $hasBundle = [bool]($manifest -and $manifest.dsh -and $manifest.dsh.bundle -and $manifest.dsh.bundle.patch)
        $mainRel = if ($manifest -and $manifest.main) { [string]$manifest.main } else { $null }
        $mainPath = if ($mainRel) { Join-Path $spec.dir $mainRel } else { $null }
        $hasMain = [bool]($mainPath -and (Test-Path -LiteralPath $mainPath -PathType Leaf))
        $patchPath = if ($hasBundle) { Join-Path $spec.dir ([string]$manifest.dsh.bundle.patch) } else { $null }
        $hasPatch = [bool]($patchPath -and (Test-Path -LiteralPath $patchPath -PathType Leaf))
        $complete = $hasBundle -and $hasMain -and $hasPatch -and (-not [string]::IsNullOrWhiteSpace($spec.name))
        $setupState.plugins[$index].complete = $complete
        $detail = "name=$($spec.name); main=$mainRel (exists=$hasMain); bundle.patch=$($manifest.dsh.bundle.patch) (exists=$hasPatch)"
        Add-SpikeCheck -Id ("PLUGIN-{0}" -f ($index + 1)) -Description "$($spec.role) plugin package is complete" -Pass $complete -Detail $detail
        if (-not $complete -and -not $AllowIncompletePlugins) {
            Save-SetupState
            throw "$($spec.role) plugin package at $($spec.dir) is incomplete: $detail. Finish the spike plugin or pass -AllowIncompletePlugins."
        }
    }

    if (-not $SkipInstall) {
        $linkArgs = @('plugin', '--profile', $script:SpikeAllowedProfile, 'add')
        foreach ($spec in $pluginSpecs) {
            if ($spec.exists) { $linkArgs += ('link:' + $spec.dir) }
        }
        $installOut = Join-Path $logs "setup-plugin-add-$timestamp.out.log"
        $installErr = Join-Path $logs "setup-plugin-add-$timestamp.err.log"
        Write-SpikeLogLine -Message ("installing into isolated profile: dsh(iso) " + ($linkArgs -join ' ')) -LogFile $setupLog
        $install = Invoke-SpikeDsh -Arguments $linkArgs -OutLog $installOut -ErrLog $installErr -TimeoutSec 600
        $installErrTail = ''
        if (Test-Path -LiteralPath $installErr) { $installErrTail = ((Get-Content -LiteralPath $installErr -Tail 12) -join ' | ') }
        $setupState.commands += [pscustomobject]@{
            command  = ('dsh(iso) ' + ($linkArgs -join ' '))
            exitCode = $install.exitCode
            outLog   = $installOut
            errLog   = $installErr
        }
        Add-SpikeCheck -Id 'PLUGIN-3' -Description 'plugin install command exited 0' -Pass ($install.exitCode -eq 0) `
            -Detail ("exit={0}; err={1}" -f $install.exitCode, $installErrTail)

        $profilePackage = Read-SpikeProfilePackage
        $setupState.profilePackage = $profilePackage
        $installedDeps = @()
        if ($profilePackage.dependencies) { $installedDeps = @($profilePackage.dependencies.PSObject.Properties.Name) }
        $installedBundles = @()
        if ($profilePackage.dsh -and $profilePackage.dsh.profile -and $profilePackage.dsh.profile.bundles) {
            $installedBundles = @($profilePackage.dsh.profile.bundles)
        }
        foreach ($index in 0..($pluginSpecs.Count - 1)) {
            $spec = $pluginSpecs[$index]
            if (-not $spec.exists -or [string]::IsNullOrWhiteSpace($spec.name)) { continue }
            $inDeps = $installedDeps -contains $spec.name
            $inBundles = $installedBundles -contains $spec.name
            $nodeModulesPath = Join-Path $profileDir ('node_modules\' + $spec.name)
            $linked = Test-Path -LiteralPath $nodeModulesPath
            $setupState.plugins[$index].installed = ($inDeps -and $inBundles -and $linked)
            $detail = "dep=$inDeps; bundles=$inBundles; node_modules link=$linked"
            Add-SpikeCheck -Id ("PLUGIN-{0}" -f ($index + 4)) -Description "$($spec.name) installed into isolated profile and bundle stack" `
                -Pass ($inDeps -and $inBundles -and $linked) -Detail $detail
        }
    } else {
        Write-SpikeLogLine -Message 'plugin installation skipped (-SkipInstall)' -LogFile $setupLog
        Add-SpikeCheck -Id 'PLUGIN-3' -Description 'plugin install skipped on request' -Pass $true
    }

    # -- 5. prove the real DSH home is untouched ---------------------------
    $realHomeAfter = Get-SpikeRealHomeState
    $setupState.realHomeAfter = $realHomeAfter
    $realComparison = Test-SpikeRealHomeUnchanged -Before $realHomeBefore -After $realHomeAfter
    Add-SpikeCheck -Id 'SAFE-2' -Description 'real DSH home (workspace.json / desktop / web / sessions) unchanged by setup' `
        -Pass $realComparison.unchanged -Detail (($realComparison.problems + @('(no changes)'))[0])
    $spikeHomeOk = ([System.IO.Path]::GetFullPath((Get-SpikeHome))).StartsWith([System.IO.Path]::GetFullPath((Get-SpikeRepoRoot)), [System.StringComparison]::OrdinalIgnoreCase)
    Add-SpikeCheck -Id 'SAFE-3' -Description 'all setup writes are inside the disposable .spike-home' -Pass $spikeHomeOk `
        -Detail ("spike home={0}" -f (Get-SpikeHome))

    if ($realComparison.unchanged) { $setupState.result = 'PASS' }
} catch {
    Write-Host ''
    Write-Host ("SETUP ERROR: {0}" -f $_.Exception.Message) -ForegroundColor Red
    $setupState.error = $_.Exception.Message
    $exitCode = 1
} finally {
    if ($exitCode -eq 0 -and -not (Write-SpikeSummary -Title 'setup-profile (isolated home)' -EvidencePath $evidencePath)) {
        $exitCode = 1
    }
    if ($exitCode -ne 0) { $setupState.result = 'FAIL' }
    $setupState.checks = @(Get-SpikeChecks)
    try { Write-SpikeEvidenceJson -Path $evidencePath -Data $setupState | Out-Null } catch { Write-Host ("WARN: could not write setup evidence: {0}" -f $_.Exception.Message) }
}

if ($exitCode -eq 0 -and $StartWeb) {
    Write-Host ''
    Write-Host '--- starting isolated web server ---'
    & (Join-Path $PSScriptRoot 'start-web.ps1') -Port $Port -Profile $script:SpikeAllowedProfile `
        -SpikeHome (Get-SpikeHome) -TimeoutSec $StartTimeoutSec -EvidenceDir $evidence
    if ($LASTEXITCODE -ne 0) { $exitCode = $LASTEXITCODE }
}

Write-Host ''
if ($exitCode -eq 0) {
    Write-Host 'NEXT: pwsh -NoProfile -File scripts/spike/start-web.ps1      (boot isolated web on 4402)'
    Write-Host '      pwsh -NoProfile -File scripts/spike/smoke.ps1           (HTTP + console-error smoke)'
    Write-Host '      pwsh -NoProfile -File scripts/spike/audit-no-host-writes.ps1'
}
exit $exitCode



