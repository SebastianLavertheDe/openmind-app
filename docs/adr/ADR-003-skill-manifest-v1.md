# ADR-003: Skill Manifest v1 (`openmind.skill.yaml`)

- **Status:** Accepted
- **Date:** 2026-08-05
- **Phase:** 0 (Architecture freeze)
- **Schema source:** `shared/skill-manifest-schema.ts` (Zod)
- **Example file:** `docs/fixtures/skill-manifest.example.yaml`

## Context

Today a "skill" is defined informally: a `SKILL.md` with frontmatter (`id`,
`title`, `description`, `cwd`, `command`, `runner`, `args`, `envFile`,
`group`, `permission`, `outputArtifacts`, `timeout`). This frontmatter is
**documentation for an agent**, not a machine-verifiable execution contract.
There is no version, no publisher, no kind classification, no runtime spec,
no input JSON Schema, no capabilities, no artifact contract, no digest, and
no signature. The current `skill-discovery.ts` even defaults to `runner=uv`
when it cannot find an entrypoint, which is unsafe.

To install, configure, run, update, and roll back skills reliably we need a
strict, versioned, machine-verifiable contract.

## Decision

### 1. Two distinct files

- **`SKILL.md`** — agent instructions, human documentation, triggers,
  methodology. YAML frontmatter optional, but **not** the execution contract.
- **`openmind.skill.yaml`** — the host-verifiable execution, configuration,
  permissions, runtime, and artifact contract. Validated strictly by the
  Manifest Parser.

A skill is **not runnable** without a valid `openmind.skill.yaml`. A legacy
skill with only `SKILL.md` is available for inspection and migration guidance
until a Manifest is produced (legacy adapter, §6.4 of the plan).

### 2. Manifest v1 shape

```yaml
apiVersion: openmind.dev/skill/v1
id: daily-article-summarizer        # lowercase, unique per publisher
version: 1.0.0                       # semver
publisher:
  id: openmind
  displayName: openmind
kind: process                        # process | workflow | agent

display:
  name: 每日文章总结
  description: 汇总指定日期的本地文章
  group: analysis

entrypoint:
  runtime: python                    # python | node | shell | binary
  script: main.py                    # relative to package root
  args: ["--date", "{{ inputs.date }}"]

runtime:
  version: ">=3.11,<3.13"
  dependencyFile: pyproject.toml
  lockFile: uv.lock
  packs: [python-core]

inputs:                              # JSON Schema (subset for run form)
  type: object
  required: [date]
  properties:
    date: { type: string, format: compact-date }

config:                              # non-sensitive persistent config
  providerProfile:
    type: provider-profile
    required: true

capabilities:
  openmind:
    read:  [article/**, reddit/**]
    write: [daily-summary/**]
  network: { required: true, hosts: [] }
  subprocess: { allowed: false }

artifacts:
  - id: daily-summary
    type: markdown
    path: daily-summary/{{ inputs.date }}_daily_summary.md

execution:
  concurrency:
    maxInstances: 1
    mutexes: [openmind:daily-summary]
  timeoutSeconds: 1800
  gracefulStopSeconds: 10
  retry: { maxAttempts: 1 }

platforms: [windows-x64, macos-arm64, macos-x64, linux-x64, wsl-linux-x64]

compatibility:
  minAppVersion: 1.0.0
  minRuntimeVersion: 1.0.0

# package digest + publisher signature are computed at packaging time,
# not authored by hand:
# digest: sha256-...
# signature: ...
```

### 3. Required vs optional fields

**Required:** `apiVersion`, `id`, `version`, `publisher.id`, `kind`,
`display.name`, `entrypoint` (process/workflow only), `platforms`,
`compatibility.minAppVersion`.

**Conditionally required:**
- `runtime` (process kind only; Agent execution is hosted by the selected
  Claude Code or Codex CLI).
- `inputs` (if the skill takes run inputs).
- `capabilities.openmind.write` (if the skill writes to openmind; patterns must be
  a subset of `openmind-layout-v1` contentContract).
- `artifacts` (if the skill produces declared outputs).

