import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { gunzipSync, unzipSync } from "fflate";
import { getAppPaths, type AppPaths } from "../paths/app-paths-service";

/** The first distribution phase deliberately promises only native Windows/macOS. */
export type CliToolId = "claude" | "codex";
export type CliToolPlatform = "windows-x64" | "macos-arm64" | "macos-x64";
export type CliInstallSource = "system-path" | "app-tools" | null;
export type CliInstallPhase = "resolving" | "downloading" | "verifying" | "extracting" | "installing" | "done" | "cancelled";

export type CliInstallProgress = {
  cli: CliToolId;
  phase: CliInstallPhase;
  receivedBytes?: number;
  totalBytes?: number;
  version?: string;
  message?: string;
};

export type CliDetection = {
  installed: boolean;
  source: CliInstallSource;
  executablePath: string | null;
};

export type CliInstallStatus = {
  cli: CliToolId;
  installed: boolean;
  version: string | null;
  digest: string | null;
  sourceUrl: string | null;
  installedAt: string | null;
  executablePath: string;
};

export type CliToolUpdate = {
  cli: CliToolId;
  installed: boolean;
  currentVersion: string | null;
  latestVersion: string | null;
  updateAvailable: boolean;
  canUpgrade: boolean;
  checkedAt: string;
  source: "official" | "npm" | "unknown";
};

export type CliInstallerErrorCode =
  | "platform-unsupported"
  | "release-lookup-failed"
  | "asset-not-found"
  | "download-failed"
  | "digest-mismatch"
  | "archive-invalid"
  | "binary-not-found"
  | "runtime-unavailable"
  | "install-command-failed"
  | "cancelled";

export type CliInstallerErrorInfo = { code: CliInstallerErrorCode; message: string };

export class CliInstallerError extends Error {
  constructor(readonly detail: CliInstallerErrorInfo) {
    super(detail.message);
    this.name = "CliInstallerError";
    this.code = detail.code;
  }

  readonly code: CliInstallerErrorCode;
}

export type CliInstallerResponse = {
  statusCode: number;
  body: Buffer;
  /** Final URL after redirects, supplied by the built-in transport. */
  finalUrl?: string;
  headers?: Record<string, string | string[] | undefined>;
};

/** Minimal injected transport so unit tests never touch the network. */
export type CliInstallerTransport = (url: string, signal?: AbortSignal) => Promise<CliInstallerResponse>;

export type CliCommandRunner = (
  command: string,
  args: string[],
  options: { cwd: string; env: NodeJS.ProcessEnv; signal: AbortSignal }
) => Promise<{ stdout: string; stderr: string }>;

export type ManagedNodeRuntime = {
  nodeExecutable: string;
  npmCliPath: string;
};

export function resolveNpmCliPath(nodeExecutable: string): string | null {
  const nodeDir = path.dirname(nodeExecutable);
  const candidates = [
    path.join(nodeDir, "npm-cli.js"),
    path.join(nodeDir, "..", "lib", "node_modules", "npm", "bin", "npm-cli.js")
  ].map((candidate) => path.resolve(candidate));
  return candidates.find((candidate) => { try { return fs.statSync(candidate).isFile(); } catch { return false; } }) || null;
}

export type CliInstallerOptions = {
  transport?: CliInstallerTransport;
  commandRunner?: CliCommandRunner;
  resolveNodeRuntime?: () => ManagedNodeRuntime | null;
  onProgress?: (progress: CliInstallProgress) => void;
  platform?: NodeJS.Platform;
  arch?: string;
  systemPathResolver?: (cli: CliToolId) => string | null;
};

type CliInstallManifest = {
  schemaVersion: 1;
  cli: CliToolId;
  version: string;
  digest: string;
  sourceUrl: string;
  method: "claude-native" | "codex-npm";
  installedAt: string;
};

