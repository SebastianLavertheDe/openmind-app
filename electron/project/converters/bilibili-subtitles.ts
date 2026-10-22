import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { bilibiliEmbedUrl, bilibiliVideoUrl, isBilibiliShortUrl, parseBilibiliVideoUrl, type BilibiliVideoReference } from "../../../shared/bilibili-video";
import { messages } from "../../../shared/messages";
import type { ProjectVideoDescriptor } from "./video-converter";
import { parseVideoSubtitles } from "./video-transcript";
import { safeHttpGet } from "./safe-http";

export type BilibiliSubtitleReader = { read(input: string, preferredLanguage?: string): Promise<ProjectVideoDescriptor> };
export type BilibiliCommandRunner = (executable: string, args: string[], options: { cwd: string; timeout: number; maxBuffer: number }) => Promise<{ stdout: string; stderr?: string }>;
const execute = promisify(execFile);
const runCommand: BilibiliCommandRunner = (executable, args, options) => execute(executable, args, { ...options, encoding: "utf8", windowsHide: true, shell: false, killSignal: "SIGKILL" });
const MAX_CAPTION_BYTES = 10 * 1024 * 1024;

export async function resolveBilibiliShortUrl(input: string): Promise<BilibiliVideoReference> {
  if (!isBilibiliShortUrl(input)) throw new Error(messages.desktopErrors.bilibili.invalidUrl);
  const response = await safeHttpGet(input, { method: "HEAD", maxBytes: 1024, timeoutMs: 15_000,
    validateUrl: url => {
      if (!isBilibiliShortUrl(url.href) && !parseBilibiliVideoUrl(url.href)) throw new Error(messages.desktopErrors.bilibili.invalidUrl);
    }
  });
  const reference = parseBilibiliVideoUrl(response.finalUrl);
  if (!reference) throw new Error(messages.desktopErrors.bilibili.shortUrlFailed);
  return reference;
}

export function bilibiliDescriptor(reference: BilibiliVideoReference, warning?: string): ProjectVideoDescriptor {
  return { provider: "bilibili", videoId: reference.videoId, sourceUrl: bilibiliVideoUrl(reference), embedUrl: bilibiliEmbedUrl(reference),
    title: reference.videoId, transcript: [], transcriptSource: "none", warnings: warning ? [warning] : [] };
}

function captionLanguage(languages: string[], preferred = "zh-CN"): string | undefined {
  const normalized = (value: string) => value.replace(/^ai-/, "").toLowerCase();
  const ordered = [...languages].sort((a, b) => Number(a.startsWith("ai-")) - Number(b.startsWith("ai-")));
  for (const wanted of [preferred, "zh", "en"]) {
    const exact = ordered.find(language => normalized(language) === normalized(wanted));
    if (exact) return exact;
    const base = normalized(wanted).split("-")[0];
    const related = ordered.find(language => normalized(language).split("-")[0] === base);
    if (related) return related;
  }
  return ordered[0];
}

function captionWarning(error: unknown): string {
  const value = error as { message?: string; stderr?: string; killed?: boolean; code?: string };
  const diagnostic = `${value?.message || ""} ${value?.stderr || ""}`;
  const copy = messages.desktopErrors.bilibili;
  if (value?.killed || value?.code === "ETIMEDOUT") return copy.timeout;
  if (/login|logged.in|sign.in|need_login_subtitle|登录/i.test(diagnostic)) return copy.loginRequired;
  return copy.captionsFailed;
}

/** Always fetch anonymously and skip media downloads. Only temporary subtitle files are written. */
export class BilibiliSubtitleImporter implements BilibiliSubtitleReader {
  constructor(private readonly options: {
    tempRoot: string;
    getYtDlp(): Promise<string | undefined>;
    resolveShortUrl?: (input: string) => Promise<BilibiliVideoReference>;
    run?: BilibiliCommandRunner;
  }) {}

