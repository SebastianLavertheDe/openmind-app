import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { execFile as nodeExecFile } from "node:child_process";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import type { SharedPythonRuntimeStatus } from "../../shared/contracts";
import { detectRuntimeTarget, type RuntimeTarget } from "../../shared/runtime-targets";
import { matchesSemverRange, type ProcessManifest } from "../../shared/skill-manifest-schema";
import type { AppPaths } from "../paths/app-paths-service";
import { copyDirectoryRecursively, writeJsonAtomic, writeTextAtomic } from "../lib/fs-utils";

const execFile = promisify(nodeExecFile);
const STATE_SCHEMA_VERSION = 1 as const;
const ASSET_SCHEMA_VERSION = 2 as const;
const LOCK_WAIT_MS = 10 * 60 * 1000;
const STALE_LOCK_MS = 30 * 60 * 1000;

export type SharedPythonProject = {
  id: string;
  version: string;
  digest: string;
  packageRoot: string;
};

type SharedPythonAssetManifest = {
  schemaVersion: typeof ASSET_SCHEMA_VERSION;
  target: RuntimeTarget;
  pythonVersion: string;
  uvVersion: string;
  filesDigest: string;
};

type SharedPythonState = {
  schemaVersion: typeof STATE_SCHEMA_VERSION;
  enabled: boolean;
  phase: SharedPythonRuntimeStatus["phase"];
  target: RuntimeTarget | null;
  pythonVersion: string | null;
  uvVersion: string | null;
  assetDigest: string | null;
  currentFingerprint: string | null;
  managedSkills: number;
  lastError: string | null;
  updatedAt: string;
};

export type SharedPythonCommandRunner = (
  executable: string,
  args: string[],
  cwd: string,
  env: Record<string, string>
) => Promise<void>;

export type SharedPythonRuntimeOptions = {
  bundledAssetRoot?: string;
  target?: RuntimeTarget;
  projects?: () => SharedPythonProject[];
  runCommand?: SharedPythonCommandRunner;
  now?: () => Date;
};

export type SharedPythonPreparation = {
  target: RuntimeTarget;
  packId: "python-core";
  packDigest: string;
  fingerprint: string;
  executable: string;
  env: Record<string, string>;
  prepare(): Promise<void>;
};

/**
 * App-owned Python distribution plus one dependency environment shared by all
 * approved Python Process Skills.  Dependency changes are prepared as a new
 * generation and switched atomically in state, so a failed uv resolution does
 * not corrupt the last runnable environment.
 */
export class SharedPythonRuntimeService {
  private readonly root: string;
  private readonly distributionsRoot: string;
  private readonly generationsRoot: string;
  private readonly stateFile: string;
  private readonly lockFile: string;
  private readonly bundledAssetRoot: string;
  private readonly target: RuntimeTarget | null;
  private readonly projects: () => SharedPythonProject[];
  private readonly runCommand: SharedPythonCommandRunner;
  private readonly now: () => Date;
  private preparing: Promise<void> | null = null;

  constructor(private readonly paths: AppPaths, options: SharedPythonRuntimeOptions = {}) {
    this.root = path.join(paths.runtimeEnvironments, "shared-python");
    this.distributionsRoot = path.join(this.root, "distributions");
    this.generationsRoot = path.join(this.root, "generations");
    this.stateFile = path.join(this.root, "state.json");
    this.lockFile = path.join(this.root, "prepare.lock");
    this.bundledAssetRoot = path.resolve(options.bundledAssetRoot || process.env.CCTOOLS_PYTHON_RUNTIME_ASSET_ROOT || path.join(process.resourcesPath || "", "python-runtime"));
    this.target = options.target || detectRuntimeTarget({ platform: process.platform, arch: process.arch });
    this.projects = options.projects || (() => []);
    this.runCommand = options.runCommand || defaultRunCommand;
    this.now = options.now || (() => new Date());
  }

