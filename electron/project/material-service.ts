import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import {
  ProjectMaterialSchema,
  ProjectVideoReadMetadataSchema,
  type ProjectMaterial,
  type ProjectMaterialKind,
  type ProjectMaterialRead
} from "../../shared/project-contracts";
import { writeJsonAtomic, writeTextAtomic } from "../lib/fs-utils";
import { ProjectPathResolver } from "./project-path-resolver";
import { parseVideoMarkdown } from "./converters/video-converter";

const MATERIAL_INDEX_FILE = "materials/.openmind-materials.json";
const MAX_SOURCE_BYTES = 100 * 1024 * 1024;
const MAX_READ_BYTES = 10 * 1024 * 1024;
const MATERIALS_TOP_LEVEL = ["materials"] as const;
const ACTIVE_CONVERSIONS_DIR = "materials/.openmind-active-conversions";
const ACTIVE_CONVERSION_MAX_AGE_MS = 6 * 60 * 60 * 1_000;
const MaterialIndexSchema = z.array(ProjectMaterialSchema);

type ActiveConversionLease = { key: string; markerPath: string; token: string };
type ProjectDirectoryIdentity = { device: number; inode: number; birthtimeMs: number };

export type ProjectMaterialConversionSource =
  | {
      type: "file";
      absolutePath: string;
      originalName: string;
      extension: string;
      byteSize: number;
      sha256: string;
    }
  | { type: "url"; url: string };

export type ProjectMaterialConversionTarget = {
  kind: ProjectMaterialKind;
  directory: "documents" | "web" | "videos";
  fileName: string;
  title: string;
  /** Non-text converters should preserve the input so a failed import can retry after restart. */
  preserveOriginal?: boolean;
};

export type ProjectMaterialConversionRequest = {
  projectName: string;
  source: ProjectMaterialConversionSource;
  target: ProjectMaterialConversionTarget;
  /** For preserved files this points inside materials/originals, never to the external picker path. */
  originalAbsolutePath: string | null;
  retry: boolean;
};

export type ProjectMaterialConversionResult = {
  content: string;
  mimeType?: string | null;
  title?: string;
};

/**
 * Extension point for PDF/Office/Web/Video importers. Converters describe a
 * deterministic Project-relative target before conversion so failures remain
 * visible and retryable in the on-disk material index.
 */
export interface ProjectMaterialConverter {
  readonly id: string;
  readonly supportedExtensions?: readonly string[];
  supports(source: ProjectMaterialConversionSource): boolean;
  target(source: ProjectMaterialConversionSource): ProjectMaterialConversionTarget;
  convert(request: ProjectMaterialConversionRequest): Promise<ProjectMaterialConversionResult>;
}

export class TextProjectMaterialConverter implements ProjectMaterialConverter {
  readonly id = "builtin-text-v1";
  readonly supportedExtensions = [".md", ".markdown", ".txt"] as const;

  supports(source: ProjectMaterialConversionSource): boolean {
    return source.type === "file" && this.supportedExtensions.includes(source.extension as never);
  }

  target(source: ProjectMaterialConversionSource): ProjectMaterialConversionTarget {
    if (source.type !== "file" || !this.supports(source)) throw new Error("内建文本转换器不支持该资料类型。");
    const extension = source.extension === ".markdown" ? ".md" : source.extension;
    return {
      kind: "document",
      directory: "documents",
      fileName: `${path.basename(source.originalName, path.extname(source.originalName))}${extension}`,
      title: path.basename(source.originalName, path.extname(source.originalName)),
      preserveOriginal: false
    };
  }

  async convert(request: ProjectMaterialConversionRequest): Promise<ProjectMaterialConversionResult> {
    if (request.source.type !== "file") throw new Error("文本资料缺少源文件。");
    const raw = fs.readFileSync(request.source.absolutePath);
    let content: string;
    try {
      content = new TextDecoder("utf-8", { fatal: true }).decode(raw);
    } catch {
      throw Object.assign(new Error("文本资料必须使用 UTF-8 编码。"), { code: "unsupported-text-encoding" });
    }
    return {
      content: content.replaceAll("\r\n", "\n"),
      mimeType: request.source.extension === ".txt" ? "text/plain" : "text/markdown"
    };
  }
}

export class ProjectMaterialService {
  private readonly converters: ProjectMaterialConverter[];
  private readonly activeConversions = new Set<string>();
  private readonly completedConversionTokens = new Set<string>();

  constructor(
    private readonly paths: ProjectPathResolver,
    converters: readonly ProjectMaterialConverter[] = []
  ) {
    const builtIn = new TextProjectMaterialConverter();
    this.converters = [builtIn, ...converters.filter((converter) => converter.id !== builtIn.id)];
  }

