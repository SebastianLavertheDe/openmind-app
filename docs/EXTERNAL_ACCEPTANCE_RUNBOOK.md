# External Acceptance Runbook

This is the hand-off procedure for evidence that cannot be produced on the
current Linux development host. It closes the remaining Phase 12 rows only
when dated artifacts are attached to the repository or an approved evidence
store. Do not change a `pending` marker to `complete` from a local Linux run.

Signing, formal Linux distribution, Signed Catalog and automatic update chains
are intentionally excluded from every step below.

## 1. Freeze the build identity

Use one clean checkout and record the exact source commit, App version, target
OS/architecture, package filename and SHA-256. Keep the source checkout and
the packaged test user data separate from the user's real `openmind`.

From the repository root on the target release host:

```bash
npm ci
npm run verify
npm run recovery:drill
npm run package:safety
```

On Windows, the supported staged flow is:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/package-windows.ps1 -KeepStage
```

On macOS, use:

```bash
KEEP_STAGE=1 bash scripts/package-macos.sh
```

The staged scripts already perform a clean build, compiled recovery drill,
package safety scan, real-container safety scan, packaged renderer/preload
smoke, packaged force-quit/startup-restore smoke and artifact hashing. Keep
the stage directory until all clean-machine and recovery scenarios have
finished. Do not use a developer checkout as the clean-machine App data root.
On success they also persist the staged package safety, artifact safety,
compiled recovery and packaged recovery reports into the reviewed checkout's
`.build/`, alongside the `dist/package-evidence-<platform>.json` record.

## 2. Package-container scan

The staged scripts run the recursive container scan automatically after the
distributable containers exist. If running the report manually, use a
target-host 7-Zip executable:

```bash
OPENMIND_7ZZ=/path/to/7zz npm run package:artifact:safety
node scripts/package-artifact-report.js --platform win --require-safety=true \
  --require-artifact-safety=true --require-packaged-recovery=true \
  --packaged-smoke=passed --recovery-drill=passed \
  --packaged-recovery=passed \
  --packaged-recovery-report .build/packaged-recovery-report.json
