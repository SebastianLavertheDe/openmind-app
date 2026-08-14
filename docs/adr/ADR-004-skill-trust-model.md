# ADR-004: Skill Trust Model — Independent Trust Dimensions

- **Status:** Superseded for the current distribution flow
- **Date:** 2026-08-05
- **Phase:** 0 (Architecture freeze)

> This ADR records the historical four-dimension host-consent design. The
> current distribution flow removed the persisted `executionTrust` gate:
> source inspection, exact digest checks, Runtime readiness and active-version
> selection now determine whether an installed Skill can run. See
> `docs/distribution-ux-plan.md` and `CHANGELOG.md` for the superseding flow.

## Context

A single `Verified: boolean` flag conflates four unrelated questions:

1. Is the package signed by a known key? (`signatureStatus`)
2. Has the code been reviewed? (`reviewStatus`)
3. May this exact package run on the host? (`executionTrust`)
4. May new versions auto-activate? (`skillUpdatePolicy`)

A signed-but-malicious skill, a reviewed-but-modified-local skill, and a
freshly-downloaded skill are all different situations. Collapsing them into
one flag produces false confidence and lets the UI imply safety that does not
exist. The current discovery code, by treating "found locally" as effectively
verified, is exactly this anti-pattern.

## Decision

Trust is recorded as **four independent dimensions**, each with its own
enumerated values, lifecycle, and UI affordance. They never collapse.

| Dimension | Values | Meaning | Set by |
|---|---|---|---|
| `sourceType` | `built-in \| catalog \| local \| url` | where the package came from; **not** safety | installer |
| `signatureStatus` | `unsigned \| valid \| invalid \| revoked` | whether the package matches a signing key | signature verifier |
| `reviewStatus` | `unreviewed \| automated-scan \| manually-reviewed` | what review the code passed | catalog / security team |
| `executionTrust` | `denied \| inspect-only \| approved-host` | whether the user authorized **this exact digest** to run as the current OS user | explicit user action |
| `skillUpdatePolicy` | `manual \| download-only` | whether new digests may be auto-downloaded | explicit user action |

### 1. executionTrust binding

`executionTrust` is bound to the tuple:

```
publisher key + skill id + version + package digest
```

- Changing **any** of these (including a new digest from the same publisher)
  resets `executionTrust` to `inspect-only`.
- `inspect-only` code cannot run, cannot prepare a runtime environment that
  might execute package code, and cannot execute smoke tests. The user must
  explicitly choose "Trust and Run on Host" to promote it to `approved-host`.
- `approved-host` means: the user understands the skill runs with their full
  OS user privileges and has accepted that risk for this exact package digest.

### 2. Default per sourceType

- `built-in`: signed, internally reviewed, but **still** requires the user to
  acknowledge host-execution on first run (display, not auto-trust).
- `catalog`: `signatureStatus` and `reviewStatus` shown separately; catalog
  signature does **not** auto-grant `approved-host`.
- `local`: full source path, entrypoint, digest, and modification state shown;
  defaults to `inspect-only`; user promotes explicitly.
- `url` / unknown: defaults to `inspect-only`; user promotes explicitly.

### 3. Update policy

- `skillUpdatePolicy: download-only` permits background download and **static**
  verification of a new digest, but the new digest must still get explicit
  `approved-host` before activation, environment preparation, or smoke.
- New digest does **not** auto-inherit Secret bindings or automation
  permissions from the previous digest.
- A new digest that adds Secrets, network hosts, write paths, subprocess, or
  changes publisher **forces** re-authorization regardless of policy.

### 4. Revocation

- Publisher key revocation blocks auto-update of affected packages.
- Whether an already-`approved-host` older version may continue to run is a
  separate security policy decision (default: block, with explicit override).
- User may revoke `executionTrust` at any time; an already-running process
  must be stopped explicitly via Stop/Terminate (revocation does not magic
  back data the process already read).

### 5. UI rules

- The four dimensions are shown distinctly on the skill card and detail page.
- The product never uses the words "safe", "verified safe", "securely
  isolated", or "can only access authorised directories".
- First run always surfaces a fixed warning: *"Running this skill is
  equivalent to running a local program as your current OS user."* with the
  real entrypoint, declared capabilities, and Secret bindings listed.

## Consequences

- **Positive:** a signed-but-tampered package (`signatureStatus: invalid`)
  cannot be confused with a reviewed one; a local modified skill cannot be
  confused with a reviewed catalog skill.
- **Positive:** the state machine for "what happens when a package changes"
  becomes testable (digest change → `inspect-only` reset).
- **Negative:** more UI states to design and test (see §14.11 Ready states of
  the refactor plan: `Needs Host Trust` vs `Needs Host Execution Consent`).
- **Negative:** every install/update flow must compute and show a capability
  diff before activation.
