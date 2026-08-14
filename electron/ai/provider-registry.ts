import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { ProviderCapabilities } from "../../shared/contracts";
import { resolveModelSpec, type ProviderKind } from "../../shared/model-catalog";
import { messages } from "../../shared/messages";
import { buildWslLoginCommand, parseWslPath } from "./process-utils";
import { MIN_MANAGED_CLAUDE_VERSION, resolveNativeClaudeExecutable, supportsManagedClaudeVersion } from "./providers/claude-agent-sdk";
import { resolveCliProvider } from "../config/providers-yaml";
import type { ProviderYamlEntry } from "../../shared/providers-yaml";
import { runProviderCommand as runCommand } from "./provider-command-runner";
import { detectCliToolPlatform, resolveAppToolExecutable } from "../install/cli-installer-service";
import { getAppPaths } from "../paths/app-paths-service";

interface ProbeResult {
  version: string | null;
  diagnostic: string | null;
}

type ProviderProbeSpec = {
  kind: ProviderKind;
  label: string;
  probeWslExtra: (distro: string, cwd: string) => Promise<string | null>;
  probeNativeExtra: (command: string) => Promise<string | null>;
  nativeFailureDiagnostic: string;
};

export class ProviderRegistry {
  private cached: ProviderCapabilities[] = [];
  private inflight: Promise<ProviderCapabilities[]> | null = null;

  constructor(private projectRoot: string) {}

  /**
   * 纯同步读缓存，永不 spawn 子进程、永不阻塞。
   * 启动后首次探测完成前返回空数组；之后整次会话期都复用这份缓存，
   * 把「能否可用」从发送关键路径上彻底摘掉。
   */
  detect(): ProviderCapabilities[] {
    return this.cached;
  }

  /**
   * 异步探测所有 provider（本机 + WSL），更新缓存后返回。
   * 并发调用复用同一个 in-flight promise。仅在启动、窗口获焦、进入设置等
   * 明确时机调用——不在 send/snapshot 路径上。
   */
  async refresh(forceAfterCurrent = false): Promise<ProviderCapabilities[]> {
    const current = this.inflight;
    if (current) {
      if (!forceAfterCurrent) return current;
      // A providers.yaml save must not reuse a probe that captured the old
      // binding. Wait for it, then ensure one fresh probe observes the file.
      try { await current; } catch { /* the replacement probe still runs */ }
      if (this.inflight && this.inflight !== current) return this.inflight;
    }
    if (this.inflight) return this.inflight;
    this.inflight = (async () => {
      try {
        this.cached = await this.probeAll();
        return this.cached;
      } finally {
        this.inflight = null;
      }
    })();
    return this.inflight;
  }

  private async probeAll(): Promise<ProviderCapabilities[]> {
    const providers: ProviderCapabilities[] = [];
    const managed = Object.fromEntries((["codex", "claude"] as const).map((kind) => {
      try { return [kind, resolveCliProvider(kind)]; }
      catch { return [kind, null]; }
    })) as Record<ProviderKind, ProviderYamlEntry | null>;
    const wsl = process.platform === "win32" ? parseWslPath(this.projectRoot) : null;
    if (wsl) {
      for (const spec of PROVIDER_PROBE_SPECS) {
        const [probe, model] = await Promise.all([
          probeWslProvider(wsl.distro, wsl.linuxPath, spec, managed[spec.kind]),
          probeWslModel(wsl.distro, spec.kind)
        ]);
        providers.push({
          id: `${spec.kind}-wsl-${wsl.distro}`,
          provider: spec.kind,
          label: messages.provider.wslLabel(spec.label, wsl.distro),
          runtime: "wsl",
          available: Boolean(probe.version) && !probe.diagnostic,
          version: probe.version,
          supportsApprovals: true,
          supportsResume: true,
          supportsImages: true,
          diagnostic: probe.diagnostic,
          installable: false,
          ...modelFields(spec.kind, managed[spec.kind]?.model || model)
        });
      }
    }
    for (const spec of PROVIDER_PROBE_SPECS) {
      const probe = await probeNativeProvider(spec, managed[spec.kind]);
      providers.push({
        id: `${spec.kind}-native`,
        provider: spec.kind,
        label: messages.provider.nativeLabel(spec.label),
        runtime: "native",
        available: Boolean(probe.version) && !probe.diagnostic,
        version: probe.version,
        supportsApprovals: true,
        supportsResume: true,
        supportsImages: true,
        diagnostic: probe.diagnostic,
        installable: cliToolInstallable(spec.kind),
        ...modelFields(spec.kind, managed[spec.kind]?.model || probeNativeModel(spec.kind))
      });
    }
    return providers;
  }
}

/** The first distribution phase promises native Windows/macOS only;
 * Linux and WSL remain manual until their installer channels are verified. */
function cliToolInstallable(kind: ProviderKind): boolean {
  return (process.platform === "win32" || process.platform === "darwin")
    && detectCliToolPlatform() !== null
    && (kind === "claude" || kind === "codex");
}

