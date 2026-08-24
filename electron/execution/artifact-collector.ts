import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  SkillArtifactReportSchema,
  type RunArtifact,
  type RunArtifactType,
  type SkillArtifactReport
} from "../../shared/execution-contracts";

const MAX_ARTIFACT_ID_LENGTH = 120;
const ARTIFACT_ID_DIGEST_LENGTH = 32;
const MAX_ARTIFACT_REPORT_BYTES = 1024 * 1024;

export type ArtifactDeclaration = {
  id: string;
  type: RunArtifactType;
  logicalPath?: string;
  externalPathRef?: string;
};

export type ExternalBinding = {
  bindingId: string;
  canonicalPath: string;
  revoked?: boolean;
};

export type ArtifactCollectionResult = {
  artifacts: RunArtifact[];
};

export class ArtifactCollector {
  constructor(
    private readonly maxEntries = 20_000,
    private readonly maxHashBytes = 50 * 1024 * 1024,
    private readonly now: () => Date = () => new Date()
  ) {}

  collect(input: {
    runId: string;
    skillId: string;
    openmindRoot: string;
    declarations: ArtifactDeclaration[];
    externalBindings?: Record<string, ExternalBinding>;
    /** Child-written exact Artifact report. When present, no content tree is scanned. */
    reportPath?: string;
    /** Transitional fallback for successful legacy Skills that do not emit a report yet. */
    allowLegacyScan?: boolean;
  }): ArtifactCollectionResult {
    const artifacts: RunArtifact[] = [];
    const report = input.reportPath ? readArtifactReport(input.reportPath) : null;
    if (report) {
      const declarations = declarationMap(input.declarations);
      for (const reported of report.artifacts) {
        const declaration = declarations.get(reported.declarationId);
        if (!declaration?.logicalPath) {
          throw new Error(`Artifact 清单引用了未声明的逻辑产物：${reported.declarationId}`);
        }
        const entry = resolveReportedEntry(input.openmindRoot, reported.logicalPath);
        if (!matchesPattern(declaration.logicalPath, entry.relative)) {
          throw new Error(`Artifact 清单路径不匹配声明 ${reported.declarationId}：${reported.logicalPath}`);
        }
        assertArtifactKind(declaration, entry.kind, reported.logicalPath);
        artifacts.push(this.toArtifact(
          input.runId,
          input.skillId,
          declaration,
          entry,
          `openmind/${entry.relative}`
        ));
      }
    } else if (input.allowLegacyScan !== false) {
      for (const declaration of input.declarations) {
        if (!declaration.logicalPath) continue;
        const entries = scanPattern(input.openmindRoot, declaration.logicalPath, this.maxEntries);
        for (const [relative, entry] of entries) {
          if (!matchesPattern(declaration.logicalPath, relative)) continue;
          if (entry.kind === "symlink" || !isWithin(input.openmindRoot, entry.absolutePath)) continue;
          if (entry.kind !== "file" && entry.kind !== "directory") continue;
          const safeEntry = {
            absolutePath: entry.absolutePath,
            kind: entry.kind as "file" | "directory",
            size: entry.size
          };
          artifacts.push(this.toArtifact(input.runId, input.skillId, declaration, safeEntry, `openmind/${relative}`));
        }
      }
    }

    for (const declaration of input.declarations) {
      if (declaration.externalPathRef) {
        const binding = input.externalBindings?.[declaration.externalPathRef];
        if (!binding || binding.revoked || !fs.existsSync(binding.canonicalPath)) continue;
        const canonical = fs.realpathSync(binding.canonicalPath);
        if (!isWithin(binding.canonicalPath, canonical)) continue;
        const stat = fs.lstatSync(canonical);
        const entry = { absolutePath: canonical, kind: stat.isDirectory() ? "directory" as const : "file" as const, size: stat.isFile() ? stat.size : 0 };
        artifacts.push(this.toArtifact(input.runId, input.skillId, declaration, entry, `external/${binding.bindingId}`));
      }
    }
    return { artifacts: deduplicateArtifacts(artifacts) };
  }

  private toArtifact(
    runId: string,
    skillId: string,
    declaration: ArtifactDeclaration,
    entry: { absolutePath: string; kind: "file" | "directory"; size: number },
    logicalPath: string
  ): RunArtifact {
    const artifact: RunArtifact = {
      id: buildArtifactId(declaration.id, logicalPath),
      runId,
      skillId,
      ...(declaration.externalPathRef ? { externalPathRef: declaration.externalPathRef } : { logicalPath }),
      type: declaration.type,
      size: entry.size,
      declared: true,
      createdAt: this.now().toISOString()
    };
    if (entry.kind === "file" && entry.size <= this.maxHashBytes) {
      artifact.sha256 = crypto.createHash("sha256").update(fs.readFileSync(entry.absolutePath)).digest("hex");
    }
    return artifact;
  }
}

function readArtifactReport(reportPath: string): SkillArtifactReport | null {
  if (!fs.existsSync(reportPath)) return null;
  const stat = fs.lstatSync(reportPath);
  if (stat.isSymbolicLink() || !stat.isFile()) throw new Error("Artifact 清单必须是 Run 目录中的普通文件。");
  if (stat.size > MAX_ARTIFACT_REPORT_BYTES) {
    throw new Error(`Artifact 清单超过 ${MAX_ARTIFACT_REPORT_BYTES} 字节。`);
  }
  try {
    return SkillArtifactReportSchema.parse(JSON.parse(fs.readFileSync(reportPath, "utf8")));
  } catch (error) {
    throw new Error(`Artifact 清单格式无效：${error instanceof Error ? error.message : String(error)}`);
  }
}

