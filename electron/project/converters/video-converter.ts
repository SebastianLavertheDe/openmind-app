import path from "node:path";
import { YoutubeTranscript, type TranscriptResponse } from "youtube-transcript";
import { parsePublicHttpUrl, resolvePublicUrl, type AddressResolver } from "./public-url";
import { safeHttpGet } from "./safe-http";

export type VideoProvider = "youtube" | "direct";
export type DirectVideoType = "mp4" | "webm" | "hls";

export type VideoTranscriptCue = {
  startMs: number;
  endMs: number;
  text: string;
};

export type ProjectVideoDescriptor = {
  provider: VideoProvider;
  sourceUrl: string;
  embedUrl?: string;
  videoId?: string;
  mediaType?: DirectVideoType;
  title: string;
  durationMs?: number;
  thumbnailUrl?: string;
  transcript: VideoTranscriptCue[];
  transcriptSource: "platform" | "local" | "none";
  warnings: string[];
};

export type LocalVideoTranscriber = {
  transcribe(input: { sourceUrl: string; provider: VideoProvider; videoId?: string }): Promise<VideoTranscriptCue[]>;
};

export type VideoConversionOptions = {
  resolver?: AddressResolver;
  preferredLanguage?: string;
  localTranscriber?: LocalVideoTranscriber;
};

const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;
const YOUTUBE_FETCH_HOSTS = ["youtube.com", "youtube-nocookie.com", "googlevideo.com", "youtu.be"];

function isAllowedYoutubeFetchHost(hostname: string): boolean {
  const value = hostname.toLowerCase();
  return YOUTUBE_FETCH_HOSTS.some((host) => value === host || value.endsWith(`.${host}`));
}

async function youtubeProviderFetch(input: string | URL | Request, init?: RequestInit): Promise<Response> {
  let current = typeof input === "string" || input instanceof URL ? new URL(input.toString()) : new URL(input.url);
  for (let redirects = 0; redirects <= 3; redirects += 1) {
    if (current.protocol !== "https:" || !isAllowedYoutubeFetchHost(current.hostname)) {
      throw new Error("字幕服务返回了不受信任的地址");
    }
    const response = await fetch(current, {
      ...init,
      redirect: "manual",
      signal: init?.signal ?? AbortSignal.timeout(20_000)
    });
    if (![301, 302, 303, 307, 308].includes(response.status)) return response;
    const location = response.headers.get("location");
    if (!location || redirects === 3) throw new Error("字幕服务重定向次数过多");
    current = new URL(location, current);
  }
  throw new Error("字幕服务重定向次数过多");
}

export function extractYoutubeVideoId(input: string): string | null {
  const trimmed = input.trim();
  if (YOUTUBE_ID.test(trimmed)) return trimmed;
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }
  const hostname = url.hostname.toLowerCase().replace(/^www\./, "");
  let candidate: string | null = null;
  if (hostname === "youtu.be") candidate = url.pathname.split("/").filter(Boolean)[0] ?? null;
  if (hostname === "youtube.com" || hostname.endsWith(".youtube.com")) {
    candidate = url.searchParams.get("v");
    if (!candidate) {
      const parts = url.pathname.split("/").filter(Boolean);
      if (["embed", "shorts", "live"].includes(parts[0])) candidate = parts[1] ?? null;
    }
  }
  return candidate && YOUTUBE_ID.test(candidate) ? candidate : null;
}

function formatTimestamp(milliseconds: number): string {
  const safe = Math.max(0, Math.floor(milliseconds));
  const hours = Math.floor(safe / 3_600_000);
  const minutes = Math.floor((safe % 3_600_000) / 60_000);
  const seconds = Math.floor((safe % 60_000) / 1_000);
  const millis = safe % 1_000;
  const prefix = hours > 0 ? `${String(hours).padStart(2, "0")}:` : "";
  return `${prefix}${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${String(millis).padStart(3, "0")}`;
}

function cleanLine(input: string): string {
  return input.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
}

function transcriptResponseToCues(transcript: TranscriptResponse[]): VideoTranscriptCue[] {
  return transcript
    .map((cue) => ({
      startMs: Math.max(0, Math.round(cue.offset)),
      endMs: Math.max(0, Math.round(cue.offset + cue.duration)),
      text: cleanLine(cue.text)
    }))
    .filter((cue) => cue.text && cue.endMs >= cue.startMs);
}