  initializeProject(projectName: string): void {
    this.paths.withProjectMutationLock(() => {
      for (const directory of ["materials/documents", "materials/web", "materials/videos", "materials/originals"]) {
        const absolute = this.paths.resolveInsideProject(projectName, directory, {
          allowedTopLevels: MATERIALS_TOP_LEVEL,
          allowMissingLeaf: true
        });
        fs.mkdirSync(absolute, { recursive: true });
      }
      const indexPath = this.indexPath(projectName, true);
      if (!fs.existsSync(indexPath)) writeJsonAtomic(indexPath, []);
    });
  }

  list(projectName: string): ProjectMaterial[] {
    return this.readIndex(projectName).sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }

  hasActiveConversions(projectName: string): boolean {
    return this.paths.withProjectMutationLock(() => {
      const canonicalProjectName = this.paths.resolveProject(projectName).name;
      const projectPrefix = `${canonicalProjectName.normalize("NFKC").toLocaleLowerCase("en-US")}\0`;
      if ([...this.activeConversions].some((key) => key.startsWith(projectPrefix))) return true;
      const markers = this.scanActiveConversionMarkers(canonicalProjectName);
      return markers.hasUnknown || markers.relativePaths.size > 0;
    });
  }

  async addFiles(projectName: string, absolutePaths: readonly string[]): Promise<ProjectMaterial[]> {
    if (absolutePaths.length === 0) return [];
    if (absolutePaths.length > 100) throw new Error("单次最多导入 100 份项目资料。");
    const results: ProjectMaterial[] = [];
    for (const absolutePath of absolutePaths) results.push(await this.addFile(projectName, absolutePath));
    return results;
  }

  async addUrl(projectName: string, url: string): Promise<ProjectMaterial> {
    const source: ProjectMaterialConversionSource = { type: "url", url };
    const existing = this.readIndex(projectName).find((item) => item.source.type === "url" && item.source.url === url);
    if (existing) return existing;
    return this.convertNew(projectName, source);
  }

  async retry(projectName: string, relativePath: string): Promise<ProjectMaterial> {
    const projectIdentity = this.captureProjectDirectoryIdentity(projectName);
    const records = this.readIndex(projectName);
    const index = records.findIndex((item) => item.relativePath === relativePath);
    if (index < 0) throw new Error("项目资料不存在。");
    const current = records[index];
    if (current.status !== "failed") return current;
    const converter = this.converters.find((candidate) => candidate.id === current.converterId);
    if (!converter) throw new Error(`资料转换器不可用：${current.converterId || "unknown"}`);

    let source: ProjectMaterialConversionSource;
    let originalAbsolutePath: string | null = null;
    if (current.source.type === "url") {
      source = current.source;
    } else {
      if (!current.originalRelativePath) throw new Error("失败资料没有可重试的原始文件。");
      originalAbsolutePath = this.paths.resolveInsideProject(projectName, current.originalRelativePath, {
        allowedTopLevels: MATERIALS_TOP_LEVEL
      });
      const stat = fs.lstatSync(originalAbsolutePath);
      if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("重试源文件无效。");
      source = {
        type: "file",
        absolutePath: originalAbsolutePath,
        originalName: current.source.originalName,
        extension: path.extname(current.source.originalName).toLocaleLowerCase(),
        byteSize: current.byteSize ?? stat.size,
        sha256: current.sha256 ?? sha256File(originalAbsolutePath)
      };
    }

    const target = converter.target(source);
    const expectedIndex = indexFingerprint(records);
    const converting = ProjectMaterialSchema.parse({
        ...current,
        status: "converting",
        errorCode: null,
        errorMessage: null,
        updatedAt: now()
    });
    const lease = this.beginActiveConversion(
      projectName,
      current.relativePath,
      projectIdentity,
      expectedIndex,
      () => this.replaceRecord(projectName, current.relativePath, converting)
    );
    try {
      const result = await converter.convert({ projectName, source, target, originalAbsolutePath, retry: true });
      const targetPath = this.paths.resolveInsideProject(projectName, current.relativePath, {
        allowedTopLevels: MATERIALS_TOP_LEVEL,
        allowMissingLeaf: true
      });
      writeTextAtomic(targetPath, result.content);
      const ready = ProjectMaterialSchema.parse({
        ...current,
        title: result.title || current.title,
        status: "ready",
        mimeType: result.mimeType ?? current.mimeType,
        errorCode: null,
        errorMessage: null,
        updatedAt: now()
      });
      this.replaceRecord(projectName, relativePath, ready);
      return ready;
    } catch (error) {
      return this.markFailed(projectName, relativePath, error);
    } finally {
      this.endActiveConversion(lease);
    }
  }

  remove(projectName: string, relativePath: string): boolean {
    return this.paths.withProjectMutationLock(() => {
      const canonicalProjectName = this.paths.resolveProject(projectName).name;
      const records = this.readIndex(canonicalProjectName);
      const index = records.findIndex((item) => item.relativePath === relativePath);
      if (index < 0) return false;
      this.assertNotConverting(canonicalProjectName, relativePath, "删除");
      const [removed] = records.splice(index, 1);
      this.writeIndex(canonicalProjectName, records);
      for (const candidate of [removed.relativePath, removed.originalRelativePath]) {
        if (!candidate) continue;
        const absolute = this.paths.resolveInsideProject(canonicalProjectName, candidate, {
          allowedTopLevels: MATERIALS_TOP_LEVEL,
          allowMissingLeaf: true
        });
        fs.rmSync(absolute, { force: true });
      }
      return true;
    });
  }

