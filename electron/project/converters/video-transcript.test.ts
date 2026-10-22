import { describe, expect, it } from "vitest";
import { parseVideoSubtitles, stitchVideoTranscript } from "./video-transcript";

describe("video transcript stitching", () => {
  it("stitches Bilibili SRT phrases and rolling Chinese captions while preserving pauses and sentence boundaries", () => {
    const srt = "\uFEFF1\r\n00:00:00,000 --> 00:00:02,000\r\n<b>今天，</b>\r\n\r\n2\r\n00:00:01,000 --> 00:00:03,000\r\n今天，我们\r\n\r\n3\r\n00:00:03,000 --> 00:00:04,000\r\n讨论字幕。\r\n\r\n4\r\n00:00:04,000 --> 00:00:05,000\r\n下一句\r\n\r\n5\r\n00:00:08,000 --> 00:00:09,000\r\n下一句";
    expect(parseVideoSubtitles(srt, "srt")).toEqual([
      { startMs: 0, endMs: 4000, text: "今天，我们讨论字幕。" },
      { startMs: 4000, endMs: 5000, text: "下一句" },
      { startMs: 8000, endMs: 9000, text: "下一句" }
    ]);
    expect(parseVideoSubtitles("1\n00:00:02,000 --> 00:00:01,000\nInvalid\n\n2\nbad timestamp\nInvalid", "srt")).toEqual([]);
  });

  it("removes rolling overlap, decodes entities and groups phrases without losing timestamps", () => {
    const vtt = `WEBVTT

00:00:00.000 --> 00:00:02.500 align:start
<c>Hello &amp; welcome</c>

00:00:01.500 --> 00:00:04.000
Hello &amp; welcome to this talk.

00:00:04.000 --> 00:00:06.000
Our next topic.
`;
    expect(parseVideoSubtitles(vtt, "vtt")).toEqual([
      { startMs: 0, endMs: 4000, text: "Hello & welcome to this talk." },
      { startMs: 4000, endMs: 6000, text: "Our next topic." }
    ]);
  });

  it("joins Chinese captions without inserted word spaces and keeps meaningful pauses", () => {
    expect(parseVideoSubtitles(JSON.stringify({ events: [
      { tStartMs: 0, dDurationMs: 1500, segs: [{ utf8: "今天" }] },
      { tStartMs: 1000, dDurationMs: 2000, segs: [{ utf8: "今天我们" }] },
      { tStartMs: 3000, dDurationMs: 1000, segs: [{ utf8: "讨论字幕。" }] },
      { tStartMs: 7000, dDurationMs: 1000, segs: [{ utf8: "下一段" }] }
    ] }), "json3")).toEqual([
      { startMs: 0, endMs: 4000, text: "今天我们讨论字幕。" },
      { startMs: 7000, endMs: 8000, text: "下一段" }
    ]);
  });

  it("preserves intentional repeated words and repeated sentences at later timestamps", () => {
    expect(stitchVideoTranscript([
      { startMs: 0, endMs: 1000, text: "very very good." },
      { startMs: 1000, endMs: 2000, text: "very very good." },
      { startMs: 6000, endMs: 7000, text: "very very good." }
    ])).toHaveLength(3);
  });

  it("deduplicates identical overlapping cues, sorts, and discards malformed entries", () => {
    expect(stitchVideoTranscript([
      { startMs: 500, endMs: 1500, text: "same" },
      { startMs: 0, endMs: 1000, text: "same" },
      { startMs: NaN, endMs: 3000, text: "bad" },
      { startMs: -1, endMs: 20, text: "bad" },
      { startMs: 5000, endMs: 4000, text: "bad" },
      { startMs: 2000, endMs: 3000, text: "\n" }
    ])).toEqual([{ startMs: 0, endMs: 1500, text: "same" }]);
  });

  it("bounds paragraph size and duration even without punctuation", () => {
    const cues = Array.from({ length: 50 }, (_, index) => ({ startMs: index * 2000, endMs: (index + 1) * 2000, text: `phrase number ${index}` }));
    const result = stitchVideoTranscript(cues);
    expect(result.length).toBeGreaterThan(3);
    expect(result.every(cue => cue.text.length <= 240 && cue.endMs - cue.startMs <= 30_000)).toBe(true);
    expect(result.map(cue => cue.text).join(" ")).toBe(cues.map(cue => cue.text).join(" "));
  });

  it("supports hour timestamps and ignores VTT notes and inline karaoke tags", () => {
    expect(parseVideoSubtitles("WEBVTT\n\nNOTE ignored\n00:00:00.000 --> 00:00:01.000\nnot spoken\n\n1\n01:02:03.000 --> 01:02:04.000\n<v Speaker><00:00:00.500>Text &#39;quoted&#39;</v>", "vtt"))
      .toEqual([{ startMs: 3723000, endMs: 3724000, text: "Text 'quoted'" }]);
  });
});
