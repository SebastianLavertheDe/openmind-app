# Threat Model — openmind desktop-app (host-direct execution)

- **Status:** Phase 0 baseline
- **Date:** 2026-08-05
- **Scope:** all skills run with the launching user's OS privileges; no
  container/VM/separate-account isolation. See ADR-004.

## 1. Assets to protect

| Asset | Why it matters |
|---|---|
| AI / API / OAuth secrets | direct cost, account takeover |
| `openmind` user content | months/years of accumulated work |
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
are **hygiene and UX**, not a security sandbox. An installed, integrity-checked
Skill can:
- read any file the user can read,
- open any network connection the user can open,
- spawn any process,
- modify any openmind path (not just declared ones).

Therefore the strongest controls are **static inspection before installation,
exact-digest checks and Runtime readiness**;
none of them turn a Skill into an OS sandbox.

## 3. Threats & mitigations

| Threat | Mitigation | Residual risk (explicit) |
|---|---|---|
| Malicious ZIP/Git path traversal (Zip Slip) | staging extraction; reject absolute/`..`/device/symlink-out/hardlink; cap count/size/ratio/time | — |
| Skill impersonates an existing id | registry identity is `publisher+id`; explicit reinstall stages and atomically replaces the one managed copy only after inspection | a user can still explicitly install malicious code under a trusted-looking identity |
| Publisher/content change | publisher, Manifest identity and digest are rebound during explicit installation; every execution rechecks the installed copy | — |
| Old Skill version reinstalled | there is no automatic Skill update channel; manual source reinstall always shows and records the resulting digest | the user can explicitly choose an older source revision |
| Runtime binary tampered | hash + signature + expiry + embedded root; fail closed | offline-root compromise |
| Install hook arbitrary exec | package install never executes package code; npm `postinstall` disabled; build-backend install treated as host-code exec, gated by digest approval | — |
| Dependency supply-chain | lockfile mandatory (uv.lock); frozen sync; license/vuln scan | upstream vuln in a locked dep |
| Skill reads full env | minimal env allowlist; no `process.env` inheritance; no browser/other-provider tokens; Main overrides are a closed allowlist | host code can still read other files (1 boundary) |
| Secret leaks via logs/errors | generic + run-specific redactor; no app-owned crash reporter or diagnostic uploader for secret-bearing workers | malicious skill can encode/fragment secret — not fully preventable; deployment platform audit remains external |
| Symlink/junction escape | realpath check; reject links leaving the root; Windows case-insensitive compare; WSL/UNC normalisation | TOCTOU race — mitigated by re-check at open |
| Arbitrary subprocess | declared capability; Broker tracks the process tree; best-effort kill on stop; residual reporting | spawned children that double-fork can escape tracking |
| Infinite log/file/CPU/memory | limits on stdout size, file count/size, timeout, graceful-stop, CPU/memory quotas (best-effort on platforms that lack enforcement) | — |
| Process tree escape | Windows Job Object; POSIX process group; orphan detection on worker restart | untrackable descendants |
| Agent prompt injection | instructions & web content are untrusted; only installed packages passing a fresh exact-digest/identity check cross the CLI bridge; Claude Code/Codex own tool approval and session controls | the external CLI and its tools retain the OS user's authority; the app cannot enforce per-tool or per-path isolation |
| Agent provider secret confusion | Agent bridge never resolves a Provider Profile, injects its Credential, or loads a Skill `.env`; CLI authentication stays in the selected CLI | a CLI may use credentials from its own user configuration, outside the App CredentialVault boundary |
| Malicious update | three independent signed chains; trust chain (ADR-009) is a gate, not optional | — |
| Crash mid-install/migration leaves half-state | per-package staging + atomic directory/registry writes; a complete-source receipt is committed only after the whole selected source succeeds | a failed multi-package install may leave already-committed packages, but cannot satisfy the complete-source startup gate |
| openmind modified by a third-party Skill or external CLI | capability declarations are reviewed before install; App/App-native Workflow paths use the Resolver; declared output paths are indexed for Run history | host processes can modify other paths; the App neither prevents nor claims to detect undeclared writes |

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
- Installed Skill modified → the fresh path/Manifest/digest check fails and the
  package cannot run until an explicit reinstall restores a matching record.
- Tampered runtime → refused.
- A missing, malformed or digest-mismatched installed package cannot run.
  Managed Process/Workflow manual runs cannot bypass package, Runtime or Broker
  checks. Agent Skills have no manual/Broker run path and cross the selected
  Claude Code/Codex bridge only after the same installed-copy verification.
- Publisher revocation + key rotation have a tested recovery path.

## 5. Out of scope (explicit non-goals)

- Container/VM/separate-account isolation.
- Technically preventing an installed Skill from reading other files or
  opening network connections.
- Recovering secrets from escaped subprocesses, skill-created files, memory
  copies, or exfiltrated data.
- Configuring host OS antivirus/EDR/firewall.

These are **product facts**, reflected in UI copy: no "securely isolated", no
"can only access authorised directories".