  rename(projectName: string, relativePath: string, newTitle: string): ProjectMaterial {
    return this.paths.withProjectMutationLock(() => {
      const canonicalProjectName = this.paths.resolveProject(projectName).name;
      const records = this.readIndex(canonicalProjectName);
      const index = records.findIndex((item) => item.relativePath === relativePath);
      if (index < 0) throw new Error("项目资料不存在。");
      const current = records[index];
      if (current.status !== "ready") throw new Error("项目资料尚未完成转换，暂时不能重命名。");
      this.assertNotConverting(canonicalProjectName, relativePath, "重命名");
      const title = newTitle.trim().slice(0, 255);
      const directory = path.posix.dirname(current.relativePath);
      const extension = path.posix.extname(current.relativePath);
      const reserved = records
        .filter((item) => item.relativePath !== current.relativePath && path.posix.dirname(item.relativePath) === directory)
        .map((item) => path.posix.basename(item.relativePath));
      const fileName = allocateFileName(
        `${title}${extension}`,
        reserved,
        (candidate) => fs.existsSync(this.paths.resolveInsideProject(
          canonicalProjectName,
          `${directory}/${candidate}`,
          { allowedTopLevels: MATERIALS_TOP_LEVEL, allowMissingLeaf: true }
        ))
      );
      const nextRelativePath = `${directory}/${fileName}`;
      if (nextRelativePath !== current.relativePath) {
        const previousAbsolute = this.paths.resolveInsideProject(canonicalProjectName, current.relativePath, {
          allowedTopLevels: MATERIALS_TOP_LEVEL
        });
        const nextAbsolute = this.paths.resolveInsideProject(canonicalProjectName, nextRelativePath, {
          allowedTopLevels: MATERIALS_TOP_LEVEL,
          allowMissingLeaf: true
        });
        fs.renameSync(previousAbsolute, nextAbsolute);
      }
      const updated = ProjectMaterialSchema.parse({
        ...current,
        title,
        relativePath: nextRelativePath,
        updatedAt: now()
      });
      records[index] = updated;
      this.writeIndex(canonicalProjectName, records);
      return updated;
    });
  }

  moveToProject(projectName: string, relativePath: string, targetProjectName: string): ProjectMaterial {
    return this.paths.withProjectMutationLock(() => {
      const sourceProjectName = this.paths.resolveProject(projectName).name;
      const targetName = this.paths.resolveProject(targetProjectName).name;
      if (sourceProjectName === targetName) {
        const current = this.readIndex(sourceProjectName).find((item) => item.relativePath === relativePath);
        if (!current) throw new Error("项目资料不存在。");
        return current;
      }
      const sourceRecords = this.readIndex(sourceProjectName);
      const index = sourceRecords.findIndex((item) => item.relativePath === relativePath);
      if (index < 0) throw new Error("项目资料不存在。");
      const current = sourceRecords[index];
      if (current.status !== "ready") throw new Error("项目资料尚未完成转换，暂时不能移动。");
      this.assertNotConverting(sourceProjectName, relativePath, "移动");
      const targetRecords = this.readIndex(targetName);
      const directory = path.posix.dirname(current.relativePath);
      const nextRelativePath = `${directory}/${allocateFileName(
        path.posix.basename(current.relativePath),
        targetRecords.map((item) => path.posix.basename(item.relativePath)),
        (candidate) => fs.existsSync(this.paths.resolveInsideProject(
          targetName,
          `${directory}/${candidate}`,
          { allowedTopLevels: MATERIALS_TOP_LEVEL, allowMissingLeaf: true }
        ))
      )}`;
      let nextOriginalRelativePath: string | null = null;
      if (current.originalRelativePath) {
        nextOriginalRelativePath = `materials/originals/${allocateFileName(
          path.posix.basename(current.originalRelativePath),
          targetRecords.map((item) => item.originalRelativePath ? path.posix.basename(item.originalRelativePath) : "").filter(Boolean),
          (candidate) => fs.existsSync(this.paths.resolveInsideProject(
            targetName,
            `materials/originals/${candidate}`,
            { allowedTopLevels: MATERIALS_TOP_LEVEL, allowMissingLeaf: true }
          ))
        )}`;
      }
      const copyIntoTarget = (fromRelative: string, toRelative: string) => {
        const fromAbsolute = this.paths.resolveInsideProject(sourceProjectName, fromRelative, {
          allowedTopLevels: MATERIALS_TOP_LEVEL
        });
        const toAbsolute = this.paths.resolveInsideProject(targetName, toRelative, {
          allowedTopLevels: MATERIALS_TOP_LEVEL,
          allowMissingLeaf: true
        });
        fs.mkdirSync(path.dirname(toAbsolute), { recursive: true });
        fs.copyFileSync(fromAbsolute, toAbsolute, fs.constants.COPYFILE_EXCL);
      };
      const copied: string[] = [];
      let moved: ProjectMaterial;
      // Copy files first, then append the target record, then drop the source
      // record: any failure leaves the worst case of a duplicated copy instead
      // of a lost material.
      try {
        copyIntoTarget(current.relativePath, nextRelativePath);
        copied.push(nextRelativePath);
        if (current.originalRelativePath && nextOriginalRelativePath) {
          copyIntoTarget(current.originalRelativePath, nextOriginalRelativePath);
          copied.push(nextOriginalRelativePath);
        }
        moved = ProjectMaterialSchema.parse({
          ...current,
          projectName: targetName,
          relativePath: nextRelativePath,
          originalRelativePath: nextOriginalRelativePath,
          updatedAt: now()
        });
        this.writeIndex(targetName, [...targetRecords, moved]);
        try {
          this.writeIndex(sourceProjectName, sourceRecords.filter((item) => item.relativePath !== relativePath));
        } catch (error) {
          this.writeIndex(targetName, targetRecords);
          throw error;
        }
      } catch (error) {
        for (const copiedRelative of copied) {
          fs.rmSync(this.paths.resolveInsideProject(targetName, copiedRelative, {
            allowedTopLevels: MATERIALS_TOP_LEVEL,
            allowMissingLeaf: true
          }), { force: true });
        }
        throw error;
      }
      for (const staleRelative of [current.relativePath, current.originalRelativePath]) {
        if (!staleRelative) continue;
        fs.rmSync(this.paths.resolveInsideProject(sourceProjectName, staleRelative, {
          allowedTopLevels: MATERIALS_TOP_LEVEL,
          allowMissingLeaf: true
        }), { force: true });
      }
      return moved;
    });
  }