/** App-private tools/bin executables that probes try before PATH. */
function appToolCandidates(kind: ProviderKind): string[] {
  const resolved = resolveAppToolExecutable(kind);
  return resolved ? [resolved] : [];
}

/** 把探测到的模型 id 解析成 ProviderCapabilities 的三个字段。 */
function modelFields(provider: ProviderKind, id: string | null) {
  const spec = resolveModelSpec(provider, id);
  return {
    detectedModel: id,
    contextWindow: spec?.contextWindow ?? null,
    oneMillion: spec?.oneMillion ?? false
  };
}

/** 解析 ~/.codex/config.toml 的 model 字段（top-level `model = "..."` 或 [model] name）。 */
function parseCodexModel(text: string): string | null {
  let section = "";
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    const sectionMatch = line.match(/^\[([^\]]+)\]$/);
    if (sectionMatch) { section = sectionMatch[1].trim(); continue; }
    if (section === "") {
      const m = line.match(/^model\s*=\s*"([^"]+)"/);
      if (m) return m[1];
    } else if (section === "model") {
      const m = line.match(/^name\s*=\s*"([^"]+)"/);
      if (m) return m[1];
    }
  }
  return null;
}

/** 解析 ~/.claude/settings.json 里 Claude Code 配置的模型。 */
function parseClaudeModel(text: string): string | null {
  try {
    const settings = JSON.parse(text) as { model?: unknown; env?: Record<string, unknown> };
    if (typeof settings.model === "string" && settings.model.trim()) return settings.model.trim();
    const env = settings.env || {};
    for (const key of ["ANTHROPIC_DEFAULT_SONNET_MODEL", "ANTHROPIC_DEFAULT_OPUS_MODEL", "ANTHROPIC_DEFAULT_HAIKU_MODEL", "ANTHROPIC_MODEL"]) {
      const value = env[key];
      if (typeof value === "string" && value.trim()) return value.trim();
    }
    return null;
  } catch { return null; }
}

/** 读取本机对应 CLI 的用户配置。 */
function probeNativeModel(kind: ProviderKind): string | null {
  try {
    const file = kind === "claude"
      ? path.join(os.homedir(), ".claude", "settings.json")
      : path.join(os.homedir(), ".codex", "config.toml");
    const text = fs.readFileSync(file, "utf8");
    return kind === "claude" ? parseClaudeModel(text) : parseCodexModel(text);
  } catch { /* 配置不存在或不可读——视为未指定 */ return null; }
}

/**
 * 读取指定 WSL 发行版自己的用户配置。只把配置内容读回当前进程并在内存中解析，
 * 不复用 Windows 用户目录，确保每张 Provider 卡展示它实际运行环境中的模型。
 */
async function probeWslModel(distro: string, kind: ProviderKind): Promise<string | null> {
  const relativePath = kind === "claude" ? ".claude/settings.json" : ".codex/config.toml";
  const text = await runCommand(
    "wsl.exe",
    ["-d", distro, "--exec", "sh", "-lc", `test -r "$HOME/${relativePath}" && cat "$HOME/${relativePath}"`],
    5_000
  );
  if (!text) return null;
  return kind === "claude" ? parseClaudeModel(text) : parseCodexModel(text);
}

const PROVIDER_PROBE_SPECS: ReadonlyArray<ProviderProbeSpec> = [
  {
    kind: "codex",
    label: "Codex",
    probeWslExtra: async (distro, cwd) => {
      if (await runCommand("wsl.exe", ["-d", distro, "--cd", cwd, "--exec", "codex", "app-server", "--help"])) return null;
      return messages.errors.provider.codexWslNoAppServer(distro);
    },
    probeNativeExtra: async (command) => {
      if (await runCommand(command, ["app-server", "--help"])) return null;
      return messages.errors.provider.codexNoAppServer;
    },
    nativeFailureDiagnostic: messages.errors.provider.codexNativeMissing
  },
  {
    kind: "claude",
    label: "Claude Code",
    probeWslExtra: async (distro, cwd) => {
      if (parseClaudeAuthStatus(await runWslProviderCommand(distro, cwd, "claude", ["auth", "status"]))) return null;
      return messages.errors.provider.claudeWslNotLoggedIn(distro);
    },
    probeNativeExtra: async (command) => {
      if (parseClaudeAuthStatus(await runCommand(command, ["auth", "status"]))) return null;
      return messages.errors.provider.claudeNotLoggedIn;
    },
    nativeFailureDiagnostic: messages.errors.provider.claudeNativeMissing
  }
];

async function probeWslProvider(distro: string, cwd: string, spec: ProviderProbeSpec, managed: ProviderYamlEntry | null): Promise<ProbeResult> {
  const found = await runWslProviderCommand(distro, cwd, spec.kind, ["--version"]);
  if (!found) return { version: null, diagnostic: messages.errors.provider.wslStartFailed(spec.label, distro) };
  if (spec.kind === "claude" && managed && !supportsManagedClaudeVersion(found)) {
    return {
      version: null,
      diagnostic: `WSL Claude Code 托管 Provider 需要 ${MIN_MANAGED_CLAUDE_VERSION.join(".")} 或更高版本；${distro} 当前为 ${found}。`
    };
  }
  const extra = spec.kind === "claude" && managed ? null : await spec.probeWslExtra(distro, cwd);
  // Preserve Claude's executable version when only its own login is missing:
  // a session pinned to a providers.yaml credential can still use the binary.
  if (extra) return { version: spec.kind === "claude" ? found : null, diagnostic: extra };
  return { version: found, diagnostic: null };
}

