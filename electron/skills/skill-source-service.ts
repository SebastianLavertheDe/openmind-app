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
};

export type GitCommandRunner = (
  args: string[],
  options: GitCommandOptions
) => Promise<{ stdout: string; stderr: string }>;

export type SkillSourceErrorCode =
  | "git-unavailable"
  | "git-command-failed"
  | "git-timeout"
  | "git-package-missing"
  | "git-package-ambiguous";

export class SkillSourceError extends Error {
  constructor(readonly code: SkillSourceErrorCode, message: string) {
    super(message);
    this.name = "SkillSourceError";
  }
}

/**
 * Adapts user-facing source locators to the static SkillPackageService.
 *
 * Git is deliberately a shallow, HTTPS-only checkout into app staging. No
 * credentials are accepted or injected, prompts are disabled, submodules and
 * hooks are disabled, and the checkout is removed after inspect/install.
 * Nothing in this adapter executes package code.
 */
export class SkillSourceService {
  constructor(
    private readonly packages: SkillPackageService,
    private readonly paths: AppPaths = getAppPaths(),
    private readonly runGit: GitCommandRunner = runGitCommand
  ) {}

  async inspect(input: SkillPackageSourceInput): Promise<SkillPackageInspection> {
    const source = parseSkillPackageSourceInput(input);
    if (source.type !== "git") {
      const inspection = this.packages.inspect(source.locator);
      return withSourceMetadata(inspection, source);
    }
    return this.withGitCheckout(source, (packageRoot) => {
      const inspection = this.packages.inspect(packageRoot);
      return { ...inspection, sourcePath: source.locator, sourceKind: "git" as const };
    });
  }

  async install(input: SkillPackageSourceInput): Promise<InstalledSkillRecord> {
    const source = parseSkillPackageSourceInput(input);
    if (source.type !== "git") {
      return this.packages.install(source.locator, toInstallMetadata(source));
    }
    return this.withGitCheckout(source, (packageRoot) =>
      this.packages.install(packageRoot, toInstallMetadata(source))
    );
  }

  private async withGitCheckout<T>(
    source: Extract<SkillPackageSourceInput, { type: "git" }>,
    callback: (packageRoot: string) => T | Promise<T>
  ): Promise<T> {
    fs.mkdirSync(this.paths.staging, { recursive: true });
    const stagingRoot = fs.mkdtempSync(path.join(this.paths.staging, "skill-git-"));
    const checkoutRoot = path.join(stagingRoot, "repo");
    try {
      await this.runGit(buildCloneArgs(source, checkoutRoot), {
        cwd: stagingRoot,
        env: gitEnvironment(stagingRoot),
        timeout: GIT_TIMEOUT_MS
      });
      return await callback(resolveGitPackageRoot(checkoutRoot));
    } catch (error) {
      if (error instanceof SkillSourceError || error instanceof SkillPackageError) throw error;
      const message = error instanceof Error ? error.message : String(error);
      throw new SkillSourceError("git-command-failed", `Git 来源检查失败：${redactGitError(message)}`);
    } finally {
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
      maxBuffer: GIT_MAX_BUFFER,
      windowsHide: true
    }, (error, stdout, stderr) => {
      if (error) {
        const code = (error as NodeJS.ErrnoException & { killed?: boolean }).code;
        if (code === "ENOENT") {
          reject(new SkillSourceError("git-unavailable", "当前环境未找到 Git，无法导入 Git Skill。"));
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

function resolveGitPackageRoot(checkoutRoot: string): string {
  if (hasSkillDescriptor(checkoutRoot)) return checkoutRoot;
  const candidates = new Set<string>();
  const addChildren = (parent: string): void => {
    if (!isDirectory(parent)) return;
    for (const entry of fs.readdirSync(parent, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name === ".git" || entry.name.startsWith(".")) continue;
      const candidate = path.join(parent, entry.name);
      if (hasSkillDescriptor(candidate)) candidates.add(fs.realpathSync(candidate));
    }
  };
  addChildren(checkoutRoot);
  addChildren(path.join(checkoutRoot, ".claude", "skills"));
  if (candidates.size === 1) return [...candidates][0];
  if (candidates.size === 0) {
    throw new SkillSourceError("git-package-missing", "Git 仓库根目录或唯一 Skill 子目录中没有 cctools.skill.yaml / SKILL.md。 ");
  }
  throw new SkillSourceError("git-package-ambiguous", "Git 仓库包含多个候选 Skill，请把每个 Skill 放在独立仓库或子目录。 ");
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
