import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { ALL_SKILL_IDS } from "../../shared/skill-compatibility-matrix";
import type { SkillPackageSourceInput } from "../../shared/skill-package-sources";
import { isCctoolsSkillsSourceLocator, parseSkillPackageSourceInput } from "../../shared/skill-package-sources";
import { getAppPaths, type AppPaths } from "../paths/app-paths-service";
import {
  SkillPackageError,
  SkillPackageService,
  type SkillPackageInspection,
  type SkillPackageSourceMetadata
} from "./skill-package-service";
import type { InstalledSkillRecord } from "./installed-skill-repository";
import {
  INSTALLED_SKILL_SOURCE_REGISTRY_SCHEMA_VERSION,
  InstalledSkillSourceRepository,
  normalizeGitSourceLocator
} from "./installed-skill-source-repository";

const GIT_TIMEOUT_MS = 60_000;
const GIT_MAX_BUFFER = 4 * 1024 * 1024;
const GIT_CHECKOUT_CLEANUP_MAX_RETRIES = 5;
const GIT_CHECKOUT_CLEANUP_RETRY_DELAY_MS = 200;

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
  | "git-auth-required"
  | "git-timeout"
  | "git-cancelled"
  | "git-package-missing"
  | "git-package-selection-invalid";

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
  private readonly sourceInstallations: InstalledSkillSourceRepository;

  constructor(
    private readonly packages: SkillPackageService,
    private readonly paths: AppPaths = getAppPaths(),
    private readonly runGit: GitCommandRunner = runGitCommand,
    sourceInstallations?: InstalledSkillSourceRepository
  ) {
    this.sourceInstallations = sourceInstallations || new InstalledSkillSourceRepository(paths.skills);
  }

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
          "Git 仓库中没有找到任何 Skill 包（需要 cctools.skill.yaml、兼容的 openmind.skill.yaml 或 SKILL.md）。"
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
    return this.withGitCheckout(source, async (checkoutRoot) => {
      const candidates = resolveGitPackageCandidates(checkoutRoot);
      if (candidates.length === 0) {
        throw new SkillSourceError(
          "git-package-missing",
          "Git 仓库中没有找到任何 Skill 包（需要 cctools.skill.yaml、兼容的 openmind.skill.yaml 或 SKILL.md）。"
        );
      }

      const selected = selectGitPackageCandidates(candidates, selectedRefs);
      const inspected = selected.chosen.map((candidate) => ({
        ...candidate,
        inspection: this.packages.inspect(candidate.absPath)
      }));
      const invalid = inspected.find(({ inspection }) => !inspection.valid || !inspection.manifest);
      if (invalid) {
        const issue = invalid.inspection.issues[0];
        throw new SkillPackageError(
          issue?.code || "manifest-invalid",
          issue?.message || `Skill 包检查失败：${invalid.ref}`,
          issue?.path
        );
      }
      const packageKeys = new Set<string>();
      const packageIds = new Set<string>();
      for (const { ref, inspection } of inspected) {
        const manifest = inspection.manifest!;
        const key = `${manifest.publisher.id}/${manifest.id}`;
        if (packageKeys.has(key) || packageIds.has(manifest.id)) {
          throw new SkillSourceError(
            "git-package-selection-invalid",
            `Git 来源包含重复或有歧义的 Skill 身份 ${key}（包路径：${ref}）。`
          );
        }
        packageKeys.add(key);
        packageIds.add(manifest.id);
      }

      const sourceRevision = await this.resolveGitRevision(checkoutRoot);
      const records = inspected.map(({ ref, absPath }) => this.packages.install(
        absPath,
        toInstallMetadata(source, ref, sourceRevision)
      ));
      if (selected.complete) {
        this.sourceInstallations.replace({
          schemaVersion: INSTALLED_SKILL_SOURCE_REGISTRY_SCHEMA_VERSION,
          sourceType: "git",
          sourceLocator: normalizeGitSourceLocator(source.locator),
          ...(source.ref ? { sourceRef: source.ref } : {}),
          ...(sourceRevision ? { sourceRevision } : {}),
          packages: records.map((record, index) => ({
            packageRef: inspected[index].ref,
            key: record.key,
            id: record.id,
            version: record.version,
            digest: record.digest
          })),
          installedAt: new Date().toISOString()
        });
      }
      return records;
    });
  }

  /**
   * Presence-only startup check for a Git source.
   *
   * Onboarding answers only whether the source has been installed. Receipt,
   * revision and digest disagreements belong to Skill Center diagnostics and
   * the execution-time integrity gate; they must not force an existing user
   * back through setup. A registry record whose package directory is gone is
   * not considered installed.
   */
  hasInstallation(sourceLocator: string): boolean {
    const normalizedSource = normalizeGitSourceLocator(sourceLocator);
    if (!normalizedSource) return false;
    try {
      return this.packages.listInstalled().some((record) => {
        const installedSource = normalizeGitSourceLocator(record.sourceLocator || record.sourcePath);
        if (record.sourceType !== "git" || installedSource !== normalizedSource) return false;
        if (isCctoolsSkillsSourceLocator(sourceLocator)
          && !isSupportedOfficialIdentity(record.key, record.publisherId, record.id)) {
          return false;
        }
        return isDirectory(record.packagePath);
      });
    } catch {
      return false;
    }
  }

  /**
   * Offline startup gate for a previously completed Git-source installation.
   * The receipt captures the complete checkout at install time; every package
   * must still have matching provenance, metadata and installed bytes.
   */
  hasCompleteInstallation(sourceLocator: string): boolean {
    const receipt = this.sourceInstallations.get(sourceLocator);
    if (!receipt) {
      // Builds predating source receipts stored one intact official record per
      // package but no packageRef/revision. Preserve that already-complete
      // installation without turning corrupt receipts or new partial installs
      // into a bypass. A later full reinstall writes the durable receipt.
      if (this.sourceInstallations.isCorrupt() || !isCctoolsSkillsSourceLocator(sourceLocator)) return false;
      try {
        const legacyRecords = this.packages.listInstalled().filter((record) =>
          record.sourceType === "git"
          && normalizeGitSourceLocator(record.sourceLocator || "") === normalizeGitSourceLocator(sourceLocator)
          && record.sourcePackageRef === undefined
          && record.sourceRevision === undefined
          && this.packages.isInstalledCopyUsable(record)
        );
        return hasCompleteOfficialInstalledIdentitySet(legacyRecords);
      } catch {
        return false;
      }
    }
    if (isCctoolsSkillsSourceLocator(sourceLocator)
      && !hasCompleteOfficialSnapshotIdentitySet(receipt.packages)) {
      return false;
    }
    try {
      return receipt.packages.every((snapshot) => {
        const record = this.packages.getInstalled(snapshot.key, snapshot.digest);
        if (!record
          || record.sourceType !== "git"
          || normalizeGitSourceLocator(record.sourceLocator || "") !== receipt.sourceLocator
          || (record.sourceRef || undefined) !== (receipt.sourceRef || undefined)
          || record.sourcePackageRef !== snapshot.packageRef
          || (record.sourceRevision || undefined) !== (receipt.sourceRevision || undefined)
          || record.key !== snapshot.key
          || record.id !== snapshot.id
          || record.version !== snapshot.version
          || record.digest.toLowerCase() !== snapshot.digest) {
          return false;
        }
        return this.packages.isInstalledCopyUsable(record);
      });
    } catch {
      return false;
    }
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
      await removeGitCheckout(stagingRoot);
    }
  }

  private async resolveGitRevision(checkoutRoot: string): Promise<string | undefined> {
    try {
      const result = await this.runGit(["rev-parse", "--verify", "HEAD"], {
        cwd: checkoutRoot,
        env: gitEnvironment(path.dirname(checkoutRoot)),
        timeout: GIT_TIMEOUT_MS
      });
      const revision = result.stdout.trim().toLowerCase();
      return /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(revision) ? revision : undefined;
    } catch (error) {
      if (error instanceof SkillSourceError && error.code === "git-cancelled") throw error;
      // A resolved commit strengthens provenance but is not required for
      // installation from older or restricted Git clients.
      return undefined;
    }
  }
}

