# Performance Checklist

This checklist backs `todo.md` section 18.3. Automated checks must run in CI or before packaging; manual checks record the Windows package behavior.

## Automated Gate

```bash
npm run build
npm run perf:check
npm run perf:stream
npm run audit:evidence
npm run scale:check
npm run visual:snapshot
```

The gate fails when any renderer JavaScript chunk exceeds `500 KiB`. It also writes `.build/perf-report.json` with:

- entry script list and total entry bytes
- largest renderer chunks
- generation timestamp

`npm run perf:stream` writes `.build/stream-performance-report.json`. It uses
an expanded 1000-event / 497-tool history while streaming 48 KiB commentary
and 24 KiB reasoning through the production event pump. The gate requires:

- collapsed history: `0` mounted tool rows and at most `1500` DOM nodes
- commentary/reasoning: p95 frame interval at most `25 ms`, max interval at
  most `100 ms`, and at most `3` long tasks
- renderer task time: commentary at most `1500 ms`, reasoning at most `900 ms`

`npm run audit:evidence` writes `.build/audit-evidence.json` with architecture, security, preview-mode, visual-source and performance source checks.

`npm run scale:check` writes `.build/scale-report.json` after creating a temporary project with 1000 AI sessions, 10,000 events and a 1 MiB tool output, then verifying session listing, search and long-event reassembly.

`npm run stability:soak` writes `.build/stability-soak-report.json` after three
local cycles of compiled Session/Run persistence, concurrent append/reload,
1000 synthetic Manifest validations and bounded Agent/Browser contract checks.
The Browser track is contract-only; it does not establish live Provider/Chrome
or packaged platform performance.

`npm run visual:snapshot` writes `.build/visual-snapshot-report.json` and screenshots for the major pages across desktop viewport sizes. It fails on blank pages, wrong active routes or global horizontal overflow.

## Manual Measurement Matrix

Record each run with the packaged Windows portable build:

| Case | Dataset | Expected result | Evidence |
| --- | --- | --- | --- |
| First launch | normal project | Shell visible within 2s after Electron window appears | screenshot or note |
| Open inbox | 200+ content files | list usable, scroll smooth | screenshot or note |
| Search content | mixed Chinese/English query | first result under 500ms perceived latency | screenshot or note |
| Open AI session | 10k+ semantic events | timeline opens without blocking input | screenshot or note |
| Session list | 1000 sessions | search/filter remains usable | screenshot or note |
| Large output | 1MB+ tool output chunks | collapsed tool card remains responsive | screenshot or note |

## Current Performance Budget

- Renderer JS chunk: max `500 KiB`.
- Markdown render cache: LRU cache keyed by content hash and exact text verification.
- Streaming Markdown: rich rendering is throttled to 96 ms and bounded to 8
  KiB while live; longer text remains readable as plain text and receives full
  Markdown/highlight rendering when the durable final message arrives.
- Chat history: at most 300 recent events are rendered initially, complete runs
  are never split, and closed completed process bodies unmount after exit.
- Route loading: major feature pages are lazy-loaded.

## Streaming Performance Result (2026-08-28)

Linux Electron, 1000-event fixture with the 497-tool completed history expanded:

| Phase | Before | After |
| --- | --- | --- |
| Commentary | p95 150 ms; 80 long tasks; task 9094 ms | p95 16.7-16.8 ms; 0-1 long tasks; task 575-756 ms |
| Reasoning | p95 50 ms; 3 long tasks; task 1722 ms | p95 16.7-16.8 ms; 0 long tasks; task 387-471 ms |
| Collapsed history | 14,807 DOM nodes; 497 tool rows | 771 DOM nodes; 0 tool rows |

The benchmark keeps the old process expanded during streaming so the render
isolation result does not depend on hiding the historical DOM. The collapsed
measurement separately verifies the normal history lifecycle.

## Performance Audit Results (2026-07-02)

All identified code-level items are implemented. The remaining work is packaged-Windows measurement in the manual matrix above.

### Baseline

