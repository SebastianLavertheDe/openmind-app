import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  PROJECTS_LOGICAL_ROOT,
  normalizeProjectName,
  projectNameUniquenessKey,
  type ProjectName
} from "../../shared/project-contracts";

export type ProjectPathErrorCode =
  | "invalid-project-name"
  | "project-name-conflict"
  | "project-already-exists"
  | "project-not-found"
  | "invalid-project-directory"
  | "project-lock-timeout"
  | "project-lock-invalid"
  | "absolute-path-forbidden"
  | "path-traversal"
  | "path-outside-project"
  | "symlink-forbidden";

export class ProjectPathError extends Error {
  constructor(
    readonly code: ProjectPathErrorCode,
    message: string,
    readonly target?: string
  ) {
    super(message);
    this.name = "ProjectPathError";
  }
}

export type ResolvedProject = {
  name: ProjectName;
  rootPath: string;
  logicalPath: string;
};

export type ProjectPathResolverOptions = {
  lockTimeoutMs?: number;
  staleLockMs?: number;
};

const PROJECT_MUTATION_LOCK = ".openmind-projects.lock";
const DEFAULT_LOCK_TIMEOUT_MS = 10_000;
const DEFAULT_STALE_LOCK_MS = 120_000;
const LOCK_POLL_MS = 25;

/**
 * Resolves only direct children of `<openmindRoot>/projects` and rejects every
 * symlink inside a Project. OpenmindPathResolver allows links that stay inside
 * the broader content root; Project isolation deliberately has a tighter rule.
 */
export class ProjectPathResolver {
  readonly openmindRoot: string;
  readonly projectsRoot: string;
  private readonly lockTimeoutMs: number;
  private readonly staleLockMs: number;
  private mutationLockDepth = 0;

  constructor(openmindRoot: string, options: ProjectPathResolverOptions = {}) {
    const requested = path.resolve(openmindRoot);
    let stat: fs.Stats;
    try {
      stat = fs.lstatSync(requested);
    } catch {
      throw new ProjectPathError("invalid-project-directory", "OpenMind 内容根不存在。", requested);
    }
    if (!stat.isDirectory()) {
      throw new ProjectPathError("invalid-project-directory", "OpenMind 内容根不是目录。", requested);
    }
    this.openmindRoot = fs.realpathSync(requested);
    this.projectsRoot = path.join(this.openmindRoot, PROJECTS_LOGICAL_ROOT);
    this.lockTimeoutMs = Math.max(1, options.lockTimeoutMs ?? DEFAULT_LOCK_TIMEOUT_MS);
    this.staleLockMs = Math.max(1_000, options.staleLockMs ?? DEFAULT_STALE_LOCK_MS);
  }

  initialize(): string {
    const existing = lstatIfExists(this.projectsRoot);
    if (existing) {
      if (!existing.isDirectory() || existing.isSymbolicLink()) {
        throw new ProjectPathError("invalid-project-directory", "projects 必须是普通目录。", this.projectsRoot);
      }
    } else {
      try {
        fs.mkdirSync(this.projectsRoot, { recursive: false });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        const raced = lstatIfExists(this.projectsRoot);
        if (!raced?.isDirectory() || raced.isSymbolicLink()) {
          throw new ProjectPathError("invalid-project-directory", "projects 必须是普通目录。", this.projectsRoot);
        }
      }
    }
    const real = fs.realpathSync(this.projectsRoot);
    this.assertInside(this.openmindRoot, real);
    return real;
  }

  listProjectNames(): ProjectName[] {
    this.initialize();
    const projects: ProjectName[] = [];
    const identities = new Map<string, ProjectName>();
    for (const entry of fs.readdirSync(this.projectsRoot, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
      const parsed = safeProjectName(entry.name);
      if (!parsed) continue;
      if (parsed !== entry.name) {
        throw new ProjectPathError(
          "invalid-project-directory",
          `项目目录“${entry.name}”不是规范化的项目名。`,
          entry.name
        );
      }
      const identity = projectNameUniquenessKey(parsed);
      const conflicting = identities.get(identity);
      if (conflicting) {
        throw new ProjectPathError(
          "project-name-conflict",
          `存在等价项目目录冲突：“${conflicting}”与“${parsed}”。`,
          parsed
        );
      }
      const candidate = path.join(this.projectsRoot, entry.name);
      const stat = lstatIfExists(candidate);
      if (!stat?.isDirectory() || stat.isSymbolicLink()) continue;
      try {
        this.assertInside(this.projectsRoot, fs.realpathSync(candidate));
        identities.set(identity, parsed);
        projects.push(parsed);
      } catch {
        // Invalid externally-created entries remain untouched but are not Project records.
      }
    }
    return projects.sort((left, right) => left.localeCompare(right));
  }

  findExistingName(rawName: string): ProjectName | null {
    const name = this.parseName(rawName);
    const key = projectNameUniquenessKey(name);
    return this.listProjectNames().find((candidate) => projectNameUniquenessKey(candidate) === key) ?? null;
  }

  createProjectRoot(rawName: string): ResolvedProject {
    const name = this.parseName(rawName);
    return this.withProjectMutationLock(() => {
      if (this.findExistingName(name)) {
        throw new ProjectPathError("project-already-exists", `项目“${name}”已存在。`, name);
      }
      const rootPath = path.join(this.projectsRoot, name);
      try {
        fs.mkdirSync(rootPath, { recursive: false });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "EEXIST") {
          throw new ProjectPathError("project-already-exists", `项目“${name}”已存在。`, name);
        }
        throw error;
      }
      return { name, rootPath, logicalPath: `${PROJECTS_LOGICAL_ROOT}/${name}` };
    });
  }

