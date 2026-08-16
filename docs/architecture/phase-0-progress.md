# Refactor implementation progress

Tracking document for `desktop-app-complete-refactor-plan.md`. Updated as
each phase's deliverables land. The plan is ~150–240 person-days across 13
phases; this file records concrete evidence of completion per phase.

## Baseline (preserved throughout)

- `npm run typecheck` — **green** (verified after each change).
- Full vitest baseline is tracked separately: the latest single-worker run had
  **151 passed files / 1,592 passed tests**, one skipped live Browser E2E.
- `npm run lint:reporoot`, `npm run lint:manifests`, and `npm run build` —
  **green** after the Phase 5 execution/workflow, Automation, and Phase 6
  static-manifest changes.
- Batch A/B Python overlay tests (`scripts/test_batch_a_skill_overlays.py`,
  `scripts/test_batch_b_skill_overlays.py`) — **green** (6 + 6 tests).
- No `mymind`/user content is modified by the refactor or its tests.

## Phase 0 — Architecture & boundary freeze — ✅ COMPLETE

Current verification baseline:

- `npm run verify` — **green**: build/typecheck, structure, performance,
  evidence (26/26), scale, visual matrix (60 screenshots), package safety and
  motion contract all pass. Provider E2E remains explicitly
  `manual-required` for 28 real-account/environment cells.
- Single-worker full Vitest — the latest run had 151 passed files / 1,592 passed
  tests, with one opt-in Browser live E2E skipped by default. The run used
  Vitest retry=2 because two unrelated Renderer stream/layout tests are
  timing-sensitive under the full-suite load; both pass in isolation and the
  final retried run was green.

Plan §26 "首批工程交付物" (first engineering deliverables), all landed:

| # | Deliverable | Path | Status |
|---|---|---|---|
| 1 | ADR-001 path boundaries | `docs/adr/ADR-001-path-boundaries.md` | ✅ |
| 2 | ADR-002 mymind layout contract | `docs/adr/ADR-002-mymind-layout-contract.md` | ✅ |
| 3 | ADR-003 skill manifest v1 | `docs/adr/ADR-003-skill-manifest-v1.md` | ✅ |
| 4 | ADR-004 skill trust model | `docs/adr/ADR-004-skill-trust-model.md` | ✅ |
| 5 | ADR-005 runtime targets | `docs/adr/ADR-005-runtime-targets.md` | ✅ |
| 6 | threat model | `docs/architecture/threat-model.md` | ✅ |
| 7 | data migration spec | `docs/architecture/data-migration.md` | ✅ |
| 8 | skill-manifest-schema.ts | `shared/skill-manifest-schema.ts` | ✅ |
| 9 | app-paths-service.ts | `electron/paths/app-paths-service.ts` | ✅ |
| 10 | mymind-path-resolver.ts | `electron/paths/mymind-path-resolver.ts` | ✅ |
| 11 | anonymous mymind fixture | `electron/paths/mymind-fixture.ts` | ✅ |
| 12 | 16-skill compatibility matrix | `shared/skill-compatibility-matrix.ts` | ✅ |
| 13 | malicious skill package fixtures | `electron/paths/malicious-skill-fixtures.ts` | ✅ |
| 14 | clean-machine smoke fixture | `electron/paths/clean-machine-smoke.ts` | ✅ |
| 15 | unit/contract tests | 6 new `*.test.ts` files, **95 new tests** | ✅ |

Additional supporting files:
- `shared/mymind-layout-v1.ts` — machine-readable frozen layout.
- `docs/adr/README.md` — ADR index.
- `docs/fixtures/skill-manifest.example.yaml` — manifest example.

Phase 0 gates (plan §22 Phase 0 Gate) — **met**:
- ✅ Single `mymindRoot` + immutable structure reviewed (ADR-001, ADR-002).
- ✅ No open "do UI first, decide paths/security later" item (ADR-003…009 freeze
  manifest, trust, runtime, secrets, provider, release).

## Phase 1 — AppPaths, Mymind & state decoupling — 🟡 IN PROGRESS

Landed in the current implementation:

- `AppPathsService` is used for app-private directory creation and settings
  now writes to `userData/settings/settings.json`; the old flat settings path
  is read-only compatibility input.
- Settings v2 resolves/canonicalises an actual `mymindRoot`, keeps an optional
  independent `workspaceRoot`, performs userData path-conflict checks, and
  derives legacy `repoRoot` settings without moving content.
- `ProductService`, `ContentIndexStore`, `SourceRegistry`, content helpers and
  creative path reporting use the selected content root; app-managed state for
  Product services is keyed below `userData/state/<root-id>`.
- `MymindPathResolver` is now used by the content write path and rejects
  traversal, escaping symlinks and unknown top-level writes.
- `MymindFileSearch` supports a direct-root mode; the old repo-shaped
  constructor remains only as a compatibility path.
- `MymindLocationService` provides root health, preserved/unknown entry
  observations, conflict checks and generation-pinned snapshots; root IPC
  exposes health and snapshot data.
- `legacy-state-migration.ts` provides a read-only preflight plus a strict
  two-phase staging/commit migration for legacy `<repoRoot>/.cctools` into
  `userData/state/<root-id>/.cctools`. It refuses non-empty targets instead of
  merging/overwriting, keeps the source untouched, recovers a matching pending
  transaction after interruption, and is invoked before ProductService
  initialisation.
- AI session, runtime-worktree, temporary-image and Skill source-setting state
  now accepts a root-scoped app-private state parent; Main passes
  `userData/state/<root-id>` to the worker. Creative topic/manual-topic reads
  retain the legacy file as a read-only compatibility fallback and all writes
  target the migrated app-private file once the v2 binding is active.
- Creative private-state writes before the first valid root binding now use an
  app-private `userData/state/<workspace-root-id>` bucket (or a neutral
  `workspace` bucket when no workspace exists); legacy `<repo>/.cctools` is
  never recreated by a new write and is read only during migration fallback.
