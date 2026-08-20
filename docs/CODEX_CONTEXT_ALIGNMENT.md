# Codex Context and Rollout Alignment

## Reference implementation

The implementation is based on these Codex CLI components:

- `codex-rs/rollout/src/recorder.rs`: one append-only JSONL rollout per thread, `session_meta` first, serialized writer ordering, parse-error-tolerant loading.
- `codex-rs/protocol/src/protocol.rs`: `RolloutItem`, `TurnContextItem`, `CompactedItem`, and turn lifecycle event contracts.
- `codex-rs/rollout/src/policy.rs`: persist semantic/canonical items, not streaming deltas.
- `codex-rs/core/src/context_manager/history.rs` and `normalize.rs`: oldest-to-newest model history, history versions, bounded tool outputs, and call/output pairing.
- `codex-rs/core/src/session/rollout_reconstruction.rs`: replay compaction checkpoints and rollback markers instead of rewriting old history.
- `codex-rs/app-server/src/request_processors/thread_processor.rs`: rebuild turns from rollout and transfer them with opaque cursor pagination.

## OpenMind mapping

| Codex concept | OpenMind implementation |
| --- | --- |
| Thread rollout | `.openmind/ai/sessions/<session-id>/rollout.jsonl` |
| `SessionMeta` | `session_meta` first line, including provider, origin, base-instruction owner, capabilities, history mode, and fork parent |
| `TurnStarted` / `TurnComplete` / `TurnAborted` | `event_msg` lifecycle records keyed by run/turn ID |
| Raw user event | `event_msg.user_message`; this is the exact text rendered by the UI |
| Model-visible input | `response_item.message`; slash expansion and attached context are retained independently from the raw user text |
| Dynamic turn context | `turn_context` with cwd, workspace roots, date, timezone, permission/sandbox profile, provider/model, and context hash |
| World state | full first snapshot plus JSON Merge Patch updates |
| Model history | reconstructed `response_item` sequence with call/output normalization and bounded outputs |
| Provider compaction | `context_compacted` event followed by a `compacted` replacement-history checkpoint and a fresh context/world-state baseline |
| Rollback | append-only `thread_rolled_back`; materialized run indexes are hidden but old rollout records are unchanged |
| Fork | clone surviving turns into a new rollout with remapped session, turn, and event IDs; the native provider session is intentionally detached |
| Resume | use the native provider thread normally; if resume fails before output, retry once with surviving local rollout context |
| UI history | `ai:turns` complete-turn pages with opaque cursors; live events merge into the active page |

## Storage authority

`rollout.jsonl` is canonical. `session.json`, `run.json`, and `search-index.json` are materialized indexes and UI metadata. Startup replay reconciles terminal run state from durable lifecycle markers before interrupted turns are recovered.

Legacy per-run `events.jsonl` files are read once when a session has no rollout. Migration writes a new rollout atomically and leaves every legacy file untouched.

Malformed rollout lines are counted and skipped, matching Codex replay behavior. History is never repaired by deleting or rewriting preceding records.

## Provider boundary

Codex app-server and Claude Code still own their native execution sessions, tool runtime, and provider-specific token caches. OpenMind owns the durable cross-provider context contract above. This avoids replaying history twice during a healthy native resume while still making the local rollout sufficient to recover when the provider session is missing.
