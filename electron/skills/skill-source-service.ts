import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import type { SkillPackageSourceInput } from "../../shared/skill-package-sources";
import { parseSkillPackageSourceInput } from "../../shared/skill-package-sources";
import { getAppPaths, type AppPaths } from "../paths/app-paths-service";
import {
  SkillPackageError,
  SkillPackageService,
  type SkillPackageInspection,
  type SkillPackageSourceMetadata
} from "./skill-package-service";
import type { InstalledSkillRecord } from "./installed-skill-repository";

const GIT_TIMEOUT_MS = 60_000;
const GIT_MAX_BUFFER = 4 * 1024 * 1024;

export type GitCommandOptions = {
  cwd: string;
  env: NodeJS.ProcessEnv;
  timeout: number;
  signal?: AbortSignal;
};

export type GitCommandRunner = (
  args: string[],
  options: GitCommandOptions
) => Promise<{ stdout: string; stderr: string }>;

export type SkillSourceErrorCode =
  | "git-unavailable"
  | "git-command-failed"
  | "git-timeout"
  | "git-cancelled"
  | "git-package-missing";

export class SkillSourceError extends Error {
  constructor(readonly code: SkillSourceErrorCode, message: string) {
    super(message);
    this.name = "SkillSourceError";
  }
}

export type SkillSourceKind = "directory" | "zip" | "git";

export type SkillSourceReference = {
  type: SkillSourceKind;
  locator: string;
  ref?: string;
};

/** 一次来源检查的结果：一个 Git 仓库可包含多个 Skill 包。 */
export type SkillSourceInspection = {
  source: SkillSourceReference;
  packages: Array<SkillPackageInspection & { packageRef: string }>;
};

/**
 * Adapts user-facing source locators to the static SkillPackageService.
 *
 * Git is deliberately a shallow, HTTPS-only checkout into app staging. No
 * credentials are accepted or injected, prompts are disabled, submodules and
 * hooks are disabled, and the checkout is removed after inspect/install.
 * Nothing in this adapter executes package code.
 */
export class SkillSourceService {
  private readonly activeGitInspections = new Map<string, AbortController>();

  constructor(
    private readonly packages: SkillPackageService,
    private readonly paths: AppPaths = getAppPaths(),
    private readonly runGit: GitCommandRunner = runGitCommand
  ) {}

  async inspect(input: SkillPackageSourceInput, requestId?: string): Promise<SkillSourceInspection> {
    const source = parseSkillPackageSourceInput(input);
    if (source.type !== "git") {
      const inspection = this.packages.inspect(source.locator);
      return {
        source: { type: source.type, locator: source.locator },
        packages: [{ ...withSourceMetadata(inspection, source), packageRef: "." }]
      };
    }
    return this.withGitCheckout(source, (checkoutRoot) => {
      const candidates = resolveGitPackageCandidates(checkoutRoot);
      if (candidates.length === 0) {
        throw new SkillSourceError(
          "git-package-missing",
          "Git 仓库中没有找到任何 Skill 包（需要 cctools.skill.yaml 或 SKILL.md）。"
        );
      }
      return {
        source: { type: "git" as const, locator: source.locator, ...(source.ref ? { ref: source.ref } : {}) },
        packages: candidates.map(({ ref, absPath }) => ({
          ...this.packages.inspect(absPath),
          sourcePath: source.locator,
          sourceKind: "git" as const,
          packageRef: ref
        }))
      };
    }, requestId);
  }

  cancelInspection(requestId: string): boolean {
    const controller = this.activeGitInspections.get(requestId);
    if (!controller) return false;
    controller.abort();
    return true;
  }

  async install(input: SkillPackageSourceInput, selectedRefs?: string[]): Promise<InstalledSkillRecord[]> {
    const source = parseSkillPackageSourceInput(input);
    if (source.type !== "git") {
      return [this.packages.install(source.locator, toInstallMetadata(source))];
    }
    return this.withGitCheckout(source, (checkoutRoot) => {
      const candidates = resolveGitPackageCandidates(checkoutRoot);
      if (candidates.length === 0) {
        throw new SkillSourceError(
          "git-package-missing",
          "Git 仓库中没有找到任何 Skill 包（需要 cctools.skill.yaml 或 SKILL.md）。"
        );
      }
      const chosen = selectedRefs === undefined
        ? candidates
        : candidates.filter(({ ref }) => selectedRefs.includes(ref));
      if (chosen.length === 0) {
        throw new SkillSourceError("git-package-missing", "选中的 Skill 包在该 Git 仓库中不存在。");
      }
      return chosen.map(({ absPath }) => this.packages.install(absPath, toInstallMetadata(source)));
    });
  }

  private async withGitCheckout<T>(
    source: Extract<SkillPackageSourceInput, { type: "git" }>,
    callback: (packageRoot: string) => T | Promise<T>,
    requestId?: string
  ): Promise<T> {
    fs.mkdirSync(this.paths.staging, { recursive: true });
    const stagingRoot = fs.mkdtempSync(path.join(this.paths.staging, "skill-git-"));
    const checkoutRoot = path.join(stagingRoot, "repo");
    const controller = new AbortController();
    if (requestId) this.activeGitInspections.set(requestId, controller);
    try {
      await this.runGit(buildCloneArgs(source, checkoutRoot), {
        cwd: stagingRoot,
        env: gitEnvironment(stagingRoot),
        timeout: GIT_TIMEOUT_MS,
        signal: controller.signal
      });
      return await callback(checkoutRoot);
    } catch (error) {
      if (error instanceof SkillSourceError || error instanceof SkillPackageError) throw error;
      const message = error instanceof Error ? error.message : String(error);
      throw new SkillSourceError("git-command-failed", `Git 来源检查失败：${redactGitError(message)}`);
    } finally {
      if (requestId && this.activeGitInspections.get(requestId) === controller) this.activeGitInspections.delete(requestId);
      fs.rmSync(stagingRoot, { recursive: true, force: true });
    }
  }
}