- Legacy browser evidence now defaults to the explicit, user-owned workspace
  output `assets/browser-evidence`; the old implicit
  `.cctools/browser-evidence` setting is migrated once. CLI-hosted Agent Skills
  do not receive a Broker Export Location Binding or an Artifact collection
  guarantee; any browser evidence location must be explicit in the selected
  Claude Code/Codex session and must never fall back to the installed package
  tree.
- Root switching is guarded at the Main IPC boundary by a worker-reported
  active-task count covering queued/provider/manual-Skill work.
- Main/Bootstrap no longer requires `.claude/skills` for content readiness;
  workspace/AI readiness is separate. Settings exposes independent mymind and
  workspace actions.
- `getMymindRoot` now reports a path-free legacy-state migration status;
  `skipped` markers are idempotent, while pending/invalid markers are visible
  in Diagnostics with a retry-safe explanation.
- Root directory selection is now a read-only Main dry-run: the picker returns
  a candidate, `previewMymindRoot` checks canonicalisation, path conflicts,
  access and active-run state without writing settings/content, and the UI
  commits only after explicit confirmation. IPC, settings, Onboarding,
  Diagnostics and Settings tests cover the preview/commit boundary.
- `scripts/audit-no-reporoot.js` is a build lint gate and currently passes.
- `AppStateBackupService` now exports/imports a versioned, SHA-256-checked ZIP
  for `settings/`, `state/`, `automation/` and Run metadata. It excludes
  credentials/browser tokens, Skill and Runtime bytes, caches/logs, temporary
  AI/work directories and `mymind`; restore stages through `userData/staging`,
  uses a marker plus rollback snapshot, and recovers an interrupted commit at
  the next app startup before the renderer is exposed.
- Diagnostics exposes the Main-dialog backup/restore actions. IPC refuses the
  operation while a Run is active and restarts the AI Worker after restore.
  `electron/backup/app-state-backup.test.ts` covers round-trip exclusion,
  tamper rejection, symlink rejection and interrupted-commit recovery.
- User-initiated mymind relocation is now a separate Diagnostics action from
  root binding and legacy settings migration. Its read-only preview reports
  canonical source/target, counts, bytes and a tree digest; commit requires a
  strictly empty target, preserves the source, verifies the copied tree, and
  binds the new root only after the copy succeeds. Sibling staging/backup
  markers support crash recovery and refuse non-matching targets. The
  relocation service, IPC boundary and Diagnostics confirmation flow are
  covered by 4 service, 1 IPC and 1 Renderer regression tests.
- Non-Electron AppPaths callers now fall back to a system temporary
  `cctools-desktop-userdata` directory instead of creating `.cctools-userdata`
  inside the source checkout; packaged Electron continues to use its native
  `app.getPath("userData")` location.

Remaining Phase 1 work:

- Complete Windows/WSL canonical-path fixtures and packaged clean-machine
  bootstrap coverage.
- Packaged Windows/macOS relocation drills and large-tree interruption
  evidence remain external; the local copy-only contract is complete and
  remains separate from legacy settings migration.

## Phase 2 — SkillPackageService — 🟡 LOCAL/GIT SOURCES COMPLETE, ACTIVE + READY

The first static package boundary is now implemented in
`electron/skills/skill-package-service.ts`:

- local directory Inspect with strict `cctools.skill.yaml` parsing;
- safe ZIP Inspect/Install with central-directory validation, path traversal,
  duplicate-entry, encrypted/special-file, size and compression-ratio guards;
- Legacy `SKILL.md` classification as inspection-only, without defaulting to
  `uv`;
- package path, symlink, hardlink and special-file checks;
- exclusion of `.env`, virtualenv, cache, logs, browser state, credentials,
  `.cctools` and generated `mymind` content;
- stable package digest and `sourceModified` detection;
- clean copy into `userData/skills/<publisher>/<id>/<version>-<digest>`;
- `InstalledSkillRepository` owns an atomic registry and keeps package bytes
  separate from metadata;
- batch inspection/migration scans the current workspace `.claude/skills`,
  imports only valid Manifest packages, and leaves Legacy `SKILL.md` as
  inspection-only;
- Main IPC exposes inspect/migrate/list-installed contracts, and Settings
  provides a basic static-check/import surface that explicitly shows
  `quarantine`, `installed-not-ready`, `unsigned`, and inspection-only state;
- new installs/updates remain `quarantined` / `installed-not-ready`, with
  readiness-gated `active`/`previous` transitions owned by one atomic registry;
- `InstalledSkillRepository` validates the registry fail-closed, enforces one
  active/previous pointer per Skill, and atomically swaps them for activate and
  rollback; direct active promotion is rejected;
- uninstall renames a non-active package into staging before removing its
  registry record, and refuses ambiguous key-only deletion when multiple
  digests exist;
- Main IPC exposes install/update/rollback/uninstall operations and Settings
  shows the installed-version state with update, rollback and candidate
  uninstall actions. These operations do not execute package code.
- `shared/skill-package-sources.ts` now defines the finite source union for
  local directory, ZIP and HTTPS Git. Signed Catalog is intentionally absent
  from the contract.
- `electron/skills/skill-source-service.ts` adds shallow, single-branch Git
  checkout into app staging with prompts, credential helpers, submodules and
  package execution disabled. The checkout is removed after every inspect,
  install or update, while the installed registry retains the source locator
  and optional ref.
- Skill Center now exposes a source picker for local directory/ZIP and Git
  HTTPS URLs. Every candidate goes through the same static Manifest, digest,
  exclusion and quarantine boundary before it can be imported.