  status(): SharedPythonRuntimeStatus {
    const state = this.readState();
    const currentPython = state.currentFingerprint ? environmentPython(this.generationRoot(state.currentFingerprint)) : null;
    const ready = Boolean(
      state.enabled
      && state.phase === "ready"
      && currentPython
      && fs.existsSync(currentPython)
    );
    return {
      enabled: state.enabled,
      phase: ready ? "ready" : state.phase,
      target: state.target,
      pythonVersion: state.pythonVersion,
      uvVersion: state.uvVersion,
      managedSkills: state.managedSkills,
      ready,
      lastError: state.lastError
    };
  }

  async setEnabled(enabled: boolean): Promise<SharedPythonRuntimeStatus> {
    if (!enabled) {
      const current = this.readState();
      this.writeState({ ...current, enabled: false, phase: "disabled", lastError: null });
      return this.status();
    }
    const current = this.readState();
    this.writeState({ ...current, enabled: true, phase: "installing", lastError: null });
    try {
      await this.ensurePrepared();
    } catch (error) {
      const failed = this.readState();
      this.writeState({ ...failed, enabled: false, phase: "error", lastError: errorMessage(error) });
      throw error;
    }
    return this.status();
  }

  resolve(manifest: ProcessManifest, packageRoot: string, packageDigest: string): SharedPythonPreparation {
    if (manifest.entrypoint.runtime !== "python") throw new Error("共享 Python Runtime 只能解析 Python Process Skill。");
    const state = this.readState();
    if (!state.enabled) throw new Error("内置 Python 运行时尚未开启，请先在设置中开启。");
    if (!this.target) throw new Error("当前平台没有可用的内置 Python 运行时。");
    const projects = this.normalizedProjects([{ id: manifest.id, version: manifest.version, digest: packageDigest, packageRoot }]);
    const asset = this.readBundledAsset();
    if (!matchesSemverRange(asset.pythonVersion, manifest.runtime.version)) {
      throw new Error(`内置 Python ${asset.pythonVersion} 不满足 Skill 要求 ${manifest.runtime.version}。`);
    }
    const fingerprint = projectFingerprint(asset.filesDigest, projects);
    const currentPython = state.currentFingerprint ? environmentPython(this.generationRoot(state.currentFingerprint)) : "";
    const desiredPython = environmentPython(this.generationRoot(fingerprint));
    const fallbackPython = findPythonExecutable(this.installedDistributionRoot(asset.filesDigest));
    const executable = firstExisting([desiredPython, currentPython, fallbackPython]);
    if (!executable) throw new Error("内置 Python 尚未安装完成，请在设置中重试初始化。");
    const preparation: SharedPythonPreparation = {
      target: this.target,
      packId: "python-core",
      packDigest: asset.filesDigest,
      fingerprint,
      executable: fs.realpathSync(executable),
      env: sharedEnvironment(this.root, fingerprint),
      prepare: async () => {
        await this.ensurePrepared([{ id: manifest.id, version: manifest.version, digest: packageDigest, packageRoot }]);
        const latest = this.readState();
        if (!latest.currentFingerprint) throw new Error("共享 Python 环境没有 active generation。");
        const python = environmentPython(this.generationRoot(latest.currentFingerprint));
        if (!fs.existsSync(python)) throw new Error("共享 Python 环境缺少解释器。");
        preparation.fingerprint = latest.currentFingerprint;
        preparation.executable = fs.realpathSync(python);
        preparation.env = sharedEnvironment(this.root, latest.currentFingerprint);
      }
    };
    return preparation;
  }

  private async ensurePrepared(additional: SharedPythonProject[] = []): Promise<void> {
    if (this.preparing) {
      await this.preparing;
      if (additional.length) await this.ensurePrepared(additional);
      return;
    }
    this.preparing = this.prepareLocked(additional).catch((error) => {
      const failed = this.readState();
      this.writeState({ ...failed, enabled: true, phase: "error", lastError: errorMessage(error) });
      throw error;
    }).finally(() => { this.preparing = null; });
    await this.preparing;
  }