const CLI_IDS: readonly CliToolId[] = ["claude", "codex"];
const CLAUDE_INSTALL_SCRIPT = {
  darwin: "https://claude.ai/install.sh",
  win32: "https://claude.ai/install.ps1"
} as const;
// The installer script is a bootstrapper and does not contain the current
// release number. Claude publishes the version for the latest channel as
// plain text from this endpoint instead.
const CLAUDE_VERSION_ENDPOINT = "https://downloads.claude.ai/claude-code-releases/latest";
const CLAUDE_OFFICIAL_HOSTS = new Set(["claude.ai", "downloads.claude.ai"]);
const CODEX_NPM_PACKAGE = "@openai/codex";
const CODEX_NPM_REGISTRY = "https://registry.npmjs.org/@openai%2fcodex";
const CODEX_NPM_REGISTRY_BASE = "https://registry.npmjs.org/";
const MAX_INSTALL_SCRIPT_BYTES = 16 * 1024 * 1024;

export function detectCliToolPlatform(platform: NodeJS.Platform = process.platform, arch: string = process.arch): CliToolPlatform | null {
  if (platform === "win32") return arch === "x64" || arch === "ia32" ? "windows-x64" : null;
  if (platform === "darwin") return arch === "arm64" ? "macos-arm64" : arch === "x64" ? "macos-x64" : null;
  return null;
}

/** Resolve the app-private launcher, including npm-generated Windows shims. */
export function resolveAppToolExecutable(cli: CliToolId, paths: AppPaths = getAppPaths()): string | null {
  return existingExecutable(paths, cli, process.platform) || null;
}

export class CliInstallerService {
  private readonly transport: CliInstallerTransport;
  private readonly commandRunner: CliCommandRunner;
  private readonly resolveNodeRuntime: () => ManagedNodeRuntime | null;
  private readonly progressListener: (progress: CliInstallProgress) => void;
  private readonly platform: NodeJS.Platform;
  private readonly arch: string;
  private readonly systemPathResolver: (cli: CliToolId) => string | null;
  private readonly active = new Map<CliToolId, AbortController>();

  constructor(private readonly paths: AppPaths, options: CliInstallerOptions | CliInstallerTransport = {}) {
    if (typeof options === "function") {
      this.transport = options;
      this.commandRunner = defaultCommandRunner;
      this.resolveNodeRuntime = () => null;
      this.progressListener = () => undefined;
      this.platform = process.platform;
      this.arch = process.arch;
      this.systemPathResolver = defaultSystemPathResolver;
    } else {
      this.transport = options.transport || defaultTransport;
      this.commandRunner = options.commandRunner || defaultCommandRunner;
      this.resolveNodeRuntime = options.resolveNodeRuntime || (() => null);
      this.progressListener = options.onProgress || (() => undefined);
      this.platform = options.platform || process.platform;
      this.arch = options.arch || process.arch;
      this.systemPathResolver = options.systemPathResolver || defaultSystemPathResolver;
    }
  }

  /** Detects app-private first, then a user-managed system PATH install. */
  detect(cli: CliToolId): CliDetection {
    const appPath = existingExecutable(this.paths, cli, this.platform);
    if (appPath && this.readManifest(cli)) return { installed: true, source: "app-tools", executablePath: appPath };
    const systemPath = this.systemPathResolver(cli);
    return systemPath
      ? { installed: true, source: "system-path", executablePath: systemPath }
      : { installed: false, source: null, executablePath: null };
  }

  status(cli: CliToolId): CliInstallStatus {
    const executablePath = existingExecutable(this.paths, cli, this.platform) || primaryExecutable(this.paths, cli, this.platform);
    const manifest = this.readManifest(cli);
    return {
      cli,
      installed: Boolean(manifest && fs.existsSync(executablePath)),
      version: manifest?.version ?? null,
      digest: manifest?.digest ?? null,
      sourceUrl: manifest?.sourceUrl ?? null,
      installedAt: manifest?.installedAt ?? null,
      executablePath
    };
  }

  list(): CliInstallStatus[] {
    return CLI_IDS.map((cli) => this.status(cli));
  }

  executablePath(cli: CliToolId): string {
    return primaryExecutable(this.paths, cli, this.platform);
  }

  cancel(cli: CliToolId): boolean {
    const controller = this.active.get(cli);
    if (!controller) return false;
    controller.abort();
    return true;
  }

