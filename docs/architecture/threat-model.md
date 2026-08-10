# Threat Model — cctools desktop-app (host-direct execution)

- **Status:** Phase 0 baseline
- **Date:** 2026-08-05
- **Scope:** all skills run with the launching user's OS privileges; no
  container/VM/separate-account isolation. See ADR-004.

## 1. Assets to protect

| Asset | Why it matters |
|---|---|
| AI / API / OAuth secrets | direct cost, account takeover |
| `mymind` user content | months/years of accumulated work |
| Other system files the user can access | could be exfiltrated or encrypted |
| Browser login state / cookies | account takeover across the web |
| App update keys & catalog root keys | supply-channel compromise |
| Skill / Runtime package integrity | tampered package = persistent compromise |
| Run history privacy | prompts/secrets may be echoed in logs |
| System CPU / memory / disk / network | resource-exhaustion / abuse |
| User's accurate understanding of risk | over-trust leads to all of the above |

## 2. Trust boundary (explicit, single boundary)

There is **one** trust boundary: the OS user account. Every Process skill,
External Agent, Browser CLI, and their children run as the current OS user.
The app's process-tree management, minimal-env, secret-scope, and redaction
are **hygiene and UX**, not a security sandbox. Approved-host code can:
- read any file the user can read,
- open any network connection the user can open,
- spawn any process,
- modify any mymind path (not just declared ones).

Therefore the strongest control is **gating which code reaches approved-host**
in the first place (ADR-004).

## 3. Threats & mitigations

| Threat | Mitigation | Residual risk (explicit) |
|---|---|---|
| Malicious ZIP/Git path traversal (Zip Slip) | staging extraction; reject absolute/`..`/device/symlink-out/hardlink; cap count/size/ratio/time | — |
| Skill impersonates an existing id | install dedups by `publisher+id+version+digest`; impersonation surfaces a conflict, not silent replace | — |
| Publisher change | publisher is part of the binding; change resets `executionTrust` to inspect-only | — |
| Catalog replay of old version | anti-downgrade rule; `previous`-only rollback path | — |
| Runtime binary tampered | hash + signature + expiry + embedded root; fail closed | offline-root compromise |
| Install hook arbitrary exec | package install never executes package code; npm `postinstall` disabled; build-backend install treated as host-code exec, gated by digest approval | — |
| Dependency supply-chain | lockfile mandatory (uv.lock); frozen sync; license/vuln scan | upstream vuln in a locked dep |
| Skill reads full env | minimal env allowlist; no `process.env` inheritance; no browser/other-provider tokens; Main overrides are a closed allowlist | host code can still read other files (1 boundary) |
| Secret leaks via logs/errors | generic + run-specific redactor; no app-owned crash reporter or diagnostic uploader for secret-bearing workers | malicious skill can encode/fragment secret — not fully preventable; deployment platform audit remains external |
| Symlink/junction escape | realpath check; reject links leaving the root; Windows case-insensitive compare; WSL/UNC normalisation | TOCTOU race — mitigated by re-check at open |
| Arbitrary subprocess | declared capability; Broker tracks the process tree; best-effort kill on stop; residual reporting | spawned children that double-fork can escape tracking |
| Infinite log/file/CPU/memory | limits on stdout size, file count/size, timeout, graceful-stop, CPU/memory quotas (best-effort on platforms that lack enforcement) | — |
| Process tree escape | Windows Job Object; POSIX process group; orphan detection on worker restart | untrackable descendants |
| Agent prompt injection | instructions & web content are untrusted; only exact-digest, `approved-host` packages cross the CLI bridge; Claude Code/Codex own tool approval and session controls | the external CLI and its tools retain the OS user's authority; the app cannot enforce per-tool or per-path isolation |
| Agent provider secret confusion | Agent bridge never resolves a Provider Profile, injects its Credential, or loads a Skill `.env`; CLI authentication stays in the selected CLI | a CLI may use credentials from its own user configuration, outside the App CredentialVault boundary |
| Malicious update | three independent signed chains; trust chain (ADR-009) is a gate, not optional | — |
| Crash mid-migration leaves half-state | staging + atomic switch + schemaVersion last; fail does not change active | — |
| mymind modified by 3rd-party approved-host skill or external CLI | pre/post tree audit for managed Process/Workflow runs; App/App-native Workflow paths use the Resolver; bridge package/reference paths are boundary-checked | cannot technically prevent an external CLI or approved-host process from modifying other paths — only detect where an App-owned audit exists |

## 4. Security acceptance (must pass before GA)

- Modify any byte in a package → signature verification fails.
- Zip Slip, hardlink, device, escaping symlink/hardlink → all rejected.
- Broker never injects Skill B's secret into Skill A (unit-tested). *Not* a
  strong isolation guarantee for host code.
- App-owned settings / run metadata / command args / install packages contain
  no secret plaintext.
- Known plaintexts are redacted from stdout/stderr/diagnostics (scanned test).
- Secret-bearing worker does not produce/autoupload a full memory dump.
- Main/Worker source has no app-owned `crashReporter`, Node diagnostic-report
  or crash-upload startup path; the evidence gate checks this and the closed
  Worker environment allowlist. This is local code evidence, not a deployment
  or diagnostic-platform audit.
- Secret delete/rotate → revoke injection, delete vault copy, best-effort kill
  trackable runs.
- Local skill modified → signature/review/executionTrust update independently;
  executionTrust → inspect-only.
- Tampered runtime → refused.
- `executionTrust=inspect-only` cannot run.
- Managed Process/Workflow manual run cannot bypass executionTrust, risk
  confirmation or Broker. Agent Skills have no manual/Broker run path: only an
  approved package may cross the selected Claude Code/Codex AI-console bridge.
- Publisher revocation + key rotation have a tested recovery path.

## 5. Out of scope (explicit non-goals)

- Container/VM/separate-account isolation.
- Technically preventing an approved-host skill from reading other files or
  opening network connections.
- Recovering secrets from escaped subprocesses, skill-created files, memory
  copies, or exfiltrated data.
- Configuring host OS antivirus/EDR/firewall.

These are **product facts**, reflected in UI copy: no "securely isolated", no
"can only access authorised directories".
