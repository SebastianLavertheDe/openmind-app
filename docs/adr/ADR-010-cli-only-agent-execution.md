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

Agent packages use the public Agent Skills `SKILL.md` contract and do not need
an app-specific Manifest. Installed bytes and their digest remain recorded by
the SkillStore under the bound openmind root. Codex receives the checked
`SKILL.md` path as native Skill input.

For Claude Code, `<openmindRoot>/.claude` is a directory link to `.agent`, so
the installed flat package path `.agent/skills/<name>/SKILL.md` is also the
native project path `.claude/skills/<name>/SKILL.md`. The adapter loads user
and project settings with `skills: "all"`; Claude Code owns discovery and
invocation without an OpenMind allowlist, metadata injection, or transient
Skill text bridge.

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

An Agent Skill does not request a Provider Profile or a provider Credential.
The external CLI uses its own authenticated user configuration.
The app does not translate `providerBindings` or a Skill `.env` file into an
Agent provider connection.

### 4. Security boundary

Claude Code, Codex and their tools run with the launching user's OS
privileges. CLI approvals and Skill instructions are not an OS sandbox and
cannot technically restrict an external CLI to declared openmind paths.

Archive extraction and install-target path safety remains Main-owned so an
import cannot write outside its destination. Provider-native approval handling
remains in the existing CLI adapters. The removed
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

Existing installed Agent packages that also carry an app Manifest remain
inspectable, but the CLI bridge does not require or interpret it for native
Skill discovery.

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