This intentionally does not support Signed Catalog sources, runtime-pack
dependency preparation, signatures for Skill packages, or direct package
execution from the source picker. A successful explicit import is promoted to
active + ready; RuntimeManager and ExecutionBroker still own dependency
preparation and the actual execution boundary. The current tests cover the
static package boundary, quarantine behavior, active/previous transaction
behavior, Git source safety, IPC contracts, and the Skill Center surface.

Remaining Phase 2 work:

- local interruption coverage now simulates a registry swap failure and verifies
  the active record/package remain intact while staging is cleaned; packaged
  crash drills and Windows/WSL path variants remain external;
- RuntimeManager-owned dependency preparation and active + ready execution
  resolution (Phase 4/5).

## Phase 3 — Config, Provider, CredentialVault — 🟡 FOUNDATION IN PROGRESS

The first configuration and secret boundary is now implemented:

- `shared/provider-profiles.ts` defines versioned Credential metadata/scope,
  Provider Profile, protocol, proxy/TLS policy and safe Base URL schemas;
  Base URLs cannot contain credentials/query tokens, and HTTP is limited to
  loopback development endpoints.
- `electron/security/credential-vault.ts` is Main-process-only storage backed
  by the platform `safeStorage` adapter. IPC can set/replace/delete/revoke/test
  metadata, but there is no plaintext-returning renderer API; execution code
  must use the internal scope-checked `withSecret` boundary.
- `electron/security/provider-profile-repository.ts` stores only secret-free
  Provider Profiles under app-private settings, resets connectivity state on
  config changes, and fails closed on corrupt registry data.
- `electron/security/log-redactor.ts` redacts known secrets and common token,
  password and private-key patterns in diagnostic strings and nested payloads;
  Main IPC error normalization uses it before returning error details.
- `electron/security/env-file-analyzer.ts` provides a read-only, workspace-
  bounded `.env` inspection path that returns variable names, line numbers,
  classifications and lengths only; values are never returned or migrated
  implicitly.
- Main, IPC registry, preload bridge, browser preview API and the Provider
  settings surface now expose secure-storage status and counts of credential
  metadata / Provider Profiles without displaying secret values. The settings
  page now has forms for creating Credential metadata and Provider Profiles;
  the Secret input is cleared after save and existing values are never loaded.
- `electron/security/provider-connectivity-service.ts` provides Main-side
  protocol adapters for OpenAI Chat/Responses, Anthropic Messages and a
  provider-native reachability probe. It injects a Credential only inside the
  Main vault callback, applies timeout/retry/TLS policy, discards response
  bodies, persists only `success`/`failed`/timestamp/diagnostic state, and is
  exposed as the Settings `testProviderProfile` IPC method.
- The AI worker now has a Main-mediated, exact-scope credential request bridge;
  plaintext is returned only to the worker-side execution path after the Run
  has passed execution-plan validation and is never exposed through renderer
  IPC.
- Installed process Manifests now validate `providerBindings` against declared
  `provider-profile` config fields, resolve safe Profile metadata in the
  worker, support `{{ providers.<binding>.* }}` templates and
  `secretRef: provider:<binding>`; the resulting Credential ID is tracked
  only in the in-memory execution plan.
- Credential set/replace/revoke/delete IPC mutations notify the worker. The
  Broker blocks revoked Credentials before injection, cancels queued and
  active Broker Runs using them, and permits a replacement only after the
  replacement transition restores the binding.
- Tests cover Base URL and scope contracts, ciphertext-only storage, file
  permissions, corrupt/unavailable storage, scope mismatch, Provider Profile
  persistence, redaction and IPC validation.

Phase 3 follow-up now landed locally:

- Provider-specific non-secret fields are schema-checked: OpenAI
  organization/project/API version and Anthropic API version are only accepted
  by the matching protocol; unsupported fields and secret-like keys fail
  closed.
- Proxy URL validation rejects credentials/query fragments and the explicit
  proxy policy fails closed until a usable endpoint is configured. Main-side
  Process Provider connectivity and Broker-injected Process requests apply
  HTTP/HTTPS proxy routing and the selected TLS policy. Claude Code and Codex
  use their own CLI configuration instead of this Provider Profile path.
- `credential-file` bindings materialize only in the active Run's private
  `work/credentials` directory, with restrictive file permissions and
  cleanup before Artifact collection and on process exit. The original secret
  remains available only to the redactor; it is not persisted in the package.
- Credential and Provider Profile destructive actions now require explicit
  renderer confirmation.
- `electron/ai/worker-environment.ts` now gives the Main-owned AI Worker a
  platform baseline allowlist instead of copying the full parent
  `process.env`; App paths and browser settings are explicit overrides, and
  the Browser Tool/evidence bridge reuse the same filter. Unit coverage proves
  unrelated provider keys, browser tokens and dangerous loader variables do
  not cross unless explicitly selected by Main.

Remaining Phase 3 work:

- Packaged Windows/macOS credential-file and real-provider verification;
  local unit/contract coverage is green, but those external environments are
  not available in this workspace.

## Phase 4 — Managed Runtime Core — 🟡 FOUNDATION IN PROGRESS

The first supply-chain boundary is now implemented without enabling automatic
catalog updates or implicit execution:

- `shared/runtime-targets.ts` freezes the ADR-005 target/pack matrix,
  distinguishes Windows from WSL, validates pack metadata and rejects path-
  bearing filenames;
- `RuntimePackVerifier` requires an injected trusted Ed25519 root, checks
  metadata expiry, exact byte size, SHA-256, signature and anti-downgrade
  version policy; missing roots fail closed;
- `RuntimePackRepository` stages verified bytes into app-private versioned
  slots and atomically tracks candidate/active/previous records with rollback
  and non-active removal;
- `RuntimePackService` remains a Main-side verified-pack boundary with no
  system-PATH fallback, dependency sync or first-run execution; it now reports
  renderer-safe readiness/integrity state and can replace a verified
  same-digest slot through a recoverable repair swap.