- ✔️ Provider probing is off the send path: `detect()` is a cache read; async refresh runs at worker startup, window focus, and settings open.
- ✔️ Rollout reads incrementally parse appended bytes and cache the reconstructed conversation.
- ✔️ Send uses optimistic local session/run/event state and hydrates history in the background.
- ✔️ `findRepoRoot()` and content-date/index reads use fingerprinted caches.
- ✔️ Content saves refresh one date instead of rebuilding the full content index.

### High-priority results

1. ✔️ Streaming text moved from `AiController` to a dedicated `useSyncExternalStore` store. Only the active process row, its zero-DOM auto-pin effect, and inline AI subscribe to 24 ms updates; the Chat shell, composer, and completed history stay outside transient commits.
2. ✔️ `findRepoRoot()` caches by settings/environment/cwd fingerprint, and loop callers hoist root lookup.
3. ✔️ Content dates and parsed index data cache by filesystem fingerprint. A full cross-day inverted index remains measurement-gated.
4. ✔️ `app:write-content` 经 `ProductService.writeContent()` 只刷新所属日期索引（内部 `refreshContentDate`）。
5. ✔️ Skill logs stay live in memory and persist on a 250 ms window; terminal status flushes immediately. The retained tail remains bounded to 500 entries / 512 KiB.
6. ✔️ Rollout reconstruction is reused until appended or rewritten lines invalidate it.

### Medium-priority results

| # | Result |
| --- | --- |
| 7 | ✔️ Chat timeline selection, grouping, answered-step folding, and tool-state derivation are memoized. |
| 8 | ✔️ Parsed content index is cached by mtime, and each missing entry stat is performed once. |
| 9 | ✔️ Search text updates in memory during a run and writes one consolidated `search-index.json` at the turn boundary. |
| 10 | ✔️ Rollout event lines use a 50 ms per-session buffer; boundaries/readers flush pending data, and rollout directories are memoized. |
| 11 | ✔️ Creative project scans cache by repo/stage fingerprint and invalidate on project manifest/lifecycle writes. |
| 12 | ✔️ Inbox uses a 100-item page plus `getInboxFacets`; filter changes are coalesced and stale requests cannot overwrite newer results. |
| 13 | ✔️ Dashboard content/source caches invalidate independently; stdout does not invalidate either, while terminal skill status refreshes content once. |
| 14 | ✔️ `send` reads contexts through a current ref and no longer depends on the full draft-context map. |
| 15 | ✔️ Tool output and usage skip risk scans; other payloads are traversed only up to 64 KiB without full-payload `JSON.stringify`. |

### Low-priority results

- ✔️ Chat scroll handling is stable and suppresses no-op `nearBottom` updates.
- ✔️ Inbox rows are memoized with stable selection/context-menu callbacks.
- ✔️ TodayStream filtering, sorting, and section grouping are memoized.
- ✔️ App navigation uses a stable callback.
- ✔️ Project manifest formatting runs only when the manifest changes.
- ✔️ Historical topic Markdown caches by file `mtime + size`.
- ✔️ Creative analytics reuse project manifest fields and one cached release-log read per project.
- ✔️ Patch parsing and SHA-256 fingerprints share a bounded 4 MiB LRU.
- ✔️ Rollout payload serialization reuses immutable object results through a `WeakMap`.

### Verification run

- `npm test`: build, 1,592 Vitest tests, and integration smoke passed.
- `npm run perf:check`: 24 renderer chunks; largest 455.0 KiB; entry 286.3 KiB.
- `npm run audit:evidence`: 26 checks passed.
- `npm run scale:check`: 1000 sessions, 10,000 events, and 1 MiB output passed.
- `npm run stability:soak`: 3 local cycles passed; each cycle validates 100
  sessions, 1000 long-run events, 100 Broker Runs and 1000 Agent/Browser
  contract cycles.
- `npm run visual:snapshot`: 60 screenshots passed with no audit failures.

### Remaining measurement

- Run the packaged Windows portable build through every row in the manual matrix and attach timing/screenshots.
- Add a cross-day inverted index only if profiling still identifies per-day `getContent` scans as a meaningful search bottleneck.
