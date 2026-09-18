import fs from "node:fs/promises";
import path from "node:path";
import { IMAGE_PREVIEW_MAX_BYTES, imagePreviewMimeType, type ImagePreviewRecord } from "../../shared/image-preview";
import { ensureInsideRepoReadable } from "./settings";

export async function readImagePreview(targetPath: string): Promise<ImagePreviewRecord> {
  const filePath = ensureInsideRepoReadable(targetPath);
  const mimeType = imagePreviewMimeType(filePath);
  if (!mimeType) throw new Error("该文件不是支持预览的图片格式。");
  const handle = await fs.open(filePath, "r");
  try {
    const stat = await handle.stat();
    if (!stat.isFile()) throw new Error("该路径不是文件。");
    if (stat.size > IMAGE_PREVIEW_MAX_BYTES) throw new Error("图片超过 20 MB，请使用外部应用打开。");
    // Bound the read even if another process replaces or grows the screenshot.
    const buffer = Buffer.alloc(stat.size + 1);
    let length = 0;
    while (length < buffer.length) {
      const { bytesRead } = await handle.read(buffer, length, buffer.length - length, length);
      if (!bytesRead) break;
      length += bytesRead;
    }
    if (length > stat.size) throw new Error("图片正在更新，请重新打开预览。");
    return { path: targetPath, name: path.basename(filePath), dataUrl: `data:${mimeType};base64,${buffer.subarray(0, length).toString("base64")}` };
  } finally {
    await handle.close();
  }
}
