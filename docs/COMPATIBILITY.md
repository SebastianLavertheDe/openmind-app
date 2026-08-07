# Compatibility and Support Matrix

This matrix is the support boundary for the current host-direct App. A target
is not considered supported merely because TypeScript or a local Linux build
can compile it.

| Area | Current contract | Evidence required before support claim |
| --- | --- | --- |
| Windows 11 x64 | First-class target; managed Runtime Pack and unsigned Portable/NSIS/ZIP packaging are defined | Windows packaged GUI, clean-machine, Provider, install/uninstall and recovery matrix |
| Windows 11 arm64 | Artifact can be built locally; target remains diagnostic until acceptance | Native Windows arm64 clean-machine, GUI, Runtime Pack and Provider evidence |
| macOS Apple Silicon | First-class target in Runtime contract | macOS staged DMG/ZIP, Keychain, offline, clean-machine and Provider evidence |
| macOS Intel | Contract target only; no current release claim | Explicit macOS Intel package and clean-machine evidence |
| Windows ↔ WSL | Separate development/runtime contract; Windows binaries are never reused inside WSL | Real Windows/WSL Provider and Runtime matrix; formal WSL release support is not planned |
| Linux x64/arm64 | Development/test contract only | No formal release claim; Linux packages and Linux signing are out of scope |
| Node/Python/uv/Git/ffmpeg | Packaged clean-machine must not depend on host installations for managed Skill execution | Real Windows/macOS no-runtime scenarios from `CLEAN_MACHINE_EVIDENCE.md` |
| Provider/Browser | Native Provider, WSL Provider and Chrome extension are independent paths | Packaged live Provider/Chrome E2E with approval, cancellation and diagnostics |

## Version and release policy

- The current App version is recorded in `package.json` and in each package
  evidence report. Record the package SHA-256 with every external test.
- There is no automatic update channel or Catalog-driven update chain in this
  scope. Local/manual repair, digest verification and Runtime rollback remain
  available.
- Unsigned development packages are artifact evidence only and may trigger OS
  trust warnings. This project does not perform Windows Authenticode, macOS
  Developer ID/notarization, or Linux package signing.
- A Provider/Runtime/Skill format change must update the relevant Manifest,
  compatibility fixture, migration note and contract tests before the App
  version is advanced.

## End-of-life and migration

When an App version is retired, keep the last supported package and its
release evidence available for recovery. Before removing a Runtime Pack or
Skill version, confirm no active Run references its digest and retain the
previous verified Runtime long enough for manual rollback. Never delete a
user's mymind tree as part of uninstall, upgrade or recovery.

Compatibility evidence must distinguish:

- source/development tests;
- compiled local artifact checks;
- packaged GUI/clean-machine acceptance; and
- external Provider, Browser and deployment/security review.

Only the latter two can close the corresponding release or GA gate.
