import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { SkillManifest } from "../../shared/skill-manifest-schema";
import { validateManifest } from "../../shared/skill-manifest-schema";
import {
  MYMIND_LAYOUT_V1,
  type MymindEntryCategory
} from "../../shared/mymind-layout-v1";
import { parseSkillFrontmatter, type ParsedSkillFrontmatter } from "../../shared/skill-frontmatter";
import type { SkillPackageInspectionView } from "../../shared/contracts";
import { getAppPaths, type AppPaths } from "../paths/app-paths-service";
import {
  INSTALLED_SKILL_REGISTRY_SCHEMA_VERSION,
  InstalledSkillRepository,
  type InstalledSkillReadiness,
  type InstalledSkillRecord
} from "./installed-skill-repository";
import { extractZipArchive, inspectZipArchive, SkillArchiveError } from "./zip-source";

const MANIFEST_FILE = "cctools.skill.yaml";
const LEGACY_FILE = "SKILL.md";
const MAX_PACKAGE_BYTES = 250 * 1024 * 1024;
const MAX_PACKAGE_FILES = 20_000;

/** Files and directories which must never become part of an installed package. */
const EXCLUDED_SEGMENTS = new Set([
  ".env",
  ".venv",
  "venv",
  "node_modules",
  "__pycache__",
  ".cache",
  "cache",
  "log",
  "logs",
  ".git",
  ".cctools",
  "browser-state",
  "browser-data",
  "curl.txt",
  "curl_foryou.txt",
  "x_curl.txt",
  "summary_cache.json",
  "article_cache.json",
  "posted_ids.json",
  "external_article_fetch.log",
  ".counter.json",
  "credentials",
  "credential",
  "mymind",
  "article",
  "creative",
  "daily-summary",
  "daily-topic",
  "post",
  "reddit",
  "wiki",
  "video"
]);

const SECRET_VALUE_PATTERNS = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /\bsk-[A-Za-z0-9_-]{24,}\b/,
  /\bnvapi-[A-Za-z0-9_-]{20,}\b/,
  /\bsecret_[A-Za-z0-9]{20,}\b/
];

type YamlLoader = { load(input: string, options?: Record<string, unknown>): unknown };
// js-yaml is intentionally loaded only by the Electron-side package service;
// the renderer stays free of a YAML parser.
const yaml = require("js-yaml") as YamlLoader;

export type SkillPackageErrorCode =
  | "source-not-found"
  | "source-not-directory"
  | "source-not-readable"
  | "unsafe-entry"
  | "escaping-symlink"
  | "hardlink-forbidden"
  | "special-file-forbidden"
  | "package-too-large"
  | "too-many-files"
  | "manifest-missing"
  | "manifest-yaml-invalid"
  | "manifest-invalid"
  | "manifest-path-invalid"
  | "mymind-write-forbidden"
  | "secret-in-package"
  | "legacy-inspect-only"
  | "archive-invalid"
  | "archive-too-large"
  | "archive-too-many-files"
  | "archive-compression-ratio"
  | "archive-entry-forbidden"
  | "active-version-protected"
  | "installed-digest-required"
  | "installed-path-invalid";

export class SkillPackageError extends Error {
  constructor(
    readonly code: SkillPackageErrorCode,
    message: string,
    readonly entryPath?: string
  ) {
    super(message);
    this.name = "SkillPackageError";
  }
}

export type SkillPackageFile = {
  path: string;
  type: "file" | "symlink";
  size: number;
  digest: string;
};

export type SkillPackageIssue = {
  code: SkillPackageErrorCode;
  message: string;
  path?: string;
};

export type LegacySkillSuggestion = {
  id: string;
  title: string;
  description: string;
  kind: "agent" | "process-suggestion";
  frontmatter: ParsedSkillFrontmatter;
  /** Only present when the legacy file explicitly declares a runner and args. */
  suggestedEntrypoint?: { runner: string; args: string[]; cwd: string };
  executionTrust: "inspect-only";
  migrationReason: string;
};

export type SkillPackageInspection = {
  sourcePath: string;
  sourceKind: "directory" | "legacy-claude" | "zip" | "git";
  valid: boolean;
  digest: string;
  totalBytes: number;
  files: SkillPackageFile[];
  excludedPaths: string[];
  manifest?: SkillManifest;
  legacy?: LegacySkillSuggestion;
  issues: SkillPackageIssue[];
  warnings: string[];
};

