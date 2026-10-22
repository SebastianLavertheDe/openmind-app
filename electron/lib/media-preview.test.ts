// @vitest-environment node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createLocalMediaHandler, readMediaPreview } from "./media-preview";
import { localMediaUrl, type MediaPreviewRequest } from "../../shared/media-preview";

describe("local media streaming", () => {
  let directory: string;
  beforeEach(() => { directory = fs.mkdtempSync(path.join(os.tmpdir(), "openmind-media-unit-")); fs.writeFileSync(path.join(directory, "clip.mp4"), "0123456789"); });
  afterEach(() => fs.rmSync(directory, { recursive: true, force: true }));
  const input = { path: "clip.mp4" };
  const url = localMediaUrl(input);
  const resolve = (request: MediaPreviewRequest) => {
    const file = path.resolve(directory, request.path);
    if (path.dirname(file) !== directory) throw new Error("outside root");
    return file;
  };
  it("returns lightweight metadata for existing files and never loads binary as text", () => {
    expect(readMediaPreview(input, resolve)).toMatchObject({ name: "clip.mp4", kind: "video", byteSize: 10, mediaUrl: url });
    expect(() => readMediaPreview({ path: "missing.mp4" }, resolve)).toThrow();
    expect(() => readMediaPreview({ path: "../clip.mp4" }, resolve)).toThrow();
    expect(() => readMediaPreview({ path: "clip.mp4", extra: true } as never, resolve)).toThrow();
  });
  it("streams full media and rechecks access every time", async () => {
    const scoped = vi.fn(resolve); const handler = createLocalMediaHandler(scoped);
    const response = await handler(new Request(url));
    expect(response.headers.get("content-type")).toBe("video/mp4");
    expect(response.headers.get("accept-ranges")).toBe("bytes");
    expect(await response.text()).toBe("0123456789");
    scoped.mockImplementation(() => { throw Error("scope changed"); });
    expect((await handler(new Request(url))).status).toBe(404);
    expect(scoped).toHaveBeenCalledTimes(2);
  });
  it.each([["bytes=2-5", "2345", "bytes 2-5/10"], ["bytes=7-", "789", "bytes 7-9/10"], ["bytes=-3", "789", "bytes 7-9/10"], ["bytes=8-100", "89", "bytes 8-9/10"]])("supports seeking %s", async (range, body, contentRange) => {
    const response = await createLocalMediaHandler(resolve)(new Request(url, { headers: { Range: range } }));
    expect(response.status).toBe(206); expect(response.headers.get("content-range")).toBe(contentRange); expect(await response.text()).toBe(body);
  });
  it.each(["bytes=20-", "bytes=7-3", "bytes=-0", "bytes=0-1,4-5", "bytes=-", "nonsense", "bytes=9007199254740992-"])("rejects invalid range %s", async range => {
    const response = await createLocalMediaHandler(resolve)(new Request(url, { headers: { Range: range } }));
    expect(response.status).toBe(416); expect(response.headers.get("content-range")).toBe("bytes */10");
  });
  it("supports HEAD ranges, empty files and audio MIME types", async () => {
    const handler = createLocalMediaHandler(resolve);
    const response = await handler(new Request(url, { method: "HEAD", headers: { Range: "bytes=2-5" } }));
    expect(response.status).toBe(206); expect(response.headers.get("content-length")).toBe("4"); expect(await response.text()).toBe("");
    fs.writeFileSync(path.join(directory, "empty.wav"), "");
    const empty = await handler(new Request(localMediaUrl({ path: "empty.wav" })));
    expect(empty.status).toBe(200); expect(empty.headers.get("content-type")).toBe("audio/wav"); expect(await empty.text()).toBe("");
  });
  it("hides missing files, invalid URLs, non-media, directories and symlinks", async () => {
    const handler = createLocalMediaHandler(resolve);
    fs.writeFileSync(path.join(directory, "secret.txt"), "secret");
    fs.mkdirSync(path.join(directory, "folder.mp4"));
    for (const input of ["../escape.mp4", "secret.txt", "missing.mp4", "folder.mp4"]) expect((await handler(new Request(localMediaUrl({ path: input })))).status).toBe(404);
    expect((await handler(new Request(`${url}&extra=1`))).status).toBe(404);
    expect((await handler(new Request(url, { method: "POST" }))).status).toBe(405);
    const link = path.join(directory, "linked.mp4");
    try { fs.symlinkSync(path.join(directory, "clip.mp4"), link); } catch (error) { if ((error as NodeJS.ErrnoException).code === "EPERM") return; throw error; }
    expect((await handler(new Request(localMediaUrl({ path: "linked.mp4" })))).status).toBe(404);
  });
});
