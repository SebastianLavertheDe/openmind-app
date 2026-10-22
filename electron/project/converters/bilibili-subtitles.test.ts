// @vitest-environment node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { messages } from "../../../shared/messages";
import { BilibiliSubtitleImporter, resolveBilibiliShortUrl, type BilibiliCommandRunner } from "./bilibili-subtitles";
import { safeHttpGet } from "./safe-http";

vi.mock("./safe-http", () => ({ safeHttpGet: vi.fn() }));
const roots: string[] = [];
const videoId = "BV1xx411c7mD";
const url = `https://www.bilibili.com/video/${videoId}?p=2`;
const srt = "1\n00:00:01,000 --> 00:00:02,000\n今天，\n\n2\n00:00:02,000 --> 00:00:04,000\n讨论字幕。";
beforeEach(() => {
  vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Live network forbidden"));
  vi.mocked(safeHttpGet).mockReset().mockRejectedValue(new Error("Live HTTP forbidden"));
});
afterEach(() => { vi.restoreAllMocks(); for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bilibili-subtitles-unit-"));
  roots.push(root);
  const metadata: { id: string; title: string; duration: number; _type?: string; is_live?: boolean } = { id: `${videoId}_p2`, title: "Fixture part two", duration: 90 };
  const captions: Record<string, string> = { "zh-Hans": srt, en: "1\n00:00:00,000 --> 00:00:01,000\nEnglish captions." };
  const getYtDlp = vi.fn<() => Promise<string | undefined>>().mockResolvedValue("/fixture/tools/yt-dlp");
  const resolveShortUrl = vi.fn().mockResolvedValue({ videoId, page: 2 });
  const run = vi.fn<BilibiliCommandRunner>(async (_executable, _args, { cwd }) => {
    for (const [language, content] of Object.entries(captions)) fs.writeFileSync(path.join(cwd, `captions.${language}.srt`), content);
    return { stdout: JSON.stringify(metadata) };
  });
  const options = { tempRoot: root, getYtDlp, resolveShortUrl, run };
  const importer = new BilibiliSubtitleImporter(options);
  return { root, metadata, captions, getYtDlp, resolveShortUrl, run, importer, options };
}

describe("Bilibili subtitle-only import with mocked commands", () => {
  it("fetches subtitles without media or browser cookies, stitches one language, and removes temporary files", async () => {
    const f = fixture();
    const video = await f.importer.read(url + "&share_source=copy");
    expect(video).toMatchObject({ provider: "bilibili", videoId, sourceUrl: url, title: "Fixture part two", durationMs: 90_000,
      transcript: [{ startMs: 1000, endMs: 4000, text: "今天，讨论字幕。" }], transcriptSource: "platform", warnings: [] });
    expect(new URL(video.embedUrl!).searchParams.get("p")).toBe("2");
    expect(video.mediaType).toBeUndefined();
    expect(f.run).toHaveBeenCalledOnce();
    const [executable, args, options] = f.run.mock.calls[0];
    expect(executable).toBe("/fixture/tools/yt-dlp");
    expect(args).toEqual(expect.arrayContaining(["--skip-download", "--no-check-formats", "--write-subs", "--ignore-config", "--no-plugin-dirs", "--no-playlist", "--no-js-runtimes", "--no-cookies", "--no-cookies-from-browser"]));
    expect(args.slice(-2)).toEqual(["--", url]);
    expect(args).not.toContain("--cookies-from-browser");
    expect(args).not.toContain("--cookies");
    expect(args).not.toContain("--ffmpeg-location");
    expect(options.cwd.startsWith(f.root + path.sep)).toBe(true);
    expect(fetch).not.toHaveBeenCalled();
    expect(safeHttpGet).not.toHaveBeenCalled();
    expect(fs.readdirSync(f.root)).toEqual([]);
  });

  it("honors language preference without mixing translations or importing danmaku as subtitles", async () => {
    const f = fixture();
    f.captions["ai-zh"] = srt.replace("今天，", "自动字幕");
    f.captions.danmaku = srt.replace("今天，", "弹幕");
    expect((await f.importer.read(url, "en-US")).transcript[0].text).toBe("English captions.");
    expect((await f.importer.read(url, "zh-CN")).transcript[0].text).toBe("今天，讨论字幕。");
    delete f.captions.en; delete f.captions["zh-Hans"];
    expect((await f.importer.read(url)).transcript[0].text).toBe("自动字幕讨论字幕。");
    delete f.captions["ai-zh"];
    expect(await f.importer.read(url)).toMatchObject({ transcript: [], warnings: [messages.desktopErrors.bilibili.noCaptions] });
  });

  it.each(["chrome", "firefox", "chrome:/private/profile"])("ignores legacy browser options and stays anonymous even when a browser was selected: %s", async browser => {
    const f = fixture();
    const getBrowser = vi.fn(() => browser);
    const browsers = vi.fn(() => { throw new Error("Browser access forbidden"); });
    const legacyOptions = { ...f.options, getBrowser, detector: { browsers } };
    const importer = new BilibiliSubtitleImporter(legacyOptions);
    expect(await importer.read(url)).toMatchObject({ transcriptSource: "platform", warnings: [] });
    const args = f.run.mock.calls[0][1];
    expect(args).toEqual(expect.arrayContaining(["--ignore-config", "--no-cookies", "--no-cookies-from-browser"]));
    expect(args).not.toContain("--cookies-from-browser");
    expect(args).not.toContain("--cookies");
    expect(args).not.toContain(browser);
    expect(getBrowser).not.toHaveBeenCalled();
    expect(browsers).not.toHaveBeenCalled();
  });

  it("keeps a usable embed when yt-dlp is missing and never asks for FFmpeg or a JS runtime", async () => {
    const f = fixture(); f.getYtDlp.mockResolvedValue(undefined);
    const video = await f.importer.read(url);
    expect(video).toMatchObject({ sourceUrl: url, warnings: [messages.desktopErrors.bilibili.toolsMissing], transcript: [] });
    expect(video.embedUrl).toContain("player.bilibili.com");
    expect(f.run).not.toHaveBeenCalled();
    expect(fs.readdirSync(f.root)).toEqual([]);
  });

  it("resolves a short URL to its selected part before running the restricted extractor", async () => {
    const f = fixture();
    const video = await f.importer.read("https://b23.tv/Ab12CD");
    expect(f.resolveShortUrl).toHaveBeenCalledWith("https://b23.tv/Ab12CD");
    expect(f.run.mock.calls[0][1].at(-1)).toBe(url);
    expect(video.sourceUrl).toBe(url);
    f.getYtDlp.mockResolvedValue(undefined);
    expect((await f.importer.read("https://b23.tv/Ab12CD")).embedUrl).toBe(video.embedUrl);
    f.resolveShortUrl.mockRejectedValue(new Error("private network detail"));
    await expect(f.importer.read("https://b23.tv/Ab12CD")).rejects.toThrow(messages.desktopErrors.bilibili.shortUrlFailed);
  });

  it("normalizes AV references to the extractor's BV identifier while retaining the selected part", async () => {
    const f = fixture();
    expect(await f.importer.read("https://www.bilibili.com/video/av170001?p=2")).toMatchObject({ videoId, sourceUrl: url });
  });

  it("rejects unsupported URLs without running any process or resolving short links", async () => {
    const f = fixture();
    await expect(f.importer.read("https://evil.test/video/BV1xx411c7mD")).rejects.toThrow(messages.desktopErrors.bilibili.invalidUrl);
    expect(f.run).not.toHaveBeenCalled();
    expect(f.getYtDlp).not.toHaveBeenCalled();
    expect(f.resolveShortUrl).not.toHaveBeenCalled();
  });

  it("reports login-only subtitles while retaining the player and metadata", async () => {
    const f = fixture();
    f.run.mockResolvedValue({ stdout: JSON.stringify(f.metadata), stderr: "Subtitles are only available when logged in. TOKEN" });
    expect(await f.importer.read(url)).toMatchObject({ title: "Fixture part two", transcriptSource: "none", warnings: [messages.desktopErrors.bilibili.loginRequired] });
    expect(f.run).toHaveBeenCalledOnce();
    expect(messages.desktopErrors.bilibili.loginRequired).toContain("仅支持匿名获取");
  });

  it.each([
    [{ stderr: "Unexpected cookie error /private/profile TOKEN" }, "captionsFailed"],
    [{ stderr: "Subtitles require login TOKEN" }, "loginRequired"],
    [{ killed: true, stderr: "TOKEN" }, "timeout"],
    [{ stderr: "HTTP Error 403 TOKEN" }, "captionsFailed"]
  ] as const)("keeps the embed after a command failure, sanitizes diagnostics and removes partial files", async (error, key) => {
    const f = fixture();
    f.run.mockImplementation(async (_command, _args, { cwd }) => {
      fs.writeFileSync(path.join(cwd, "captions.zh.srt.part"), "partial");
      throw error;
    });
    const video = await f.importer.read(url);
    expect(video).toMatchObject({ sourceUrl: url, transcript: [], warnings: [messages.desktopErrors.bilibili[key]] });
    expect(video.embedUrl).toContain("player.bilibili.com");
    expect(JSON.stringify(video)).not.toMatch(/TOKEN|private\/profile/);
    expect(fs.readdirSync(f.root)).toEqual([]);
  });

  it.each([
    { id: "BV1xx411c7mE_p2" }, { id: `${videoId}_p1` }, { id: `${videoId}_p2`, _type: "playlist" }, { id: `${videoId}_p2`, is_live: true }
  ])("rejects captions for another video/part, playlists and live streams", async metadata => {
    const f = fixture(); Object.assign(f.metadata, metadata);
    expect(await f.importer.read(url)).toMatchObject({ videoId, sourceUrl: url, transcript: [], warnings: [messages.desktopErrors.bilibili.captionsFailed] });
    expect(fs.readdirSync(f.root)).toEqual([]);
  });

  it.each(["invalid", "symlink", "oversized"])("does not import %s subtitle output", async kind => {
    const f = fixture();
    f.run.mockImplementation(async (_command, _args, { cwd }) => {
      const file = path.join(cwd, "captions.zh.srt");
      if (kind === "symlink") {
        const outside = path.join(f.root, "unrelated.srt"); fs.writeFileSync(outside, srt); fs.symlinkSync(outside, file);
      } else {
        fs.writeFileSync(file, "not subtitles");
        if (kind === "oversized") fs.truncateSync(file, 10 * 1024 * 1024 + 1);
      }
      return { stdout: JSON.stringify(f.metadata) };
    });
    expect(await f.importer.read(url)).toMatchObject({ transcript: [], warnings: [messages.desktopErrors.bilibili.captionsFailed] });
    expect(fs.readdirSync(f.root).filter(name => name.startsWith("captions-"))).toEqual([]);
  });
});

describe("Bilibili short URL resolution with mocked HTTP", () => {
  it("uses HEAD and allows only Bilibili video/share URLs at every redirect", async () => {
    vi.mocked(safeHttpGet).mockResolvedValue({ finalUrl: url, statusCode: 200, headers: {}, body: Buffer.alloc(0) });
    expect(await resolveBilibiliShortUrl("https://b23.tv/Ab12CD")).toEqual({ videoId, page: 2 });
    const options = vi.mocked(safeHttpGet).mock.calls[0][1]!;
    expect(options.method).toBe("HEAD");
    expect(() => options.validateUrl!(new URL(url))).not.toThrow();
    expect(() => options.validateUrl!(new URL("https://b23.tv/Ab12CD"))).not.toThrow();
    for (const address of ["http://127.0.0.1/video/BV1xx411c7mD", "https://evil.test/", "https://www.bilibili.com/bangumi/play/ep1"]) {
      expect(() => options.validateUrl!(new URL(address))).toThrow();
    }
  });

  it("rejects unresolved shares and invalid initial URLs", async () => {
    vi.mocked(safeHttpGet).mockResolvedValue({ finalUrl: "https://b23.tv/Ab12CD", statusCode: 200, headers: {}, body: Buffer.alloc(0) });
    await expect(resolveBilibiliShortUrl("https://b23.tv/Ab12CD")).rejects.toThrow(messages.desktopErrors.bilibili.shortUrlFailed);
    vi.mocked(safeHttpGet).mockClear();
    await expect(resolveBilibiliShortUrl("https://evil.test/Ab12CD")).rejects.toThrow(messages.desktopErrors.bilibili.invalidUrl);
    expect(safeHttpGet).not.toHaveBeenCalled();
  });
});
