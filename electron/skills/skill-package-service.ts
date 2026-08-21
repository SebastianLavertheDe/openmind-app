import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { SkillManifest } from "../../shared/skill-manifest-schema";
import { validateManifest } from "../../shared/skill-manifest-schema";
import {
  OPENMIND_LAYOUT_V2,
  type OpenmindEntryCategory
} from "../../shared/openmind-layout-v2";
import { parseSkillFrontmatter, type ParsedSkillFrontmatter } from "../../shared/skill-frontmatter";
import type { InstalledRunnableSkillView, InstalledSkillView, SkillPackageInspectionView } from "../../shared/contracts";
import { getAppPaths, type AppPaths } from "../paths/app-paths-service";
import {
  INSTALLED_SKILL_REGISTRY_SCHEMA_VERSION,
  InstalledSkillRepository,
  type InstalledSkillRecord
} from "./installed-skill-repository";
import { InstalledSkillPreferencesRepository } from "./installed-skill-preferences-repository";
import { extractZipArchive, inspectZipArchive, SkillArchiveError } from "./zip-source";

const PRIMARY_MANIFEST_FILE = "cctools.skill.yaml";
const COMPAT_MANIFEST_FILE = "openmind.skill.yaml";
const MANIFEST_FILES = [PRIMARY_MANIFEST_FILE, COMPAT_MANIFEST_FILE] as const;
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
  ".openmind",
  "browser-state",
  "browser-data",
  "curl.txt",
  "curl_foryou.txt",
  "x_curl.txt",
  "summary_cache.json",
  "article_cache.json",
  "article-counter.json",
  "wechat_storage_state.json",
  "posted_ids.json",
  "external_article_fetch.log",
  ".counter.json",
  "credentials",
  "credential",
  "openmind",
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
  | "openmind-write-forbidden"
  | "secret-in-package"
  | "legacy-inspect-only"
  | "archive-invalid"
  | "archive-too-large"
  | "archive-too-many-files"
  | "archive-compression-ratio"
  | "archive-entry-forbidden"
  | "installed-skill-not-found"
  | "installed-path-invalid"
  | "skill-store-unavailable";

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
  migrationReason: string;
};

export type SkillPackageInspection = {
  sourcePath: string;
  sourceKind: "directory" | "legacy-claude" | "zip" | "git";
  /** Git 多包仓库内的包路径（"." 为仓库根包）。 */
  packageRef?: string;
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
  /** Path of this package inside a multi-package source repository. */
  sourcePackageRef?: string;
  /** Immutable Git commit resolved while the source checkout was installed. */
  sourceRevision?: string;
};

