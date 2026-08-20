import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { execFile as nodeExecFile } from "node:child_process";
import { promisify } from "node:util";
import { extractZipArchive, inspectZipArchive } from "../skills/zip-source";
import type { ProcessManifest, RuntimeKind, SkillManifest } from "../../shared/skill-manifest-schema";
import {
  detectRuntimeTarget,
  getRuntimeTargetDescriptor,
  type RuntimePackId,
  type RuntimeTarget
} from "../../shared/runtime-targets";
import type { AppPaths } from "../paths/app-paths-service";
import { RuntimePackRepository, type RuntimePackRecord } from "./runtime-pack-repository";
import { RuntimePackUsageRegistry } from "./runtime-pack-usage";
import { createRuntimeStaging } from "./runtime-staging";
import type { SharedPythonRuntimeService } from "./shared-python-runtime";

export type RuntimeExecutableResolutionInput = {
  manifest: ProcessManifest;
  packageRoot: string;
  target: RuntimeTarget;
  pack: RuntimePackRecord;
};

export type RuntimePreparation = {
  target: RuntimeTarget;
  packId: RuntimePackId;
  packDigest: string;
  executable: string;
  env: Record<string, string>;
  fingerprint: string;
  prepare(): Promise<void>;
  acquire(runId: string): void;
  release(runId: string): void;
};

type RuntimeCommandRunner = (executable: string, args: string[], cwd: string, env: Record<string, string>) => Promise<void>;

export type RuntimeManagerOptions = {
  target?: RuntimeTarget;
  getActivePack?: (packId: RuntimePackId, target: RuntimeTarget) => RuntimePackRecord | undefined;
  resolveExecutable?: (input: RuntimeExecutableResolutionInput) => string;
  prepareEnvironment?: (input: {
    manifest: ProcessManifest;
    packageRoot: string;
    target: RuntimeTarget;
    pack: RuntimePackRecord;
    fingerprint: string;
    packageDigest: string;
  }) => Promise<void>;
  runCommand?: RuntimeCommandRunner;
  sharedPython?: SharedPythonRuntimeService;
};

export type RuntimeManagerErrorCode =
  | "target-undetected"
  | "platform-unsupported"
  | "pack-not-declared"
  | "pack-not-ready"
  | "pack-path-invalid"
  | "pack-format-unsupported"
  | "pack-tampered"
  | "executable-unresolved"
  | "executable-invalid";

export class RuntimeManagerError extends Error {
  constructor(readonly code: RuntimeManagerErrorCode, message: string) {
    super(message);
    this.name = "RuntimeManagerError";
  }
}

/**
 * Resolves only verified active managed Runtime Packs. It intentionally has no
 * PATH/system-runtime fallback. The default pack format is a validated ZIP
 * containing a portable `bin/` (or Windows `Scripts/`) layout; pack-specific
 * callers may inject a resolver for an alternate, already-managed layout.
 */
export class RuntimeManager {
  private readonly getActivePack: (packId: RuntimePackId, target: RuntimeTarget) => RuntimePackRecord | undefined;
  private readonly target?: RuntimeTarget;
  private readonly resolveExecutable?: RuntimeManagerOptions["resolveExecutable"];
  private readonly prepareEnvironment?: RuntimeManagerOptions["prepareEnvironment"];
  private readonly runCommand: RuntimeCommandRunner;
  private readonly usage: RuntimePackUsageRegistry;
  private readonly sharedPython?: SharedPythonRuntimeService;

  constructor(private readonly paths: AppPaths, options: RuntimeManagerOptions = {}) {
    const repository = new RuntimePackRepository(paths);
    this.getActivePack = options.getActivePack ?? ((packId, target) => repository.getActive(packId, target));
    this.target = options.target;
    this.resolveExecutable = options.resolveExecutable;
    this.prepareEnvironment = options.prepareEnvironment;
    this.runCommand = options.runCommand || defaultRunCommand;
    this.usage = new RuntimePackUsageRegistry(paths);
    this.sharedPython = options.sharedPython;
  }

