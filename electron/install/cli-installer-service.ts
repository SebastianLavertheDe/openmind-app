import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { gunzipSync, unzipSync } from "fflate";
import { getAppPaths, type AppPaths } from "../paths/app-paths-service";
import type { CliToolUpdateView } from "../../shared/contracts";

/** The first distribution phase deliberately promises only native Windows/macOS. */
export type CliToolId = "claude" | "codex";
export type CliToolPlatform = "windows-x64" | "windows-arm64" | "macos-arm64" | "macos-x64";
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

export type CliToolUpdate = CliToolUpdateView;

export type CliInstallerErrorCode =
  | "platform-unsupported"
  | "release-lookup-failed"
  | "asset-not-found"
  | "download-failed"
  | "digest-mismatch"
  | "archive-invalid"
  | "binary-not-found"
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

export type CliInstallerOptions = {
  transport?: CliInstallerTransport;
  commandRunner?: CliCommandRunner;
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
  /** codex-npm is retained only so manifests from older builds stay readable. */
  method: "claude-native" | "codex-standalone" | "codex-npm";
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
const CODEX_INSTALL_SCRIPT = {
  darwin: "https://chatgpt.com/codex/install.sh",
  win32: "https://chatgpt.com/codex/install.ps1"
} as const;
const CODEX_VERSION_ENDPOINT = "https://releases.openai.com/codex/channels/latest";
const CODEX_OFFICIAL_HOSTS = new Set(["chatgpt.com", "releases.openai.com"]);
const MAX_INSTALL_SCRIPT_BYTES = 16 * 1024 * 1024;
const SYSTEM_PATH_RESOLVE_TIMEOUT_MS = 5_000;
const VERSION_LOOKUP_TIMEOUT_MS = 5_000;
const CLI_NPM_PACKAGES = { codex: "@openai/codex", claude: "@anthropic-ai/claude-code" } as const;

export function detectCliToolPlatform(platform: NodeJS.Platform = process.platform, arch: string = process.arch): CliToolPlatform | null {
  if (platform === "win32") return arch === "x64" || arch === "ia32" ? "windows-x64" : arch === "arm64" ? "windows-arm64" : null;
  if (platform === "darwin") return arch === "arm64" ? "macos-arm64" : arch === "x64" ? "macos-x64" : null;
  return null;
}

/** Resolve the app-private launcher, including generated Windows shims. */
export function resolveAppToolExecutable(cli: CliToolId, paths: AppPaths = getAppPaths()): string | null {
  return existingExecutable(paths, cli, process.platform) || null;
}

export class CliInstallerService {
  private readonly transport: CliInstallerTransport;
  private readonly commandRunner: CliCommandRunner;
  private readonly progressListener: (progress: CliInstallProgress) => void;
  private readonly platform: NodeJS.Platform;
  private readonly arch: string;
  private readonly systemPathResolver: (cli: CliToolId) => string | null;
  private readonly active = new Map<CliToolId, AbortController>();

  constructor(private readonly paths: AppPaths, options: CliInstallerOptions | CliInstallerTransport = {}) {
    if (typeof options === "function") {
      this.transport = options;
      this.commandRunner = defaultCommandRunner;
      this.progressListener = () => undefined;
      this.platform = process.platform;
      this.arch = process.arch;
      this.systemPathResolver = defaultSystemPathResolver;
    } else {
      this.transport = options.transport || defaultTransport;
      this.commandRunner = options.commandRunner || defaultCommandRunner;
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
    const legacyCodexInstall = cli === "codex" && this.readManifest(cli)?.method === "codex-npm";
    if (current.installed && !options.force && !legacyCodexInstall) return current;
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
        : await this.installCodexStandalone(cli, stagingRoot, controller.signal, emit);
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
    let source: CliToolUpdate["source"] = "unknown";
    let latestVersion: string | null = null;
    let error: CliToolUpdate["error"];
    const packageName = CLI_NPM_PACKAGES[cli];
    const sources = [
      { url: cli === "codex" ? CODEX_VERSION_ENDPOINT : CLAUDE_VERSION_ENDPOINT, source: "official" },
      // Read metadata only. Upgrades still use the official native installer.
      { url: `https://registry.npmjs.org/${packageName.replace("/", "%2f")}/latest`, source: "npm" }
    ] as const;
    for (const candidate of sources) {
      const signal = AbortSignal.timeout(VERSION_LOOKUP_TIMEOUT_MS);
      try {
        const response = await this.transport(candidate.url, signal);
        if (response.statusCode !== 200) {
          error = { code: "http", statusCode: response.statusCode };
          continue;
        }
        const text = response.body.toString("utf8").trim();
        if (candidate.source === "official" && cli === "claude") {
          latestVersion = parseReleaseVersion(text);
        } else {
          const payload = JSON.parse(text) as { name?: unknown; version?: unknown; tag_name?: unknown } | null;
          const version = candidate.source === "npm"
            ? payload?.name === packageName ? payload.version : null
            : payload?.tag_name;
          latestVersion = parseReleaseVersion(version);
        }
        if (!latestVersion) {
          error = { code: "invalid-response" };
          continue;
        }
        source = candidate.source;
        error = undefined;
        break;
      } catch (cause) {
        error = { code: signal.aborted ? "timeout" : cause instanceof SyntaxError ? "invalid-response" : "network" };
      }
    }
    const comparison = currentVersion && latestVersion ? compareVersions(currentVersion, latestVersion) : null;
    const managedPlatform = detectCliToolPlatform(this.platform, this.arch);
    // A CLI discovered on PATH can still be upgraded safely: install the new
    // version into OpenMind's private tools directory, which providers already
    // prefer over the user-managed executable. The system installation remains
    // untouched and no elevated permissions are required.
    const canUpgrade = Boolean(detected.installed && managedPlatform);
    return {
      cli,
      installed: current.installed || detected.installed,
      currentVersion,
      latestVersion,
      updateAvailable: comparison !== null ? comparison < 0 : false,
      canUpgrade,
      checkedAt: new Date().toISOString(),
      source,
      ...(error ? { error } : {})
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
    const response = await this.downloadOfficial(scriptUrl, signal, MAX_INSTALL_SCRIPT_BYTES, CLAUDE_OFFICIAL_HOSTS);
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

  private async installCodexStandalone(
    cli: CliToolId,
    stagingRoot: string,
    signal: AbortSignal,
    emit: (progress: CliInstallProgress) => void
  ): Promise<{ version: string }> {
    const scriptUrl = this.platform === "win32" ? CODEX_INSTALL_SCRIPT.win32 : CODEX_INSTALL_SCRIPT.darwin;
    emit({ cli, phase: "downloading", message: "正在下载 Codex CLI 官方独立安装脚本…" });
    const response = await this.downloadOfficial(scriptUrl, signal, MAX_INSTALL_SCRIPT_BYTES, CODEX_OFFICIAL_HOSTS);
    const scriptDigest = sha256(response.body);
    emit({ cli, phase: "verifying", receivedBytes: response.body.length, totalBytes: response.body.length, message: `安装脚本 SHA-256：${scriptDigest.slice(0, 16)}…` });
    const scriptPath = path.join(stagingRoot, this.platform === "win32" ? "install.ps1" : "install.sh");
    fs.writeFileSync(scriptPath, response.body, { mode: 0o600 });

    // CODEX_HOME stores the standalone release payload while CODEX_INSTALL_DIR
    // is the official installer's visible command directory. Both paths are
    // stable App-owned locations: the installer's symlinks/junctions therefore
    // remain valid after this request's staging directory is removed.
    const nativeRoot = path.join(this.paths.tools, "native", cli);
    const installDir = path.join(nativeRoot, "bin");
    const codexHome = path.join(nativeRoot, "home");
    const installerHome = path.join(stagingRoot, "installer-home");
    const hadNativeRoot = fs.existsSync(nativeRoot);
    fs.mkdirSync(installDir, { recursive: true, mode: 0o700 });
    fs.mkdirSync(codexHome, { recursive: true, mode: 0o700 });
    fs.mkdirSync(installerHome, { recursive: true, mode: 0o700 });

    emit({ cli, phase: "installing", message: "正在使用 OpenAI 官方独立安装器安装 Codex CLI…" });
    const env: NodeJS.ProcessEnv = {
      ...safeInstallerEnvironment(),
      HOME: installerHome,
      USERPROFILE: installerHome,
      LOCALAPPDATA: path.join(installerHome, "AppData", "Local"),
      CODEX_HOME: codexHome,
      CODEX_INSTALL_DIR: installDir,
      CODEX_NON_INTERACTIVE: "1",
      ...(this.platform === "win32" ? { OS: "Windows_NT" } : {})
    };
    const command = this.platform === "win32" ? "powershell.exe" : "sh";
    const args = this.platform === "win32"
      ? ["-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", scriptPath]
      : [scriptPath];
    let output: { stdout: string; stderr: string };
    try {
      output = await this.commandRunner(command, args, { cwd: stagingRoot, env, signal });
    } catch (error) {
      if (!hadNativeRoot) fs.rmSync(nativeRoot, { recursive: true, force: true });
      throw new CliInstallerError({ code: "install-command-failed", message: `Codex CLI 官方安装器执行失败：${redactCommandError(error)}` });
    }

    const installed = findNativeCodexLauncher(installDir, this.platform);
    if (!installed) {
      if (!hadNativeRoot) fs.rmSync(nativeRoot, { recursive: true, force: true });
      throw new CliInstallerError({ code: "binary-not-found", message: `Codex CLI 官方安装器未生成可执行文件。${tailOutput(output.stderr || output.stdout)}` });
    }
    let probe: { stdout: string; stderr: string };
    try {
      probe = await this.commandRunner(installed, ["--version"], { cwd: stagingRoot, env, signal });
    } catch (error) {
      if (!hadNativeRoot) fs.rmSync(nativeRoot, { recursive: true, force: true });
      throw new CliInstallerError({ code: "install-command-failed", message: `Codex CLI 安装后校验失败：${redactCommandError(error)}` });
    }
    const version = parseVersion(probe.stdout) || parseVersion(probe.stderr) || parseVersion(output.stdout) || parseVersion(output.stderr);
    if (!version) {
      if (!hadNativeRoot) fs.rmSync(nativeRoot, { recursive: true, force: true });
      throw new CliInstallerError({ code: "binary-not-found", message: "Codex CLI 已生成命令，但无法识别其版本，安装未提交。" });
    }

    const launcher = primaryExecutable(this.paths, cli, this.platform);
    const manifestFile = path.join(this.paths.toolBin, `${cli}-manifest.json`);
    const launcherBackup = readFileSnapshot(launcher);
    const manifestBackup = readFileSnapshot(manifestFile);
    try {
      // Runtime sessions provide their own CODEX_HOME, so the final launcher
      // intentionally does not pin HOME/USERPROFILE to the installation tree.
      writeNativeLauncher(launcher, installed, this.platform);
      writeManifest(this.paths, cli, { schemaVersion: 1, cli, version, digest: sha256Tree(nativeRoot), sourceUrl: scriptUrl, method: "codex-standalone", installedAt: new Date().toISOString() });
    } catch (error) {
      restoreFileSnapshot(launcher, launcherBackup);
      restoreFileSnapshot(manifestFile, manifestBackup);
      if (!hadNativeRoot) fs.rmSync(nativeRoot, { recursive: true, force: true });
      throw new CliInstallerError({ code: "install-command-failed", message: `Codex CLI 安装清单写入失败，已回滚：${redactCommandError(error)}` });
    }
    // Successful standalone installs supersede the older App-managed npm
    // layout. A user-managed global npm installation is never touched.
    fs.rmSync(path.join(this.paths.tools, "npm-global", cli), { recursive: true, force: true });
    return { version };
  }

  private async downloadOfficial(url: string, signal: AbortSignal, maxBytes: number, allowedHosts: ReadonlySet<string>): Promise<CliInstallerResponse> {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" || !allowedHosts.has(parsed.hostname)) {
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
      if (final.protocol !== "https:" || !allowedHosts.has(final.hostname)) {
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

function findNativeCodexLauncher(installDir: string, platform: NodeJS.Platform): string | null {
  const names = platform === "win32" ? ["codex.exe", "codex.cmd", "codex.bat", "codex.ps1", "codex"] : ["codex"];
  return names.map((name) => path.join(installDir, name)).find((candidate) => {
    try { return fs.statSync(candidate).isFile(); } catch { return false; }
  }) || null;
}

function promoteNativeInstall(paths: AppPaths, cli: CliToolId, home: string, launcher: string, platform: NodeJS.Platform): void {
  const destination = path.join(paths.tools, "native", cli);
  const target = primaryExecutable(paths, cli, platform);
  try {
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    if (fs.existsSync(destination)) fs.rmSync(destination, { recursive: true, force: true });
    fs.renameSync(home, destination);
    const movedLauncher = path.join(destination, path.relative(home, launcher));
    writeNativeLauncher(target, movedLauncher, platform, destination);
  } catch (error) {
    fs.rmSync(destination, { recursive: true, force: true });
    throw new CliInstallerError({ code: "install-command-failed", message: `Claude Code 私有目录提交失败：${redactCommandError(error)}` });
  }
}

function writeNativeLauncher(target: string, entry: string, platform: NodeJS.Platform, nativeHome?: string): void {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const temporary = `${target}.tmp-${process.pid}-${Date.now()}`;
  const quoteSh = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
  const quoteCmd = (value: string) => `"${value.replaceAll('"', '""')}"`;
  const contents = platform === "win32"
    ? `@echo off\r\n${nativeHome ? `set "HOME=${nativeHome}"\r\nset "USERPROFILE=${nativeHome}"\r\n` : ""}call ${quoteCmd(entry)} %*\r\n`
    : `#!/bin/sh\n${nativeHome ? `export HOME=${quoteSh(nativeHome)}\nexport USERPROFILE=$HOME\n` : ""}exec ${quoteSh(entry)} "$@"\n`;
  fs.writeFileSync(temporary, contents, { encoding: "utf8", mode: platform === "win32" ? 0o600 : 0o700 });
  if (platform !== "win32") fs.chmodSync(temporary, 0o755);
  fs.renameSync(temporary, target);
}

type FileSnapshot = { contents: Buffer; mode: number } | null;

function readFileSnapshot(file: string): FileSnapshot {
  try {
    const stat = fs.statSync(file);
    return stat.isFile() ? { contents: fs.readFileSync(file), mode: stat.mode } : null;
  } catch {
    return null;
  }
}

function restoreFileSnapshot(file: string, snapshot: FileSnapshot): void {
  if (!snapshot) {
    fs.rmSync(file, { force: true });
    return;
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, snapshot.contents, { mode: snapshot.mode });
  fs.chmodSync(file, snapshot.mode);
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

/** Release metadata must be a version, never a number embedded in an HTML error page. */
function parseReleaseVersion(value: unknown): string | null {
  return typeof value === "string" ? value.match(/^(?:rust-v|v)?(\d+\.\d+\.\d+)$/)?.[1] || null : null;
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
    // `where`/`which` normally return in milliseconds, but a broken PATH or
    // antivirus interference can stall the child; the timeout keeps the
    // synchronous detect() IPC path from blocking the main process forever.
    const output = require("node:child_process").execFileSync(command, [cli], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], windowsHide: true, timeout: SYSTEM_PATH_RESOLVE_TIMEOUT_MS });
    return String(output).split(/\r?\n/).map((line) => line.trim()).find(Boolean) || null;
  } catch { return null; }
}

async function defaultTransport(url: string, signal?: AbortSignal): Promise<CliInstallerResponse> {
  const response = await fetch(url, { redirect: "follow", signal, headers: { "User-Agent": "openmind-desktop" } });
  return { statusCode: response.status, finalUrl: response.url, body: Buffer.from(await response.arrayBuffer()) };
}

function safeInstallerEnvironment(): NodeJS.ProcessEnv {
  const allowed = ["PATH", "PATHEXT", "ComSpec", "SystemRoot", "OS", "PROCESSOR_ARCHITECTURE", "TEMP", "TMP", "TMPDIR", "SHELL", "LANG", "LC_ALL", "LC_CTYPE"];
  return Object.fromEntries(allowed.flatMap((key) => process.env[key] ? [[key, process.env[key]]] : []));
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
