# ADR-001: Path Boundaries — mymindRoot, workspace, userData

- **Status:** Accepted
- **Date:** 2026-08-05
- **Phase:** 0 (Architecture freeze)
- **Supersedes:** `repoRoot` coupling in `electron/lib/settings.ts`

## Context

The current `desktop-app` couples content discovery, skill discovery and app
private state to a single `repoRoot`. Specifically:

- `looksLikeRepo()` requires both `.claude/skills` **and** `mymind` to exist.
- Skill discovery is hard-coded to `repoRoot/.claude/skills`.
- WSL/Windows absolute paths are hard-coded in `detectRepoRoot()` /
  `findRepoRoot()` (`\\\\wsl.localhost\\Ubuntu\\...`, `D:\\work\\cctools`).
- Product/data services (`ProductService`, `ContentIndexStore`,
  `SourceRegistry`, `MymindFileSearch`, ...) join paths via `repoRoot/mymind`.
- App state leaked into the project tree under `repoRoot/.cctools`; the old
  browser-evidence default was one example. Legacy evidence is migrated to
  explicit user-owned workspace output. Managed Process Skills may use an
  external Export Location Binding; CLI-hosted Agent work has no Broker
  Artifact/export guarantee and must use an explicit location in its Claude
  Code/Codex session.

This blocks the product goal of running as a standalone desktop app that does
not require cloning the cctools repository. To make the app independent we
must split the overloaded `repoRoot` into three disjoint, non-overlapping
roots, each with a single, well-defined responsibility.

## Decision

Split the single `repoRoot` into exactly **five disjoint path roots**, grouped
into three concern areas. No two roots may alias or contain one another.

### 1. Content root — `mymindRoot` (user-owned, app-read-write)

- **What it is:** the actual `mymind` directory chosen by the user.
  - Not the cctools repo. Not a subdirectory of `mymind` (e.g. not
    `mymind/article`). Not a parent of `mymind` (e.g. not the repo).
- **Cardinality:** exactly one active root per app instance at any time.
- **Selection:** the user selects the literal `mymind` directory via the Main
  process directory picker; Main canonicalises with `fs.realpath()`. The
  candidate is previewed read-only (including conflict/access checks) and is
  persisted only after explicit user confirmation.
- **What it stores:** content contracts only (see ADR-002).
- **What it must NOT store:** app settings, run history, logs, caches, skill
  packages, runtimes, credentials, indices, or any `.cctools`-style private
  directory. App private state is forbidden here by an audited rule, not by OS
  enforcement.
- **Switching:** forbidden while any Run is `queued | preparing_runtime |
  running | cancelling` (see ADR for Run state machine, Phase 5). Each Run
  pins a `mymindRootSnapshot` (path + `rootId` + `rootGeneration`).
- **Multiple roots:** the app may remember historical roots for read-only
  artifact access, but only one is active. Historical locations are accessed
  via saved `RootBinding`, never by re-resolving against the active root.

### 2. Workspace root — `workspaceRoot` (optional, AI/code only)

- **What it is:** an optional directory the AI workspace uses for code/file
  work that is unrelated to content.
- **Cardinality:** zero or one.
- **Relationship to content:** completely independent of `mymindRoot`. Setting
  one does not set the other. They may legitimately be the same directory the
  user cares about, but the app never infers one from the other.
- **Legacy role:** `repoRoot` is treated **only** as a one-time migration
  input — `migrateLegacyRepoRoot()` derives `mymindRoot = repoRoot/mymind` and
  optionally `workspaceRoot = repoRoot`, then discards `repoRoot`.

### 3. App private roots — all under `userData`

All app-owned state lives under `app.getPath("userData")`. The logical
layout is fixed by `AppPathsService` (see §5.1 of the refactor plan):

```
<userData>/
├── settings/        settings.json + migrations/
├── state/           <mymind-root-id>/{indexes,sources,content-state}/
├── skills/          registry.json + <skill-id>/<version>/ + active.json + data/
├── runtimes/        packs/ environments/ downloads/
├── credentials/     OS-protected secret storage
├── runs/            <run-id>/
├── automation/
├── catalog/
├── updates/
├── staging/
├── cache/
└── logs/
```

