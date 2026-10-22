import fs from "node:fs";
import path from "node:path";
import type { ContextReference } from "../../shared/contracts";
import { resolvePathInsideRoot } from "./scheduler-paths";

const TMP_DIR_NAME = "tmp-images";
const ATTACHMENTS_DIR_NAME = "attachments";
const STALE_MAX_MS = 7 * 24 * 3600 * 1000;

function tmpImagesDir(projectRoot: string, stateRoot?: string): string {
  return path.join(stateRoot ?? projectRoot, ".openmind", "ai", TMP_DIR_NAME);
}

function attachmentsDir(projectRoot: string, stateRoot?: string): string {
  return path.join(stateRoot ?? projectRoot, ".openmind", "ai", ATTACHMENTS_DIR_NAME);
}

/** Only image attachment directories in the active app-private root are admitted. */
export function resolveChatAttachment(source: string, stateRoot: string): string | null {
  if (!path.isAbsolute(source)) return null;
  for (const directory of [attachmentsDir(stateRoot), tmpImagesDir(stateRoot)]) {
    const relative = path.relative(directory, source);
    if (!relative || relative.startsWith(`..${path.sep}`) || relative === ".." || path.isAbsolute(relative)) continue;
    return resolvePathInsideRoot(directory, source, "图片附件超出会话存储范围。");
  }
  return null;
}

function extFromMediaType(mediaType: string): string {
  if (mediaType === "image/jpeg") return "jpg";
  const sub = mediaType.split("/")[1];
  return sub && /^[a-z0-9]+$/i.test(sub) ? sub : "png";
}

function parseDataURL(content: string): { base64: string; mediaType: string } | null {
  const match = content.match(/^data:([^;]+);base64,(.*)$/s);
  if (!match) return null;
  return { mediaType: match[1], base64: match[2] };
}

/**
 * 把 image context 的 dataURL content 解码写到 root-scoped app-private
 * state/.openmind/ai/attachments/（兼容调用未传 stateRoot 时仍使用
 * projectRoot），回填 path、清空 content、补 mediaType/byteSize。其余 context 不动。
 * 失败的图（bad dataURL / 写盘失败）跳过并 console.warn，不阻断 run。
 */
export function materializeImages(projectRoot: string, runId: string, contexts: ContextReference[], stateRoot?: string): ContextReference[] {
  // Sent images belong to conversation history, not the run's temporary files.
  const dir = attachmentsDir(projectRoot, stateRoot);
  return contexts.map((context) => {
    if (context.kind !== "image") return context;
    if (!context.content) return context; // 已 materialize（rerun 等）或无内容：保留原样
    const parsed = parseDataURL(context.content);
    if (!parsed) {
      console.warn(`[image] context ${context.id} content 非 dataURL，跳过`);
      return { ...context, content: undefined, path: undefined };
    }
    try {
      fs.mkdirSync(dir, { recursive: true });
      const ext = extFromMediaType(parsed.mediaType);
      const file = path.join(dir, `${runId}-${context.id}.${ext}`);
      fs.writeFileSync(file, Buffer.from(parsed.base64, "base64"));
      return {
        ...context,
        content: undefined,
        path: stateRoot ? file : path.relative(projectRoot, file) || file,
        mediaType: parsed.mediaType,
        byteSize: fs.statSync(file).size
      };
    } catch (err) {
      console.warn(`[image] materialize ${context.id} 失败：${err}`);
      return { ...context, content: undefined, path: undefined };
    }
  });
}

/** Clean legacy temporary run files; persisted conversation attachments are retained. */
export function cleanupImages(projectRoot: string, runId: string, stateRoot?: string): void {
  const dir = tmpImagesDir(projectRoot, stateRoot);
  try {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir)) {
      if (entry.startsWith(`${runId}-`)) {
        try { fs.unlinkSync(path.join(dir, entry)); } catch { /* best effort */ }
      }
    }
  } catch { /* best effort */ }
}

/** 启动期扫残留（mtime > 7d），兜底清理崩溃残留的临时图片。 */
export function cleanupStaleImages(projectRoot: string, stateRoot?: string): void {
  const dir = tmpImagesDir(projectRoot, stateRoot);
  try {
    if (!fs.existsSync(dir)) return;
    const cutoff = Date.now() - STALE_MAX_MS;
    for (const entry of fs.readdirSync(dir)) {
      const full = path.join(dir, entry);
      try {
        if (fs.statSync(full).mtimeMs < cutoff) fs.unlinkSync(full);
      } catch { /* skip */ }
    }
  } catch { /* best effort */ }
}

/**
 * rollout / 落盘前过滤：image context 只保留元数据（id/kind/label/path/mediaType/byteSize），
 * 去掉 base64 content——base64 永不进 run.json / rollout.jsonl / search-index。
 */
export function stripImageContent(contexts: ContextReference[]): ContextReference[] {
  return contexts.map((context) =>
    context.kind === "image"
      ? {
          id: context.id,
          kind: context.kind,
          label: context.label,
          path: context.path,
          mediaType: context.mediaType,
          byteSize: context.byteSize
        }
      : context
  );
}

/** 从 contexts 提取已 materialize 的 image 附件（绝对路径，供 provider 读文件转 image block）。 */
export function extractImageContexts(
  projectRoot: string,
  contexts: ContextReference[],
  stateRoot?: string
): Array<{ id: string; path: string; mediaType: string }> {
  const result: Array<{ id: string; path: string; mediaType: string }> = [];
  for (const context of contexts) {
    if (context.kind !== "image" || !context.path) continue;
    const abs = path.isAbsolute(context.path) ? context.path : path.resolve(projectRoot, context.path);
    assertImagePath(projectRoot, abs, stateRoot);
    result.push({ id: context.id, path: abs, mediaType: context.mediaType || "image/png" });
  }
  return result;
}

function assertImagePath(projectRoot: string, candidate: string, stateRoot?: string): void {
  try {
    resolvePathInsideRoot(projectRoot, candidate, "图片附件超出会话执行根。");
    return;
  } catch (projectError) {
    if (stateRoot) {
      try {
        const resolved = resolveChatAttachment(candidate, stateRoot);
        if (!resolved) throw projectError;
        return;
      } catch { /* report the stable project-boundary error below */ }
    }
    throw projectError;
  }
}
