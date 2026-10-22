import fs from "node:fs";
import { Readable } from "node:stream";
import { parseProjectVideoMediaUrl } from "../../shared/youtube-import";

/** Serve only indexed local video files, with byte ranges for seeking and without buffering the movie. */
export function createVideoMediaHandler(resolveFile: (projectName: string, relativePath: string) => string) {
  return async (request: Request): Promise<Response> => {
    if (!["GET", "HEAD"].includes(request.method)) return new Response(null, { status: 405 });
    const locator = parseProjectVideoMediaUrl(request.url);
    if (!locator) return new Response(null, { status: 404 });
    let file: string;
    let size: number;
    try {
      file = resolveFile(locator.projectName, locator.relativePath);
      const stat = fs.lstatSync(file);
      if (!stat.isFile() || stat.isSymbolicLink() || !/\.(mp4|webm)$/i.test(file)) return new Response(null, { status: 404 });
      size = stat.size;
    } catch { return new Response(null, { status: 404 }); }
    const headers = new Headers({
      "Content-Type": file.toLowerCase().endsWith(".webm") ? "video/webm" : "video/mp4",
      "Accept-Ranges": "bytes", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff"
    });
    let start = 0;
    let end = size - 1;
    const range = request.headers.get("range");
    if (range) {
      const match = range.match(/^bytes=(\d*)-(\d*)$/);
      if (!match || (!match[1] && !match[2])) return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${size}` } });
      if (match[1]) {
        start = Number(match[1]);
        end = match[2] ? Math.min(Number(match[2]), size - 1) : size - 1;
      } else start = Math.max(0, size - Number(match[2]));
      if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start >= size || end < start) {
        return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${size}` } });
      }
      headers.set("Content-Range", `bytes ${start}-${end}/${size}`);
    }
    headers.set("Content-Length", String(Math.max(0, end - start + 1)));
    const body = request.method === "HEAD" || size === 0 ? null
      : Readable.toWeb(fs.createReadStream(file, { start, end, signal: request.signal })) as ReadableStream<Uint8Array>;
    return new Response(body, { status: range ? 206 : 200, headers });
  };
}
