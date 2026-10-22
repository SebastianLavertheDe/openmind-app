export type BilibiliVideoReference = { videoId: string; page: number };
const VIDEO_ID = /^(?:BV[1-9A-HJ-NP-Za-km-z]{10}|av[1-9]\d{0,15})$/;
const validPage = (value: string) => /^[1-9]\d{0,5}$/.test(value);

export function parseBilibiliVideoUrl(value: string): BilibiliVideoReference | null {
  try {
    const url = new URL(value);
    if (!["https:", "http:"].includes(url.protocol) || url.username || url.password || url.port
      || !["www.bilibili.com", "bilibili.com", "m.bilibili.com"].includes(url.hostname)) return null;
    const videoId = url.pathname.match(/^\/video\/([^/]+)\/?$/)?.[1];
    const pages = url.searchParams.getAll("p");
    const page = pages[0] ?? "1";
    return videoId && VIDEO_ID.test(videoId) && pages.length <= 1 && validPage(page) ? { videoId, page: Number(page) } : null;
  } catch { return null; }
}

export function isBilibiliShortUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) && url.hostname === "b23.tv" && !url.port && !url.username && !url.password
      && /^\/[A-Za-z0-9]{1,32}\/?$/.test(url.pathname);
  } catch { return false; }
}

export function isBilibiliVideoUrl(value: string): boolean { return Boolean(parseBilibiliVideoUrl(value) || isBilibiliShortUrl(value)); }

export function bilibiliVideoUrl(reference: BilibiliVideoReference): string {
  return `https://www.bilibili.com/video/${reference.videoId}?p=${reference.page}`;
}

export function bilibiliEmbedUrl(reference: BilibiliVideoReference, startMs?: number): string {
  if (!VIDEO_ID.test(reference.videoId) || !validPage(String(reference.page))) throw new Error("Invalid Bilibili reference");
  const query = new URLSearchParams(reference.videoId.startsWith("av") ? { aid: reference.videoId.slice(2) } : { bvid: reference.videoId });
  query.set("p", String(reference.page));
  query.set("autoplay", startMs === undefined ? "0" : "1");
  query.set("danmaku", "0");
  if (startMs !== undefined) {
    if (!Number.isFinite(startMs) || startMs < 0) throw new Error("Invalid Bilibili timestamp");
    query.set("t", String(startMs / 1000));
  }
  return `https://player.bilibili.com/player.html?${query}`;
}

/** Persisted embeds allow only our canonical options, not arbitrary player URLs. */
export function parseTrustedBilibiliEmbed(value: string, videoId?: string): BilibiliVideoReference | null {
  try {
    const url = new URL(value);
    if (url.origin !== "https://player.bilibili.com" || url.username || url.password || url.hash || url.pathname !== "/player.html") return null;
    const id = url.searchParams.get("bvid") ?? (url.searchParams.has("aid") ? `av${url.searchParams.get("aid")}` : "");
    const reference = { videoId: id, page: Number(url.searchParams.get("p")) };
    if (videoId && videoId !== id) return null;
    const expected = new URL(bilibiliEmbedUrl(reference));
    return [...url.searchParams].length === 4 && [...expected.searchParams].every(([key, value]) => url.searchParams.getAll(key).length === 1 && url.searchParams.get(key) === value) ? reference : null;
  } catch { return null; }
}
