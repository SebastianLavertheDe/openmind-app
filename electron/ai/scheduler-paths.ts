import fs from "node:fs";
import path from "node:path";
import type { ContextReference } from "../../shared/contracts";
import { isCanonicalPathWithin } from "../paths/openmind-path-resolver";

export function resolveCwd(projectRoot: string, cwd: string): string {
  const target = !cwd || cwd === "." ? projectRoot : path.resolve(projectRoot, cwd);
  return resolvePathInsideRoot(projectRoot, target, "工作目录超出项目范围。");
}

export function normalizeCwd(projectRoot: string, cwd: string): string {
  if (!cwd || cwd === ".") {
    return ".";
  }
  const target = path.isAbsolute(cwd) ? path.resolve(cwd) : path.resolve(projectRoot, cwd);
  const resolved = resolvePathInsideRoot(projectRoot, target, "工作目录超出项目范围。");
  const root = resolvePathInsideRoot(projectRoot, projectRoot, "工作目录超出项目范围。");
  const relative = path.relative(root, resolved);
  return relative || ".";
}

export function normalizeContextReferences(
  projectRoot: string,
  contexts: ContextReference[]
): ContextReference[] {
  return contexts.map((context) => {
    // Pasted images carry data and are materialized after this check. Never
    // retain a caller-supplied fallback path alongside that data: if decoding
    // later fails, the stale path must not become an unchecked file reference.
    if (context.kind === "image" && context.content) return { ...context, path: undefined };
    if (!context.path) return context;
    const target = path.isAbsolute(context.path) ? path.resolve(context.path) : path.resolve(projectRoot, context.path);
    const resolved = resolvePathInsideRoot(projectRoot, target, `上下文文件超出项目目录：${context.path}`);
    const root = resolvePathInsideRoot(projectRoot, projectRoot, `上下文文件超出项目目录：${context.path}`);
    const relative = path.relative(root, resolved);
    return { ...context, path: relative || "." };
  });
}

/**
 * Resolve an existing or prospective path and prove its real filesystem path
 * remains below `projectRoot`. For a missing leaf, the closest existing parent
 * is realpathed first so a symlinked ancestor cannot escape the boundary.
 */
export function resolvePathInsideRoot(projectRoot: string, candidate: string, message = "路径超出项目范围。"): string {
  let root: string;
  let target: string;
  try {
    root = canonicalPath(projectRoot);
    target = canonicalPath(path.isAbsolute(candidate) ? candidate : path.resolve(projectRoot, candidate));
  } catch {
    throw new Error(message);
  }
  if (!isCanonicalPathWithin(root, target)) throw new Error(message);
  return target;
}

/**
 * Validate the absolute Project root supplied by trusted Main code. Project
 * directories must be real, non-symlink direct children of `projectsRoot`, and
 * their business name must match the directory name exactly.
 */
export function canonicalizeTrustedProjectRoot(projectsRoot: string, projectName: string, candidate: string): string {
  if (!path.isAbsolute(candidate)) throw new Error("Project root 必须是绝对路径。");
  const projects = strictRealDirectory(projectsRoot, "Project 目录根不存在或不可用。");
  let stat: fs.Stats;
  try {
    stat = fs.lstatSync(candidate);
  } catch {
    throw new Error("Project 目录不存在或不可用。");
  }
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("Project 目录必须是普通目录，不能是符号链接。");
  const project = strictRealDirectory(candidate, "Project 目录不存在或不可用。");
  if (path.dirname(project) !== projects || path.basename(project) !== projectName) {
    throw new Error("Project root 与可信项目名称不匹配。");
  }
  return project;
}

function strictRealDirectory(candidate: string, message: string): string {
  try {
    const resolved = fs.realpathSync.native(candidate);
    if (!fs.statSync(resolved).isDirectory()) throw new Error(message);
    return resolved;
  } catch {
    throw new Error(message);
  }
}

function canonicalPath(candidate: string): string {
  const resolved = path.resolve(candidate);
  if (!lstat(resolved)) return canonicalMissingPath(resolved);
  return fs.realpathSync.native(resolved);
}

function canonicalMissingPath(candidate: string): string {
  const tail: string[] = [];
  let cursor = candidate;
  while (!lstat(cursor)) {
    const parent = path.dirname(cursor);
    if (parent === cursor) return candidate;
    tail.unshift(path.basename(cursor));
    cursor = parent;
  }
  return path.resolve(fs.realpathSync.native(cursor), ...tail);
}

function lstat(candidate: string): fs.Stats | null {
  try {
    return fs.lstatSync(candidate);
  } catch {
    return null;
  }
}
