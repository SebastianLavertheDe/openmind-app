import { z } from "zod";
import { MediaPreviewRequestSchema } from "./media-preview";

export const FILE_DELIVERABLES_START_FENCE = "~~~~openmind-deliverables";

/** A final reply explicitly selects deliverables; tool outputs are only resources. */
export const FileDeliverableSchema = z.object({
  path: z.string().trim().min(1).max(8192).refine(value => {
    try { encodeURI(value); } catch { return false; }
    const normalized = value.replaceAll("\\", "/");
    return !/[\x00-\x1f]/.test(value)
      && !/^[a-z][a-z\d+.-]*:/i.test(value.replace(/^[a-z]:[\\/]/i, ""))
      && !normalized.startsWith("//") && !normalized.split("/").includes("..");
  }),
  title: z.string().trim().min(1).max(200).optional()
}).strict();
export type FileDeliverable = z.infer<typeof FileDeliverableSchema>;

export function fileDeliverableKey(path: string): string { return path.replaceAll("\\", "/").replace(/^\.\//, ""); }

export function parseFileDeliverables(content: string): FileDeliverable[] {
  if (content.length > 64_000) return [];
  try {
    const files = z.array(FileDeliverableSchema).min(1).max(32).parse(JSON.parse(content));
    return [...new Map(files.map(file => [fileDeliverableKey(file.path), file])).values()];
  } catch { return []; }
}

export function fileDeliverablesText(files: readonly FileDeliverable[]): string {
  return files.map(file => `[${(file.title || file.path.split(/[\\/]/).at(-1) || file.path).replace(/[\[\]\r\n]/g, "")}](${encodeURI(file.path).replace(/[()?#]/g, character => `%${character.charCodeAt(0).toString(16).toUpperCase()}`)})`).join("\n");
}

export const FileDeliverableRequestSchema = MediaPreviewRequestSchema;
export type FileDeliverableRequest = z.infer<typeof FileDeliverableRequestSchema>;
export const FileDeliverableRecordSchema = z.object({
  id: z.string(), path: z.string(), name: z.string(),
  kind: z.enum(["image", "video", "audio", "file"]), byteSize: z.number().nonnegative()
});
export type FileDeliverableRecord = z.infer<typeof FileDeliverableRecordSchema>;