  private async prepareLocked(additional: SharedPythonProject[]): Promise<void> {
    const release = await acquireFileLock(this.lockFile, this.now);
    try {
      const state = this.readState();
      if (!state.enabled) throw new Error("内置 Python 运行时尚未开启。");
      const asset = this.readBundledAsset();
      this.installDistribution(asset);
      const projects = this.normalizedProjects(additional);
      const fingerprint = projectFingerprint(asset.filesDigest, projects);
      const generationRoot = this.generationRoot(fingerprint);
      const python = environmentPython(generationRoot);
      if (!fs.existsSync(python)) {
        this.writeState({
          ...state,
          enabled: true,
          phase: "syncing",
          target: asset.target,
          pythonVersion: asset.pythonVersion,
          uvVersion: asset.uvVersion,
          assetDigest: asset.filesDigest,
          managedSkills: projects.length,
          lastError: null
        });
        await this.buildGeneration(asset, projects, fingerprint);
      }
      const next = this.readState();
      this.writeState({
        ...next,
        enabled: true,
        phase: "ready",
        target: asset.target,
        pythonVersion: asset.pythonVersion,
        uvVersion: asset.uvVersion,
        assetDigest: asset.filesDigest,
        currentFingerprint: fingerprint,
        managedSkills: projects.length,
        lastError: null
      });
    } finally {
      release();
    }
  }

  private normalizedProjects(additional: SharedPythonProject[]): SharedPythonProject[] {
    const combined = [...this.projects(), ...additional];
    const byKey = new Map<string, SharedPythonProject>();
    for (const project of combined) {
      const packageRoot = fs.realpathSync(path.resolve(project.packageRoot));
      const projectFile = path.join(packageRoot, "pyproject.toml");
      if (!fs.existsSync(projectFile)) throw new Error(`Python Skill 缺少 pyproject.toml：${project.id}`);
      byKey.set(`${project.id}@${project.version}`, { ...project, digest: project.digest.toLowerCase(), packageRoot });
    }
    return [...byKey.values()].sort((left, right) => `${left.id}@${left.version}`.localeCompare(`${right.id}@${right.version}`));
  }

  private readBundledAsset(): SharedPythonAssetManifest {
    if (!this.target) throw new Error("当前平台没有受支持的 Python Runtime target。");
    const root = this.assetTargetRoot();
    const manifestFile = path.join(root, "manifest.json");
    if (!fs.existsSync(manifestFile)) throw new Error(`发行包缺少内置 Python 资源：${this.target}`);
    const raw = JSON.parse(fs.readFileSync(manifestFile, "utf8")) as Partial<SharedPythonAssetManifest>;
    if (raw.schemaVersion !== ASSET_SCHEMA_VERSION || raw.target !== this.target) throw new Error("内置 Python Manifest 与当前平台不匹配。");
    const filesDigest = raw.filesDigest;
    if (!raw.pythonVersion || !raw.uvVersion || !filesDigest || !/^[a-f0-9]{64}$/i.test(filesDigest)) throw new Error("内置 Python Manifest 不完整。");
    const actualDigest = digestTree(root, new Set(["manifest.json"]));
    if (actualDigest !== filesDigest.toLowerCase()) throw new Error("内置 Python 资源完整性校验失败。");
    return { ...raw, filesDigest } as SharedPythonAssetManifest;
  }