export type SkillPackageSourceMetadata = {
  sourceType: "directory" | "zip" | "git";
  sourceLocator: string;
  sourceRef?: string;
};

export function toSkillPackageInspectionView(inspection: SkillPackageInspection): SkillPackageInspectionView {
  return {
    sourcePath: inspection.sourcePath,
    sourceKind: inspection.sourceKind,
    valid: inspection.valid,
    digest: inspection.digest,
    totalBytes: inspection.totalBytes,
    files: inspection.files,
    excludedPaths: inspection.excludedPaths,
    manifest: inspection.manifest ?? null,
    legacy: inspection.legacy ?? null,
    issues: inspection.issues,
    warnings: inspection.warnings
  };
}

type WalkResult = {
  files: SkillPackageFile[];
  excludedPaths: string[];
  totalBytes: number;
  issues: SkillPackageIssue[];
};

/**
 * Phase 2 static package boundary.
 *
 * This service may read, hash, sanitize, and quarantine a package. It never
 * invokes an entrypoint, installs dependencies, executes hooks, or changes
 * the active version. Those operations belong behind RuntimeManager and
 * ExecutionBroker in later phases.
 */
export class SkillPackageService {
  private readonly paths: AppPaths;
  private readonly repository: InstalledSkillRepository;

  constructor(paths: AppPaths = getAppPaths()) {
    this.paths = paths;
    this.repository = new InstalledSkillRepository(paths.skillRegistryFile);
  }

  inspect(sourcePath: string): SkillPackageInspection {
    if (isZipSource(sourcePath)) {
      let archive;
      try { archive = inspectZipArchive(sourcePath); }
      catch (error) { throw toSkillPackageError(error); }
      fs.mkdirSync(this.paths.staging, { recursive: true });
      const extractionRoot = fs.mkdtempSync(path.join(this.paths.staging, "skill-archive-inspect-"));
      try {
        try { extractZipArchive(archive, extractionRoot); }
        catch (error) { throw toSkillPackageError(error); }
        return { ...this.inspect(extractionRoot), sourcePath: archive.sourcePath, sourceKind: "zip" };
      } finally {
        fs.rmSync(extractionRoot, { recursive: true, force: true });
      }
    }
    const canonicalSource = this.canonicalSource(sourcePath);
    const walk = walkPackage(canonicalSource);
    const issues = [...walk.issues];
    const manifestPath = path.join(canonicalSource, MANIFEST_FILE);
    const legacyPath = path.join(canonicalSource, LEGACY_FILE);
    let manifest: SkillManifest | undefined;
    let legacy: LegacySkillSuggestion | undefined;
    let sourceKind: SkillPackageInspection["sourceKind"] = "directory";

    if (fs.existsSync(manifestPath) && fs.statSync(manifestPath).isFile()) {
      try {
        const parsed = yaml.load(fs.readFileSync(manifestPath, "utf8"), { json: true });
        const result = validateManifest(parsed);
        if (!result.ok) {
          issues.push({
            code: "manifest-invalid",
            message: result.error.issues.map((issue) => `${issue.path.join(".") || "<root>"}: ${issue.message}`).join("; "),
            path: MANIFEST_FILE
          });
        } else {
          manifest = result.manifest;
          issues.push(...validateManifestPackagePaths(manifest));
        }
      } catch (error) {
        issues.push({
          code: "manifest-yaml-invalid",
          message: error instanceof Error ? error.message : String(error),
          path: MANIFEST_FILE
        });
      }
    } else if (fs.existsSync(legacyPath) && fs.statSync(legacyPath).isFile()) {
      sourceKind = "legacy-claude";
      legacy = buildLegacySuggestion(canonicalSource, fs.readFileSync(legacyPath, "utf8"));
      issues.push({
        code: "legacy-inspect-only",
        message: "该 Skill 只有 SKILL.md，处于 inspect-only；需迁移为正式 cctools.skill.yaml 后才可安装运行。",
        path: LEGACY_FILE
      });
    } else {
      issues.push({ code: "manifest-missing", message: `缺少 ${MANIFEST_FILE}。` });
    }

    const digest = digestPackage(canonicalSource, walk.files);
    if (manifest && containsSecretValue(manifest)) {
      issues.push({
        code: "secret-in-package",
        message: "Manifest 包含疑似 Secret 值；只能引用 Secret 名称，不能携带 Secret 内容。",
        path: MANIFEST_FILE
      });
    }
    if (walk.totalBytes > MAX_PACKAGE_BYTES) {
      issues.push({ code: "package-too-large", message: `包体超过 ${MAX_PACKAGE_BYTES} 字节。` });
    }
    if (walk.files.length + walk.excludedPaths.length > MAX_PACKAGE_FILES) {
      issues.push({ code: "too-many-files", message: `包内文件数量超过 ${MAX_PACKAGE_FILES}。` });
    }

    return {
      sourcePath: canonicalSource,
      sourceKind,
      valid: issues.length === 0 && Boolean(manifest),
      digest,
      totalBytes: walk.totalBytes,
      files: walk.files,
      excludedPaths: walk.excludedPaths,
      ...(manifest ? { manifest } : {}),
      ...(legacy ? { legacy } : {}),
      issues,
      warnings: walk.excludedPaths.length
        ? [`已排除 ${walk.excludedPaths.length} 个 Secret、缓存或生成内容路径。`]
        : []
    };
  }

