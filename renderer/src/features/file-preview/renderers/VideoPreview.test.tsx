import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { VideoPreviewResource } from "../model";
import { trustedYoutubeEmbedUrl, VideoPreview } from "./VideoPreview";
import { projectVideoMediaUrl } from "@shared/youtube-import";
import { localMediaUrl } from "@shared/media-preview";
import { bilibiliEmbedUrl } from "@shared/bilibili-video";

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
  it("plays scoped workspace MP4 without an empty transcript panel", () => {
    const url = localMediaUrl({ path: "assets/final.mp4" });
    const view = render(<VideoPreview resource={{ ...resource(""), playback: { kind: "local-video", mediaUrl: url } }} />);
    const video = view.container.querySelector("video")!;
    expect(video.getAttribute("src")).toBe(url); expect(video.controls).toBe(true);
    expect(view.container.querySelector(".project-video-inspector-column")).toBeNull();
  });
  it("plays Bilibili in its trusted frame and seeks the selected part using timestamp URLs, including repeat clicks", () => {
    const videoId = "BV1xx411c7mD";
    const embedUrl = bilibiliEmbedUrl({ videoId, page: 2 });
    const video: VideoPreviewResource = { ...resource(embedUrl), playback: { kind: "trusted-bilibili", embedUrl, videoId },
      transcript: [{ id: "cue", startMs: 7250, endMs: 12000, text: "拼接字幕。" }] };
    const { container, rerender } = render(<VideoPreview resource={video} onOpenExternal={vi.fn()} onRetryTranscript={vi.fn()} />);
    const frame = screen.getByTitle("Video") as HTMLIFrameElement;
    const postMessage = vi.spyOn(frame.contentWindow!, "postMessage");
    expect(frame.src).toBe(embedUrl);
    expect(container.querySelector("video")).toBeNull();
    expect(screen.queryByRole("button", { name: "下载到本地播放" })).toBeNull();
    fireEvent.load(frame);
    expect(postMessage).not.toHaveBeenCalled();
    // Bilibili does not use YouTube's message protocol.
    act(() => window.dispatchEvent(new MessageEvent("message", { origin: "https://player.bilibili.com", source: frame.contentWindow,
      data: JSON.stringify({ event: "infoDelivery", info: { currentTime: 8 } }) })));
    expect(screen.getByText("拼接字幕。").closest(".project-transcript-row")?.classList.contains("active")).toBe(false);
    fireEvent.click(screen.getByText("拼接字幕。"));
    const seekFrame = screen.getByTitle("Video") as HTMLIFrameElement;
    expect(seekFrame).not.toBe(frame);
    expect(seekFrame.src).toBe(bilibiliEmbedUrl({ videoId, page: 2 }, 7250));
    expect(screen.getByText("拼接字幕。").closest(".project-transcript-row")?.classList.contains("active")).toBe(true);
    fireEvent.click(screen.getByText("00:07"));
    expect(screen.getByTitle("Video")).not.toBe(seekFrame);
    rerender(<VideoPreview resource={{ ...video, id: "another-material" }} />);
    expect((screen.getByTitle("Video") as HTMLIFrameElement).src).toBe(embedUrl);
    rerender(<VideoPreview resource={video} />);
    expect((screen.getByTitle("Video") as HTMLIFrameElement).src).toBe(embedUrl);
  });

  it("allows retrying missing Bilibili subtitles and opening the original without offering a video download", () => {
    const videoId = "BV1xx411c7mD";
    const embedUrl = bilibiliEmbedUrl({ videoId, page: 1 });
    const video: VideoPreviewResource = { ...resource(embedUrl), playback: { kind: "trusted-bilibili", embedUrl, videoId }, warnings: ["字幕需要登录"] };
    const retry = vi.fn(); const external = vi.fn();
    render(<VideoPreview resource={video} onRetryTranscript={retry} onOpenExternal={external} />);
    expect(screen.getByText("字幕需要登录")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "重新获取字幕" }));
    fireEvent.click(screen.getByRole("button", { name: "浏览器打开" }));
    expect(retry).toHaveBeenCalledOnce();
    expect(external).toHaveBeenCalledOnce();
    expect(screen.queryByRole("button", { name: "下载到本地播放" })).toBeNull();
    expect(screen.getByText(/Bilibili 视频通过内嵌播放器在线播放/).textContent).toContain("若无法播放，请在浏览器打开原视频");
  });

  it.each(["https://evil.test/player.html", "https://player.bilibili.com/player.html?bvid=BV1xx411c7mD&p=1&autoplay=0&danmaku=0&cid=123"])("does not render an untrusted Bilibili frame: %s", embedUrl => {
    const { container } = render(<VideoPreview resource={{ ...resource(embedUrl), playback: { kind: "trusted-bilibili", embedUrl, videoId: "BV1xx411c7mD" } }} />);
    expect(container.querySelector("iframe")).toBeNull();
  });

  it("plays a local video and seeks/highlights its stitched transcript without a YouTube frame", () => {
    const localUrl = projectVideoMediaUrl("Fixture", "materials/videos/test.video.md");
    const video: VideoPreviewResource = {
      ...resource("https://unused.invalid"), playback: { kind: "local-video", mediaUrl: localUrl },
      transcript: [{ id: "cue", startMs: 7000, endMs: 12000, text: "Stitched sentence." }]
    };
    const { container } = render(<VideoPreview resource={video} />);
    const player = screen.getByTitle("Video") as HTMLVideoElement;
    expect(player.tagName).toBe("VIDEO");
    expect(player.getAttribute("src")).toBe(localUrl);
    expect(player.controls).toBe(true);
    expect(container.querySelector("iframe")).toBeNull();
    fireEvent.click(screen.getByText("Stitched sentence."));
    fireEvent.loadedMetadata(player);
    expect(player.currentTime).toBe(7);
    player.currentTime = 8;
    fireEvent.timeUpdate(player);
    expect(screen.getByText("Stitched sentence.").closest(".project-transcript-row")?.classList.contains("active")).toBe(true);
    player.currentTime = 15;
    fireEvent.timeUpdate(player);
    expect(screen.getByText("Stitched sentence.").closest(".project-transcript-row")?.classList.contains("active")).toBe(false);
    fireEvent.error(player);
    expect(screen.getByRole("status").textContent).toContain("本地视频无法播放");
  });

  it.each([true, false])("seeks from the subtitle text, row and timestamp while preserving paused=%s", paused => {
    const video: VideoPreviewResource = {
      ...resource(""), playback: { kind: "local-video", mediaUrl: projectVideoMediaUrl("Fixture", "materials/videos/test.video.md") },
      transcript: [{ id: "cue", startMs: 7250, endMs: 12000, text: "Click this sentence." }]
    };
    render(<VideoPreview resource={video} />);
    const player = screen.getByTitle("Video") as HTMLVideoElement;
    Object.defineProperty(player, "readyState", { configurable: true, value: HTMLMediaElement.HAVE_METADATA });
    Object.defineProperty(player, "paused", { configurable: true, value: paused });
    const play = vi.spyOn(player, "play").mockResolvedValue();
    const pause = vi.spyOn(player, "pause").mockImplementation(() => {});
    const row = screen.getByRole("button", { name: "00:07 Click this sentence." });

    for (const target of [screen.getByText("Click this sentence."), row, screen.getByText("00:07")]) {
      player.currentTime = 0;
      fireEvent.timeUpdate(player);
      expect(row.getAttribute("aria-pressed")).toBe("false");
      fireEvent.click(target);
      expect(player.currentTime).toBe(7.25);
      expect(row.getAttribute("aria-pressed")).toBe("true");
      expect(player.paused).toBe(paused);
    }
    expect(play).not.toHaveBeenCalled();
    expect(pause).not.toHaveBeenCalled();
  });

  it("allows seeking to a subtitle with Enter and Space", async () => {
    const user = userEvent.setup();
    const video: VideoPreviewResource = {
      ...resource(""), playback: { kind: "local-video", mediaUrl: projectVideoMediaUrl("Fixture", "materials/videos/test.video.md") },
      transcript: [{ id: "cue", startMs: 7250, endMs: 12000, text: "Keyboard subtitle." }]
    };
    render(<VideoPreview resource={video} />);
    const player = screen.getByTitle("Video") as HTMLVideoElement;
    Object.defineProperty(player, "readyState", { configurable: true, value: HTMLMediaElement.HAVE_METADATA });
    const row = screen.getByRole("button", { name: "00:07 Keyboard subtitle." });
    row.focus();
    for (const key of ["{Enter}", " "]) {
      player.currentTime = 0;
      fireEvent.timeUpdate(player);
      await user.keyboard(key);
      expect(player.currentTime).toBe(7.25);
      expect(row.getAttribute("aria-pressed")).toBe("true");
    }
  });

  it("does not accept arbitrary file or remote URLs as local playback", () => {
    const video: VideoPreviewResource = { ...resource("https://unused.invalid"), playback: { kind: "local-video", mediaUrl: "file:///private/video.mp4" } };
    const { container } = render(<VideoPreview resource={video} />);
    expect(container.querySelector("video")).toBeNull();
  });

  it("offers browser playback for a YouTube embed and allows retrying missing captions", () => {
    const onOpenExternal = vi.fn();
    const onRetryTranscript = vi.fn();
    const video = resource("https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?enablejsapi=1");
    video.warnings = ["YouTube 要求登录或人机验证"];
    const { container, rerender } = render(<VideoPreview resource={video} onOpenExternal={onOpenExternal} onRetryTranscript={onRetryTranscript} />);
    expect(container.querySelector(".has-no-transcript")).toBeTruthy();
    expect(screen.getByText("YouTube 要求登录或人机验证")).toBeTruthy();
    expect(screen.queryByText("暂无字幕")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "浏览器打开" }));
    fireEvent.click(screen.getByRole("button", { name: "重新获取字幕" }));
    expect(onOpenExternal).toHaveBeenCalledOnce();
    expect(onRetryTranscript).toHaveBeenCalledOnce();
    rerender(<VideoPreview resource={video} onRetryTranscript={onRetryTranscript} retryingTranscript />);
    expect((screen.getByRole("button", { name: "正在获取字幕…" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("reports player errors only from its owned YouTube frame", () => {
    const video = resource("https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?enablejsapi=1");
    render(<VideoPreview resource={video} onOpenExternal={() => {}} />);
    const frame = screen.getByTitle("Video") as HTMLIFrameElement;
    const report = (origin: string) => act(() => window.dispatchEvent(new MessageEvent("message", { origin, source: frame.contentWindow, data: JSON.stringify({ event: "onError", info: 150 }) })));
    report("https://evil.example.com");
    expect(screen.queryByText("当前视频无法在内嵌播放器中播放，请在浏览器打开原视频。")).toBeNull();
    report("https://www.youtube-nocookie.com");
    expect(screen.getByText("当前视频无法在内嵌播放器中播放，请在浏览器打开原视频。")).toBeTruthy();
  });

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
    fireEvent.click(screen.getByText("字幕内容"));
    expect(postMessage).toHaveBeenCalledWith(
      JSON.stringify({ event: "command", func: "seekTo", args: [7, true] }),
      "https://www.youtube-nocookie.com"
    );
  });
});