export function toSkillPackageInspectionView(inspection: SkillPackageInspection): SkillPackageInspectionView {
  return {
    sourcePath: inspection.sourcePath,
    sourceKind: inspection.sourceKind,
    ...(inspection.packageRef ? { packageRef: inspection.packageRef } : {}),
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
 * This service may read, hash, sanitize, install, and verify a package. It
 * never invokes an entrypoint, installs dependencies, or executes hooks.
 * RuntimeManager and ExecutionBroker own all execution-time preparation.
 */
export class SkillPackageService {
  private readonly paths: AppPaths;
  private readonly repository: InstalledSkillRepository;
  private readonly preferences: InstalledSkillPreferencesRepository;

  constructor(paths: AppPaths = getAppPaths()) {
    this.paths = paths;
    this.repository = new InstalledSkillRepository(paths.skillRegistryFile);
    this.preferences = new InstalledSkillPreferencesRepository(paths.skills);
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
    const presentManifestFiles = MANIFEST_FILES.filter((name) => isRegularFile(path.join(canonicalSource, name)));
    const manifestFile = presentManifestFiles[0];
    const manifestPath = manifestFile ? path.join(canonicalSource, manifestFile) : undefined;
    const legacyPath = path.join(canonicalSource, LEGACY_FILE);
    const manifestWarnings = presentManifestFiles.length > 1
      ? [`同时检测到 ${PRIMARY_MANIFEST_FILE} 与 ${COMPAT_MANIFEST_FILE}；已确定性使用 ${PRIMARY_MANIFEST_FILE}。`]
      : [];
    let manifest: SkillManifest | undefined;
    let legacy: LegacySkillSuggestion | undefined;
    let sourceKind: SkillPackageInspection["sourceKind"] = "directory";

    if (manifestPath && manifestFile) {
      try {
        const parsed = yaml.load(fs.readFileSync(manifestPath, "utf8"), { json: true });
        const result = validateManifest(normalizeManifestDocument(parsed, manifestFile));
        if (!result.ok) {
          issues.push({
            code: "manifest-invalid",
            message: result.error.issues.map((issue) => `${issue.path.join(".") || "<root>"}: ${issue.message}`).join("; "),
            path: manifestFile
          });
        } else {
          manifest = result.manifest;
          issues.push(...validateManifestPackagePaths(manifest));
        }
      } catch (error) {
        issues.push({
          code: "manifest-yaml-invalid",
          message: error instanceof Error ? error.message : String(error),
          path: manifestFile
        });
      }
    } else if (fs.existsSync(legacyPath) && fs.statSync(legacyPath).isFile()) {
      sourceKind = "legacy-claude";
      legacy = buildLegacySuggestion(canonicalSource, fs.readFileSync(legacyPath, "utf8"));
      issues.push({
        code: "legacy-inspect-only",
        message: `该 Skill 只有 SKILL.md，只能检查；需迁移为正式 ${PRIMARY_MANIFEST_FILE} 后才可安装运行。`,
        path: LEGACY_FILE
      });
    } else {
      issues.push({
        code: "manifest-missing",
        message: `缺少 ${PRIMARY_MANIFEST_FILE}（兼容 ${COMPAT_MANIFEST_FILE}）。`
      });
    }

    const digest = digestPackage(canonicalSource, walk.files);
    if (manifest && containsSecretValue(manifest)) {
      issues.push({
        code: "secret-in-package",
        message: "Manifest 包含疑似 Secret 值；只能引用 Secret 名称，不能携带 Secret 内容。",
        path: manifestFile
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
      warnings: [
        ...manifestWarnings,
        ...(walk.excludedPaths.length
          ? [`已排除 ${walk.excludedPaths.length} 个 Secret、缓存或生成内容路径。`]
          : [])
      ]
    };
  }

  /**
   * Copy a valid package into its single store directory and register it.
   * Different content replaces the directory in a staging→rename transaction;
   * identical, intact content only refreshes source provenance.
   */
  install(sourcePath: string, sourceMetadata?: SkillPackageSourceMetadata): InstalledSkillRecord {
    const inspection = this.inspect(sourcePath);
    if (!inspection.valid || !inspection.manifest) {
      const first = inspection.issues[0];
      throw new SkillPackageError(first?.code || "manifest-invalid", first?.message || "Skill 包检查失败。", first?.path);
    }

    const manifest = inspection.manifest;
    const key = `${manifest.publisher.id}/${manifest.id}`;
    // The official manifest namespace changed from openmind/* to cctools/*.
    // Replace only that known compatibility identity; unrelated publishers
    // with the same id still fail the repository's global-id invariant.
    const compatibilityIdentity = manifest.publisher.id === "cctools"
      ? this.repository.get(`openmind/${manifest.id}`)
      : undefined;
    const existing = this.repository.get(
      key,
      inspection.digest
    );
    if (existing && this.isInstalledCopyUsable(existing)) {
      // Reinstalling an identical package from Git is also how a workspace
      // installation is migrated to its durable repository source. Preserve
      // the installed copy while refreshing only the source provenance.
      if (sourceMetadata) {
        const {
          sourceRef: _previousSourceRef,
          sourcePackageRef: _previousSourcePackageRef,
          sourceRevision: _previousSourceRevision,
          ...existingWithoutSourceMetadata
        } = existing;
        return this.repository.upsert({
          ...existingWithoutSourceMetadata,
          sourcePath: sourceMetadata.sourceLocator,
          sourceType: sourceMetadata.sourceType,
          sourceLocator: sourceMetadata.sourceLocator,
          ...(sourceMetadata.sourceRef ? { sourceRef: sourceMetadata.sourceRef } : {}),
          ...(sourceMetadata.sourcePackageRef ? { sourcePackageRef: sourceMetadata.sourcePackageRef } : {}),
          ...(sourceMetadata.sourceRevision ? { sourceRevision: sourceMetadata.sourceRevision } : {})
        });
      }
      return existing;
    }

    if (!this.paths.skills) {
      throw new SkillPackageError("skill-store-unavailable", "Skill store 不可用：尚未绑定 openmind 根目录（内部不变量）。");
    }

    fs.mkdirSync(this.paths.staging, { recursive: true });
    fs.mkdirSync(this.paths.skills, { recursive: true });
    const stagingRoot = fs.mkdtempSync(path.join(this.paths.staging, "skill-package-"));
    let archiveRoot: string | null = null;
    let packageSource = inspection.sourcePath;
    // One directory per skill: <skills>/<publisher>/<id>. Reinstalling
    // different content swaps the directory in a single rename; the digest
    // lives in the registry only, so the layout never accumulates versions.
    const destination = path.join(this.paths.skills, manifest.publisher.id, manifest.id);
    let replacedTrash: string | null = null;
    let compatibilityTrash: string | null = null;
    let candidatePromoted = false;
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
      copyCleanPackage(packageSource, stagingRoot, inspection.files);
      if (fs.existsSync(destination)) {
        replacedTrash = path.join(this.paths.staging, `skill-replaced-${inspection.digest.slice(0, 16)}-${Date.now()}`);
        fs.renameSync(destination, replacedTrash);
      }
      if (compatibilityIdentity && compatibilityIdentity.packagePath !== destination) {
        this.assertManagedPackagePath(compatibilityIdentity.packagePath);
        if (fs.existsSync(compatibilityIdentity.packagePath)) {
          compatibilityTrash = path.join(
            this.paths.staging,
            `skill-identity-${inspection.digest.slice(0, 16)}-${Date.now()}`
          );
          fs.renameSync(compatibilityIdentity.packagePath, compatibilityTrash);
        }
      }
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      fs.renameSync(stagingRoot, destination);
      candidatePromoted = true;

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
          ...(sourceMetadata.sourceRef ? { sourceRef: sourceMetadata.sourceRef } : {}),
          ...(sourceMetadata.sourcePackageRef ? { sourcePackageRef: sourceMetadata.sourcePackageRef } : {}),
          ...(sourceMetadata.sourceRevision ? { sourceRevision: sourceMetadata.sourceRevision } : {})
        } : {}),
        packagePath: destination,
        signatureStatus: "unsigned",
        reviewStatus: "unreviewed",
        skillUpdatePolicy: "manual",
        installedAt: new Date().toISOString()
      };
      const installed = compatibilityIdentity
        ? this.repository.replaceIdentity(compatibilityIdentity.key, record)
        : this.repository.upsert(record);
      // Registry commit is the transaction boundary. Old package bytes are
      // best-effort cleanup after the new record is durable.
      if (replacedTrash) {
        try { fs.rmSync(replacedTrash, { recursive: true, force: true }); }
        catch { /* A later staging cleanup may remove this inert backup. */ }
      }
      if (compatibilityTrash) {
        try { fs.rmSync(compatibilityTrash, { recursive: true, force: true }); }
        catch { /* A later staging cleanup may remove this inert backup. */ }
      }
      return installed;
    } catch (error) {
      if (fs.existsSync(stagingRoot)) fs.rmSync(stagingRoot, { recursive: true, force: true });
      // No registry write completed: remove the candidate and put the exact
      // previous package directory back before surfacing the failure.
      if (candidatePromoted && fs.existsSync(destination)) {
        fs.rmSync(destination, { recursive: true, force: true });
      }
      if (replacedTrash && fs.existsSync(replacedTrash)) {
        fs.renameSync(replacedTrash, destination);
      }
      if (compatibilityTrash && compatibilityIdentity
        && !fs.existsSync(compatibilityIdentity.packagePath)
        && fs.existsSync(compatibilityTrash)) {
        fs.mkdirSync(path.dirname(compatibilityIdentity.packagePath), { recursive: true });
        fs.renameSync(compatibilityTrash, compatibilityIdentity.packagePath);
      }
      throw error;
    } finally {
      if (archiveRoot && fs.existsSync(archiveRoot)) fs.rmSync(archiveRoot, { recursive: true, force: true });
    }
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
   * packages are installed; Legacy packages remain inspection-only
   * and are returned as skipped, never silently upgraded or executed.
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
    return this.repository.list();
  }

  getInstalled(key: string, digest?: string): InstalledSkillRecord | undefined {
    return this.repository.get(key, digest);
  }

  getInstalledById(skillId: string): InstalledSkillRecord | undefined {
    return this.listInstalled().find((record) => record.id === skillId);
  }

  /** User enablement is independent from package integrity and installation. */
  isEnabled(record: InstalledSkillRecord): boolean {
    return this.preferences.isEnabled(record.key);
  }

  /** Renderer-safe record with usability derived from current package bytes. */
  toInstalledView(record: InstalledSkillRecord): InstalledSkillView {
    return {
      ...record,
      enabled: this.isEnabled(record),
      usable: this.isInstalledCopyUsable(record)
    };
  }

  listInstalledViews(): InstalledSkillView[] {
    return this.listInstalled().map((record) => this.toInstalledView(record));
  }

  /**
   * Non-conversation catalog for Automation/Broker surfaces. A fresh package
   * inspection supplies the formal Manifest display metadata and excludes
   * Agent packages, which belong only to frozen AI session snapshots.
   */
  listInstalledRunnableViews(): InstalledRunnableSkillView[] {
    return this.listInstalled().flatMap((record) => {
      try {
        const inspection = this.inspectInstalledCopy(record);
        const manifest = inspection.manifest;
        if (!manifest || manifest.kind === "agent") return [];
        return [{
          key: record.key,
          id: record.id,
          publisherId: record.publisherId,
          version: record.version,
          digest: record.digest,
          kind: manifest.kind,
          title: manifest.display.name,
          description: manifest.display.description,
          group: manifest.display.group,
          enabled: this.isEnabled(record)
        } satisfies InstalledRunnableSkillView];
      } catch {
        // Corrupt package bytes or enablement preferences fail closed and do
        // not make the wider Automation page or app bootstrap fatal.
        return [];
      }
    });
  }

  /**
   * Atomically update the preference for the exact package shown to the user.
   * Digest matching prevents a stale Renderer from toggling a replacement it
   * has not inspected yet. No install metadata or source receipt is changed.
   */
  setEnabled(key: string, digest: string, enabled: boolean): InstalledSkillRecord {
    if (typeof enabled !== "boolean") throw new Error("Skill enabled 必须是 boolean。");
    const target = this.repository.get(key, digest);
    if (!target) {
      throw new SkillPackageError(
        "installed-skill-not-found",
        `Installed Skill 不存在或已被替换：${key}@${digest}`
      );
    }
    this.preferences.setEnabled(target.key, enabled);
    return target;
  }

  /** Re-inspect the managed package copy and bind it to its registry identity. */
  inspectInstalledCopy(record: InstalledSkillRecord): SkillPackageInspection {
    this.assertManagedPackagePath(record.packagePath);
    if (!fs.existsSync(record.packagePath)) {
      throw new SkillPackageError("installed-path-invalid", "Installed Skill 包体不存在。", record.packagePath);
    }
    let inspection: SkillPackageInspection;
    try {
      inspection = this.inspect(record.packagePath);
    } catch (error) {
      throw new SkillPackageError("installed-path-invalid", `Installed Skill 包体无法重新检查：${error instanceof Error ? error.message : String(error)}`, record.packagePath);
    }
    const manifest = inspection.manifest;
    if (!inspection.valid || !manifest || inspection.digest !== record.digest) {
      throw new SkillPackageError("installed-path-invalid", "Installed Skill 包体或 digest 校验失败。", record.packagePath);
    }
    if (`${manifest.publisher.id}/${manifest.id}` !== record.key
      || manifest.id !== record.id
      || manifest.publisher.id !== record.publisherId
      || manifest.version !== record.version) {
      throw new SkillPackageError("installed-path-invalid", "Installed Skill Manifest 与 registry 身份不一致。", record.packagePath);
    }
    return inspection;
  }

  isInstalledCopyUsable(record: InstalledSkillRecord): boolean {
    try {
      this.inspectInstalledCopy(record);
      return true;
    } catch {
      return false;
    }
  }

  /** Remove the skill's single installed copy; never deletes openmind/output data. */
  uninstall(key: string, digest?: string): boolean {
    const target = this.repository.get(key, digest);
    if (!target) return false;
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
    if (!this.paths.skills) {
      throw new SkillPackageError("skill-store-unavailable", "Skill store 不可用：尚未绑定 openmind 根目录（内部不变量）。");
    }
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
  hash.update("openmind-skill-package-v1\n");
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
  for (const pattern of manifest.capabilities.openmind.write) {
    const topLevel = pattern.split("/")[0];
    const entry = OPENMIND_LAYOUT_V2.find((item) => item.logicalPath === topLevel);
    if (!entry || !isWritableLayoutCategory(entry.category)) {
      issues.push({ code: "openmind-write-forbidden", message: `openmind.write 不允许写入 '${topLevel}'。`, path: "capabilities.openmind.write" });
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
    migrationReason: explicitRunner
      ? "旧 frontmatter 声明了 runner/args，但尚未形成 Manifest、能力、Runtime 和 Artifact 合同。"
      : "旧 Skill 没有可验证的进程入口，应按 Agent/Prompt Skill 迁移。"
  };
}

function isWritableLayoutCategory(category: OpenmindEntryCategory): boolean {
  return category === "initialize-required" || category === "create-if-needed";
}

function hasSkillDescriptor(sourcePath: string): boolean {
  return [...MANIFEST_FILES, LEGACY_FILE].some((name) => {
    const candidate = path.join(sourcePath, name);
    return isRegularFile(candidate);
  });
}

/**
 * `cctools.skill.yaml` is the public source contract. Internally the app keeps
 * using its frozen v1 schema, so translate the two renamed vocabulary fields
 * at the read boundary and leave legacy `openmind.skill.yaml` untouched.
 */
function normalizeManifestDocument(value: unknown, manifestFile: string): unknown {
  if (manifestFile !== PRIMARY_MANIFEST_FILE || !isRecord(value)) return value;
  const capabilities = value.capabilities;
  if (value.apiVersion !== "cctools.dev/skill/v1"
    || !isRecord(capabilities)
    || !Object.prototype.hasOwnProperty.call(capabilities, "mymind")
    || Object.prototype.hasOwnProperty.call(capabilities, "openmind")) {
    return { ...value, apiVersion: "invalid-cctools-manifest-dialect" };
  }
  const normalized: Record<string, unknown> = {
    ...value,
    apiVersion: "openmind.dev/skill/v1"
  };
  const { mymind, ...otherCapabilities } = capabilities;
  normalized.capabilities = { ...otherCapabilities, openmind: mymind };
  if (isRecord(value.config)) {
    normalized.config = Object.fromEntries(Object.entries(value.config).map(([name, field]) => [
      name,
      isRecord(field) && field.type === "path-mymind"
        ? { ...field, type: "path-openmind" }
        : field
    ]));
  }
  return normalized;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isRegularFile(candidate: string): boolean {
  try { return fs.statSync(candidate).isFile(); } catch { return false; }
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