  read(projectName: string, relativePath: string): ProjectMaterialRead {
    const material = this.readIndex(projectName).find((item) => item.relativePath === relativePath);
    if (!material) throw new Error("项目资料不存在。");
    if (material.status !== "ready") throw new Error("项目资料尚未完成转换。");
    const absolute = this.paths.resolveInsideProject(projectName, relativePath, { allowedTopLevels: MATERIALS_TOP_LEVEL });
    const stat = fs.lstatSync(absolute);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("项目资料文件无效。");
    const bytes = fs.readFileSync(absolute);
    const truncated = bytes.byteLength > MAX_READ_BYTES;
    const content = bytes.subarray(0, MAX_READ_BYTES).toString("utf8");
    const parsedVideo = material.kind === "video" ? parseVideoMarkdown(bytes.toString("utf8")) : null;
    return {
      material,
      content,
      truncated,
      ...(parsedVideo ? {
        video: ProjectVideoReadMetadataSchema.parse({
          ...parsedVideo,
          embedUrl: parsedVideo.embedUrl ?? null,
          videoId: parsedVideo.videoId ?? null,
          durationMs: parsedVideo.durationMs ?? null,
          thumbnailUrl: parsedVideo.thumbnailUrl ?? null,
          transcript: parsedVideo.transcript.map((cue) => ({ ...cue, endMs: cue.endMs })),
          transcriptSource: parsedVideo.transcriptSource
        })
      } : {})
    };
  }

  renameProject(previousName: string, nextName: string): void {
    this.paths.withProjectMutationLock(() => {
      const records = this.readIndex(nextName, { allowedProjectNames: [previousName, nextName] })
        .map((item) => ProjectMaterialSchema.parse({ ...item, projectName: nextName }));
      this.writeIndex(nextName, records);
    });
  }

  /** Restores a schema- and path-validated pre-rename index snapshot. */
  restoreProjectSnapshot(projectName: string, snapshot: readonly ProjectMaterial[]): void {
    this.paths.withProjectMutationLock(() => this.writeIndex(projectName, snapshot));
  }

  private async addFile(projectName: string, sourcePath: string): Promise<ProjectMaterial> {
    const absolutePath = path.resolve(sourcePath);
    const stat = fs.lstatSync(absolutePath);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("只能导入普通文件，不能导入目录或符号链接。");
    if (stat.size > MAX_SOURCE_BYTES) throw new Error("单份项目资料不能超过 100 MB。");
    const originalName = path.basename(absolutePath);
    const source: ProjectMaterialConversionSource = {
      type: "file",
      absolutePath,
      originalName,
      extension: path.extname(originalName).toLocaleLowerCase(),
      byteSize: stat.size,
      sha256: sha256File(absolutePath)
    };
    const duplicate = this.readIndex(projectName).find((item) => item.sha256 === source.sha256);
    if (duplicate) return duplicate;
    return this.convertNew(projectName, source);
  }

