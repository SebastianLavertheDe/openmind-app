import { z } from "zod";

export const YOUTUBE_COOKIE_BROWSERS = ["chrome", "chromium", "edge", "brave", "firefox", "opera", "vivaldi", "safari"] as const;
export const YoutubeBrowserSchema = z.enum(YOUTUBE_COOKIE_BROWSERS);
export type YoutubeBrowser = z.infer<typeof YoutubeBrowserSchema>;
export const YoutubeBrowserPreferenceSchema = z.union([z.literal(""), YoutubeBrowserSchema]);

export const YOUTUBE_TOOLS = ["yt-dlp", "ffmpeg", "deno", "node"] as const;
export const YoutubeToolIdSchema = z.enum(YOUTUBE_TOOLS);
export type YoutubeToolId = z.infer<typeof YoutubeToolIdSchema>;
export const YoutubeToolStatusSchema = z.object({
  id: YoutubeToolIdSchema,
  state: z.enum(["missing", "ready", "too-old", "broken"]),
  version: z.string().nullable(),
  source: z.enum(["system", "app"]).nullable(),
  canInstall: z.boolean(),
  operation: z.enum(["idle", "checking", "installing"]),
  update: z.enum(["unchecked", "available", "current", "unknown"]),
  latestVersion: z.string().nullable()
});
export type YoutubeToolStatus = z.infer<typeof YoutubeToolStatusSchema>;
export const YOUTUBE_TOOL_INSTALL_GUIDES: Record<YoutubeToolId, string> = {
  "yt-dlp": "https://github.com/yt-dlp/yt-dlp#installation",
  ffmpeg: "https://ffmpeg.org/download.html",
  deno: "https://docs.deno.com/runtime/getting_started/installation/",
  node: "https://nodejs.org/en/download/"
};

export const YoutubeImportStatusSchema = z.object({
  browsers: z.array(z.object({ id: YoutubeBrowserSchema, name: z.string() })),
  downloaderAvailable: z.boolean(),
  ffmpegAvailable: z.boolean(),
  javascriptRuntimeAvailable: z.boolean(),
  tools: z.array(YoutubeToolStatusSchema)
});
export type YoutubeImportStatus = z.infer<typeof YoutubeImportStatusSchema>;

export const PROJECT_MEDIA_SCHEME = "openmind-media";
export function projectVideoMediaUrl(projectName: string, relativePath: string): string {
  return `${PROJECT_MEDIA_SCHEME}://project/video?${new URLSearchParams({ projectName, relativePath })}`;
}

export function parseProjectVideoMediaUrl(value: string): { projectName: string; relativePath: string } | null {
  try {
    const url = new URL(value);
    if (url.protocol !== `${PROJECT_MEDIA_SCHEME}:` || url.hostname !== "project" || url.pathname !== "/video"
      || url.port || url.username || url.password || url.hash || [...url.searchParams].length !== 2) return null;
    const projectName = url.searchParams.get("projectName");
    const relativePath = url.searchParams.get("relativePath");
    return projectName && relativePath ? { projectName, relativePath } : null;
  } catch { return null; }
}