- `RuntimePackDownloadService` supports only an explicit user-selected signed
  Manifest with an HTTPS `originUrl`. It persists app-private partial files,
  supports pause/resume/delete and restart recovery, and sends completed bytes
  back through `RuntimePackService.install()`; it does not query a Catalog or
  perform automatic updates. Settings previews download size, install size,
  license and signed conditions before the user starts.
- `runtime/runtime-pack-trust.ts` loads a packaged
  `runtime-trust-roots.json` resource, validates its schema and rejects every
  non-Ed25519 public key. Missing development resources resolve to an empty
  trust map so RuntimePackVerifier continues to fail closed; no user- or
  workspace-supplied key is implicitly trusted. The official release key
  material and electron-builder resource packaging are still release-channel
  work.
- Runtime Pack list/readiness/import/repair/activate/rollback/remove are now
  exposed through typed IPC without returning app-private package paths.
  Offline import selects a signed Manifest and its declared sibling payload in
  Main; Settings exposes readiness, activation, rollback, repair and removal.
  Development builds intentionally have no embedded publisher root, so signed
  install/repair remains fail-closed until the release trust-root chain is
  shipped.
- `RuntimeManager` now resolves only an active, verified managed pack, checks
  the current target and pack digest, safely stages ZIP packs inside the
  app-private runtime area, resolves an absolute executable, and prepares a
  per-Skill frozen Python environment with `uv --locked` and downloads
  disabled. Missing, unsupported or tampered packs fail closed.
- Runtime Pack leases are app-private and cross-process: the Broker acquires
  one for the preparing/running interval, stale leases are removed by dead-PID
  detection, and Main rejects active switching, repair, rollback or removal
  while the relevant Pack is in use. Readiness surfaces this as `inUse`.
- Runtime Pack GC is now explicit and conservative: the Settings Runtime
  surface can remove only `candidate` records with no live lease; `active`,
  `previous` and unknown files are retained. Invalid/active lease state fails
  closed instead of deleting anything. Runtime operation staging roots carry a
  PID/kind marker; GC removes only valid markers owned by dead processes and
  retains unmarked, malformed, mismatched, unknown and recovery staging data.
- `runtime-manager.test.ts` now performs a real Linux Python Pack preparation:
  it copies Python and `uv` into a signed ZIP Pack, extracts them into the
  managed area, runs real `uv venv` + `uv sync --locked`, and verifies the
  environment marker and Pack-backed interpreter. It also locks the
  post-extraction executable-bit and staging-`HOME` behavior. This is a
  RuntimeManager contract test built from the host binaries, not yet a
  packaged clean-machine test with no host libraries.
- The same test file also runs a hermetic Pack fixture through the default
  `execFile` path with an empty host `PATH`; the fixture records `venv` and
  `sync` invocations from the Pack's own executable. `npm run verify` includes
  this as `runtime:contract`. It is a development contract, not formal Linux
  support or packaged Windows/macOS evidence.

Remaining Phase 4 work:

- keep Runtime Pack trust-root fixtures and offline digest/signature verification
  covered; **signed App packaging and Catalog metadata are not planned**;
- add target-specific download descriptors and non-ZIP pack formats;
- add clean-machine Python dependency installation, cross-platform packaged E2E
  and packaged trust-root verification.

## Phase 5 — ExecutionBroker & Workflow — 🟡 FOUNDATION IN PROGRESS

The first single-process execution chain is now implemented and exercised:

- `shared/execution-contracts.ts` defines the strict Run request, state,
  terminal-state, event and Artifact contracts; durable request metadata keeps
  input keys/provider binding IDs but never stores input values.
- `electron/execution/run-store.ts` persists `run.json` and ordered
  `events.jsonl` below app-private `userData/runs`, enforces the state machine,
  makes terminal transitions idempotent, and marks in-flight Runs failed after
  application restart.
- `electron/execution/process-host.ts` owns absolute-executable, `shell:false`
  child startup, bounded stdout/stderr rings, known-secret/common-pattern
  redaction, timeout, abort and POSIX process-group best-effort cleanup.
- `electron/execution/artifact-collector.ts` scans only declared output
  prefixes, collects logical Artifacts with hashes, and rejects
  symlink/traversal collection. It does not perform whole-tree before/after
  auditing or claim to detect undeclared host-process writes.
- `electron/execution/execution-broker.ts` implements inspect → prepare →
  queue → run → terminal transitions, global concurrency and
  mutexes, cancellation, timeout, same-Run retry budgets, durable output
  events and best-effort Artifact registration. Artifact indexing failures are
  reported without overriding the process exit outcome. Retry increments a persisted attempt counter,
  never creates a second terminal Run, and never retries user cancellation.
- `electron/skills/installed-skill-execution-resolver.ts` now binds generic
  Runs to an active, ready InstalledSkill digest, resolves a
  verified RuntimeManager plan, validates capabilities/paths, and supports
  exact-scope secret references plus explicit External ExportLocation
  bindings.
- `electron/skills/installed-skill-execution-resolver.test.ts` now has a
  real formal-package execution gate: it installs a signed Runtime Pack
  fixture, promotes it through RuntimePackService, installs/activates a
  formal package, then starts a real Node child through
  RuntimeManager + ExecutionBroker and verifies declared Artifact persistence
  and Runtime Pack lease cleanup. This is a generic chain gate; it does not
  yet certify every production Batch A/B Python package.
- The resolver suite now also has a Linux managed-runtime clean-machine
  contract: a real `node-22` executable is placed inside a signed ZIP Pack,
  extracted under app-private runtime state, and used by a real installed Skill
  through RuntimeManager + ExecutionBroker without `PATH` or a system-runtime
  fallback. This proves the absolute-executable/Pack boundary on Linux; it is
  not a substitute for packaged Windows/macOS E2E or a clean-machine Python
  dependency-install test.