  resolveProject(rawName: string): ResolvedProject {
    const requested = this.parseName(rawName);
    const name = this.findExistingName(requested);
    if (!name) throw new ProjectPathError("project-not-found", `项目“${requested}”不存在。`, requested);
    const rootPath = path.join(this.projectsRoot, name);
    const stat = lstatIfExists(rootPath);
    if (!stat?.isDirectory() || stat.isSymbolicLink()) {
      throw new ProjectPathError("invalid-project-directory", `项目“${name}”不是普通目录。`, rootPath);
    }
    const real = fs.realpathSync(rootPath);
    this.assertInside(this.projectsRoot, real);
    return { name, rootPath: real, logicalPath: `${PROJECTS_LOGICAL_ROOT}/${name}` };
  }

  renameProjectRoot(rawCurrentName: string, rawNextName: string): ResolvedProject {
    return this.withProjectMutationLock(() => {
      const current = this.resolveProject(rawCurrentName);
      const nextName = this.parseName(rawNextName);
      if (current.name === nextName) return current;
      const nextKey = projectNameUniquenessKey(nextName);
      const collision = this.listProjectNames().find((candidate) =>
        candidate !== current.name && projectNameUniquenessKey(candidate) === nextKey
      );
      if (collision) throw new ProjectPathError("project-already-exists", `项目“${nextName}”已存在。`, nextName);

      const target = path.join(this.projectsRoot, nextName);
      const caseOnly = projectNameUniquenessKey(current.name) === nextKey;
      if (!caseOnly) {
        try {
          fs.renameSync(current.rootPath, target);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === "EEXIST") {
            throw new ProjectPathError("project-already-exists", `项目“${nextName}”已存在。`, nextName);
          }
          throw error;
        }
      } else {
        const temporary = path.join(this.projectsRoot, `.project-rename-${crypto.randomUUID()}`);
        fs.renameSync(current.rootPath, temporary);
        try {
          fs.renameSync(temporary, target);
        } catch (error) {
          try { fs.renameSync(temporary, current.rootPath); } catch { /* recovery is reported by the original error */ }
          throw error;
        }
      }
      return this.resolveProject(nextName);
    });
  }

  resolveInsideProject(
    rawProjectName: string,
    rawRelativePath: string,
    options: { allowedTopLevels?: readonly string[]; allowMissingLeaf?: boolean } = {}
  ): string {
    const project = this.resolveProject(rawProjectName);
    const relativePath = normalizeRelativePath(rawRelativePath);
    const segments = relativePath.split("/");
    if (options.allowedTopLevels && !options.allowedTopLevels.includes(segments[0])) {
      throw new ProjectPathError("path-outside-project", "路径不属于允许的 Project 子目录。", rawRelativePath);
    }
    const target = path.join(project.rootPath, ...segments);
    this.assertInside(project.rootPath, target);
    this.assertNoSymlink(project.rootPath, target, Boolean(options.allowMissingLeaf));
    return target;
  }

  private parseName(rawName: string): ProjectName {
    try {
      return normalizeProjectName(rawName);
    } catch (error) {
      throw new ProjectPathError(
        "invalid-project-name",
        error instanceof Error ? error.message : "项目名无效。",
        String(rawName)
      );
    }
  }

  private assertInside(root: string, candidate: string): void {
    const relative = path.relative(path.resolve(root), path.resolve(candidate));
    if (relative.startsWith("..") || path.isAbsolute(relative)) {
      throw new ProjectPathError("path-outside-project", "路径超出 Project 目录。", candidate);
    }
  }

  private assertNoSymlink(projectRoot: string, target: string, allowMissingLeaf: boolean): void {
    const relative = path.relative(projectRoot, target);
    const segments = relative.split(path.sep).filter(Boolean);
    let current = projectRoot;
    for (let index = 0; index < segments.length; index += 1) {
      current = path.join(current, segments[index]);
      const stat = lstatIfExists(current);
      if (!stat) {
        if (allowMissingLeaf) return;
        throw new ProjectPathError("path-outside-project", "Project 文件不存在。", current);
      }
      if (stat.isSymbolicLink()) {
        throw new ProjectPathError("symlink-forbidden", "Project 内不允许符号链接。", current);
      }
      const real = fs.realpathSync(current);
      this.assertInside(projectRoot, real);
    }
  }

  /** Serializes a complete Project filesystem mutation across app processes. */
  withProjectMutationLock<T>(operation: () => T): T {
    if (this.mutationLockDepth > 0) {
      this.mutationLockDepth += 1;
      try { return operation(); }
      finally { this.mutationLockDepth -= 1; }
    }
    this.initialize();
    const token = crypto.randomUUID();
    const lockPath = path.join(this.projectsRoot, PROJECT_MUTATION_LOCK);
    const deadline = Date.now() + this.lockTimeoutMs;
    while (true) {
      try {
        fs.mkdirSync(lockPath, { mode: 0o700 });
        try {
          fs.writeFileSync(
            path.join(lockPath, "owner.json"),
            `${JSON.stringify({ token, pid: process.pid, createdAt: new Date().toISOString() })}\n`,
            { encoding: "utf8", flag: "wx", mode: 0o600 }
          );
        } catch (error) {
          fs.rmSync(lockPath, { recursive: true, force: true });
          throw error;
        }
        break;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        if (this.reclaimStaleLock(lockPath)) continue;
        if (Date.now() >= deadline) {
          throw new ProjectPathError("project-lock-timeout", "Project 目录正在被其他进程修改，请稍后重试。", lockPath);
        }
        sleepSync(LOCK_POLL_MS);
      }
    }
    try {
      this.mutationLockDepth = 1;
      return operation();
    } finally {
      this.mutationLockDepth = 0;
      releaseOwnedLock(lockPath, token);
    }
  }

  private reclaimStaleLock(lockPath: string): boolean {
    const lockStat = lstatIfExists(lockPath);
    if (!lockStat) return true;
    if (!lockStat.isDirectory() || lockStat.isSymbolicLink()) {
      throw new ProjectPathError("project-lock-invalid", "Project 修改锁不是普通目录。", lockPath);
    }
    const ownerPath = path.join(lockPath, "owner.json");
    const ownerStat = lstatIfExists(ownerPath);
    const ageMs = Date.now() - lockStat.mtimeMs;
    let owner: { pid?: unknown } = {};
    if (ownerStat?.isFile() && !ownerStat.isSymbolicLink()) {
      try { owner = JSON.parse(fs.readFileSync(ownerPath, "utf8")) as { pid?: unknown }; } catch { /* stale age decides */ }
    }
    const pid = typeof owner.pid === "number" && Number.isInteger(owner.pid) && owner.pid > 0 ? owner.pid : null;
    const definitelyDead = pid !== null && !isProcessAlive(pid);
    if (pid !== null) {
      if (!definitelyDead || ageMs < 5_000) return false;
    } else if (ageMs < this.staleLockMs) {
      return false;
    }
    const quarantine = path.join(this.projectsRoot, `.openmind-projects.lock.stale-${crypto.randomUUID()}`);
    try {
      fs.renameSync(lockPath, quarantine);
      fs.rmSync(quarantine, { recursive: true, force: true });
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return true;
      return false;
    }
  }
}

