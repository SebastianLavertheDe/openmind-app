# AI Workspace Architecture

## Process Model

The renderer never spawns providers or touches project files directly.

```text
React renderer
  ↕ typed preload IPC
Electron main process
  ↕ request/response + push events
AI Utility Process
  ├─ ProviderRegistry
  ├─ RunScheduler
  ├─ ApprovalBroker
  ├─ SessionStore
  ├─ LegacyChangeManager
  └─ SkillToolRegistry
```

The Utility Process owns all mutable AI runtime state. A worker crash rejects outstanding IPC requests; the next request creates a fresh worker and interrupted runs are marked failed without losing their project records.

## Provider Contract

Codex runs `codex app-server` over JSONL JSON-RPC. The adapter initializes experimental capability only for registered dynamic openmind tools. It consumes semantic thread, turn, item, approval, usage and diff events. It never parses terminal prose.

Claude runs through `@anthropic-ai/claude-agent-sdk`. `canUseTool` routes permission decisions through the same ApprovalBroker used by Codex. The adapter explicitly disables the Claude process sandbox; file-tool paths remain subject to OpenMind's canonical `openmindRoot` checks.

Provider events are normalized into versioned `AiEvent` records before persistence or UI rendering.

The primary conversation timeline intentionally hides usage, provider initialization, lifecycle status and empty-change events. Those records may remain available to the run engine, but the conversation focuses on messages, tools, approvals, risks and errors. Both Claude and Codex receive the enabled, integrity-checked Installed Skill catalog in ordinary and Project sessions. The catalog contains names, descriptions and package paths; applicable `SKILL.md` instructions and references are read progressively with file tools. It is refreshed before every turn, including continuations. Provider-global discovery and unregistered project configuration remain disabled. `<openmindRoot>/.claude` links to `.agent` for external Claude Code clients. Browser automation and screenshots use Tencent BrowserSkill through `bsk` and its browser extension.

## Runs And Direct Project Access

- A session binds project, cwd, Provider and permission profile.
- One session runs one turn at a time. Different sessions may run concurrently.
- Every run uses the configured session cwd directly. No Git worktree, copied directory or baseline commit is created.
- Reads, writes, commands and registered skills all execute in that same current project directory.
- File writes take effect immediately. Users review or revert them through the project's normal Git workflow.
- Historical runs created by older desktop versions may still expose their saved ChangeSet. `LegacyChangeManager` only applies, reverts or cleans those existing records and cannot create a worktree.

## Permissions

| Profile | Reads | Safe commands | Direct project edits | Network | Destructive/outside/elevation |
| --- | --- | --- | --- | --- | --- |
| Read-only | yes | provider read-only tools | no | no | always denied/approved |
| Edit | yes | automatic | automatic | approval | approval |
| Auto | yes | automatic | automatic | automatic | approval |

Registered openmind skills declare a permission requirement, timeout and output artifact patterns. Skill calls from AI remain visible as formal tool events.

## Persistence

Project records under `.openmind/ai/` are the source of truth. `session.json`, `run.json`, and `search-index.json` are materialized indexes; the canonical conversation history is the session's single append-only `rollout.jsonl`. JSON indexes use temporary-file replacement. Rollout appends are serialized, malformed records are counted and skipped during replay without rewriting history, and large semantic payloads are chunked and reassembled in the projection. Provider-private token/status deltas are not persisted or rendered.

Context follows the same separation used by Codex CLI:

1. **Durable rollout:** each session owns one Codex-shaped JSONL stream. The first item is `session_meta`; later items use `event_msg`, `response_item`, `turn_context`, `world_state`, and `compacted`. Existing per-run `events.jsonl` files are migrated once and retained as untouched recovery artifacts.
2. **Explicit turn boundaries:** each user turn persists `turn_started`, the raw `user_message`, model-visible response items, a full `turn_context`, world-state full/patch data, and `turn_complete` or `turn_aborted`. Event sequence numbers remain local to their turn.
3. **Reconstructed model context:** replay applies compaction replacement-history checkpoints and append-only rollback markers, normalizes function call/output pairs, bounds tool output, restores token metadata, and tracks a history version plus context-window identity.
4. **Provider recovery:** Codex and Claude normally resume their native provider thread. If resume fails before any output, OpenMind clears the stale provider ID, rebuilds surviving context from the local rollout, and retries once on a fresh provider thread.
5. **Conversation projection:** the renderer requests opaque-cursor pages of complete turns, then orders events by turn-local sequence. A user message can never be removed while its answer remains visible.

The raw user message is stored independently from provider-only context. Temporal metadata and attachment context may be added to the provider prompt, but they do not alter the message rendered in the conversation.

Search is project-file based. Each session maintains `search-index.json`; no SQLite or cloud index is created.

## Security Model

Semantic event logs intentionally keep complete tool output. RiskScanner detects likely tokens, credentials, cookies, private keys and absolute paths. Findings are written to the event and run security report. The policy is warn-only.

AI execution is rooted at the selected `openmindRoot`; the legacy optional `workspaceRoot` preference is not a Provider filesystem authority. Application file tools may read every path below `openmindRoot`, including `projects/`, and reject paths that resolve outside it.

The app does not use Claude's `dangerously-bypass-approvals-and-sandbox` or `dangerously-skip-permissions` modes. Codex runs with `danger-full-access`, and Claude runs with `sandbox.enabled = false`; therefore the `openmindRoot` boundary is an application policy rather than an OS-enforced command boundary. Claude does not expose Bash or PowerShell, so its file-tool boundary remains enforceable in the adapter. Codex retains a native shell; without a sandbox, indirect shell access outside `openmindRoot` cannot be technically guaranteed. Direct API providers, cloud sync and multi-agent orchestration remain unavailable.
