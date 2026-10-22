import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { projectVideoMediaUrl } from "../../shared/youtube-import";
import { createVideoMediaHandler } from "./video-media-protocol";

describe("project video streaming", () => {
  let directory: string;
  let file: string;
  const url = projectVideoMediaUrl("视频 项目", "materials/videos/talk.video.md");
  beforeEach(() => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), "video-stream-unit-"));
    file = path.join(directory, "fixture.mp4");
    fs.writeFileSync(file, "0123456789");
  });
  afterEach(() => fs.rmSync(directory, { recursive: true, force: true }));

  it("resolves an indexed material and streams its file", async () => {
    const resolve = vi.fn(() => file);
    const response = await createVideoMediaHandler(resolve)(new Request(url));
    expect(resolve).toHaveBeenCalledWith("视频 项目", "materials/videos/talk.video.md");
    expect(response.headers.get("content-type")).toBe("video/mp4");
    expect(response.headers.get("content-length")).toBe("10");
    expect(await response.text()).toBe("0123456789");
  });

  it.each([["bytes=2-5", "2345", "bytes 2-5/10"], ["bytes=7-", "789", "bytes 7-9/10"], ["bytes=-3", "789", "bytes 7-9/10"], ["bytes=8-100", "89", "bytes 8-9/10"]])("supports seek range %s", async (range, body, contentRange) => {
    const response = await createVideoMediaHandler(() => file)(new Request(url, { headers: { Range: range } }));
    expect(response.status).toBe(206);
    expect(response.headers.get("content-range")).toBe(contentRange);
    expect(await response.text()).toBe(body);
  });

  it.each(["bytes=20-", "bytes=7-3", "bytes=-0", "bytes=0-1,4-5", "bytes=-", "nonsense"])("rejects invalid range %s", async range => {
    const response = await createVideoMediaHandler(() => file)(new Request(url, { headers: { Range: range } }));
    expect(response.status).toBe(416);
    expect(response.headers.get("content-range")).toBe("bytes */10");
  });

  it("supports HEAD without opening a stream", async () => {
    const response = await createVideoMediaHandler(() => file)(new Request(url, { method: "HEAD" }));
    expect(response.headers.get("content-length")).toBe("10");
    expect(await response.text()).toBe("");
  });

  it("rejects external URLs and arbitrary paths, and hides missing material errors", async () => {
    const resolve = vi.fn(() => { throw new Error("/private/path"); });
    const handler = createVideoMediaHandler(resolve);
    for (const value of ["file:///etc/passwd", "https://example.com/", "openmind-media://project/etc/passwd", `${url}&extra=true`]) {
      expect((await handler(new Request(value))).status).toBe(404);
    }
    expect(resolve).not.toHaveBeenCalled();
    const response = await handler(new Request(url));
    expect(response.status).toBe(404);
    expect(await response.text()).toBe("");
  });

  it("does not serve non-video files or symlinks", async () => {
    const link = path.join(directory, "link.mp4");
    // Windows file-symlink creation may require elevation. Inject the lstat
    // result so this guard is exercised on every platform without privileges.
    const stat = fs.lstatSync(file);
    const lstat = vi.spyOn(fs, "lstatSync").mockReturnValue({ ...stat, isFile: () => true, isSymbolicLink: () => true } as fs.Stats);
    try {
      expect((await createVideoMediaHandler(() => link)(new Request(url))).status).toBe(404);
      expect(lstat).toHaveBeenCalledWith(link);
    } finally { lstat.mockRestore(); }
    const text = path.join(directory, "text.txt");
    fs.writeFileSync(text, "private");
    expect((await createVideoMediaHandler(() => text)(new Request(url))).status).toBe(404);
  });
});
