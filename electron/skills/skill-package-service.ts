import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { SkillManifest } from "../../shared/skill-manifest-schema";
import { validateManifest } from "../../shared/skill-manifest-schema";
import {
  OPENMIND_LAYOUT_V4,
  type OpenmindEntryCategory
} from "../../shared/openmind-layout-v4";
import { parseSkillFrontmatter, type ParsedSkillFrontmatter } from "../../shared/skill-frontmatter";
import type { InstalledRunnableSkillView, InstalledSkillView, SkillPackageInspectionView } from "../../shared/contracts";
import { getAppPaths, type AppPaths } from "../paths/app-paths-service";
import { moveDirectoryWithFallback, writeTextAtomic } from "../lib/fs-utils";
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
const SKILL_FILE = "SKILL.md";

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
  "user-sources.yaml",
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

type YamlCodec = {
  load(input: string, options?: Record<string, unknown>): unknown;
  dump(value: unknown, options?: Record<string, unknown>): string;
};
// js-yaml is intentionally loaded only by the Electron-side package service;
// the renderer stays free of a YAML parser.
const yaml = require("js-yaml") as YamlCodec;

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
  sourceKind: "directory" | "zip" | "git";

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

type InstalledInspectionCacheEntry = {
  signature: PackageContentSignature;
  inspection: SkillPackageInspection;
};

/**
 * 逐文件 lstat 指纹（相对路径、类型、大小、mtime），用于判断已装包自上次
 * 全量检查后是否被改动。只 stat 不读取内容：命中时省掉全部字节读取与
 * sha256，任何真实的增删改都会反映在路径集合、size 或 mtime 上。
 */
type PackageContentSignature = string;

function packageContentSignature(root: string): PackageContentSignature | null {
  const parts: string[] = [];
  const visit = (absoluteDir: string, logicalDir: string): boolean => {
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(absoluteDir, { withFileTypes: true }); } catch { return false; }
    for (const entry of entries) {
      const logicalPath = logicalDir ? `${logicalDir}/${entry.name}` : entry.name;
      const absolutePath = path.join(absoluteDir, entry.name);
      let linkStat: fs.Stats;
      try { linkStat = fs.lstatSync(absolutePath); } catch { return false; }
      if (linkStat.isDirectory()) {
        parts.push(`d\0${logicalPath}\0${linkStat.mtimeMs}\n`);
        if (!visit(absolutePath, logicalPath)) return false;
        continue;
      }
      parts.push(`${linkStat.isSymbolicLink() ? "l" : "f"}\0${logicalPath}\0${linkStat.size}\0${linkStat.mtimeMs}\n`);
    }
    return true;
  };
  return visit(root, "") ? parts.join("") : null;
}

