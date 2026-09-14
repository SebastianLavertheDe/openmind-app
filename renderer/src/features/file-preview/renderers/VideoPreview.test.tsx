import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { VideoPreviewResource } from "../model";
import { trustedYoutubeEmbedUrl, VideoPreview } from "./VideoPreview";

function resource(embedUrl: string, videoId = "dQw4w9WgXcQ"): VideoPreviewResource {
  return {
    kind: "video",
    id: "video",
    path: "materials/videos/video.video.md",
    title: "Video",
    playback: { kind: "trusted-youtube", embedUrl, videoId },
    transcript: []
  };
}

describe("trustedYoutubeEmbedUrl", () => {
  it("accepts only the canonical privacy-enhanced YouTube embed", () => {
    expect(trustedYoutubeEmbedUrl(resource("https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?enablejsapi=1")))
      .toBe("https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?enablejsapi=1");
  });

  it.each([
    "http://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?enablejsapi=1",
    "https://youtube.com/embed/dQw4w9WgXcQ?enablejsapi=1",
    "https://www.youtube-nocookie.com/embed/aaaaaaaaaaa?enablejsapi=1",
    "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ",
    "https://www.youtube-nocookie.com:444/embed/dQw4w9WgXcQ?enablejsapi=1",
    "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?enablejsapi=1&autoplay=1",
    "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?enablejsapi=1&enablejsapi=1",
    "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?enablejsapi=1#fragment"
  ])("rejects an untrusted embed URL: %s", (url) => {
    expect(trustedYoutubeEmbedUrl(resource(url))).toBeUndefined();
  });
});

describe("VideoPreview", () => {
  it("keeps direct media external-only", () => {
    const onOpenExternal = vi.fn();
    render(<VideoPreview resource={{
      ...resource("https://unused.invalid"),
      playback: { kind: "external-only", sourceUrl: "https://media.example.com/video.mp4" }
    }} onOpenExternal={onOpenExternal} />);

    expect(screen.queryByTitle("Video")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "浏览器打开" }));
    expect(onOpenExternal).toHaveBeenCalledOnce();
  });

  it("seeks and highlights transcript cues only for messages from the owned frame", () => {
    const video = resource("https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?enablejsapi=1");
    video.transcript = [{ id: "cue", startMs: 7_000, endMs: 12_000, text: "字幕内容" }];
    render(<VideoPreview resource={video} />);
    const frame = screen.getByTitle("Video") as HTMLIFrameElement;
    const cue = screen.getByText("字幕内容").closest(".project-transcript-row")!;
    const postMessage = vi.spyOn(frame.contentWindow!, "postMessage");

    act(() => window.dispatchEvent(new MessageEvent("message", {
      origin: "https://evil.example.com",
      source: frame.contentWindow,
      data: JSON.stringify({ event: "infoDelivery", info: { currentTime: 8 } })
    })));
    expect(cue.classList.contains("active")).toBe(false);

    act(() => window.dispatchEvent(new MessageEvent("message", {
      origin: "https://www.youtube-nocookie.com",
      source: frame.contentWindow,
      data: JSON.stringify({ event: "infoDelivery", info: { currentTime: 8 } })
    })));
    expect(cue.classList.contains("active")).toBe(true);

    postMessage.mockClear();
    fireEvent.click(screen.getByRole("button", { name: "00:07" }));
    expect(postMessage).toHaveBeenCalledWith(
      JSON.stringify({ event: "command", func: "seekTo", args: [7, true] }),
      "https://www.youtube-nocookie.com"
    );
  });
});