  resolve(manifest: SkillManifest, packageRoot: string, packageDigest: string): RuntimePreparation {
    if (manifest.kind !== "process") {
      throw new RuntimeManagerError("pack-not-declared", "只有 process Skill 可以由 Process RuntimeManager 启动。 ");
    }
    if (manifest.entrypoint.runtime === "python" && this.sharedPython) {
      const shared = this.sharedPython.resolve(manifest, packageRoot, packageDigest);
      if (!manifest.platforms.includes(shared.target)) {
        throw new RuntimeManagerError("platform-unsupported", `Skill 不支持当前共享 Python target：${shared.target}`);
      }
      const preparation: RuntimePreparation = {
        target: shared.target,
        packId: shared.packId,
        packDigest: shared.packDigest,
        executable: shared.executable,
        env: { ...shared.env },
        fingerprint: shared.fingerprint,
        acquire: () => undefined,
        release: () => undefined,
        prepare: async () => {
          await shared.prepare();
          preparation.executable = shared.executable;
          preparation.env = { ...shared.env };
          preparation.fingerprint = shared.fingerprint;
        }
      };
      return preparation;
    }
    const target = this.target ?? detectRuntimeTarget({ platform: process.platform, arch: process.arch });
    if (!target) throw new RuntimeManagerError("target-undetected", "当前平台没有可用的 Runtime target。 ");
    if (!manifest.platforms.includes(target)) {
      throw new RuntimeManagerError("platform-unsupported", `Skill 不支持当前 Runtime target：${target}`);
    }
    const declaredPacks = manifest.runtime.packs.filter(isRuntimePackId);
    if (declaredPacks.length !== manifest.runtime.packs.length) {
      throw new RuntimeManagerError("pack-not-declared", "Manifest 声明了未知 Runtime Pack。 ");
    }
    const packId = requiredPackForRuntime(manifest.entrypoint.runtime, declaredPacks);
    const descriptor = getRuntimeTargetDescriptor(target);
    if (!descriptor.packs.includes(packId) || !declaredPacks.includes(packId)) {
      throw new RuntimeManagerError("pack-not-declared", `Skill 未声明当前 Runtime 所需的 ${packId} Pack。`);
    }
    const pack = this.getActivePack(packId, target);
    if (!pack || pack.status !== "active") {
      throw new RuntimeManagerError("pack-not-ready", `Runtime Pack 尚未 ready：${packId}@${target}`);
    }
    const packPath = this.assertManagedPackPath(pack.packagePath);
    if (digestManagedRuntimePath(packPath) !== pack.digest.toLowerCase()) {
      throw new RuntimeManagerError("pack-tampered", `Runtime Pack 内容 digest 与 registry 不一致：${pack.packId}@${target}`);
    }
    let executable: string;
    try {
      executable = (this.resolveExecutable || ((input) => this.resolveManagedExecutable(input)))({
        manifest,
        packageRoot,
        target,
        pack: { ...pack, packagePath: packPath }
      });
    } catch (error) {
      if (error instanceof RuntimeManagerError) throw error;
      throw new RuntimeManagerError("executable-unresolved", error instanceof Error ? error.message : String(error));
    }
    if (!path.isAbsolute(executable) || !fs.existsSync(executable) || !fs.statSync(executable).isFile()) {
      throw new RuntimeManagerError("executable-invalid", "Runtime executable 必须是存在的绝对文件。 ");
    }
    const canonicalExecutable = fs.realpathSync(executable);
    const fingerprint = crypto.createHash("sha256").update(JSON.stringify({
      packageDigest,
      target,
      runtime: manifest.runtime,
      packId,
      packDigest: pack.digest,
      executable: canonicalExecutable
    })).digest("hex");
    const preparation: RuntimePreparation = {
      target,
      packId,
      packDigest: pack.digest,
      executable: canonicalExecutable,
      env: {
        OPENMIND_RUNTIME_TARGET: target,
        OPENMIND_RUNTIME_PACK_ID: packId,
        OPENMIND_RUNTIME_PACK_DIGEST: pack.digest,
        OPENMIND_RUNTIME_FINGERPRINT: fingerprint
      },
      fingerprint,
      acquire: (runId) => this.usage.acquire({ runId, packId, target, digest: pack.digest }),
      release: (runId) => this.usage.release(runId),
      prepare: async () => {
        const prepare = this.prepareEnvironment || ((input) => this.prepareManagedEnvironment(input));
        await prepare({ manifest, packageRoot, target, pack: { ...pack, packagePath: packPath }, fingerprint, packageDigest });
        if (!this.prepareEnvironment && !this.resolveExecutable && manifest.entrypoint.runtime === "python") {
          const environmentRoot = this.environmentPath(manifest, pack, fingerprint);
          const python = environmentPython(environmentRoot, target);
          if (!fs.existsSync(python)) throw new RuntimeManagerError("executable-unresolved", "Python Skill environment 缺少 python executable。 ");
          preparation.executable = fs.realpathSync(python);
          preparation.env = { ...preparation.env, VIRTUAL_ENV: environmentRoot };
        }
      }
    };
    return preparation;
  }

