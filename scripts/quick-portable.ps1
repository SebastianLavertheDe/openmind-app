param(
  [string]$StageRoot = (Join-Path $env:TEMP "cctools-quick-portable"),
  [string]$OutDir = [Environment]::GetFolderPath('Desktop')
)

# Quick portable packaging: stage -> npm ci -> build -> electron-builder --win portable
# Skips smoke tests / Claude.exe verification / NSIS+ZIP. Output: single portable exe on Desktop.
$ErrorActionPreference = "Stop"

function Assert-LastExitCode {
  param([string]$Step)
  if ($LASTEXITCODE -ne 0) { throw "$Step failed with exit code $LASTEXITCODE." }
}

$sourceRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$repoRoot = [IO.Path]::GetFullPath((Join-Path $sourceRoot ".."))

# Require Node 22+
$nodeVersion = (& node.exe -p "process.versions.node").Trim()
Assert-LastExitCode "Reading Windows Node.js version"
$nodeMajor = [int]($nodeVersion.Split(".")[0])
if ($nodeMajor -lt 22) { throw "Windows Node.js 22+ required. Found: $nodeVersion" }

# Clean stage
if (Test-Path -LiteralPath $StageRoot) {
  Remove-Item -LiteralPath $StageRoot -Recurse -Force
}
New-Item -ItemType Directory -Path "$StageRoot\desktop-app" | Out-Null

Write-Host "Staging to $StageRoot"
& robocopy.exe $sourceRoot "$StageRoot\desktop-app" /E /XD node_modules dist .build /XF "*.log" | Out-Null
if ($LASTEXITCODE -gt 7) { throw "Staging source failed (robocopy $LASTEXITCODE)." }
$global:LASTEXITCODE = 0

# lint:manifests resolves .claude/skills two levels above desktop-app/scripts
# (the repo root), so stage the skill manifests to keep the staged tree valid.
$sourceSkills = Join-Path $repoRoot ".claude\skills"
if (Test-Path -LiteralPath $sourceSkills) {
  & robocopy.exe $sourceSkills (Join-Path $StageRoot ".claude\skills") /E /IF cctools.skill.yaml | Out-Null
  if ($LASTEXITCODE -gt 7) { throw "Staging skill manifests failed (robocopy $LASTEXITCODE)." }
  $global:LASTEXITCODE = 0
}

Push-Location (Join-Path $StageRoot "desktop-app")
try {
  Write-Host "npm ci (Windows deps, Node $nodeVersion)"
  & npm.cmd ci
  Assert-LastExitCode "npm ci"

  Write-Host "Building app"
  & npm.cmd run build
  Assert-LastExitCode "npm run build"

  $runtimeTarget = (& node.exe -p "process.arch === 'x64' ? 'windows-x64' : process.arch === 'arm64' ? 'windows-arm64' : ''").Trim()
  if (-not $runtimeTarget) { throw "Quick portable packaging requires a Windows x64 or arm64 host. Found: " + (& node.exe -p "process.arch") }
  Write-Host "Preparing bundled Python runtime for $runtimeTarget"
  & npm.cmd run prepare:python-runtime -- "--target=$runtimeTarget"
  Assert-LastExitCode "Bundled Python runtime"

  Write-Host "Packaging portable exe"
  & node.exe "node_modules/electron-builder/cli.js" --win portable
  Assert-LastExitCode "electron-builder portable"

  if (-not (Test-Path -LiteralPath $OutDir)) {
    New-Item -ItemType Directory -Path $OutDir | Out-Null
  }
  $copied = 0
  Get-ChildItem -Path (Join-Path $StageRoot "desktop-app\dist") -Filter "CC-Tools-Portable-*.exe" -File | ForEach-Object {
    Copy-Item -LiteralPath $_.FullName -Destination $OutDir -Force
    Write-Host ("Copied: " + $_.Name)
    $copied++
  }
  if ($copied -eq 0) { throw "No portable exe found in " + (Join-Path $StageRoot "desktop-app\dist") }
  Write-Host "Done. $copied portable package(s) on Desktop: $OutDir"
}
finally {
  Pop-Location
  if (Test-Path -LiteralPath $StageRoot) {
    Remove-Item -LiteralPath $StageRoot -Recurse -Force
  }
}
