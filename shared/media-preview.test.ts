import { describe, expect, it } from "vitest";
import { localMediaUrl, mediaKind, mediaMimeType, parseLocalMediaUrl } from "./media-preview";

describe("local media references", () => {
  it.each([["clip.MP4", "video", "video/mp4"], ["sound.m4a", "audio", "audio/mp4"], ["图.png", "image", "image/png"], ["mp4", null, null], ["data.json", null, null]])("classifies %s", (path, kind, mime) => {
    expect(mediaKind(path!)).toBe(kind); expect(mediaMimeType(path!)).toBe(mime);
  });
  it("round trips Windows and project paths without losing spaces or unicode", () => {
    for (const input of [{ path: "D:\\资料\\成品 #1.mp4" }, { path: "outputs/音频 1.wav", projectName: "项目 一" }]) expect(parseLocalMediaUrl(localMediaUrl(input))).toEqual(input);
  });
  it.each(["file:///tmp/video.mp4", "https://local/media?path=a.mp4", "openmind-media://evil/media?path=a.mp4", "openmind-media://local/else?path=a.mp4", "openmind-media://user@local/media?path=a.mp4", "openmind-media://local:123/media?path=a.mp4", "openmind-media://local/media?path=a.mp4#x", "openmind-media://local/media?path=a.mp4&path=b.mp4", "openmind-media://local/media?path=a.mp4&extra=x", "openmind-media://local/media?path=a.txt", "openmind-media://local/media?path=a.mp4&projectName="])("rejects %s", value => expect(parseLocalMediaUrl(value)).toBeNull());
});
