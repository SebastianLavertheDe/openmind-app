param(
  [string]$StageRoot = (Join-Path $env:TEMP "cctools-desktop-windows-package"),
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

  Write-Host "Creating Windows portable, NSIS, and ZIP packages"
  & node.exe "node_modules/electron-builder/cli.js" --win
  Assert-LastExitCode "electron-builder --win"

  $packagedClaude = Join-Path $stageRoot "dist\win-unpacked\resources\app.asar.unpacked\node_modules\@anthropic-ai\claude-agent-sdk-win32-x64\claude.exe"
  if (-not (Test-Path -LiteralPath $packagedClaude)) {
    throw "Packaged Claude Code executable is missing: $packagedClaude"
  }
  Write-Host "Verifying the packaged Claude Code executable"
  & $packagedClaude --version
  Assert-LastExitCode "Packaged Claude Code executable"

  $packagedApp = Join-Path $stageRoot "dist\win-unpacked\CC Tools.exe"
  $smokeUserData = Join-Path $stageRoot "packaged-smoke-user-data"
  Write-Host "Verifying the packaged renderer and preload bridge"
  & $packagedApp --packaged-smoke-test "--user-data-dir=$smokeUserData"
  Assert-LastExitCode "Packaged renderer/preload smoke test"

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
  $succeeded = $true
}
finally {
  Pop-Location
  if ($succeeded -and -not $KeepStage -and (Test-Path -LiteralPath $stageRoot)) {
    Remove-Item -LiteralPath $stageRoot -Recurse -Force
  }
}

Write-Host "Windows packages are available in $sourceDist"