  private installDistribution(asset: SharedPythonAssetManifest): void {
    const destination = this.installedDistributionRoot(asset.filesDigest);
    let replaceExisting = false;
    if (fs.existsSync(destination)) {
      const actual = digestTree(destination, new Set(["manifest.json"]));
      if (actual === asset.filesDigest) return;
      replaceExisting = true;
    }
    fs.mkdirSync(this.distributionsRoot, { recursive: true });
    const staging = path.join(this.root, `distribution-staging-${process.pid}-${crypto.randomUUID()}`);
    let displaced: string | null = null;
    try {
      // Keep source mtimes aligned with bundled .pyc headers. Python otherwise
      // treats the copied bytecode as stale and rewrites the app-owned payload.
      copyDirectoryRecursively(this.assetTargetRoot(), staging, { errorOnExist: true, preserveTimestamps: true });
      const actual = digestTree(staging, new Set(["manifest.json"]));
      if (actual !== asset.filesDigest) throw new Error("内置 Python 安装副本校验失败。");
      if (replaceExisting) {
        displaced = `${destination}.replaced-${process.pid}-${crypto.randomUUID()}`;
        try {
          fs.renameSync(destination, displaced);
        } catch (error) {
          throw new Error(`已安装的内置 Python 资源已损坏，但正在被占用；请结束 Python 任务后重试：${errorMessage(error)}`);
        }
      }
      try {
        fs.renameSync(staging, destination);
      } catch (error) {
        if (displaced && !fs.existsSync(destination) && fs.existsSync(displaced)) {
          try { fs.renameSync(displaced, destination); displaced = null; } catch { /* preserve the original failure */ }
        }
        throw error;
      }
      if (displaced && fs.existsSync(displaced)) {
        try { fs.rmSync(displaced, { recursive: true, force: true }); } catch { /* derived cache; clean up on a later repair */ }
      }
    } finally {
      if (fs.existsSync(staging)) fs.rmSync(staging, { recursive: true, force: true });
    }
  }

  private async buildGeneration(asset: SharedPythonAssetManifest, projects: SharedPythonProject[], fingerprint: string): Promise<void> {
    const distributionRoot = this.installedDistributionRoot(asset.filesDigest);
    const basePython = findPythonExecutable(distributionRoot);
    const uv = findUvExecutable(distributionRoot);
    if (!basePython || !uv) throw new Error("内置 Python 资源缺少 Python 或 uv。");
    const destination = this.generationRoot(fingerprint);
    fs.mkdirSync(this.generationsRoot, { recursive: true });
    const staging = path.join(this.root, `generation-staging-${process.pid}-${crypto.randomUUID()}`);
    try {
      fs.mkdirSync(staging, { recursive: true });
      writeTextAtomic(path.join(staging, "pyproject.toml"), sharedProjectToml(projects, asset.pythonVersion));
      const environment = commandEnvironment(this.paths, this.root);
      await this.runCommand(uv, ["lock", "--project", staging, "--python", basePython], staging, environment);
      const skipLocalProjects = projects.flatMap((project) => ["--no-install-package", readProjectName(path.join(project.packageRoot, "pyproject.toml"))]);
      await this.runCommand(uv, ["sync", "--locked", "--project", staging, "--python", basePython, "--no-install-project", ...skipLocalProjects], staging, environment);
      const python = environmentPython(staging);
      if (!fs.existsSync(python)) throw new Error("uv 未生成共享 Python 环境。");
      writeJsonAtomic(path.join(staging, "cctools-shared-python.json"), {
        schemaVersion: 1,
        fingerprint,
        assetDigest: asset.filesDigest,
        projects: projects.map(({ id, version, digest }) => ({ id, version, digest })),
        createdAt: this.now().toISOString()
      });
      if (fs.existsSync(destination)) fs.rmSync(staging, { recursive: true, force: true });
      else fs.renameSync(staging, destination);
    } catch (error) {
      throw new Error(`共享 Python 依赖安装失败，已保留原环境：${errorMessage(error)}`);
    } finally {
      if (fs.existsSync(staging)) fs.rmSync(staging, { recursive: true, force: true });
    }
  }

  private assetTargetRoot(): string {
    return path.join(this.bundledAssetRoot, this.target || "unsupported");
  }

  private installedDistributionRoot(digest: string): string {
    return path.join(this.distributionsRoot, digest);
  }

  private generationRoot(fingerprint: string): string {
    return path.join(this.generationsRoot, fingerprint);
  }

