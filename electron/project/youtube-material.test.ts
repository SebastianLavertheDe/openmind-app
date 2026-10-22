import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProjectService } from "./project-service";
import { createDefaultProjectMaterialConverters } from "./converters/project-material-converters";
import { videoDescriptorToMarkdown } from "./converters/video-converter";
import type { YoutubeDownload, YoutubeDownloader } from "./converters/youtube-downloader";
import { projectVideoMediaUrl } from "../../shared/youtube-import";

const roots: string[] = [];
afterEach(() => { vi.restoreAllMocks(); for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });

function fixture() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "youtube-material-unit-"));
  roots.push(base);
  const contentRoot = path.join(base, "content");
  fs.mkdirSync(contentRoot);
  const temporary = path.join(base, "downloads");
  fs.mkdirSync(temporary);
  const cleanup = vi.fn();
  const download = vi.fn<YoutubeDownloader["download"]>(async (videoId): Promise<YoutubeDownload> => {
    const folder = fs.mkdtempSync(path.join(temporary, "video-"));
    const mediaPath = path.join(folder, "video.mp4");
    fs.writeFileSync(mediaPath, `synthetic-${videoId}`);
    return { video: {
      provider: "youtube", videoId, sourceUrl: `https://www.youtube.com/watch?v=${videoId}`, title: "Fixture title", mediaType: "mp4", durationMs: 60000,
      transcript: [{ startMs: 1000, endMs: 3000, text: "A complete sentence." }], transcriptSource: "platform", warnings: []
    }, mediaPath, cleanup: () => { cleanup(); fs.rmSync(folder, { recursive: true, force: true }); } };
  });
  const options = { stateRoot: path.join(base, "state"), materialConverters: createDefaultProjectMaterialConverters({ video: { youtubeDownloader: { download } } }) };
  const service = new ProjectService(contentRoot, options);
  service.createProject({ name: "Videos" });
  return { base, contentRoot, temporary, cleanup, download, options, service };
}
const url = "https://youtu.be/dQw4w9WgXcQ";

