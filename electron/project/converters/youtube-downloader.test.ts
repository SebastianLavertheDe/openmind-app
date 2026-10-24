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
  let browser: unknown = ["chrome"];
  const metadata = { id: "dQw4w9WgXcQ", title: "A fixture video", duration: 120, language: "en", subtitles: { en: [{}], fr: [{}] }, automatic_captions: { en: [{}] } };
  const run = vi.fn<YoutubeCommandRunner>(async (_executable, args, options) => {
    if (args.includes("--print")) {
      const { subtitles, automatic_captions, ...details } = metadata;
      return { stdout: JSON.stringify({ metadata: details, subtitleLanguages: Object.keys(subtitles).join(", "), automaticCaptionLanguages: Object.keys(automatic_captions).join(", ") }) };
    }
    if (args.includes("--write-subs")) fs.writeFileSync(path.join(options.cwd, "captions.en.json3"), JSON.stringify({ events: [
      { tStartMs: 0, dDurationMs: 1000, segs: [{ utf8: "Hello" }] },
      { tStartMs: 1000, dDurationMs: 1000, segs: [{ utf8: "world." }] }
    ] }));
    else fs.writeFileSync(path.join(options.cwd, "video.mp4"), "synthetic-video-bytes");
    return { stdout: "" };
  });
  const downloader = new BrowserYoutubeDownloader({ tempRoot: root, getBrowser: () => browser, detector, run });
  return { root, run, downloader, metadata, installed, select: (value: unknown) => { browser = value; } };
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

  it.each([
    { value: [] }, { value: ["chrome", "invalid"] }, { value: ["chrome:/private/profile"] }
  ])("rejects an empty or invalid browser list before any subprocess: $value", async ({ value }) => {
    const fixture = setup();
    fixture.select(value);
    await expect(fixture.downloader.download("dQw4w9WgXcQ")).rejects.toMatchObject({ code: "youtube-browser-required" });
    expect(fixture.run).not.toHaveBeenCalled();
  });

  it.each(["--print", "--format", "--write-subs"])("tries the next selected browser after an authentication error during %s", async stage => {
    const fixture = setup();
    fixture.select(["chrome", "firefox"]);
    const successfulRun = fixture.run.getMockImplementation()!;
    fixture.run.mockImplementation(async (executable, args, options) => {
      if (args.includes(stage) && args[args.indexOf("--cookies-from-browser") + 1] === "chrome") throw { stderr: "Sign in to confirm you are not a bot" };
      return successfulRun(executable, args, options);
    });
    const result = await fixture.downloader.download("dQw4w9WgXcQ");
    expect(result.video.warnings).toEqual([]);
    expect(result.video.transcript).toHaveLength(1);
    const failedIndex = fixture.run.mock.calls.findIndex(([, args]) => args.includes(stage));
    const attempted = fixture.run.mock.calls.map(([, args]) => args[args.indexOf("--cookies-from-browser") + 1]);
    expect(attempted.slice(0, failedIndex + 1).every(browser => browser === "chrome")).toBe(true);
    expect(attempted.slice(failedIndex + 1).every(browser => browser === "firefox")).toBe(true);
    expect(fixture.run.mock.calls[failedIndex + 1][1]).toContain(stage);
    result.cleanup();
    expect(fs.readdirSync(fixture.root)).toEqual([]);
  });

  it("skips unavailable choices and tries available browsers only in the saved order", async () => {
    const fixture = setup();
    fixture.select(["edge", "firefox", "chrome"]);
    fixture.run.mockRejectedValueOnce({ stderr: "Could not decrypt cookies /private/profile TOKEN" });
    const result = await fixture.downloader.download("dQw4w9WgXcQ");
    expect(fixture.run.mock.calls.map(([, args]) => args[args.indexOf("--cookies-from-browser") + 1])).toEqual(["firefox", "chrome", "chrome", "chrome"]);
    result.cleanup();
  });

  it("sanitizes the last authentication error and cleans up when every selected browser fails", async () => {
    const fixture = setup();
    fixture.select(["chrome", "firefox"]);
    fixture.run.mockRejectedValue({ stderr: "Could not decrypt cookies /private/profile TOKEN" });
    const error = await fixture.downloader.download("dQw4w9WgXcQ").catch(value => value);
    expect(error).toMatchObject({ code: "youtube-cookies" });
    expect(error.message).not.toMatch(/TOKEN|private/);
    expect(fixture.run).toHaveBeenCalledTimes(2);
    expect(fs.readdirSync(fixture.root)).toEqual([]);
  });

  it("reads only caption language keys when complete metadata exceeds the output buffer", async () => {
    const fixture = setup();
    Object.assign(fixture.metadata.automatic_captions.en[0], { url: "x".repeat(9 * 1024 * 1024) });
    const successfulRun = fixture.run.getMockImplementation()!;
    fixture.run.mockImplementation(async (executable, args, options) => {
      if (args.includes("--dump-single-json") && Buffer.byteLength(JSON.stringify(fixture.metadata)) > options.maxBuffer) {
        throw { code: "ERR_CHILD_PROCESS_STDIO_MAXBUFFER" };
      }
      return successfulRun(executable, args, options);
    });
    const result = await fixture.downloader.download("dQw4w9WgXcQ");
    const args = fixture.run.mock.calls[0][1];
    expect(args).not.toContain("--dump-single-json");
    expect(args[args.indexOf("--print") + 1]).toContain("%(automatic_captions|)l");
    expect(result.video.transcript).toHaveLength(1);
    result.cleanup();
  });

  it("preserves the download failure if Windows cannot remove its temporary directory", async () => {
    const fixture = setup();
    fixture.run.mockRejectedValueOnce({ stderr: "Sign in to confirm you are not a bot" });
    const remove = vi.spyOn(fs, "rmSync").mockImplementation(() => { throw Object.assign(new Error("Private path"), { code: "EPERM" }); });
    await expect(fixture.downloader.download("dQw4w9WgXcQ")).rejects.toMatchObject({ code: "youtube-login" });
    expect(remove).toHaveBeenCalledWith(expect.stringContaining("youtube-"), expect.objectContaining({ maxRetries: 5 }));
    remove.mockRestore();
  });

  it("does not invalidate a successful download if temporary cleanup fails", async () => {
    const fixture = setup();
    const result = await fixture.downloader.download("dQw4w9WgXcQ");
    const remove = vi.spyOn(fs, "rmSync").mockImplementation(() => { throw Object.assign(new Error("Private path"), { code: "EPERM" }); });
    expect(() => result.cleanup()).not.toThrow();
    remove.mockRestore();
  });

  it("does not mistake command arguments for a cookie error", async () => {
    const fixture = setup();
    fixture.select(["chrome", "firefox"]);
    fixture.run.mockRejectedValue({ message: "Command failed: yt-dlp --cookies-from-browser chrome", stderr: "HTTP Error 403 TOKEN" });
    await expect(fixture.downloader.download("dQw4w9WgXcQ")).rejects.toMatchObject({ code: "youtube-download-failed" });
    expect(fixture.run).toHaveBeenCalledOnce();
  });

  it("does not switch browsers for a timeout unrelated to browser sign-in", async () => {
    const fixture = setup();
    fixture.select(["chrome", "firefox"]);
    fixture.run.mockRejectedValue({ killed: true });
    await expect(fixture.downloader.download("dQw4w9WgXcQ")).rejects.toMatchObject({ code: "youtube-timeout" });
    expect(fixture.run).toHaveBeenCalledOnce();
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
    fixture.run.mockResolvedValueOnce({ stdout: JSON.stringify({ metadata: fixture.metadata }) }).mockResolvedValueOnce({ stdout: "" });
    await expect(fixture.downloader.download("dQw4w9WgXcQ")).rejects.toMatchObject({ code: "youtube-invalid-output" });
    expect(fs.readdirSync(fixture.root)).toEqual([]);
  });
});
