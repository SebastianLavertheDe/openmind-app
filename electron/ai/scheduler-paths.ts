import path from "node:path";
import type { ContextReference } from "../../shared/contracts";

export function resolveCwd(projectRoot: string, cwd: string): string {
  if (!cwd || cwd === ".") return projectRoot;
  const resolved = path.resolve(projectRoot, cwd);
  assertInsideProject(projectRoot, resolved, "工作目录超出项目范围。");
  return resolved;
}

export function normalizeCwd(projectRoot: string, cwd: string): string {
  if (!cwd || cwd === ".") return ".";
  const resolved = path.isAbsolute(cwd) ? path.resolve(cwd) : path.resolve(projectRoot, cwd);
  const relative = assertInsideProject(projectRoot, resolved, "工作目录超出项目范围。");
  return relative || ".";
}

export function normalizeContextReferences(projectRoot: string, contexts: ContextReference[]): ContextReference[] {
  return contexts.map((context) => {
    if (context.kind === "image") return context; // image 由 main materialize 到临时文件，跳过 in-project 断言
    if (!context.path) return context;
    const resolved = path.isAbsolute(context.path) ? path.resolve(context.path) : path.resolve(projectRoot, context.path);
    const relative = assertInsideProject(projectRoot, resolved, `上下文文件超出项目目录：${context.path}`);
    return { ...context, path: relative || "." };
  });
}

function assertInsideProject(projectRoot: string, target: string, message: string): string {
  const root = path.resolve(projectRoot);
  const resolved = path.resolve(target);
  const relative = path.relative(root, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error(message);
  return relative;
}
