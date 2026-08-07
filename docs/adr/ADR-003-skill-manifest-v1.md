# ADR-003: Skill Manifest v1 (`cctools.skill.yaml`)

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
- **`cctools.skill.yaml`** — the host-verifiable execution, configuration,
  permissions, runtime, and artifact contract. Validated strictly by the
  Manifest Parser.

A skill is **not runnable** without a valid `cctools.skill.yaml`. A legacy
skill with only `SKILL.md` is inspect-only until a Manifest is produced
(legacy adapter, §6.4 of the plan).

### 2. Manifest v1 shape

```yaml
apiVersion: cctools.dev/skill/v1
id: daily-article-summarizer        # lowercase, unique per publisher
version: 1.0.0                       # semver
publisher:
  id: cctools
  displayName: cctools
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
  mymind:
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
    mutexes: [mymind:daily-summary]
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
- `runtime` (process kind only; agent kind uses `provider`).
- `inputs` (if the skill takes run inputs).
- `capabilities.mymind.write` (if the skill writes to mymind; patterns must be
  a subset of `mymind-layout-v1` contentContract).
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
- **agent:** `SKILL.md` is the entrypoint; executed by `ExternalAgentHost`
  (Codex/Claude bridge) or `InternalAgentHost`. No fake python/uv command is
  shown in UI. References must stay within the package boundary.

### 5. Templating

`{{ inputs.* }}`, `{{ providers.<binding>.<baseUrl|model|protocol|profileId> }}`
and `{{ run.* }}` are the allowed execution template namespaces. A
`config.<name>` field with `type: provider-profile` is bound by the request's
`providerBindings[name]`. A `secret-ref` may use `secretRef:
provider:<binding>` to resolve the selected Profile's Credential while still
enforcing the exact publisher/Skill/version/digest scope in CredentialVault.
For Python content Skills, the Broker-injected neutral environment names are
`CCTOOLS_PROVIDER_PROTOCOL`, `CCTOOLS_PROVIDER_BASE_URL`,
`CCTOOLS_PROVIDER_MODEL`, and `CCTOOLS_PROVIDER_API_KEY`; the last one is a
short-lived secret binding and is never a run input or persisted config field.
Templates are resolved by the Broker at run-prepare time, **after** schema
validation, and the resolved values are schema-checked again. Provider Profile
metadata is never persisted as a Secret value, and unresolved/extra bindings
fail closed.

### 6. Legacy adapter

A `SKILL.md`-only skill:
- is classified `kind: agent` if its frontmatter has no real entrypoint;
- generates an *inspect suggestion* for a Manifest, but install requires
  explicit user confirmation;
- never auto-defaults to `runner=uv`;
- has `signatureStatus: unsigned`, `reviewStatus: unreviewed`,
  `executionTrust: inspect-only` (see ADR-004) — being locally discovered
  does **not** imply verified.

## Consequences

- **Positive:** install/run/update decisions become machine-verifiable and
  diff-able. Capability changes between versions can force re-authorization.
- **Positive:** the renderer can generate run/config forms from `inputs` /
  `config` JSON Schemas.
- **Negative:** all 16 skills need a `cctools.skill.yaml` authored (Phase 6).
- **Negative:** legacy `SKILL.md`-only discovery must be preserved for
  migration but cannot be treated as runnable.
