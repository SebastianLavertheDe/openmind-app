import path from "node:path";
import { YoutubeTranscript, YoutubeTranscriptDisabledError, type TranscriptResponse } from "youtube-transcript";
import { parsePublicHttpUrl, resolvePublicUrl, type AddressResolver } from "./public-url";

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
  youtubeFetch?: typeof globalThis.fetch;
};

const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;
const YOUTUBE_FETCH_HOSTS = ["youtube.com", "youtube-nocookie.com", "googlevideo.com", "youtu.be"];

function isAllowedYoutubeFetchHost(hostname: string): boolean {
  const value = hostname.toLowerCase();
  return YOUTUBE_FETCH_HOSTS.some((host) => value === host || value.endsWith(`.${host}`));
}

async function youtubeProviderFetch(input: string | URL | Request, init?: RequestInit, request: typeof globalThis.fetch = fetch): Promise<Response> {
  let current = typeof input === "string" || input instanceof URL ? new URL(input.toString()) : new URL(input.url);
  for (let redirects = 0; redirects <= 3; redirects += 1) {
    if (current.protocol !== "https:" || current.port || current.username || current.password || !isAllowedYoutubeFetchHost(current.hostname)) {
      throw new Error("字幕服务返回了不受信任的地址");
    }
    const response = await request(current, {
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

async function getYoutubeMetadata(videoId: string, request?: typeof globalThis.fetch): Promise<Pick<ProjectVideoDescriptor, "title" | "thumbnailUrl">> {
  const canonicalUrl = `https://www.youtube.com/watch?v=${videoId}`;
  try {
    const response = await youtubeProviderFetch(
      `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(canonicalUrl)}`,
      { signal: AbortSignal.timeout(10_000) }, request
    );
    if (!response.ok) throw new Error(`YouTube HTTP ${response.status}`);
    const body = await response.text();
    if (body.length > 256 * 1024) throw new Error("视频信息过大");
    const value = JSON.parse(body) as { title?: unknown; thumbnail_url?: unknown };
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
  const metadata = await getYoutubeMetadata(videoId, options.youtubeFetch);
  const warnings: string[] = [];
  let transcript: VideoTranscriptCue[] = [];
  let transcriptIssue = "";
  try {
    transcript = transcriptResponseToCues(await YoutubeTranscript.fetchTranscript(videoId, {
      ...(options.preferredLanguage ? { lang: options.preferredLanguage } : {}),
      fetch: async (input, init) => {
        const response = await youtubeProviderFetch(input, init, options.youtubeFetch);
        if ([403, 429].includes(response.status)) {
          transcriptIssue = "YouTube 限制了当前字幕请求，请稍后重试；原视频可在已登录的浏览器中打开。";
        } else if (!response.ok) {
          transcriptIssue = `字幕请求失败（HTTP ${response.status}），请检查网络或稍后重试。`;
        }
        const url = typeof input === "string" || input instanceof URL ? new URL(input.toString()) : new URL(input.url);
        if (url.pathname === "/watch" && response.ok) {
          transcriptIssue = "";
          const page = await response.clone().text();
          if (/LOGIN_REQUIRED|sign in to confirm|class="g-recaptcha"/i.test(page)) {
            transcriptIssue = "YouTube 要求登录或人机验证，当前未能获取字幕；原视频可在已登录的浏览器中打开。";
          }
        }
        return response;
      }
    }));
    if (!transcript.length) warnings.push(transcriptIssue || "YouTube 返回了空字幕，请稍后重新获取。");
  } catch (error) {
    warnings.push(transcriptIssue || (error instanceof YoutubeTranscriptDisabledError
      ? "YouTube 未向当前请求提供字幕，可能与登录验证或视频未公开字幕有关。可以稍后重试。"
      : error instanceof Error ? `字幕获取失败：${error.message}` : "字幕获取失败，请检查网络后重试。"));
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
    warnings: (markdown.split(/^## 导入提示\s*$/m)[1]?.split(/^## /m)[0] || "")
      .split(/\r?\n/).filter(line => line.startsWith("- ")).map(line => line.slice(2).trim()).filter(Boolean)
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
