# Release Checklist

## CI/CD

Repository CI is defined in [`.github/workflows/desktop-app.yml`](../../.github/workflows/desktop-app.yml)
and documented in [`docs/CI_PIPELINE.md`](CI_PIPELINE.md). It runs Ubuntu
verification and full unit/renderer tests, then builds unsigned Windows and
macOS packages with packaged smoke, safety, container, and recovery evidence.
Provider/Clean-machine/independent Security Review remain external gates;
signing, formal Linux support, and Signed Catalog remain out of scope.

## Automated Gate

```bash
npm run typecheck
npm test
npm run verify
npm run perf:check
npm run audit:evidence
npm run release:evidence
npm run release:readiness
npm run release:readiness:contract
npm run recovery:drill
npm run scale:check
npm run runtime:contract
npm run stability:soak
npm run visual:snapshot
npm run provider:e2e:report
npm run provider:e2e:contract
npm run security:review
npm run clean-machine:report
npm run evidence:contract
npm run package:safety
npm run package:safety:contract
npm run package:artifact:contract
npm run dist:win
```

- JSONL concurrent append, recovery, large-output chunking and reassembly pass.
- Provider semantic-event and permission-policy contract tests pass.
- Direct-directory routing and legacy ChangeSet compatibility tests pass.
- Integration smoke verifies content, creative projects, WSL path handling, structured skills and forbidden provider flags.
- Production build contains the TypeScript Electron entry, Utility Process and React renderer.
- Legacy DOM renderer and legacy AI/skill process managers are absent.
- Renderer JavaScript chunks stay under the 500 KiB budget.
- Architecture, visual-source, preview-mode and path-boundary evidence is written to `.build/audit-evidence.json`.
- Scale evidence is written to `.build/scale-report.json`.
- `npm run runtime:contract` executes the RuntimeManager contract with a real
  Pack-provided tool under an empty host `PATH`; it does not replace packaged
  Windows/macOS clean-machine or Python dependency-install acceptance.
- Local stability evidence is written to `.build/stability-soak-report.json`;
  it covers compiled Session/Run persistence, concurrent append/reload,
  synthetic 1000-Manifest validation and Browser contract cycles. It does not
  replace live Provider/Chrome or packaged platform evidence.
- Visual snapshot evidence is written to `.build/visual-snapshot-report.json` and `.build/visual-snapshots/`.
- Provider E2E pending/complete status is written to `.build/provider-e2e-report.json`.
- `npm run security:review` writes `.build/security-review-report.json` and is
  intentionally `manual-required` until an independent reviewer closes every
  P0/P1 row, records a valid review date and marks the reviewer as external or
  independent. Use `CCTOOLS_SECURITY_REVIEW_STRICT=1` as the release gate.
- `npm run clean-machine:report` writes `.build/clean-machine-report.json` and
  is intentionally `manual-required` until every Windows/macOS scenario has
  machine-readable dated package, clean-machine and screenshot/log evidence.
- `npm run evidence:contract` runs temporary black-box fixtures for both
  evidence gates: complete external review markers pass, placeholder audit
  markers fail, impossible review dates fail, and wrong clean-machine
  architecture/package/date or duplicate-field values fail. It never edits
  the repository's pending evidence files.
- `npm run package:safety:contract` verifies that Chromium license prose is not
  treated as runtime behavior while app-owned `process.report` code fails the
  package safety scan.
- Use `CCTOOLS_CLEAN_MACHINE_STRICT=1` as the Clean-machine release gate.
- `.build/release-evidence/` contains a CycloneDX SBOM, a complete production
  dependency license report, and build provenance with input/artifact digests.
- `npm run release:readiness` aggregates the local, package, Provider,
  Security Review and Clean-machine reports into
  `.build/release-readiness-report.json`. It is intentionally
  `manual-required` until every in-scope gate has evidence; strict mode is
  `CCTOOLS_RELEASE_READINESS_STRICT=1`. It separately requires packaged smoke,
  force-quit and recovery fields in both Windows/macOS package evidence. It
  also compares the Release evidence index's bytes/SHA-256 values with the
  actual SBOM, License and Provenance files before passing that gate. Staged
  package evidence must include `packagedRecovery=passed` from the real
  executable startup/force-quit smoke in addition to the compiled recovery
  drill, and `packagedRecoveryEvidence.validated=true` must bind that field to
  the staged `.build/packaged-recovery-report.json` contents. The
  Provider, Security Review and Clean-machine reports are also checked for
  internally consistent counts/details instead of trusting their `status`
  field alone. The report explicitly keeps signed
  release, formal Linux and Signed Catalog outside its scope and never by
  itself authorizes a GA claim.
- On target hosts, the aggregate gate consumes staged evidence under
  `dist/package-evidence-windows.json` / `dist/package-evidence-macos.json`;
  Linux cross-build diagnostic names under `.build/` remain supported.
- `npm run release:readiness:contract` verifies that a complete aggregate
  fixture passes and a missing in-scope macOS gate fails closed.
