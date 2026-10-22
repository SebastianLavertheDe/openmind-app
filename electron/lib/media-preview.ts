import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { Readable } from "node:stream";
import { localMediaUrl, mediaKind, mediaMimeType, MediaPreviewRequestSchema, parseLocalMediaUrl, type MediaPreviewRequest, type MediaPreviewRecord } from "../../shared/media-preview";

export type MediaFileResolver = (request: MediaPreviewRequest) => string;

export function readMediaPreview(raw: MediaPreviewRequest, resolve: MediaFileResolver): MediaPreviewRecord {
  const input = MediaPreviewRequestSchema.parse(raw);
  const file = resolve(input);
  const kind = mediaKind(file), mimeType = mediaMimeType(file);
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || !kind || !mimeType) throw new Error("不支持此媒体文件。");
  return { id: createHash("sha256").update(file).digest("hex"), path: input.path, name: path.basename(file), kind, mimeType, byteSize: stat.size, mediaUrl: localMediaUrl(input) };
}

/** Resolve again for every request; stream byte ranges without buffering the file. */
export function createLocalMediaHandler(resolve: MediaFileResolver) {
  return async (request: Request): Promise<Response> => {
    if (!["GET", "HEAD"].includes(request.method)) return new Response(null, { status: 405 });
    const input = parseLocalMediaUrl(request.url);
    if (!input) return new Response(null, { status: 404 });
    let handle: fs.promises.FileHandle | undefined;
    let streaming = false;
    try {
      const file = resolve(input);
      const mimeType = mediaMimeType(file);
      if (!mimeType) return new Response(null, { status: 404 });
      const admitted = await fs.promises.lstat(file);
      if (!admitted.isFile() || admitted.isSymbolicLink()) return new Response(null, { status: 404 });
      handle = await fs.promises.open(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
      const stat = await handle.stat();
      if (!stat.isFile()) return new Response(null, { status: 404 });
      const size = stat.size;
      const headers = new Headers({ "Content-Type": mimeType, "Accept-Ranges": "bytes", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "default-src 'none'; sandbox" });
      let start = 0, end = size - 1;
      const range = request.headers.get("range");
      if (range) {
        const match = /^bytes=(\d*)-(\d*)$/.exec(range);
        if (!match || (!match[1] && !match[2])) return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${size}` } });
        if (match[1]) { start = Number(match[1]); end = match[2] ? Math.min(Number(match[2]), size - 1) : size - 1; }
        else start = Math.max(0, size - Number(match[2]));
        if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start >= size || end < start) return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${size}` } });
        headers.set("Content-Range", `bytes ${start}-${end}/${size}`);
      }
      headers.set("Content-Length", String(size ? end - start + 1 : 0));
      if (request.method === "HEAD" || !size) return new Response(null, { status: range ? 206 : 200, headers });
      const body = Readable.toWeb(handle.createReadStream({ start, end, autoClose: true, signal: request.signal })) as ReadableStream<Uint8Array>;
      streaming = true;
      return new Response(body, { status: range ? 206 : 200, headers });
    } catch { return new Response(null, { status: 404 }); }
    finally { if (!streaming) await handle?.close(); }
  };
}
