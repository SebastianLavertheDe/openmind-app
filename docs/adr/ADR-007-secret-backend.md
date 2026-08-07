# ADR-007: Secret Backend — CredentialVault

- **Status:** Accepted
- **Date:** 2026-08-05
- **Phase:** 0 (Architecture freeze)

## Context

Before this boundary, skills read their own `.env` files directly, and the
spawn path inherited the full `process.env`. That allowed unrelated browser
tokens, other providers' keys, and dev-machine `PYTHONPATH` / `NODE_OPTIONS`
to cross process boundaries. `browser-automation-settings.ts` already uses
`safeStorage` + atomic temp-file writes — that is the seed for a general
credential system, but is not yet general.

## Decision

### 1. CredentialVault responsibilities

`CredentialVault` encrypts, stores, authorises, tests, and deletes secrets.
It does **not** provide a plaintext-read IPC.

- Storage backend: Electron `safeStorage` (macOS Keychain / Windows DPAPI /
  libsecret on Linux).
- Linux: the actual backend is checked; weak/absent backends (e.g. plain
  fallback) **do not** persist plaintext. The user is told to install a
  working libsecret/keyring.

### 2. IPC surface (no plaintext read)

Only:
- `set` (write/replace),
- `replace`,
- `delete`,
- `status` (exists? last-tested? — never the value),
- `test` (uses the value transiently, never returns it).

`get-plaintext` does not exist as an IPC. The renderer never sees the value
except for the brief moment the user types a new one.

### 3. Secret binding scope

- Secrets bind to `publisher key + skill id + version + package digest`.
- **No publisher-wide auto-inheritance.** A new digest must be re-authorised
  even for the same publisher/id.
- The Broker only injects the secret bound to the **target** skill; it never
  injects Skill B's secret into Skill A. (This is process isolation hygiene,
  not a security boundary — host code with the current user's privileges can
  still read other resources; ADR-004 makes this explicit in copy.)

### 4. Injection rules

- Secrets are decrypted only at run-prepare time and minimally injected.
- Forbidden env names: `PATH`, `HOME`, `NODE_OPTIONS`, `PYTHONPATH`,
  `LD_PRELOAD`, `DYLD_*`. The Vault refuses to bind a secret to these.
- Secrets are never passed as command args, cwd, or temp-file names.
- Legacy `.env` compatibility, when unavoidable, uses a one-time tightened
  run file that is deleted at run end.
- Once injected into a child process, the value may persist in that
  process's env/memory/files for the whole run — **the app cannot reclaim
  what a skill has already read, copied, or exfiltrated.** UI copy says
  `Revoked` / `Removed from Vault`, never "wiped from all processes".

### 4a. App-owned AI Worker bootstrap

- Main starts the AI Worker with `buildAiWorkerEnvironment`, which copies only
  the cross-platform runtime baseline needed for PATH lookup, user config,
  temporary files and locale/timezone behavior.
- App paths, root generation, browser preferences and the extension token are
  explicit Main-owned overrides. Arbitrary parent variables, provider keys,
  `NODE_OPTIONS`, `PYTHONPATH`, `LD_PRELOAD` and `DYLD_*` do not cross the
  Worker boundary.
- Browser MCP children use the same filter. A browser extension token is
  passed only when the host explicitly selects browser automation; it is not
  inherited from the shell or exposed to a Skill process by default.
- This is environment-leakage hygiene, not OS privilege isolation; all host
  processes still run as the current user (ADR-004).

### 5. Redaction

- Both a generic pattern set (key-like, token-like, Bearer, long hex/base64)
  **and** the run's actual secret values feed the `Redactor`.
- Redaction runs before display and before persistence, on stdout, stderr,
  errors, and diagnostics export.
- Crash dumps for secret-bearing workers are disabled for full-memory dump
  and auto-upload.
- The AI Worker and Browser MCP child receive a closed Main-owned environment
  allowlist. Explicit overrides cannot add provider keys, loader hooks or
  crash/diagnostic uploader variables. The local evidence gate also rejects an
  App-owned `crashReporter`, Node diagnostic-report or upload startup path;
  deployment/diagnostic-platform audit remains a separate release gate.
- Redactor is best-effort: it cannot defeat a malicious skill that encodes,
  fragments, or transforms a secret before printing it.

### 6. Rotation / deletion

- On delete or replace: revoke further injection, delete the Vault copy, and
  best-effort terminate Broker-trackable active runs that hold the secret.
- Provider test never echoes the `Authorization` header.

### 7. Base URL safety

- HTTPS by default.
- HTTP only allowed for localhost/loopback; other HTTP surfaces an explicit
  risk and requires explicit confirmation.
- URLs may not embed `user:pass@` credentials.
- TLS-skip is a separate, dangerous permission; never hidden in a URL field.

### 8. Legacy `.env` migration

- Install pre-scan analyses variable **names** only; values are never copied.
- Maps names → provider profile / secret suggestion.
- User re-enters or explicitly imports; the import path never logs plaintext.
- Source `.env` is **never deleted** by the app.

## Consequences

- **Positive:** the attack surface "any skill reads any other skill's env"
  closes for app-managed secrets.
- **Positive:** redaction covers both pattern-based and run-specific values.
- **Negative:** every skill that reads `.env` must be migrated to
  `providerProfile` / injected env (Phase 6).
- **Risk (explicit):** this is **not** a sandbox. Host code with the user's
  privileges can still read other files; the vault only reduces what the app
  *actively* exposes. Product copy must never imply strong isolation.
