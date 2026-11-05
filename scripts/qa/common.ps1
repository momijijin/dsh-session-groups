# scripts/spike/common.ps1
#
# Shared helpers for the Gate 0 QA harness of dsh-session-grove.
#
# SAFETY MODEL (Gate 0 architecture review M0 + docs/SPIKE.md §0-§2 + docs/TEST-PLAN.md §7):
#   * Every agent gets its own throw-away DSH_HOME under <repo>\.spike-homes\:
#       host: .spike-homes\host  port 4400
#       client: .spike-homes\client port 4401
#       QA: .spike-homes\qa     port 4402   <- this harness
#     The user's real DSH home (%USERPROFILE%\.dsh) is READ-ONLY except for copying
#     frozen fixtures out of it (workspace.json + sessions + session_projcache) - never written.
#   * Only the disposable profile "groups-spike" (inside .spike-homes\qa) is created,
#     installed into, booted and deleted.
#   * The real "desktop" and "web" profiles and the real workspace.json / session
#     logs are never written; setup/teardown/audit fingerprint them to prove it.
#   * Never touch port 43120 (the user's live Desktop web GUI).
#   * The PATH `dsh.cmd` shim hardcodes DSH_HOME=%USERPROFILE%\.dsh, so it MUST NOT
#     be used for isolation; we invoke the packaged runtime directly instead:
#       <Desktop.exe> --expose-internals <resources\app\lib\desktop-cli.js> ...
#     with ELECTRON_RUN_AS_NODE=1 and DSH_HOME=<repo>\.spike-homes\qa.
#
# Dot-source this file from the scripts in scripts/spike/:
#   . (Join-Path $PSScriptRoot 'common.ps1')

$script:QaRepoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
# Real DSH home - READ ONLY (source of frozen fixtures + fingerprint target).
$script:QaRealDshHome = if ([string]::IsNullOrWhiteSpace($env:DSH_HOME)) {
    Join-Path $env:USERPROFILE '.dsh'
} else {
    (Resolve-Path -LiteralPath $env:DSH_HOME -ErrorAction SilentlyContinue)?.Path ?? $env:DSH_HOME
}
# Disposable DSH home for QA - every write of this harness lands here (M0 allocation).
# NOTE: keep this assignment conditional. Scripts dot-source this file into their own
# scope; when invoked with -QaHome <path>, that parameter already lives in the script
# scope as $script:QaHome and must NOT be overwritten by this default.
$script:QaHomesRoot = Join-Path $script:QaRepoRoot '.spike-homes'
if ([string]::IsNullOrWhiteSpace($script:QaHome)) {
    $script:QaHome = Join-Path $script:QaHomesRoot 'qa'
}
if (-not $script:QaDefaultPort) { $script:QaDefaultPort = 4402 }
$script:QaAllowedProfile = 'groups-spike'
$script:QaReservedProfiles = @('desktop', 'web')
$script:QaReservedPorts = @(43120)
$script:QaGroupFileName = 'dsh-session-grove.json'
# 0.2.5 drag diagnostics append-only NDJSON (plugin-owned, expected to grow).
$script:QaDiagnosticsFileName = 'dsh-session-grove.diagnostics.ndjson'
$script:QaWorkspaceFileName = 'workspace.json'

# ---------------------------------------------------------------------------
# Paths and identity
# ---------------------------------------------------------------------------

function Get-QaRepoRoot { return $script:QaRepoRoot }
function Get-QaRealDshHome { return $script:QaRealDshHome }
function Get-QaHome { return $script:QaHome }
function Get-QaHomesRoot { return $script:QaHomesRoot }
function Get-QaDefaultPort { return $script:QaDefaultPort }
function Get-QaAllowedProfile { return $script:QaAllowedProfile }
function Get-QaStoragesDir { return (Join-Path (Get-QaHome) 'storages') }

function Set-QaHome {
    <# Point the harness at a disposable per-agent home under <repo>\.spike-homes\. #>
    param([Parameter(Mandatory)][string]$Path)
    $script:QaHome = [System.IO.Path]::GetFullPath($Path)
    Assert-QaHome
}