  /**
   * Copy a valid local package into a private version directory and register
   * it as quarantined. The active pointer is deliberately untouched.
   */
  install(sourcePath: string, sourceMetadata?: SkillPackageSourceMetadata): InstalledSkillRecord {
    const inspection = this.inspect(sourcePath);
    if (!inspection.valid || !inspection.manifest) {
      const first = inspection.issues[0];
      throw new SkillPackageError(first?.code || "manifest-invalid", first?.message || "Skill 包检查失败。", first?.path);
    }

    const manifest = inspection.manifest;
    const key = `${manifest.publisher.id}/${manifest.id}`;
    const existing = this.repository.get(
      key,
      inspection.digest
    );
    if (existing) return existing;

    fs.mkdirSync(this.paths.staging, { recursive: true });
    fs.mkdirSync(this.paths.skills, { recursive: true });
    const stagingRoot = fs.mkdtempSync(path.join(this.paths.staging, "skill-package-"));
    let archiveRoot: string | null = null;
    let packageSource = inspection.sourcePath;
    const destination = path.join(
      this.paths.skills,
      manifest.publisher.id,
      manifest.id,
      `${manifest.version}-${inspection.digest.slice(0, 16)}`
    );
    try {
      if (isZipSource(sourcePath)) {
        const archive = (() => {
          try { return inspectZipArchive(sourcePath); }
          catch (error) { throw toSkillPackageError(error); }
        })();
        archiveRoot = fs.mkdtempSync(path.join(this.paths.staging, "skill-archive-install-"));
        try { extractZipArchive(archive, archiveRoot); }
        catch (error) { throw toSkillPackageError(error); }
        packageSource = archiveRoot;
      }
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      copyCleanPackage(packageSource, stagingRoot, inspection.files);
      if (fs.existsSync(destination)) {
        fs.rmSync(stagingRoot, { recursive: true, force: true });
      } else {
        fs.renameSync(stagingRoot, destination);
      }

      const record: InstalledSkillRecord = {
        schemaVersion: INSTALLED_SKILL_REGISTRY_SCHEMA_VERSION,
        key,
        id: manifest.id,
        publisherId: manifest.publisher.id,
        version: manifest.version,
        digest: inspection.digest,
        // Keep sourcePath compatible with the original local registry while
        // recording a stable locator for remote adapters such as Git.
        sourcePath: sourceMetadata?.sourceLocator || inspection.sourcePath,
        ...(sourceMetadata ? {
          sourceType: sourceMetadata.sourceType,
          sourceLocator: sourceMetadata.sourceLocator,
          ...(sourceMetadata.sourceRef ? { sourceRef: sourceMetadata.sourceRef } : {})
        } : {}),
        packagePath: destination,
        status: "quarantined",
        readiness: "installed-not-ready",
        signatureStatus: "unsigned",
        reviewStatus: "unreviewed",
        executionTrust: "inspect-only",
        skillUpdatePolicy: "manual",
        installedAt: new Date().toISOString()
      };
      return this.repository.upsert(record);
    } catch (error) {
      if (fs.existsSync(stagingRoot)) fs.rmSync(stagingRoot, { recursive: true, force: true });
      if (fs.existsSync(destination) && !this.repository.list().some((record) => record.packagePath === destination)) {
        fs.rmSync(destination, { recursive: true, force: true });
      }
      throw error;
    } finally {
      if (archiveRoot && fs.existsSync(archiveRoot)) fs.rmSync(archiveRoot, { recursive: true, force: true });
    }
  }