  private async convertNew(projectName: string, source: ProjectMaterialConversionSource): Promise<ProjectMaterial> {
    const projectIdentity = this.captureProjectDirectoryIdentity(projectName);
    this.initializeProject(projectName);
    const converter = this.converters.find((candidate) => candidate.supports(source));
    if (!converter) {
      const label = source.type === "file" ? source.extension || source.originalName : new URL(source.url).hostname;
      throw Object.assign(new Error(`没有可用的项目资料转换器：${label}`), { code: "material-converter-unavailable" });
    }
    const target = validateTarget(converter.target(source));
    const records = this.readIndex(projectName);
    const fileName = allocateFileName(
      target.fileName,
      records.filter((item) => item.relativePath.startsWith(`materials/${target.directory}/`)).map((item) => path.posix.basename(item.relativePath)),
      (candidate) => fs.existsSync(this.paths.resolveInsideProject(
        projectName,
        `materials/${target.directory}/${candidate}`,
        { allowedTopLevels: MATERIALS_TOP_LEVEL, allowMissingLeaf: true }
      ))
    );
    const relativePath = `materials/${target.directory}/${fileName}`;
    let originalRelativePath: string | null = null;
    let originalAbsolutePath: string | null = null;
    if (source.type === "file" && target.preserveOriginal) {
      const originalName = allocateFileName(
        safeMaterialFileName(source.originalName),
        records.map((item) => item.originalRelativePath ? path.posix.basename(item.originalRelativePath) : "").filter(Boolean),
        (candidate) => fs.existsSync(this.paths.resolveInsideProject(
          projectName,
          `materials/originals/${candidate}`,
          { allowedTopLevels: MATERIALS_TOP_LEVEL, allowMissingLeaf: true }
        ))
      );
      originalRelativePath = `materials/originals/${originalName}`;
      originalAbsolutePath = this.paths.resolveInsideProject(projectName, originalRelativePath, {
        allowedTopLevels: MATERIALS_TOP_LEVEL,
        allowMissingLeaf: true
      });
    }
    const timestamp = now();
    const pending = ProjectMaterialSchema.parse({
      projectName,
      relativePath,
      title: target.title,
      kind: target.kind,
      status: "converting",
      source: source.type === "file"
        ? { type: "file", originalName: source.originalName }
        : { type: "url", url: source.url },
      originalRelativePath,
      mimeType: null,
      byteSize: source.type === "file" ? source.byteSize : null,
      sha256: source.type === "file" ? source.sha256 : null,
      converterId: converter.id,
      errorCode: null,
      errorMessage: null,
      createdAt: timestamp,
      updatedAt: timestamp
    });
    const lease = this.beginActiveConversion(
      projectName,
      relativePath,
      projectIdentity,
      indexFingerprint(records),
      () => {
        let copiedOriginal = false;
        try {
          if (source.type === "file" && originalAbsolutePath) {
            fs.copyFileSync(source.absolutePath, originalAbsolutePath, fs.constants.COPYFILE_EXCL);
            copiedOriginal = true;
          }
          this.writeIndex(projectName, [...records, pending]);
        } catch (error) {
          if (copiedOriginal && originalAbsolutePath) fs.rmSync(originalAbsolutePath, { force: true });
          throw error;
        }
      }
    );
    try {
      const conversionSource = source.type === "file" && originalAbsolutePath
        ? { ...source, absolutePath: originalAbsolutePath }
        : source;
      const result = await converter.convert({
        projectName,
        source: conversionSource,
        target: { ...target, fileName },
        originalAbsolutePath,
        retry: false
      });
      const absoluteTarget = this.paths.resolveInsideProject(projectName, relativePath, {
        allowedTopLevels: MATERIALS_TOP_LEVEL,
        allowMissingLeaf: true
      });
      writeTextAtomic(absoluteTarget, result.content);
      const ready = ProjectMaterialSchema.parse({
        ...pending,
        title: result.title || pending.title,
        status: "ready",
        mimeType: result.mimeType ?? null,
        updatedAt: now()
      });
      this.replaceRecord(projectName, relativePath, ready);
      return ready;
    } catch (error) {
      const failed = this.markFailed(projectName, relativePath, error);
      throw Object.assign(new Error(failed.errorMessage || "项目资料转换失败。"), {
        code: failed.errorCode || "material-conversion-failed",
        material: failed
      });
    } finally {
      this.endActiveConversion(lease);
    }
  }

  private assertNotConverting(projectName: string, relativePath: string, action: string): void {
    const markers = this.scanActiveConversionMarkers(projectName);
    if (this.activeConversions.has(conversionKey(projectName, relativePath))
      || markers.hasUnknown
      || markers.relativePaths.has(portableIdentityKey(relativePath))) {
      throw new Error(`项目资料正在转换，暂时不能${action}。`);
    }
  }

