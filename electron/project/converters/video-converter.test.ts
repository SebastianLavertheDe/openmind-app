import { describe, expect, it, vi } from "vitest";
import {
  convertVideoUrlToMarkdown,
  extractYoutubeVideoId,
  parseVideoMarkdown,
  videoDescriptorToMarkdown,
  type ProjectVideoDescriptor
} from "./video-converter";

describe("Project video materials", () => {
  it("uses the supplied browser transport for metadata, player information and captions", async () => {
    const youtubeFetch = vi.fn<typeof fetch>(async (input) => {
      const url = new URL(String(input));
      if (url.pathname === "/oembed") return Response.json({ title: "Fixture video" });
      if (url.pathname === "/youtubei/v1/player") return Response.json({ captions: { playerCaptionsTracklistRenderer: { captionTracks: [
        { baseUrl: "https://www.youtube.com/api/timedtext?v=dQw4w9WgXcQ", languageCode: "en" }
      ] } } });
      if (url.pathname === "/api/timedtext") return new Response('<timedtext><body><p t="7000" d="11000"><s>Fixture caption</s></p></body></timedtext>');
      throw new Error("Unexpected URL");
    });
    const result = await convertVideoUrlToMarkdown("https://youtu.be/dQw4w9WgXcQ", { youtubeFetch });
    expect(result.video).toMatchObject({ title: "Fixture video", transcriptSource: "platform", transcript: [{ startMs: 7000, endMs: 18000, text: "Fixture caption" }], warnings: [] });
    expect(youtubeFetch).toHaveBeenCalledTimes(3);
  });

  it("preserves sign-in failures through saved Markdown instead of reporting that captions do not exist", async () => {
    const youtubeFetch = vi.fn<typeof fetch>(async (input) => {
      const url = new URL(String(input));
      if (url.pathname === "/oembed") return Response.json({ title: "Fixture video" });
      if (url.pathname === "/watch") return new Response('var ytInitialPlayerResponse = {"playabilityStatus":{"status":"LOGIN_REQUIRED"}};');
      return Response.json({ playabilityStatus: { status: "LOGIN_REQUIRED" } });
    });
    const result = await convertVideoUrlToMarkdown("https://youtu.be/dQw4w9WgXcQ", { youtubeFetch });
    expect(result.video.transcript).toEqual([]);
    expect(result.video.warnings[0]).toContain("登录或人机验证");
    expect(parseVideoMarkdown(result.markdown)?.warnings).toEqual(result.video.warnings);
  });

  it("does not follow a provider redirect to an untrusted host", async () => {
    const youtubeFetch = vi.fn<typeof fetch>(async () => new Response(null, { status: 302, headers: { Location: "https://internal.example/private" } }));
    const result = await convertVideoUrlToMarkdown("https://youtu.be/dQw4w9WgXcQ", { youtubeFetch });
    expect(result.video.transcript).toEqual([]);
    expect(youtubeFetch.mock.calls.every(([input]) => new URL(String(input)).hostname === "www.youtube.com")).toBe(true);
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
