import fs from "node:fs";
import { nativeImage } from "electron";
import { decodeSkillImage } from "./skill-avatar-webp";

const MAX_INPUT_BYTES = 10 * 1024 * 1024;
const MAX_THUMBNAIL_BYTES = 1024 * 1024;
const COVER_SIZE = 480;

/** Root-bound, byte-bounded LRU. Concurrent cards share reads and decoding. */
export class SkillCoverThumbnails {
  private readonly cache = new Map<string, { value: string; bytes: number }>();
  private readonly pending = new Map<string, Promise<string>>();
  private bytes = 0;
  private active = 0;
  private readonly queue: Array<() => void> = [];

  constructor(private readonly maxEntries = 64, private readonly maxBytes = 4 * 1024 * 1024) {}

  async read(file: string, resolveFile: () => string = () => file): Promise<string> {
    if (resolveFile() !== file) throw new Error("Skill cover image changed");
    const stat = await fs.promises.stat(file);
    if (!stat.isFile() || stat.size <= 0 || stat.size > MAX_INPUT_BYTES) throw new Error("Invalid Skill cover image");
    const key = JSON.stringify([file, stat.ino, stat.size, stat.mtimeMs, stat.ctimeMs]);
    const cached = this.cache.get(key);
    if (cached) { this.cache.delete(key); this.cache.set(key, cached); return cached.value; }
    const existing = this.pending.get(key);
    if (existing) return existing;
    const task = this.decode(file, stat, resolveFile).then(value => {
      const bytes = Buffer.byteLength(value);
      if (bytes <= this.maxBytes) {
        this.cache.set(key, { value, bytes }); this.bytes += bytes;
        while (this.cache.size > this.maxEntries || this.bytes > this.maxBytes) {
          const oldest = this.cache.entries().next().value!;
          this.bytes -= oldest[1].bytes; this.cache.delete(oldest[0]);
        }
      }
      return value;
    }).finally(() => this.pending.delete(key));
    this.pending.set(key, task);
    return task;
  }

  private async decode(file: string, expected: fs.Stats, resolveFile: () => string): Promise<string> {
    if (this.active >= 2) await new Promise<void>(resolve => this.queue.push(resolve));
    else this.active++;
    try {
      if (resolveFile() !== file) throw new Error("Skill cover image changed");
      const handle = await fs.promises.open(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
      let bytes: Buffer;
      try {
        const stat = await handle.stat();
        const same = (current: fs.Stats) => current.ino === expected.ino && current.size === expected.size && current.mtimeMs === expected.mtimeMs && current.ctimeMs === expected.ctimeMs;
        if (!stat.isFile() || !same(stat) || resolveFile() !== file) throw new Error("Skill cover image changed");
        const buffer = Buffer.alloc(stat.size + 1);
        let length = 0;
        while (length < buffer.length) {
          const { bytesRead } = await handle.read(buffer, length, buffer.length - length, length);
          if (!bytesRead) break;
          length += bytesRead;
        }
        if (length !== stat.size || !same(await handle.stat())) throw new Error("Skill cover image changed");
        bytes = buffer.subarray(0, length);
      } finally { await handle.close(); }
      const mime = bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ? "image/png"
        : bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255 ? "image/jpeg"
        : bytes.subarray(0, 4).toString() === "RIFF" && bytes.subarray(8, 12).toString() === "WEBP" ? "image/webp" : null;
      if (!mime) throw new Error("Invalid Skill cover image");
      // Decode the original outside Main. Main only receives a <=480px image.
      const thumbnail = await decodeSkillImage(bytes, COVER_SIZE, false, mime);
      const image = nativeImage.createFromBuffer(thumbnail);
      if (image.isEmpty()) throw new Error("Invalid Skill cover image");
      const { width, height } = image.getSize();
      if (!width || !height || Math.max(width, height) > COVER_SIZE) throw new Error("Invalid Skill cover image");
      if (!thumbnail.length || thumbnail.length > MAX_THUMBNAIL_BYTES) throw new Error("Skill cover thumbnail is too large");
      return `data:image/png;base64,${thumbnail.toString("base64")}`;
    } finally {
      const next = this.queue.shift();
      if (next) next();
      else this.active--;
    }
  }
}

// IPC creates root-scoped library services per call. Share the bounded cache and
// concurrency gate; absolute paths and file identities keep roots isolated.
export const skillCoverThumbnails = new SkillCoverThumbnails();
