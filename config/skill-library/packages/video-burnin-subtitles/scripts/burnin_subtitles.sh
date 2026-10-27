#!/usr/bin/env bash
set -euo pipefail

# Compatibility wrapper for direct macOS/Linux development invocations. The
# installed Skill uses the same Python entrypoint directly, so Windows does
# not need a POSIX shell.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec python3 "$SCRIPT_DIR/burnin_subtitles.py" "$@"