- `skillStoreRoot`, `runtimeRoot`, `stateRoot`, `runRoot`, `credentialRoot`,
  `automationRoot`, `catalogRoot`, `updateRoot`, `stagingRoot`, `cacheRoot`,
  `logRoot` are **all derived from `userData`** by `AppPathsService`.
- These are not user-configurable. The user never types them. There is no
  setting to relocate them (if relocation is ever added, it is a single
  well-formed setting, not per-feature).
- Every JSON state file carries `schemaVersion` and is written via temp-file +
  atomic `rename`.

### Hard rules

1. `mymindRoot`, `workspaceRoot`, and any `userData`-derived root must be
   mutually disjoint. `AppPathsService.bootstrap()` validates this on startup
   and refuses to start if they alias or nest.
2. No new code may call `path.join(repoRoot, ...)`. A `scripts/audit-no-reporoot.js`
   grep fails the build on any re-introduction.
3. No new App or App-native Workflow code may join `mymind` content paths
   except through `MymindPathResolver`. Claude Code/Codex and approved-host
   Process Skills run with the OS user's authority and cannot be technically
   constrained to Resolver paths; the product must state that boundary.
4. Renderer never receives or sends raw absolute mymind paths for editing;
   it uses `mymind/...` logical paths. Absolute paths shown in UI are for
   display of resources the Main process has already validated.
5. The legacy `selectRepo/setRepo` IPC is kept for exactly one release as a
   migration shim (`setRepo` → derives `mymindRoot` → writes v2 setting).
6. The product has no `repoRoot` user-facing copy after migration.

## Consequences

- **Positive:** the app starts without a git repo, without `.claude`, and
  without the cctools checkout. Content features work once a valid `mymindRoot`
  is selected. App private state can be backed up/restored as a portable unit
  without touching user content. The implementation snapshots settings,
  root-scoped state, Automation and Run metadata; credentials/browser tokens,
  installed package/runtime bytes, transient work and caches/logs stay out of
  the archive.
- **Positive:** root switching, root relocation, and per-root indexing become
  well-defined because state is partitioned by `root-id` under
  `userData/state/<root-id>/`.
- **Negative:** every existing `ProductService` / `ContentIndexStore` /
  `SourceRegistry` / `MymindFileSearch` / creative file service must be
  refactored to take a `MymindPathResolver` (or `mymindRootSnapshot`) via
  dependency injection instead of calling `findRepoRoot()`.
- **Negative:** a one-time idempotent migration from `repoRoot` →
  `mymindRoot` + `workspaceRoot` is required, and must be crash-safe and
  re-runnable (see `docs/architecture/data-migration.md`).
- **Risk:** existing users with `state` under `repoRoot/.cctools` must have
  that state moved to `userData/state/<root-id>/`; the source `.cctools` is
  preserved untouched.

## Open questions (deferred to follow-up ADRs)

- Whether `workspaceRoot` is needed at all for v1 (default: yes, kept for the
  AI workspace, but it may remain unset and the app still functions).
- Whether to allow relocating the entire `userData` tree (deferred; not v1).

## User-initiated mymind relocation

Root binding and content relocation are separate operations. Binding only
changes the active path setting; it never copies content. When the user
explicitly chooses to relocate content, Diagnostics runs a read-only preview
and requires an empty target, source/target disjointness, App `userData`
conflict checks, access checks and a source tree digest. The commit copies the
tree to a sibling staging directory, verifies the digest, then atomically
swaps the pre-confirmed empty target with a sibling backup. The source is
always preserved.

An app-start recovery pass consumes a pending relocation marker only when the
recorded tree matches. It can finish a matching staged swap or restore the
original empty target; a non-empty or changed target is left untouched and
fails closed. Only after the copy is verified does Main persist the new
`mymindRoot` binding. This operation is never combined with legacy settings
migration or an app upgrade.