  async install(cli: CliToolId, onProgress: (progress: CliInstallProgress) => void = () => undefined, options: { force?: boolean } = {}): Promise<CliInstallStatus> {
    const platform = detectCliToolPlatform(this.platform, this.arch);
    if (!platform) throw new CliInstallerError({ code: "platform-unsupported", message: "当前版本只支持 Windows 原生和 macOS 一键安装，请参考手动安装步骤。" });
    const current = this.status(cli);
    if (current.installed && !options.force) return current;
    if (this.active.has(cli)) throw new CliInstallerError({ code: "install-command-failed", message: `${cli} 正在安装，请等待当前安装完成。` });

    const controller = new AbortController();
    this.active.set(cli, controller);
    fs.mkdirSync(this.paths.staging, { recursive: true, mode: 0o700 });
    const stagingRoot = fs.mkdtempSync(path.join(this.paths.staging, `cli-${cli}-`));
    const emit = (progress: CliInstallProgress) => {
      this.progressListener(progress);
      onProgress(progress);
    };
    try {
      emit({ cli, phase: "resolving", message: "正在准备官方安装来源…" });
      const result = cli === "claude"
        ? await this.installClaudeNative(cli, stagingRoot, controller.signal, emit)
        : await this.installCodexNpm(cli, platform, stagingRoot, controller.signal, emit);
      emit({ cli, phase: "done", version: result.version, message: "安装完成。" });
      return this.status(cli);
    } catch (error) {
      if (isAbortError(error) || controller.signal.aborted) {
        emit({ cli, phase: "cancelled", message: "已取消安装，临时文件已清理。" });
        throw new CliInstallerError({ code: "cancelled", message: "已取消 CLI 安装，临时文件已清理。" });
      }
      throw error;
    } finally {
      if (this.active.get(cli) === controller) this.active.delete(cli);
      fs.rmSync(stagingRoot, { recursive: true, force: true });
    }
  }

  async upgrade(cli: CliToolId): Promise<CliInstallStatus> {
    return this.install(cli, () => undefined, { force: true });
  }

  async checkForUpdate(cli: CliToolId): Promise<CliToolUpdate> {
    const current = this.status(cli);
    const detected = current.installed ? { installed: true, executablePath: current.executablePath } : this.detect(cli);
    const currentVersion = current.version || await this.probeExecutableVersion(detected.executablePath);
    const source = cli === "codex" ? "npm" : "official";
    let latestVersion: string | null = null;
    try {
      const url = cli === "codex"
        ? CODEX_NPM_REGISTRY
        : CLAUDE_VERSION_ENDPOINT;
      const response = await this.transport(url);
      if (response.statusCode !== 200) throw new Error(`HTTP ${response.statusCode}`);
      if (cli === "codex") {
        let payload: unknown;
        try { payload = JSON.parse(response.body.toString("utf8")); } catch { payload = null; }
        const distTags = payload && typeof payload === "object" && "dist-tags" in payload ? (payload as { "dist-tags"?: unknown })["dist-tags"] : null;
        latestVersion = distTags && typeof distTags === "object" && typeof (distTags as { latest?: unknown }).latest === "string"
          ? (distTags as { latest: string }).latest
          : null;
      } else {
        // The endpoint returns a plain-text version such as "2.1.233".
        latestVersion = parseVersion(response.body.toString("utf8"));
      }
    } catch {
      // Version checks are best-effort. The caller still receives the local
      // version and can use the official upgrade path when available.
      latestVersion = null;
    }
    const comparison = currentVersion && latestVersion ? compareVersions(currentVersion, latestVersion) : null;
    const managedPlatform = detectCliToolPlatform(this.platform, this.arch);
    // A CLI discovered on PATH can still be upgraded safely: install the new
    // version into OpenMind's private tools directory, which providers already
    // prefer over the user-managed executable. The system installation remains
    // untouched and no elevated permissions are required.
    const canUpgrade = Boolean(
      detected.installed
      && managedPlatform
      && (cli === "claude" || this.resolveNodeRuntime())
    );
    return {
      cli,
      installed: current.installed || detected.installed,
      currentVersion,
      latestVersion,
      updateAvailable: comparison !== null ? comparison < 0 : false,
      canUpgrade,
      checkedAt: new Date().toISOString(),
      source: current.installed || detected.installed ? source : "unknown"
    };
  }

