import path from "node:path";
import { messages } from "../../../shared/messages";
import { bilibiliEmbedUrl, isBilibiliVideoUrl, parseBilibiliVideoUrl } from "../../../shared/bilibili-video";
import { bilibiliDescriptor, type BilibiliSubtitleReader } from "./bilibili-subtitles";
import type { YoutubeDownload, YoutubeDownloader } from "./youtube-downloader";
import { parsePublicHttpUrl, resolvePublicUrl, type AddressResolver } from "./public-url";

export type VideoProvider = "youtube" | "bilibili" | "direct";
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
  youtubeDownloader?: YoutubeDownloader;
  bilibiliSubtitles?: BilibiliSubtitleReader;
};

const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;
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

function directVideoType(url: URL): DirectVideoType | null {
  const extension = path.extname(url.pathname).toLowerCase();
  if (extension === ".mp4") return "mp4";
  if (extension === ".webm") return "webm";
  if (extension === ".m3u8") return "hls";
  return null;
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
  const warnings = video.warnings.length ? `\n\n## 导入提示\n\n${video.warnings.map(warning => `- ${cleanLine(warning)}`).join("\n")}` : "";
  return `# ${cleanLine(video.title)}\n\n## 元数据\n\n${metadata.join("\n")}${warnings}\n\n## 字幕\n\n${transcript}\n`;
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
  if (!title || !sourceUrl || !["youtube", "bilibili", "direct"].includes(provider ?? "")) return null;
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
  const storedDuration = markdown.match(/^- 时长：(.+)$/m)?.[1];
  const durationMs = (storedDuration ? parseTimestamp(storedDuration) : null) ?? (transcript.reduce((maximum, cue) => Math.max(maximum, cue.endMs), 0) || undefined);
  const bilibili = provider === "bilibili" ? parseBilibiliVideoUrl(sourceUrl) : null;
  return {
    provider: provider as VideoProvider,
    sourceUrl,
    embedUrl: provider === "youtube" && videoId ? `https://www.youtube-nocookie.com/embed/${videoId}?enablejsapi=1`
      : bilibili && bilibili.videoId === videoId ? bilibiliEmbedUrl(bilibili) : undefined,
    videoId,
    mediaType,
    title,
    durationMs,
    thumbnailUrl,
    transcript,
    transcriptSource,
    warnings: (markdown.split(/^## 导入提示\s*$/m)[1]?.split(/^## /m)[0] || "")
      .split(/\r?\n/).filter(line => line.startsWith("- ")).map(line => line.slice(2).trim()).filter(Boolean)
  };
}

export async function convertVideoUrlToMarkdown(
  input: string,
  options: VideoConversionOptions = {}
): Promise<{ video: ProjectVideoDescriptor; markdown: string; download?: YoutubeDownload }> {
  if (isBilibiliVideoUrl(input)) {
    const reference = parseBilibiliVideoUrl(input);
    if (!options.bilibiliSubtitles && !reference) throw new Error(messages.desktopErrors.bilibili.shortUrlFailed);
    const video = options.bilibiliSubtitles ? await options.bilibiliSubtitles.read(input, options.preferredLanguage)
      : bilibiliDescriptor(reference!, messages.desktopErrors.bilibili.toolsMissing);
    return { video, markdown: videoDescriptorToMarkdown(video) };
  }
  const youtubeId = extractYoutubeVideoId(input);
  if (youtubeId) {
    if (!options.youtubeDownloader) throw Object.assign(new Error(messages.desktopErrors.youtube.selectBrowser), { code: "youtube-browser-required" });
    const download = await options.youtubeDownloader.download(youtubeId, options.preferredLanguage);
    try { return { video: download.video, markdown: videoDescriptorToMarkdown(download.video), download }; }
    catch (error) { download.cleanup(); throw error; }
  }
  const video = await createDirectDescriptor(input, options);
  return { video, markdown: videoDescriptorToMarkdown(video) };
}
