import { describe, expect, it } from "vitest";
import { bilibiliEmbedUrl, bilibiliVideoUrl, isBilibiliShortUrl, parseBilibiliVideoUrl, parseTrustedBilibiliEmbed } from "./bilibili-video";

const reference = { videoId: "BV1xx411c7mD", page: 2 };

describe("Bilibili video references", () => {
  it("keeps the selected part while stripping tracking and share parameters", () => {
    const parsed = parseBilibiliVideoUrl("https://m.bilibili.com/video/BV1xx411c7mD/?p=2&share_source=copy#reply");
    expect(parsed).toEqual(reference);
    expect(bilibiliVideoUrl(parsed!)).toBe("https://www.bilibili.com/video/BV1xx411c7mD?p=2");
    expect(parseBilibiliVideoUrl("https://bilibili.com/video/av170001")).toEqual({ videoId: "av170001", page: 1 });
  });

  it.each([
    "https://www.bilibili.com.evil.test/video/BV1xx411c7mD",
    "https://user:secret@www.bilibili.com/video/BV1xx411c7mD",
    "https://www.bilibili.com:444/video/BV1xx411c7mD",
    "file:///video/BV1xx411c7mD",
    "https://www.bilibili.com/video/--exec=unsafe",
    "https://www.bilibili.com/video/BV1xx411c7mD?p=0",
    "https://www.bilibili.com/video/BV1xx411c7mD?p=-1",
    "https://www.bilibili.com/video/BV1xx411c7mD?p=1.5",
    "https://www.bilibili.com/video/BV1xx411c7mD?p=1&p=2"
  ])("rejects malformed or untrusted video URLs: %s", url => {
    expect(parseBilibiliVideoUrl(url)).toBeNull();
  });

  it("recognizes short URLs only on the exact Bilibili share host", () => {
    expect(isBilibiliShortUrl("https://b23.tv/Ab12CD?share_source=copy")).toBe(true);
    for (const url of ["https://b23.tv.evil.test/Ab12CD", "https://b23.tv/a/b", "https://user@b23.tv/Ab12CD", "https://b23.tv:444/Ab12CD", "https://b23.tv/"]) {
      expect(isBilibiliShortUrl(url)).toBe(false);
    }
  });

  it("builds trusted BV and AV frames without autoplay and supports timestamp seeks", () => {
    const embed = bilibiliEmbedUrl(reference);
    expect(parseTrustedBilibiliEmbed(embed, reference.videoId)).toEqual(reference);
    expect(new URL(embed).searchParams.get("autoplay")).toBe("0");
    const seek = new URL(bilibiliEmbedUrl(reference, 7250));
    expect(Object.fromEntries(seek.searchParams)).toEqual({ bvid: reference.videoId, p: "2", autoplay: "1", danmaku: "0", t: "7.25" });
    const av = { videoId: "av170001", page: 1 };
    expect(parseTrustedBilibiliEmbed(bilibiliEmbedUrl(av), av.videoId)).toEqual(av);
    expect(new URL(bilibiliEmbedUrl(av)).searchParams.get("aid")).toBe("170001");
  });

  it("refuses injected frame options, mismatched IDs and noncanonical player origins", () => {
    const embed = bilibiliEmbedUrl(reference);
    const invalid = [embed + "&cid=123", embed + "&t=7", embed + "&bvid=BV1xx411c7mD", embed + "#fragment",
      embed.replace("autoplay=0", "autoplay=1"), embed.replace("https:", "http:"),
      embed.replace("player.bilibili.com", "player.bilibili.com.evil.test"), embed.replace("/player.html", "/other.html")];
    for (const url of invalid) expect(parseTrustedBilibiliEmbed(url)).toBeNull();
    expect(parseTrustedBilibiliEmbed(embed, "BV1xx411c7mE")).toBeNull();
    for (const timestamp of [-1, NaN, Infinity]) expect(() => bilibiliEmbedUrl(reference, timestamp)).toThrow();
  });
});