  markReadiness(key: string, digest: string, readiness: InstalledSkillReadiness): InstalledSkillRecord {
    return this.repository.markReadiness(key, digest, readiness);
  }

  approveHostExecution(key: string, digest: string): InstalledSkillRecord {
    const record = this.getInstalled(key, digest);
    if (!record) throw new SkillPackageError("installed-path-invalid", `Installed Skill 不存在：${key}@${digest}`);
    this.assertInstalledCopyIntegrity(record);
    return this.repository.approveHostExecution(key, digest);
  }

  activate(key: string, digest: string): { active: InstalledSkillRecord; previous?: InstalledSkillRecord } {
    return this.repository.activate(key, digest);
  }

  rollback(key: string): { active: InstalledSkillRecord; previous: InstalledSkillRecord } {
    return this.repository.rollback(key);
  }

  /**
   * Static discovery of the legacy workspace surface. Every returned item is
   * inspected independently so one malformed Skill cannot hide the others.
   */
  inspectClaudeSkills(workspaceRoot: string): SkillPackageInspection[] {
    const workspace = this.canonicalSource(workspaceRoot);
    const skillsRoot = path.join(workspace, ".claude", "skills");
    if (!fs.existsSync(skillsRoot) || !fs.statSync(skillsRoot).isDirectory()) return [];
    return fs.readdirSync(skillsRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith("_"))
      .sort((left, right) => left.name.localeCompare(right.name))
      .map((entry) => path.join(skillsRoot, entry.name))
      .filter((sourcePath) => hasSkillDescriptor(sourcePath))
      .map((sourcePath) => this.inspect(sourcePath));
  }

  /**
   * Batch migration entry for the old `.claude/skills` surface. Valid Manifest
   * packages are copied to quarantine; Legacy packages remain inspect-only and
   * are returned as skipped, never silently upgraded or executed.
   */
  migrateClaudeSkills(workspaceRoot: string): ClaudeSkillMigrationReport {
    const inspected = this.inspectClaudeSkills(workspaceRoot);
    const installed: InstalledSkillRecord[] = [];
    const skipped: ClaudeSkillMigrationSkip[] = [];
    for (const item of inspected) {
      if (item.valid) installed.push(this.install(item.sourcePath));
      else skipped.push({ sourcePath: item.sourcePath, issues: item.issues });
    }
    return { inspected, installed, skipped };
  }

  listInstalled(): InstalledSkillRecord[] {
    return this.repository.list().map((record) => this.refreshIntegrity(record));
  }

  getInstalled(key: string, digest?: string): InstalledSkillRecord | undefined {
    const record = this.repository.get(key, digest);
    return record ? this.refreshIntegrity(record) : undefined;
  }

  getActiveInstalled(skillId: string): InstalledSkillRecord | undefined {
    return this.listInstalled().find((record) => record.id === skillId && record.status === "active");
  }

  /** Returns whether the original local source changed since installation. */
  sourceModified(record: InstalledSkillRecord): boolean {
    // A Git locator is not a local checkout. Its remote ref can only be
    // refreshed through SkillSourceService, so do not classify it as modified
    // merely because the locator is not a filesystem path.
    if (record.sourceType === "git") return false;
    if (!fs.existsSync(record.sourcePath)) return true;
    try {
      const inspection = this.inspect(record.sourcePath);
      return inspection.digest !== record.digest;
    } catch {
      return true;
    }
  }

  /**
   * Re-check both the app-private installed copy and the original local
   * source. A changed digest remains inspectable, but it cannot retain host
   * execution approval or review evidence.
   */
  private refreshIntegrity(record: InstalledSkillRecord): InstalledSkillRecord {
    let modified = !fs.existsSync(record.packagePath);
    if (!modified) {
      try {
        modified = this.inspect(record.packagePath).digest !== record.digest;
      } catch {
        modified = true;
      }
    }
    if (!modified && record.sourceType !== "git") modified = this.sourceModified(record);
    return modified ? this.repository.markModified(record.key, record.digest) : record;
  }

