import fs from "node:fs";
import path from "node:path";
import { nativeImage } from "electron";
import { SKILL_AVATAR_INPUT_MAX_BYTES, SKILL_AVATAR_MAX_BYTES, SKILL_AVATAR_SIZE, SkillContributorAvatarPathSchema } from "../../shared/skill-contributor";
import { messages } from "../../shared/messages";
import { decodeWebpAvatar } from "./skill-avatar-webp";

function imageMime(bytes: Buffer): string | undefined {
  if (bytes.length >= 24 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) && bytes.subarray(12, 16).toString() === "IHDR") return "image/png";
  if (bytes.length >= 4 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return "image/jpeg";
  if (bytes.length >= 20 && bytes.subarray(0, 4).toString() === "RIFF" && bytes.subarray(8, 12).toString() === "WEBP") return "image/webp";
  return undefined;
}

function readBounded(file: string, limit: number): Buffer {
  const fd = fs.openSync(file, "r");
  try {
    const stat = fs.fstatSync(fd);
    if (!stat.isFile() || stat.size === 0 || stat.size > limit) throw new Error(messages.skillLibrary.errors.avatarStored);
    const bytes = Buffer.alloc(stat.size + 1);
    let length = 0;
    while (length < bytes.length) {
      const read = fs.readSync(fd, bytes, length, bytes.length - length, null);
      if (!read) break;
      length += read;
    }
    if (length !== stat.size) throw new Error(messages.skillLibrary.errors.avatarStored);
    const result = bytes.subarray(0, length);
    if (!imageMime(result)) throw new Error(messages.skillLibrary.errors.avatarStored);
    return result;
  } finally { fs.closeSync(fd); }
}

/** The native picker supplies the source; only a small, re-encoded PNG is retained. */
export async function prepareSkillAvatar(file: string): Promise<Buffer> {
  try {
    if (!/^\.(png|jpe?g|webp)$/i.test(path.extname(file))) throw new Error();
    const source = readBounded(file, SKILL_AVATAR_INPUT_MAX_BYTES);
    const image = nativeImage.createFromBuffer(imageMime(source) === "image/webp" ? await decodeWebpAvatar(source) : source);
    if (image.isEmpty()) throw new Error();
    const { width, height } = image.getSize();
    if (!width || !height) throw new Error();
    const side = Math.min(width, height);
    const square = image.crop({ x: Math.floor((width - side) / 2), y: Math.floor((height - side) / 2), width: side, height: side });
    const bytes = square.resize({ width: SKILL_AVATAR_SIZE, height: SKILL_AVATAR_SIZE, quality: "best" }).toPNG();
    if (!bytes.length || bytes.length > SKILL_AVATAR_MAX_BYTES) throw new Error();
    return bytes;
  } catch (cause) { throw new Error(messages.skillLibrary.errors.avatar, { cause }); }
}

/** Used by both the Node bundle builder and Electron. Never resolves outside its owner. */
export function readSkillAvatar(root: string, relativePath: string): Buffer {
  const relative = SkillContributorAvatarPathSchema.parse(relativePath);
  const base = fs.realpathSync(root);
  const file = fs.realpathSync(path.join(root, relative));
  if (!file.startsWith(`${base}${path.sep}`)) throw new Error(messages.skillLibrary.errors.avatarStored);
  return readBounded(file, SKILL_AVATAR_MAX_BYTES);
}

export function skillAvatarDataUrl(bytes: Buffer): string {
  const mime = imageMime(bytes);
  if (!mime || bytes.length > SKILL_AVATAR_MAX_BYTES) throw new Error(messages.skillLibrary.errors.avatarStored);
  return `data:${mime};base64,${bytes.toString("base64")}`;
}