async function removeGitCheckout(stagingRoot: string): Promise<void> {
  try {
    await fs.promises.rm(stagingRoot, {
      recursive: true,
      force: true,
      maxRetries: GIT_CHECKOUT_CLEANUP_MAX_RETRIES,
      retryDelay: GIT_CHECKOUT_CLEANUP_RETRY_DELAY_MS
    });
  } catch (error) {
    // Windows can briefly retain handles to freshly-created Git pack files.
    // Cleanup must remain best-effort: a staging deletion failure must not
    // replace a successful inspection/install result or its actual error.
    const detail = error instanceof Error ? error.message : String(error);
    console.warn(`Unable to remove temporary Git checkout: ${redactGitError(detail)}`);
  }
}

function toInstallMetadata(
  source: Exclude<SkillPackageSourceInput, { type: "git" }> | Extract<SkillPackageSourceInput, { type: "git" }>,
  sourcePackageRef?: string,
  sourceRevision?: string
): SkillPackageSourceMetadata {
  return {
    sourceType: source.type,
    sourceLocator: source.locator,
    ...(source.type === "git" && source.ref ? { sourceRef: source.ref } : {}),
    ...(sourcePackageRef ? { sourcePackageRef } : {}),
    ...(sourceRevision ? { sourceRevision } : {})
  };
}

