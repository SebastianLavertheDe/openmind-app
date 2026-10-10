// @vitest-environment node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";

const mock = vi.hoisted(() => ({
  size: { width: 2048, height: 1024 },
  empty: false,
  resize: vi.fn(() => ({ toDataURL: () => "data:image/png;base64,thumbnail" })),
  network: vi.fn(async () => ({ body: Buffer.from("fixture") }))
}));
vi.mock("electron", () => ({ nativeImage: { createFromBuffer: () => ({ isEmpty: () => mock.empty, getSize: () => mock.size, resize: mock.resize, toDataURL: () => "data:image/png;base64,original" }) } }));
vi.mock("../project/converters/safe-http", () => ({ safeHttpGet: mock.network }));
import { readChatImage } from "./chat-image";
const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); vi.clearAllMocks(); mock.empty = false; });
function fixture() { const root = fs.mkdtempSync(path.join(os.tmpdir(), "openmind-image-preview-")); roots.push(root); const file = path.join(root, "image fixture.png"); fs.writeFileSync(file, "fixture"); return file; }

describe("main-process image previews", () => {
  it("bounds thumbnails and returns full dimensions only for explicit original requests", async () => {
    const file = fixture();
    const resolve = vi.fn(() => file);
    const thumbnail = await readChatImage({ source: "openmind/assets/test.png" }, resolve);
    expect(thumbnail).toEqual({ dataUrl: "data:image/png;base64,thumbnail", width: 2048, height: 1024 });
    expect(mock.resize).toHaveBeenCalledWith({ width: 640, height: 320, quality: "good" });
    const original = await readChatImage({ source: "openmind/assets/test.png", variant: "original" }, resolve);
    expect(original.dataUrl).toBe("data:image/png;base64,original");
    expect(mock.resize).toHaveBeenCalledTimes(1);
  });
  it("scopes decoded file URLs and uses bounded public-network fetching", async () => {
    const file = fixture();
    const resolve = vi.fn(() => file);
    await readChatImage({ source: pathToFileURL(file).href, projectName: "fixture" }, resolve);
    expect(resolve).toHaveBeenCalledWith(file, "fixture");
    await readChatImage({ source: "https://images.example/leaf.png" }, resolve);
    expect(mock.network).toHaveBeenCalledWith("https://images.example/leaf.png", expect.objectContaining({ maxBytes: 20 * 1024 * 1024, timeoutMs: 20_000 }));
    expect(resolve).toHaveBeenCalledTimes(1);
    await expect(readChatImage({ source: "javascript:alert(1)" }, resolve)).rejects.toThrow("不支持");
    await expect(readChatImage({ source: "openmind/../../secret.png" }, () => { throw new Error("outside root"); })).rejects.toThrow("outside root");
  });
  it("rejects unsupported image data", async () => {
    mock.empty = true;
    await expect(readChatImage({ source: "file.png" }, () => fixture())).rejects.toThrow("格式不支持");
  });
});
