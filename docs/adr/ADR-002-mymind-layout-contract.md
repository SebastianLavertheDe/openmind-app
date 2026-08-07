# ADR-002: mymind Layout Contract v1 (`mymind-layout-v1`)

- **Status:** Accepted
- **Date:** 2026-08-05
- **Phase:** 0 (Architecture freeze)
- **Machine-readable manifest:** `shared/mymind-layout-v1.ts`

## Context

The `mymind` directory has grown organically. Its current on-disk layout is a
de-facto contract consumed by 16 skills, and it must not be reorganised by the
app. Audit of the live `mymind/` directory on 2026-08-05 shows these top-level
entries:

```
mymind/
├── article/        (content)
├── creative/       (content, with Chinese-named subtrees — see below)
├── daily-summary/  (content)
├── daily-topic/    (content)
├── post/           (content)
├── reddit/         (content)
└── wiki/           (content)
```

The `creative/` subtree uses fixed Chinese stage directories that **must not**
be renamed:

```
mymind/creative/01-内容生产/
├── 文稿库/
│   └── 02-制作中/<package>/
└── 选题管理/
```

Skills also reference these directories that may not yet exist on a given
machine (e.g. `video/`, `.claude/`, `.obsidian/`). The plan requires that we
freeze a versioned, machine-readable contract that distinguishes:

- **content-contract** directories the app and skills rely on; and
- **optional / tool-private** directories that may exist but are not required
  and are preserved verbatim if present.

This ADR freezes the v1 contract and forbids the app from ever renaming,
moving, deleting, or "cleaning up" any of these entries — including unknown
user-created ones.

## Decision

### 1. Versioned, machine-readable contract

`shared/mymind-layout-v1.ts` is the single source of truth. It exports a
frozen `MYMIND_LAYOUT_V1` object with the following categories:

- `initializeRequired`: must exist after the user explicitly initialises a new
  root (not on bind of an existing root).
- `createIfNeeded`: created lazily by the skill that owns them on first write.
  Absence is **not** a bind failure — it is surfaced in `RootHealth` only.
- `optionalPreserveOnly`: observed tool-private directories (`.claude`,
  `.claudian`, `.obsidian`). Never created, never required, never deleted;
  preserved verbatim if present.
- `contentContract`: union of `initializeRequired` + `createIfNeeded`.

### 2. Frozen v1 entries

| Logical path | Category | Notes |
|---|---|---|
| `article/` | create-if-needed | RSS/article output (date subdir) |
| `creative/` | create-if-needed | Chinese-named subtrees (see below) |
| `creative/01-内容生产/文稿库/02-制作中/` | create-if-needed | in-progress writing packages |
| `creative/01-内容生产/选题管理/` | create-if-needed | topic collection box, ai_topic_*.md |
| `daily-summary/` | create-if-needed | `YYYYMMDD_daily_summary.md` |
| `daily-topic/` | create-if-needed | `YYYYMMDD_daily_topic.md` |
| `post/` | create-if-needed | X/post output (date subdir) |
| `reddit/` | create-if-needed | reddit output (date subdir) |
| `wiki/` | create-if-needed | compiled wiki |
| `video/` | create-if-needed | existing `video-burnin-subtitles` contract; created by that skill |
| `.claude/` | optional-preserve-only | may exist; never created by app |
| `.claudian/` | optional-preserve-only | may exist; never created by app |
| `.obsidian/` | optional-preserve-only | may exist; never created by app |

**Note on absence observed in audit:** the live `mymind/` on this machine has
no `.claude/`, `.obsidian/`, or `video/`. That is expected and valid; their
absence is reported via `RootHealth.missingCreateIfNeededEntries` (for `video/`)
or simply not surfaced (for optional entries).

### 3. Hard immutability rules

1. The app **never** renames, moves, or deletes any directory or file under
   `mymindRoot`. Including: unknown user-created dirs, hidden dirs, files with
   Chinese names, spaces, emoji, or long names.
2. The app uses **no whitelist-based cleanup**. Unknown entries are reported as
   `unknownPreservedEntries` in `RootHealth` for information only — they are
   never deletion candidates.
3. When binding an existing root, the app stores a path reference only. It does
   not copy, move, rename, or "repair" the tree. Missing `create-if-needed`
   entries go into the health report; they are not auto-created on bind.
4. The only way the app creates `create-if-needed` entries is:
   - the user runs the explicit "initialise compatible structure" action
     (creates `initialize-required` entries only); or
   - a skill's normal write flow creates the entry on first use.
5. When initialising a **new** root, only the versioned, reviewed template is
   used. Future releases may not rename/regroup these paths via silent upgrade.
6. Manifest `mymind.write` patterns (ADR-003) must be a subset of
   `contentContract`; the `MymindPathResolver` rejects write patterns that
   would create a new top-level directory not in this table.

### 4. `RootHealth` model (frozen)

```ts
type MymindRootHealth = {
  configured: boolean;
  rootId?: string;
  accessible: boolean;
  readable: boolean;
  writable: boolean;
  expectedStructureVersion?: string;     // "mymind-layout-v1"
  missingInitializeEntries: string[];     // empty on bind of existing root
  missingCreateIfNeededEntries: string[]; // informational only
  optionalObservedEntries: string[];      // informational only
  unknownPreservedEntries: string[];      // never deletion candidates
  symlinkWarnings: string[];
  activeRunCount: number;
  warnings: string[];
};
```

- `optionalObservedEntries` and `unknownPreservedEntries` are display-only.
- Missing `createIfNeeded` entries never fail a bind.

## Consequences

- **Positive:** binding an existing root is always non-destructive and
  re-runnable; the app can be pointed at any real `mymind` without risk.
- **Positive:** the contract is testable against the anonymous mymind fixture
  (see `docs/fixtures/`).
- **Negative:** skills that historically inferred a repo (e.g.
  `knowledge-wiki-compiler` walking ancestors to find `.claude`) must be
  migrated to take `MYMIND_ROOT` / `CCTOOLS_MYMIND_ROOT` instead.
- **Risk:** any future change to layout requires bumping to
  `mymind-layout-v2` and writing a migration; v1 is immutable post-freeze.
