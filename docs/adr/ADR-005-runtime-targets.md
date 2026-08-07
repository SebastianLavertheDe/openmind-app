# ADR-005: Runtime Targets — Platform / Arch / WSL

- **Status:** Accepted
- **Date:** 2026-08-05
- **Phase:** 0 (Architecture freeze)

> **Scope note:** [不做] 正式 Linux 桌面发布和 Signed Catalog。Linux target
> 保留为开发/运行时契约，WSL 仍作为 Windows 下的独立运行时目标；Runtime
> Pack 支持本地/离线导入，以及用户从签名 Manifest 明确发起的 HTTPS 下载，
> 不支持 Catalog 驱动或自动更新。

## Context

The README currently asks users to install Node, Git, Python, and `uv`
themselves. The packaging config bundles none of Python/uv/ffmpeg/yt-dlp/
Playwright Chromium/Whisper/Torch/CJK fonts. To meet the "no pre-installed
runtime" product goal we must define platform/arch targets precisely, and
crucially treat Windows/WSL as **two different targets** with independent
runtimes (the current code hard-codes WSL paths and conflates them).

## Decision

### 1. Target matrix

A runtime `target` is a stable string of the form `<os>-<arch>`:

| target | OS | Arch | Notes |
|---|---|---|---|
| `windows-x64` | Windows 11 | x86_64 | first-class v1 |
| `windows-arm64` | Windows 11 | aarch64 | after E2E green |
| `macos-arm64` | macOS | aarch64 | Apple Silicon; first-class v1 |
| `macos-x64` | macOS | x86_64 | Intel; only if explicitly supported |
| `linux-x64` | Ubuntu 22.04/24.04 | x86_64 | **[不做] 正式 Linux 发布** |
| `linux-arm64` | Ubuntu | aarch64 | **[不做] 正式 Linux 发布** |
| `wsl-linux-x64` | WSL Ubuntu | x86_64 | **independent** runtime inside the distro |

- `wsl-linux-x64` is a first-class target. Its runtime lives **inside** the
  WSL distro, never reusing Windows binaries. Distros are identified by distro
  ID; status is checked before use.
- Windows ↔ WSL path translation is explicit (UNC ↔ `/`) and tested.

### 2. Runtime mode

Each runtime has a `mode`:

- `managed` — default success path. Bundled/fixed-version or explicitly
  imported from a local/offline Runtime Pack manifest, verified by hash + pack
  signature, installed atomically. Does **not** consult system PATH.
- `system` — advanced/dev only. Uses system-installed executables; the user
  accepts all compatibility risk.
- `custom` — user-supplied canonical executable path; persisted and
  canonicalised.

**Hard rule:** `managed` failure must **not** silently fall back to
`system`. A managed-runtime failure surfaces a `Needs Runtime` ready state
with a repair action.

### 3. Runtime Packs

| Pack | Contents | Primary consumer |
|---|---|---|
| `python-core` | fixed CPython, uv, CA certs | most process skills |
| `node-22` | standalone Node runtime | future Node skills |
| `media-core` | ffmpeg, ffprobe, yt-dlp | video / X media |
| `browser-playwright` | Playwright-compatible Chromium | RSS browser fetch |
| `browser-agent` | agent-browser CLI, Chromium, profile mgmt | agent-browser |
| `speech-whisper` | Whisper, Torch, model mgmt | video transcription |
| `cjk-subtitle-fonts` | CJK fonts | hard subtitles |
| `network-cli` | fixed curl, CA, network helpers | legacy X entry if curl not removed |
| `minigit` | minimal git capability | Git skill source |
| `wsl-runtime-bridge` | WSL detect, path & env bridge | Windows/WSL |

- The exact Python version is frozen after a compatibility spike; freeze
  recorded in `runtime-targets.ts`.
- Optional large packs (Chromium, ffmpeg, Whisper/Torch, models) are **not**
  in the base installer; downloaded on demand with size/license heads-up.

### 4. Python environment

- One venv per skill/version, fingerprinted by:
  `skillId + skillVersion + skillPackageDigest + lockHash +
   pythonRuntimeDigest + platformTarget`.
- Uses the Managed Python's absolute path; `UV_PYTHON_DOWNLOADS=never`.
- `uv sync --frozen` at install time (explicit prepare, never on first run).
- Conflicting skills use independent venvs; an old venv is GC'd only after
  active runs finish.

## Consequences

- **Positive:** clean-machine (no Python/uv/Node) becomes achievable for v1
  on Windows x64 + macOS arm64.
- **Positive:** WSL is a separate, testable target instead of a hidden
  hard-coded path.
- **Negative:** packaging must build and verify each target × pack — a
  substantial CI footprint (Phase 4; **[不做] Linux 正式发布和 Signed Catalog**).
- **Risk:** large packs make the install footprint variable; mitigated by
  on-demand optional packs with explicit size disclosure.
