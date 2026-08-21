# ADR-002: OpenMind Data Repository Layout Contract

- **Status:** Accepted (current contract: `openmind-layout-v3`)
- **Date:** 2026-08-05
- **Phase:** 0 (Architecture freeze)
- **Machine-readable manifest:** `shared/openmind-layout-v1.ts` (current:
  `shared/openmind-layout-v3.ts`)

## Context

The private OpenMind data repository has grown organically. Its on-disk layout is a
de-facto contract consumed by 16 skills, and it must not be reorganised by the
app. The selected directory is the repository and content root; it does not
contain another `openmind/` directory. Its content entries include:

```
<openmindRoot>/
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
<openmindRoot>/creative/01-内容生产/
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

`shared/openmind-layout-v1.ts` is the single source of truth. It exports a
frozen `OPENMIND_LAYOUT_V1` object with the following categories:

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

**Note on absence observed in audit:** a valid root may have
no `.claude/`, `.obsidian/`, or `video/`. That is expected and valid; their
absence is reported via `RootHealth.missingCreateIfNeededEntries` (for `video/`)
or simply not surfaced (for optional entries).

### 3. Hard immutability rules

1. The app **never** renames, moves, or deletes any directory or file under
   `openmindRoot`. Including: unknown user-created dirs, hidden dirs, files with
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
6. Manifest `openmind.write` patterns (ADR-003) must be a subset of
   `contentContract`; the `OpenmindPathResolver` rejects write patterns that
   would create a new top-level directory not in this table.

### 4. `RootHealth` model (frozen)

```ts
type OpenmindRootHealth = {
  configured: boolean;
  rootId?: string;
  accessible: boolean;
  readable: boolean;
  writable: boolean;
  expectedStructureVersion?: string;     // "openmind-layout-v1"
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
  re-runnable; the app can be pointed at any real `openmind` without risk.
- **Positive:** the contract is testable against the anonymous openmind fixture
  (see `docs/fixtures/`).
- **Negative:** skills that historically inferred a repo (e.g.
  `knowledge-wiki-compiler` walking ancestors to find `.claude`) must be
  migrated to take `OPENMIND_ROOT` instead.
- **Risk:** any future change to layout requires bumping to
  `openmind-layout-v2` and writing a migration; v1 is immutable post-freeze.

## Supersession note: layout v2 (additive)

`shared/openmind-layout-v2.ts` supersedes v1 additively: every v1 entry is
carried over verbatim, plus a new `app-managed` category and the entries
`.agent/skills` + `.agent/skill-data` (the Installed Skill store relocated
from app-private userData into the bound root). No on-disk migration is
required; the §3 immutability rules carry over unchanged.

## Supersession: layout v3 (flat-root contract, 2026-08-21)

`shared/openmind-layout-v3.ts` supersedes v2. Its root interpretation is a
deliberate contract correction: the selected
directory is the private data repository and the **flat** content root.
`article/`, `config/`, `.agent/` etc. sit directly under the selected root,
with no nested `openmind/` sub-directory. v3 additionally recognises:

| Logical path | Category | Notes |
|---|---|---|
| `assets/` | create-if-needed | browser evidence / shared media output; skill-writable |
| `config/` | app-managed | `providers.yaml`; written directly by the app, never via `openmind.write` |
| `.openmind/` | app-managed | product state stores (content index, watchlist, …) |
| `.agent/skills/` | app-managed | flat `<name>/SKILL.md` Agent Skills store plus registry |
| `.claude/` | app-managed | directory link to `.agent`; Claude Code discovers `.claude/skills` natively |
| `.zcode/` | optional-preserve-only | tool-private; never created by app |
| `scripts/` | optional-preserve-only | user automation tooling |
| `AGENTS.md`, `CLAUDE.md`, `README.md`, `.gitignore`, `.gitattributes` | optional-preserve-only | root documentation files |

`video/` remains create-if-needed: it may be absent but is still owned by the
`video-burnin-subtitles` skill contract. This is a new application, so no
legacy binding upgrade is performed. When an existing real `.claude/` directory
is encountered, the app preserves it below `.agent/legacy-claude`, moves only
non-conflicting entries into `.agent`, and then creates the link; conflicting
content is never overwritten. The §3 immutability rules carry over unchanged.
