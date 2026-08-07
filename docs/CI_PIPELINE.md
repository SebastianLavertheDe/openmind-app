# Desktop CI Pipeline

`.github/workflows/desktop-app.yml` is the repository CI entrypoint for the
desktop app. It uses Node.js 22.12 on all runners and keeps platform packaging
unsigned, as required by the current scope.

## Automated jobs

- `verify` runs dependency audit, build, repository/lint checks, release
  evidence generation, recovery drills, performance and scale checks, visual
  contracts, package safety, SBOM/license/provenance generation, release
  readiness contracts, package artifact evidence binding, compiled integration smoke, and the full unit/renderer
  test suite.
- `windows-package` runs the clean staged Windows build, packaged renderer /
  preload smoke test, package safety scan, recursive distributable-container
  scan, recovery drill, and artifact evidence generation.
- `macos-package` runs the equivalent unsigned macOS staged build, `.app` /
  ASAR and distributable-container scans, packaged smoke test, recovery drill,
  and artifact evidence generation.

The Ubuntu job explicitly installs the Electron runtime because visual snapshot
verification launches the compiled desktop binary. Windows and macOS staged
packaging runs the compiled recovery services with a no-download Electron
module override and obtains the target runtime through electron-builder.

## Deliberately manual gates

The workflow does not claim the remaining external acceptance gates:

- Provider and real Chrome E2E;
- Windows/macOS clean-machine matrix and non-admin GUI acceptance;
- packaged force-quit/recovery acceptance on real target machines;
- independent Security Review and deployment/diagnostic-platform audit.

Those records must still be supplied to `provider-e2e-report`,
`clean-machine-report`, and `security-review` before strict release readiness
can pass. Signed release, formal Linux support, Signed Catalog, staged rollout,
and WSL formal support remain out of scope.
