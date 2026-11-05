<#
.SYNOPSIS
  Start a disposable DSH web instance for Playwright (A+ isolated).

.DESCRIPTION
  Uses a unique %TEMP% DSH_HOME and a dedicated profile. Refuses the real
  ~/.dsh, never deletes files, and writes web.json for the Playwright runner.

.PARAMETER Tarball
  Release tarball to install into the disposable profile.

.PARAMETER Port
  Isolated web port. Default 4416.

.PARAMETER Profile
  Disposable profile name. Default sg-e2e.

.PARAMETER LocalePack
  Optional test-only locale-pack directory/package to install after the plugin.

.PARAMETER HostRoot
  Optional host installation directory. Defaults to community DSH Desktop;
  pass the official DeepSeek Harness directory to run the same isolated A+.
#>
param(
  [Parameter(Mandatory = $true)][string]$Tarball,
  [int]$Port = 4416,
  [string]$Profile = 'sg-e2e',
  [string]$LocalePack = '',
  [string]$HostRoot = ''
)

$ErrorActionPreference = 'Stop'

if ($HostRoot -ne '') {
  $desktop = Join-Path $HostRoot 'DeepSeek Harness.exe'
  # Official builds keep the host CLI inside app.asar; Windows cannot path-test
  # into an asar archive, but Electron can execute the virtual path.
  $cli = Join-Path $HostRoot 'resources\app.asar\dsh\node_modules\@deepseek-ai\dsh-desktop-host\lib\cli.js'
} else {
  $desktop = Join-Path $env:LOCALAPPDATA 'Programs\DSH Desktop\DSH Desktop.exe'
  $cli = Join-Path $env:LOCALAPPDATA 'Programs\DSH Desktop\resources\app\lib\desktop-cli.js'
}
if (-not (Test-Path -LiteralPath $desktop)) { throw "host executable not found: $desktop" }
if ($HostRoot -eq '' -and (-not $cli -or -not (Test-Path -LiteralPath $cli))) { throw "host CLI not found: $cli" }
if (-not (Test-Path -LiteralPath $Tarball)) { throw "Tarball not found: $Tarball" }

$realHome = [System.IO.Path]::GetFullPath((Join-Path $env:USERPROFILE '.dsh'))
$testHome = [System.IO.Path]::GetFullPath((Join-Path $env:TEMP ("dsh-sg-e2e-" + (Get-Date -Format 'yyyyMMdd-HHmmss'))))
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
$init = Start-Process -FilePath $desktop -ArgumentList $webArgs -Environment $envs -RedirectStandardOutput $profileOut -RedirectStandardError $profileErr -PassThru -WindowStyle Hidden
Start-Sleep -Seconds 8
Stop-Process -Id $init.Id -Force -ErrorAction SilentlyContinue

$installOut = Join-Path $testHome 'install.out'
$installErr = Join-Path $testHome 'install.err'
$installArgs = "--expose-internals `"$cli`" plugin --profile $Profile add --force `"file:$Tarball`""
$install = Start-Process -FilePath $desktop -ArgumentList $installArgs -Environment $envs -RedirectStandardOutput $installOut -RedirectStandardError $installErr -PassThru -WindowStyle Hidden
$install.WaitForExit(180000) | Out-Null
if ($install.ExitCode -ne 0) {
  Get-Content $installErr -Tail 20 -ErrorAction SilentlyContinue
  throw "plugin install failed with exit code $($install.ExitCode)"
}

if ($LocalePack -ne '') {
  $localePackPath = [System.IO.Path]::GetFullPath($LocalePack)
  if (-not (Test-Path -LiteralPath $localePackPath)) { throw "locale pack not found: $localePackPath" }
  $packOut = Join-Path $testHome 'locale-pack-install.out'
  $packErr = Join-Path $testHome 'locale-pack-install.err'
  $packArgs = "--expose-internals `"$cli`" plugin --profile $Profile add --force `"file:$localePackPath`""
  $packInstall = Start-Process -FilePath $desktop -ArgumentList $packArgs -Environment $envs -RedirectStandardOutput $packOut -RedirectStandardError $packErr -PassThru -WindowStyle Hidden
  $packInstall.WaitForExit(180000) | Out-Null
  if ($packInstall.ExitCode -ne 0) {
    Get-Content $packErr -Tail 20 -ErrorAction SilentlyContinue
    throw "locale pack install failed with exit code $($packInstall.ExitCode)"
  }
}

$webOut = Join-Path $testHome 'web.out'
$webErr = Join-Path $testHome 'web.err'
$webArgs = "--expose-internals `"$cli`" --profile $Profile --port $Port --no-open"
$web = Start-Process -FilePath $desktop -ArgumentList $webArgs -Environment $envs -RedirectStandardOutput $webOut -RedirectStandardError $webErr -PassThru -WindowStyle Hidden
Start-Sleep -Seconds 8

$url = $null
for ($attempt = 0; $attempt -lt 20; $attempt += 1) {
  foreach ($candidate in @($webOut, $profileOut)) {
    $text = Get-Content $candidate -Raw -ErrorAction SilentlyContinue
    if ($text -match 'http://127\.0\.0\.1:' + $Port + '/\?token=[^\s]+') {
      $url = $Matches[0]
      break
    }
  }
  if ($url) { break }
  Start-Sleep -Milliseconds 500
}
if (-not $url) {
  Get-Content $webOut -Tail 20 -ErrorAction SilentlyContinue
  Get-Content $profileOut -Tail 20 -ErrorAction SilentlyContinue
  throw "isolated web URL not found on port $Port"
}

$installed = Join-Path $testHome "profiles\$Profile\node_modules\dsh-session-grove\package.json"
$version = if (Test-Path -LiteralPath $installed) { (Get-Content -LiteralPath $installed -Raw | ConvertFrom-Json).version } else { 'not-installed' }
$manifest = @{
  testHome = $testHome
  profile = $Profile
  port = $Port
  url = $url
  webPid = $web.Id
  version = $version
}
$jsonPath = Join-Path $testHome 'web.json'
$manifest | ConvertTo-Json | Set-Content -LiteralPath $jsonPath -Encoding UTF8

Write-Host "TEST_HOME=$testHome"
Write-Host "WEB_PID=$($web.Id)"
Write-Host "INSTALLED_VERSION=$version"
Write-Host "WEB_JSON=$jsonPath"
Write-Host "URL=$url"
Write-Host "Stop web: Stop-Process -Id $($web.Id)"
Write-Host "No files were deleted. Remove TEST_HOME manually after QA."
