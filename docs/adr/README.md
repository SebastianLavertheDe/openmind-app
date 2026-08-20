# Architecture Decision Records

Phase 0 deliverables of the desktop-app complete refactor
(`desktop-app-complete-refactor-plan.md`). These ADRs freeze the architecture
before implementation. They are the acceptance gate for the path, security,
and release work that follows.

| ADR | Topic | Status |
|---|---|---|
| [ADR-001](./ADR-001-path-boundaries.md) | Path boundaries — mymindRoot / workspace / userData | Accepted |
| [ADR-002](./ADR-002-mymind-layout-contract.md) | mymind layout contract v1 (`mymind-layout-v1`) | Accepted |
| [ADR-003](./ADR-003-skill-manifest-v1.md) | Skill Manifest v1 (`cctools.skill.yaml`) | Accepted |
| [ADR-004](./ADR-004-skill-trust-model.md) | Skill trust model — independent trust dimensions | Accepted |
| [ADR-005](./ADR-005-runtime-targets.md) | Runtime targets — platform / arch / WSL | Accepted |
| [ADR-006](./ADR-006-managed-runtime-provenance.md) | Managed runtime provenance & verification | Accepted |
| [ADR-007](./ADR-007-secret-backend.md) | Secret backend — CredentialVault | Accepted |
| [ADR-008](./ADR-008-provider-bridge-and-internal-agent.md) | Provider Bridge & Internal Agent Runtime | Superseded by ADR-010 |
| [ADR-009](./ADR-009-release-identity-and-update-chain.md) | Release identity & update trust chain | Accepted |
| [ADR-010](./ADR-010-cli-only-agent-execution.md) | CLI-only Agent execution | Accepted |

## Supporting architecture docs

- [`../architecture/threat-model.md`](../architecture/threat-model.md) — threat model (single trust boundary: OS user).
- [`../architecture/data-migration.md`](../architecture/data-migration.md) — superseded historical `repoRoot` → v2 migration baseline.

## Machine-readable contracts (code)

- [`../../shared/mymind-layout-v1.ts`](../../shared/mymind-layout-v1.ts) — frozen layout manifest.
- [`../../shared/skill-manifest-schema.ts`](../../shared/skill-manifest-schema.ts) — Zod manifest schema (ADR-003).
- [`../../shared/skill-compatibility-matrix.ts`](../../shared/skill-compatibility-matrix.ts) — audited 16-skill classification.
- [`../../electron/paths/app-paths-service.ts`](../../electron/paths/app-paths-service.ts) — AppPathsService (ADR-001).
- [`../../electron/paths/mymind-path-resolver.ts`](../../electron/paths/mymind-path-resolver.ts) — MymindPathResolver (ADR-001/002).
- [`../../electron/paths/mymind-fixture.ts`](../../electron/paths/mymind-fixture.ts) — anonymous mymind fixture.
- [`../../electron/paths/malicious-skill-fixtures.ts`](../../electron/paths/malicious-skill-fixtures.ts) — malicious package fixtures.
- [`../../electron/paths/clean-machine-smoke.ts`](../../electron/paths/clean-machine-smoke.ts) — clean-machine smoke matrix.

## What is intentionally NOT decided here

These ADRs deliberately leave to follow-up work the exact Python version
(after the Phase 4 compatibility spike), the certificate procurement
(Windows publisher subject, macOS Team — tracked in plan §24.1), and any
future relocation of the `userData` tree.
