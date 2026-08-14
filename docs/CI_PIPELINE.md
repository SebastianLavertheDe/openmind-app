# Desktop CI Pipeline

`.github/workflows/desktop-app.yml` is the repository CI entrypoint for the
desktop app. It uses Node.js 22.12 on all runners and keeps platform packaging
unsigned, as required by the current scope.

## Automated jobs

- The `desktop-test` matrix runs on Windows, macOS, and Ubuntu. Each runner
  installs dependencies, builds the app, runs the full unit/renderer suite,
  compiled integration smoke, real Electron main/preload/renderer IPC E2E,
  and visual snapshots.
- Local `npm run verify` additionally runs dependency audit, repository/lint
  checks, release evidence generation, recovery drills, performance and scale
  checks, package safety, SBOM/license/provenance generation, release
  readiness contracts, package artifact evidence binding, and the remaining
  strict release contracts.
- `test:integration` runs the compiled desktop integration smoke without
  provider credentials; it checks the built app-server bridge and the
  repository's dangerous SDK/bypass invariants.
- `test:e2e` launches the real Electron main process with the real preload and
  renderer, then exercises the exposed IPC bridge against a temporary mymind
  fixture. It is intentionally provider-independent.
- `visual:snapshot` launches the current renderer scenarios in Electron and
  verifies the screenshot/layout contracts, including the responsive settings
  and companion layouts.

The Ubuntu job installs Xvfb because the Electron E2E and visual snapshot
checks launch a compiled desktop binary without a physical display. Windows and
macOS runners use their native displays when available; staged packaging is
still a separate manual release operation in the current scope.

## Deliberately manual gates

The workflow does not claim the remaining external acceptance gates:

- Provider-backed and real Chrome E2E;
- Windows/macOS clean-machine matrix and non-admin GUI acceptance;
- packaged force-quit/recovery acceptance on real target machines;
- signed Windows/macOS packaging and distributable-container acceptance;
- independent Security Review and deployment/diagnostic-platform audit.

Those records must still be supplied to `provider-e2e-report`,
`clean-machine-report`, and `security-review` before strict release readiness
can pass. Signed release, formal Linux support, Signed Catalog, staged rollout,
and WSL formal support remain out of scope.