```

Use `--platform mac` on macOS. Preserve:

- `.build/package-safety-report.json`;
- `.build/package-artifact-safety-report.json`;
- `dist/package-evidence-<platform>.json`;
- the package SHA-256 values and the staged smoke output.

The container scan must report `status=passed`, no findings, and `app.asar`
present for every distributable container. The package evidence command also
checks that the safety report's artifact names, kinds, byte sizes and SHA-256
values match the files currently in `dist/`. It is still artifact-level evidence;
it does not close GUI, clean-machine, Provider or force-quit acceptance.
For a Linux cross-build diagnostic with an intentionally missing target, use
`--allow-missing-targets=true`: a partial report may exit successfully only
when all discovered containers pass, but it remains `manual-required` and is
not a release gate.

## 3. Clean-machine matrix

Use a fresh OS user/profile or disposable VM. The baseline no-runtime scenarios
must verify that the host does not provide Python, uv, Node, Git or ffmpeg to
the App's managed Skill path; record the negative checks as part of
`preconditions`. The App's packaged Electron runtime is not a reason to add a
host Node installation to the preconditions.

For each row in `docs/CLEAN_MACHINE_EVIDENCE.md`:

1. Start without the openmind checkout, `.claude` repository, existing App
   `userData`, Provider state, browser profile or pre-created Runtime Pack.
2. Bind an existing external `openmind` root and record its before/after tree
   digest. Do not put it under App `userData`.
3. Execute every assertion listed by the scenario, including offline/network,
   non-admin, CJK username, long path, Keychain and unwritable export setup.
4. Capture a redacted screenshot and a log bundle. Never include `.env`, API
   keys, cookies, browser profiles, Credential Vault files or full openmind
   content.
5. Add one `key=value; key=value` row with the exact package SHA-256 and an
   evidence path. Use a new dated evidence directory for every build.

Run the report after editing the rows:

```bash
npm run clean-machine:report
OPENMIND_CLEAN_MACHINE_STRICT=1 npm run clean-machine:report
```

The strict command must report all 12 scenarios passed before the Clean-machine
row can be closed. Linux/WSL rows must not be added.

## 4. Packaged recovery and rollback

The staged target-host scripts automatically run
`scripts/packaged-recovery-smoke.js`. It launches the real packaged
executable, force-terminates it, creates an interrupted App-state restore
transaction, relaunches the package and verifies snapshot restoration and
transaction cleanup. The result is `.build/packaged-recovery-report.json` and
the package evidence record contains `packagedRecovery=passed` plus
`packagedRecoveryEvidence.validated=true` bound to that report. This smoke is
supporting packaged evidence; it does not replace the cases below.

On the target OS, preserve the staged package and a disposable `openmind` tree.
Perform and record:

- force quit during Runtime Pack install;
- force quit during update before activation;
- restart after an interrupted Run and inspect the terminal failure/orphan
  warning;
- app crash during migration/backup restore and startup recovery;
- verified Runtime rollback to the previous version;
- external Export Location relink/revoke after the target becomes unavailable.

For every case, compare the source/target openmind tree digest, active/previous
Runtime record, Run history and generated Artifact list. A successful local
`npm run recovery:drill` or packaged recovery smoke is supporting evidence; it
does not replace Runtime Pack install/update force-quit and target-OS disaster
recovery cases.

## 5. Provider and Browser acceptance

Use disposable Provider credentials and a real target installation. Exercise
native Claude/Codex, WSL where applicable, approval, cancellation, timeout,
diagnostics, retry and the Chrome extension/user-authorized Browser path.
Attach only redacted request metadata, Run IDs, status events and screenshots.
The report must not contain request headers, credential values, browser tokens
or full response bodies.

## 6. Independent Security Review

An independent reviewer must inspect the current source/build and fill all five
P1 rows in `docs/SECURITY_REVIEW.md`. Each closed row needs reviewer notes and a
concrete evidence reference such as an artifact path, HTTPS URL, report ID or
SHA-256 token. The reviewer must fill the date and mark independence as
`external` or `independent`. SEC-001 and SEC-005 additionally require an
external `deployment-audit=...` or `diagnostic-audit=...` token; SEC-004
requires `packaged-evidence=...`, `clean-machine-evidence=...` or
`recovery-evidence=...`. These tokens make it impossible to close the
deployment/platform rows with only repository-local tests.

Run both commands from the reviewed checkout:

```bash
npm run security:review
OPENMIND_SECURITY_REVIEW_STRICT=1 npm run security:review
```

The strict command is expected to fail until all P0/P1 rows are closed. Do not
close SEC-001 or SEC-005 without checking the deployment/diagnostic platform's
crash-dump, telemetry, auto-update and secret-bearing Worker policy outside
this repository.

## 7. Aggregate release readiness

After the target-host package reports, Clean-machine rows, packaged recovery
records, Provider E2E rows and independent review have been attached, regenerate
and strictly validate the external reports, then run the aggregate report from
the same reviewed checkout:

```bash
OPENMIND_PROVIDER_E2E_STRICT=1 npm run provider:e2e:report
OPENMIND_SECURITY_REVIEW_STRICT=1 npm run security:review
OPENMIND_CLEAN_MACHINE_STRICT=1 npm run clean-machine:report
OPENMIND_RELEASE_READINESS_STRICT=1 npm run release:readiness
```

Each strict source command must pass. The readiness command is the final
fail-closed gate: it must exit successfully and
write `.build/release-readiness-report.json` with `status=ready` and an empty
`failedChecks` array. A `manual-required` result is expected while any
target-host evidence is missing; do not edit generated reports to force a
green result. This aggregate gate does not establish GA and does not expand
the scope to signed release, formal Linux support or Signed Catalog. Readiness
accepts staged package evidence at `dist/package-evidence-windows.json` and
`dist/package-evidence-macos.json`, as well as the Linux diagnostic
`.build/package-evidence-*-local.json` files. The staged scripts persist
platform-specific artifact reports under `.build/`; a generic report is only
used as a legacy fallback when its embedded platform matches the requested
target.

In PowerShell, set each variable with `$env:NAME="1"` before invoking the
corresponding command, or use the equivalent target-host environment syntax.

## Closure map

| Plan item | Evidence that closes it |
| --- | --- |
| Secret-bearing Worker memory dump | Independent source review plus deployment/diagnostic-platform audit |
| No host Python/uv | Windows and macOS baseline no-runtime rows, with package hashes and logs |
| Security Review | Five closed P1 rows, independent reviewer/date, strict report passed |
| Clean-machine Matrix | All 12 dated rows passed and strict report passed |
| Package contents | Local unpacked/ASAR scan plus real container scan for each target; macOS artifacts included |
| Migration/crash/disaster recovery | Packaged Windows/macOS force-quit and crash rows plus rollback/tree-digest evidence |
| Aggregate release readiness | Strict readiness report with every in-scope check passed and `failedChecks=[]` |

Only after this map is complete may the corresponding `[ ]` entries in the
refactor plan be changed. This runbook does not authorize a GA claim; the plan's
explicit out-of-scope items remain out of scope.