  private readState(): SharedPythonState {
    const fallback: SharedPythonState = {
      schemaVersion: STATE_SCHEMA_VERSION,
      enabled: false,
      phase: "disabled",
      target: this.target,
      pythonVersion: null,
      uvVersion: null,
      assetDigest: null,
      currentFingerprint: null,
      managedSkills: 0,
      lastError: null,
      updatedAt: this.now().toISOString()
    };
    if (!fs.existsSync(this.stateFile)) return fallback;
    try {
      const parsed = JSON.parse(fs.readFileSync(this.stateFile, "utf8")) as Partial<SharedPythonState>;
      if (parsed.schemaVersion !== STATE_SCHEMA_VERSION) return fallback;
      const state = { ...fallback, ...parsed, target: parsed.target || this.target };
      // An initial installation failure must leave the switch retryable. A
      // failed refresh with an existing generation remains enabled so the
      // last good environment can still be inspected and recovered.
      return state.phase === "error" && !state.currentFingerprint ? { ...state, enabled: false } : state;
    } catch {
      return { ...fallback, phase: "error", lastError: "共享 Python 状态文件损坏。" };
    }
  }

  private writeState(state: SharedPythonState): void {
    writeJsonAtomic(this.stateFile, { ...state, updatedAt: this.now().toISOString() });
  }
}

function sharedProjectToml(projects: SharedPythonProject[], pythonVersion: string): string {
  const dependencies = projects.map((project) => {
    const projectName = readProjectName(path.join(project.packageRoot, "pyproject.toml"));
    return `${projectName} @ ${pathToFileURL(project.packageRoot).href}`;
  });
  const [major, minor] = pythonVersion.split(".").map(Number);
  if (!Number.isInteger(major) || !Number.isInteger(minor)) throw new Error(`内置 Python 版本无效：${pythonVersion}`);
  return [
    "[project]",
    'name = "cctools-shared-python-runtime"',
    'version = "0.0.0"',
    `requires-python = ">=${major}.${minor},<${major}.${minor + 1}"`,
    "dependencies = [",
    ...dependencies.map((dependency) => `  ${JSON.stringify(dependency)},`),
    "]",
    ""
  ].join("\n");
}

function readProjectName(projectFile: string): string {
  const lines = fs.readFileSync(projectFile, "utf8").split(/\r?\n/);
  let inProject = false;
  for (const line of lines) {
    const trimmed = line.trim();
    if (/^\[.+\]$/.test(trimmed)) {
      inProject = trimmed === "[project]";
      continue;
    }
    if (!inProject) continue;
    const match = trimmed.match(/^name\s*=\s*["']([^"']+)["']/);
    if (match && /^[A-Za-z0-9._-]+$/.test(match[1])) return match[1];
  }
  throw new Error(`pyproject.toml 缺少合法的 [project].name：${projectFile}`);
}

function projectFingerprint(assetDigest: string, projects: SharedPythonProject[]): string {
  return crypto.createHash("sha256").update(JSON.stringify({
    assetDigest,
    projects: projects.map(({ id, version, digest }) => ({ id, version, digest }))
  })).digest("hex");
}

function digestTree(root: string, excludedRelativePaths = new Set<string>()): string {
  const hash = crypto.createHash("sha256");
  const walk = (directory: string): void => {
    const entries = fs.readdirSync(directory, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const absolute = path.join(directory, entry.name);
      const relative = path.relative(root, absolute).split(path.sep).join("/");
      if (excludedRelativePaths.has(relative)) continue;
      if (entry.isSymbolicLink()) throw new Error(`内置 Python 资源不允许符号链接：${relative}`);
      if (entry.isDirectory()) walk(absolute);
      else if (entry.isFile()) {
        // Package builders legitimately prune empty directories. Hash only
        // shipped file paths and bytes so an unchanged payload keeps the same
        // digest before and after packaging.
        hash.update(relative);
        hash.update("\0");
        hash.update(fs.readFileSync(absolute));
        hash.update("\0");
      }
      else throw new Error(`内置 Python 资源包含特殊文件：${relative}`);
    }
  };
  walk(root);
  return hash.digest("hex");
}