  /** Resolve a verified active executable for app-owned auxiliary services
   * (for example the npm CLI used by the app-private Codex installer). */
  resolveManagedPackExecutable(packId: RuntimePackId, target: RuntimeTarget, runtime: "node" | "python"): string {
    const pack = this.getActivePack(packId, target);
    if (!pack || pack.status !== "active") throw new RuntimeManagerError("pack-not-ready", `Runtime Pack 尚未 ready：${packId}@${target}`);
    const packPath = this.assertManagedPackPath(pack.packagePath);
    if (digestManagedRuntimePath(packPath) !== pack.digest.toLowerCase()) {
      throw new RuntimeManagerError("pack-tampered", `Runtime Pack 内容 digest 与 registry 不一致：${packId}@${target}`);
    }
    const root = this.ensurePackRoot(pack);
    const executable = firstExisting(executableCandidates(runtime, root, target));
    if (!executable) throw new RuntimeManagerError("executable-unresolved", `Managed Runtime Pack 缺少 ${runtime} executable。`);
    ensureExecutable(executable);
    return fs.realpathSync(executable);
  }

  private resolveManagedExecutable(input: RuntimeExecutableResolutionInput): string {
    const root = this.ensurePackRoot(input.pack);
    const candidates = executableCandidates(input.manifest.entrypoint.runtime, root, input.target);
    for (const candidate of candidates) {
      if (!fs.existsSync(candidate)) continue;
      let stat: fs.Stats;
      try { stat = fs.statSync(candidate); } catch { continue; }
      if (!stat.isFile()) continue;
      const canonical = fs.realpathSync(candidate);
      ensureExecutable(canonical);
      return canonical;
    }
    throw new RuntimeManagerError("executable-unresolved", `Managed Runtime Pack 缺少 ${input.manifest.entrypoint.runtime} executable。`);
  }

