import { messages as uiMessages } from "@shared/messages";
import type { FilePreviewSource } from "../file-preview/model";
import { isBinaryPreviewPath, workspaceFileSource } from "../file-preview/workspace-file-source";
import { projectMaterialPreviewSource } from "../projects/project-material-preview-source";
import { projectOutputPreviewSource } from "../projects/project-output-preview-source";
import { projectsApi } from "../projects/projects-api";

export type ResolvedPreviewSource = {
  source: FilePreviewSource;
  logicalPath: string;
};

/**
 * Adapt the async, Project-owned path resolver to surfaces that accept one
 * synchronous FilePreviewSource. The resolved delegate still performs every
 * read through the existing typed Project APIs, so a companion preview cannot
 * widen its access to arbitrary Workspace paths.
 */
export function projectConversationPreviewSource(targetPath: string, projectName: string): FilePreviewSource {
  let delegatePromise: Promise<FilePreviewSource> | null = null;
  const delegate = () => delegatePromise ||= resolveProjectPreviewSource(targetPath, projectName).then((resolved) => {
    if (!resolved) throw new Error(uiMessages.interface.projectFileMissing);
    return resolved.source;
  });
  return {
    id: `project-conversation:${projectName}:${targetPath}`,
    path: targetPath,
    capabilities: { editContent: false, editTitle: false, openExternal: true },
    async load(signal) {
      const source = await delegate();
      if (signal?.aborted) throw new DOMException("The operation was aborted.", "AbortError");
      return source.load(signal);
    },
    async openExternal() {
      await (await delegate()).openExternal?.();
    }
  };
}

const PROJECT_LISTINGS_CACHE_TTL_MS = 30_000;
const projectFileListingsCache = new Map<string, { at: number; promise: ReturnType<typeof loadProjectFileListingsUncached> }>();

/** Resolve semantic Project records before considering a scoped text fallback. */
export async function resolveProjectPreviewSource(targetPath: string, projectName: string): Promise<ResolvedPreviewSource | null> {
  const relativeTarget = ownedProjectRelativePath(targetPath, projectName);
  if (relativeTarget === null) return null;
  const logicalTarget = `openmind/projects/${projectName}/${relativeTarget}`;
  const listings = await loadProjectFileListings(projectName);
  const material = bestPathMatch(relativeTarget, listings.materials.flatMap((item) => [
    { value: item.relativePath, item, original: false },
    ...(item.originalPath ? [{ value: item.originalPath, item, original: true }] : [])
  ]));
  if (material) {
    const logicalPath = `openmind/projects/${projectName}/${material.value}`;
    if (material.original && !/\.pdf$/i.test(material.value)) {
      return { source: unsupportedPreviewSource(logicalPath, uiMessages.interface.binaryMaterial), logicalPath };
    }
    return {
      source: projectMaterialPreviewSource(projectName, material.item.relativePath, {
        logicalPath,
        view: material.original ? "pdf" : "auto"
      }),
      logicalPath
    };
  }
  const output = bestPathMatch(relativeTarget, listings.outputs.map((item) => ({ value: item.relativePath, item })));
  if (output) {
    const logicalPath = `openmind/projects/${projectName}/${output.value}`;
    return {
      source: projectOutputPreviewSource(projectName, output.item.relativePath, { editable: false, logicalPath }),
      logicalPath
    };
  }
  if (isBinaryPreviewPath(relativeTarget)) {
    return { source: unsupportedPreviewSource(logicalTarget, uiMessages.interface.binaryProjectFile), logicalPath: logicalTarget };
  }
  // Project metadata and other text files remain readable, but never editable.
  return { source: workspaceFileSource(logicalTarget), logicalPath: logicalTarget };
}

/**
 * Accept only references whose ownership can be proven from the current
 * Project's logical path. Rejecting other openmind paths and OS absolute/UNC
 * paths is intentional: readContent may accept them inside the workspace, but
 * a Project Task must not acquire that broader workspace read capability.
 */
function ownedProjectRelativePath(targetPath: string, projectName: string): string | null {
  let decoded = targetPath;
  try { decoded = decodeURIComponent(targetPath); } catch { /* Reject malformed escapes below as ordinary text. */ }
  const normalized = decoded.trim().replaceAll("\\", "/").replace(/^\.\//, "");
  if (!normalized || !projectName || /^[a-z]:\//i.test(normalized) || normalized.startsWith("//")) return null;
  const withoutLeadingSlash = normalized.replace(/^\/+/, "");
  if (!/^openmind\//i.test(withoutLeadingSlash)) return safeProjectRelativePath(withoutLeadingSlash);
  const prefix = `openmind/projects/${projectName}/`;
  return withoutLeadingSlash.toLocaleLowerCase().startsWith(prefix.toLocaleLowerCase())
    ? safeProjectRelativePath(withoutLeadingSlash.slice(prefix.length))
    : null;
}

function safeProjectRelativePath(value: string): string | null {
  if (!value || /[\0\r\n]/.test(value)) return null;
  const segments = value.split("/").filter((segment) => segment && segment !== ".");
  if (!segments.length || segments.some((segment) => segment === "..")) return null;
  return segments.join("/");
}

function bestPathMatch<T extends { value: string }>(target: string, entries: T[]): T | undefined {
  const lowered = target.toLocaleLowerCase();
  const exact = entries.find((entry) => entry.value.toLocaleLowerCase() === lowered);
  if (exact) return exact;
  const basename = lowered.split("/").at(-1);
  if (!basename) return undefined;
  return entries.find((entry) => entry.value.toLocaleLowerCase().split("/").at(-1) === basename);
}

function loadProjectFileListings(projectName: string) {
  const cached = projectFileListingsCache.get(projectName);
  if (cached && Date.now() - cached.at < PROJECT_LISTINGS_CACHE_TTL_MS) return cached.promise;
  const promise = loadProjectFileListingsUncached(projectName);
  projectFileListingsCache.set(projectName, { at: Date.now(), promise });
  promise.catch(() => projectFileListingsCache.delete(projectName));
  return promise;
}

function loadProjectFileListingsUncached(projectName: string) {
  return Promise.all([
    projectsApi.listMaterials(projectName),
    projectsApi.listOutputs(projectName).catch(() => [])
  ]).then(([materials, outputs]) => ({ materials, outputs }));
}

function unsupportedPreviewSource(path: string, reason: string): FilePreviewSource {
  const resource = {
    kind: "unsupported" as const,
    id: `unsupported:${path}`,
    path,
    title: path.split(/[\\/]/).at(-1) || path,
    reason
  };
  return {
    id: resource.id,
    path,
    capabilities: { editContent: false, editTitle: false, openExternal: false },
    async load() {
      return resource;
    }
  };
}

export function clearProjectPreviewSourceCacheForTests(): void {
  projectFileListingsCache.clear();
}
