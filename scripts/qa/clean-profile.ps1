<#
.SYNOPSIS
  Install a release tarball into a disposable DSH_HOME/profile for manual QA.

.DESCRIPTION
  Refuses to use the real ~/.dsh. Never deletes files. Leaves the test home and
  web process in place and prints both so the operator can inspect and clean up.

.PARAMETER Tarball
  Absolute path to dsh-session-grove-*.tgz.

.PARAMETER Port
  Web port for the isolated profile. Default 4415.

.PARAMETER Profile
  Profile name inside the disposable DSH_HOME. Default sg-qa.
#>
param(
  [Parameter(Mandatory = $true)][string]$Tarball,
  [int]$Port = 4415,
  [string]$Profile = 'sg-qa'
)

$ErrorActionPreference = 'Stop'

$desktop = Join-Path $env:LOCALAPPDATA 'Programs\DSH Desktop\DSH Desktop.exe'
$cli = Join-Path $env:LOCALAPPDATA 'Programs\DSH Desktop\resources\app\lib\desktop-cli.js'
if (-not (Test-Path -LiteralPath $desktop)) { throw "DSH Desktop not found: $desktop" }
if (-not (Test-Path -LiteralPath $cli)) { throw "desktop-cli.js not found: $cli" }
if (-not (Test-Path -LiteralPath $Tarball)) { throw "Tarball not found: $Tarball" }

$realHome = [System.IO.Path]::GetFullPath((Join-Path $env:USERPROFILE '.dsh'))
$testHome = [System.IO.Path]::GetFullPath((Join-Path $env:TEMP ("dsh-sg-clean-" + (Get-Date -Format 'yyyyMMdd-HHmmss'))))
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

$profileOut = Join-Path $testHome 'profile.out'
$profileErr = Join-Path $testHome 'profile.err'
$webArgs = "--expose-internals `"$cli`" --profile $Profile --from-default-profile web --port $Port --no-open"
$web = Start-Process -FilePath $desktop -ArgumentList $webArgs -Environment $envs -PassThru -WindowStyle Hidden
Start-Sleep -Seconds 6

$installOut = Join-Path $testHome 'install.out'
$installErr = Join-Path $testHome 'install.err'
$installArgs = "--expose-internals `"$cli`" plugin --profile $Profile add --force `"file:$Tarball`""
$install = Start-Process -FilePath $desktop -ArgumentList $installArgs -Environment $envs -RedirectStandardOutput $installOut -RedirectStandardError $installErr -PassThru -WindowStyle Hidden
$install.WaitForExit(180000) | Out-Null
if ($install.ExitCode -ne 0) {
  Get-Content $installErr -Tail 20 -ErrorAction SilentlyContinue
  throw "plugin install failed with exit code $($install.ExitCode)"
}

$installed = Join-Path $testHome "profiles\$Profile\node_modules\dsh-session-grove\package.json"
$version = if (Test-Path -LiteralPath $installed) { (Get-Content -LiteralPath $installed -Raw | ConvertFrom-Json).version } else { 'not-installed' }

Write-Host "TEST_HOME=$testHome"
Write-Host "WEB_PID=$($web.Id)"
Write-Host "INSTALLED_VERSION=$version"
Write-Host "URL: check profile.out for the tokenized http://127.0.0.1:$Port/?token=... line"
Write-Host "Stop web: Stop-Process -Id $($web.Id)"
Write-Host "No files were deleted. Remove TEST_HOME manually after QA."
Get-Content $profileOut -Tail 5 -ErrorAction SilentlyContinue