  private assertInstalledCopyIntegrity(record: InstalledSkillRecord): void {
    if (!fs.existsSync(record.packagePath)) {
      throw new SkillPackageError("installed-path-invalid", "Installed Skill 包体不存在，拒绝授予宿主机执行授权。", record.packagePath);
    }
    let inspection: SkillPackageInspection;
    try {
      inspection = this.inspect(record.packagePath);
    } catch (error) {
      throw new SkillPackageError("installed-path-invalid", `Installed Skill 包体无法重新检查：${error instanceof Error ? error.message : String(error)}`, record.packagePath);
    }
    if (!inspection.valid || inspection.digest !== record.digest) {
      throw new SkillPackageError("installed-path-invalid", "Installed Skill 包体 digest 已变化，拒绝授予宿主机执行授权。", record.packagePath);
    }
  }

  /** Remove only a non-active quarantined candidate; never deletes mymind/output data. */
  uninstall(key: string, digest?: string): boolean {
    const matches = this.repository.list().filter((record) => record.key === key);
    if (!digest && matches.length > 1) {
      throw new SkillPackageError("installed-digest-required", "同一 Skill 有多个安装版本，卸载时必须指定 digest。", key);
    }
    const target = matches.find((record) => !digest || record.digest === digest);
    if (!target) return false;
    if (target.status === "active") {
      throw new SkillPackageError("active-version-protected", "当前 active 版本不能在 Phase 2 直接卸载。", target.packagePath);
    }
    this.assertManagedPackagePath(target.packagePath);
    fs.mkdirSync(this.paths.staging, { recursive: true });
    const trashPath = path.join(this.paths.staging, `skill-uninstall-${target.digest}-${Date.now()}`);
    const moved = fs.existsSync(target.packagePath);
    if (moved) fs.renameSync(target.packagePath, trashPath);
    try {
      const removed = this.repository.remove(key, target.digest);
      if (!removed) throw new Error(`卸载时 registry 记录已消失：${key}@${target.digest}`);
      fs.rmSync(trashPath, { recursive: true, force: true });
      return true;
    } catch (error) {
      if (moved && !fs.existsSync(target.packagePath) && fs.existsSync(trashPath)) {
        fs.renameSync(trashPath, target.packagePath);
      }
      throw error;
    }
  }

  private assertManagedPackagePath(packagePath: string): void {
    const root = path.resolve(this.paths.skills);
    const candidate = path.resolve(packagePath);
    if (candidate === root || !candidate.startsWith(`${root}${path.sep}`)) {
      throw new SkillPackageError("installed-path-invalid", "拒绝操作 Skills 根目录之外的安装包。", packagePath);
    }
    if (fs.existsSync(candidate)) {
      const realRoot = fs.realpathSync(root);
      const realCandidate = fs.realpathSync(candidate);
      if (realCandidate === realRoot || !realCandidate.startsWith(`${realRoot}${path.sep}`)) {
        throw new SkillPackageError("installed-path-invalid", "安装包路径解析后越出 Skills 根目录。", packagePath);
      }
    }
  }

  private canonicalSource(sourcePath: string): string {
    if (!fs.existsSync(sourcePath)) throw new SkillPackageError("source-not-found", `Skill 来源不存在：${sourcePath}`);
    let stat: fs.Stats;
    try { stat = fs.statSync(sourcePath); } catch (error) {
      throw new SkillPackageError("source-not-readable", error instanceof Error ? error.message : String(error));
    }
    if (!stat.isDirectory()) throw new SkillPackageError("source-not-directory", `Skill 来源必须是目录：${sourcePath}`);
    try { return fs.realpathSync(sourcePath); } catch (error) {
      throw new SkillPackageError("source-not-readable", error instanceof Error ? error.message : String(error));
    }
  }

}

export type ClaudeSkillMigrationSkip = {
  sourcePath: string;
  issues: SkillPackageIssue[];
};

