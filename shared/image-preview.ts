import { z } from "zod";

export const IMAGE_PREVIEW_MAX_BYTES = 20 * 1024 * 1024;
const IMAGE_MIME_TYPES: Record<string, string> = {
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif",
  webp: "image/webp", svg: "image/svg+xml", ico: "image/x-icon", bmp: "image/bmp"
};

export function imagePreviewMimeType(path: string): string | null {
  const extension = /\.([a-z]+)$/i.exec(path.trim())?.[1].toLowerCase();
  return extension ? IMAGE_MIME_TYPES[extension] || null : null;
}

export const ImagePreviewRecordSchema = z.object({
  path: z.string(),
  name: z.string(),
  dataUrl: z.string().startsWith("data:image/")
});
export type ImagePreviewRecord = z.infer<typeof ImagePreviewRecordSchema>;
