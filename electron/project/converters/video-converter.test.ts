import { describe, expect, it, vi } from "vitest";
import { bilibiliDescriptor } from "./bilibili-subtitles";
import {
  convertVideoUrlToMarkdown,
  extractYoutubeVideoId,
  parseVideoMarkdown,
  videoDescriptorToMarkdown,
  type ProjectVideoDescriptor
} from "./video-converter";

describe("Project video materials", () => {
  it("round-trips the selected Bilibili part and subtitles without creating a media download", async () => {
    const video = { ...bilibiliDescriptor({ videoId: "BV1xx411c7mD", page: 3 }),
      title: "Bilibili fixture", transcript: [{ startMs: 1250, endMs: 5000, text: "完整的一句话。" }], transcriptSource: "platform" as const };
    const read = vi.fn().mockResolvedValue(video);
    const download = vi.fn();
    const result = await convertVideoUrlToMarkdown(video.sourceUrl, { bilibiliSubtitles: { read }, youtubeDownloader: { download }, preferredLanguage: "zh-CN" });
    expect(read).toHaveBeenCalledWith(video.sourceUrl, "zh-CN");
    expect(download).not.toHaveBeenCalled();
    expect(result.download).toBeUndefined();
    expect(parseVideoMarkdown(result.markdown)).toMatchObject(video);
    expect(parseVideoMarkdown(result.markdown.replace("- Video ID：BV1xx411c7mD", "- Video ID：BV1xx411c7mE"))?.embedUrl).toBeUndefined();
    expect(parseVideoMarkdown(result.markdown.replace("www.bilibili.com", "evil.test"))?.embedUrl).toBeUndefined();
  });

  it("retains the Bilibili player when a subtitle reader is unavailable", async () => {
    const result = await convertVideoUrlToMarkdown("https://www.bilibili.com/video/av170001?p=2");
    expect(result.video).toMatchObject({ provider: "bilibili", videoId: "av170001", transcript: [], transcriptSource: "none" });
    expect(result.video.embedUrl).toContain("aid=170001&p=2");
    expect(parseVideoMarkdown(result.markdown)?.warnings).toHaveLength(1);
    expect(result.download).toBeUndefined();
  });

  it("requires the configured downloader and never falls back to anonymous YouTube fetching", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Network forbidden"));
    try {
      await expect(convertVideoUrlToMarkdown("https://youtu.be/dQw4w9WgXcQ")).rejects.toMatchObject({ code: "youtube-browser-required" });
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally { fetchSpy.mockRestore(); }
  });

  it("normalizes the URL before downloading and returns the temporary video for adoption", async () => {
    const cleanup = vi.fn();
    const download = vi.fn().mockResolvedValue({
      video: { provider: "youtube", videoId: "dQw4w9WgXcQ", sourceUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ", title: "Fixture", mediaType: "mp4", durationMs: 90_000, transcript: [], transcriptSource: "none", warnings: [] },
      mediaPath: "/fixture/video.mp4", cleanup
    });
    const result = await convertVideoUrlToMarkdown("https://youtu.be/dQw4w9WgXcQ?list=ignored&t=5", { youtubeDownloader: { download }, preferredLanguage: "en" });
    expect(download).toHaveBeenCalledWith("dQw4w9WgXcQ", "en");
    expect(result.download?.mediaPath).toBe("/fixture/video.mp4");
    expect(result.video.embedUrl).toBeUndefined();
    expect(parseVideoMarkdown(result.markdown)?.durationMs).toBe(90_000);
    expect(cleanup).not.toHaveBeenCalled();
  });

  it.each([
    "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    "https://youtu.be/dQw4w9WgXcQ?t=4",
    "https://www.youtube.com/embed/dQw4w9WgXcQ",
    "https://www.youtube.com/shorts/dQw4w9WgXcQ"
  ])("normalizes supported YouTube URLs", (url) => {
    expect(extractYoutubeVideoId(url)).toBe("dQw4w9WgXcQ");
  });

  it("round-trips video metadata and timestamped transcript through Markdown", () => {
    const descriptor: ProjectVideoDescriptor = {
      provider: "youtube",
      sourceUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      embedUrl: "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ",
      videoId: "dQw4w9WgXcQ",
      title: "Keynote",
      durationMs: 25_000,
      thumbnailUrl: "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg",
      transcript: [{ startMs: 7_000, endMs: 18_000, text: "A useful excerpt" }],
      transcriptSource: "platform",
      warnings: []
    };
    const parsed = parseVideoMarkdown(videoDescriptorToMarkdown(descriptor));
    expect(parsed).toMatchObject({
      provider: "youtube",
      videoId: "dQw4w9WgXcQ",
      transcriptSource: "platform",
      transcript: [{ startMs: 7_000, endMs: 18_000, text: "A useful excerpt" }]
    });
  });

  it("accepts public HTTPS MP4 without downloading the video", async () => {
    const result = await convertVideoUrlToMarkdown("https://media.example.com/demo.mp4", {
      resolver: async () => [{ address: "93.184.216.34", family: 4 }]
    });
    expect(result.video).toMatchObject({ provider: "direct", mediaType: "mp4", transcriptSource: "none" });
    expect(result.markdown).toContain("- URL：https://media.example.com/demo.mp4");
  });
});