- The same gate now runs the real Batch A `skill-run-reporter` package from
  `.claude/skills`, with its installed Python entrypoint, bound mymind/run
  roots and report output. The test uses a signed managed-pack fixture plus
  an injected interpreter path; it is a package/IPC execution gate, not yet a
  clean-machine packaged Python Runtime verification.
- `SkillToolRegistry` and the worker/Main IPC path expose generic Run
  submission, listing, event replay, cancellation and approval. The Run store
  rotates bounded event logs, persists runtime/PID metadata and reports live
  orphan processes after restart.
- `WorkflowEngine` validates Workflow DAGs, submits ready steps only through
  the Broker, persists step state, supports per-Step retry/backoff without
  rerunning successful predecessors, handles cancellation and child
  submission failure, and marks in-flight persisted Workflows as interrupted
  after an application restart rather than resubmitting with unknown inputs.
  `resumeWorkflowRun` now requires the current root generation, an unchanged
  active Workflow definition/version/fingerprint and explicitly re-entered
  non-Secret JSON inputs; interrupted running steps are reset to pending
  before Broker submission. Completed child Run Artifact metadata is snapshotted
  into each Step, and dependent `with` values can reference
  `{{ steps.<stepId>.artifacts.<artifactId>.<field> }}` for logical hand-off
  fields without exposing physical paths or Secret values to the Workflow record.
  Workflow Start/Resume and Automation pass only non-Secret Provider Profile
  references to child Runs; the child Broker still resolves the actual
  Credential binding at execution time.
- `ExportLocationService` persists canonical, user-selected directory
  bindings, rejects app-private/content roots, revalidates paths on use and
  exposes list/select/revoke IPC without allowing renderer-supplied paths.
  Manifest-declared IDs are stable across App restarts; the Main picker can
  create a missing declared ID or Relink an existing/revoked ID. Listing
  re-audits the realpath and reports `available` / `needs-relink` / `revoked`,
  while the Skill Run form exposes Relink/Revoke and new Runs remain blocked
  until the binding is available again.
- `SkillToolRegistry` manual/source calls now use the same installed-package
  resolver as renderer, Workflow and Automation Runs. The old event shape is
  retained at the controller boundary, while package digest/version, Runtime,
  Artifact declarations, root generation and readiness all come from the
  active Installed Skill. Source trigger context is type/length checked by the
  resolver before entering the Broker's minimal environment.
- When the Installed Resolver is available, AI slash/tool definitions are
  derived from active, ready formal Manifests. Legacy
  `SKILL.md` discovery remains available for migration/inspection but is not
  exposed as a runnable definition; Renderer receives a logical installed
  package identifier and `managed-runtime`, never the absolute executable.
- Renderer no longer exposes the generic manual `startSkillRun` boundary.
  Internal source, Automation and Workflow submissions remain behind
  active/ready package checks; no Broker legacy opt-in remains.
- `CCTOOLS_MYMIND_ROOT` and `CCTOOLS_ROOT_GENERATION` are pinned into the AI
  worker bootstrap so root switching restarts the Broker with a new snapshot.
- Automation now has a versioned shared Rule/Run/Schedule contract, an
  app-private atomic registry with one-time default seeding, durable
  daily/interval/cron/app-start/run-completed scheduling, missed-run and
  skip/queue/replace policies, Rule-level retry, Blocked state, and exact
  active-version policy checks. Skill completion events come from the Broker;
  Workflow completion events come from WorkflowEngine, so the old Main-owned
  hardcoded source-success coordinator is no longer in the production path.
- The Automation IPC chain is complete from worker/Main through the typed
  registry/preload surface and renderer. The page reads persisted Rules,
  schedules and history, provides a target selector, Schedule Builder, JSON
  input editor, persistent enable/disable, Run Now/stop/retry/delete, child
  Run event replay and declared Artifact metadata.
- §15 Run lifecycle is now exposed through one typed IPC surface: aggregate
  Artifact listing, current-process Skill Run retry, Workflow failed-Step retry,
  terminal-history deletion and an all-Runs renderer view. Deleting history
  removes only app-private Run metadata/events; collected user content is not
  deleted. Retry uses in-memory inputs only and fails closed after restart when
  the original values are unavailable; Workflow resume has a separate
  re-entry surface and never persists the original input values.
- Runs now renders a warning when restart recovery records a possible orphan PID;
  it deliberately offers diagnosis guidance rather than an automatic kill.

Evidence: the execution unit tests cover the Broker, ProcessHost, RunStore,
Workflow, export binding and formal resolver paths; the production
Broker-backed SkillRegistry fixture and formal InstalledSkill resolver gate
cover real subprocess execution and declared Artifact persistence. Targeted
Run/installed-boundary tests are green; typecheck, renderer build,
`audit-no-reporoot`, and `lint:manifests` are green. The latest full vitest
run is recorded in the Baseline section; affected tests pass in isolation.

Remaining Phase 5 work:

- complete clean-machine/process escape drills and packaged runtime repair
  verification.

## Phase 6 — 16 skill migration — 🟡 STATIC MANIFESTS COMPLETE, EXECUTION GATED

**§17.1 acceptance gate MET (static):** all 16 skills now have formal
`cctools.skill.yaml` manifests validating against the frozen
`SkillManifestSchema`. The classification is exactly **12 process / 1 workflow /
3 agent** (verified by `npm run lint:manifests` →
`scripts/validate-all-skill-manifests.mjs`, wired into the `build` chain). The
real-workspace migration test (`SkillPackageService > migrates only formal ...`)
quarantines all 16 as `installed-not-ready`; `_shared` (not a runnable skill)
is not registered.

Batch A now has formal `cctools.skill.yaml` manifests and locked Python
project metadata for:

- `asset-collector`;
- `collect-interest-markers`;
- `daily-writing-orchestrator`;
- `skill-run-reporter`;
- `reddit-fetcher`.