function normalizeRelativePath(raw: string): string {
  const value = String(raw || "").trim();
  if (!value) throw new ProjectPathError("path-traversal", "Project 相对路径不能为空。", value);
  if (path.isAbsolute(value) || value.startsWith("//") || /^[A-Za-z]:[\\/]/.test(value)) {
    throw new ProjectPathError("absolute-path-forbidden", "Project 只接受相对路径。", value);
  }
  const portable = value.replaceAll("\\", "/");
  const segments = portable.split("/");
  if (segments.some((segment) => !segment || segment === "." || segment === ".." || decodedTraversal(segment))) {
    throw new ProjectPathError("path-traversal", "Project 路径包含非法段。", value);
  }
  return segments.join("/");
}

function decodedTraversal(segment: string): boolean {
  try {
    const decoded = decodeURIComponent(segment);
    return decoded === "." || decoded === ".." || decoded.includes("/") || decoded.includes("\\");
  } catch {
    return true;
  }
}

function lstatIfExists(target: string): fs.Stats | null {
  try { return fs.lstatSync(target); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

function safeProjectName(value: string): ProjectName | null {
  try { return normalizeProjectName(value); }
  catch { return null; }
}

function releaseOwnedLock(lockPath: string, token: string): void {
  const ownerPath = path.join(lockPath, "owner.json");
  const stat = lstatIfExists(ownerPath);
  if (!stat?.isFile() || stat.isSymbolicLink()) return;
  try {
    const owner = JSON.parse(fs.readFileSync(ownerPath, "utf8")) as { token?: unknown };
    if (owner.token !== token) return;
    fs.rmSync(lockPath, { recursive: true, force: true });
  } catch {
    // A lost/corrupt lock is deliberately preserved for stale-lock recovery.
  }
}

function isProcessAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true; }
  catch (error) { return (error as NodeJS.ErrnoException).code === "EPERM"; }
}

function sleepSync(milliseconds: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
}
