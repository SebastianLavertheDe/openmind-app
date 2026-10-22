import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { messages } from "../../../shared/messages";
import { YoutubeBrowserPreferenceSchema } from "../../../shared/youtube-import";
import { createYoutubeHostDetector } from "../youtube-browser";
import type { YoutubeToolPaths } from "../../install/youtube-tools-service";
import type { ProjectVideoDescriptor } from "./video-converter";
import { parseVideoSubtitles } from "./video-transcript";

export type YoutubeDownload = {
  video: ProjectVideoDescriptor;
  mediaPath: string;
  cleanup(): void;
};
export type YoutubeDownloader = { download(videoId: string, preferredLanguage?: string): Promise<YoutubeDownload> };
type CommandOptions = { cwd: string; timeout: number; maxBuffer: number };
export type YoutubeCommandRunner = (executable: string, args: string[], options: CommandOptions) => Promise<{ stdout: string }>;
type Metadata = {
  id?: string;
  title?: string;
  duration?: number;
  language?: string;
  is_live?: boolean;
  live_status?: string;
  subtitles?: Record<string, unknown>;
  automatic_captions?: Record<string, unknown>;
};
const execute = promisify(execFile);
const runCommand: YoutubeCommandRunner = (executable, args, options) => execute(executable, args, {
  ...options, encoding: "utf8", windowsHide: true, shell: false, killSignal: "SIGKILL"
});

function importError(code: string, message: string): Error {
  return Object.assign(new Error(message), { code });
}

/** Return only our actionable messages: subprocess stderr may contain profile paths and signed URLs. */
function downloadError(error: unknown): Error {
  const value = error as { message?: string; stderr?: string; code?: string; killed?: boolean };
  const diagnostic = `${value?.message || ""} ${value?.stderr || ""}`;
  if (value?.killed || value?.code === "ETIMEDOUT") return importError("youtube-timeout", messages.desktopErrors.youtube.timeout);
  if (/cookie|keyring|decrypt|DPAPI|database.*locked/i.test(diagnostic)) return importError("youtube-cookies", messages.desktopErrors.youtube.cookiesFailed);
  if (/sign.?in|login|confirm.*bot|age.restrict|private video|members.only/i.test(diagnostic)) return importError("youtube-login", messages.desktopErrors.youtube.loginRequired);
  if (value?.code === "ENOENT") return importError("youtube-tools-missing", messages.desktopErrors.youtube.toolsMissing);
  return importError("youtube-download-failed", messages.desktopErrors.youtube.downloadFailed);
}

function subtitleLanguage(metadata: Metadata, preferred?: string): string | undefined {
  const manual = Object.keys(metadata.subtitles || {});
  const automatic = Object.keys(metadata.automatic_captions || {});
  const all = [...manual, ...automatic].filter(language => /^[A-Za-z0-9_-]+$/.test(language) && language !== "live_chat");
  for (const language of [preferred, metadata.language, "en"].filter((value): value is string => Boolean(value))) {
    const base = language.split("-")[0];
    const found = all.find(item => item === language) || all.find(item => item === base) || all.find(item => item.startsWith(`${base}-`));
    if (found) return found;
  }
  return all[0];
}

export class BrowserYoutubeDownloader implements YoutubeDownloader {
  constructor(private readonly options: {
    tempRoot: string;
    getBrowser(): unknown;
    detector?: ReturnType<typeof createYoutubeHostDetector>;
    resolveTools?: () => Promise<YoutubeToolPaths>;
    run?: YoutubeCommandRunner;
  }) {}