function selectGitPackageCandidates(
  candidates: GitPackageCandidate[],
  selectedRefs?: string[]
): { chosen: GitPackageCandidate[]; complete: boolean } {
  if (selectedRefs === undefined) return { chosen: candidates, complete: true };
  if (selectedRefs.length === 0) {
    throw new SkillSourceError("git-package-selection-invalid", "至少选择一个 Skill 包。");
  }
  const selected = new Set<string>();
  for (const ref of selectedRefs) {
    if (typeof ref !== "string" || !ref) {
      throw new SkillSourceError("git-package-selection-invalid", "Skill 包选择包含空 ref。");
    }
    if (selected.has(ref)) {
      throw new SkillSourceError("git-package-selection-invalid", `Skill 包选择包含重复 ref：${ref}`);
    }
    selected.add(ref);
  }
  const available = new Set(candidates.map(({ ref }) => ref));
  const unknown = [...selected].find((ref) => !available.has(ref));
  if (unknown) {
    throw new SkillSourceError("git-package-selection-invalid", `选中的 Skill 包在该 Git 仓库中不存在：${unknown}`);
  }
  return {
    chosen: candidates.filter(({ ref }) => selected.has(ref)),
    complete: selected.size === candidates.length
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
        const detail = String(stderr || error.message);
        if (/could not read Username|Authentication failed|Repository not found|terminal prompts disabled|disabled-askpass/i.test(detail)) {
          reject(new SkillSourceError("git-auth-required", "Git 仓库需要登录或当前账号无权访问；Skill 来源更新目前只支持无需登录的 HTTPS 仓库。"));
          return;
        }
        reject(new SkillSourceError("git-command-failed", `Git 来源下载失败：${redactGitError(detail)}`));
        return;
      }
      resolve({ stdout: String(stdout), stderr: String(stderr) });
    });
  });
}

export type GitPackageCandidate = {
  /** 仓库内相对路径，使用正斜杠分隔；根包为 "."。 */
  ref: string;
  absPath: string;
};

/**
 * 收集一个 Git checkout 内的全部 Skill 包候选：
 * 仓库根本身、一级子目录、`.claude/skills/*` 子目录及 BrowserSkill 的 CLI 内置包。
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

  // BrowserSkill moved its standalone skill/ package into the Rust CLI crate.
  const browserSkillRoot = path.join(checkoutRoot, "crates", "bsk-cli", "skill");
  if (hasSkillDescriptor(browserSkillRoot)) add("crates/bsk-cli/skill", browserSkillRoot);

  return out;
}

function hasSkillDescriptor(root: string): boolean {
  return ["cctools.skill.yaml", "openmind.skill.yaml", "SKILL.md"].some((name) => {
    const candidate = path.join(root, name);
    try { return fs.statSync(candidate).isFile(); } catch { return false; }
  });
}

function hasCompleteOfficialInstalledIdentitySet(records: InstalledSkillRecord[]): boolean {
  return ALL_SKILL_IDS.every((id) => records.some((record) =>
    record.id === id && isSupportedOfficialIdentity(record.key, record.publisherId, id)
  ));
}

function hasCompleteOfficialSnapshotIdentitySet(snapshots: Array<{ id: string; key: string }>): boolean {
  return ALL_SKILL_IDS.every((id) => snapshots.some((snapshot) =>
    snapshot.id === id
    && (snapshot.key === `cctools/${id}` || snapshot.key === `openmind/${id}`)
  ));
}

function isSupportedOfficialIdentity(key: string, publisherId: string, id: string): boolean {
  return (key === `cctools/${id}` && publisherId === "cctools")
    || (key === `openmind/${id}` && publisherId === "openmind");
}

function isDirectory(candidate: string): boolean {
  try { return fs.statSync(candidate).isDirectory(); } catch { return false; }
}

function redactGitError(value: string): string {
  return value.replace(/https:\/\/[^\s]+/gi, "<git-source>").slice(0, 1000);
}