  private async probeExecutableVersion(executablePath: string | null): Promise<string | null> {
    if (!executablePath) return null;
    try {
      const output = await this.commandRunner(executablePath, ["--version"], {
        cwd: process.cwd(),
        env: process.env,
        signal: new AbortController().signal
      });
      return parseVersion(output.stdout) || parseVersion(output.stderr);
    } catch {
      return null;
    }
  }

  private async installClaudeNative(
    cli: CliToolId,
    stagingRoot: string,
    signal: AbortSignal,
    emit: (progress: CliInstallProgress) => void
  ): Promise<{ version: string }> {
    const scriptUrl = this.platform === "win32" ? CLAUDE_INSTALL_SCRIPT.win32 : CLAUDE_INSTALL_SCRIPT.darwin;
    emit({ cli, phase: "downloading", message: "正在下载 Claude Code 官方安装脚本…" });
    const response = await this.downloadOfficial(scriptUrl, signal, MAX_INSTALL_SCRIPT_BYTES);
    const digest = sha256(response.body);
    emit({ cli, phase: "verifying", receivedBytes: response.body.length, totalBytes: response.body.length, message: `安装脚本 SHA-256：${digest.slice(0, 16)}…` });
    const scriptPath = path.join(stagingRoot, this.platform === "win32" ? "install.ps1" : "install.sh");
    fs.writeFileSync(scriptPath, response.body, { mode: 0o600 });
    const isolatedHome = path.join(stagingRoot, "native-home");
    fs.mkdirSync(isolatedHome, { recursive: true, mode: 0o700 });
    emit({ cli, phase: "installing", message: "正在把 Claude Code 安装到应用私有目录…" });
    const env: NodeJS.ProcessEnv = {
      ...safeInstallerEnvironment(),
      HOME: isolatedHome,
      USERPROFILE: isolatedHome,
      LOCALAPPDATA: path.join(isolatedHome, "AppData", "Local"),
      CLAUDE_CONFIG_DIR: path.join(isolatedHome, ".claude"),
      OPENMIND_CLI_INSTALL_DIR: isolatedHome
    };
    const command = this.platform === "win32" ? "powershell.exe" : "sh";
    const args = this.platform === "win32"
      ? ["-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", scriptPath]
      : [scriptPath];
    let output: { stdout: string; stderr: string };
    try {
      output = await this.commandRunner(command, args, { cwd: stagingRoot, env, signal });
    } catch (error) {
      throw new CliInstallerError({ code: "install-command-failed", message: `Claude Code 官方安装器执行失败：${redactCommandError(error)}` });
    }
    const installed = findNativeClaudeLauncher(isolatedHome, this.platform);
    if (!installed) throw new CliInstallerError({ code: "binary-not-found", message: `Claude Code 安装器未在应用私有目录生成可执行文件。${tailOutput(output.stderr || output.stdout)}` });
    const version = parseVersion(output.stdout) || "latest";
    promoteNativeInstall(this.paths, cli, isolatedHome, installed, this.platform);
    try {
      writeManifest(this.paths, cli, { schemaVersion: 1, cli, version, digest: sha256Tree(path.join(this.paths.tools, "native", cli)), sourceUrl: scriptUrl, method: "claude-native", installedAt: new Date().toISOString() });
    } catch (error) {
      removeInstalledState(this.paths, cli, this.platform, "native");
      throw new CliInstallerError({ code: "install-command-failed", message: `Claude Code 安装清单写入失败，已回滚：${redactCommandError(error)}` });
    }
    return { version };
  }

