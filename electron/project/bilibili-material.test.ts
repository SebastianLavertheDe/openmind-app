// @vitest-environment node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProjectService } from "./project-service";
import { createDefaultProjectMaterialConverters } from "./converters/project-material-converters";
import { BilibiliSubtitleImporter, type BilibiliCommandRunner } from "./converters/bilibili-subtitles";

const roots: string[] = [];
afterEach(() => { vi.restoreAllMocks(); for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });
const url = "https://www.bilibili.com/video/BV1xx411c7mD?p=2";

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bilibili-material-unit-")); roots.push(root);
  const contentRoot = path.join(root, "content"); fs.mkdirSync(contentRoot);
  const tempRoot = path.join(root, "app-state/tmp");
  const run = vi.fn<BilibiliCommandRunner>(async (_command, args, { cwd }) => {
    expect(args).toContain("--skip-download");
    fs.writeFileSync(path.join(cwd, "captions.zh-Hans.srt"), "1\n00:00:01,000 --> 00:00:02,000\n这是一份\n\n2\n00:00:02,000 --> 00:00:03,000\n测试字幕。");
    return { stdout: JSON.stringify({ id: "BV1xx411c7mD_p2", title: "Subtitle fixture", duration: 20 }) };
  });
  const reader = new BilibiliSubtitleImporter({ tempRoot, getYtDlp: async () => "/fixture/yt-dlp", run });
  const download = vi.fn().mockRejectedValue(new Error("Video downloads forbidden"));
  const options = { stateRoot: path.join(root, "app-state"), materialConverters: createDefaultProjectMaterialConverters({ video: { bilibiliSubtitles: reader, youtubeDownloader: { download } } }) };
  const service = new ProjectService(contentRoot, options); service.createProject({ name: "Videos" });
  return { contentRoot, tempRoot, run, download, options, service };
}

describe("Bilibili material lifecycle with synthetic subtitle files", () => {
  it("persists a video material with stitched captions and an iframe, but no downloaded original", async () => {
    const f = fixture();
    const material = await f.service.addProjectUrl("Videos", url);
    expect(material).toMatchObject({ kind: "video", status: "ready", originalRelativePath: null });
    expect(material.relativePath).toMatch(/\.video\.md$/);
    const restarted = new ProjectService(f.contentRoot, f.options);
    const read = restarted.readProjectMaterial("Videos", material.relativePath);
    expect(read.content).toContain("[00:01.000–00:03.000] 这是一份测试字幕。");
    expect(read.video).toMatchObject({ provider: "bilibili", sourceUrl: url, localMediaUrl: null, transcriptSource: "platform" });
    expect(read.video?.embedUrl).toContain("bvid=BV1xx411c7mD&p=2");
    expect(() => restarted.materials.resolveVideoFile("Videos", material.relativePath)).toThrow("Video unavailable");
    expect(fs.readdirSync(path.join(restarted.resolveProjectRoot("Videos"), "materials/originals"))).toEqual([]);
    expect(fs.readdirSync(f.tempRoot)).toEqual([]);
    expect(f.download).not.toHaveBeenCalled();
    const renamed = restarted.renameProjectMaterial("Videos", material.relativePath, "Renamed");
    restarted.createProject({ name: "Destination" });
    const moved = restarted.moveProjectMaterial("Videos", renamed.relativePath, "Destination");
    expect(restarted.readProjectMaterial("Destination", moved.relativePath).video).toEqual(read.video);
    restarted.removeProjectMaterial("Destination", moved.relativePath);
    expect(restarted.listProjectMaterials("Destination")).toEqual([]);
  });

  it("retains playback on subtitle failure and retries only subtitles", async () => {
    const f = fixture();
    f.run.mockRejectedValueOnce({ stderr: "Subtitles require login" });
    const material = await f.service.addProjectUrl("Videos", url);
    expect(material.status).toBe("ready");
    expect(f.service.readProjectMaterial("Videos", material.relativePath).video).toMatchObject({ transcript: [], localMediaUrl: null });
    const ready = await f.service.retryMaterialExtraction("Videos", material.relativePath);
    expect(ready.originalRelativePath).toBeNull();
    expect(f.service.readProjectMaterial("Videos", material.relativePath).video?.transcript).toHaveLength(1);
    expect(f.run).toHaveBeenCalledTimes(2);
    for (const [, args] of f.run.mock.calls) {
      expect(args).toEqual(expect.arrayContaining(["--skip-download", "--no-cookies", "--no-cookies-from-browser", "--ignore-config"]));
      expect(args).not.toContain("--cookies");
      expect(args).not.toContain("--cookies-from-browser");
    }
    expect(f.download).not.toHaveBeenCalled();
    // An already complete Bilibili material never enters YouTube's download-upgrade path.
    await f.service.retryMaterialExtraction("Videos", material.relativePath);
    expect(f.run).toHaveBeenCalledTimes(2);
    expect(f.service.readProjectMaterial("Videos", material.relativePath).content).toContain("这是一份测试字幕。");
  });
});
