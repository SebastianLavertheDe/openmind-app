import { describe, expect, it } from "vitest";
import { replyMediaCandidates } from "./reply-media";

describe("reply media outputs", () => {
  it("finds linked, Windows, absolute and written media, and deduplicates bare names", () => {
    const text = "[成品](<assets/成品 1.mp4>)\n`成品 1.mp4`\n```\nD:\\work\\素材\\音乐.wav\n/assets/picture.png\n```\n视频位于 D:\\work\\素材\\片子.mp4。";
    expect(replyMediaCandidates(text, ["assets/other.webm", "assets/note.json", "assets/成品 1.mp4"]))
      .toEqual(["assets/成品 1.mp4", "D:\\work\\素材\\音乐.wav", "/assets/picture.png", "D:\\work\\素材\\片子.mp4", "assets/other.webm"]);
  });
  it("ignores remote, data, non-media and malformed references", () => {
    expect(replyMediaCandidates("[remote](https://example.com/a.mp4)\nhttps://example.com/b.png\n`data:image/png;base64,x`\n`report.md`\n`javascript:clip.mp4`" )).toEqual([]);
  });
  it("limits metadata lookups to a small batch", () => expect(replyMediaCandidates("", Array.from({ length: 100 }, (_, i) => `outputs/${i}.mp4`))).toHaveLength(12));
});