  private async installCodexNpm(
    cli: CliToolId,
    _platform: CliToolPlatform,
    stagingRoot: string,
    signal: AbortSignal,
    emit: (progress: CliInstallProgress) => void
  ): Promise<{ version: string }> {
    const runtime = this.resolveNodeRuntime();
    if (!runtime) throw new CliInstallerError({ code: "runtime-unavailable", message: "应用内置 Node Runtime Pack 尚未 ready，暂时不能安装 Codex CLI。请先在设置中准备内置运行时。" });
    const prefix = path.join(stagingRoot, "npm-global", cli);
    fs.mkdirSync(prefix, { recursive: true, mode: 0o700 });
    emit({ cli, phase: "installing", message: "正在使用应用内置 Node 安装 Codex CLI（不调用系统 npm）…" });
    let output: { stdout: string; stderr: string };
    try {
      const npmrc = path.join(stagingRoot, "npmrc");
      fs.writeFileSync(npmrc, "", { encoding: "utf8", mode: 0o600 });
      output = await this.commandRunner(runtime.nodeExecutable, [
        runtime.npmCliPath,
        "install",
        "--prefix", prefix,
        "--no-package-lock",
        "--no-audit",
        "--no-fund",
        "--ignore-scripts",
        "--registry", CODEX_NPM_REGISTRY_BASE,
        CODEX_NPM_PACKAGE
      ], { cwd: stagingRoot, env: managedNpmEnvironment(prefix, npmrc), signal });
    } catch (error) {
      throw new CliInstallerError({ code: "install-command-failed", message: `Codex CLI 便携安装失败：${redactCommandError(error)}` });
    }
    const packageRoot = path.join(prefix, "node_modules", "@openai", "codex");
    const packageJsonPath = path.join(packageRoot, "package.json");
    let packageJson: { version?: unknown; bin?: unknown };
    try { packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8")) as { version?: unknown; bin?: unknown }; }
    catch { throw new CliInstallerError({ code: "binary-not-found", message: `Codex CLI 安装后缺少 package.json。${tailOutput(output.stderr || output.stdout)}` }); }
    const binValue = typeof packageJson.bin === "string"
      ? packageJson.bin
      : packageJson.bin && typeof packageJson.bin === "object" && typeof (packageJson.bin as { codex?: unknown }).codex === "string"
        ? (packageJson.bin as { codex: string }).codex
        : null;
    if (!binValue) throw new CliInstallerError({ code: "binary-not-found", message: "Codex CLI package 没有声明 codex 命令。" });
    const entry = path.resolve(packageRoot, binValue);
    if (!entry.startsWith(`${path.resolve(packageRoot)}${path.sep}`) || !fs.existsSync(entry)) {
      throw new CliInstallerError({ code: "binary-not-found", message: "Codex CLI 命令入口不存在，已回滚临时目录。" });
    }
    const version = typeof packageJson.version === "string" ? packageJson.version : parseVersion(output.stdout) || "latest";
    const finalPrefix = path.join(this.paths.tools, "npm-global", cli);
    const launcher = primaryExecutable(this.paths, cli, this.platform);
    try {
      fs.mkdirSync(path.dirname(finalPrefix), { recursive: true });
      if (fs.existsSync(finalPrefix)) fs.rmSync(finalPrefix, { recursive: true, force: true });
      fs.renameSync(prefix, finalPrefix);
      writeLauncher(launcher, runtime.nodeExecutable, path.join(finalPrefix, "node_modules", "@openai", "codex", binValue), this.platform);
    } catch (error) {
      fs.rmSync(finalPrefix, { recursive: true, force: true });
      throw new CliInstallerError({ code: "install-command-failed", message: `Codex CLI 安装提交失败：${redactCommandError(error)}` });
    }
    try {
      writeManifest(this.paths, cli, { schemaVersion: 1, cli, version, digest: sha256Tree(finalPrefix), sourceUrl: CODEX_NPM_REGISTRY, method: "codex-npm", installedAt: new Date().toISOString() });
    } catch (error) {
      removeInstalledState(this.paths, cli, this.platform, "npm");
      throw new CliInstallerError({ code: "install-command-failed", message: `Codex CLI 安装清单写入失败，已回滚：${redactCommandError(error)}` });
    }
    return { version };
  }

  private async downloadOfficial(url: string, signal: AbortSignal, maxBytes: number): Promise<CliInstallerResponse> {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" || parsed.hostname !== "claude.ai") {
      throw new CliInstallerError({ code: "download-failed", message: "CLI 安装来源不在官方 HTTPS 白名单内，已拒绝下载。" });
    }
    let response: CliInstallerResponse;
    try { response = await this.transport(url, signal); }
    catch (error) { if (isAbortError(error) || signal.aborted) throw error; throw new CliInstallerError({ code: "download-failed", message: "官方安装脚本下载失败，请检查网络后重试。" }); }
    if (response.statusCode !== 200) throw new CliInstallerError({ code: "download-failed", message: `官方安装脚本下载失败（HTTP ${response.statusCode}）。` });
    if (response.finalUrl) {
      let final: URL;
      try { final = new URL(response.finalUrl); }
      catch { throw new CliInstallerError({ code: "download-failed", message: "官方安装脚本重定向地址无效，已拒绝下载。" }); }
      if (final.protocol !== "https:" || !CLAUDE_OFFICIAL_HOSTS.has(final.hostname)) {
        throw new CliInstallerError({ code: "download-failed", message: "官方安装脚本重定向到了非白名单域名，已拒绝下载。" });
      }
    }
    if (response.body.byteLength > maxBytes) throw new CliInstallerError({ code: "download-failed", message: "官方安装脚本超过大小限制，已拒绝下载。" });
    return response;
  }