function toInstallMetadata(source: Exclude<SkillPackageSourceInput, { type: "git" }> | Extract<SkillPackageSourceInput, { type: "git" }>): SkillPackageSourceMetadata {
  return {
    sourceType: source.type,
    sourceLocator: source.locator,
    ...(source.type === "git" && source.ref ? { sourceRef: source.ref } : {})
  };
}

function withSourceMetadata(
  inspection: SkillPackageInspection,
  source: Exclude<SkillPackageSourceInput, { type: "git" }>
): SkillPackageInspection {
  return {
    ...inspection,
    sourcePath: source.locator,
    sourceKind: source.type === "zip" ? "zip" : inspection.sourceKind
  };
}

function buildCloneArgs(source: Extract<SkillPackageSourceInput, { type: "git" }>, checkoutRoot: string): string[] {
  return [
    "-c", "protocol.file.allow=never",
    "-c", "credential.helper=",
    "clone",
    "--depth", "1",
    "--no-tags",
    "--single-branch",
    "--no-recurse-submodules",
    ...(source.ref ? ["--branch", source.ref] : []),
    "--",
    source.locator,
    checkoutRoot
  ];
}

function gitEnvironment(stagingRoot: string): NodeJS.ProcessEnv {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (key.startsWith("GIT_CONFIG_")) delete env[key];
  }
  return {
    ...env,
    GIT_TERMINAL_PROMPT: "0",
    GIT_OPTIONAL_LOCKS: "0",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: path.join(stagingRoot, "empty-gitconfig"),
    // Do not allow an inherited askpass program to receive a chance to
    // collect credentials even when a user's shell exports GIT_ASKPASS.
    GIT_ASKPASS: path.join(stagingRoot, "disabled-askpass")
  };
}

function runGitCommand(args: string[], options: GitCommandOptions): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile("git", args, {
      cwd: options.cwd,
      env: options.env,
      shell: false,
      timeout: options.timeout,
      signal: options.signal,
      maxBuffer: GIT_MAX_BUFFER,
      windowsHide: true
    }, (error, stdout, stderr) => {
      if (error) {
        const code = (error as NodeJS.ErrnoException & { killed?: boolean }).code;
        if (code === "ENOENT") {
          reject(new SkillSourceError("git-unavailable", "当前环境未找到 Git，无法导入 Git Skill。"));
          return;
        }
        if (code === "ABORT_ERR" || error.name === "AbortError") {
          reject(new SkillSourceError("git-cancelled", "已取消 Git 来源检查。"));
          return;
        }
        if (code === "ETIMEDOUT" || (error as { killed?: boolean }).killed) {
          reject(new SkillSourceError("git-timeout", "Git 来源下载超时，已清理临时 checkout。"));
          return;
        }
        reject(new SkillSourceError("git-command-failed", `Git 来源下载失败：${redactGitError(String(stderr || error.message))}`));
        return;
      }
      resolve({ stdout: String(stdout), stderr: String(stderr) });
    });
  });
}

export type GitPackageCandidate = {
  /** 仓库内相对路径（根包为 "."，顶层子包为目录名，.claude/skills 下为带前缀路径）。 */
  ref: string;
  absPath: string;
};

/**
 * 收集一个 Git checkout 内的全部 Skill 包候选：
 * 仓库根本身、一级子目录、`.claude/skills/*` 子目录。
 * 多包仓库（Skill 集合仓库）返回全部候选，由调用方选择。
 */
export function resolveGitPackageCandidates(checkoutRoot: string): GitPackageCandidate[] {
  const seen = new Set<string>();
  const out: GitPackageCandidate[] = [];
  const add = (ref: string, absPath: string): void => {
    let real: string;
    try { real = fs.realpathSync(absPath); } catch { return; }
    if (seen.has(real)) return;
    seen.add(real);
    out.push({ ref, absPath: real });
  };

  if (hasSkillDescriptor(checkoutRoot)) add(".", checkoutRoot);

  const addChildren = (parent: string, refFor: (name: string) => string): void => {
    if (!isDirectory(parent)) return;
    for (const entry of fs.readdirSync(parent, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
      if (!entry.isDirectory() || entry.name === ".git" || entry.name.startsWith(".")) continue;
      const candidate = path.join(parent, entry.name);
      if (hasSkillDescriptor(candidate)) add(refFor(entry.name), candidate);
    }
  };
  addChildren(checkoutRoot, (name) => name);
  addChildren(path.join(checkoutRoot, ".claude", "skills"), (name) => `.claude/skills/${name}`);

  return out;
}

function hasSkillDescriptor(root: string): boolean {
  return ["cctools.skill.yaml", "SKILL.md"].some((name) => {
    const candidate = path.join(root, name);
    try { return fs.statSync(candidate).isFile(); } catch { return false; }
  });
}

function isDirectory(candidate: string): boolean {
  try { return fs.statSync(candidate).isDirectory(); } catch { return false; }
}

function redactGitError(value: string): string {
  return value.replace(/https:\/\/[^\s]+/gi, "<git-source>").slice(0, 1000);
}