describe("YouTube material lifecycle with synthetic downloads", () => {
  it("adopts the video, persists stitched captions and streams the indexed original after restart, rename and move", async () => {
    const { service, cleanup, temporary, contentRoot, options } = fixture();
    const material = await service.addProjectUrl("Videos", url);
    expect(material.status).toBe("ready");
    expect(material.originalRelativePath).toMatch(/^materials\/originals\/.+\.mp4$/);
    expect(cleanup).toHaveBeenCalledOnce();
    expect(fs.readdirSync(temporary)).toEqual([]);
    const restarted = new ProjectService(contentRoot, options);
    const read = restarted.readProjectMaterial("Videos", material.relativePath);
    expect(read.content).toContain("A complete sentence.");
    expect(read.video).toMatchObject({ localMediaUrl: projectVideoMediaUrl("Videos", material.relativePath), durationMs: 60000 });
    const original = restarted.materials.resolveVideoFile("Videos", material.relativePath);
    expect(fs.readFileSync(original, "utf8")).toBe("synthetic-dQw4w9WgXcQ");
    const renamed = restarted.renameProjectMaterial("Videos", material.relativePath, "Renamed");
    expect(restarted.materials.resolveVideoFile("Videos", renamed.relativePath)).toBe(original);
    restarted.createProject({ name: "Destination" });
    const moved = restarted.moveProjectMaterial("Videos", renamed.relativePath, "Destination");
    expect(fs.existsSync(original)).toBe(false);
    expect(restarted.readProjectMaterial("Destination", moved.relativePath).video?.localMediaUrl).toBe(projectVideoMediaUrl("Destination", moved.relativePath));
    const movedOriginal = restarted.materials.resolveVideoFile("Destination", moved.relativePath);
    restarted.renameProject("Destination", "Final");
    expect(restarted.readProjectMaterial("Final", moved.relativePath).video?.localMediaUrl).toBe(projectVideoMediaUrl("Final", moved.relativePath));
    const finalOriginal = restarted.materials.resolveVideoFile("Final", moved.relativePath);
    expect(fs.existsSync(movedOriginal)).toBe(false);
    restarted.removeProjectMaterial("Final", moved.relativePath);
    expect(fs.existsSync(finalOriginal)).toBe(false);
  });

  it("records failed downloads as retryable without creating a ready embed-only material", async () => {
    const { service, download } = fixture();
    download.mockRejectedValueOnce(Object.assign(new Error("Choose a browser"), { code: "youtube-browser-required" }));
    await expect(service.addProjectUrl("Videos", url)).rejects.toMatchObject({ code: "youtube-browser-required" });
    const [failed] = service.listProjectMaterials("Videos");
    expect(failed).toMatchObject({ status: "failed", originalRelativePath: null });
    expect((await service.retryMaterialExtraction("Videos", failed.relativePath)).status).toBe("ready");
    expect(service.readProjectMaterial("Videos", failed.relativePath).video?.localMediaUrl).toBeTruthy();
  });

  it("can upgrade an old embed-only video even when it already has captions", async () => {
    const { service, options, contentRoot, download } = fixture();
    const converter = options.materialConverters[1];
    const convert = vi.spyOn(converter, "convert").mockResolvedValueOnce({ content: videoDescriptorToMarkdown({
      provider: "youtube", videoId: "dQw4w9WgXcQ", sourceUrl: url, title: "Legacy", transcript: [{ startMs: 0, endMs: 1000, text: "Old captions" }], transcriptSource: "platform", warnings: []
    }), title: "Legacy" });
    const legacy = await service.addProjectUrl("Videos", url);
    convert.mockRestore();
    download.mockRejectedValueOnce(new Error("Fixture offline"));
    await expect(service.retryMaterialExtraction("Videos", legacy.relativePath)).rejects.toThrow("Fixture offline");
    expect(service.readProjectMaterial("Videos", legacy.relativePath).content).toContain("Old captions");
    const restarted = new ProjectService(contentRoot, options);
    const ready = await restarted.retryMaterialExtraction("Videos", legacy.relativePath);
    expect(ready.originalRelativePath).toBeTruthy();
    expect(restarted.readProjectMaterial("Videos", ready.relativePath).content).toContain("A complete sentence.");
  });

  it("cleans downloads and copied originals if writing the material fails", async () => {
    const { service, cleanup, temporary } = fixture();
    const rename = fs.renameSync;
    vi.spyOn(fs, "renameSync").mockImplementation((from, to) => {
      if (String(to).endsWith(".video.md")) throw new Error("Fixture disk failure");
      rename(from, to);
    });
    await expect(service.addProjectUrl("Videos", url)).rejects.toThrow("Fixture disk failure");
    expect(cleanup).toHaveBeenCalledOnce();
    expect(fs.readdirSync(temporary)).toEqual([]);
    expect(fs.readdirSync(path.join(service.resolveProjectRoot("Videos"), "materials/originals"))).toEqual([]);
    expect(service.materials.hasActiveConversions("Videos")).toBe(false);
  });

  it("keeps concurrent imports isolated, even with identical URL stems and titles", async () => {
    const { service } = fixture();
    const [first, second] = await Promise.all([
      service.addProjectUrl("Videos", "https://www.youtube.com/watch?v=dQw4w9WgXcQ"),
      service.addProjectUrl("Videos", "https://www.youtube.com/watch?v=abcdefghijk")
    ]);
    expect(first.relativePath).not.toBe(second.relativePath);
    expect(first.originalRelativePath).not.toBe(second.originalRelativePath);
    expect(fs.readFileSync(service.materials.resolveVideoFile("Videos", first.relativePath), "utf8")).toBe("synthetic-dQw4w9WgXcQ");
    expect(fs.readFileSync(service.materials.resolveVideoFile("Videos", second.relativePath), "utf8")).toBe("synthetic-abcdefghijk");
  });

  it("never serves paths outside the material index or replaced symlink originals", async () => {
    const { service, base } = fixture();
    const material = await service.addProjectUrl("Videos", url);
    expect(() => service.materials.resolveVideoFile("Videos", "../../private.mp4")).toThrow();
    const original = service.materials.resolveVideoFile("Videos", material.relativePath);
    fs.unlinkSync(original);
    const outside = path.join(base, "private.mp4");
    fs.writeFileSync(outside, "not a project video");
    fs.symlinkSync(outside, original);
    expect(() => service.materials.resolveVideoFile("Videos", material.relativePath)).toThrow();
  });
});
