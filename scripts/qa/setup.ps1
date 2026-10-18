# scripts/qa/setup.ps1
#
# V1 QA harness - create the disposable, data-ISOLATED environment and install the
# V1 plugin package (repo root) into it.
#
# Isolation (docs/SPIKE.md §0-§2 / Gate 0):
#   * DSH_HOME = <repo>\.spike-homes\qa (throw-away), profile groups-spike, port 4402.
#   * The PATH `dsh.cmd` shim hardcodes DSH_HOME=%USERPROFILE%\.dsh, so it MUST NOT be
#     used; we launch the packaged Desktop runtime directly with ELECTRON_RUN_AS_NODE=1.
#   * Real %USERPROFILE%\.dsh is READ-ONLY: only frozen fixtures are copied out of it
#     (sessions/** + storages/workspace.json + storages/session_projcache/**; never
#     .credentials.yaml / .anonymous-user-id) and its fingerprints are checked before/after.
#
# What it does:
#   1. snapshot the real DSH home (read-only proof);
#   2. create .spike-homes/qa and seed frozen fixtures;
#   3. create profile groups-spike from the shipped web template (--dump-config);
#   4. validate the repo package (dsh.bundle.patch / dsh.client / main / build output);
#   5. stage ONLY the publishable package files under the isolated home and install
#      `link:<staging>`; never link the repo root (a junction to the repo makes pnpm
#      recurse into .spike-homes and teardown can follow it into .git); verify the
#      package is in dependencies + dsh.profile.bundles + node_modules;
#   6. re-check the real home fingerprints (must be unchanged);
#   7. optionally start the isolated server (start-web.ps1).
#
# Usage:
#   pwsh -NoProfile -File scripts/qa/setup.ps1
#   pwsh -NoProfile -File scripts/qa/setup.ps1 -RequireClientBuild -StartWeb
#   pwsh -NoProfile -File scripts/qa/setup.ps1 -QaHome <repo>\.spike-homes\qa-selftest
#
# Exit codes: 0 = PASS, 1 = FAIL, 2 = package/build incomplete (client build missing and
#             -RequireClientBuild was set).

