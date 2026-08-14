# Support and Recovery Runbook

This runbook describes the local, unsigned host-direct desktop build. It is
for operators and maintainers investigating a failed start, Skill/Runtime
run, migration, backup restore, or external export.

## Scope and safety boundary

- The App, Skill and Runtime code run with the current user's OS permissions;
  Declared Access and Export Location Binding are product controls and audit
  records, not an OS sandbox.
- Do not send API keys, cookies, `.env` files, provider headers, browser
  profiles, Credential Vault files, or unfiltered mymind content to support.
- Signing, automatic updates, Signed Catalog, formal Linux distribution and
  the WSL release matrix are out of scope. Linux is a development/test host
  only; Windows-to-WSL behavior is a separate development contract.

## First response checklist

Record only:

1. App version, package filename and SHA-256, OS/architecture, and whether the
   App is packaged or a development checkout.
2. The exact page/action, Run ID or Skill ID/version/digest, root generation,
   and the terminal state shown in Runs.
3. The relevant Diagnostics status: mymind root health, migration state,
   Runtime Pack readiness/integrity, Skill readiness/trust, and Provider
   diagnostic text.
4. A redacted screenshot or the generated local evidence report. Replace
   physical paths, usernames, URLs with credentials, and content excerpts
   before sharing.

Do not retry a destructive operation until the current Run has reached a
terminal state or the recovery steps below have been completed.

## Startup and root problems

1. Open Diagnostics and check that the selected mymind root is configured,
   accessible, readable and writable.
2. If the root is wrong or unavailable, use root selection. The App performs
   canonical-path conflict checks before saving; it must not be placed under
   App `userData` or contain App state.
3. For a relocation, run the preview first. The destination must be empty;
   the source is preserved. Do not manually merge the two trees.
4. If a migration or relocation marker is present after an interrupted App,
   restart once and let startup recovery verify the matching tree. Preserve
   the marker and source tree if recovery reports a mismatch.

## Runtime and Skill failures

1. In Diagnostics/Settings, inspect Runtime Pack `status`, `integrity` and
   `ready`. A managed Runtime failure must stop with `Needs Runtime`; it must
   not silently use Python, uv, Node or another executable from `PATH`.
2. Use Runtime repair only with an explicitly selected local/offline Pack or a
   user-initiated HTTPS download from a signed Manifest. Verify the digest,
   signature, version, license and SBOM before activation.
3. If the new Pack fails, use Runtime rollback. The previous verified Pack is
   retained until the replacement is active and no Run is using it.
4. In Skill Center, inspect the source, digest, review state and Runtime
   readiness. A changed local package must pass static inspection again and be
   reinstalled before it can become the active ready version; do not bypass
   this state to make a run start.

## Run, Agent and Provider failures

- A failed or cancelled managed Process/Workflow Run can be inspected and
  retried from Runs. A Run marked interrupted after restart is terminal failed
  and remains auditable.
- If Diagnostics reports a possible orphan PID, do not automatically kill a
  reused PID. Record the PID and let an operator identify the process before
  terminating it.
- An Agent Skill runs only from an AI console using the selected, available
  Claude Code CLI or Codex CLI and `/skill-id ...`. Authentication, model
  selection, session continuation and tool approval are owned by that CLI.
- Submitting `kind: agent` through manual Skill Run, ExecutionBroker,
  Automation, Workflow, Broker retry or the removed Internal Agent resume API
  is intentionally rejected. Do not work around that failure by treating the
  Agent as a Process Skill or by adding a direct provider/API-key fallback.
- Provider Profiles store references to credentials, not credential values in
  Run metadata. They remain the managed Process API connection mechanism and
  are not Agent host configuration. Agent CLI login/configuration and Process
  Provider diagnostics must be investigated separately.
- Claude Code/Codex and their tools have the current user's OS privileges.
  Package trust, CLI-native approvals, capability text and Artifact
  declarations are not a sandbox. Chrome extension and user-authorized Browser
  E2E require the real desktop environment and remain manual evidence.

## Backup and restore

Use Diagnostics → App State Backup. The portable backup includes settings,
private state, Automation and Run metadata. It excludes credentials, browser
tokens, Skill/Runtime packages, caches/logs, temporary workspaces and mymind
content.

Before importing a backup:

1. Stop active Runs and keep the current App state directory intact.
2. Confirm the backup was produced by the same App contract and keep its
   checksum.
3. Import through Diagnostics; do not unpack files directly into `userData`.
4. Restart the App and verify root generation, Runtime readiness, Run history
   and Skill active/readiness state. If restore is interrupted, startup recovery restores the
   previous snapshot and removes only the completed transaction staging.

## External Export Location

An external export binding is a reference to a canonical directory, not a
permission sandbox. If it becomes unavailable or unwritable, the Run must
fail closed. Use Relink only after confirming the new directory, or Revoke to
stop future writes. Existing files are not deleted by Relink or Revoke.

## Maintainer verification

Run from `desktop-app/` after preserving a redacted reproduction:

```bash
npm run typecheck
npm run test:unit
npm run verify
npm run stability:soak
npm run recovery:drill
npm run package:safety
CCTOOLS_7ZZ=/path/to/7zz npm run package:artifact:safety
npm run provider:e2e:report
npm run security:review
npm run clean-machine:report
npm run release:readiness
```

The default Provider/Security/Clean-machine reports are non-blocking and
write `manual-required`. Their strict variants are release gates and must not
be changed to complete without dated external evidence and an independent
reviewer where required.

Attach these redacted artifacts to an engineering incident when applicable:

- `.build/stability-soak-report.json`
- `npm run recovery:drill` output and `.build/release-evidence/`
- `.build/provider-e2e-report.json`
- `.build/security-review-report.json`
- `.build/clean-machine-report.json`
- `.build/package-evidence-<platform>.json`
- `.build/packaged-recovery-report.json` from the target-host packaged
  force-quit/startup-restore smoke
- `.build/release-readiness-report.json`
- `docs/EXTERNAL_ACCEPTANCE_RUNBOOK.md` for the Windows/macOS and independent
  review hand-off procedure.

The reports are evidence of the tested scope only. They do not establish GA,
Windows/macOS clean-machine acceptance, signing, Linux support, Signed
Catalog, live Provider/Chrome E2E, or the full target-OS Runtime Pack and
disaster-recovery matrix.
