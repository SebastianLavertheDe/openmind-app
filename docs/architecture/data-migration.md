# Data Root Binding and Relocation Spec

- **Status:** Current root binding contract; RSS and managed Skill upgrade migration supported
- **Date:** 2026-08-05
- **Related:** ADR-001 (path boundaries), ADR-002 (layout)

> OpenMind Desktop is a new application. It does not upgrade a legacy
> `repoRoot` setting or reshape an old directory tree. Users explicitly bind a
> private data repository as `openmindRoot`; that selected directory is the
> flat content root.

## 1. Bound directory contract

- `<openmindRoot>/article/`, `daily-summary/`, `creative/`, etc. — content
- `<openmindRoot>/config/providers.yaml` — Provider configuration and API keys
- `<openmindRoot>/.agent/skills/<name>/SKILL.md` — flat Agent Skills packages
- `<openmindRoot>/.agent/skill-data/` — persistent per-Skill runtime state
- `<openmindRoot>/.claude` — directory link to `.agent`, exposing the same
  `skills/` tree to Claude Code's native project discovery
- `<openmindRoot>/.openmind/` — repository-travelling product records

`openmindRoot` is never derived by appending `openmind` to another path.

## 2. Binding and relocation properties

- **Bind-only by default** — selecting a root stores a canonical path and does
  not copy, move, rename, delete, or repair its contents.
- **Explicit relocation** — copying data occurs only after the user starts and
  confirms a relocation operation.
- **Retryable and crash-safe** — an interrupted relocation leaves the source
  untouched and can be recovered from its pending marker.
- **Staged and verified** — relocation writes to a sibling staging directory,
  verifies the complete tree, then performs the target switch.
- **Non-destructive** — the source is never removed or modified.

## 3. Binding flow

1. The user chooses the private data repository itself.
2. Main canonicalises the candidate and performs read-only structure,
   permissions, overlap, and symlink checks.
3. The UI makes clear that binding stores only the path and does not move,
   delete, or repair existing content.
4. After explicit confirmation, the app persists that exact canonical path as
   `openmindRoot`.
5. All physical paths resolve directly below that root. A logical UI/API path
   such as `openmind/article/a.md` resolves to
   `<openmindRoot>/article/a.md`; the `openmind/` segment is a logical namespace
   only.

## 4. No legacy derivation or automatic upgrade

The app does not infer `openmindRoot` from a checkout, current working
directory, `workspaceRoot`, or parent directory. It does not append an
`openmind/` segment, migrate old settings, or flatten directories during
startup. Any reorganisation is performed by the user before binding.

## 5. Run history

There is no legacy run-history import. New runs pin the active root snapshot so
later root changes cannot redirect their artifacts.

## 6. Root relocation

- Binding `openmindRoot` is an explicit user action.
- Copying the whole private data repository to a new disk is a **user-initiated
  relocation**. Binding never silently triggers this operation, and an app
  upgrade never moves user content.

The local relocation contract is implemented by
`electron/paths/openmind-relocation-service.ts` and is exposed from Diagnostics:

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
- only after the verified copy does Main bind the new `openmindRoot` and restart
  the Worker snapshot. The old root remains readable and is not deleted.

## 7. Acceptance (lossless)

- Tree diff (before vs after) shows zero rename/move/delete in the source root.
- File counts and paths identical.
- Chinese-named directories identical.
- Hidden directories identical.
- User-unknown directories identical.
- No machine-local `userData` file appears in the private data repository.
- After root switch, new runs write only to the new root.
- The old root remains readable and unchanged.
- Relocation recovery is re-runnable.
- Rollback does not require moving content back.

## 8. Relocation recovery

Relocation uses a pending marker plus a sibling staging directory. A matching
staged tree can be completed on the next startup; the original empty target can
be restored when the swap did not finish. A non-matching or non-empty target is
fail-closed and is never merged or overwritten. Relocation is copy-only and
never removes the source.

## RSS and built-in Skill consolidation

Root binding still does not infer or reshape a content tree. On first RSS access, `RssRepository` imports the user's persistent OPML and nested references, preserving name, grouping and disabled state. Package-local legacy OPML is only a migration fallback. A complete parse precedes the atomic `sources.json` initialization; the old files remain. Empty initialized lists and deleted presets stay empty/deleted.

App startup migrates only intact, provenance-verified official defaults. A pending/completed journal under app-private migrations maps old to new package identities and permits retry after interruption. Active processes prevent replacement. Conflicting imports remain visible in Skill source management. Historical runs retain their original identities; future default rules retain enabled state, cadence and timezone while switching RSS capture to the local pipeline. Existing workflow run records continue to use their recorded target type.

Preferences live at `.agent/preferences/daily-brief.json`, and run admission freezes their revision. Python and TypeScript share PID/token file locks for source commits; another live CLI process is not recovered as a crashed worker. See [RSS and Skills guide](../RSS_AND_SKILLS_GUIDE.md).

## Creative workspace retirement (2026-11-05)

`<openmindRoot>/creative/` is an ordinary content directory after this upgrade. The app no longer creates or manages its topics, stages, reviews, versions or publication records. Existing files and per-Skill runtime data remain unchanged; generic file read/write and preview retain their existing root and permission checks. All frozen directory contracts v1–v4 remain intact.

The derived `content-index.json` drops legacy `creative/` records on the next search/refresh, including roots with no active dates. Normal article, brief and daily-topic records rebuild as before. Only the app-private derived index is rewritten; source manuscripts are never removed.

Old session `origin.page: creative` normalizes to `ai`, preserving an optional preview/file path. Old run `contexts.kind: creative` normalizes to `file` when a path exists, otherwise `content`. Labels, text, messages and run IDs remain available even if an original file is missing. Parsing is idempotent and does not grant extra file or project access. Legacy list-width storage keys remain readable to preserve pane widths; removed settings are ignored by schema parsing. Generic save interval/version/archive preferences remain accepted for compatibility.

Five App-owned packages retire by verified source identity: `creative-writing`, `daily-writing-orchestrator`, `ai-media-topic-selector`, `collect-interest-markers`, `asset-collector`. Startup/root binding persists disabled preferences; current catalogs and admission filter these packages even before the migration writes. Historical session snapshots cannot bridge them into a new turn. Already admitted executions may finish with their exact pinned version/digest; package bytes are retained. Affected automation rules, including workflows that depend on retired Process packages, are disabled with an explanation, retaining inputs, triggers and history. Queued work that has not passed admission becomes blocked instead of waiting forever. Already admitted children keep their identity and finish normally; failed retired children are not retried. Repeated startup is idempotent. Third-party Git/directory/ZIP imports and explicitly retained copies are preserved by provenance, regardless of matching IDs. `daily-topic-selector`, the brief/RSS chain and Project WeChat export remain available.
