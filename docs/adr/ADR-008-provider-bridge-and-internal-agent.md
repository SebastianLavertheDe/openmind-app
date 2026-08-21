# ADR-008: Provider Bridge & Internal Agent Runtime

- **Status:** Superseded by ADR-010
- **Date:** 2026-08-05
- **Phase:** 0 (Architecture freeze)

> **Supersession notice (2026-08-10):** ADR-010 removes the Internal Agent
> Runtime path. Installed Agent Skills now run only through Claude Code CLI or
> Codex CLI from an AI console session. The External Bridge rules in this ADR
> remain historical context where they do not conflict with ADR-010;
> API-key-only Agent execution, Broker Agent execution and Internal Agent
> checkpoints are no longer current architecture. Provider Profiles remain
> supported for Process Skills.
> ADR-010 also replaces the historical Claude instruction bridge: current
> Claude execution uses native `.claude/skills` discovery through the
> `.claude` → `.agent` directory link, without app-owned Skill filtering.

## Context

The app already ships Codex (`@anthropic-ai/claude-agent-sdk` inverse —
`codex-app-server.ts`) and Claude (`claude-agent-sdk.ts`) provider bridges.
Today they require skills to live in the workspace's `.claude/skills` and
couple skill path resolution to `repoRoot`. The product goal adds a second,
harder capability: run Agent skills with **only** an API key / base URL /
model configured in-app — no external CLI required.

This is a distinct, large sub-project ("not just passing an API key to
python", per §12.4 of the plan). We must fix the scope and ordering.

## Decision

### 1. Two execution paths for Agent skills

- **External Provider Bridge** (Phase 6, baseline product): bridges installed
  Codex and Claude CLIs. Uses the `InstalledSkillRepository`'s absolute
  `SKILL.md` path — does **not** require skills under workspace
  `.claude/skills`.
- **Internal Agent Runtime** (Phase 9, full product goal): runs Agent skills
  with just a Provider Profile (key/url/model). Implemented in-app; no
  external CLI required.

### 2. Unified adapter contract

```ts
interface AgentSkillAdapter {
  inspect(skill: InstalledAgentSkill): Promise<AgentSkillReadiness>;
  prepare(skill: InstalledAgentSkill, ctx: AgentRunContext):
    Promise<PreparedAgentSkill>;
  run(prepared, provider: AgentProviderBinding, signal: AbortSignal,
      events: AgentEventSink): Promise<AgentResult>;
}
```

Both External Bridge and Internal Runtime implement this contract, so the
Broker and UI treat them uniformly.

### 3. External Bridge rules (Codex / Claude)

- Skill path must belong to an installed skill package (resolved via
  `InstalledSkillRepository`), never the workspace's `.claude/skills`.
- Tools / secrets the app actively provides to the provider are the
  intersection of (Manifest capabilities ∩ user approval). The provider's own
  host process retains full OS user privileges — not limited by this
  intersection.
- Provider version compatibility (skill-path capability across Codex
  versions) is verified; incompatibility surfaces a clear error, not a
  silent failure.
- Claude bridge reads + boundary-checks `SKILL.md` and references; injects
  the instructions as controlled context; never permanently copies them into
  the workspace or `openmindRoot`.

### 4. Internal Agent Runtime scope

If the goal is "API key only", the Internal Runtime must implement:
provider adapter registry (OpenAI Chat / Responses, Anthropic Messages,
provider-native), model capability probe, streaming token/event, tool-call
parser, tool loop, file search/read/write/edit, openmind logical-path tools,
controlled shell/process tools, web fetch/search, browser tool, approval,
tool-output limits, context-window management, reference loading,
prompt-injection defence prompts, retry/backoff, cancel, token/cost/time
budgets, artifact events, session/run persistence, provider fallback,
process/workflow skill invocation, optional delegation, agent debug/trace.

This is its own sub-project; budgeted at Phase 9 (20–35 person-days).

### 4.1 Provider connectivity probe boundary

The Main process owns the initial Provider Profile connectivity test. The
probe uses the declared OpenAI Chat/Responses or Anthropic Messages endpoint
shape, or a GET reachability probe for `provider-native`. It may temporarily
obtain the selected Credential through the scope-checked Vault callback, but
never returns the value to Renderer code and never stores a response body.
Timeout, retry count and TLS policy come from the Profile; an explicit proxy
policy fails closed until a proxy endpoint is configured. Only status,
timestamp and a bounded diagnostic are persisted.

### 5. Agent safety rules

- Skill instructions and external page content are untrusted input.
- File / shell / network / browser tools are separately approved.
- The app does **not** expose a plaintext secret read to the agent tool API.
- The app actively injects secrets only through the controlled Provider
  Adapter or explicit tools; it does not promise to stop host code from
  accessing other user resources.
- Reference files are constrained to the skill package boundary (host agent
  may still read other files on its own — not preventable, only audited).
- Internal Agent's controlled file tools use `OpenmindPathResolver`; shell,
  process, browser CLI, and external agents run with host privileges once
  approved.
- Max iterations and max cost are enforced.
- On agent failure, best-effort close of Broker-trackable browsers and
  children, with residual-process reporting.

### 6. Ordering / gating

- Phase 6 ships the External Bridge (baseline product closes with the three
  Agent skills runnable via Codex/Claude).
- Phase 9 ships the Internal Runtime (the "API key only" goal).
- Internal Runtime's readiness gate: three Agent skills run with only a
  Provider Profile configured and no external CLI installed.

## Consequences

- **Positive:** baseline product (Phase 0–8) closes with External Bridge
  alone; the expensive Internal Runtime is decoupled and cannot block v1.
- **Positive:** the Broker and Run UI are identical for both paths.
- **Negative:** the Internal Runtime is a large build (Phase 9); must not be
  mis-scoped as a small wrapper.
- **Risk:** provider behaviour differences (OpenAI vs Anthropic vs provider-
  native) require adapter contracts + capability probes + fixtures.
