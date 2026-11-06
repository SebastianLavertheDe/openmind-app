import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { SkillCoverThumbnails } from "./skill-cover-thumbnails";
import { decodeSkillImage } from "./skill-avatar-webp";
const native = vi.hoisted(() => ({ decode: vi.fn() }));
vi.mock("electron", () => ({ nativeImage: { createFromBuffer: native.decode } }));
vi.mock("./skill-avatar-webp", () => ({ decodeSkillImage: vi.fn(async bytes => bytes) }));
const roots: string[] = [];
function image(name = "image.png") {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "skill-cover-test-")); roots.push(root);
  const file = path.join(root, name); fs.writeFileSync(file, Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 1]));
  native.decode.mockReturnValue({ isEmpty: () => false, getSize: () => ({ width: 480, height: 270 }) });
  return file;
}
afterEach(() => { roots.splice(0).forEach(root => fs.rmSync(root, { recursive: true, force: true })); vi.clearAllMocks(); vi.mocked(decodeSkillImage).mockImplementation(async bytes => bytes); });

it("deduplicates concurrent reads, resizes covers, and invalidates changed files", async () => {
  const file = image(); const cache = new SkillCoverThumbnails();
  const [first, second] = await Promise.all([cache.read(file), cache.read(file)]);
  expect(first).toBe(second); expect(native.decode).toHaveBeenCalledTimes(1);
  expect(decodeSkillImage).toHaveBeenCalledWith(expect.any(Buffer), 480, false, "image/png");
  expect(first).toBe(`data:image/png;base64,${fs.readFileSync(file).toString("base64")}`);
  await cache.read(file); expect(native.decode).toHaveBeenCalledTimes(1);
  fs.appendFileSync(file, "changed"); await cache.read(file); expect(native.decode).toHaveBeenCalledTimes(2);
});

it("evicts least recently used entries and refuses over-budget original files", async () => {
  const a = image(), b = image(), c = image(); const cache = new SkillCoverThumbnails(2);
  await cache.read(a); await cache.read(b); await cache.read(a); await cache.read(c); await cache.read(a);
  expect(native.decode).toHaveBeenCalledTimes(3);
  await cache.read(b); expect(native.decode).toHaveBeenCalledTimes(4);
  fs.truncateSync(c, 10 * 1024 * 1024 + 1);
  await expect(cache.read(c)).rejects.toThrow("Invalid Skill cover");
  expect(native.decode).toHaveBeenCalledTimes(4);
});

it("does not retain thumbnails above the configured cache byte budget", async () => {
  const file = image(); const cache = new SkillCoverThumbnails(64, 1);
  await cache.read(file); await cache.read(file);
  expect(native.decode).toHaveBeenCalledTimes(2);
});

it("shares two decode slots and reauthorizes queued images before opening them", async () => {
  const a = image(), b = image(), c = image(); const cache = new SkillCoverThumbnails();
  const finish: Array<() => void> = [];
  vi.mocked(decodeSkillImage).mockImplementation(bytes => new Promise(resolve => finish.push(() => resolve(bytes))));
  let allowed = true;
  const first = cache.read(a), second = cache.read(b);
  await vi.waitFor(() => expect(finish).toHaveLength(2));
  const queued = cache.read(c, () => { if (!allowed) throw new Error("Root changed"); return c; });
  // Let the initial metadata read enqueue behind the two in-flight decodes.
  await new Promise(resolve => setTimeout(resolve, 20));
  expect(decodeSkillImage).toHaveBeenCalledTimes(2);
  allowed = false;
  const rejected = expect(queued).rejects.toThrow("Root changed");
  finish.forEach(done => done());
  await Promise.all([first, second, rejected]);
  expect(decodeSkillImage).toHaveBeenCalledTimes(2);
});

it("does not share same-named images across roots or follow a final symlink", async () => {
  const a = image(), b = image(); const cache = new SkillCoverThumbnails();
  await cache.read(a); await cache.read(b);
  expect(native.decode).toHaveBeenCalledTimes(2);
  if (process.platform !== "win32") {
    const link = path.join(path.dirname(a), "link.png"); fs.symlinkSync(b, link);
    await expect(cache.read(link)).rejects.toThrow();
    expect(native.decode).toHaveBeenCalledTimes(2);
  }
});
