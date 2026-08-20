# Clean-machine Evidence

This record is for packaged Windows/macOS acceptance. It is deliberately
separate from the declarative matrix in
`electron/paths/clean-machine-smoke.ts` and from local unit tests.

<!-- openmind-clean-machine-status: pending -->

Status values are `pending`, `blocked` or `passed`. A `passed` row must use the
machine-readable `key=value; key=value` format below and include the date, OS,
build identifier, package filename, SHA-256, clean-machine preconditions,
scenario outcome and a screenshot/log path or URL. Change the marker to
`complete` only after every row is `passed` with concrete evidence.

Required evidence format:

```text
date=2026-08-06; os=Windows 11 24H2 x64; build=1.0.24+<commit>; package=OpenMind-Portable-1.0.24-x64.exe; sha256=<64 hex>; preconditions=no-python-uv-node-git-ffmpeg,online; outcome=passed; evidence=artifacts/win11-x64-online-no-runtime/screenshots-and-log.zip
```

The `no-python-uv-node-git-ffmpeg` token is mandatory for the two baseline
no-runtime scenarios. The report command rejects missing fields, impossible
dates or malformed hashes, non-passed outcomes, an OS/package that does not
match the scenario platform or architecture, duplicate evidence keys,
placeholder evidence and incomplete no-runtime preconditions. Windows rows
must identify x64/AMD64 in both the OS and package filename; Apple Silicon
rows must identify arm64/Apple Silicon in both the OS and package filename.
A local evidence path must exist; an HTTPS/S3 URL is accepted as an external
reference. The report does not accept a local host description as proof of a
clean-machine run.

Linux/WSL release scenarios are intentionally absent and must not be added;
formal Linux support and the WSL support matrix are out of scope.

| Scenario ID | Status | Package / OS / evidence |
| --- | --- | --- |
| win11-x64-online-no-runtime | pending | |
| win11-x64-offline | pending | |
| win11-x64-non-admin | pending | |
| win11-x64-force-quit-install | pending | |
| win11-x64-update-rollback | pending | |
| macos-as-online-no-runtime | pending | |
| macos-as-offline | pending | |
| macos-as-keychain-locked | pending | |
| win11-x64-cjk-username | pending | |
| win11-x64-space-long-path | pending | |
| any-external-export-relink | pending | |
| any-app-crash-recovery | pending | |

## Distribution UX acceptance (W1–W5)

The existing matrix rows cover the packaged product gate. For the distribution
UX additions, the target Windows 11 x64 and macOS Apple Silicon clean-machine
runs must additionally record these assertions in the same redacted evidence
bundle:

- import a public HTTPS Git Skill: inspect identity/digest, confirm install,
  observe the fresh package-integrity result in Skill Center, and run it without
  a terminal;
- import a ZIP/local directory and confirm warnings/issues are visible before
  installation;
- install Claude Code and Codex from Settings without system Node/npm, verify
  the launcher and manifest under App-private `userData/tools`, restart the App,
  and confirm detection is `app-tools` before PATH fallback;
- cancel an install and verify no staging directory or partial manifest remains;
- complete CLI login in the external terminal, return to Settings and use
  “重新检测”; for WSL, verify only the manual copy steps are shown;
- complete or skip all three onboarding steps and verify the next launch enters
  the main workspace without repeating onboarding.

The one-click CLI install sub-check is additionally exercised continuously by
the multi-OS CI matrix (`.github/workflows/desktop-app.yml`, step
“Clean-machine one-click CLI install smoke”): on every windows-latest and
macos-latest run, `npm run cli:install:smoke` performs the real Claude
official-script install and the Codex npm portable install, then asserts the
launcher exists and `--version` responds. CI success covers the online
clean-runner variant of that sub-check; the packaged-app scenarios in the
table above remain the authoritative release gate.

Local automated evidence for these flows is covered by the installer, IPC,
provider, Skills, Settings and Onboarding unit tests. It is not a substitute
for the target-host run; do not mark the matrix `complete` from this Linux
development host.

## Commands

```bash
npm run clean-machine:report
OPENMIND_CLEAN_MACHINE_STRICT=1 npm run clean-machine:report
```

The report writes `.build/clean-machine-report.json`. The default command is
non-blocking and produces `manual-required`; strict mode is the release gate.