function samePackageSignature(left: PackageContentSignature, right: PackageContentSignature): boolean {
  return left === right;
}

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
  /**
   * 最近一次全量检查通过后的包内容签名 → 检查结果。列表类 IPC
   * （listInstalledViews/listInstalledRunnableViews）每次都会对全部已装包
   * 重跑 walkPackage + digestPackage（读入并 sha256 全部字节）；内容签名
   * （逐文件 lstat）未变时复用上次结果，避免重复哈希。任何文件的增删、
   * 替换或修改都会改变签名并触发下一次全量重查。
   */
  private readonly installedInspectionCache = new Map<string, InstalledInspectionCacheEntry>();

  get appPaths(): AppPaths { return this.paths; }

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
    const skillPath = path.join(canonicalSource, SKILL_FILE);
    const hasStandardSkill = isRegularFile(skillPath);
    const manifestWarnings = presentManifestFiles.length > 1
      ? [`同时检测到 ${PRIMARY_MANIFEST_FILE} 与 ${COMPAT_MANIFEST_FILE}；已确定性使用 ${PRIMARY_MANIFEST_FILE}。`]
      : [];
    let manifest: SkillManifest | undefined;
    let legacy: LegacySkillSuggestion | undefined;
    const sourceKind: SkillPackageInspection["sourceKind"] = "directory";

    if (manifestPath && manifestFile) {
      try {
        const parsed = yaml.load(fs.readFileSync(manifestPath, "utf8"), { json: true });
        const result = validateManifest(normalizeManifestDocument(parsed, manifestFile));
        if (!result.ok) {
          if (hasStandardSkill) {
            const standard = inspectStandardAgentSkill(canonicalSource);
            if (standard.issue) issues.push(standard.issue);
            else manifest = standard.manifest;
          } else {
            issues.push({
              code: "manifest-invalid",
              message: result.error.issues.map((issue) => `${issue.path.join(".") || "<root>"}: ${issue.message}`).join("; "),
              path: manifestFile
            });
          }
        } else {
          if (result.manifest.kind === "agent") {
            const standard = inspectStandardAgentSkill(canonicalSource, result.manifest);
            if (standard.issue) issues.push(standard.issue);
            else manifest = standard.manifest;
          } else {
            manifest = result.manifest;
            issues.push(...validateManifestPackagePaths(manifest));
          }
        }
      } catch (error) {
        if (hasStandardSkill) {
          const standard = inspectStandardAgentSkill(canonicalSource);
          if (standard.issue) issues.push(standard.issue);
          else manifest = standard.manifest;
        } else {
          issues.push({
            code: "manifest-yaml-invalid",
            message: error instanceof Error ? error.message : String(error),
            path: manifestFile
          });
        }
      }
    } else if (hasStandardSkill) {
      const standard = inspectStandardAgentSkill(canonicalSource);
      if (standard.issue) issues.push(standard.issue);
      else manifest = standard.manifest;
    } else {
      issues.push({
        code: "manifest-missing",
        message: `缺少 ${SKILL_FILE}；Process/Workflow 包可改用 ${PRIMARY_MANIFEST_FILE}。`
      });
    }

    const digest = digestPackage(canonicalSource, walk.files);

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
    // Agent Skills clients discover <skills>/<name>/SKILL.md, so installed
    // packages are flat. The registry already enforces globally unique ids.
    // Different content swaps the directory in a single rename; the digest
    // lives in the registry only, so the layout never accumulates versions.
    const destination = path.join(this.paths.skills, manifest.id);
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
        preserveMutableSkillData(this.paths.skills, manifest.id, destination);
        replacedTrash = path.join(this.paths.staging, `skill-replaced-${inspection.digest.slice(0, 16)}-${Date.now()}`);
        // The store lives under the bound content root (often another volume
        // than userData), so renames must fall back to copy+delete.
        moveDirectoryWithFallback(destination, replacedTrash);
      }
      if (compatibilityIdentity && compatibilityIdentity.packagePath !== destination) {
        this.assertManagedPackagePath(compatibilityIdentity.packagePath);
        if (fs.existsSync(compatibilityIdentity.packagePath)) {
          preserveMutableSkillData(this.paths.skills, manifest.id, compatibilityIdentity.packagePath);
          compatibilityTrash = path.join(
            this.paths.staging,
            `skill-identity-${inspection.digest.slice(0, 16)}-${Date.now()}`
          );
          moveDirectoryWithFallback(compatibilityIdentity.packagePath, compatibilityTrash);
        }
      }
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      moveDirectoryWithFallback(stagingRoot, destination);
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
        moveDirectoryWithFallback(replacedTrash, destination);
      }
      if (compatibilityTrash && compatibilityIdentity
        && !fs.existsSync(compatibilityIdentity.packagePath)
        && fs.existsSync(compatibilityTrash)) {
        fs.mkdirSync(path.dirname(compatibilityIdentity.packagePath), { recursive: true });
        moveDirectoryWithFallback(compatibilityTrash, compatibilityIdentity.packagePath);
      }
      throw error;
    } finally {
      if (archiveRoot && fs.existsSync(archiveRoot)) fs.rmSync(archiveRoot, { recursive: true, force: true });
    }
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
    return this.listInstalled().map((record) => ({
      ...record,
      enabled: this.isEnabled(record),
      // This catalog field is informational only. Execution admission always
      // goes through inspectInstalledCopy(), which deliberately bypasses this
      // metadata cache and re-hashes the package bytes.
      usable: this.isInstalledCopyUsableForDisplay(record)
    }));
  }

  /**
   * Non-conversation catalog for Automation/Broker surfaces. A fresh package
   * inspection supplies the formal Manifest display metadata and excludes
   * Agent packages, which belong only to frozen AI session snapshots.
   */
  listInstalledRunnableViews(): InstalledRunnableSkillView[] {
    return this.listInstalled().flatMap((record) => {
      try {
        const inspection = this.inspectInstalledCopyForDisplay(record);
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

  /**
   * Re-inspect the managed package copy and bind it to its registry identity.
   * This method is an execution/admission boundary, so it always hashes the
   * current bytes. File metadata cannot safely prove content identity because
   * size and timestamps can be preserved while replacing a file.
   */
  inspectInstalledCopy(record: InstalledSkillRecord): SkillPackageInspection {
    this.assertInstalledPackageExists(record);
    return this.validateInstalledInspection(record, this.reinspectInstalledCopy(record.packagePath));
  }

  /** Metadata-cached inspection for non-authoritative catalog rendering only. */
  private inspectInstalledCopyForDisplay(record: InstalledSkillRecord): SkillPackageInspection {
    this.assertInstalledPackageExists(record);
    const cached = this.installedInspectionCache.get(record.packagePath);
    if (cached) {
      const signature = packageContentSignature(record.packagePath);
      if (signature && samePackageSignature(signature, cached.signature)) {
        return this.validateInstalledInspection(record, cached.inspection);
      }
    }
    const inspection = this.reinspectInstalledCopy(record.packagePath);
    const signature = packageContentSignature(record.packagePath);
    if (signature) this.installedInspectionCache.set(record.packagePath, { signature, inspection });
    return this.validateInstalledInspection(record, inspection);
  }

  private assertInstalledPackageExists(record: InstalledSkillRecord): void {
    this.assertManagedPackagePath(record.packagePath);
    if (!fs.existsSync(record.packagePath)) {
      throw new SkillPackageError("installed-path-invalid", "Installed Skill 包体不存在。", record.packagePath);
    }
  }

  private reinspectInstalledCopy(packagePath: string): SkillPackageInspection {
    try {
      return this.inspect(packagePath);
    } catch (error) {
      throw new SkillPackageError("installed-path-invalid", `Installed Skill 包体无法重新检查：${error instanceof Error ? error.message : String(error)}`, packagePath);
    }
  }

  /** Bind an inspection result to a registry record; shared by fresh and cached paths. */
  private validateInstalledInspection(record: InstalledSkillRecord, inspection: SkillPackageInspection): SkillPackageInspection {
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

  private isInstalledCopyUsableForDisplay(record: InstalledSkillRecord): boolean {
    try {
      this.inspectInstalledCopyForDisplay(record);
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
    this.installedInspectionCache.delete(target.packagePath);
    fs.mkdirSync(this.paths.staging, { recursive: true });
    const trashPath = path.join(this.paths.staging, `skill-uninstall-${target.digest}-${Date.now()}`);
    const nativeAlias = path.join(this.paths.skills!, target.id);
    const removeNativeAlias = nativeAlias !== target.packagePath
      && isDirectoryLinkTo(nativeAlias, target.packagePath);
    const moved = fs.existsSync(target.packagePath);
    if (moved) moveDirectoryWithFallback(target.packagePath, trashPath);
    try {
      const removed = this.repository.remove(key, target.digest);
      if (!removed) throw new Error(`卸载时 registry 记录已消失：${key}@${target.digest}`);
      fs.rmSync(trashPath, { recursive: true, force: true });
      if (removeNativeAlias) {
        try { fs.unlinkSync(nativeAlias); }
        catch { /* A stale compatibility alias is inert and repaired at startup. */ }
      }
      return true;
    } catch (error) {
      if (moved && !fs.existsSync(target.packagePath) && fs.existsSync(trashPath)) {
        moveDirectoryWithFallback(trashPath, target.packagePath);
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

/**
 * One-time compatibility migration for data that older package revisions kept
 * inside their managed install directory. Persist before the directory swap so
 * a source-wide update cannot erase user-owned subscriptions.
 */
function preserveMutableSkillData(skillsRoot: string | null, skillId: string, installedRoot: string): void {
  if (!skillsRoot) return;
  const skillDataRoot = path.join(path.dirname(skillsRoot), "skill-data", skillId);
  if (skillId === "rss-article-saver") {
    preserveRssSubscriptionFiles(installedRoot, skillDataRoot);
    return;
  }
  if (skillId === "reddit-fetcher") preserveRedditSources(installedRoot, skillDataRoot);
}

function preserveRssSubscriptionFiles(installedRoot: string, skillDataRoot: string): void {
  let entries: fs.Dirent[];
  try { entries = fs.readdirSync(installedRoot, { withFileTypes: true }); }
  catch { return; }
  for (const entry of entries) {
    if (!entry.isFile() || !/^subscriptions(?:\.[A-Za-z0-9_-]+)?\.opml$/.test(entry.name)) continue;
    copyRegularFileIfMissing(path.join(installedRoot, entry.name), path.join(skillDataRoot, entry.name));
  }
}

function preserveRedditSources(installedRoot: string, skillDataRoot: string): void {
  const target = path.join(skillDataRoot, "user-sources.yaml");
  if (fs.existsSync(target)) return;
  const configPath = path.join(installedRoot, "config.yaml");
  if (!isPlainRegularFile(configPath)) return;
  let document: unknown;
  try { document = yaml.load(fs.readFileSync(configPath, "utf8"), { json: true }); }
  catch (error) {
    throw new SkillPackageError(
      "installed-path-invalid",
      `无法迁移现有 Reddit 来源配置，已拒绝覆盖旧 Skill：${error instanceof Error ? error.message : String(error)}`,
      configPath
    );
  }
  const fetch = isRecord(document) && isRecord(document.fetch) ? document.fetch : undefined;
  const sources = fetch?.sources;
  if (!Array.isArray(sources) || !sources.every((value) => typeof value === "string" && value.trim())) {
    throw new SkillPackageError("installed-path-invalid", "无法迁移现有 Reddit 来源配置：fetch.sources 格式无效。", configPath);
  }
  writeTextAtomic(target, yaml.dump(
    { schemaVersion: 1, sources: sources.map((value) => value.trim()) },
    { noRefs: true, lineWidth: -1, sortKeys: false }
  ));
}

function copyRegularFileIfMissing(source: string, target: string): void {
  if (fs.existsSync(target) || !isPlainRegularFile(source)) return;
  writeTextAtomic(target, fs.readFileSync(source, "utf8"));
}

function isPlainRegularFile(candidate: string): boolean {
  try {
    const stat = fs.lstatSync(candidate);
    return stat.isFile() && !stat.isSymbolicLink();
  } catch {
    return false;
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
    const entry = OPENMIND_LAYOUT_V4.find((item) => item.logicalPath === topLevel);
    if (!entry || !isWritableLayoutCategory(entry.category)) {
      issues.push({ code: "openmind-write-forbidden", message: `openmind.write 不允许写入 '${topLevel}'。`, path: "capabilities.openmind.write" });
    }
  }
  return issues;
}

function inspectStandardAgentSkill(
  sourceRoot: string,
  declaredManifest?: Extract<SkillManifest, { kind: "agent" }>
): { manifest?: SkillManifest; issue?: SkillPackageIssue } {
  const skillPath = path.join(sourceRoot, SKILL_FILE);
  if (!isRegularFile(skillPath)) {
    return { issue: { code: "manifest-missing", message: `Agent Skill 缺少 ${SKILL_FILE}。`, path: SKILL_FILE } };
  }
  const frontmatter = parseSkillFrontmatter(fs.readFileSync(skillPath, "utf8"));
  const name = String(frontmatter.name || "").trim();
  const description = String(frontmatter.description || "").trim();
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name) || name.length > 64) {
    return { issue: { code: "manifest-invalid", message: "SKILL.md name 必须为 1–64 位小写字母、数字和单连字符。", path: SKILL_FILE } };
  }
  if (!description || description.length > 1024) {
    return { issue: { code: "manifest-invalid", message: "SKILL.md description 必须为 1–1024 个字符。", path: SKILL_FILE } };
  }

  if (declaredManifest) {
    return {
      manifest: {
        ...declaredManifest,
        id: name,
        display: {
          ...declaredManifest.display,
          // `title` is not required by the Agent Skills specification. Keep
          // optional app display metadata when present; otherwise use name.
          name: frontmatter.title || declaredManifest.display.name || name,
          description,
          group: frontmatter.group || declaredManifest.display.group
        }
      }
    };
  }

  const projected = validateManifest({
    apiVersion: "openmind.dev/skill/v1",
    id: name,
    version: "0.0.0",
    publisher: { id: "agent-skills", displayName: "Agent Skills" },
    display: { name: frontmatter.title || name, description, group: frontmatter.group || "agent-skills" },
    capabilities: {},
    artifacts: [],
    execution: {},
    platforms: ["windows-x64", "windows-arm64", "macos-arm64", "macos-x64", "linux-x64", "linux-arm64", "wsl-linux-x64"],
    compatibility: { minAppVersion: "0.0.0" },
    kind: "agent"
  });
  if (!projected.ok) throw new Error("Agent Skills internal projection is invalid");
  return { manifest: projected.manifest };
}

function isWritableLayoutCategory(category: OpenmindEntryCategory): boolean {
  return category === "initialize-required" || category === "create-if-needed";
}

/**
 * `cctools.skill.yaml` is the public source contract and shares the internal
 * vocabulary; only its apiVersion differs, so translate that at the read
 * boundary and leave legacy `openmind.skill.yaml` untouched. The old-brand
 * `mymind` vocabulary is rejected outright.
 */
function normalizeManifestDocument(value: unknown, manifestFile: string): unknown {
  if (manifestFile !== PRIMARY_MANIFEST_FILE || !isRecord(value)) return value;
  const capabilities = value.capabilities;
  if (value.apiVersion !== "cctools.dev/skill/v1"
    || !isRecord(capabilities)
    || Object.prototype.hasOwnProperty.call(capabilities, "mymind")) {
    return { ...value, apiVersion: "invalid-cctools-manifest-dialect" };
  }
  return { ...value, apiVersion: "openmind.dev/skill/v1" };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isRegularFile(candidate: string): boolean {
  try { return fs.statSync(candidate).isFile(); } catch { return false; }
}

function isDirectoryLinkTo(candidate: string, target: string): boolean {
  try {
    return fs.lstatSync(candidate).isSymbolicLink()
      && fs.realpathSync(candidate) === fs.realpathSync(target);
  } catch {
    return false;
  }
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

function sha256(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function sha256File(filePath: string): string {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}
