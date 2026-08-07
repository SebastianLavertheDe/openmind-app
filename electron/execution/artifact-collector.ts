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

export type ArtifactSnapshot = Map<string, { absolutePath: string; kind: "file" | "directory" | "symlink"; size: number }>;

export type ArtifactCollectionResult = {
  artifacts: RunArtifact[];
  undeclaredPaths: string[];
};

export class ArtifactCollector {
  constructor(
    private readonly maxEntries = 20_000,
    private readonly maxHashBytes = 50 * 1024 * 1024,
    private readonly now: () => Date = () => new Date()
  ) {}

  snapshot(root: string): ArtifactSnapshot {
    const canonicalRoot = fs.realpathSync(root);
    const result: ArtifactSnapshot = new Map();
    walk(canonicalRoot, canonicalRoot, result, this.maxEntries);
    return result;
  }

  collect(input: {
    runId: string;
    skillId: string;
    mymindRoot: string;
    runDir: string;
    before: ArtifactSnapshot;
    declarations: ArtifactDeclaration[];
    externalBindings?: Record<string, ExternalBinding>;
  }): ArtifactCollectionResult {
    const afterMymind = this.snapshot(input.mymindRoot);
    const afterRun = this.snapshot(input.runDir);
    const artifacts: RunArtifact[] = [];
    const declaredPaths = new Set<string>();
    for (const declaration of input.declarations) {
      if (declaration.logicalPath) {
        for (const [relative, entry] of afterMymind) {
          if (!matchesPattern(declaration.logicalPath, relative)) continue;
          if (entry.kind === "symlink" || !isWithin(input.mymindRoot, entry.absolutePath)) continue;
          if (entry.kind !== "file" && entry.kind !== "directory") continue;
          const safeEntry = {
            absolutePath: entry.absolutePath,
            kind: entry.kind as "file" | "directory",
            size: entry.size
          };
          declaredPaths.add(`mymind/${relative}`);
          artifacts.push(this.toArtifact(input.runId, input.skillId, declaration, safeEntry, `mymind/${relative}`));
        }
      }
      if (declaration.externalPathRef) {
        const binding = input.externalBindings?.[declaration.externalPathRef];
        if (!binding || binding.revoked || !fs.existsSync(binding.canonicalPath)) continue;
        const canonical = fs.realpathSync(binding.canonicalPath);
        if (!isWithin(binding.canonicalPath, canonical)) continue;
        const stat = fs.lstatSync(canonical);
        const entry = { absolutePath: canonical, kind: stat.isDirectory() ? "directory" as const : "file" as const, size: stat.isFile() ? stat.size : 0 };
        declaredPaths.add(`external/${binding.bindingId}`);
        artifacts.push(this.toArtifact(input.runId, input.skillId, declaration, entry, `external/${binding.bindingId}`));
      }
    }
    const undeclaredPaths: string[] = [];
    for (const [relative, entry] of afterMymind) {
      const logical = `mymind/${relative}`;
      if (!input.before.has(relative) && entry.kind !== "symlink" && !declaredPaths.has(logical)) undeclaredPaths.push(logical);
    }
    for (const [relative, entry] of afterRun) {
      if (!input.before.has(`run/${relative}`) && entry.kind !== "symlink" && !declaredPaths.has(`run/${relative}`)) undeclaredPaths.push(`run/${relative}`);
    }
    return { artifacts: deduplicateArtifacts(artifacts), undeclaredPaths: undeclaredPaths.sort() };
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

function walk(root: string, current: string, result: ArtifactSnapshot, maxEntries: number): void {
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
