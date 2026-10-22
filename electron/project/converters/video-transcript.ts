import type { VideoTranscriptCue } from "./video-converter";

function cleanCaption(value: string): string {
  const entities: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", lrm: "", rlm: "" };
  return value.replace(/<[^>]*>/g, "").replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (match, entity: string) => {
    if (!entity.startsWith("#")) return entities[entity] ?? match;
    const code = entity[1]?.toLowerCase() === "x" ? parseInt(entity.slice(2), 16) : Number(entity.slice(1));
    return code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff) ? String.fromCodePoint(code) : "";
  }).replace(/[\u0000-\u001f\u007f\u200b-\u200f]/g, " ").replace(/\s+/g, " ").trim();
}

function timestamp(value: string): number {
  return value.replace(",", ".").split(":").reduce((seconds, part) => seconds * 60 + Number(part), 0) * 1000;
}

export function parseVideoSubtitles(content: string, format: "json3" | "vtt" | "srt"): VideoTranscriptCue[] {
  let cues: VideoTranscriptCue[];
  if (format === "json3") {
    const value = JSON.parse(content) as { events?: Array<{ tStartMs?: number; dDurationMs?: number; segs?: Array<{ utf8?: string }> }> };
    if (!Array.isArray(value.events)) throw new Error("Invalid JSON3 captions");
    cues = value.events.flatMap(event => {
      if (typeof event.tStartMs !== "number" || typeof event.dDurationMs !== "number" || !Array.isArray(event.segs)) return [];
      return [{ startMs: event.tStartMs, endMs: event.tStartMs + event.dDurationMs,
        text: event.segs.map(segment => typeof segment.utf8 === "string" ? segment.utf8 : "").join("") }];
    });
  } else {
    cues = content.replaceAll("\r", "").split(/\n\s*\n/).flatMap(block => {
      const lines = block.trim().split("\n");
      if (/^(NOTE|STYLE|REGION)(\s|$)/.test(lines[0])) return [];
      const index = lines.findIndex(line => line.includes("-->"));
      const match = lines[index]?.match(/^((?:\d+:)?\d{2}:\d{2}[.,]\d{3})\s+-->\s+((?:\d+:)?\d{2}:\d{2}[.,]\d{3})(?:\s|$)/);
      return match ? [{ startMs: timestamp(match[1]), endMs: timestamp(match[2]), text: lines.slice(index + 1).join(" ") }] : [];
    });
  }
  return stitchVideoTranscript(cues);
}

const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;
function joinText(left: string, right: string): string {
  const noSpace = /^[,.;:!?，。！？、；：]/u.test(right)
    || ((CJK.test(left.slice(-1)) || /[，、；：「『（]$/.test(left)) && CJK.test(right[0] || ""));
  return `${left}${noSpace ? "" : " "}${right}`;
}

function removeRollingPrefix(previous: string, current: string): string {
  const tokens = (value: string) => [...value.matchAll(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]|[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*|[^\s]/gu)];
  const left = tokens(previous);
  const right = tokens(current);
  for (let count = Math.min(left.length, right.length); count > 0; count--) {
    // A shared single word alone is often an intentional repetition.
    if (count === 1 && left.length > 1) continue;
    if (left.slice(-count).every((token, index) => token[0] === right[index][0])) {
      const last = right[count - 1];
      return current.slice(last.index! + last[0].length).trim();
    }
  }
  return current;
}

/** Remove overlapping rolling captions, then group phrases with bounded length and timing. */
export function stitchVideoTranscript(input: readonly VideoTranscriptCue[]): VideoTranscriptCue[] {
  const sorted = input.filter(cue => Number.isFinite(cue.startMs) && Number.isFinite(cue.endMs) && cue.startMs >= 0 && cue.endMs > cue.startMs)
    .map(cue => ({ startMs: Math.round(cue.startMs), endMs: Math.round(cue.endMs), text: cleanCaption(cue.text) }))
    .filter(cue => cue.text).sort((a, b) => a.startMs - b.startMs);
  const unique: VideoTranscriptCue[] = [];
  let previous: VideoTranscriptCue | undefined;
  for (const cue of sorted) {
    const text = previous && cue.startMs < previous.endMs ? removeRollingPrefix(previous.text, cue.text) : cue.text;
    if (text) unique.push({ ...cue, text });
    else if (unique.length) unique[unique.length - 1].endMs = Math.max(unique[unique.length - 1].endMs, cue.endMs);
    previous = cue;
  }
  const result: VideoTranscriptCue[] = [];
  for (const cue of unique) {
    const last = result.at(-1);
    if (last && cue.startMs - last.endMs <= 1000 && cue.endMs - last.startMs <= 30_000
      && last.text.length + cue.text.length + 1 <= 240 && !/[.!?。！？]["'”’）)]?$/.test(last.text)) {
      last.text = joinText(last.text, cue.text);
      last.endMs = Math.max(last.endMs, cue.endMs);
    } else result.push({ ...cue });
  }
  return result;
}