  async download(videoId: string, preferredLanguage?: string): Promise<YoutubeDownload> {
    if (!/^[A-Za-z0-9_-]{11}$/.test(videoId)) throw importError("youtube-invalid-video", messages.desktopErrors.youtube.invalidOutput);
    const selected = YoutubeBrowserPreferenceSchema.safeParse(this.options.getBrowser());
    if (!selected.success || !selected.data) throw importError("youtube-browser-required", messages.desktopErrors.youtube.selectBrowser);
    const host = this.options.detector ?? createYoutubeHostDetector();
    if (!host.browsers().some(browser => browser.id === selected.data)) throw importError("youtube-browser-missing", messages.desktopErrors.youtube.browserMissing);
    const tools = this.options.resolveTools ? await this.options.resolveTools() : {
      "yt-dlp": host.findTool("yt-dlp"), ffmpeg: host.findTool("ffmpeg"), deno: host.findTool("deno"), node: host.findTool("node")
    };
    const executable = tools["yt-dlp"];
    const { ffmpeg, deno, node } = tools;
    if (!executable || !ffmpeg || (!deno && !node)) throw importError("youtube-tools-missing", messages.desktopErrors.youtube.toolsMissing);

    fs.mkdirSync(this.options.tempRoot, { recursive: true, mode: 0o700 });
    const directory = fs.mkdtempSync(path.join(this.options.tempRoot, "youtube-"));
    const cleanup = () => fs.rmSync(directory, { recursive: true, force: true });
    const run = this.options.run ?? runCommand;
    const url = `https://www.youtube.com/watch?v=${videoId}`;
    const common = [
      "--ignore-config", "--no-plugin-dirs", "--no-playlist", "--no-cache-dir", "--no-progress", "--no-colors",
      "--cookies-from-browser", selected.data, "--no-js-runtimes", "--js-runtimes", deno ? `deno:${deno}` : `node:${node}`,
      "--ffmpeg-location", ffmpeg, "--socket-timeout", "30", "--retries", "2", "--fragment-retries", "2"
    ];
    const command = async (args: string[], timeout: number) => {
      try { return await run(executable, [...common, ...args, "--", url], { cwd: directory, timeout, maxBuffer: 8 * 1024 * 1024 }); }
      catch (error) { throw downloadError(error); }
    };
    try {
      const { stdout } = await command(["--dump-single-json", "--skip-download"], 90_000);
      let metadata: Metadata;
      try { metadata = JSON.parse(stdout) as Metadata; }
      catch { throw importError("youtube-invalid-output", messages.desktopErrors.youtube.invalidOutput); }
      if (!metadata || metadata.id !== videoId || metadata.is_live || ["is_live", "is_upcoming", "post_live"].includes(metadata.live_status || "")) {
        throw importError("youtube-invalid-output", messages.desktopErrors.youtube.invalidOutput);
      }
      // H.264/AAC MP4 or WebM are playable in Electron without an extra decoder.
      await command([
        "--format", "bv[ext=mp4][vcodec^=avc1]+ba[ext=m4a]/b[ext=mp4][vcodec^=avc1]/bv[ext=webm]+ba[ext=webm]/b[ext=webm]",
        "--merge-output-format", "mp4/webm", "--output", path.join(directory, "video.%(ext)s")
      ], 30 * 60_000);
      const filename = ["video.mp4", "video.webm"].find(name => {
        try { const stat = fs.lstatSync(path.join(directory, name)); return stat.isFile() && !stat.isSymbolicLink() && stat.size > 0; }
        catch { return false; }
      });
      if (!filename) throw importError("youtube-invalid-output", messages.desktopErrors.youtube.invalidOutput);
      const warnings: string[] = [];
      let transcript: ProjectVideoDescriptor["transcript"] = [];
      const language = subtitleLanguage(metadata, preferredLanguage);
      if (language) {
        try {
          await command([
            "--skip-download", "--write-subs", "--write-auto-subs", "--sub-langs", language,
            "--sub-format", "json3/vtt", "--output", path.join(directory, "captions.%(ext)s")
          ], 90_000);
          const subtitle = ["json3", "vtt"].map(extension => `captions.${language}.${extension}`).find(name => fs.existsSync(path.join(directory, name)));
          if (subtitle) {
            const absolute = path.join(directory, subtitle);
            const stat = fs.lstatSync(absolute);
            if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 10 * 1024 * 1024) throw new Error("Invalid subtitles");
            transcript = parseVideoSubtitles(fs.readFileSync(absolute, "utf8"), subtitle.endsWith(".json3") ? "json3" : "vtt");
          }
          if (!transcript.length) warnings.push(messages.desktopErrors.youtube.captionsFailed);
        } catch { warnings.push(messages.desktopErrors.youtube.captionsFailed); }
      } else warnings.push(messages.desktopErrors.youtube.noCaptions);
      return {
        video: {
          provider: "youtube", videoId, sourceUrl: url,
          title: (typeof metadata.title === "string" ? metadata.title.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, 255) : "") || `YouTube ${videoId}`,
          mediaType: filename.endsWith(".mp4") ? "mp4" : "webm",
          durationMs: typeof metadata.duration === "number" && Number.isFinite(metadata.duration) && metadata.duration > 0 ? Math.round(metadata.duration * 1000) : undefined,
          transcript, transcriptSource: transcript.length ? "platform" : "none", warnings
        },
        mediaPath: path.join(directory, filename), cleanup
      };
    } catch (error) {
      cleanup();
      throw error;
    }
  }
}
