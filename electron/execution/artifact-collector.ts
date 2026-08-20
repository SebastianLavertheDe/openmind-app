import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { RunArtifact, RunArtifactType } from "../../shared/execution-contracts";

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
  }): ArtifactCollectionResult {
    const artifacts: RunArtifact[] = [];
    for (const declaration of input.declarations) {
      if (declaration.logicalPath) {
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
      id: `${declaration.id}:${logicalPath}`,
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
