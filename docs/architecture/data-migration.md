# Data Migration Spec — `repoRoot` → v2 paths

- **Status:** Phase 0 baseline
- **Date:** 2026-08-05
- **Related:** ADR-001 (path boundaries), ADR-002 (layout)

## 1. Inputs (legacy state that may exist)

- old `settings.json` with `repoRoot`
- `<repoRoot>/mymind/` (the content root)
- `<repoRoot>/.claude/skills/` (16 skills + `_shared`)
- `<repoRoot>/.cctools/` (leaked app state: browser-evidence, etc.)
- skill `.env` files (secrets)
- skill cache/log/state files
- old run records
- browser-automation tokens
- provider login / session state

## 2. Migration properties (must hold)

- **Idempotent** — running twice yields the same result.
- **Retryable** — any failed step can be retried.
- **Crash-safe** — interrupted migration leaves the active root/skill untouched.
- **Staging + atomic switch** — writes happen off to the side; `schemaVersion`
  is the last write.
- **Non-destructive** — old data is never moved/renamed/deleted. Source
  `.cctools` and `.env` are preserved verbatim.
- **Rollback-compatible** — rolling the app back to the previous version lets
  the old version still read the original repo data; new userData state does
  not pollute the old repo.

## 3. Flow (v1 → v2)

1. Read old `settings.json` (do **not** write yet).
2. If `<repoRoot>/mymind` exists → derive `mymindRoot` candidate.
3. Dry-run structure / permissions / symlink check on the candidate.
4. Display "bind path only, no content moves" to the user.
5. User confirms.
6. Read-only preflight the old `.cctools` state and its app-private target;
   target must be absent or empty. Migrate old `.cctools` state →
   `userData/state/<root-id>/` (copy; original kept), refusing merge/overwrite.
7. Original `.cctools` preserved untouched.
8. Scan `<repoRoot>/.claude/skills` via the SkillPackageService legacy adapter.
9. Run install pre-check + clean copy. No code execution occurs during
   inspection; a valid package is promoted atomically to active + ready only
   after its declared Runtime is prepared.
10. `.env` — analyse variable **names** only; never copy values.
11. User re-confirms each secret in the Vault.
12. Migrate resolvable non-sensitive settings.
13. Rebuild indexes under `userData/state/<root-id>/indexes/`.
14. Static consistency check + index validation. Any smoke uses the selected
   active + ready digest, the Runtime resolver and a disposable fixture or the
   Skill's documented no-write mode.
15. Write migration marker + `schemaVersion: 2`.
16. Save migration report.

## 4. `repoRoot` derivation rule

- `workspaceRoot` ← `repoRoot` (optional; the AI/code workspace).
- `mymindRoot` ← `repoRoot/mymind` (must pass the ADR-002 health check).
- `repoRoot` itself is **discarded** as a live concept post-migration; it
  survives only inside the legacy `setRepo` IPC shim for one release.

## 5. Run history legacy handling

Old run records may lack: skill digest, runtime digest, root snapshot,
standard terminal state, artifact index. Migration:

- tags them `legacyRun: true`;
- never fabricates missing fields;
- preserves time/skill/status/log where present;
- re-runs redaction over old logs;
- does not copy secret plaintext from old logs into the new RunStore;
- if unsafe to migrate, provides a read-only archive note.

## 6. Root relocation vs. version migration (kept separate)

- Deriving `mymindRoot` from `repoRoot` is a **settings migration** (this doc).
- Copying the whole `mymind` tree to a new disk is a **user-initiated
  relocation** (ADR-001 §5.6). The two are **never combined** in the same
  upgrade step. An app upgrade never moves user content.

The local relocation contract is implemented by
`electron/paths/mymind-relocation-service.ts` and is exposed from Diagnostics:

- the user selects an existing target directory and receives a read-only
  preview with canonical paths, file/directory counts, byte count and a tree
  digest;
- the target must be an empty directory, must not alias/nest the source, and
  must not overlap App `userData`; symlinks and special files fail closed;
- after explicit confirmation, the complete tree is copied to a sibling
  staging directory, verified, and swapped with a sibling backup using
  atomic renames; the source remains untouched;
- a pending marker records the source/target tree digest. Startup recovery
  finishes only a matching transaction or restores the original empty target;
  a changed/non-matching target is preserved and never merged or overwritten;
- only after the verified copy does Main bind the new `mymindRoot` and restart
  the Worker snapshot. The old root remains readable and is not deleted.

## 7. Acceptance (lossless)

- Tree diff (before vs after) shows zero rename/move/delete in `mymind`.
- File counts and paths identical.
- Chinese-named directories identical.
- Hidden directories identical.
- User-unknown directories identical.
- No app-private file appears in `mymind`.
- After root switch, new runs write only to the new root.
- The old root is still readable by the old app version.
- Migration is re-runnable.
- Rollback does not require moving mymind content back.

## 8. Two-phase commit for irreversible migrations

- Each schema bump has a documented rollback-compatibility window.
- Irreversible migrations have their own gate; after execution the app must
  not claim older versions still boot.
- Migration uses two-phase commit: prepare (write the staged tree + a
  `legacy-state-migration.pending.json` marker), atomically rename into an
  absent/empty target, then commit (`legacy-state-migration.json`). A crash
  before commit is retriable; a matching target/pending pair is recovered on
  the next startup. A non-matching non-empty target is fail-closed; it is
  never merged or overwritten.

The same sibling-swap and pending-marker rule applies to user-initiated root
relocation. Relocation is copy-only: it never removes the source, never merges
into a non-empty target, and never runs as an implicit part of version
migration.