[CmdletBinding()]
param(
    [int]$Port = 4402,
    [string]$QaHome,
    [switch]$SkipRecreate,
    [switch]$RequireClientBuild,
    [switch]$SkipInstall,
    [switch]$NoFixtures,
    [switch]$NoSessionFixtures,
    [switch]$StartWeb,
    [int]$StartTimeoutSec = 120,
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
$setupLog = Join-Path $logs "setup-$timestamp.log"
$evidencePath = Join-Path $evidence "setup-$timestamp.json"
$repoRoot = Get-QaRepoRoot
$packageJsonPath = Join-Path $repoRoot 'package.json'

$state = [ordered]@{
    kind           = 'v1-setup'
    createdAt      = Get-QaUtcNowIso
    repoRoot       = $repoRoot
    qaHome         = (Get-QaHome)
    realDshHome    = (Get-QaRealDshHome)
    profile        = $script:QaAllowedProfile
    profileDir     = (Get-QaProfileDir)
    port           = $Port
    dshVersion     = $null
    runtime        = $null
    package        = $null
    clientBuild    = $null
    fixtures       = $null
    commands       = @()
    profilePackage = $null
    realHomeBefore = $null
    realHomeAfter  = $null
    checks         = @()
    result         = 'FAIL'
}

function Save-QaState {
    $state.checks = @(Get-QaChecks)
    Write-QaEvidenceJson -Path $evidencePath -Data $state | Out-Null
}

function Read-JsonFile {
    param([string]$Path)
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { return $null }
    try { return (Get-Content -LiteralPath $Path -Raw | ConvertFrom-Json) } catch { return $null }
}

try {
    Write-Host ''
    Write-Host '============================================================'
    Write-Host ' V1 QA harness - setup isolated DSH home + profile + plugin'
    Write-Host '============================================================'
    Reset-QaChecks
    Assert-QaProfile -Profile $script:QaAllowedProfile
    Assert-QaPort -Port $Port
    Assert-QaHome
    Write-QaLogLine -Message "repo:       $repoRoot" -LogFile $setupLog
    Write-QaLogLine -Message "qa home:    $(Get-QaHome)  (ALL writes land here)" -LogFile $setupLog
    Write-QaLogLine -Message "real home:  $(Get-QaRealDshHome)  (READ-ONLY: fixtures + fingerprint)" -LogFile $setupLog

    $runtime = Get-QaDesktopRuntime
    $state.runtime = $runtime
    $dshVersion = $null
    try { $dshVersion = (& (Get-QaDshExe) --version 2>&1 | Out-String).Trim() } catch { $dshVersion = $null }
    $state.dshVersion = $dshVersion
    Add-QaCheck -Id 'ENV-0' -Description 'packaged Desktop runtime found for isolated dsh (not the PATH shim)' -Pass $true `
        -Detail ("exe={0}; via {1}; dsh CLI={2}" -f $runtime.desktopExe, $runtime.source, $dshVersion)

    # -- 1. read-only snapshot of the real DSH home -------------------------
    $realHomeBefore = Get-QaRealHomeState
    $state.realHomeBefore = $realHomeBefore
    Add-QaCheck -Id 'SAFE-1' -Description 'real DSH home fingerprinted before setup (read-only)' -Pass $true `
        -Detail ("profiles={0}" -f (($realHomeBefore.profiles.Keys) -join ','))

    # -- 2. create .spike-homes/qa + seed fixtures --------------------------
    $qaHomePath = Get-QaHome
    if (-not (Test-Path -LiteralPath $qaHomePath)) { New-Item -ItemType Directory -Force -Path $qaHomePath | Out-Null }
    Add-QaCheck -Id 'HOME-1' -Description 'disposable DSH home exists inside the repo' -Pass (Test-Path -LiteralPath $qaHomePath) -Detail $qaHomePath
    # The disposable home may be retained between runs; reset ONLY the plugin record
    # file family so every run starts from an empty group document (E2E step 2 contract).
    $storagesDir = Join-Path $qaHomePath 'storages'
    $recordFamily = @()
    if (Test-Path -LiteralPath $storagesDir -PathType Container) {
        $recordFamily = @(Get-ChildItem -LiteralPath $storagesDir -File -Force -Filter 'dsh-session-groups.json*' -ErrorAction SilentlyContinue)
        foreach ($recordFile in $recordFamily) { Remove-Item -LiteralPath $recordFile.FullName -Force }
    }
    Add-QaCheck -Id 'HOME-0' -Description 'previous run plugin record reset (fresh empty group doc)' -Pass $true `
        -Detail ("removed={0}" -f $recordFamily.Count)
    if (-not $NoFixtures) {
        Write-QaLogLine -Message 'seeding frozen fixtures (read-only copy of real workspace.json + sessions + session_projcache)...' -LogFile $setupLog
        $fixtures = Copy-QaHomeFixtures -SkipSessions:$NoSessionFixtures
        $state.fixtures = $fixtures
        $fixtureOk = ($fixtures.sessionDirs -gt 0) -and $fixtures.workspaceJson
        Add-QaCheck -Id 'HOME-2' -Description 'frozen fixtures seeded into .spike-homes/qa' -Pass $fixtureOk `
            -Detail ("workspace.json={0}; sessions={1} dirs/{2} files/{3} bytes; session_projcache={4}; skipped={5}" -f `
                $fixtures.workspaceJson, $fixtures.sessionDirs, $fixtures.sessionFiles, $fixtures.sessionBytes, `
                $fixtures.sessionProjCache, ($fixtures.skipped -join ','))
        if (-not $fixtureOk) { throw 'fixture seeding failed (need real workspace.json + sessions); pass -NoFixtures to skip intentionally' }
    } else {
        Add-QaCheck -Id 'HOME-2' -Description 'fixtures skipped on request (-NoFixtures)' -Pass $true
    }

    # -- 3. validate the repo package (V1 plugin) ---------------------------
    $manifest = Read-JsonFile -Path $packageJsonPath
    $state.package = $manifest
    $manifestOk = $null -ne $manifest
    Add-QaCheck -Id 'PKG-1' -Description 'repo package.json is readable' -Pass $manifestOk -Detail $packageJsonPath
    if (-not $manifestOk) { throw "cannot read $packageJsonPath" }
    $pkgName = [string]$manifest.name
    $bundlePatch = $null
    if ($manifest.dsh -and $manifest.dsh.bundle -and $manifest.dsh.bundle.patch) { $bundlePatch = [string]$manifest.dsh.bundle.patch }
    $patchPath = if ($bundlePatch) { Join-Path $repoRoot $bundlePatch } else { $null }
    $patchOk = [bool]($patchPath -and (Test-Path -LiteralPath $patchPath -PathType Leaf))
    $mainRel = if ($manifest.main) { [string]$manifest.main } else { 'src/index.js' }
    $mainOk = Test-Path -LiteralPath (Join-Path $repoRoot $mainRel) -PathType Leaf
    $clientPlatform = $null
    if ($manifest.dsh -and $manifest.dsh.client -and $manifest.dsh.client.platform) { $clientPlatform = [string]$manifest.dsh.client.platform }
    $clientRel = $null
    if ($manifest.exports -and $manifest.exports.'./client') { $clientRel = [string]$manifest.exports.'./client' }
    $clientBuilt = [bool]($clientRel -and (Test-Path -LiteralPath (Join-Path $repoRoot $clientRel) -PathType Leaf))
    $peerHomePaths = [bool]($manifest.peerDependencies -and $manifest.peerDependencies.'@deepseek-ai/dsh-home-paths')
    $clientBuild = [ordered]@{
        path     = if ($clientRel) { Join-Path $repoRoot $clientRel } else { $null }
        exists   = $clientBuilt
        bytes    = $null
        sha256   = $null
    }
    if ($clientBuilt) {
        $clientBuild.bytes = (Get-Item -LiteralPath (Join-Path $repoRoot $clientRel)).Length
        $clientBuild.sha256 = Get-QaFileSha256 -Path (Join-Path $repoRoot $clientRel)
    }
    $state.clientBuild = $clientBuild
    Add-QaCheck -Id 'PKG-2' -Description 'package declares dsh.bundle.patch and the file exists' -Pass $patchOk `
        -Detail ("patch={0}" -f $bundlePatch)
    Add-QaCheck -Id 'PKG-3' -Description 'package main entry exists' -Pass $mainOk -Detail $mainRel
    Add-QaCheck -Id 'PKG-4' -Description 'package declares dsh.client.platform=web and ./client export' -Pass ([bool]($clientPlatform -eq 'web' -and $clientRel)) `
        -Detail ("platform={0}; client={1}" -f $clientPlatform, $clientRel)
    Add-QaCheck -Id 'PKG-5' -Description '@deepseek-ai/dsh-home-paths is a peerDependency (Gate 0 linked-plugin requirement)' -Pass $peerHomePaths `
        -Detail (($manifest.peerDependencies | ConvertTo-Json -Compress))
    if ($clientBuilt) {
        Add-QaCheck -Id 'PKG-6' -Description 'client bundle lib/client.js is built' -Pass $true `
            -Detail ("{0} bytes; sha256={1}" -f $clientBuild.bytes, $clientBuild.sha256)
    } else {
        Add-QaCheck -Id 'PKG-6' -Description 'client bundle lib/client.js is built' -Pass (-not $RequireClientBuild) `
            -Detail ("missing: {0}; run `pnpm build` when devDependencies are installed (E2E is BLOCKED until then)" -f $clientBuild.path)
        if ($RequireClientBuild) { throw "client bundle missing at $($clientBuild.path); install devDependencies and run `pnpm build` first" }
    }

    # -- 4. create the isolated profile -------------------------------------
    $profileDir = Get-QaProfileDir
    if ($SkipRecreate -and (Test-Path -LiteralPath (Join-Path $profileDir 'package.json') -PathType Leaf)) {
        Add-QaCheck -Id 'PROFILE-1' -Description 'isolated profile exists (recreate skipped on request)' -Pass $true -Detail $profileDir
    } else {
        $dumpOut = Join-Path $logs "setup-dump-config-$timestamp.out.log"
        $dumpErr = Join-Path $logs "setup-dump-config-$timestamp.err.log"
        Write-QaLogLine -Message 'creating isolated profile from shipped web template (--dump-config)...' -LogFile $setupLog
        $dump = Invoke-QaDsh -Arguments @('--profile', $script:QaAllowedProfile, '--from-default-profile', 'web', '--dump-config') `
            -OutLog $dumpOut -ErrLog $dumpErr -TimeoutSec 240
        $state.commands += [pscustomobject]@{ command = "dsh(iso) --profile $($script:QaAllowedProfile) --from-default-profile web --dump-config"; exitCode = $dump.exitCode; outLog = $dumpOut; errLog = $dumpErr }
        $errTail = if (Test-Path -LiteralPath $dumpErr) { ((Get-Content -LiteralPath $dumpErr -Tail 10) -join ' | ') } else { '' }
        Add-QaCheck -Id 'PROFILE-1' -Description 'isolated profile created from the shipped web template' -Pass ($dump.exitCode -eq 0) `
            -Detail ("exit={0}; err={1}" -f $dump.exitCode, $errTail)
        if ($dump.exitCode -ne 0) { throw "isolated profile creation failed (see $dumpErr)" }
    }

    $profilePackage = Read-QaProfilePackage
    $state.profilePackage = $profilePackage
    $profileOk = ($null -ne $profilePackage) -and (Test-Path -LiteralPath $profileDir -PathType Container) -and
        ([System.IO.Path]::GetFullPath($profileDir).StartsWith([System.IO.Path]::GetFullPath((Get-QaHome)), [System.StringComparison]::OrdinalIgnoreCase))
    Add-QaCheck -Id 'PROFILE-2' -Description 'isolated profile package.json readable and inside .spike-homes/qa' -Pass $profileOk -Detail $profileDir
    if (-not $profileOk) { throw "profile package.json missing under $profileDir" }

    # -- 5. install the V1 package into the isolated profile ----------------
    if (-not $SkipInstall) {
        # Stage the publishable files under the isolated home. `link:<repoRoot>` is
        # forbidden: it creates a junction back into the repo, pnpm recurses into
        # .spike-homes, and Remove-Item -Recurse on teardown can follow it into .git.
        $stagingRoot = Join-Path (Get-QaHome) 'staging\dsh-session-groups'
        $stagingFull = [System.IO.Path]::GetFullPath($stagingRoot)
        $homeFull = [System.IO.Path]::GetFullPath((Get-QaHome))
        $stagingSafe = $stagingFull.StartsWith($homeFull + [System.IO.Path]::DirectorySeparatorChar, [System.StringComparison]::OrdinalIgnoreCase)
        Add-QaCheck -Id 'PLUGIN-0' -Description 'install staging dir is inside the isolated QA home (never the repo root)' `
            -Pass $stagingSafe -Detail $stagingFull
        if (-not $stagingSafe) { throw "unsafe staging dir: $stagingFull" }
        if (Test-Path -LiteralPath $stagingRoot) { Remove-Item -LiteralPath $stagingRoot -Recurse -Force }
        New-Item -ItemType Directory -Force -Path $stagingRoot | Out-Null
        foreach ($rel in @('src', 'lib', 'locale')) {
            Copy-Item -LiteralPath (Join-Path $repoRoot $rel) -Destination $stagingRoot -Recurse -Force
        }
        foreach ($file in @('package.json', 'cordis.patch.yml', 'dsh.plugin.json', 'README.md')) {
            Copy-Item -LiteralPath (Join-Path $repoRoot $file) -Destination $stagingRoot -Force
        }
        $linkArg = 'link:' + $stagingRoot
        $installArgs = @('plugin', '--profile', $script:QaAllowedProfile, 'add', $linkArg)
        $installOut = Join-Path $logs "setup-plugin-add-$timestamp.out.log"
        $installErr = Join-Path $logs "setup-plugin-add-$timestamp.err.log"
        Write-QaLogLine -Message ("installing V1 package into isolated profile: dsh(iso) " + ($installArgs -join ' ')) -LogFile $setupLog
        $install = Invoke-QaDsh -Arguments $installArgs -OutLog $installOut -ErrLog $installErr -TimeoutSec 600
        $state.commands += [pscustomobject]@{ command = ('dsh(iso) ' + ($installArgs -join ' ')); exitCode = $install.exitCode; outLog = $installOut; errLog = $installErr }
        $errTail = if (Test-Path -LiteralPath $installErr) { ((Get-Content -LiteralPath $installErr -Tail 12) -join ' | ') } else { '' }
        Add-QaCheck -Id 'PLUGIN-1' -Description 'V1 package install command exited 0' -Pass ($install.exitCode -eq 0) `
            -Detail ("exit={0}; err={1}" -f $install.exitCode, $errTail)
        if ($install.exitCode -ne 0) { throw "dsh plugin add failed (see $installErr)" }

        $profilePackage = Read-QaProfilePackage
        $state.profilePackage = $profilePackage
        $deps = @()
        if ($profilePackage.dependencies) { $deps = @($profilePackage.dependencies.PSObject.Properties.Name) }
        $bundles = @()
        if ($profilePackage.dsh -and $profilePackage.dsh.profile -and $profilePackage.dsh.profile.bundles) { $bundles = @($profilePackage.dsh.profile.bundles) }
        $linkedPath = Join-Path $profileDir ('node_modules\' + $pkgName)
        $inDeps = $deps -contains $pkgName
        $inBundles = $bundles -contains $pkgName
        $linked = Test-Path -LiteralPath $linkedPath
        Add-QaCheck -Id 'PLUGIN-2' -Description "V1 package '$pkgName' is installed into profile dependencies + bundles + node_modules" `
            -Pass ($inDeps -and $inBundles -and $linked) -Detail ("dep={0}; bundles={1}; link={2}" -f $inDeps, $inBundles, $linked)
        if (-not ($inDeps -and $inBundles -and $linked)) { throw "V1 package not installed correctly (dep=$inDeps bundles=$inBundles link=$linked)" }
        Add-QaCheck -Id 'PLUGIN-3' -Description 'profile bundle stack contains the shipped web template + plugin' -Pass ($bundles -contains '@deepseek-ai/dsh-base' -and $bundles -contains '@deepseek-ai/dsh-web-app' -and $inBundles) `
            -Detail ("bundles=[{0}]" -f ($bundles -join ', '))
    } else {
        Add-QaCheck -Id 'PLUGIN-1' -Description 'V1 package install skipped on request (-SkipInstall)' -Pass $true
    }

    # -- 6. prove the real DSH home is untouched ---------------------------
    $realHomeAfter = Get-QaRealHomeState
    $state.realHomeAfter = $realHomeAfter
    $comparison = Test-QaRealHomeUnchanged -Before $realHomeBefore -After $realHomeAfter
    Add-QaCheck -Id 'SAFE-2' -Description 'real DSH home unchanged by setup (workspace.json / profiles / sessions tree)' -Pass $comparison.unchanged `
        -Detail (($comparison.problems + @('(no changes)'))[0])
    $state.result = if ($comparison.unchanged) { 'PASS' } else { 'FAIL' }
} catch {
    Write-Host ''
    Write-Host ("SETUP ERROR: {0}" -f $_.Exception.Message) -ForegroundColor Red
    $state.error = $_.Exception.Message
    $exitCode = 1
} finally {
    if ($exitCode -eq 0 -and -not (Write-QaSummary -Title 'setup (V1, isolated home)' -EvidencePath $evidencePath)) { $exitCode = 1 }
    if ($exitCode -ne 0) { $state.result = 'FAIL' }
    $state.checks = @(Get-QaChecks)
    try { Write-QaEvidenceJson -Path $evidencePath -Data $state | Out-Null } catch { }
}

if ($exitCode -eq 0 -and $StartWeb) {
    & (Join-Path $PSScriptRoot 'start-web.ps1') -Port $Port -Profile $script:QaAllowedProfile -QaHome (Get-QaHome) -TimeoutSec $StartTimeoutSec -EvidenceDir $evidence
    if ($LASTEXITCODE -ne 0) { $exitCode = $LASTEXITCODE }
}

Write-Host ''
if ($exitCode -eq 0) {
    Write-Host 'NEXT: pwsh -NoProfile -File scripts/qa/run-v1.ps1   (integration -> build -> start -> smoke -> E2E -> audit -> teardown)'
}
exit $exitCode

