import { describe, expect, it } from "vitest";
import {
  convertVideoUrlToMarkdown,
  extractYoutubeVideoId,
  parseVideoMarkdown,
  videoDescriptorToMarkdown,
  type ProjectVideoDescriptor
} from "./video-converter";

describe("Project video materials", () => {
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