The real workspace migration test now recognizes all sixteen Batch A/B/C packages
as formal packages and quarantines them as `installed-not-ready`. This is a static
package migration gate; Runtime Pack readiness, active promotion, host approval
and live execution are still intentionally not claimed.

Batch A's process entrypoints now use the final path overlay contract:
`CCTOOLS_MYMIND_ROOT`/`MYMIND_ROOT` is the only content-root binding,
`CCTOOLS_SKILL_DATA_DIR` is reserved for Skill-owned cache/state, and
`CCTOOLS_RUN_DIR` is available for app-private Run integration. The Batch A
scripts no longer walk `__file__` ancestors or search for a cctools repository;
relative content paths are checked below the bound root, writing-package
metadata stays root-relative, and Reddit cache is separated from mymind
output. `desktop-app/scripts/test_batch_a_skill_overlays.py` runs six
cross-entry temporary-root tests from an unrelated working directory.

Batch B now has formal manifests and lockfiles for:

- `daily-article-summarizer`;
- `daily-topic-selector`;
- `knowledge-wiki-compiler`;
- `rss-article-saver`;
- `x-following-fetcher`.

Their content paths resolve only below the Broker-bound mymind root. Summary,
Wiki, RSS and X caches/state resolve below `CCTOOLS_SKILL_DATA_DIR`; Wiki no
longer reads the daily summarizer's `.env`; the daily summarizer no longer
imports the sibling topic selector. The four AI packages vendor their client
adapter inside the Skill package instead of importing workspace `_shared`. X's
package-local curl credentials are excluded from installation in favor of a
Broker-injected structured `X_FETCHER_CREDENTIAL_JSON` binding; its Skill uses
Python HTTP and no longer shells out to curl. The installed resolver gate now
covers live Provider Profile connectivity for the RSS → Summary → Topic chain
with a local OpenAI-compatible endpoint and scoped Credential injection.

Batch C now includes formal manifests for all six remaining skills:
`rss-to-summary-workflow`, `ai-media-topic-selector`, `creative-writing`,
`video-burnin-subtitles`, `video-download` (id for the `VideoDownload`
directory), and `agent-browser`. The Workflow references
the installed Batch B Skill IDs with `^1.0.0` ranges, submits those ranges to
the Broker, and executes fetch → summary → topic under one Workflow root
snapshot. The three Agent packages (`agent-browser`, `ai-media-topic-selector`,
`creative-writing`) are CLI-hosted packages: their canonical Manifests omit
Agent Provider Profile/Credential bindings, while their logical read/write
scopes remain instruction and audit metadata. The two media process skills
declare `media-core` (+ optional
`speech-whisper`/`cjk-subtitle-fonts`) packs, `video-burnin-subtitles` writes to
the existing `mymind/video/**` contract, and `video-download` uses an external
Export Location Binding (`videoExportDir`). The media entries now use a
cross-platform Python Process entrypoint: `video-burnin-subtitles` binds its
output to the Broker-provided `CCTOOLS_MYMIND_ROOT`, receives Provider Profile
configuration through the neutral `CCTOOLS_PROVIDER_*` namespace, and no
longer reads workspace `.env` or `_shared` by ancestor walk. `VideoDownload`
receives the canonical export path through the declared `exports.videoExportDir`
template and no longer derives output from `cwd` or the repository tree. The
installed resolver now resolves declared Export Location templates only from
validated bindings, and applies Manifest input defaults before resolving args
and Artifact paths. This remains a static package/contract migration gate; it
does not claim that Claude Code/Codex CLI, Runtime Packs or live Process
Provider credentials are available on this machine.

The Workflow package is now manifest-only: its former Python launcher and
`workflows.yaml` command table were removed, so the desktop Workflow Engine is
the only scheduler and the child Skill IDs/versions are declared once in
`cctools.skill.yaml`. `_shared` now has versioned `cctools-skill-shared` package
metadata plus a lockfile, remains without a Skill manifest, and is excluded
from the runnable Skill migration list. Production packages continue to carry
their own adapter rather than importing `_shared` through a workspace-relative
path.

Installed Skill integrity metadata keeps signature, review and update policy
independent. `SkillPackageService` audits both the app-private installed copy
and a local source before exposing records; a changed digest clears review
evidence and turns a previously valid signature into `invalid`. Static
inspection, exact digest checks and active + ready state remain required; no
publisher signing or Catalog is introduced by this local integrity gate.

New candidate versions also receive a deterministic Manifest capability diff in
Skill Center (added/removed mymind, network, browser and process capabilities).
Promotion requires a candidate to pass static inspection and Runtime
preparation before it becomes active + ready; Broker execution remains bound
to the complete digest plus capability fingerprint. This keeps the local
integrity path explicit without adding publisher signing or a Signed Catalog.

`desktop-app/scripts/test_batch_b_skill_overlays.py` covers the five Batch B
configuration/path overlays from an unrelated working directory.

Remaining Phase 6 work:

- all actual Batch A/B Python packages now have installed-root Broker smoke
  coverage. Batch A covers `skill-run-reporter`, `asset-collector`,
  `collect-interest-markers`, `daily-writing-orchestrator` and
  `reddit-fetcher`; Batch B covers the three-stage
  `reddit-fetcher` → `daily-article-summarizer` → `daily-topic-selector`
  chain plus local RSS→article, article→wiki and managed-credential
  HTTP→post Artifact gates for `rss-article-saver`,
  `knowledge-wiki-compiler` and `x-following-fetcher`. These tests install
  and activate the formal package, run through RuntimeManager +
  ExecutionBroker, and assert the declared output boundary. The simple
  package gates inject the host Python interpreter; RSS/Wiki use a test-only
  wrapper around each Skill's development venv. None of these gates replaces
  clean-machine packaged Runtime verification;
