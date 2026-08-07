#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
source_root="$(cd "$script_dir/.." && pwd -P)"
source_dist="$source_root/dist"
temp_root="${TMPDIR:-/tmp}"
temp_root="${temp_root%/}"
stage_root="${1:-$temp_root/cctools-desktop-macos-package}"
keep_stage="${KEEP_STAGE:-0}"

case "$stage_root" in
  "$temp_root"/*) ;;
  *) echo "Stage root must be inside TMPDIR: $temp_root" >&2; exit 1 ;;
esac

node_version="$(node -p 'process.versions.node')"
node_major="${node_version%%.*}"
if (( node_major < 22 )); then
  echo "macOS Node.js 22 or newer is required. Found: $node_version" >&2
  exit 1
fi

command -v rsync >/dev/null 2>&1 || { echo "rsync is required" >&2; exit 1; }

if [[ -e "$stage_root" ]]; then
  rm -rf -- "$stage_root"
fi
mkdir -p "$stage_root"

echo "Staging desktop app in $stage_root"
rsync -a \
  --exclude '.git' \
  --exclude 'node_modules' \
  --exclude 'dist' \
  --exclude '.build' \
  --exclude 'mymind' \
  --exclude '.cctools-userdata' \
  --exclude '*.log' \
  "$source_root/" "$stage_root/"

succeeded=0
cleanup() {
  if [[ "$succeeded" == "1" && "$keep_stage" != "1" && -e "$stage_root" ]]; then
    rm -rf -- "$stage_root"
  fi
}
trap cleanup EXIT

pushd "$stage_root" >/dev/null
npm ci
npm run build
# The compiled recovery services import Electron-owned Main modules but do not
# launch Electron. Electron 42 no longer downloads its host binary from npm ci;
# electron-builder below remains responsible for the packaged target runtime.
ELECTRON_OVERRIDE_DIST_PATH="$stage_root/electron-runtime-placeholder" npm run recovery:drill
node node_modules/electron-builder/cli.js --mac --publish never
npm run package:safety

packaged_app="$(find "$stage_root/dist" -type f -path '*/Contents/MacOS/CC Tools' -print -quit)"
if [[ -z "$packaged_app" ]]; then
  echo "Packaged macOS app executable is missing" >&2
  exit 1
fi

smoke_user_data="$stage_root/packaged-smoke-user-data"
echo "Verifying the packaged renderer and preload bridge"
"$packaged_app" --packaged-smoke-test "--user-data-dir=$smoke_user_data"
recovery_user_data="$stage_root/packaged-recovery-user-data"
echo "Running the packaged force-quit and startup recovery smoke"
node scripts/packaged-recovery-smoke.js --app "$packaged_app" --user-data-dir "$recovery_user_data" --output "$stage_root/.build/packaged-recovery-report.json"
echo "Scanning the actual macOS distributable containers"
node scripts/package-artifact-safety.js --platform mac --output "$stage_root/.build/package-artifact-safety-report.json"
node scripts/package-artifact-report.js --platform mac --require-safety=true --require-artifact-safety=true --require-packaged-recovery=true --packaged-smoke=passed --recovery-drill=passed --packaged-recovery=passed --packaged-recovery-report "$stage_root/.build/packaged-recovery-report.json" --safety-report "$stage_root/.build/package-safety-report.json" --artifact-safety-report "$stage_root/.build/package-artifact-safety-report.json" --output "$stage_root/package-evidence-macos.json"
popd >/dev/null

mkdir -p "$source_dist"
rsync -a "$stage_root/dist/" "$source_dist/"
cp -f "$stage_root/package-evidence-macos.json" "$source_dist/package-evidence-macos.json"
mkdir -p "$source_root/.build"
for report_name in package-safety-report.json package-artifact-safety-report.json recovery-drill-report.json process-crash-recovery-report.json packaged-recovery-report.json; do
  if [[ ! -f "$stage_root/.build/$report_name" ]]; then
    echo "Staged evidence report is missing: $stage_root/.build/$report_name" >&2
    exit 1
  fi
  cp -f "$stage_root/.build/$report_name" "$source_root/.build/$report_name"
done
cp -f "$stage_root/.build/package-artifact-safety-report.json" "$source_root/.build/package-artifact-safety-mac.json"
succeeded=1
echo "macOS packages are available in $source_dist"
