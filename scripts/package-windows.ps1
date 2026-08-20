param(
  [string]$StageRoot = (Join-Path $env:TEMP "openmind-desktop-windows-package"),
  [switch]$KeepStage
)

$ErrorActionPreference = "Stop"

function Assert-LastExitCode {
  param([string]$Step)

  if ($LASTEXITCODE -ne 0) {
    throw "$Step failed with exit code $LASTEXITCODE."
  }
}

$sourceRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$sourceDist = [IO.Path]::GetFullPath((Join-Path $sourceRoot "dist"))
$sourceDistPrefix = $sourceDist.TrimEnd([IO.Path]::DirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar
$tempRoot = [IO.Path]::GetFullPath($env:TEMP).TrimEnd([IO.Path]::DirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar
$stageRoot = [IO.Path]::GetFullPath($StageRoot)
$stagePrefix = $stageRoot.TrimEnd([IO.Path]::DirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar

if (-not $stagePrefix.StartsWith($tempRoot, [StringComparison]::OrdinalIgnoreCase)) {
  throw "StageRoot must be inside the current user's TEMP directory: $tempRoot"
}

$nodeVersion = (& node.exe -p "process.versions.node").Trim()
Assert-LastExitCode "Reading the Windows Node.js version"
$nodeMajor = [int]($nodeVersion.Split(".")[0])
if ($nodeMajor -lt 22) {
  throw "Windows Node.js 22 or newer is required. Found: $nodeVersion"
}

if (Test-Path -LiteralPath $stageRoot) {
  Remove-Item -LiteralPath $stageRoot -Recurse -Force
}
New-Item -ItemType Directory -Path $stageRoot | Out-Null

Write-Host "Staging desktop app in $stageRoot"
& robocopy.exe $sourceRoot $stageRoot /E /XD node_modules dist .build /XF "*.log"
if ($LASTEXITCODE -gt 7) {
  throw "Staging source files failed with robocopy exit code $LASTEXITCODE."
}

$succeeded = $false
Push-Location $stageRoot
try {
  Write-Host "Installing Windows dependencies with Node.js $nodeVersion"
  & npm.cmd ci
  Assert-LastExitCode "npm ci"

  Write-Host "Building the Windows desktop application"
  & npm.cmd run build
  Assert-LastExitCode "npm run build"

  Write-Host "Preparing the bundled Windows Python runtime"
  & npm.cmd run prepare:python-runtime -- --target=windows-x64
  Assert-LastExitCode "Bundled Python runtime"

  Write-Host "Running the compiled migration and recovery drill"
  # The compiled recovery services import Electron-owned Main modules but do
  # not launch Electron. Electron 42 no longer downloads its host binary from
  # npm ci, so keep this deterministic and let electron-builder fetch only the
  # target runtime needed for the packaged smoke test below.
  $env:ELECTRON_OVERRIDE_DIST_PATH = Join-Path $stageRoot "electron-runtime-placeholder"
  & npm.cmd run recovery:drill
  Assert-LastExitCode "npm run recovery:drill"
  Remove-Item Env:ELECTRON_OVERRIDE_DIST_PATH -ErrorAction SilentlyContinue

  Write-Host "Creating Windows portable, NSIS, and ZIP packages"
  & node.exe "node_modules/electron-builder/cli.js" --win
  Assert-LastExitCode "electron-builder --win"

  Write-Host "Scanning the built Windows package for secrets, user data, test artifacts, and checkout paths"
  & npm.cmd run package:safety
  Assert-LastExitCode "npm run package:safety"

  $packagedClaude = Join-Path $stageRoot "dist\win-unpacked\resources\app.asar.unpacked\node_modules\@anthropic-ai\claude-agent-sdk-win32-x64\claude.exe"
  if (-not (Test-Path -LiteralPath $packagedClaude)) {
    throw "Packaged Claude Code executable is missing: $packagedClaude"
  }
  Write-Host "Verifying the packaged Claude Code executable"
  & $packagedClaude --version
  Assert-LastExitCode "Packaged Claude Code executable"

  $packagedApp = Join-Path $stageRoot "dist\win-unpacked\OpenMind.exe"
  $smokeUserData = Join-Path $stageRoot "packaged-smoke-user-data"
  Write-Host "Verifying the packaged renderer and preload bridge"
  & $packagedApp --packaged-smoke-test "--user-data-dir=$smokeUserData"
  Assert-LastExitCode "Packaged renderer/preload smoke test"

  $recoveryUserData = Join-Path $stageRoot "packaged-recovery-user-data"
  Write-Host "Running the packaged force-quit and startup recovery smoke"
  & node.exe "scripts/packaged-recovery-smoke.js" --app $packagedApp --user-data-dir $recoveryUserData --output (Join-Path $stageRoot ".build\packaged-recovery-report.json")
  Assert-LastExitCode "Packaged recovery smoke"

  Write-Host "Scanning the actual Windows distributable containers"
  & node.exe "scripts/package-artifact-safety.js" --platform win --output (Join-Path $stageRoot ".build\package-artifact-safety-report.json")
  Assert-LastExitCode "Windows package artifact safety"

  Write-Host "Writing Windows package artifact hashes"
  & node.exe "scripts/package-artifact-report.js" --platform win --require-safety=true --require-artifact-safety=true --require-packaged-recovery=true --packaged-smoke=passed --recovery-drill=passed --packaged-recovery=passed --packaged-recovery-report (Join-Path $stageRoot ".build\packaged-recovery-report.json") --safety-report (Join-Path $stageRoot ".build\package-safety-report.json") --artifact-safety-report (Join-Path $stageRoot ".build\package-artifact-safety-report.json") --output (Join-Path $stageRoot "package-evidence-windows.json")
  Assert-LastExitCode "Windows package artifact evidence"

  New-Item -ItemType Directory -Path $sourceDist -Force | Out-Null
  $sourceWinUnpacked = [IO.Path]::GetFullPath((Join-Path $sourceDist "win-unpacked"))
  $sourceWinUnpackedPrefix = $sourceWinUnpacked.TrimEnd([IO.Path]::DirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar
  if (-not $sourceWinUnpackedPrefix.StartsWith($sourceDistPrefix, [StringComparison]::OrdinalIgnoreCase)) {
    throw "Refusing to replace a win-unpacked directory outside the repository dist directory."
  }
  if (Test-Path -LiteralPath $sourceWinUnpacked) {
    Remove-Item -LiteralPath $sourceWinUnpacked -Recurse -Force
  }
  & robocopy.exe (Join-Path $stageRoot "dist") $sourceDist /E
  if ($LASTEXITCODE -gt 7) {
    throw "Copying Windows artifacts back to the repository failed with robocopy exit code $LASTEXITCODE."
  }
  Copy-Item -LiteralPath (Join-Path $stageRoot "package-evidence-windows.json") -Destination (Join-Path $sourceDist "package-evidence-windows.json") -Force
  $sourceBuild = [IO.Path]::GetFullPath((Join-Path $sourceRoot ".build"))
  New-Item -ItemType Directory -Path $sourceBuild -Force | Out-Null
  foreach ($reportName in @("package-safety-report.json", "package-artifact-safety-report.json", "recovery-drill-report.json", "process-crash-recovery-report.json", "packaged-recovery-report.json")) {
    $stageReport = Join-Path $stageRoot ".build\$reportName"
    if (-not (Test-Path -LiteralPath $stageReport)) {
      throw "Staged evidence report is missing: $stageReport"
    }
    Copy-Item -LiteralPath $stageReport -Destination (Join-Path $sourceBuild $reportName) -Force
  }
  Copy-Item -LiteralPath (Join-Path $stageRoot ".build\package-artifact-safety-report.json") -Destination (Join-Path $sourceBuild "package-artifact-safety-win.json") -Force
  $succeeded = $true
}
finally {
  Pop-Location
  if ($succeeded -and -not $KeepStage -and (Test-Path -LiteralPath $stageRoot)) {
    Remove-Item -LiteralPath $stageRoot -Recurse -Force
  }
}

Write-Host "Windows packages are available in $sourceDist"
