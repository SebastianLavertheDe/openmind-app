# Release Evidence

This file is the hand-off record for the unsigned, host-direct desktop build.
It must be updated with dated Windows/macOS evidence before any release claim.

## Scope

- Signed Windows/macOS release, formal Linux distribution and Signed Catalog are
  explicitly out of scope.
- This record does not claim GA. A green local build is not a substitute for a
  packaged clean-machine run, real Provider E2E or formal Security Review.

## Current local evidence

| Field | Value |
|---|---|
| App version | `1.0.24` |
| Source checkout | `/home/say/work/github/cctools` |
| Base commit | `fe6b60e0f` (`main`, worktree is dirty) |
| Host | Linux `aarch64` |
| Node used for local checks | `v20.19.6` (packaged Windows script requires Node 22+) |
| Renderer/Electron build | passed; production output excludes test JS, source maps and checkout paths |
| Evidence audit | 26 checks passed |
| Release evidence | 266 production components; 224 compiled build files; unknown licenses 0 |
| Security review report | `manual-required`; 5 P1 rows await independent review |
| Clean-machine report | `manual-required`; 0/12 scenarios have external evidence |
| Release readiness | `manual-required`; macOS DMG/artifact completeness, packaged recovery, Provider E2E, Security Review and Clean-machine remain pending |
| Recovery drill | compiled migration, relocation, interrupted Run/orphan recovery, app-state restore, Runtime rollback and child-process forced-termination recovery passed |
| Local stability soak | 3 cycles passed; each validates 1000 synthetic Manifests, 100 sessions, 1000 long-run events, 3 concurrent Runs, 100 Broker Runs and 1000 Browser contract cycles; live Provider/Chrome and packaged soak remain external |
| Visual snapshots | 60 passed |
| Package safety | Current combined scan: 977 `.build`/Windows arm64 unpacked/ASAR/macOS `.app` files; Windows-local report: 643 files; macOS `.app` report: 591 files |
| Artifact-container safety | Windows ZIP/Portable/NSIS all passed recursive extraction; inner `app-arm64.7z` and `app.asar` were scanned; structured report generated |
| macOS artifact-level partial | Linux cross-built unsigned arm64 `.app` and ZIP passed content scans; DMG is unavailable on this host, so `targetValidation=manual-required` |
| Performance | 24 renderer chunks; largest 455.0 KiB; entry 286.3 KiB |
| Full unit suite | 151 files passed, 1 skipped; 1,592 passed, 1 skipped |
| Integration smoke | 237 articles, 485 posts, 1 summary, 8 structured skills |

The Windows arm64 unpacked directory was produced on the Linux build host for
artifact inspection only. It has not been used as Windows GUI or clean-machine
evidence. Separate unsigned Portable and NSIS targets were produced with the
host's native ARM64 NSIS compiler; the staged Windows release script still
requires a real Windows host, and GUI installation/uninstallation acceptance
remains pending.

Current unpacked executable digest:

```text
OpenMind.exe  sha256=f380ba705043a67fb11c941715c2f9a17052ea45c66891391231c83b56a460f3
```

An unsigned Windows arm64 ZIP was also produced from that unpacked tree and
passed `unzip -t`. The Portable and NSIS artifacts were separately produced
with the host's native ARM64 NSIS tool and passed archive-structure checks:

```text
OpenMind-1.0.24-arm64-win.zip  sha256=3cfab99388eae5e4aff02415dac7a10d5c136d7862a939455b541fed9d07b3a3
OpenMind-Portable-1.0.24-arm64.exe  sha256=bf2960d25d1cdf5d32873e9750a170c50776dcfacb0da0d7d095e4e2d3c47563
OpenMind-Setup-1.0.24-arm64.exe  sha256=a1bffa28cd74bd6861efb4437061d0d1f4e7010bdec1730321aa7fc63cb7b5a7
OpenMind-Setup-1.0.24-arm64.exe.blockmap  sha256=6f45ce7691cb6b9569304b13ceaa1b5aee18cee2a2288a8aeb6640cb559c27b0
```

The ZIP, Portable EXE and NSIS Setup remain artifact-level evidence only; none
has passed Windows GUI, installation, clean-machine or Provider acceptance. All
were produced with an explicit unsigned local tool override and are not signed
release evidence.

The local Windows artifact report is `.build/package-evidence-win-local.json`.
It records `targetValidation=passed`, `foundKinds=portable,nsis,zip`, and no
missing target kinds; its Windows-local package-safety subreport passed with 643 files and no
findings. `.build/package-artifact-safety-report.json` separately extracts the
three real Windows containers, recursively expands the embedded `app-arm64.7z`,
confirms `app.asar` is present, and reports no findings for all three artifacts.
The report intentionally records packaged smoke and `packagedRecovery` as
`not-recorded`, and clean-machine evidence as pending; those fields require a
real staged target-host run.

The current Linux host also produced an unsigned macOS arm64 ZIP from the
cross-platform electron-builder path. The `.app` scan covered 591 files with
no findings, and the real ZIP container scan covered 1,073 files with
`app.asar` present and no findings. The ZIP is
`OpenMind-1.0.24-arm64-mac.zip` with
`sha256=87654e1db511a5381131a98a2c1d5d2ff74e8b5e8b30a5c90d829b35a7640122`.
`.build/package-evidence-mac-local.json` records the ZIP as validated
artifact-level evidence but `targetValidation=manual-required` because the
required DMG is absent. This does not provide macOS GUI, Keychain,
clean-machine, signing or packaged recovery evidence.

The local stability report is `.build/stability-soak-report.json`. Its
`sessionSchedulerPersistence` and `brokerRunRecovery` tracks execute compiled
state services in temporary directories; its Agent/Browser track is
contract-only and explicitly records live Provider/Chrome E2E as
`manual-required`.

The Linux host can compile the Windows arm64 Portable and NSIS targets with the
native ARM64 NSIS tool and a local PE/NSIS uninstaller extraction diagnostic.
The normal staged release script still requires its supported Windows release
environment; this local result has no GUI, install/uninstall, clean-machine or
Provider acceptance. The host remains outside the formal Linux support scope.

## External evidence still required

| Area | Required evidence | Status |
|---|---|---|
| Windows clean machine | `npm run clean-machine:report` plus no Python/uv/Node/Git/ffmpeg baseline; install Runtime Pack; run Process/Agent/Workflow Skill | pending |
| macOS clean machine | `npm run clean-machine:report` plus Apple Silicon current baseline; Keychain/offline/runtime scenarios | pending |
| Package outputs | Windows portable/NSIS/ZIP and macOS DMG/ZIP safety scan; `package-evidence-<platform>.json`; no user content, Secret, test artifact or host path | pending |
| Migration/recovery | Packaged Windows/macOS force-quit during migration/update and crash recovery; staged package report also records the compiled recovery drill | pending |
| Provider E2E | Claude/Codex native and WSL behavior, approval, cancellation and diagnostics | pending |
| Security Review | `npm run security:review` plus formal P0/P1 review and diagnostic-platform crash policy audit | pending |

Attach for each completed row: date, OS/build identifier, package filename and
SHA-256, clean-machine preconditions, scenario IDs from
`electron/paths/clean-machine-smoke.ts`, the generated
`dist/package-evidence-<platform>.json`, outcome, and links to screenshots/logs.
The Clean-machine report accepts a row only when those values are encoded as
the required `key=value; key=value` fields; the no-runtime scenarios must also
declare `no-python-uv-node-git-ffmpeg` in `preconditions`.

The complete target-host procedure is documented in
`docs/EXTERNAL_ACCEPTANCE_RUNBOOK.md`.
