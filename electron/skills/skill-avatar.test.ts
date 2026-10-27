import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PNG } from "pngjs";
import { SKILL_AVATAR_INPUT_MAX_BYTES, SKILL_AVATAR_MAX_BYTES } from "../../shared/skill-contributor";
import { prepareSkillAvatar, readSkillAvatar, skillAvatarDataUrl } from "./skill-avatar";

const native = vi.hoisted(() => ({ decode: vi.fn(), crop: vi.fn(), resize: vi.fn(), webp: vi.fn() }));
vi.mock("electron", () => ({ nativeImage: { createFromBuffer: native.decode } }));
vi.mock("./skill-avatar-webp", () => ({ decodeWebpAvatar: native.webp }));
const roots: string[] = [];
afterEach(() => { vi.resetAllMocks(); roots.splice(0).forEach(root => fs.rmSync(root, { recursive: true, force: true })); });
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "openmind-avatar-")); roots.push(root);
  const bytes = PNG.sync.write(new PNG({ width: 2, height: 2 }));
  const file = path.join(root, "avatar.png"); fs.writeFileSync(file, bytes);
  return { root, bytes, file };
}

describe("Skill avatars", () => {
  it("center-crops and re-encodes uploads to a bounded 128px PNG", async () => {
    const f = fixture();
    native.decode.mockReturnValue({ isEmpty: () => false, getSize: () => ({ width: 320, height: 200 }), crop: native.crop });
    native.crop.mockReturnValue({ resize: native.resize });
    native.resize.mockReturnValue({ toPNG: () => f.bytes });
    expect(await prepareSkillAvatar(f.file)).toEqual(f.bytes);
    expect(native.crop).toHaveBeenCalledWith({ x: 60, y: 0, width: 200, height: 200 });
    expect(native.resize).toHaveBeenCalledWith({ width: 128, height: 128, quality: "best" });
  });

  it("rejects oversized uploads before decoding and invalid decoded images", async () => {
    const f = fixture();
    fs.writeFileSync(f.file, Buffer.alloc(SKILL_AVATAR_INPUT_MAX_BYTES + 1));
    await expect(prepareSkillAvatar(f.file)).rejects.toThrow();
    expect(native.decode).not.toHaveBeenCalled();
    fs.writeFileSync(f.file, f.bytes);
    native.decode.mockReturnValue({ isEmpty: () => true });
    await expect(prepareSkillAvatar(f.file)).rejects.toThrow();
  });

  it("decodes WebP through Chromium before passing PNG bytes to nativeImage", async () => {
    const f = fixture();
    const webp = Buffer.alloc(20); webp.write("RIFF"); webp.write("WEBP", 8);
    const source = path.join(f.root, "avatar.webp"); fs.writeFileSync(source, webp);
    native.webp.mockResolvedValue(f.bytes);
    native.decode.mockReturnValue({ isEmpty: () => false, getSize: () => ({ width: 128, height: 128 }), crop: native.crop });
    native.crop.mockReturnValue({ resize: native.resize });
    native.resize.mockReturnValue({ toPNG: () => f.bytes });
    expect(await prepareSkillAvatar(source)).toEqual(f.bytes);
    expect(native.webp).toHaveBeenCalledWith(webp);
    expect(native.decode).toHaveBeenCalledWith(f.bytes);
    native.webp.mockRejectedValue(new Error("Invalid WebP"));
    await expect(prepareSkillAvatar(source)).rejects.toThrow();
  });

  it("rejects forged formats, traversal, oversized stored images and escaping symlinks", () => {
    const f = fixture();
    expect(readSkillAvatar(f.root, "avatar.png")).toEqual(f.bytes);
    expect(skillAvatarDataUrl(f.bytes)).toMatch(/^data:image\/png;base64,/);
    expect(() => readSkillAvatar(f.root, "../avatar.png")).toThrow();
    expect(() => readSkillAvatar(f.root, f.file)).toThrow();
    fs.writeFileSync(f.file, "<svg xmlns='http://www.w3.org/2000/svg'/>");
    expect(() => readSkillAvatar(f.root, "avatar.png")).toThrow();
    fs.writeFileSync(f.file, Buffer.concat([f.bytes, Buffer.alloc(SKILL_AVATAR_MAX_BYTES)]));
    expect(() => readSkillAvatar(f.root, "avatar.png")).toThrow();
    const other = fixture();
    fs.rmSync(f.file); fs.symlinkSync(other.file, f.file);
    expect(() => readSkillAvatar(f.root, "avatar.png")).toThrow();
  });
});
