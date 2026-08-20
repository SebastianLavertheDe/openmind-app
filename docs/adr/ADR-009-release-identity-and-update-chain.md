# ADR-009: Release Identity & Update Trust Chain

- **Status:** Accepted
- **Date:** 2026-08-05
- **Phase:** 0 (Architecture freeze)

> **Scope note:** [不做] 签名发布、正式 Linux 支持和 Signed Catalog。本 ADR
> 保留的是未来若重新开启发布/联网更新时的约束记录，不代表当前版本交付这些能力。

## Context

Several release identities, once shipped, cannot be changed without breaking
upgrades, credentials, system authorisations, and data directories. The plan
(§18.1) requires these be frozen by ADR before any signed build. Those
requirements are deferred with the current scope. In addition, auto-update
(§18.7) would require a TUF-style trust chain (root/targets/snapshot/
timestamp) with threshold, expiry, key rotation/revocation, and anti-replay —
**[不做] this trust chain is not enabled for the current release**.

## Decision

### 1. Frozen release identity (v1)

| Field | Value |
|---|---|
| productName | `OpenMind` |
| appId | `com.openmind.desktop` |
| macOS bundle id | `com.openmind.desktop` |
| Windows publisher subject | **[不做] OS 签名发布** |
| Linux application id | **[不做] 正式 Linux 发布** |
| Electron userData dir | default `app.getPath("userData")` (platform-managed) |
| URL protocol | `openmind://` (reserved; not all launchers registered in v1) |
| Update feed domain | **[不做] 联网自动更新 feed** |
| channels | `stable`, `beta` |

These are set in `package.json` `build` config where applicable. The
`[不做]` entries are intentionally not release commitments. (appId/productName
are already what the inlined electron-builder config uses today.)

### 2. Three independent update chains

App, Skill, and Runtime updates are **three separate transactions**. Each
maintains its own active/previous state; one chain's update never overwrites
another's active pointer.

### 3. [不做] Signed Catalog update trust chain

The following is retained only as a deferred design note; it is not
implemented or required by the current release:

- **Roles:** root / targets / snapshot / timestamp (TUF-style).
- **Threshold:** root requires `m-of-n` offline key holders.
- **Expiry:** every metadata role has a `expires` field; expired metadata is
  rejected.
- **Offline root:** the root key is kept offline; rotation is a documented
  ceremony.
- **Revocation:** keys can be revoked; revoked packages block auto-update.
- **Anti-replay / anti-downgrade:** a newer installed version refuses to be
  replaced by an older version unless via the documented rollback path
  (`previous` slot verified + rollback token).

Current release behavior is **unsigned installers/builds + manual repair or
offline replacement only** — no silent networked replacement of
App/Skill/Runtime.

### 4. [不做] App update specifics

- stable/beta feed; signed metadata; expiry; rollback protection; staged
  rollout.
- Download → verify signature → exit-replace via an independent signed
  bootstrapper.
- A/B binary slots; new version must confirm healthy or the bootstrapper
  restores `previous` via a rollback token.
- Only a `previous` digest already installed and rollback-token-authorised
  may bypass the general anti-downgrade rule.
- Settings/registry/schema metadata backed up before update; data migration
  uses two-phase commit with a documented schema rollback window.
- Irreversible migrations have a separate gate; once run, the app must not
  claim older versions still boot.
- If a platform cannot host an independent bootstrapper / A-B / health
  check, the auto-recovery promise is **dropped** for that platform; only a
  signed repair installer + user-confirmed recovery is offered.

### 5. Skill update specifics

- Publisher + digest; entrypoint / Declared Access / Secret / host-risk diff
  shown before activation.
- Parallel install; environment prepare only via RuntimeManager and only
  after the new exact digest passes static checks and is selected active +
  ready.
- Smoke only via ExecutionBroker and only after the active + ready package is
  resolved for the run.
- A new digest may download/verify/static-check before activation, but cannot
  activate or prepare an environment until its exact digest and Runtime are
  valid.
- A new digest does not inherit Secret bindings or automation permissions.

### 6. Runtime update specifics

- Pack signature + digest; active/previous; Skill environment compatibility
  checked; not switched mid-run; failure does not break old env; batch
  rebuild of environments; rollback.

### 7. [不做] Catalog anti-downgrade

- Catalog metadata cannot override the in-package Manifest.
- Catalog cannot replay an older version of a package past the anti-downgrade
  rule.

## Consequences

- **Positive:** release identity is stable for the lifetime of v1; no
  post-ship identity churn.
- **Positive:** the trust chain is a documented gate; no half-built auto
  update can ship.
- **Trade-off:** OS signing, key ceremony, Catalog metadata and silent
  auto-update are intentionally excluded; manual repair/offline replacement
  remains the recovery path.
- **Risk:** if a platform cannot support A/B bootstrapping, auto-rollback is
  demoted to repair-installer-only (explicit in copy; no false promise).
