# ADR-006: Managed Runtime Provenance & Verification

- **Status:** Accepted
- **Date:** 2026-08-05
- **Phase:** 0 (Architecture freeze)
- **Related:** ADR-005 (targets), ADR-009 (release identity & update chain)

> **Scope note:** [不做] Signed Catalog、Catalog 驱动更新和自动下载。当前支持
> 用户从本地 Manifest 明确发起的 HTTPS 下载；该 Manifest 自带签名、hash、
> 版本、license、SBOM 和下载地址，下载完成后仍必须走本文的完整校验链。
> 发布渠道、信任根轮换和自动联网分发仍需另行重开范围和发布验收。

## Context

A managed runtime that downloads and executes binaries is a high-value
supply-chain target. If a runtime binary is tampered with — or served from an
untrusted source — every skill that uses it runs compromised code with the
user's full OS privileges. The plan (§8, §13, §18.7) requires that the runtime
trust model be in place before any networked runtime install is allowed.

Specifically, **no catalog-driven or automatic networked runtime install is
enabled in the current scope**. A user may select a signed Runtime Pack
Manifest and explicitly start its HTTPS download; local/offline import and
that manual download must both go through signature, expiry, and
anti-downgrade checks.

## Decision

### 1. Embedded trusted root

- The app ships with an embedded trusted root key set and a runtime-targets
  metadata manifest for pack verification.
- `RuntimeManager` **refuses** any runtime activation if the trusted root is
  absent, expired, or fails verification. There is no "install anyway" bypass
  for managed runtime.
- Offline install is supported only via explicitly imported, signed offline
  packs that verify against the same root.

### 2. Pack verification (mandatory)

Every runtime pack install/update must pass, in order:

1. **Hash** — SHA-256 over the imported bytes matches the declared pack
   manifest.
2. **Signature** — valid against the publisher key chain for the pack.
3. **Expiry** — the declared pack manifest is not expired.
4. **Anti-downgrade** — version ≥ any previously-installed version of the
   same pack on this machine (the only exception is the documented rollback
   path via `previous` slot, which itself was previously verified).

Failure of any step → fail-closed; no partial activation; no PATH fallback.

### 3. Atomic install + active/previous

- Install into a staging dir → verify → atomic rename to a versioned slot.
- Maintain `active` + `previous` slots per pack. Switching `active` is atomic.
- An in-use pack (active runs depend on it) is never replaced; a new version
  installs into a parallel slot and switches only when safe.

### 4. Repair / rollback / remove

- `repair` re-verifies the active slot against its recorded digest; on
  mismatch, it remains `Needs Repair` until the user imports a matching,
  verified offline pack.
- `rollback` swaps `active` ↔ `previous` (previous must itself be a verified
  version).
- `remove` refuses if any installed skill still depends on the pack; surfaces
  the dependents list.
- Tampered runtime → `fail closed`, runtime shows `Needs Repair`.

### 5. SBOM / license / origin

Each pack records: origin URL, license, SHA-256, signature, SBOM
(CycloneDX/SPDX). These are persisted in the runtime registry and surfaced
in the Runtime UI.

### 6. Acceptance (Phase 4 gate)

- On a clean machine without system Python/uv, a base Python skill runs.
- Two dependency-conflicting skills use independent venvs and do not pollute
  each other.
- A tampered runtime is refused.
- **[不做]** Catalog-driven installation and automatic updates. User-selected
  HTTPS download is covered by the Runtime Pack download service, including
  pause/resume/delete and post-download verification.

## Consequences

- **Positive:** tampered local/offline runtimes fail closed before activation.
- **Positive:** tampered runtimes fail closed; users get a clear repair action.
- **Negative:** users still need a signed Manifest; the app does not discover
  or update Runtime Packs automatically.
- **Risk:** key rotation/revocation remains deferred with **[不做]** Catalog
  distribution and signed release.