export type ClaudeSkillMigrationReport = {
  inspected: SkillPackageInspection[];
  installed: InstalledSkillRecord[];
  skipped: ClaudeSkillMigrationSkip[];
};

function walkPackage(root: string): WalkResult {
  const files: SkillPackageFile[] = [];
  const excludedPaths: string[] = [];
  const issues: SkillPackageIssue[] = [];
  let totalBytes = 0;

  const visit = (absoluteDir: string, logicalDir: string, excludedAncestor = false): void => {
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(absoluteDir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name)); } catch (error) {
      issues.push({ code: "source-not-readable", message: error instanceof Error ? error.message : String(error), path: logicalDir });
      return;
    }
    for (const entry of entries) {
      const logicalPath = logicalDir ? `${logicalDir}/${entry.name}` : entry.name;
      if (!isSafePackagePath(logicalPath)) {
        issues.push({ code: "unsafe-entry", message: `包内路径不安全：${logicalPath}`, path: logicalPath });
        continue;
      }
      const absolutePath = path.join(absoluteDir, entry.name);
      let stat: fs.Stats;
      let linkStat: fs.Stats;
      try { linkStat = fs.lstatSync(absolutePath); } catch (error) {
        issues.push({ code: "source-not-readable", message: error instanceof Error ? error.message : String(error), path: logicalPath });
        continue;
      }
      const excluded = excludedAncestor || isExcludedPath(logicalPath);
      if (linkStat.isDirectory()) {
        if (excluded) excludedPaths.push(`${logicalPath}/`);
        visit(absolutePath, logicalPath, excluded);
        continue;
      }
      // Excluded virtualenv/cache/user-output trees are never copied into an
      // installed package. Do not let their symlinks or hardlinks make an
      // otherwise clean package fail static inspection; still retain their
      // paths in the inspection report for transparency.
      if (excluded) {
        excludedPaths.push(logicalPath);
        continue;
      }
      if (linkStat.isSymbolicLink()) {
        try {
          const realTarget = fs.realpathSync(absolutePath);
          if (!isInside(root, realTarget)) {
            issues.push({ code: "escaping-symlink", message: `symlink 越出包根：${logicalPath}`, path: logicalPath });
          }
        } catch (error) {
          issues.push({ code: "escaping-symlink", message: `symlink 无法解析：${logicalPath}`, path: logicalPath });
        }
        const target = fs.readlinkSync(absolutePath);
        files.push({ path: logicalPath, type: "symlink", size: Buffer.byteLength(target), digest: sha256(target) });
        continue;
      }
      if (!linkStat.isFile()) {
        issues.push({ code: "special-file-forbidden", message: `禁止特殊文件：${logicalPath}`, path: logicalPath });
        continue;
      }
      try { stat = fs.statSync(absolutePath); } catch (error) {
        issues.push({ code: "source-not-readable", message: error instanceof Error ? error.message : String(error), path: logicalPath });
        continue;
      }
      if (stat.nlink > 1) {
        issues.push({ code: "hardlink-forbidden", message: `禁止 hardlink：${logicalPath}`, path: logicalPath });
        continue;
      }
      totalBytes += stat.size;
      files.push({ path: logicalPath, type: "file", size: stat.size, digest: sha256File(absolutePath) });
    }
  };

  visit(root, "");
  return { files, excludedPaths, totalBytes, issues };
}

function digestPackage(root: string, files: SkillPackageFile[]): string {
  const hash = crypto.createHash("sha256");
  hash.update("cctools-skill-package-v1\n");
  for (const file of files.slice().sort((a, b) => a.path.localeCompare(b.path))) {
    hash.update(`${file.type}\0${file.path}\0${file.size}\0${file.digest}\n`);
    if (file.type === "file") hash.update(fs.readFileSync(path.join(root, ...file.path.split("/"))));
  }
  return hash.digest("hex");
}

function copyCleanPackage(source: string, destination: string, files: SkillPackageFile[]): void {
  fs.mkdirSync(destination, { recursive: true });
  for (const file of files) {
    const sourcePath = path.join(source, ...file.path.split("/"));
    const destinationPath = path.join(destination, ...file.path.split("/"));
    fs.mkdirSync(path.dirname(destinationPath), { recursive: true });
    if (file.type === "symlink") fs.symlinkSync(fs.readlinkSync(sourcePath), destinationPath);
    else fs.copyFileSync(sourcePath, destinationPath);
  }
}

