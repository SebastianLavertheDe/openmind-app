import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BrowserYoutubeDownloader, type YoutubeCommandRunner } from "./youtube-downloader";
import { createYoutubeHostDetector } from "../youtube-browser";

const fixtures: string[] = [];
afterEach(() => { vi.restoreAllMocks(); for (const directory of fixtures.splice(0)) fs.rmSync(directory, { recursive: true, force: true }); });

function setup() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "youtube-download-unit-"));
  fixtures.push(root);
  const installed = new Set(["/tools/yt-dlp", "/tools/ffmpeg", "/tools/node", "/tools/google-chrome", "/tools/firefox"]);
  const detector = createYoutubeHostDetector({ platform: "linux", home: "/fixture", env: { PATH: "/tools" }, isExecutable: file => installed.has(file) });
  let browser = "chrome";
  const metadata = { id: "dQw4w9WgXcQ", title: "A fixture video", duration: 120, language: "en", subtitles: { en: [{}], fr: [{}] }, automatic_captions: { en: [{}] } };
  const run = vi.fn<YoutubeCommandRunner>(async (_executable, args, options) => {
    if (args.includes("--dump-single-json")) return { stdout: JSON.stringify(metadata) };
    if (args.includes("--write-subs")) fs.writeFileSync(path.join(options.cwd, "captions.en.json3"), JSON.stringify({ events: [
      { tStartMs: 0, dDurationMs: 1000, segs: [{ utf8: "Hello" }] },
      { tStartMs: 1000, dDurationMs: 1000, segs: [{ utf8: "world." }] }
    ] }));
    else fs.writeFileSync(path.join(options.cwd, "video.mp4"), "synthetic-video-bytes");
    return { stdout: "" };
  });
  const downloader = new BrowserYoutubeDownloader({ tempRoot: root, getBrowser: () => browser, detector, run });
  return { root, run, downloader, metadata, installed, select: (value: string) => { browser = value; } };
}