- `npm run recovery:drill` exercises migration, mymind relocation, app-state
  restore, interrupted Run/orphan recovery and Runtime rollback from the
  compiled `.build` Main-process services.
- `npm run package:safety` scans `.build`, the `.build` payload inside
  `app.asar`, Windows `dist/*-unpacked` trees and macOS `.app` bundles for
  `.env`, actual PEM private-key blocks, obvious API keys, AI runtime state,
  user content paths, development test artifacts and absolute checkout paths.
- The AI Worker base and explicit environments are closed Main-owned
  allowlists; the evidence audit scans both lists plus app-owned
  `electron/shared/renderer` source and build output and rejects crash-report
  upload hooks, Node diagnostic-report/heap-dump flags and known uploader
  credentials. This is local code evidence, not a
  deployment-platform audit.

## Windows Native

- Open a Windows-local Git project.
- Settings shows usable Windows Claude Code and Codex providers.
- Start read-only, edit and auto sessions.
- Confirm delete/elevation/outside-workspace actions pause before execution.
- Cancel a running Provider and a running skill; verify process trees exit.
- Run an edit task and verify changes appear immediately in the selected project directory.
- Verify destructive and project-external actions still pause for approval.

## Windows To WSL

- Open `\\wsl.localhost\<distro>\...` project.
- Verify Windows-native and WSL Provider diagnostics are independent.
- Run a WSL skill and confirm streaming output.
- Run an edit task and verify it writes directly to the connected WSL project without creating a worktree.
- Verify Windows attachments and project paths remain readable.

## Recovery And Scale

- Restart with completed and failed runs; verify records remain.
- Force-close during a run; verify the run is marked interrupted on restart.
- `npm run recovery:drill` includes a real child-process forced termination
  (`SIGKILL` on POSIX and Windows forced-process termination) and compiled
  RunStore restart recovery; repeat the same scenario with packaged Windows/macOS
  builds for the external force-quit gate.
- Open/search a project with 1000 sessions and a long session with tens of thousands of events.
- Run at least three different sessions concurrently and queue a second message in one active session.

## Packaging

- Test the single-file Portable EXE and ZIP build without installation.
- Test the NSIS install/uninstall flow.
- Confirm no `.env`, `.cctools/ai/.runtime/`, Provider state or project content is embedded in the package.
- The package safety scan also rejects app-owned crashReporter/diagnostic-report,
  heap/core-dump flags and known third-party crash-upload credentials in
  compiled code/config text inside `.build`, ASAR and extracted packages. It
  ignores third-party license/document text to avoid treating prose as runtime
  behavior, and excludes generated evidence JSON that is not copied into the
  distributable. This is local artifact evidence; deployment/diagnostic-platform
  policy still requires external audit.
- `npm run dist:win:staged` runs the package safety scan against the staged
  Windows `*-unpacked` tree and the files inside its `app.asar`, recursively
  scans the actual ZIP/Portable/NSIS containers, and then writes
  `dist/package-evidence-windows.json` with safety, smoke, container, built
  recovery-drill and packaged-recovery references. It also copies the staged package-safety,
  platform-specific artifact-safety (`package-artifact-safety-win.json`) and
  recovery reports into the reviewed checkout's `.build/` so the final
  readiness command cannot silently consume stale local reports.
- `npm run dist:mac:staged` performs the equivalent clean staging, unsigned
  macOS DMG/ZIP build, `.app` ASAR scan, recursive DMG/ZIP container scan and
  packaged smoke check on macOS, then writes
  `dist/package-evidence-macos.json` with the passed safety/smoke, container,
  built recovery-drill and packaged-recovery references; it persists the same staged
  safety/recovery reports plus `package-artifact-safety-mac.json` into `.build/`.
- After the distributable containers exist, run
  `CCTOOLS_7ZZ=/path/to/7zz npm run package:artifact:safety` to recursively
  extract Windows ZIP/Portable/NSIS (or macOS ZIP/DMG where supported by the
  extractor) and scan the actual container contents. The report is
  `.build/package-artifact-safety-report.json`; this remains artifact-level
  evidence and does not replace GUI, clean-machine or packaged force-quit
  acceptance.
- A Linux host may generate a diagnostic Windows artifact report with
  `--allow-missing-targets=true`; it may reach `targetValidation=passed` when
  all Windows target kinds are present, but it is never a release gate and does
  not replace GUI, install/uninstall, clean-machine or Provider evidence.
- When `--allow-missing-targets=true` is used for a partial cross-platform
  diagnostic, the scanner exits successfully only when every discovered
  container passed and the only gap is an explicitly missing target kind; the
  report still remains `manual-required` until the target is available.
- Each Clean-machine evidence row must use the `date=...; os=...; build=...;
  package=...; sha256=...; preconditions=...; outcome=...; evidence=...`
  format documented in `docs/CLEAN_MACHINE_EVIDENCE.md`.
- Record signing status. Unsigned development packages may trigger Windows SmartScreen.
- Record final package evidence in `docs/RELEASE_EVIDENCE.md`.