  private markFailed(projectName: string, relativePath: string, error: unknown): ProjectMaterial {
    const current = this.readIndex(projectName).find((item) => item.relativePath === relativePath);
    if (!current) throw error;
    const code = error && typeof error === "object" && typeof (error as { code?: unknown }).code === "string"
      ? String((error as { code: string }).code).slice(0, 120)
      : "material-conversion-failed";
    const failed = ProjectMaterialSchema.parse({
      ...current,
      status: "failed",
      errorCode: code,
      errorMessage: (error instanceof Error ? error.message : String(error)).slice(0, 2_000),
      updatedAt: now()
    });
    this.replaceRecord(projectName, relativePath, failed);
    return failed;
  }

  private readIndex(
    projectName: string,
    options: { allowedProjectNames?: readonly string[] } = {}
  ): ProjectMaterial[] {
    return this.paths.withProjectMutationLock(() => {
      this.initializeProject(projectName);
      const canonicalProjectName = this.paths.resolveProject(projectName).name;
      const records = MaterialIndexSchema.parse(JSON.parse(fs.readFileSync(this.indexPath(canonicalProjectName), "utf8")));
      this.validateRecords(canonicalProjectName, records, options.allowedProjectNames ?? [canonicalProjectName]);
      const markers = this.scanActiveConversionMarkers(canonicalProjectName);
      let changed = false;
      const reconciled = records.map((record) => {
        if ((record.status !== "importing" && record.status !== "converting")
          || this.activeConversions.has(conversionKey(canonicalProjectName, record.relativePath))
          || markers.hasUnknown
          || markers.relativePaths.has(portableIdentityKey(record.relativePath))) return record;
        changed = true;
        return ProjectMaterialSchema.parse({
          ...record,
          status: "failed",
          errorCode: "material-conversion-interrupted",
          errorMessage: "上次资料转换在完成前中断，请重试。",
          updatedAt: now()
        });
      });
      if (changed) {
        writeJsonAtomic(this.indexPath(canonicalProjectName, true), MaterialIndexSchema.parse(reconciled));
      }
      return reconciled;
    });
  }

  private writeIndex(projectName: string, records: readonly ProjectMaterial[]): void {
    this.paths.withProjectMutationLock(() => {
      const canonicalProjectName = this.paths.resolveProject(projectName).name;
      const parsed = MaterialIndexSchema.parse(records);
      this.validateRecords(canonicalProjectName, parsed, [canonicalProjectName]);
      writeJsonAtomic(this.indexPath(canonicalProjectName, true), parsed);
    });
  }

  private replaceRecord(projectName: string, relativePath: string, record: ProjectMaterial): void {
    this.paths.withProjectMutationLock(() => {
      const canonicalProjectName = this.paths.resolveProject(projectName).name;
      const parsedRecord = ProjectMaterialSchema.parse(record);
      if (parsedRecord.projectName !== canonicalProjectName || parsedRecord.relativePath !== relativePath) {
        throw new Error(`项目资料记录身份与写入目标不一致：${relativePath}`);
      }
      const records = this.readIndex(canonicalProjectName);
      const index = records.findIndex((item) => item.relativePath === relativePath);
      if (index < 0) throw new Error(`项目资料记录不存在：${relativePath}`);
      records[index] = parsedRecord;
      this.writeIndex(canonicalProjectName, records);
    });
  }

  private indexPath(projectName: string, allowMissingLeaf = false): string {
    return this.paths.resolveInsideProject(projectName, MATERIAL_INDEX_FILE, {
      allowedTopLevels: MATERIALS_TOP_LEVEL,
      allowMissingLeaf
    });
  }

  private validateRecords(
    projectName: string,
    records: readonly ProjectMaterial[],
    allowedProjectNames: readonly string[]
  ): void {
    const allowedNames = new Set(allowedProjectNames);
    const relativePaths = new Set<string>();
    const originalPaths = new Set<string>();
    for (const record of records) {
      if (!allowedNames.has(record.projectName)) {
        throw new Error(`项目资料的 projectName 与索引所在项目不一致：${record.relativePath}`);
      }
      const expectedDirectory = record.kind === "document" ? "documents" : record.kind === "web" ? "web" : "videos";
      assertDirectProjectFile(record.relativePath, `materials/${expectedDirectory}`, "项目资料路径");
      if ((record.kind === "document" && record.source.type !== "file")
        || (record.kind !== "document" && record.source.type !== "url")) {
        throw new Error(`项目资料类型与来源不一致：${record.relativePath}`);
      }
      const pathKey = portableIdentityKey(record.relativePath);
      if (relativePaths.has(pathKey)) throw new Error(`项目资料索引包含重复路径：${record.relativePath}`);
      relativePaths.add(pathKey);
      const absolute = this.paths.resolveInsideProject(projectName, record.relativePath, {
        allowedTopLevels: MATERIALS_TOP_LEVEL,
        allowMissingLeaf: record.status !== "ready"
      });
      if (record.status === "ready") assertOrdinaryFile(absolute, `项目资料文件不存在或无效：${record.relativePath}`);

      if (!record.originalRelativePath) continue;
      if (record.source.type !== "file") throw new Error(`URL 资料不能声明原始文件：${record.relativePath}`);
      assertDirectProjectFile(record.originalRelativePath, "materials/originals", "项目资料原件路径");
      const originalKey = portableIdentityKey(record.originalRelativePath);
      if (originalPaths.has(originalKey)) throw new Error(`项目资料索引包含重复原件路径：${record.originalRelativePath}`);
      originalPaths.add(originalKey);
      const original = this.paths.resolveInsideProject(projectName, record.originalRelativePath, {
        allowedTopLevels: MATERIALS_TOP_LEVEL
      });
      assertOrdinaryFile(original, `项目资料原件不存在或无效：${record.originalRelativePath}`);
    }
  }

