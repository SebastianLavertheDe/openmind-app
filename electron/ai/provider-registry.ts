import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { ProviderCapabilities } from "../../shared/contracts";
import { resolveModelSpec, type ProviderKind } from "../../shared/model-catalog";
import { messages } from "../../shared/messages";
import { parseWslPath } from "./process-utils";
import { resolveNativeClaudeExecutable } from "./providers/claude-agent-sdk";

/**
 * 异步跑一条命令，返回 trim 后的 stdout；启动失败或超时返回 null。
 * 用 spawn 而非 execFileSync，保证探测永不阻塞 worker 事件循环。
 */
function runCommand(command: string, args: string[], timeoutMs = 15_000): Promise<string | null> {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(command, args, { windowsHide: true, stdio: ["ignore", "pipe", "ignore"] });
    } catch {
      resolve(null);
      return;
    }
    let stdout = "";
    const timer = setTimeout(() => { try { child.kill(); } catch { /* ignore */ } }, timeoutMs);
    child.stdout?.on("data", (chunk: Buffer) => { stdout += chunk.toString("utf8"); });
    child.on("error", () => { clearTimeout(timer); resolve(null); });
    child.on("close", () => { clearTimeout(timer); resolve(stdout.trim() || null); });
  });
}

interface ProbeResult {
  version: string | null;
  diagnostic: string | null;
}

type ProviderProbeSpec = {
  kind: ProviderKind;
  label: string;
  probeModel: () => string | null;
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
  async refresh(): Promise<ProviderCapabilities[]> {
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
    const detected = Object.fromEntries(
      PROVIDER_PROBE_SPECS.map((spec) => [spec.kind, modelFields(spec.kind, spec.probeModel())])
    ) as Record<ProviderKind, ReturnType<typeof modelFields>>;
    const providers: ProviderCapabilities[] = [];
    const wsl = process.platform === "win32" ? parseWslPath(this.projectRoot) : null;
    if (wsl) {
      for (const spec of PROVIDER_PROBE_SPECS) {
        const probe = await probeWslProvider(wsl.distro, wsl.linuxPath, spec);
        providers.push({
          id: `${spec.kind}-wsl-${wsl.distro}`,
          provider: spec.kind,
          label: messages.provider.wslLabel(spec.label, wsl.distro),
          runtime: "wsl",
          available: Boolean(probe.version),
          version: probe.version,
          supportsApprovals: true,
          supportsResume: true,
          supportsImages: true,
          diagnostic: probe.diagnostic,
          ...detected[spec.kind]
        });
      }
    }
    for (const spec of PROVIDER_PROBE_SPECS) {
      const probe = await probeNativeProvider(spec);
      providers.push({
        id: `${spec.kind}-native`,
        provider: spec.kind,
        label: messages.provider.nativeLabel(spec.label),
        runtime: "native",
        available: Boolean(probe.version),
        version: probe.version,
        supportsApprovals: true,
        supportsResume: true,
        supportsImages: true,
        diagnostic: probe.diagnostic,
        ...detected[spec.kind]
      });
    }
    return providers;
  }
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

/** 读 ~/.codex/config.toml 的 model 字段（top-level `model = "..."` 或 [model] name）。 */
function probeCodexModel(): string | null {
  try {
    const file = path.join(os.homedir(), ".codex", "config.toml");
    const text = fs.readFileSync(file, "utf8");
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
  } catch { /* 配置不存在或不可读——视为未指定 */ return null; }
}

/** 读 ~/.claude/settings.json 里 Claude Code 实际使用的模型（sonnet 档优先）。 */
function probeClaudeModel(): string | null {
  try {
    const file = path.join(os.homedir(), ".claude", "settings.json");
    const env = (JSON.parse(fs.readFileSync(file, "utf8")) as { env?: Record<string, string> }).env || {};
    return env.ANTHROPIC_DEFAULT_SONNET_MODEL
      || env.ANTHROPIC_DEFAULT_OPUS_MODEL
      || env.ANTHROPIC_DEFAULT_HAIKU_MODEL
      || env.ANTHROPIC_MODEL
      || null;
  } catch { return null; }
}

const PROVIDER_PROBE_SPECS: ReadonlyArray<ProviderProbeSpec> = [
  {
    kind: "codex",
    label: "Codex",
    probeModel: probeCodexModel,
    probeWslExtra: async (distro, cwd) => {
      if (await runCommand("wsl.exe", ["-d", distro, "--cd", cwd, "--", "codex", "app-server", "--help"])) return null;
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
    probeModel: probeClaudeModel,
    probeWslExtra: async (distro, cwd) => {
      if (parseClaudeAuthStatus(await runCommand("wsl.exe", ["-d", distro, "--cd", cwd, "--", "claude", "auth", "status"]))) return null;
      return messages.errors.provider.claudeWslNotLoggedIn(distro);
    },
    probeNativeExtra: async (command) => {
      if (parseClaudeAuthStatus(await runCommand(command, ["auth", "status"]))) return null;
      return messages.errors.provider.claudeNotLoggedIn;
    },
    nativeFailureDiagnostic: messages.errors.provider.claudeNativeMissing
  }
];

async function probeWslProvider(distro: string, cwd: string, spec: ProviderProbeSpec): Promise<ProbeResult> {
  const found = await runCommand("wsl.exe", ["-d", distro, "--cd", cwd, "--", spec.kind, "--version"]);
  if (!found) return { version: null, diagnostic: messages.errors.provider.wslStartFailed(spec.label, distro) };
  const extra = await spec.probeWslExtra(distro, cwd);
  if (extra) return { version: null, diagnostic: extra };
  return { version: found, diagnostic: null };
}

async function probeNativeProvider(spec: ProviderProbeSpec): Promise<ProbeResult> {
  if (process.platform !== "win32") {
    const found = await runCommand(spec.kind, ["--version"]);
    if (!found) return { version: null, diagnostic: messages.errors.provider.notInPath(spec.label) };
    const extra = await spec.probeNativeExtra(spec.kind);
    if (extra) return { version: null, diagnostic: extra };
    return { version: found, diagnostic: null };
  }
  const candidates = await locateWindowsCommands(spec.kind);
  for (const candidate of candidates) {
    const found = await runWindowsCommand(candidate, ["--version"]);
    if (!found) continue;
    const extra = await spec.probeNativeExtra(candidate);
    if (extra) continue;
    return { version: found, diagnostic: null };
  }
  if (spec.kind === "claude") {
    try {
      const executable = resolveNativeClaudeExecutable();
      const found = await runWindowsCommand(executable, ["--version"]);
      if (found && !(await spec.probeNativeExtra(executable))) return { version: found, diagnostic: null };
    } catch { /* packaged claude.exe unavailable */ }
  }
  return { version: null, diagnostic: spec.nativeFailureDiagnostic };
}

async function locateWindowsCommands(command: string): Promise<string[]> {
  const found: string[] = [];
  const home = process.env.USERPROFILE || "";
  const appdata = process.env.APPDATA || "";
  const explicit = command === "claude"
    ? [path.join(home, ".local\\bin\\claude.exe"), path.join(appdata, "npm\\claude.cmd")]
    : [path.join(home, ".local\\bin\\codex.exe"), path.join(appdata, "npm\\codex.cmd")];
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