  private readManifest(cli: CliToolId): CliInstallManifest | null {
    const file = path.join(this.paths.toolBin, `${cli}-manifest.json`);
    try {
      const value = JSON.parse(fs.readFileSync(file, "utf8")) as Partial<CliInstallManifest>;
      if (value.schemaVersion !== 1 || value.cli !== cli || typeof value.version !== "string" || !/^[a-f0-9]{64}$/.test(value.digest || "")) return null;
      return value as CliInstallManifest;
    } catch { return null; }
  }
}

function primaryExecutable(paths: AppPaths, cli: CliToolId, platform: NodeJS.Platform): string {
  return path.join(paths.toolBin, platform === "win32" ? `${cli}.cmd` : cli);
}

function existingExecutable(paths: AppPaths, cli: CliToolId, platform: NodeJS.Platform): string | null {
  const names = platform === "win32" ? [`${cli}.cmd`, `${cli}.exe`, `${cli}.bat`, `${cli}.ps1`, cli] : [cli];
  return names.map((name) => path.join(paths.toolBin, name)).find((candidate) => {
    try { return fs.statSync(candidate).isFile(); } catch { return false; }
  }) || null;
}

function writeManifest(paths: AppPaths, cli: CliToolId, manifest: CliInstallManifest): void {
  fs.mkdirSync(paths.toolBin, { recursive: true });
  const file = path.join(paths.toolBin, `${cli}-manifest.json`);
  const temporary = `${file}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(temporary, JSON.stringify(manifest, null, 2), { encoding: "utf8", mode: 0o600 });
  fs.renameSync(temporary, file);
}

function removeInstalledState(paths: AppPaths, cli: CliToolId, platform: NodeJS.Platform, kind: "native" | "npm"): void {
  const root = kind === "native"
    ? path.join(paths.tools, "native", cli)
    : path.join(paths.tools, "npm-global", cli);
  fs.rmSync(root, { recursive: true, force: true });
  for (const name of platform === "win32" ? [`${cli}.cmd`, `${cli}.exe`, `${cli}.bat`, `${cli}.ps1`, cli] : [cli]) {
    fs.rmSync(path.join(paths.toolBin, name), { force: true });
  }
  fs.rmSync(path.join(paths.toolBin, `${cli}-manifest.json`), { force: true });
}

function findNativeClaudeLauncher(home: string, platform: NodeJS.Platform): string | null {
  const names = platform === "win32" ? ["claude.exe", "claude.cmd", "claude"] : ["claude"];
  const candidates = names.flatMap((name) => [
    path.join(home, ".local", "bin", name),
    path.join(home, "AppData", "Local", "Programs", "claude", name)
  ]);
  return candidates.find((candidate) => { try { return fs.statSync(candidate).isFile(); } catch { return false; } }) || null;
}

function promoteNativeInstall(paths: AppPaths, cli: CliToolId, home: string, launcher: string, platform: NodeJS.Platform): void {
  const destination = path.join(paths.tools, "native", cli);
  const target = primaryExecutable(paths, cli, platform);
  try {
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    if (fs.existsSync(destination)) fs.rmSync(destination, { recursive: true, force: true });
    fs.renameSync(home, destination);
    const movedLauncher = path.join(destination, path.relative(home, launcher));
    writeLauncher(target, "", movedLauncher, platform, true, destination);
  } catch (error) {
    fs.rmSync(destination, { recursive: true, force: true });
    throw new CliInstallerError({ code: "install-command-failed", message: `Claude Code 私有目录提交失败：${redactCommandError(error)}` });
  }
}

function writeLauncher(target: string, nodeExecutable: string, entry: string, platform: NodeJS.Platform, native = false, nativeHome?: string): void {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const temporary = `${target}.tmp-${process.pid}-${Date.now()}`;
  const quoteSh = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
  const quoteCmd = (value: string) => `"${value.replaceAll('"', '""')}"`;
  const nativeRoot = nativeHome || path.dirname(path.dirname(entry));
  const contents = platform === "win32"
    ? native
      ? `@echo off\r\nset "HOME=${nativeRoot}"\r\nset "USERPROFILE=${nativeRoot}"\r\ncall ${quoteCmd(entry)} %*\r\n`
      : `@echo off\r\n${quoteCmd(nodeExecutable)} ${quoteCmd(entry)} %*\r\n`
    : native
      ? `#!/bin/sh\nexport HOME=${quoteSh(nativeRoot)}\nexport USERPROFILE=$HOME\nexec ${quoteSh(entry)} "$@"\n`
      : `#!/bin/sh\nexec ${quoteSh(nodeExecutable)} ${quoteSh(entry)} "$@"\n`;
  fs.writeFileSync(temporary, contents, { encoding: "utf8", mode: platform === "win32" ? 0o600 : 0o700 });
  if (platform !== "win32") fs.chmodSync(temporary, 0o755);
  fs.renameSync(temporary, target);
}