  private beginActiveConversion(
    projectName: string,
    relativePath: string,
    expectedProjectIdentity: ProjectDirectoryIdentity,
    expectedIndex: string,
    commitPending: () => void
  ): ActiveConversionLease {
    const canonicalProjectName = this.paths.resolveProject(projectName).name;
    const token = crypto.randomUUID();
    const key = conversionKey(canonicalProjectName, relativePath);
    let markerPath = "";
    this.paths.withProjectMutationLock(() => {
      const currentIdentity = this.captureProjectDirectoryIdentity(canonicalProjectName);
      if (!sameProjectDirectoryIdentity(currentIdentity, expectedProjectIdentity)) {
        throw new Error("Project 目录在资料转换开始前已被替换，请重试。");
      }
      if (indexFingerprint(this.readIndex(canonicalProjectName)) !== expectedIndex) {
        throw new Error("项目资料索引已被其他进程修改，请重试。");
      }
      const directory = this.paths.resolveInsideProject(canonicalProjectName, ACTIVE_CONVERSIONS_DIR, {
        allowedTopLevels: MATERIALS_TOP_LEVEL,
        allowMissingLeaf: true
      });
      fs.mkdirSync(directory, { recursive: true });
      markerPath = path.join(directory, `${token}.json`);
      writeJsonAtomic(markerPath, {
        token,
        pid: process.pid,
        projectName: canonicalProjectName,
        relativePath,
        createdAt: now()
      });
      this.activeConversions.add(key);
      try {
        commitPending();
      } catch (error) {
        this.activeConversions.delete(key);
        fs.rmSync(markerPath, { force: true });
        throw error;
      }
    });
    return { key, markerPath, token };
  }

  private captureProjectDirectoryIdentity(projectName: string): ProjectDirectoryIdentity {
    const root = this.paths.resolveProject(projectName).rootPath;
    const stat = fs.statSync(root);
    return { device: stat.dev, inode: stat.ino, birthtimeMs: stat.birthtimeMs };
  }

  private endActiveConversion(lease: ActiveConversionLease): void {
    this.activeConversions.delete(lease.key);
    this.completedConversionTokens.add(lease.token);
    try {
      fs.rmSync(lease.markerPath, { force: true });
      const directory = path.dirname(lease.markerPath);
      try { fs.rmdirSync(directory); } catch { /* Other active leases keep the directory non-empty. */ }
      this.completedConversionTokens.delete(lease.token);
    } catch {
      // scanActiveConversionMarkers recognizes the completed token and retries cleanup.
    }
  }

  private scanActiveConversionMarkers(projectName: string): { relativePaths: Set<string>; hasUnknown: boolean } {
    const relativePaths = new Set<string>();
    let hasUnknown = false;
    const directory = this.paths.resolveInsideProject(projectName, ACTIVE_CONVERSIONS_DIR, {
      allowedTopLevels: MATERIALS_TOP_LEVEL,
      allowMissingLeaf: true
    });
    if (!fs.existsSync(directory)) return { relativePaths, hasUnknown };
    const directoryStat = fs.lstatSync(directory);
    if (!directoryStat.isDirectory() || directoryStat.isSymbolicLink()) {
      throw new Error("项目资料转换标记目录无效。");
    }
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const markerPath = path.join(directory, entry.name);
      if (!entry.isFile() || entry.isSymbolicLink() || !entry.name.endsWith(".json")) {
        const stat = fs.lstatSync(markerPath);
        if (Date.now() - stat.mtimeMs >= ACTIVE_CONVERSION_MAX_AGE_MS) fs.rmSync(markerPath, { recursive: stat.isDirectory(), force: true });
        else hasUnknown = true;
        continue;
      }
      const stat = fs.lstatSync(markerPath);
      let marker: { token?: unknown; pid?: unknown; projectName?: unknown; relativePath?: unknown; createdAt?: unknown };
      try {
        marker = JSON.parse(fs.readFileSync(markerPath, "utf8")) as typeof marker;
      } catch {
        if (Date.now() - stat.mtimeMs >= ACTIVE_CONVERSION_MAX_AGE_MS) fs.rmSync(markerPath, { force: true });
        else hasUnknown = true;
        continue;
      }
      const token = typeof marker.token === "string" ? marker.token : "";
      if (token && this.completedConversionTokens.has(token)) {
        fs.rmSync(markerPath, { force: true });
        this.completedConversionTokens.delete(token);
        continue;
      }
      const valid = token
        && typeof marker.pid === "number" && Number.isInteger(marker.pid) && marker.pid > 0
        && marker.projectName === projectName
        && typeof marker.relativePath === "string";
      if (!valid) {
        if (Date.now() - stat.mtimeMs >= ACTIVE_CONVERSION_MAX_AGE_MS) fs.rmSync(markerPath, { force: true });
        else hasUnknown = true;
        continue;
      }
      if (!isProcessAlive(marker.pid as number)) {
        fs.rmSync(markerPath, { force: true });
        continue;
      }
      try {
        const relativePath = marker.relativePath as string;
        const markerDirectory = path.posix.dirname(relativePath);
        if (!["materials/documents", "materials/web", "materials/videos"].includes(markerDirectory)) {
          throw new Error("转换标记路径不属于资料目录。");
        }
        assertDirectProjectFile(relativePath, markerDirectory, "转换标记路径");
        relativePaths.add(portableIdentityKey(relativePath));
      } catch {
        hasUnknown = true;
      }
    }
    try { fs.rmdirSync(directory); } catch { /* Active marker files remain. */ }
    return { relativePaths, hasUnknown };
  }
}