function directVideoType(url: URL): DirectVideoType | null {
  const extension = path.extname(url.pathname).toLowerCase();
  if (extension === ".mp4") return "mp4";
  if (extension === ".webm") return "webm";
  if (extension === ".m3u8") return "hls";
  return null;
}

async function getYoutubeMetadata(videoId: string): Promise<Pick<ProjectVideoDescriptor, "title" | "thumbnailUrl">> {
  const canonicalUrl = `https://www.youtube.com/watch?v=${videoId}`;
  try {
    const response = await safeHttpGet(
      `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(canonicalUrl)}`,
      { maxBytes: 256 * 1024, timeoutMs: 10_000 }
    );
    const value = JSON.parse(response.body.toString("utf8")) as { title?: unknown; thumbnail_url?: unknown };
    return {
      title: cleanLine(typeof value.title === "string" ? value.title : "") || `YouTube ${videoId}`,
      thumbnailUrl: typeof value.thumbnail_url === "string" ? value.thumbnail_url : `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`
    };
  } catch {
    return { title: `YouTube ${videoId}`, thumbnailUrl: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg` };
  }
}

async function createYoutubeDescriptor(videoId: string, options: VideoConversionOptions): Promise<ProjectVideoDescriptor> {
  const sourceUrl = `https://www.youtube.com/watch?v=${videoId}`;
  const metadata = await getYoutubeMetadata(videoId);
  const warnings: string[] = [];
  let transcript: VideoTranscriptCue[] = [];
  try {
    transcript = transcriptResponseToCues(await YoutubeTranscript.fetchTranscript(videoId, {
      ...(options.preferredLanguage ? { lang: options.preferredLanguage } : {}),
      fetch: youtubeProviderFetch
    }));
  } catch (error) {
    warnings.push(error instanceof Error ? `未获取到平台字幕：${error.message}` : "未获取到平台字幕");
  }
  let transcriptSource: ProjectVideoDescriptor["transcriptSource"] = transcript.length > 0 ? "platform" : "none";
  if (transcript.length === 0 && options.localTranscriber) {
    transcript = await options.localTranscriber.transcribe({ sourceUrl, provider: "youtube", videoId });
    transcriptSource = transcript.length > 0 ? "local" : "none";
  }
  const durationMs = transcript.reduce((maximum, cue) => Math.max(maximum, cue.endMs), 0) || undefined;
  return {
    provider: "youtube",
    sourceUrl,
    embedUrl: `https://www.youtube-nocookie.com/embed/${videoId}?enablejsapi=1`,
    videoId,
    title: metadata.title,
    thumbnailUrl: metadata.thumbnailUrl,
    durationMs,
    transcript,
    transcriptSource,
    warnings
  };
}

async function createDirectDescriptor(input: string, options: VideoConversionOptions): Promise<ProjectVideoDescriptor> {
  const parsed = parsePublicHttpUrl(input);
  if (parsed.protocol !== "https:") throw new Error("直链视频仅支持 HTTPS");
  await resolvePublicUrl(parsed, options.resolver);
  const mediaType = directVideoType(parsed);
  if (!mediaType) throw new Error("直链视频仅支持 MP4、WebM 或 HLS (.m3u8)");
  const sourceUrl = parsed.toString();
  let transcript: VideoTranscriptCue[] = [];
  if (options.localTranscriber) transcript = await options.localTranscriber.transcribe({ sourceUrl, provider: "direct" });
  const filename = decodeURIComponent(path.basename(parsed.pathname));
  return {
    provider: "direct",
    sourceUrl,
    mediaType,
    title: cleanLine(path.basename(filename, path.extname(filename))) || "在线视频",
    durationMs: transcript.reduce((maximum, cue) => Math.max(maximum, cue.endMs), 0) || undefined,
    transcript,
    transcriptSource: transcript.length > 0 ? "local" : "none",
    warnings: transcript.length > 0 ? [] : ["视频没有可用字幕；仍可作为播放器资料使用"]
  };
}

export function videoDescriptorToMarkdown(video: ProjectVideoDescriptor): string {
  const metadata = [
    "- 类型：video",
    `- Provider：${video.provider}`,
    `- URL：${video.sourceUrl}`,
    ...(video.videoId ? [`- Video ID：${video.videoId}`] : []),
    ...(video.mediaType ? [`- Media Type：${video.mediaType}`] : []),
    ...(video.durationMs ? [`- 时长：${formatTimestamp(video.durationMs)}`] : []),
    ...(video.thumbnailUrl ? [`- 封面：${video.thumbnailUrl}`] : []),
    `- 字幕来源：${video.transcriptSource}`,
    `- 导入时间：${new Date().toISOString()}`
  ];
  const transcript = video.transcript.length > 0
    ? video.transcript.map((cue) => `[${formatTimestamp(cue.startMs)}–${formatTimestamp(cue.endMs)}] ${cleanLine(cue.text)}`).join("\n\n")
    : "_（暂无字幕）_";
  return `# ${cleanLine(video.title)}\n\n## 元数据\n\n${metadata.join("\n")}\n\n## 字幕\n\n${transcript}\n`;
}

function parseTimestamp(value: string): number | null {
  const parts = value.trim().split(":");
  if (parts.length < 2 || parts.length > 3) return null;
  const secondsPart = Number(parts.pop());
  const minutesPart = Number(parts.pop());
  const hoursPart = parts.length ? Number(parts.pop()) : 0;
  if (![secondsPart, minutesPart, hoursPart].every(Number.isFinite)) return null;
  return Math.round(((hoursPart ?? 0) * 3600 + (minutesPart ?? 0) * 60 + (secondsPart ?? 0)) * 1000);
}

/** Rebuilds the UI descriptor solely from the ordinary `.video.md` file. */
export function parseVideoMarkdown(markdown: string): ProjectVideoDescriptor | null {
  const title = markdown.match(/^#\s+(.+)$/m)?.[1]?.trim();
  const provider = markdown.match(/^- Provider：(.+)$/m)?.[1]?.trim();
  const sourceUrl = markdown.match(/^- URL：(.+)$/m)?.[1]?.trim();
  if (!title || !sourceUrl || (provider !== "youtube" && provider !== "direct")) return null;
  const videoId = markdown.match(/^- Video ID：(.+)$/m)?.[1]?.trim();
  const mediaTypeValue = markdown.match(/^- Media Type：(.+)$/m)?.[1]?.trim();
  const mediaType = mediaTypeValue && ["mp4", "webm", "hls"].includes(mediaTypeValue)
    ? mediaTypeValue as DirectVideoType
    : undefined;
  const thumbnailUrl = markdown.match(/^- 封面：(.+)$/m)?.[1]?.trim();
  const transcriptSourceValue = markdown.match(/^- 字幕来源：(.+)$/m)?.[1]?.trim();
  const transcriptSource = ["platform", "local", "none"].includes(transcriptSourceValue ?? "")
    ? transcriptSourceValue as ProjectVideoDescriptor["transcriptSource"]
    : "none";
  const transcript: VideoTranscriptCue[] = [];
  const cuePattern = /^\[([0-9:.]+)–([0-9:.]+)]\s+(.+)$/gm;
  for (const match of markdown.matchAll(cuePattern)) {
    const startMs = parseTimestamp(match[1]);
    const endMs = parseTimestamp(match[2]);
    if (startMs !== null && endMs !== null) transcript.push({ startMs, endMs, text: match[3].trim() });
  }
  const durationMs = transcript.reduce((maximum, cue) => Math.max(maximum, cue.endMs), 0) || undefined;
  return {
    provider,
    sourceUrl,
    embedUrl: provider === "youtube" && videoId ? `https://www.youtube-nocookie.com/embed/${videoId}?enablejsapi=1` : undefined,
    videoId,
    mediaType,
    title,
    durationMs,
    thumbnailUrl,
    transcript,
    transcriptSource,
    warnings: []
  };
}

export async function convertVideoUrlToMarkdown(
  input: string,
  options: VideoConversionOptions = {}
): Promise<{ video: ProjectVideoDescriptor; markdown: string }> {
  const youtubeId = extractYoutubeVideoId(input);
  const video = youtubeId
    ? await createYoutubeDescriptor(youtubeId, options)
    : await createDirectDescriptor(input, options);
  return { video, markdown: videoDescriptorToMarkdown(video) };
}