  async read(input: string, preferredLanguage?: string): Promise<ProjectVideoDescriptor> {
    let reference = parseBilibiliVideoUrl(input);
    const short = isBilibiliShortUrl(input);
    if (!reference && !short) throw new Error(messages.desktopErrors.bilibili.invalidUrl);
    let directory: string | undefined;
    const fallback = (warning: string) => {
      if (!reference) throw new Error(messages.desktopErrors.bilibili.shortUrlFailed);
      return bilibiliDescriptor(reference, warning);
    };
    try {
      if (short) reference = await (this.options.resolveShortUrl ?? resolveBilibiliShortUrl)(input);
      const executable = await this.options.getYtDlp();
      if (!executable) return fallback(messages.desktopErrors.bilibili.toolsMissing);
      fs.mkdirSync(this.options.tempRoot, { recursive: true, mode: 0o700 });
      directory = fs.mkdtempSync(path.join(this.options.tempRoot, "captions-"));
      const url = bilibiliVideoUrl(reference!);
      const { stdout, stderr } = await (this.options.run ?? runCommand)(executable, [
        "--ignore-config", "--no-plugin-dirs", "--no-cache-dir", "--no-playlist", "--no-check-formats", "--no-progress", "--no-colors",
        "--no-cookies", "--no-cookies-from-browser",
        "--use-extractors", "BiliBili.*", "--skip-download", "--write-subs", "--sub-langs", "all,-danmaku", "--sub-format", "srt",
        "--dump-single-json", "--no-simulate", "--ignore-no-formats-error", "--no-js-runtimes", "--socket-timeout", "30", "--retries", "1",
        "--output", path.join(directory, "captions.%(ext)s"), "--", url
      ], { cwd: directory, timeout: 120_000, maxBuffer: 32 * 1024 * 1024 });
      const metadata = JSON.parse(stdout) as { id?: string; _type?: string; title?: string; duration?: number; is_live?: boolean };
      const identity = typeof metadata?.id === "string" ? /^(BV[1-9A-HJ-NP-Za-km-z]{10})(?:_p([1-9]\d{0,5}))?$/.exec(metadata.id) : null;
      if (!identity || metadata._type && metadata._type !== "video" || metadata.is_live) throw new Error("Invalid Bilibili metadata");
      const resolved = { videoId: identity[1], page: Number(identity[2] ?? "1") };
      if (reference && (reference.videoId.startsWith("BV") && reference.videoId !== resolved.videoId || reference.page !== resolved.page)) throw new Error("Mismatched Bilibili part");
      reference = resolved;
      const video = bilibiliDescriptor(reference);
      video.title = typeof metadata.title === "string" ? metadata.title.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, 255) || video.title : video.title;
      video.durationMs = typeof metadata.duration === "number" && Number.isFinite(metadata.duration) && metadata.duration > 0 ? Math.round(metadata.duration * 1000) : undefined;
      const languages = fs.readdirSync(directory).flatMap(name => {
        const match = /^captions\.([A-Za-z0-9_-]+)\.srt$/.exec(name);
        return match && match[1] !== "danmaku" ? [match[1]] : [];
      });
      const language = captionLanguage(languages, preferredLanguage);
      if (language) {
        const file = path.join(directory, `captions.${language}.srt`);
        const stat = fs.lstatSync(file);
        if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_CAPTION_BYTES) throw new Error("Invalid Bilibili subtitles");
        video.transcript = parseVideoSubtitles(fs.readFileSync(file, "utf8"), "srt");
      }
      if (video.transcript.length) video.transcriptSource = "platform";
      else video.warnings.push(stderr && /login|logged.in|sign.in|登录/i.test(stderr) ? messages.desktopErrors.bilibili.loginRequired : language ? messages.desktopErrors.bilibili.captionsFailed : messages.desktopErrors.bilibili.noCaptions);
      return video;
    } catch (error) { return fallback(captionWarning(error)); }
    finally { if (directory) fs.rmSync(directory, { recursive: true, force: true }); }
  }
}