**Forbidden:**
- No secret values, ever. Secrets are referenced via `providerProfile` /
  `secretBindings` (name only — never value).
- No absolute paths.
- No `cwd` that escapes the package.
- No shell command strings (use `entrypoint.args[]` array).

### 4. kind semantics

- **process:** has `entrypoint` (python/node/shell/binary). Spawned by
  `ProcessHost`. Exit code decides success/failure. Output collected by
  `ArtifactCollector`.
- **workflow:** has `workflow.steps[]` referencing installed skill IDs +
  version ranges. Never concatenates sub-skill commands. Each step runs
  through the Broker independently.
- **agent:** `SKILL.md` is the entrypoint; executed only by the selected
  Claude Code CLI or Codex CLI bridge from an AI console session. It has no
  Process entrypoint and no app-owned provider/tool loop. Broker, manual Run,
  Automation and Workflow submissions fail closed. References must stay
  within the installed package boundary.

### 5. Templating

`{{ inputs.* }}` and `{{ exports.* }}` are the supported Process execution
template namespaces. Legacy `provider-profile` and `secret-ref` fields remain
parseable during Manifest migration, but their old template namespaces are
not resolved and fail closed before process startup. Non-provider private
runtime files belong under `OPENMIND_SKILL_DATA_DIR` and must be parsed as data,
never executed as shell commands.
For Python content Skills, the Broker-injected neutral environment names are
`OPENMIND_PROVIDER_PROTOCOL`, `OPENMIND_PROVIDER_BASE_URL`,
`OPENMIND_PROVIDER_MODEL`, and `OPENMIND_PROVIDER_API_KEY`; the last one is a
short-lived secret binding and is never a run input or persisted config field.
Templates are resolved by the Broker at run-prepare time, **after** schema
validation, and the resolved values are schema-checked again. Provider Profile
metadata is never persisted as a Secret value, and unresolved/extra bindings
fail closed.

Provider templates and `provider-profile` config bindings apply to managed
Process execution. They are not an Agent host selection mechanism. An Agent
uses the authentication and model configuration of the Claude Code or Codex
CLI selected for its AI session; the Agent bridge does not resolve a Provider
Profile, inject its Credential, or load a Skill `.env` provider fallback.

### 5a. Process Artifact report

The Broker injects `OPENMIND_ARTIFACT_REPORT_PATH`, an absolute path inside the
private Run directory. After all content writes complete, a Process Skill may
atomically write this versioned JSON report:

```json
{
  "schemaVersion": 1,
  "artifacts": [
    { "declarationId": "summary", "logicalPath": "daily-summary/20260805.md" }
  ]
}
```

`declarationId` must reference the Skill Manifest's `artifacts[].id`, and every
`logicalPath` is relative to the bound openmind root. The Broker rejects
absolute/traversing paths, symlinks, missing paths, declaration-pattern
mismatches, kind mismatches, oversized reports and excessive entry counts. It
derives type, hash, Run identity and timestamps itself. When a valid report is
present the Broker validates only the listed paths and does not scan historical
content. Successful legacy Skills without a report temporarily use the bounded
pattern scanner; failed or cancelled Skills never trigger that fallback.

### 6. Legacy adapter

A `SKILL.md`-only skill:
- is classified `kind: agent` if its frontmatter has no real entrypoint;
- generates an *inspect suggestion* for a Manifest, but install requires
  explicit user confirmation;
- never auto-defaults to `runner=uv`;
- has `signatureStatus: unsigned`, `reviewStatus: unreviewed`,
  and cannot be installed as a runnable package — being locally discovered does
  **not** imply that it passed the Manifest and Runtime checks.

## Consequences

- **Positive:** install/run/update decisions become machine-verifiable and
  diff-able. Capability changes between versions can force re-authorization.
- **Positive:** the renderer can generate run/config forms from `inputs` /
  `config` JSON Schemas.
- **Negative:** all 16 skills need a `openmind.skill.yaml` authored (Phase 6).
- **Negative:** legacy `SKILL.md`-only discovery must be preserved for
  migration but cannot be treated as runnable.
