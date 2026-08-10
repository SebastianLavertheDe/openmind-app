# ADR-010: CLI-only Agent execution

- **Status:** Accepted
- **Date:** 2026-08-10
- **Supersedes:** the Internal Agent Runtime path in ADR-008

## Context

ADR-008 allowed two hosts for an installed `kind: agent` package: the
external Codex/Claude bridges and an app-owned HTTP provider/tool loop driven
by a Provider Profile. The app-owned loop duplicated provider session,
tool-call, approval, browser, continuation, budget and recovery behaviour that
is already owned by Claude Code and Codex.

The product now requires every Agent Skill to run through Claude Code CLI or
Codex CLI. API-key-only Agent execution inside the app is no longer a product
goal.

## Decision

### 1. One Agent host boundary

An installed `kind: agent` package is executed only by the selected external
CLI host:

- Codex uses the Codex CLI `app-server` transport.
- Claude uses the Claude Code CLI transport exposed through the Claude Agent
  SDK.

Both bridges receive only an active, ready, exact-digest,
`approved-host` package from the app-private SkillStore. Codex receives the
boundary-checked `SKILL.md` path as native Skill input. Claude receives
bounded `SKILL.md` and reference text as transient system context. Neither
bridge permanently copies the installed package into the workspace.

### 2. AI console is the only Agent invocation surface

The user selects an available Codex or Claude Code Provider in an AI console
session and invokes the installed Skill with `/skill-id ...`. The AI session
owns CLI authentication, provider session continuation, approvals and output
events.

`kind: agent` fails closed when submitted through any Execution Broker entry
point, including:

- manual Skill Run;
- Automation;
- Workflow steps;
- Broker retry or the removed Internal Agent resume API.

Those surfaces may support Agent Skills in the future only through a separate
CLI-backed Broker design and a new ADR. They must never fall back to direct
OpenAI/Anthropic HTTP requests or treat an Agent as a Process Skill.

### 3. Provider Profiles remain a Process capability

Provider Profile, CredentialVault, connectivity testing, proxy/TLS policy and
Broker environment injection remain supported for Process Skills that call an
AI API. In particular, RSS processing, daily summarization, daily topic
selection, knowledge-wiki compilation and subtitle translation continue to
use that infrastructure.

An Agent Manifest does not request a Provider Profile or a provider
Credential. The external CLI uses its own authenticated user configuration.
The app does not translate `providerBindings` or a Skill `.env` file into an
Agent provider connection.

### 4. Security boundary

Claude Code, Codex and their tools run with the launching user's OS
privileges. Manifest capabilities, package trust, CLI approvals and Artifact
descriptions are instruction, gating and audit controls; they are not an OS
sandbox and cannot technically restrict an external CLI to declared mymind
paths.

Package and reference path validation remains Main-owned. Provider-native
approval handling remains in the existing CLI adapters. The removed
Internal-Agent-only approval, browser-action and logical-file tool policies
must not be described as controls for external CLI execution.

### 5. Persistence and compatibility

The Internal Agent provider checkpoint/resume API is removed. Codex/Claude AI
session continuation through `providerSessionId` is a separate CLI feature and
remains supported.

Existing Run records may retain old `agentCheckpoint` and
`resumedFromRunId` fields as read-only compatibility data. They are never used
to restart work. Removing those fields from a strict persisted schema requires
an explicit migration rather than silently dropping historical Runs.

Existing installed Agent packages that still contain obsolete Provider
Profile declarations may remain inspectable for compatibility, but unknown
fields are stripped and the CLI bridge never interprets those bindings.
Canonical Agent Manifests omit them.

## Consequences

- **Positive:** there is one Agent execution model and no duplicate
  app-owned provider/tool loop.
- **Positive:** Agent authentication and provider sessions follow the CLI the
  user selected and already configured.
- **Positive:** Process Provider Profiles and scoped Credentials remain
  available without being conflated with Agent hosting.
- **Negative:** Agent Skills are not runnable from Broker, Automation or
  Workflow surfaces.
- **Negative:** CLI execution does not inherit Broker mutex, retry, timeout,
  Artifact collection or checkpoint semantics.
- **Risk:** an external CLI has the OS user's authority; capability text
  cannot enforce filesystem or network isolation.