function findPythonExecutable(root: string): string | undefined {
  if (!fs.existsSync(root)) return undefined;
  const preferred = process.platform === "win32" ? ["python.exe"] : ["python3", "python"];
  return findNamedFile(root, preferred, (relative) => process.platform === "win32" || relative.includes("/bin/"));
}

function findUvExecutable(root: string): string | undefined {
  if (!fs.existsSync(root)) return undefined;
  return findNamedFile(root, process.platform === "win32" ? ["uv.exe"] : ["uv"]);
}

function findNamedFile(root: string, names: string[], accept: (relative: string) => boolean = () => true): string | undefined {
  const wanted = new Set(names.map((name) => name.toLocaleLowerCase()));
  const stack = [root];
  while (stack.length) {
    const directory = stack.pop()!;
    const entries = fs.readdirSync(directory, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      const absolute = path.join(directory, entry.name);
      const relative = `/${path.relative(root, absolute).split(path.sep).join("/")}`;
      if (entry.isFile() && wanted.has(entry.name.toLocaleLowerCase()) && accept(relative)) return absolute;
      if (entry.isDirectory()) stack.push(absolute);
    }
  }
  return undefined;
}

function environmentPython(root: string): string {
  return process.platform === "win32" ? path.join(root, ".venv", "Scripts", "python.exe") : path.join(root, ".venv", "bin", "python");
}

function firstExisting(candidates: Array<string | undefined>): string | undefined {
  return candidates.find((candidate): candidate is string => Boolean(candidate && fs.existsSync(candidate) && fs.statSync(candidate).isFile()));
}

function sharedEnvironment(runtimeRoot: string, fingerprint: string): Record<string, string> {
  return {
    CCTOOLS_SHARED_PYTHON: "1",
    CCTOOLS_SHARED_PYTHON_ROOT: runtimeRoot,
    CCTOOLS_RUNTIME_FINGERPRINT: fingerprint,
    VIRTUAL_ENV: path.join(runtimeRoot, "generations", fingerprint, ".venv"),
    UV_PYTHON_DOWNLOADS: "never",
    PYTHONDONTWRITEBYTECODE: "1",
    PYTHONUNBUFFERED: "1"
  };
}

function commandEnvironment(paths: AppPaths, runtimeRoot: string): Record<string, string> {
  const environment: Record<string, string> = {
    ...Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === "string")),
    CCTOOLS_SHARED_PYTHON_ROOT: runtimeRoot,
    UV_CACHE_DIR: path.join(paths.cache, "uv"),
    UV_PYTHON_DOWNLOADS: "never",
    PYTHONDONTWRITEBYTECODE: "1",
    PYTHONUNBUFFERED: "1"
  };
  delete environment.PYTHONPATH;
  delete environment.PYTHONHOME;
  delete environment.VIRTUAL_ENV;
  return environment;
}

async function defaultRunCommand(executable: string, args: string[], cwd: string, env: Record<string, string>): Promise<void> {
  await execFile(executable, args, { cwd, env, shell: false, windowsHide: true, maxBuffer: 4 * 1024 * 1024 });
}

async function acquireFileLock(lockFile: string, now: () => Date): Promise<() => void> {
  fs.mkdirSync(path.dirname(lockFile), { recursive: true });
  const started = now().getTime();
  while (true) {
    try {
      const descriptor = fs.openSync(lockFile, "wx");
      fs.writeFileSync(descriptor, JSON.stringify({ pid: process.pid, createdAt: now().toISOString() }));
      fs.closeSync(descriptor);
      return () => { try { fs.rmSync(lockFile, { force: true }); } catch { /* best effort */ } };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      try {
        if (now().getTime() - fs.statSync(lockFile).mtimeMs > STALE_LOCK_MS) {
          fs.rmSync(lockFile, { force: true });
          continue;
        }
      } catch { continue; }
      if (now().getTime() - started > LOCK_WAIT_MS) throw new Error("等待共享 Python 环境锁超时。");
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