  private async prepareManagedEnvironment(input: {
    manifest: ProcessManifest;
    packageRoot: string;
    target: RuntimeTarget;
    pack: RuntimePackRecord;
    fingerprint: string;
    packageDigest: string;
  }): Promise<void> {
    if (input.manifest.entrypoint.runtime !== "python") return;
    const packRoot = this.ensurePackRoot(input.pack);
    const python = firstExisting(executableCandidates("python", packRoot, input.target));
    const uv = firstExisting([
      ...executableCandidates("uv", packRoot, input.target)
    ]);
    if (!python || !uv) throw new RuntimeManagerError("executable-unresolved", "python-core Pack 缺少 python 或 uv executable。 ");
    ensureExecutable(python);
    ensureExecutable(uv);
    const environmentRoot = this.environmentPath(input.manifest, input.pack, input.fingerprint);
    const marker = path.join(environmentRoot, "openmind-runtime-environment.json");
    if (fs.existsSync(marker)) {
      try {
        const parsed = JSON.parse(fs.readFileSync(marker, "utf8")) as { fingerprint?: string };
        if (parsed.fingerprint === input.fingerprint && fs.existsSync(environmentPython(environmentRoot, input.target))) return;
      } catch { /* Rebuild a corrupt environment below. */ }
    }
    const staging = createRuntimeStaging(this.paths, "runtime-env-", "python-environment");
    const stagingRoot = staging.root;
    const stagedEnvironment = path.join(stagingRoot, "environment");
    try {
      const env = minimalRuntimeEnvironment(input.packageRoot, input.target, input.fingerprint, stagedEnvironment);
      await this.runCommand(uv, ["venv", "--python", python, stagedEnvironment], input.packageRoot, env);
      await this.runCommand(uv, ["sync", "--locked", "--project", input.packageRoot, "--python", environmentPython(stagedEnvironment, input.target)], input.packageRoot, {
        ...env,
        UV_PROJECT_ENVIRONMENT: stagedEnvironment,
        UV_PYTHON_DOWNLOADS: "never"
      });
      fs.writeFileSync(path.join(stagedEnvironment, "openmind-runtime-environment.json"), JSON.stringify({
        schemaVersion: 1,
        fingerprint: input.fingerprint,
        packageDigest: input.packageDigest,
        target: input.target
      }, null, 2), { mode: 0o600 });
      fs.mkdirSync(path.dirname(environmentRoot), { recursive: true });
      if (fs.existsSync(environmentRoot)) fs.rmSync(environmentRoot, { recursive: true, force: true });
      staging.clearMarker();
      fs.renameSync(stagedEnvironment, environmentRoot);
    } catch (error) {
      throw new RuntimeManagerError("executable-unresolved", `Python Skill environment 准备失败：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      fs.rmSync(stagingRoot, { recursive: true, force: true });
    }
  }

  private environmentPath(manifest: ProcessManifest, pack: RuntimePackRecord, fingerprint: string): string {
    return path.join(
      this.paths.runtimeEnvironments,
      safePathSegment(manifest.publisher.id),
      safePathSegment(manifest.id),
      safePathSegment(manifest.version),
      `${pack.target}-${fingerprint}`
    );
  }

  private ensurePackRoot(pack: RuntimePackRecord): string {
    const managedPath = this.assertManagedPackPath(pack.packagePath);
    if (fs.statSync(managedPath).isDirectory()) return managedPath;
    const destination = path.join(this.paths.runtimeEnvironments, ".packs", pack.packId, pack.target, pack.digest);
    if (fs.existsSync(destination)) return fs.realpathSync(destination);
    const temporary = createRuntimeStaging(this.paths, "runtime-pack-extract-", "pack-extract");
    const temporaryRoot = temporary.root;
    try {
      const archive = inspectZipArchive(managedPath);
      extractZipArchive(archive, temporaryRoot);
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      temporary.clearMarker();
      fs.renameSync(temporaryRoot, destination);
      return fs.realpathSync(destination);
    } catch (error) {
      if (error instanceof RuntimeManagerError) throw error;
      throw new RuntimeManagerError("pack-format-unsupported", `Runtime Pack 需要安全 ZIP 格式或已解包目录：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      if (fs.existsSync(temporaryRoot)) fs.rmSync(temporaryRoot, { recursive: true, force: true });
    }
  }

  private assertManagedPackPath(packagePath: string): string {
    const root = path.resolve(this.paths.runtimePacks);
    const candidate = path.resolve(packagePath);
    if (candidate === root || !candidate.startsWith(`${root}${path.sep}`)) {
      throw new RuntimeManagerError("pack-path-invalid", "Runtime Pack 路径越出 app-private runtimePacks。 ");
    }
    if (!fs.existsSync(candidate)) throw new RuntimeManagerError("pack-not-ready", `Runtime Pack 文件不存在：${candidate}`);
    let realCandidate: string;
    try { realCandidate = fs.realpathSync(candidate); }
    catch { throw new RuntimeManagerError("pack-path-invalid", "Runtime Pack 路径无法 canonicalize。 "); }
    const realRoot = fs.realpathSync(root);
    if (!realCandidate.startsWith(`${realRoot}${path.sep}`)) {
      throw new RuntimeManagerError("pack-path-invalid", "Runtime Pack canonical path 越出 app-private runtimePacks。 ");
    }
    const stat = fs.statSync(realCandidate);
    if (!stat.isFile() && !stat.isDirectory()) throw new RuntimeManagerError("pack-path-invalid", "Runtime Pack 必须是普通文件或目录。 ");
    return realCandidate;
  }
}

const execFile = promisify(nodeExecFile);

async function defaultRunCommand(executable: string, args: string[], cwd: string, env: Record<string, string>): Promise<void> {
  await execFile(executable, args, { cwd, env, shell: false, windowsHide: true, maxBuffer: 128 * 1024 });
}

function executableCandidates(runtime: ProcessManifest["entrypoint"]["runtime"] | "python" | "uv", root: string, target: RuntimeTarget): string[] {
  const names = runtime === "python" ? ["python", "python3"] : runtime === "node" ? ["node"] : runtime === "shell" ? ["sh", "bash"] : [];
  if (runtime === "uv") names.push("uv");
  const windowsLayout = getRuntimeTargetDescriptor(target).os === "windows";
  const candidates: string[] = [];
  for (const name of names) {
    const executableName = windowsLayout ? `${name}.exe` : name;
    candidates.push(path.join(root, "bin", executableName));
    if (windowsLayout) candidates.push(path.join(root, "Scripts", executableName));
    candidates.push(path.join(root, executableName));
  }
  return candidates;
}

function firstExisting(candidates: string[]): string | undefined {
  return candidates.find((candidate) => {
    try { return fs.statSync(candidate).isFile(); } catch { return false; }
  });
}

function ensureExecutable(candidate: string): void {
  if (process.platform === "win32") return;
  try {
    fs.chmodSync(candidate, 0o755);
  } catch {
    throw new RuntimeManagerError("executable-invalid", `Managed Runtime executable 无法设置为可执行：${candidate}`);
  }
}

function environmentPython(root: string, target: RuntimeTarget): string {
  return getRuntimeTargetDescriptor(target).os === "windows"
    ? path.join(root, "Scripts", "python.exe")
    : path.join(root, "bin", "python");
}

function minimalRuntimeEnvironment(packageRoot: string, target: RuntimeTarget, fingerprint: string, environmentRoot: string): Record<string, string> {
  return {
    OPENMIND_RUNTIME_TARGET: target,
    OPENMIND_RUNTIME_FINGERPRINT: fingerprint,
    OPENMIND_SKILL_HOME: packageRoot,
    UV_PYTHON_DOWNLOADS: "never",
    PYTHONUNBUFFERED: "1",
    // Keep uv caches out of the user's real home without making the venv
    // destination itself exist before `uv venv` creates it.
    ...(getRuntimeTargetDescriptor(target).os === "windows" ? {} : { HOME: path.dirname(environmentRoot) })
  };
}

function safePathSegment(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 120) || "unknown";
}