function Assert-QaHome {
    <# The disposable home must live inside the repository under .spike-homes\<agent>
       (or the legacy single .spike-home* form), so a recursive teardown can never
       touch the real DSH home. #>
    $spikeHomePath = [System.IO.Path]::GetFullPath((Get-QaHome))
    $repo = [System.IO.Path]::GetFullPath((Get-QaRepoRoot))
    $relative = $spikeHomePath.Substring($repo.Length).TrimStart('\', '/')
    $insideRepo = $spikeHomePath.StartsWith($repo + [System.IO.Path]::DirectorySeparatorChar, [System.StringComparison]::OrdinalIgnoreCase)
    $namedForQa = ($relative -match '^\.spike-homes[\\/][^\\/]+$') -or ((Split-Path -Leaf $spikeHomePath) -like '.spike-home*')
    if (-not $insideRepo -or -not $namedForQa) {
        throw "refusing spike home '$spikeHomePath': it must be <repo>\.spike-homes\<agent> (or legacy .spike-home*; real DSH home is $($script:QaRealDshHome))."
    }
    $real = [System.IO.Path]::GetFullPath((Get-QaRealDshHome))
    if ($spikeHomePath.TrimEnd('\') -ieq $real.TrimEnd('\')) {
        throw "refusing spike home '$spikeHomePath': it equals the real DSH home (M0 requires a throw-away DSH_HOME)."
    }
}

function Get-QaEvidenceDir {
    param([string]$EvidenceDir)
    if ([string]::IsNullOrWhiteSpace($EvidenceDir)) {
        $EvidenceDir = Join-Path $script:QaRepoRoot 'scripts\qa\evidence'
    }
    if (-not (Test-Path -LiteralPath $EvidenceDir)) {
        New-Item -ItemType Directory -Force -Path $EvidenceDir | Out-Null
    }
    return (Resolve-Path -LiteralPath $EvidenceDir).Path
}

function Get-QaTimestamp { return (Get-Date).ToString('yyyyMMdd-HHmmss') }

function Get-QaUtcNowIso { return (Get-Date).ToUniversalTime().ToString('o') }

function Get-QaDshExe {
    $cmd = Get-Command dsh -ErrorAction SilentlyContinue
    if (-not $cmd) {
        throw "dsh CLI not found on PATH. Boot the DSH Desktop app once, then re-run (the Desktop installs the dsh host command)."
    }
    return $cmd.Source
}

function Get-QaDesktopRuntime {
    <# Resolve the packaged Desktop runtime used to launch an isolated dsh.
       Preferred: parse the generated dsh.cmd shim for the Electron binary + desktop-cli.js
       paths (stable across installs). Falls back to the standard install location. #>
    $shim = $null
    try {
        $cmd = Get-Command dsh -ErrorAction SilentlyContinue
        if ($cmd -and $cmd.Source -like '*.cmd') {
            $shim = Get-Content -LiteralPath $cmd.Source -Raw -ErrorAction Stop
        }
    } catch { }
    if ($shim) {
        $exeMatch = [regex]::Match($shim, '"([^"]*?DSH Desktop\.exe)"', 'IgnoreCase')
        $cliMatch = [regex]::Match($shim, '"([^"]*?desktop-cli\.js)"', 'IgnoreCase')
        if ($exeMatch.Success -and $cliMatch.Success) {
            $exe = $exeMatch.Groups[1].Value
            $cli = $cliMatch.Groups[1].Value
            if ((Test-Path -LiteralPath $exe -PathType Leaf) -and (Test-Path -LiteralPath $cli -PathType Leaf)) {
                return [pscustomobject]@{ desktopExe = $exe; desktopCli = $cli; source = 'dsh.cmd shim' }
            }
        }
    }
    $candidates = @(
        (Join-Path $env:LOCALAPPDATA 'Programs\DSH Desktop\DSH Desktop.exe'),
        'C:\Program Files\DSH Desktop\DSH Desktop.exe'
    )
    foreach ($exe in $candidates) {
        if (Test-Path -LiteralPath $exe -PathType Leaf) {
            $cli = Join-Path (Split-Path -Parent $exe) 'resources\app\lib\desktop-cli.js'
            if (Test-Path -LiteralPath $cli -PathType Leaf) {
                return [pscustomobject]@{ desktopExe = $exe; desktopCli = $cli; source = 'standard install path' }
            }
        }
    }
    throw "could not locate the DSH Desktop packaged runtime (DSH Desktop.exe + desktop-cli.js); set DSH_HOME isolation requires the direct runtime (the dsh.cmd shim pins the real home)."
}

function Get-QaRuntimeEnvironment {
    <# Environment for a dsh child process: isolated DSH_HOME + no inherited profile identity. #>
    param([string]$DshHome)
    if ([string]::IsNullOrWhiteSpace($DshHome)) { $DshHome = Get-QaHome }
    return @{
        ELECTRON_RUN_AS_NODE         = '1'
        DSH_HOME                     = $DshHome
        DSH_PROFILE                  = $null
        DSH_PROFILE_DIR              = $null
        DSH_SESSION_ID               = $null
        DSH_WEB_URL                  = $null
        DSH_SHELL                    = $null
        DSH_DESKTOP_DEFAULT_PROFILE  = $null
    }
}

function ConvertTo-QaArgLine {
    <# Quote one argv array for Start-Process (it does not quote array elements itself). #>
    param([string[]]$Arguments)
    $parts = foreach ($argument in @($Arguments)) {
        $text = [string]$argument
        if ($text -match '[\s"]') {
            '"' + ($text -replace '(\\*)"', '$1$1\"') + '"'
        } else {
            $text
        }
    }
    return ($parts -join ' ')
}

function Get-QaProfileDir {
    param([string]$Profile = $script:QaAllowedProfile)
    Assert-QaProfile -Profile $Profile
    return (Join-Path (Join-Path (Get-QaHome) 'profiles') $Profile)
}

function Assert-QaProfile {
    param([Parameter(Mandatory)][string]$Profile)
    if ($Profile -in $script:QaReservedProfiles) {
        throw "Refusing to touch reserved profile '$Profile'. The Gate 0 QA harness only operates on '$($script:QaAllowedProfile)'."
    }
    if ($Profile -ne $script:QaAllowedProfile) {
        throw "Refusing profile '$Profile'. The Gate 0 QA harness only operates on '$($script:QaAllowedProfile)' (docs/SPIKE.md §0)."
    }
}

function Assert-QaPort {
    param([Parameter(Mandatory)][int]$Port)
    if ($Port -in $script:QaReservedPorts) {
        throw "Refusing port ${Port}: it belongs to the user's live DSH Desktop web GUI. Use the QA spike port (default 4402; host=4400, client=4401)."
    }
    if ($Port -lt 1024 -or $Port -gt 65535) {
        throw "Refusing port ${Port}: out of the safe range for this harness."
    }
}

# ---------------------------------------------------------------------------
# Hashing / manifests
# ---------------------------------------------------------------------------

function Get-Sha256Text {
    param([Parameter(Mandatory)][AllowEmptyString()][string]$Text)
    $sha = [System.Security.Cryptography.SHA256]::Create()
    try {
        $bytes = [System.Text.Encoding]::UTF8.GetBytes($Text)
        return [Convert]::ToHexString($sha.ComputeHash($bytes)).ToLowerInvariant()
    } finally {
        $sha.Dispose()
    }
}

function Get-QaFileSha256 {
    param([Parameter(Mandatory)][string]$Path)
    if (Test-Path -LiteralPath $Path -PathType Leaf) {
        return (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
    }
    return $null
}

function Get-QaFileStamp {
    param([Parameter(Mandatory)][string]$Path)
    if (Test-Path -LiteralPath $Path -PathType Leaf) {
        $item = Get-Item -LiteralPath $Path
        return [pscustomobject]@{
            path      = $Path
            exists    = $true
            sha256    = (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
            length    = $item.Length
            mtimeUtc  = $item.LastWriteTimeUtc.ToString('o')
        }
    }
    return [pscustomobject]@{ path = $Path; exists = $false; sha256 = $null; length = $null; mtimeUtc = $null }
}

function Get-QaDirManifest {
    param([Parameter(Mandatory)][string]$Path)
    if (-not (Test-Path -LiteralPath $Path -PathType Container)) { return @() }
    $root = (Resolve-Path -LiteralPath $Path).Path
    $files = @(Get-ChildItem -LiteralPath $root -Recurse -File -Force | Sort-Object FullName)
    $manifest = foreach ($file in $files) {
        $rel = $file.FullName.Substring($root.Length).TrimStart('\', '/')
        [pscustomobject]@{
            path     = $rel
            sha256   = (Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
            length   = $file.Length
            mtimeUtc = $file.LastWriteTimeUtc.ToString('o')
        }
    }
    return @($manifest)
}

function Get-QaManifestHash {
    param([object[]]$Manifest)
    $lines = @()
    foreach ($entry in @($Manifest)) {
        $lines += "$($entry.path)|$($entry.sha256)|$($entry.length)"
    }
    $lines = @($lines | Sort-Object)
    return Get-Sha256Text -Text ($lines -join "`n")
}

function Get-QaProp {
    <# Read a property from either a hashtable/ordered dictionary or a PSCustomObject
       (e.g. an object re-loaded from a JSON evidence file). #>
    param($Object, [Parameter(Mandatory)][string]$Name)
    if ($null -eq $Object) { return $null }
    if ($Object -is [System.Collections.IDictionary]) { return $Object[$Name] }
    $property = $Object.PSObject.Properties[$Name]
    if ($property) { return $property.Value }
    return $null
}

function Set-QaProp {
    <# Write a property on either a hashtable/ordered dictionary or a PSCustomObject. #>
    param($Object, [Parameter(Mandatory)][string]$Name, $Value)
    if ($null -eq $Object) { return }
    if ($Object -is [System.Collections.IDictionary]) {
        $Object[$Name] = $Value
    } else {
        $Object | Add-Member -NotePropertyName $Name -NotePropertyValue $Value -Force
    }
}

function Get-QaFingerprintCanonical {
    <# Canonical, order-independent string hash of a profile fingerprint. Works for
       both a live fingerprint object and one re-loaded from JSON evidence. #>
    param($Fingerprint)
    if ($null -eq $Fingerprint) { return $null }
    $exists = [bool](Get-QaProp -Object $Fingerprint -Name 'exists')
    $lines = @("exists|$exists")
    foreach ($name in @(Get-QaProp -Object $Fingerprint -Name 'topLevel' | ForEach-Object { [string]$_ } | Sort-Object)) {
        $lines += "top|$name"
    }
    $files = Get-QaProp -Object $Fingerprint -Name 'files'
    foreach ($name in @('package.json', 'cordis.patch.yml', 'cordis.yml', 'pnpm-workspace.yaml', 'pnpm-lock.yaml')) {
        $hash = Get-QaProp -Object $files -Name $name
        $lines += "file|$name|$hash"
    }
    return Get-Sha256Text -Text ($lines -join "`n")
}

function Get-QaProfileFingerprint {
    param(
        [Parameter(Mandatory)][string]$ProfileName,
        [string]$DshHome
    )
    if ([string]::IsNullOrWhiteSpace($DshHome)) { $DshHome = $script:QaRealDshHome }
    $dir = Join-Path (Join-Path $DshHome 'profiles') $ProfileName
    if (-not (Test-Path -LiteralPath $dir -PathType Container)) {
        $missing = [pscustomobject]@{ profile = $ProfileName; dir = $dir; exists = $false; topLevel = @(); files = @{} }
        $missing | Add-Member -NotePropertyName canonicalHash -NotePropertyValue (Get-QaFingerprintCanonical -Fingerprint $missing)
        return $missing
    }
    $topLevel = @(Get-ChildItem -LiteralPath $dir -Force | ForEach-Object { $_.Name } | Sort-Object)
    $files = @{}
    foreach ($name in @('package.json', 'cordis.patch.yml', 'cordis.yml', 'pnpm-workspace.yaml', 'pnpm-lock.yaml')) {
        $files[$name] = Get-QaFileSha256 -Path (Join-Path $dir $name)
    }
    $fingerprint = [pscustomobject]@{
        profile  = $ProfileName
        dir      = $dir
        exists   = $true
        topLevel = $topLevel
        files    = $files
    }
    $fingerprint | Add-Member -NotePropertyName canonicalHash -NotePropertyValue (Get-QaFingerprintCanonical -Fingerprint $fingerprint)
    return $fingerprint
}

# ---------------------------------------------------------------------------
# Evidence / JSON
# ---------------------------------------------------------------------------

function Write-QaEvidenceJson {
    param(
        [Parameter(Mandatory)][string]$Path,
        [Parameter(Mandatory)][object]$Data
    )
    $parent = Split-Path -Parent $Path
    if ($parent -and -not (Test-Path -LiteralPath $parent)) {
        New-Item -ItemType Directory -Force -Path $parent | Out-Null
    }
    $json = $Data | ConvertTo-Json -Depth 60
    [System.IO.File]::WriteAllText($Path, $json, [System.Text.UTF8Encoding]::new($false))
    return $Path
}

function Write-QaLogLine {
    param(
        [Parameter(Mandatory)][string]$Message,
        [string]$LogFile
    )
    $line = ('[{0}] {1}' -f (Get-Date).ToString('HH:mm:ss'), $Message)
    Write-Host $line
    if ($LogFile) {
        Add-Content -LiteralPath $LogFile -Value $line -Encoding utf8
    }
}

function Get-QaLatestFile {
    param(
        [Parameter(Mandatory)][string]$Directory,
        [Parameter(Mandatory)][string]$Filter
    )
    if (-not (Test-Path -LiteralPath $Directory)) { return $null }
    $file = Get-ChildItem -LiteralPath $Directory -Filter $Filter -File -ErrorAction SilentlyContinue |
        Sort-Object LastWriteTime -Descending | Select-Object -First 1
    if ($file) { return $file.FullName }
    return $null
}

# ---------------------------------------------------------------------------
# Process / port / HTTP helpers
# ---------------------------------------------------------------------------

function Get-QaPortOwnerPid {
    param([Parameter(Mandatory)][int]$Port)
    $conn = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue |
        Select-Object -First 1
    if ($conn) { return [int]$conn.OwningProcess }
    return $null
}

function Get-QaProcessCommandLine {
    param([Parameter(Mandatory)][int]$ProcessId)
    try {
        $proc = Get-CimInstance Win32_Process -Filter "ProcessId = $ProcessId" -ErrorAction Stop
        if ($proc) { return [string]$proc.CommandLine }
    } catch { }
    return $null
}

function Stop-QaProcessTree {
    param(
        [Parameter(Mandatory)][int]$ProcessId,
        [int]$WaitMs = 8000
    )
    if (-not (Get-Process -Id $ProcessId -ErrorAction SilentlyContinue)) { return $true }
    & taskkill.exe /PID $ProcessId /T /F 2>&1 | Out-Null
    $deadline = (Get-Date).AddMilliseconds($WaitMs)
    while ((Get-Date) -lt $deadline) {
        if (-not (Get-Process -Id $ProcessId -ErrorAction SilentlyContinue)) { return $true }
        Start-Sleep -Milliseconds 200
    }
    return (-not (Get-Process -Id $ProcessId -ErrorAction SilentlyContinue))
}

function Wait-QaHttp {
    param(
        [Parameter(Mandatory)][string]$Url,
        [int]$TimeoutSec = 60,
        [int]$IntervalMs = 400,
        [scriptblock]$Accept
    )
    $deadline = (Get-Date).AddSeconds($TimeoutSec)
    $lastError = $null
    while ((Get-Date) -lt $deadline) {
        try {
            $response = Invoke-WebRequest -Uri $Url -UseBasicParsing -SkipHttpErrorCheck `
                -MaximumRedirection 5 -TimeoutSec 10
            if ($null -eq $Accept -or (& $Accept $response)) { return $response }
        } catch {
            $lastError = $_.Exception.Message
        }
        Start-Sleep -Milliseconds $IntervalMs
    }
    Write-Verbose ("Wait-QaHttp timed out for {0}: {1}" -f $Url, $lastError)
    return $null
}

function Get-QaWebTokenInfoFromLog {
    param(
        [Parameter(Mandatory)][string]$OutLog,
        [int]$TimeoutSec = 120
    )
    $deadline = (Get-Date).AddSeconds($TimeoutSec)
    $pattern = 'dsh web:\s+(http://\S+)'
    while ((Get-Date) -lt $deadline) {
        if (Test-Path -LiteralPath $OutLog -PathType Leaf) {
            $match = Select-String -LiteralPath $OutLog -Pattern $pattern -ErrorAction SilentlyContinue |
                Select-Object -First 1
            if ($match) {
                $url = $match.Matches[0].Groups[1].Value.Trim()
                $uri = [Uri]$url
                $token = $null
                $tokenMatch = [regex]::Match($url, '[?&]token=([^&\s]+)')
                if ($tokenMatch.Success) { $token = $tokenMatch.Groups[1].Value }
                return [pscustomobject]@{
                    url     = $url
                    baseUrl = ('{0}://{1}/' -f $uri.Scheme, $uri.Authority)
                    authority = $uri.Authority
                    token   = $token
                }
            }
        }
        Start-Sleep -Milliseconds 250
    }
    return $null
}

function Get-QaWebState {
    param([string]$EvidenceDir)
    $evidence = Get-QaEvidenceDir -EvidenceDir $EvidenceDir
    $path = Join-Path $evidence 'web.json'
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { return $null }
    try {
        return (Get-Content -LiteralPath $path -Raw | ConvertFrom-Json)
    } catch {
        return $null
    }
}

# ---------------------------------------------------------------------------
# dsh CLI wrappers
# ---------------------------------------------------------------------------

function Invoke-QaDsh {
    <# Run the packaged dsh CLI against the disposable DSH home.
       The PATH dsh.cmd shim is NOT used (it pins DSH_HOME to the real home). #>
    param(
        [Parameter(Mandatory)][string[]]$Arguments,
        [Parameter(Mandatory)][string]$OutLog,
        [Parameter(Mandatory)][string]$ErrLog,
        [int]$TimeoutSec = 180,
        [string]$DshHome
    )
    if ([string]::IsNullOrWhiteSpace($DshHome)) { $DshHome = Get-QaHome }
    foreach ($log in @($OutLog, $ErrLog)) {
        $parent = Split-Path -Parent $log
        if ($parent -and -not (Test-Path -LiteralPath $parent)) {
            New-Item -ItemType Directory -Force -Path $parent | Out-Null
        }
    }
    $runtime = Get-QaDesktopRuntime
    $argLine = '--expose-internals "{0}" {1}' -f $runtime.desktopCli, (ConvertTo-QaArgLine -Arguments $Arguments)
    $process = Start-Process -FilePath $runtime.desktopExe -ArgumentList $argLine `
        -Environment (Get-QaRuntimeEnvironment -DshHome $DshHome) `
        -RedirectStandardOutput $OutLog -RedirectStandardError $ErrLog `
        -PassThru -WindowStyle Hidden
    $timedOut = -not $process.WaitForExit($TimeoutSec * 1000)
    if ($timedOut) {
        Stop-QaProcessTree -ProcessId $process.Id | Out-Null
        throw ("dsh {0} timed out after {1}s (logs: {2} / {3})" -f ($Arguments -join ' '), $TimeoutSec, $OutLog, $ErrLog)
    }
    # Flush redirected streams (documented .NET behaviour after WaitForExit(ms)).
    $process.WaitForExit()
    return [pscustomobject]@{
        exitCode  = $process.ExitCode
        outLog    = $OutLog
        errLog    = $ErrLog
        arguments = $Arguments
        dshHome   = $DshHome
        runtime   = $runtime.desktopExe
    }
}

function Read-QaProfilePackage {
    param([string]$Profile = $script:QaAllowedProfile)
    $profileDir = Get-QaProfileDir -Profile $Profile
    $manifestPath = Join-Path $profileDir 'package.json'
    if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) { return $null }
    try {
        return (Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json)
    } catch {
        return $null
    }
}

# ---------------------------------------------------------------------------
# Real-home read-only snapshot + frozen fixtures for the disposable home
# ---------------------------------------------------------------------------

function Get-QaRealHomeState {
    <# READ-ONLY snapshot of the user's real DSH home. The harness fingerprints this
       before/after setup and teardown to prove nothing outside .spike-home changed. #>
    $realHomePath = Get-QaRealDshHome
    $state = [ordered]@{
        kind          = 'real-dsh-home-state'
        createdAt     = Get-QaUtcNowIso
        dshHome       = $realHomePath
        workspaceJson = (Get-QaFileStamp -Path (Join-Path $realHomePath 'storages\workspace.json'))
        profiles      = [ordered]@{}
        sessions      = [ordered]@{}
    }
    foreach ($name in @($script:QaReservedProfiles + @($script:QaAllowedProfile))) {
        $state.profiles[$name] = Get-QaProfileFingerprint -ProfileName $name -DshHome $realHomePath
    }
    $sessionsRoot = Join-Path $realHomePath 'sessions'
    if (Test-Path -LiteralPath $sessionsRoot -PathType Container) {
        $workspaceDirs = @(Get-ChildItem -LiteralPath $sessionsRoot -Directory -Force | Sort-Object Name)
        $sessionDirs = 0
        $sessionFiles = 0
        foreach ($workspaceDir in $workspaceDirs) {
            $children = @(Get-ChildItem -LiteralPath $workspaceDir.FullName -Directory -Force)
            $sessionDirs += $children.Count
            foreach ($child in $children) {
                $sessionFiles += @(Get-ChildItem -LiteralPath $child.FullName -Recurse -File -Force -ErrorAction SilentlyContinue).Count
            }
        }
        $state.sessions = [ordered]@{
            exists         = $true
            workspaceDirs  = @($workspaceDirs | ForEach-Object { $_.Name })
            sessionDirs    = $sessionDirs
            sessionFiles   = $sessionFiles
        }
    } else {
        $state.sessions = [ordered]@{ exists = $false }
    }
    return $state
}

function Test-QaRealHomeUnchanged {
    param(
        [Parameter(Mandatory)][object]$Before,
        [Parameter(Mandatory)][object]$After
    )
    $problems = @()
    $beforeWorkspace = Get-QaProp -Object $Before -Name 'workspaceJson'
    $afterWorkspace = Get-QaProp -Object $After -Name 'workspaceJson'
    if ((Get-QaProp -Object $beforeWorkspace -Name 'sha256') -ne (Get-QaProp -Object $afterWorkspace -Name 'sha256')) {
        $problems += 'real workspace.json changed'
    }
    $beforeProfiles = Get-QaProp -Object $Before -Name 'profiles'
    $afterProfiles = Get-QaProp -Object $After -Name 'profiles'
    foreach ($name in @($script:QaReservedProfiles + @($script:QaAllowedProfile))) {
        $b = Get-QaFingerprintCanonical -Fingerprint (Get-QaProp -Object $beforeProfiles -Name $name)
        $a = Get-QaFingerprintCanonical -Fingerprint (Get-QaProp -Object $afterProfiles -Name $name)
        if ($b -ne $a) { $problems += "real profile '$name' changed" }
    }
    $beforeSessions = Get-QaProp -Object $Before -Name 'sessions'
    $afterSessions = Get-QaProp -Object $After -Name 'sessions'
    $bDirs = @(Get-QaProp -Object $beforeSessions -Name 'workspaceDirs' | ForEach-Object { [string]$_ } | Sort-Object)
    $aDirs = @(Get-QaProp -Object $afterSessions -Name 'workspaceDirs' | ForEach-Object { [string]$_ } | Sort-Object)
    if (($bDirs -join '|') -ne ($aDirs -join '|')) { $problems += 'real sessions workspace dirs changed' }
    return [pscustomobject]@{ unchanged = ($problems.Count -eq 0); problems = @($problems) }
}

function Copy-QaHomeFixtures {
    <# Seed the throw-away home with FROZEN COPIES of the real data used by Gate 0
       (docs/SPIKE.md §0): sessions/**, storages/workspace.json and
       storages/session_projcache/** (if present). The real home is only read.
       The copies make S1/S2 (3 workspaces / ~25 sessions / archived) meaningful
       and give the data audit stable session samples. #>
    param(
        [switch]$SkipWorkspaceJson,
        [switch]$SkipSessions
    )
    $real = Get-QaRealDshHome
    $spikeHomePath = Get-QaHome
    Assert-QaHome
    $storages = Join-Path $spikeHomePath 'storages'
    $sessionsDest = Join-Path $spikeHomePath 'sessions'
    if (-not (Test-Path -LiteralPath $storages)) { New-Item -ItemType Directory -Force -Path $storages | Out-Null }
    $result = [ordered]@{
        sourceHome      = $real
        workspaceJson   = $false
        workspaceSha256 = $null
        sessionDirs     = 0
        sessionFiles    = 0
        sessionBytes    = 0
        sessionProjCache = $false
        skipped         = @()
    }

    if (-not $SkipWorkspaceJson) {
        $sourceWorkspace = Join-Path $real 'storages\workspace.json'
        if (Test-Path -LiteralPath $sourceWorkspace -PathType Leaf) {
            $destination = Join-Path $storages 'workspace.json'
            Copy-Item -LiteralPath $sourceWorkspace -Destination $destination -Force
            $result.workspaceJson = $true
            $result.workspaceSha256 = Get-QaFileSha256 -Path $destination
        } else {
            $result.skipped += 'real workspace.json missing'
        }
    } else {
        $result.skipped += 'workspace.json (-SkipWorkspaceJson)'
    }

    if (-not $SkipSessions) {
        $sourceSessions = Join-Path $real 'sessions'
        if (Test-Path -LiteralPath $sourceSessions -PathType Container) {
            # Replace any previous fixture copy wholesale: Copy-Item into an existing
            # directory would nest the source under the destination and corrupt the layout.
            if (Test-Path -LiteralPath $sessionsDest) { Remove-Item -LiteralPath $sessionsDest -Recurse -Force }
            Copy-Item -LiteralPath $sourceSessions -Destination $sessionsDest -Recurse -Force
            $dirs = @(Get-ChildItem -LiteralPath $sessionsDest -Directory -Force -ErrorAction SilentlyContinue)
            $files = @(Get-ChildItem -LiteralPath $sessionsDest -Recurse -File -Force -ErrorAction SilentlyContinue)
            $result.sessionDirs = $dirs.Count
            $result.sessionFiles = $files.Count
            $result.sessionBytes = [long](($files | Measure-Object -Property Length -Sum).Sum)
        } else {
            $result.skipped += 'real sessions directory missing'
        }
    } else {
        $result.skipped += 'sessions (-SkipSessions)'
    }

    # session_projcache: optional read-only copy (docs/SPIKE.md §0).
    $sourceProjCache = Join-Path $real 'storages\session_projcache'
    if (Test-Path -LiteralPath $sourceProjCache -PathType Container) {
        $destinationProjCache = Join-Path $storages 'session_projcache'
        if (Test-Path -LiteralPath $destinationProjCache) { Remove-Item -LiteralPath $destinationProjCache -Recurse -Force }
        Copy-Item -LiteralPath $sourceProjCache -Destination $destinationProjCache -Recurse -Force
        $result.sessionProjCache = $true
    } else {
        $result.skipped += 'real session_projcache missing (optional)'
    }

    # Freeze the documented multi-workspace session shape. The real home mostly
    # contains subagent sessions (filtered out by the UI); additionally synthesise
    # a bounded number of ROOT session copies per workspace inside the disposable
    # home so S2/E2E can exercise "cross-workspace drag 10 sessions". The real
    # workspace.json / session dirs are never modified.
    if (-not $SkipWorkspaceJson -and -not $SkipSessions) {
        $augment = Add-QaFixtureRootSessions -WorkspaceJsonPath (Join-Path $storages 'workspace.json') -SessionsRoot $sessionsDest -ExtraPerWorkspace 10
        $result.syntheticRootSessions = $augment.added
        $result.registryWorkspaces = @($augment.workspaces)
        $result.syntheticTemplate = $augment.template
        $result.workspaceSha256 = Get-QaFileSha256 -Path (Join-Path $storages 'workspace.json')
    }
    return [pscustomobject]$result
}

function ConvertTo-QaWorkspaceDirName {
    <# Encode a workspace path the way DSH names its sessions directory:
       C:\Users\X\Y  ->  --C-Users-X-Y-- #>
    param([Parameter(Mandatory)][string]$Path)
    $encoded = $Path.Trim()
    $encoded = $encoded -replace '^([A-Za-z]):', '$1'
    $encoded = $encoded -replace '[\\/]', '-'
    return "--$encoded--"
}

function Add-QaFixtureRootSessions {
    <# Register frozen fixture sessions plus a bounded number of valid synthetic ROOT
       session copies per workspace, so the UI exposes the documented multi-workspace
       session shape (the real home is dominated by filtered subagent sessions).
       The clone/rewrite work happens in make-fixtures.mjs (the host validates the
       session id inside the zstd v4 JSONL header, so a raw file copy would break the
       workspace list). Only the disposable home is written. #>
    param(
        [Parameter(Mandatory)][string]$WorkspaceJsonPath,
        [Parameter(Mandatory)][string]$SessionsRoot,
        [int]$ExtraPerWorkspace = 4
    )
    $out = [ordered]@{ added = 0; workspaces = @(); template = $null; templateId = $null; syntheticIds = @() }
    $nodeCommand = Get-Command node -ErrorAction SilentlyContinue
    if (-not $nodeCommand) { throw 'node is required to synthesise fixture sessions' }
    $scriptPath = Join-Path $PSScriptRoot 'make-fixtures.mjs'
    if (-not (Test-Path -LiteralPath $scriptPath -PathType Leaf)) { throw "missing fixture generator: $scriptPath" }
    $lines = & $nodeCommand.Source $scriptPath --workspace-json $WorkspaceJsonPath --sessions-root $SessionsRoot --extra-per-workspace $ExtraPerWorkspace 2>&1
    if ($LASTEXITCODE -ne 0) { throw "make-fixtures.mjs failed (exit $LASTEXITCODE): $($lines -join ' ')" }
    $jsonLine = @($lines | ForEach-Object { [string]$_ } | Where-Object { $_.TrimStart().StartsWith('{') } | Select-Object -Last 1)
    if (-not $jsonLine) { throw 'make-fixtures.mjs produced no JSON result' }
    $parsed = $jsonLine | ConvertFrom-Json
    $out.added = [int]$parsed.added
    $out.workspaces = @($parsed.registryWorkspaces)
    $out.template = $parsed.template
    $out.templateId = $parsed.templateId
    $out.syntheticIds = @($parsed.syntheticIds)
    return [pscustomobject]$out
}
# ---------------------------------------------------------------------------
# Summary / exit helpers
# ---------------------------------------------------------------------------

$script:QaCheckResults = @()

function Add-QaCheck {
    param(
        [Parameter(Mandatory)][string]$Id,
        [Parameter(Mandatory)][string]$Description,
        [Parameter(Mandatory)][bool]$Pass,
        [string]$Detail
    )
    $script:QaCheckResults += [pscustomobject]@{
        id          = $Id
        description = $Description
        pass        = $Pass
        detail      = $Detail
    }
    $marker = if ($Pass) { 'PASS' } else { 'FAIL' }
    Write-Host ("  [{0}] {1} - {2}" -f $marker, $Id, $Description)
    if ($Detail) { Write-Host ("         {0}" -f $Detail) }
}

function Get-QaChecks { return @($script:QaCheckResults) }
function Reset-QaChecks { $script:QaCheckResults = @() }
function Get-QaCheckCount { return @($script:QaCheckResults).Count }
function Remove-QaChecks {
    param([Parameter(Mandatory)][int]$Keep)
    $script:QaCheckResults = @(@($script:QaCheckResults) | Select-Object -First $Keep)
}

function Write-QaSummary {
    param(
        [Parameter(Mandatory)][string]$Title,
        [string]$EvidencePath
    )
    $checks = @(Get-QaChecks)
    $failed = @($checks | Where-Object { -not $_.pass })
    Write-Host ''
    Write-Host ("=== {0}: {1} ===" -f $Title, ($(if ($failed.Count -eq 0) { 'PASS' } else { 'FAIL' })))
    Write-Host ("checks: {0} total, {1} passed, {2} failed" -f $checks.Count, ($checks.Count - $failed.Count), $failed.Count)
    foreach ($failure in $failed) {
        Write-Host ("  FAIL {0}: {1} {2}" -f $failure.id, $failure.description, $failure.detail)
    }
    if ($EvidencePath) { Write-Host ("evidence: {0}" -f $EvidencePath) }
    return ($failed.Count -eq 0)
}









