import { describe, expect, it } from "vitest";
import { OPENMIND_YOUTUBE_REFERRER, youtubeEmbedRequestHeaders } from "./youtube-embed-request";

describe("YouTube embed request identity", () => {
  it("adds the desktop app identity to trusted YouTube embed frames", () => {
    expect(youtubeEmbedRequestHeaders({
      url: "https://www.youtube-nocookie.com/embed/Uny6Lpmjral?enablejsapi=1",
      resourceType: "subFrame",
      requestHeaders: { Accept: "text/html", referer: "file:///renderer/index.html" }
    })).toEqual({ Accept: "text/html", Referer: OPENMIND_YOUTUBE_REFERRER });
  });

  it("does not modify non-frame or non-YouTube requests", () => {
    const headers = { Accept: "text/html" };
    expect(youtubeEmbedRequestHeaders({
      url: "https://www.youtube-nocookie.com/embed/Uny6Lpmjral",
      resourceType: "xhr",
      requestHeaders: headers
    })).toBe(headers);
    expect(youtubeEmbedRequestHeaders({
      url: "https://example.com/embed/Uny6Lpmjral",
      resourceType: "subFrame",
      requestHeaders: headers
    })).toBe(headers);
  });
});
