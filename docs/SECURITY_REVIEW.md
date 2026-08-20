# Security Review

This is the formal-review hand-off record for the desktop app. Local tests and
`audit:evidence` are supporting evidence only; they do not close this review.

<!-- cctools-security-review-status: pending -->
<!-- cctools-security-reviewer: -->
<!-- cctools-security-reviewed-at: -->
<!-- cctools-security-review-independence: pending -->

## Review scope

- App/Main/Utility Process and Renderer IPC boundaries;
- Skill package installation, installed-copy/receipt integrity and Runtime Pack
  verification;
- CLI installer supply-chain controls: official HTTPS allowlists, isolated
  app-private staging, managed-Node npm execution, digest manifests, cancel and
  rollback behavior;
- Credential Vault, Secret injection, logging/diagnostic redaction and Worker
  environment inheritance;
- path/symlink/TOCTOU/archive/resource-exhaustion controls;
- migration, backup/restore, Run recovery and packaged crash behavior;
- unsigned Windows/macOS packaging and clean-machine assumptions;
- deployment/diagnostic-platform policy for secret-bearing Worker crash dumps.

The review must use a dated source/build identifier and inspect the current
worktree. Signing, formal Linux distribution and Signed Catalog are out of
scope by project decision; their absence is not a finding for this review.

## P0/P1 findings

| ID | Priority | Review question | Status | Evidence / reviewer notes |
| --- | --- | --- | --- | --- |
| SEC-001 | P1 | Does any app-owned crash, diagnostic or deployment integration collect or upload a full memory dump from a Secret-bearing Worker? | pending | |
| SEC-002 | P1 | Can a Skill install/receipt transition, CLI or Runtime Pack change, archive path, symlink or TOCTOU race bypass static checks or execute outside the intended app-private boundary? | pending | |
| SEC-003 | P1 | Can credentials enter another Skill, persist in App metadata/logs/diagnostics/package output, or survive revoke/replace beyond the documented host-process boundary? | pending | |
| SEC-004 | P1 | Do packaged Windows/macOS startup, clean-machine, migration, force-quit and recovery behaviors preserve the stated data and permission boundaries? | pending | |
| SEC-005 | P1 | Does the release/deployment platform add crash collection, telemetry, auto-update or secret-bearing diagnostic behavior not represented in this repository? | pending | |

Status values are `pending`, `open` or `closed`. A row is closed only with
reviewer notes and a concrete evidence link or artifact identifier. Accepted
references include an HTTPS URL, an existing repository artifact path such as
`.build/security-review-report.json` or `artifacts/win11-x64/...`, or an
explicit `evidence=...`, `artifact=...`, `report=...`, `sha256=...` token. The
report command validates that local paths exist instead of treating arbitrary
prose or nonexistent paths as evidence. In addition, SEC-001 and SEC-005 must include an external deployment
or diagnostic audit token (`deployment-audit=...` or `diagnostic-audit=...`),
and SEC-004 must include packaged/clean-machine/recovery evidence
(`packaged-evidence=...`, `clean-machine-evidence=...` or
`recovery-evidence=...`). A local source-test report alone cannot close those
rows; placeholder or non-concrete token values are rejected. The marker above
must be changed to `complete` only after every P0/P1 row
is `closed`, an independent reviewer has filled the reviewer/date fields, and
the independence marker is exactly `external` or `independent`; the date must
also be a real calendar date, not only a matching string shape.

## Supporting local evidence

- `npm run audit:evidence` → `.build/audit-evidence.json`;
- `npm run package:safety` → package and ASAR scan;
- `npm run recovery:drill` → compiled migration/restore/Run/Runtime drill;
- `npm run provider:e2e:report` → external Provider status;
- `.build/release-evidence/` → SBOM, License and build provenance.

These commands do not change the formal-review status.

## Commands

```bash
npm run security:review
CCTOOLS_SECURITY_REVIEW_STRICT=1 npm run security:review
```

The first command writes `.build/security-review-report.json` and remains
non-blocking while the review is pending. Strict mode is the release gate and
fails until the marker, independent reviewer/date, valid review date and all
P0/P1 rows are complete. It also rejects missing, duplicated or priority-changed
required finding IDs, as well as unexpected finding IDs.
