import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { nativeImage } from "electron";
import { ChatImageRequestSchema, IMAGE_MAX_BYTES, type ChatImageData, type ChatImageRequest } from "../../shared/image-generation";
import { safeHttpGet } from "../project/converters/safe-http";

/** Images pass the same scoped filesystem admission as other previews. */
export async function readChatImage(raw: ChatImageRequest, resolveFile: (source: string, projectName?: string) => string): Promise<ChatImageData> {
  const input = ChatImageRequestSchema.parse(raw);
  let bytes: Buffer;
  if (/^https?:\/\//i.test(input.source)) {
    const response = await safeHttpGet(input.source, { maxBytes: IMAGE_MAX_BYTES, timeoutMs: 20_000, accept: "image/png,image/jpeg,image/webp,image/gif" });
    bytes = response.body;
  } else {
    let source = input.source;
    if (/^file:\/\//i.test(source)) {
      try { source = fileURLToPath(source); } catch { throw new Error("不支持此图片地址。"); }
    }
    if (/^[a-z][a-z\d+.-]*:/i.test(source) && !/^[a-z]:[\\/]/i.test(source)) throw new Error("不支持此图片地址。");
    const file = resolveFile(source, input.projectName);
    const handle = await fs.open(file, "r");
    try {
      const stat = await handle.stat();
      if (!stat.isFile() || stat.size > IMAGE_MAX_BYTES) throw new Error("图片超过 20 MB 或不是文件。");
      const buffer = Buffer.alloc(stat.size + 1);
      let length = 0;
      while (length < buffer.length) {
        const { bytesRead } = await handle.read(buffer, length, buffer.length - length, length);
        if (!bytesRead) break;
        length += bytesRead;
      }
      if (length > stat.size) throw new Error("图片正在更新，请重新打开。");
      bytes = buffer.subarray(0, length);
    } finally { await handle.close(); }
  }
  const image = nativeImage.createFromBuffer(bytes);
  if (image.isEmpty()) throw new Error("图片格式不支持或文件已损坏。");
  const { width, height } = image.getSize();
  const scale = input.variant === "thumbnail" ? Math.min(1, 640 / width, 480 / height) : 1;
  const displayed = scale < 1 ? image.resize({ width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)), quality: "good" }) : image;
  return { dataUrl: displayed.toDataURL(), width, height };
}