function validateManifestPackagePaths(manifest: SkillManifest): SkillPackageIssue[] {
  const issues: SkillPackageIssue[] = [];
  for (const [index, artifact] of manifest.artifacts.entries()) {
    if (!artifact.path || artifact.externalExportId) continue;
    if (!isSafeTemplatePath(artifact.path)) {
      issues.push({ code: "manifest-path-invalid", message: "artifact.path 必须是包内安全的逻辑路径。", path: `artifacts.${index}.path` });
    }
  }
  for (const pattern of manifest.capabilities.mymind.write) {
    const topLevel = pattern.split("/")[0];
    const entry = MYMIND_LAYOUT_V1.find((item) => item.logicalPath === topLevel);
    if (!entry || !isWritableLayoutCategory(entry.category)) {
      issues.push({ code: "mymind-write-forbidden", message: `mymind.write 不允许写入 '${topLevel}'。`, path: "capabilities.mymind.write" });
    }
  }
  return issues;
}

function buildLegacySuggestion(sourceRoot: string, content: string): LegacySkillSuggestion {
  const frontmatter = parseSkillFrontmatter(content);
  const dirName = path.basename(sourceRoot);
  const id = frontmatter.id || frontmatter.name || dirName;
  const title = frontmatter.title || frontmatter.name || dirName;
  const explicitRunner = frontmatter.runner && frontmatter.args && frontmatter.args.length > 0;
  return {
    id,
    title,
    description: frontmatter.description || "",
    kind: explicitRunner ? "process-suggestion" : "agent",
    frontmatter,
    ...(explicitRunner ? {
      suggestedEntrypoint: {
        runner: frontmatter.runner as string,
        args: frontmatter.args as string[],
        cwd: frontmatter.cwd || path.join(".claude", "skills", dirName)
      }
    } : {}),
    executionTrust: "inspect-only",
    migrationReason: explicitRunner
      ? "旧 frontmatter 声明了 runner/args，但尚未形成 Manifest、能力、Runtime 和 Artifact 合同。"
      : "旧 Skill 没有可验证的进程入口，应按 Agent/Prompt Skill 迁移。"
  };
}

function isWritableLayoutCategory(category: MymindEntryCategory): boolean {
  return category === "initialize-required" || category === "create-if-needed";
}

function hasSkillDescriptor(sourcePath: string): boolean {
  return [MANIFEST_FILE, LEGACY_FILE].some((name) => {
    const candidate = path.join(sourcePath, name);
    try { return fs.statSync(candidate).isFile(); } catch { return false; }
  });
}

function isZipSource(sourcePath: string): boolean {
  try {
    return fs.statSync(sourcePath).isFile() && path.extname(sourcePath).toLocaleLowerCase() === ".zip";
  } catch {
    return false;
  }
}

function toSkillPackageError(error: unknown): SkillPackageError {
  if (error instanceof SkillPackageError) return error;
  if (error instanceof SkillArchiveError) return new SkillPackageError(error.code, error.message, error.entryPath);
  return new SkillPackageError("archive-invalid", error instanceof Error ? error.message : String(error));
}

function isExcludedPath(logicalPath: string): boolean {
  return logicalPath.split("/").some((segment) => EXCLUDED_SEGMENTS.has(segment) || segment.startsWith(".env."));
}

function isSafePackagePath(value: string): boolean {
  const normalized = value.replaceAll("\\", "/");
  return !normalized.startsWith("/") && !/^[A-Za-z]:\//.test(normalized)
    && !normalized.startsWith("//") && normalized.split("/").every((segment) => segment && segment !== "." && segment !== "..");
}

function isSafeTemplatePath(value: string): boolean {
  return isSafePackagePath(value) && !value.includes("\\");
}

function isInside(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return relative === "" || (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

function containsSecretValue(value: unknown): boolean {
  if (typeof value === "string") return SECRET_VALUE_PATTERNS.some((pattern) => pattern.test(value));
  if (Array.isArray(value)) return value.some(containsSecretValue);
  if (value && typeof value === "object") return Object.values(value).some(containsSecretValue);
  return false;
}

function sha256(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function sha256File(filePath: string): string {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}