function sha256(value: Uint8Array): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function sha256Tree(root: string): string {
  const hash = crypto.createHash("sha256");
  const visit = (current: string, relative: string) => {
    const entries = fs.readdirSync(current, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const child = path.join(current, entry.name);
      const childRelative = path.join(relative, entry.name).split(path.sep).join("/");
      if (entry.isSymbolicLink()) { hash.update(`link:${childRelative}:${fs.readlinkSync(child)}\n`); continue; }
      if (entry.isDirectory()) { hash.update(`dir:${childRelative}\n`); visit(child, childRelative); continue; }
      if (entry.isFile()) { hash.update(`file:${childRelative}:`); hash.update(fs.readFileSync(child)); hash.update("\n"); }
    }
  };
  visit(root, "");
  return hash.digest("hex");
}

function parseVersion(value: string): string | null {
  return value.match(/\b\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?\b/)?.[0] || null;
}

function compareVersions(left: string, right: string): number | null {
  const parse = (value: string) => {
    const match = value.match(/^(?:v)?(\d+)\.(\d+)\.(\d+)(?:[-+]([0-9A-Za-z.-]+))?$/);
    return match ? { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]), pre: match[4] || null } : null;
  };
  const a = parse(left);
  const b = parse(right);
  if (!a || !b) return null;
  for (const key of ["major", "minor", "patch"] as const) {
    if (a[key] !== b[key]) return a[key] < b[key] ? -1 : 1;
  }
  if (a.pre === b.pre) return 0;
  if (!a.pre) return 1;
  if (!b.pre) return -1;
  return a.pre.localeCompare(b.pre);
}

function tailOutput(value: string): string {
  const text = value.trim().replace(/\s+/g, " ");
  return text ? `（${text.slice(-180)}）` : "";
}

function redactCommandError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/(?:[A-Za-z]:[\\/]|\/)[^\s]+/g, "<path>").slice(0, 240);
}

function isAbortError(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && ((error as { name?: unknown }).name === "AbortError" || (error as { code?: unknown }).code === "ABORT_ERR"));
}

