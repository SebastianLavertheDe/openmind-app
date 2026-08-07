# Clean-machine Evidence

This record is for packaged Windows/macOS acceptance. It is deliberately
separate from the declarative matrix in
`electron/paths/clean-machine-smoke.ts` and from local unit tests.

<!-- cctools-clean-machine-status: pending -->

Status values are `pending`, `blocked` or `passed`. A `passed` row must use the
machine-readable `key=value; key=value` format below and include the date, OS,
build identifier, package filename, SHA-256, clean-machine preconditions,
scenario outcome and a screenshot/log path or URL. Change the marker to
`complete` only after every row is `passed` with concrete evidence.

Required evidence format:

```text
date=2026-08-06; os=Windows 11 24H2 x64; build=1.0.24+<commit>; package=CC-Tools-Portable-1.0.24-x64.exe; sha256=<64 hex>; preconditions=no-python-uv-node-git-ffmpeg,online; outcome=passed; evidence=artifacts/win11-x64-online-no-runtime/screenshots-and-log.zip
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

## Commands

```bash
npm run clean-machine:report
CCTOOLS_CLEAN_MACHINE_STRICT=1 npm run clean-machine:report
```

The report writes `.build/clean-machine-report.json`. The default command is
non-blocking and produces `manual-required`; strict mode is the release gate.