function runWslProviderCommand(
  distro: string,
  cwd: string,
  kind: ProviderKind,
  args: string[]
): Promise<string | null> {
  const invocation = kind === "claude"
    ? buildWslLoginCommand(kind, args)
    : { command: kind, args };
  return runCommand("wsl.exe", ["-d", distro, "--cd", cwd, "--exec", invocation.command, ...invocation.args]);
}

async function probeNativeProvider(spec: ProviderProbeSpec, managed: ProviderYamlEntry | null): Promise<ProbeResult> {
  if (process.platform !== "win32") {
    // App-private one-click installs are probed before PATH so a fresh
    // install is picked up without restarting the host shell environment.
    const candidates = appToolCandidates(spec.kind).filter((candidate) => {
      try { return fs.existsSync(candidate); } catch { return false; }
    });
    let found: string | null = null;
    let command: string = spec.kind;
    for (const candidate of candidates) {
      found = await runCommand(candidate, ["--version"]);
      if (found) { command = candidate; break; }
    }
    if (!found) found = await runCommand(spec.kind, ["--version"]);
    if (!found) return { version: null, diagnostic: messages.errors.provider.notInPath(spec.label) };
    const extra = spec.kind === "claude" && managed ? null : await spec.probeNativeExtra(command);
    if (extra) return { version: spec.kind === "claude" ? found : null, diagnostic: extra };
    return { version: found, diagnostic: null };
  }
  const candidates = await locateWindowsCommands(spec.kind);
  let unauthenticatedClaude: ProbeResult | null = null;
  for (const candidate of candidates) {
    const found = await runWindowsCommand(candidate, ["--version"]);
    if (!found) continue;
    const extra = spec.kind === "claude" && managed ? null : await spec.probeNativeExtra(candidate);
    if (extra) {
      if (spec.kind === "claude" && !unauthenticatedClaude) {
        unauthenticatedClaude = { version: found, diagnostic: extra };
      }
      continue;
    }
    return { version: found, diagnostic: null };
  }
  if (spec.kind === "claude") {
    try {
      const executable = resolveNativeClaudeExecutable();
      const found = await runWindowsCommand(executable, ["--version"]);
      if (found) {
        const extra = managed ? null : await spec.probeNativeExtra(executable);
        if (!extra) return { version: found, diagnostic: null };
        unauthenticatedClaude ||= { version: found, diagnostic: extra };
      }
    } catch { /* packaged claude.exe unavailable */ }
  }
  if (unauthenticatedClaude) return unauthenticatedClaude;
  return { version: null, diagnostic: spec.nativeFailureDiagnostic };
}

async function locateWindowsCommands(command: string): Promise<string[]> {
  const found: string[] = [];
  const home = process.env.USERPROFILE || "";
  const appdata = process.env.APPDATA || "";
  const explicit = [
    ...appToolCandidates(command as ProviderKind),
    ...(command === "claude"
      ? [path.join(home, ".local\\bin\\claude.exe"), path.join(appdata, "npm\\claude.cmd")]
      : [path.join(home, ".local\\bin\\codex.exe"), path.join(appdata, "npm\\codex.cmd")])
  ];
  for (const candidate of explicit) {
    if (candidate && !found.includes(candidate)) {
      try { if (fs.existsSync(candidate)) found.push(candidate); } catch { /* ignore */ }
    }
  }
  const whereOutput = await runCommand("where.exe", [command], 5_000);
  if (whereOutput) {
    for (const line of whereOutput.split(/\r?\n/).map((item) => item.trim()).filter(Boolean)) {
      if (!found.includes(line)) found.push(line);
    }
  }
  return found;
}

async function runWindowsCommand(command: string, args: string[]): Promise<string | null> {
  const extension = path.extname(command).toLowerCase();
  if (extension === ".ps1") {
    return runCommand("powershell.exe", ["-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", command, ...args]);
  }
  if (extension === ".cmd" || extension === ".bat") {
    return runCommand("cmd.exe", ["/d", "/s", "/c", [quoteCmd(command), ...args.map(quoteCmd)].join(" ")]);
  }
  return runCommand(command, args);
}

function quoteCmd(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

export function parseClaudeAuthStatus(output: string | null): boolean {
  if (!output) return false;
  if (/\bnot logged in\b/i.test(output)) return false;
  try {
    return (JSON.parse(output) as { loggedIn?: boolean }).loggedIn === true;
  } catch {
    return /"loggedIn"\s*:\s*true/i.test(output) || /\blogged\s*in\b/i.test(output);
  }
}
