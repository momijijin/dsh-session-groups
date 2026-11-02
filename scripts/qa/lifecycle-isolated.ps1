<#
.SYNOPSIS
  Verify install -> uninstall -> reinstall in a disposable DSH profile.

.DESCRIPTION
  Never uses the real ~/.dsh or desktop profile. Creates a unique temp DSH_HOME,
  seeds a sentinel group record, installs the tarball, uninstalls it, reinstalls
  it, and verifies the sentinel record survives while the profile bundle changes.
  No files are deleted.
#>
param(
  [Parameter(Mandatory = $true)][string]$Tarball,
  [int]$Port = 4417,
  [string]$Profile = 'sg-life'
)

$ErrorActionPreference = 'Stop'

$desktop = Join-Path $env:LOCALAPPDATA 'Programs\DSH Desktop\DSH Desktop.exe'
$cli = Join-Path $env:LOCALAPPDATA 'Programs\DSH Desktop\resources\app\lib\desktop-cli.js'
if (-not (Test-Path -LiteralPath $desktop)) { throw "DSH Desktop not found: $desktop" }
if (-not (Test-Path -LiteralPath $cli)) { throw "desktop-cli.js not found: $cli" }
if (-not (Test-Path -LiteralPath $Tarball)) { throw "Tarball not found: $Tarball" }

$realHome = [System.IO.Path]::GetFullPath((Join-Path $env:USERPROFILE '.dsh'))
$testHome = [System.IO.Path]::GetFullPath((Join-Path $env:TEMP ("dsh-sg-life-" + (Get-Date -Format 'yyyyMMdd-HHmmss'))))
if ($testHome.Equals($realHome, [System.StringComparison]::OrdinalIgnoreCase) -or
    $testHome.StartsWith($realHome + [System.IO.Path]::DirectorySeparatorChar, [System.StringComparison]::OrdinalIgnoreCase)) {
  throw "Refusing to run under the real DSH home: $testHome"
}
New-Item -ItemType Directory -Force -Path $testHome | Out-Null

$envs = @{
  ELECTRON_RUN_AS_NODE = '1'
  DSH_HOME = $testHome
  DSH_PROFILE = $null
  DSH_PROFILE_DIR = $null
  DSH_SESSION_ID = $null
  DSH_WEB_URL = $null
  DSH_SHELL = $null
}

$storage = Join-Path $testHome 'storages'
New-Item -ItemType Directory -Force -Path $storage | Out-Null
$record = Join-Path $storage 'dsh-session-groups.json'
$sentinel = @{
  version = 1
  revision = 0
  groups = @(
    @{
      id = 'sentinel-group'
      name = 'Sentinel group'
      icon = 'star'
      color = 'blue'
      parentId = $null
      sessionIds = @()
    }
  )
  ungrouped = @()
} | ConvertTo-Json -Depth 8
Set-Content -LiteralPath $record -Value $sentinel -Encoding UTF8
$beforeHash = (Get-FileHash -LiteralPath $record -Algorithm SHA256).Hash

function Invoke-Plugin([string]$arguments) {
  $out = Join-Path $testHome ("plugin-" + [guid]::NewGuid().ToString('N') + '.out')
  $err = Join-Path $testHome ("plugin-" + [guid]::NewGuid().ToString('N') + '.err')
  $p = Start-Process -FilePath $desktop -ArgumentList "--expose-internals `"$cli`" plugin --profile $Profile $arguments" -Environment $envs -RedirectStandardOutput $out -RedirectStandardError $err -PassThru -WindowStyle Hidden
  $p.WaitForExit(180000) | Out-Null
  if ($p.ExitCode -ne 0) {
    Get-Content $err -Tail 20 -ErrorAction SilentlyContinue
    throw "plugin command failed: $arguments (exit $($p.ExitCode))"
  }
  Get-Content $out -Tail 5 -ErrorAction SilentlyContinue | Out-Host
}

function Read-ProfileManifest {
  $path = Join-Path $testHome "profiles\$Profile\package.json"
  if (-not (Test-Path -LiteralPath $path)) { throw "profile package missing: $path" }
  return Get-Content -LiteralPath $path -Raw | ConvertFrom-Json
}

$initOut = Join-Path $testHome 'init.out'
$initErr = Join-Path $testHome 'init.err'
$init = Start-Process -FilePath $desktop -ArgumentList "--expose-internals `"$cli`" --profile $Profile --from-default-profile web --port $Port --no-open" -Environment $envs -RedirectStandardOutput $initOut -RedirectStandardError $initErr -PassThru -WindowStyle Hidden
Start-Sleep -Seconds 8
Stop-Process -Id $init.Id -Force -ErrorAction SilentlyContinue

Invoke-Plugin "add --force `"file:$Tarball`""
$installed = Read-ProfileManifest
if (-not ($installed.dependencies.PSObject.Properties.Name -contains 'dsh-session-groups')) { throw 'install did not add the dependency' }
if (-not (@($installed.dsh.profile.bundles) -contains 'dsh-session-groups')) { throw 'install did not add the bundle' }

Invoke-Plugin 'remove dsh-session-groups'
$removed = Read-ProfileManifest
if ($removed.dependencies.PSObject.Properties.Name -contains 'dsh-session-groups') { throw 'uninstall left the dependency' }
if (@($removed.dsh.profile.bundles) -contains 'dsh-session-groups') { throw 'uninstall left the bundle' }
if ((Get-FileHash -LiteralPath $record -Algorithm SHA256).Hash -ne $beforeHash) { throw 'uninstall changed the group record' }

Invoke-Plugin "add --force `"file:$Tarball`""
$reinstalled = Read-ProfileManifest
if (-not ($reinstalled.dependencies.PSObject.Properties.Name -contains 'dsh-session-groups')) { throw 'reinstall did not add the dependency' }
if (-not (@($reinstalled.dsh.profile.bundles) -contains 'dsh-session-groups')) { throw 'reinstall did not add the bundle' }
if ((Get-FileHash -LiteralPath $record -Algorithm SHA256).Hash -ne $beforeHash) { throw 'reinstall changed the group record' }

Write-Host "PASS: lifecycle install/uninstall/reinstall"
Write-Host "TEST_HOME=$testHome"
Write-Host "RECORD_SHA256=$beforeHash"
Write-Host "No files were deleted. Remove TEST_HOME manually after QA."