function digestManagedRuntimePath(candidate: string): string {
  const hash = crypto.createHash("sha256");
  const stat = fs.statSync(candidate);
  if (stat.isFile()) {
    hash.update(fs.readFileSync(candidate));
    return hash.digest("hex");
  }
  hashRuntimeDirectory(hash, candidate, candidate);
  return hash.digest("hex");
}

function hashRuntimeDirectory(hash: crypto.Hash, root: string, current: string): void {
  const entries = fs.readdirSync(current, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name));
  for (const entry of entries) {
    const absolute = path.join(current, entry.name);
    const relative = path.relative(root, absolute).split(path.sep).join("/");
    if (entry.isSymbolicLink()) throw new RuntimeManagerError("pack-tampered", `Runtime Pack 不允许 symlink：${relative}`);
    if (entry.isDirectory()) {
      hash.update(`dir:${relative}\0`);
      hashRuntimeDirectory(hash, root, absolute);
    } else if (entry.isFile()) {
      hash.update(`file:${relative}\0`);
      hash.update(fs.readFileSync(absolute));
      hash.update("\0");
    } else {
      throw new RuntimeManagerError("pack-tampered", `Runtime Pack 含特殊文件：${relative}`);
    }
  }
}

function requiredPackForRuntime(runtime: RuntimeKind, declared: readonly RuntimePackId[]): RuntimePackId {
  if (runtime === "python") return "python-core";
  if (runtime === "node") return "node-22";
  const first = declared[0];
  if (!first) throw new RuntimeManagerError("pack-not-declared", `Runtime ${runtime} 没有声明 Pack。`);
  return first;
}

function isRuntimePackId(value: string): value is RuntimePackId {
  return [
    "python-core", "node-22", "media-core", "browser-playwright", "browser-agent",
    "speech-whisper", "cjk-subtitle-fonts", "network-cli", "minigit", "wsl-runtime-bridge"
  ].includes(value as RuntimePackId);
}