describe("browser-authenticated YouTube download (mocked commands only)", () => {
  it("uses the managed tool resolver and does not fall back to an unsupported system runtime", async () => {
    const f = setup();
    const detector = createYoutubeHostDetector({ platform: "linux", home: "/fixture", env: { PATH: "/tools" }, isExecutable: file => f.installed.has(file) });
    const resolveTools = vi.fn().mockResolvedValue({ "yt-dlp": "/app/yt-dlp", ffmpeg: "/app/ffmpeg", node: "/app/node" });
    f.installed.add("/tools/deno");
    const downloader = new BrowserYoutubeDownloader({ tempRoot: f.root, getBrowser: () => "chrome", detector, resolveTools, run: f.run });
    (await downloader.download("dQw4w9WgXcQ")).cleanup();
    expect(f.run.mock.calls[0][0]).toBe("/app/yt-dlp");
    expect(f.run.mock.calls[0][1]).toEqual(expect.arrayContaining(["node:/app/node", "/app/ffmpeg"]));
    expect(f.run.mock.calls[0][1].join(" ")).not.toContain("/tools/deno");
    resolveTools.mockResolvedValue({ "yt-dlp": "/app/yt-dlp", ffmpeg: "/app/ffmpeg" });
    await expect(downloader.download("dQw4w9WgXcQ")).rejects.toMatchObject({ code: "youtube-tools-missing" });
    expect(f.run).toHaveBeenCalledTimes(3);
  });
  it("uses the chosen browser for metadata, video and captions, and leaves only the caller-owned download", async () => {
    const { root, downloader, run } = setup();
    const network = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Network forbidden in unit tests"));
    const result = await downloader.download("dQw4w9WgXcQ", "en");
    expect(result.video).toMatchObject({ title: "A fixture video", durationMs: 120000, mediaType: "mp4", transcript: [{ startMs: 0, endMs: 2000, text: "Hello world." }], warnings: [] });
    expect(result.video.embedUrl).toBeUndefined();
    expect(fs.readFileSync(result.mediaPath, "utf8")).toBe("synthetic-video-bytes");
    expect(run).toHaveBeenCalledTimes(3);
    for (const [executable, args, options] of run.mock.calls) {
      expect(executable).toBe("/tools/yt-dlp");
      expect(args.slice(args.indexOf("--cookies-from-browser"), args.indexOf("--cookies-from-browser") + 2)).toEqual(["--cookies-from-browser", "chrome"]);
      expect(args).toContain("--ignore-config");
      expect(args).toContain("--no-cache-dir");
      expect(args).toContain("--no-plugin-dirs");
      expect(args).not.toContain("--cookies");
      expect(args.slice(-2)).toEqual(["--", "https://www.youtube.com/watch?v=dQw4w9WgXcQ"]);
      expect(options.cwd.startsWith(root + path.sep)).toBe(true);
    }
    expect(network).not.toHaveBeenCalled();
    result.cleanup();
    expect(fs.readdirSync(root)).toEqual([]);
  });

  it.each(["", "chrome; echo unsafe", "chrome:/private/profile"])("rejects a missing or invalid preference before any subprocess: %s", async browser => {
    const fixture = setup();
    fixture.select(browser);
    await expect(fixture.downloader.download("dQw4w9WgXcQ")).rejects.toMatchObject({ code: "youtube-browser-required" });
    expect(fixture.run).not.toHaveBeenCalled();
    expect(fs.readdirSync(fixture.root)).toEqual([]);
  });

  it("rejects invalid IDs before running commands", async () => {
    const { downloader, run } = setup();
    await expect(downloader.download("--exec=unsafe")).rejects.toMatchObject({ code: "youtube-invalid-video" });
    expect(run).not.toHaveBeenCalled();
  });

  it("rechecks preferences and installed browsers on each import", async () => {
    const fixture = setup();
    (await fixture.downloader.download("dQw4w9WgXcQ")).cleanup();
    fixture.select("firefox");
    (await fixture.downloader.download("dQw4w9WgXcQ")).cleanup();
    expect(fixture.run.mock.calls[3][1]).toContain("firefox");
    fixture.installed.delete("/tools/firefox");
    await expect(fixture.downloader.download("dQw4w9WgXcQ")).rejects.toMatchObject({ code: "youtube-browser-missing" });
    expect(fixture.run).toHaveBeenCalledTimes(6);
  });

  it("reports missing dependencies before creating a download", async () => {
    const fixture = setup();
    fixture.installed.delete("/tools/ffmpeg");
    await expect(fixture.downloader.download("dQw4w9WgXcQ")).rejects.toMatchObject({ code: "youtube-tools-missing" });
    expect(fixture.run).not.toHaveBeenCalled();
  });

  it.each([
    [{ stderr: "Could not decrypt cookies at /private/profile TOKEN", code: "1" }, "youtube-cookies"],
    [{ stderr: "Sign in to confirm you are not a bot TOKEN" }, "youtube-login"],
    [{ killed: true, stderr: "private URL TOKEN" }, "youtube-timeout"],
    [{ stderr: "HTTP Error 403 TOKEN" }, "youtube-download-failed"]
  ])("sanitizes failures and clears partial files", async (error, code) => {
    const fixture = setup();
    fixture.run.mockImplementationOnce(async (_command, _args, options) => {
      fs.writeFileSync(path.join(options.cwd, "video.mp4.part"), "partial");
      throw error;
    });
    const failure = await fixture.downloader.download("dQw4w9WgXcQ").catch(value => value);
    expect(failure.code).toBe(code);
    expect(failure.message).not.toContain("TOKEN");
    expect(failure.message).not.toContain("/private/profile");
    expect(fs.readdirSync(fixture.root)).toEqual([]);
  });

  it("keeps the local video when subtitle extraction fails", async () => {
    const fixture = setup();
    const successfulRun = fixture.run.getMockImplementation()!;
    fixture.run.mockImplementation(async (executable, args, options) => {
      if (args.includes("--write-subs")) throw new Error("Captions HTTP 429");
      return successfulRun(executable, args, options);
    });
    const result = await fixture.downloader.download("dQw4w9WgXcQ");
    expect(fs.existsSync(result.mediaPath)).toBe(true);
    expect(result.video.transcript).toEqual([]);
    expect(result.video.warnings).toHaveLength(1);
    result.cleanup();
  });

  it("uses original-language automatic captions when manual captions are unavailable", async () => {
    const fixture = setup();
    fixture.metadata.subtitles = {} as typeof fixture.metadata.subtitles;
    const result = await fixture.downloader.download("dQw4w9WgXcQ", "zh-CN");
    expect(fixture.run.mock.calls[2][1]).toEqual(expect.arrayContaining(["--write-auto-subs", "--sub-langs", "en"]));
    expect(result.video.transcript).toHaveLength(1);
    result.cleanup();
  });

  it("retains a playable video with an explicit warning when no captions exist", async () => {
    const fixture = setup();
    fixture.metadata.subtitles = {} as typeof fixture.metadata.subtitles;
    fixture.metadata.automatic_captions = {} as typeof fixture.metadata.automatic_captions;
    const result = await fixture.downloader.download("dQw4w9WgXcQ");
    expect(fixture.run).toHaveBeenCalledTimes(2);
    expect(result.video.warnings[0]).toContain("未提供可用字幕");
    result.cleanup();
  });

  it("rejects malformed metadata and missing output and cleans the temporary directory", async () => {
    const fixture = setup();
    fixture.run.mockResolvedValueOnce({ stdout: "not json" });
    await expect(fixture.downloader.download("dQw4w9WgXcQ")).rejects.toMatchObject({ code: "youtube-invalid-output" });
    fixture.run.mockResolvedValueOnce({ stdout: JSON.stringify(fixture.metadata) }).mockResolvedValueOnce({ stdout: "" });
    await expect(fixture.downloader.download("dQw4w9WgXcQ")).rejects.toMatchObject({ code: "youtube-invalid-output" });
    expect(fs.readdirSync(fixture.root)).toEqual([]);
  });
});