- promote those packages through a clean-machine packaged `python-core`
  Runtime Pack and retain per-package smoke inputs in the packaged matrix;
- managed Process Skill Broker runs use the Provider Profile bridge and fail closed when its
  Credential is absent; the standalone CLI-only provider fallback remains an
  explicit compatibility path outside managed runs, covered by the Batch B
  overlay contract test;
- keep the Batch B Process gates green while adding clean-machine packaged
  dependency installation and per-package smoke coverage. Installed Agent
  packages are covered at the package-to-Codex/Claude bridge contract; live
  Agent acceptance requires an authenticated external CLI and is not a
  Provider Profile or RuntimeManager E2E.

## Phase 7 — Full UI & basic Automation — 🟡 LOCAL UI FOUNDATION COMPLETE

Automation’s former hardcoded three-rule mockup has been replaced by the
durable Rule/Run API and a real Schedule Builder/History/Artifact surface.
Creative detail, Sources form/list, Runs history/Workflow resume and Runtime GC surfaces
are covered by renderer tests and the visual matrix; the current automated
visual matrix has 60 passing screenshots.
Runs now exposes safe open/reveal actions for logical Artifact locations;
external Export Location Artifacts keep only their binding reference in the
Renderer and therefore show the binding without leaking a physical path.
The local UI scope now also includes:

- a standalone Skill Center route with installed/workspace status, source and
  digest details, quarantine import, active + ready status, update/rollback and
  uninstall actions;
- a dynamic per-Process-Skill Run form driven by the Manifest input/config/artifact
  schema, Provider Profile and Export Location selectors, fixed root snapshot,
  Main-only validation boundary and no Secret/executable fields in Renderer;
- a diagnostics route with mymind health, environment, Skill Registry,
  Runtime Pack, recent Broker Run state, index rebuild, root selection and
  path-free migration status/diagnostic copy, plus portable app-state
  backup/restore with explicit secret/resource exclusions;
- a skippable first-start Onboarding route that does not create or reorganize
  user content and keeps workspace optional.

Remaining Phase 7 work is limited to any follow-up accessibility/visual polish
found by later packaged verification; the core local UI gates are covered by
renderer tests.

## Phase 8 — Migration drill, Windows/macOS release — 🟡 LOCAL DRILLS LANDED

> Scope decision: signed App/Windows/macOS release is **not planned**. Keep
> unsigned build, manual repair and migration drills only.

The local migration implementation now has read-only preflight, strict empty
target enforcement, atomic copy/commit markers, pending-transaction recovery,
preserves the legacy source, reuses both committed and skipped markers, and
surfaces pending/invalid state through Diagnostics. Packaged Windows/macOS
clean-machine, crash/repair and manual-upgrade evidence remains external.

## Phase 9 — Internal Agent Runtime — ⛔ REMOVED; SUPERSEDED BY ADR-010

> **Superseding decision (2026-08-10):** the app-owned provider/tool loop,
> Internal-Agent-only approvals and Browser tools, Agent Broker execution, and
> provider checkpoint/resume path described by the former Phase 9 have been
> removed. The previous implementation and test counts are historical only.

Installed `kind: agent` packages now run only from an AI console through the
selected Claude Code CLI or Codex CLI bridge. The bridge resolves an active,
ready, exact-digest package from the app-private SkillStore.
Codex receives the boundary-checked package `SKILL.md` through its app-server
bridge; Claude receives bounded package `SKILL.md`/`references` content
transiently with project-local Skill discovery disabled.

ExecutionBroker, manual Skill Run, Automation, Workflow, retry and removed
Internal Agent resume entry points fail closed for `kind: agent`. They do not
fall back to direct OpenAI/Anthropic HTTP requests and do not reinterpret an
Agent as a Process Skill. Consequently CLI Agent work does not inherit Broker
queue/mutex, timeout, retry, Artifact collection or checkpoint semantics.

Provider Profiles, CredentialVault, proxy/TLS policy and scoped secret
injection remain supported for managed Process Skills. Agent packages do not
use those bindings; authentication, model selection, provider session
continuation and native tool approvals belong to the selected CLI. Existing
historical Run checkpoint fields may be read for compatibility but must never
restart Agent work.

Claude Code, Codex and their tools run with the current OS user's privileges.
Manifest capability/path/Artifact declarations remain package instructions,
trust gates and audit metadata, not an OS sandbox. Real browser/authorized-tab
acceptance therefore remains external CLI/desktop evidence. Any future
CLI-backed Broker execution requires a separate design and ADR.

## Phase 10 — Runtime packs, full Scheduler, Linux — 🟡 Linux NOT PLANNED

> Native Linux release and the Linux/WSL support matrix are **not planned**.
> Runtime Pack/Scheduler abstractions and Linux development tests may remain.

## Phase 11 — Signed Catalog & three update chains — 🚫 NOT PLANNED

> Signed Skill/Runtime Catalog, Catalog trust-chain metadata and Catalog-driven
> App/Skill/Runtime automatic updates are **not planned**. Local/offline
> install, explicit signed-Manifest HTTPS download, digest verification, repair
> and rollback remain in scope.

## Phase 12 — Full stability & GA — 🟡 LOCAL GATES GREEN, EXTERNAL EVIDENCE PENDING

The complete `npm run verify` pipeline passes on the current code. The latest
single-worker full Vitest run completed 151 passed files / 1,592 passed tests, with 1 skipped live
Browser test; the integration smoke also passes after its scheduler source scan
was updated for the `scheduler-execution.ts` split. This does not claim GA. Remaining evidence requires packaged Windows/macOS clean-machine
runs, real Process Provider and CLI/Chrome-extension environments, packaged migration/crash-
recovery drills, long-running Scheduler/CLI-Agent/Browser soak and
support/recovery documentation. Signed release, formal Linux support and
Signed Catalog remain out of scope.