function defaultSystemPathResolver(cli: CliToolId): string | null {
  try {
    const command = process.platform === "win32" ? "where.exe" : "which";
    const output = require("node:child_process").execFileSync(command, [cli], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], windowsHide: true });
    return String(output).split(/\r?\n/).map((line) => line.trim()).find(Boolean) || null;
  } catch { return null; }
}

async function defaultTransport(url: string, signal?: AbortSignal): Promise<CliInstallerResponse> {
  const response = await fetch(url, { redirect: "follow", signal, headers: { "User-Agent": "openmind-desktop" } });
  return { statusCode: response.status, finalUrl: response.url, body: Buffer.from(await response.arrayBuffer()) };
}

function safeInstallerEnvironment(): NodeJS.ProcessEnv {
  const allowed = ["PATH", "PATHEXT", "ComSpec", "SystemRoot", "TEMP", "TMP", "TMPDIR", "SHELL", "LANG", "LC_ALL", "LC_CTYPE"];
  return Object.fromEntries(allowed.flatMap((key) => process.env[key] ? [[key, process.env[key]]] : []));
}

function managedNpmEnvironment(prefix: string, npmrc: string): NodeJS.ProcessEnv {
  return {
    ...safeInstallerEnvironment(),
    npm_config_prefix: prefix,
    npm_config_userconfig: npmrc,
    npm_config_cache: path.join(path.dirname(prefix), "cache"),
    npm_config_registry: CODEX_NPM_REGISTRY_BASE,
    npm_config_update_notifier: "false",
    npm_config_ignore_scripts: "true"
  };
}

function defaultCommandRunner(command: string, args: string[], options: { cwd: string; env: NodeJS.ProcessEnv; signal: AbortSignal }): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: options.cwd, env: options.env, shell: false, windowsHide: true, stdio: ["ignore", "pipe", "pipe"], signal: options.signal });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout = `${stdout}${String(chunk)}`.slice(-512 * 1024); });
    child.stderr.on("data", (chunk) => { stderr = `${stderr}${String(chunk)}`.slice(-512 * 1024); });
    child.once("error", reject);
    child.once("close", (code) => code === 0 ? resolve({ stdout, stderr }) : reject(Object.assign(new Error(stderr || `${command} exited with ${code}`), { code: code ?? "COMMAND_FAILED" })));
  });
}

/** Kept as a small public utility for package-format tests and future signed release assets. */
export function extractBinary(archive: Buffer, assetName: string, binary: string): Buffer | null {
  const lowerAsset = assetName.toLocaleLowerCase();
  try {
    const entries = lowerAsset.endsWith(".zip")
      ? unzipSync(new Uint8Array(archive))
      : parseTar(gunzipSync(new Uint8Array(archive)));
    let best: Uint8Array | null = null;
    for (const [entryName, data] of Object.entries(entries)) {
      if (!(data instanceof Uint8Array) || data.length === 0) continue;
      const base = path.posix.basename(entryName.toLocaleLowerCase()).replace(/\.(exe|cmd|bat)$/, "");
      if (base !== binary.toLocaleLowerCase() || (best && data.length <= best.length)) continue;
      best = data;
    }
    return best ? Buffer.from(best) : null;
  } catch {
    throw new CliInstallerError({ code: "archive-invalid", message: "安装包解压失败，请使用手动安装步骤。" });
  }
}

function parseTar(bytes: Uint8Array): Record<string, Uint8Array> {
  const entries: Record<string, Uint8Array> = {};
  let offset = 0;
  while (offset + 512 <= bytes.length) {
    const header = bytes.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) break;
    const name = Buffer.from(header.subarray(0, 100)).toString("utf8").replace(/\0.*$/, "");
    const size = parseInt(Buffer.from(header.subarray(124, 136)).toString("utf8").trim() || "0", 8) || 0;
    const typeFlag = String.fromCharCode(header[156] || 0);
    offset += 512;
    if (name && typeFlag !== "5" && typeFlag !== "L") entries[name] = bytes.subarray(offset, offset + size);
    offset += Math.ceil(size / 512) * 512;
  }
  return entries;
}
