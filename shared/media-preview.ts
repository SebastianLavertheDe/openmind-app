import { z } from "zod";
import { imagePreviewMimeType } from "./image-preview";

const MEDIA_TYPES: Record<string, string> = {
  mp4: "video/mp4", m4v: "video/mp4", webm: "video/webm", mov: "video/quicktime",
  mp3: "audio/mpeg", wav: "audio/wav", ogg: "audio/ogg", opus: "audio/ogg",
  m4a: "audio/mp4", aac: "audio/aac", flac: "audio/flac"
};
export function mediaMimeType(path: string): string | null {
  return imagePreviewMimeType(path) || MEDIA_TYPES[/\.([a-z0-9]+)$/i.exec(path.trim())?.[1].toLowerCase() || ""] || null;
}
export function mediaKind(path: string): "image" | "video" | "audio" | null {
  const type = mediaMimeType(path);
  return type?.startsWith("image/") ? "image" : type?.startsWith("video/") ? "video" : type?.startsWith("audio/") ? "audio" : null;
}
export const MediaPreviewRequestSchema = z.object({ path: z.string().min(1).max(8192), projectName: z.string().min(1).max(80).optional() }).strict();
export type MediaPreviewRequest = z.infer<typeof MediaPreviewRequestSchema>;
export function localMediaUrl(input: MediaPreviewRequest): string {
  return `openmind-media://local/media?${new URLSearchParams({ path: input.path, ...(input.projectName ? { projectName: input.projectName } : {}) })}`;
}
export function parseLocalMediaUrl(value: string): MediaPreviewRequest | null {
  try {
    const url = new URL(value);
    if (url.protocol !== "openmind-media:" || url.hostname !== "local" || url.pathname !== "/media" || url.port || url.username || url.password || url.hash) return null;
    const entries = [...url.searchParams];
    if (entries.some(([key]) => !["path", "projectName"].includes(key)) || new Set(entries.map(([key]) => key)).size !== entries.length) return null;
    const parsed = MediaPreviewRequestSchema.safeParse(Object.fromEntries(entries));
    return parsed.success && mediaKind(parsed.data.path) ? parsed.data : null;
  } catch { return null; }
}
export const MediaPreviewRecordSchema = z.object({
  id: z.string(), path: z.string(), name: z.string(), kind: z.enum(["image", "video", "audio"]),
  mimeType: z.string(), byteSize: z.number().nonnegative(), mediaUrl: z.string().refine(value => Boolean(parseLocalMediaUrl(value)))
});
export type MediaPreviewRecord = z.infer<typeof MediaPreviewRecordSchema>;