function validateTarget(raw: ProjectMaterialConversionTarget): ProjectMaterialConversionTarget {
  if (!["documents", "web", "videos"].includes(raw.directory)) throw new Error("资料转换器返回了非法目标目录。");
  if ((raw.kind === "document" && raw.directory !== "documents")
    || (raw.kind === "web" && raw.directory !== "web")
    || (raw.kind === "video" && raw.directory !== "videos")) {
    throw new Error("资料转换器的 kind 与目标目录不一致。");
  }
  return {
    ...raw,
    fileName: safeMaterialFileName(raw.fileName),
    title: raw.title.trim().slice(0, 255) || "未命名资料"
  };
}

function safeMaterialFileName(raw: string): string {
  let value = path.basename(raw).normalize("NFC").trim()
    .replace(/[\u0000-\u001f\u007f<>:"/\\|?*]/gu, "-")
    .replace(/[. ]+$/u, "");
  if (!value || value === "." || value === "..") value = "资料.md";
  const extension = path.extname(value).slice(0, 20);
  const stem = path.basename(value, extension).slice(0, 180) || "资料";
  value = `${stem}${extension}`;
  const reserved = /^(?:agents|claude)\.md$/iu.test(value)
    || /^(?:con|prn|aux|nul|clock\$|conin\$|conout\$|com(?:[1-9]|[¹²³])|lpt(?:[1-9]|[¹²³]))(?:\..*)?$/iu.test(value)
    || value.startsWith(".");
  return reserved ? `资料-${value.replace(/^\.+/u, "") || "文件"}` : value;
}

function allocateFileName(raw: string, reserved: readonly string[], exists: (candidate: string) => boolean): string {
  const safe = safeMaterialFileName(raw);
  const extension = path.extname(safe);
  const stem = path.basename(safe, extension);
  const keys = new Set(reserved.map((value) => value.normalize("NFKC").toLocaleLowerCase("en-US")));
  for (let index = 1; index <= 10_000; index += 1) {
    const candidate = index === 1 ? safe : `${stem} (${index})${extension}`;
    const key = candidate.normalize("NFKC").toLocaleLowerCase("en-US");
    if (!keys.has(key) && !exists(candidate)) return candidate;
  }
  throw new Error("无法为项目资料分配唯一文件名。");
}

function sha256File(filePath: string): string {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function indexFingerprint(records: readonly ProjectMaterial[]): string {
  return crypto.createHash("sha256").update(JSON.stringify(records)).digest("hex");
}

function now(): string {
  return new Date().toISOString();
}

function conversionKey(projectName: string, relativePath: string): string {
  return `${projectName.normalize("NFKC").toLocaleLowerCase("en-US")}\0${portableIdentityKey(relativePath)}`;
}

function portableIdentityKey(relativePath: string): string {
  return relativePath.normalize("NFKC").toLocaleLowerCase("en-US");
}

function assertDirectProjectFile(relativePath: string, directory: string, label: string): void {
  const portable = relativePath.replaceAll("\\", "/");
  if (portable !== relativePath || path.posix.dirname(portable) !== directory || !path.posix.basename(portable)) {
    throw new Error(`${label}不属于预期目录：${relativePath}`);
  }
}

function assertOrdinaryFile(absolutePath: string, message: string): void {
  const stat = fs.lstatSync(absolutePath);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(message);
}

function isProcessAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true; }
  catch (error) { return (error as NodeJS.ErrnoException).code === "EPERM"; }
}

function sameProjectDirectoryIdentity(left: ProjectDirectoryIdentity, right: ProjectDirectoryIdentity): boolean {
  return left.device === right.device && left.inode === right.inode && left.birthtimeMs === right.birthtimeMs;
}