`npm run stability:soak` now runs inside `verify` and writes
`.build/stability-soak-report.json`: compiled Session/Run persistence survives
concurrent append and reload, 1000 synthetic Manifests validate, 100 Broker
Runs reach terminal states without persisting a Secret, and 1000 CLI
browser-evidence capture contracts retain their bounded screenshot/restore
guards. This is static bridge evidence, not a live Agent acceptance test. Live
Claude Code/Codex, Browser and packaged platform soak remain external.

`npm run recovery:drill` now runs as part of `verify` against the compiled
`.build` Main-process services. It covers legacy-state migration and pending
marker recovery, mymind relocation, portable app-state restore after a partial
commit, interrupted Run/orphan recovery, verified Runtime rollback, and a
child-process forced-termination/restart recovery against the compiled RunStore
(`SIGKILL` on POSIX and Node's forced process termination semantics on Windows);
the drill also checks that child stdout/stderr and the persisted recovery tree
contain no Secret. The staged Windows/macOS package flow additionally runs
`scripts/packaged-recovery-smoke.js` against the real packaged executable: it
force-terminates a startup, creates an interrupted App-state restore marker,
restarts the package and verifies the previous snapshot plus transaction
cleanup. These are supporting packaged recovery artifacts; Runtime Pack
force-quit/update and target-OS disaster-recovery runs remain external.

`npm run release:evidence` is now part of `npm run verify`. It emits a
CycloneDX 1.5 SBOM, a production dependency License report, and build
provenance under `.build/release-evidence/`; the current local build records
266 production components with zero unknown licenses and a SHA-256 build tree
digest. This is build evidence, not OS signing or a Catalog trust chain.

An unsigned Windows arm64 unpacked package was also produced on the current
host and scanned together with `.build` and the `.build` files inside its
ASAR: the current combined scan passed for 977 files; the platform-separated
Windows-local report passed for 643 files and emitted structured evidence.
Unsigned arm64 ZIP, Portable EXE
and NSIS Setup artifacts were produced; `.build/package-evidence-win-local.json`
records all three hashes and `targetValidation=passed`. The same Linux host
also produced an unsigned macOS arm64 `.app`/ZIP; its 591-file app scan and
1,073-file ZIP-container scan passed with no findings, while
`.build/package-evidence-mac-local.json` remains `targetValidation=manual-required`
because a DMG cannot be built without the macOS packaging environment.
The scanner requires a complete PEM payload for private-key matches so
dependency format validators do not become false positives. The assisted NSIS
installer, Windows/macOS GUI/clean-machine run and macOS DMG still require the
corresponding release environment; GUI/install, clean-machine and Provider
evidence remain pending, and this local ARM64 build is not formal Linux support
evidence.

The Windows/macOS staged packaging scripts now run the recursive real-container
scan before writing package evidence and pass
`--require-artifact-safety=true` to the evidence binder. The scanner reuses the
explicit `CCTOOLS_7ZZ` tool, an installed 7-Zip, the Windows installer vendor
tool or electron-builder's cached extractor; missing container inspection is
therefore a staged-package failure rather than an unrecorded manual step.
Its `--allow-missing-targets=true` diagnostic mode returns success only for a
partial report whose discovered containers all passed; the report remains
`manual-required` until the missing target is produced.

`npm run security:review` and `npm run clean-machine:report` now leave explicit
`manual-required` reports for the independent P0/P1 review and the 12-scenario
Windows/macOS matrix. Security strict mode requires an external/independent
reviewer, valid date, closed notes and deployment/diagnostic evidence keys for
the platform-sensitive findings; Clean-machine strict mode requires
machine-readable OS/build/package/hash/precondition/outcome/evidence fields,
matching target OS/package types and a concrete evidence path or URL. Their
strict modes intentionally fail on this Linux host until dated external
evidence is attached.
`npm run evidence:contract` runs temporary black-box pass/fail fixtures for
both gates, including external-audit placeholders and architecture mismatches;
it does not alter the repository's pending evidence rows. The Security Review
marker parser also now matches the documented reviewer/date/independence
markers, so a real independent review can complete the strict gate.
`npm run package:safety:contract` separately covers license-prose false
positives and app-owned `process.report` rejection.

`npm run release:readiness` aggregates these reports plus packaged smoke,
force-quit/recovery and Windows/macOS artifact evidence into one
`manual-required`/`ready` report. The current report has six pending gates:
macOS DMG/artifact completeness, packaged recovery, Provider E2E, independent
Security Review and the Windows/macOS Clean-machine matrix. Its strict mode
also verifies the Release evidence index bytes/SHA-256 values against the
actual SBOM, License and Provenance files, and cross-checks the internal
counts/details of the Provider, Security Review and Clean-machine reports; it
also recognizes staged Windows/macOS package evidence under `dist/` and
platform-specific artifact reports under `.build/` while keeping Linux
diagnostic `.build/*-local.json` reports as a separate path. It does not
authorize a GA claim and explicitly keeps signed release, formal Linux and
Signed Catalog out of scope.

The secret-bearing Worker now has closed base and explicit environment
allowlists; provider keys, loader hooks and crash/diagnostic uploader variables
cannot be added through either list or the Main-owned override path. The evidence audit scans the
app-owned `electron/shared/renderer` source and build output for app-owned crash
reporter, memory-dump or diagnostic-upload startup paths. This is local code
evidence only; deployment and diagnostic platform audit remains external.

Support/recovery and compatibility boundaries are documented in
`docs/SUPPORT_AND_RECOVERY.md` and `docs/COMPATIBILITY.md`. They are operator
guidance, not evidence that closes the external clean-machine, Provider,
packaged force-quit or independent security gates.

## How to continue

Each subsequent phase has a documented gate in plan §22. The Phase 0
artifacts (schemas, resolver, fixtures, trust model) are the contracts the
later phases implement against; they are reviewed and frozen, not re-opened
per feature.