function declarationMap(declarations: ArtifactDeclaration[]): Map<string, ArtifactDeclaration> {
  const result = new Map<string, ArtifactDeclaration>();
  for (const declaration of declarations) {
    if (result.has(declaration.id)) throw new Error(`Artifact 声明 id 重复：${declaration.id}`);
    result.set(declaration.id, declaration);
  }
  return result;
}

function resolveReportedEntry(
  root: string,
  reportedPath: string
): { absolutePath: string; relative: string; kind: "file" | "directory"; size: number } {
  const canonicalRoot = fs.realpathSync(root);
  const normalized = reportedPath.replaceAll("\\", "/").replace(/\/$/, "");
  const segments = normalized.split("/");
  if (!normalized || path.isAbsolute(reportedPath) || normalized.startsWith("/")
    || segments.some((segment) => !segment || segment === "." || segment === "..")) {
    throw new Error(`Artifact 清单路径无效：${reportedPath}`);
  }
  const candidate = path.resolve(canonicalRoot, ...segments);
  if (!isWithin(canonicalRoot, candidate) || !fs.existsSync(candidate)) {
    throw new Error(`Artifact 清单路径不存在或越出 openmind：${reportedPath}`);
  }
  const localStat = fs.lstatSync(candidate);
  if (localStat.isSymbolicLink()) throw new Error(`Artifact 清单不能登记符号链接：${reportedPath}`);
  const canonical = fs.realpathSync(candidate);
  if (!isWithin(canonicalRoot, canonical)) throw new Error(`Artifact 清单路径越出 openmind：${reportedPath}`);
  const stat = fs.statSync(canonical);
  if (!stat.isFile() && !stat.isDirectory()) throw new Error(`Artifact 清单路径不是普通文件或目录：${reportedPath}`);
  return {
    absolutePath: canonical,
    relative: path.relative(canonicalRoot, canonical).split(path.sep).join("/"),
    kind: stat.isDirectory() ? "directory" : "file",
    size: stat.isFile() ? stat.size : 0
  };
}

function assertArtifactKind(declaration: ArtifactDeclaration, kind: "file" | "directory", logicalPath: string): void {
  if (declaration.type === "directory" && kind !== "directory") {
    throw new Error(`Artifact ${declaration.id} 声明为目录，但报告的是文件：${logicalPath}`);
  }
  if (declaration.type !== "directory" && declaration.type !== "other" && kind !== "file") {
    throw new Error(`Artifact ${declaration.id} 声明为文件，但报告的是目录：${logicalPath}`);
  }
}

function buildArtifactId(declarationId: string, logicalPath: string): string {
  const candidate = `${declarationId}:${logicalPath}`;
  if (candidate.length <= MAX_ARTIFACT_ID_LENGTH) return candidate;

  const digest = crypto.createHash("sha256").update(candidate).digest("hex").slice(0, ARTIFACT_ID_DIGEST_LENGTH);
  const prefixLength = MAX_ARTIFACT_ID_LENGTH - digest.length - 1;
  return `${declarationId.slice(0, prefixLength)}:${digest}`;
}

type ScannedEntry = { absolutePath: string; kind: "file" | "directory" | "symlink"; size: number };

function scanPattern(root: string, pattern: string, maxEntries: number): Map<string, ScannedEntry> {
  const canonicalRoot = fs.realpathSync(root);
  const scanRoot = resolveScanRoot(canonicalRoot, pattern);
  const result = new Map<string, ScannedEntry>();
  if (fs.existsSync(scanRoot)) walk(canonicalRoot, scanRoot, result, maxEntries);
  return result;
}

/**
 * Scan only the static prefix of a declared Artifact pattern. For an exact
 * file path we scan its parent so the file can be discovered after creation;
 * wildcard declarations scan the directory before the first wildcard.
 */
function resolveScanRoot(root: string, pattern: string): string {
  const normalized = pattern.replaceAll("\\", "/").replace(/^\/+/, "").replace(/\/$/, "");
  const segments = normalized.split("/").filter(Boolean);
  if (!segments.length || segments.includes("..")) throw new Error(`Artifact 路径无效：${pattern}`);
  const wildcardIndex = segments.findIndex((segment) => segment.includes("*"));
  const staticSegments = wildcardIndex >= 0 ? segments.slice(0, wildcardIndex) : segments.slice(0, -1);
  const candidate = path.resolve(root, ...staticSegments);
  if (!isWithin(root, candidate)) throw new Error(`Artifact 路径越出 openmind：${pattern}`);
  return candidate;
}

function walk(root: string, current: string, result: Map<string, ScannedEntry>, maxEntries: number): void {
  if (result.size >= maxEntries) throw new Error(`Artifact 扫描超过 ${maxEntries} 个条目。`);
  const stat = fs.lstatSync(current);
  const relative = path.relative(root, current).split(path.sep).join("/");
  if (relative) result.set(relative, { absolutePath: current, kind: stat.isSymbolicLink() ? "symlink" : stat.isDirectory() ? "directory" : "file", size: stat.isFile() ? stat.size : 0 });
  if (!stat.isDirectory() || stat.isSymbolicLink()) return;
  for (const entry of fs.readdirSync(current, { withFileTypes: true })) walk(root, path.join(current, entry.name), result, maxEntries);
}

function matchesPattern(pattern: string, relative: string): boolean {
  const normalized = pattern.replaceAll("\\", "/").replace(/^\/+/, "").replace(/\/$/, "");
  const escaped = normalized.split("**").map((part) => part.split("*").map(escapeRegExp).join("[^/]*")).join(".*");
  return new RegExp(`^${escaped}(?:/.*)?$`).test(relative);
}

function isWithin(root: string, target: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(target));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function deduplicateArtifacts(artifacts: RunArtifact[]): RunArtifact[] {
  return Array.from(new Map(artifacts.map((artifact) => [artifact.id, artifact])).values());
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
