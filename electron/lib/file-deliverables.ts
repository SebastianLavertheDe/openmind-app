import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { FileDeliverableRequestSchema, type FileDeliverableRequest, type FileDeliverableRecord } from "../../shared/file-deliverables";
import { mediaKind } from "../../shared/media-preview";
import type { MediaFileResolver } from "./media-preview";

/** Validate an explicitly declared file without reading its contents as text. */
export function readFileDeliverable(raw: FileDeliverableRequest, resolve: MediaFileResolver): FileDeliverableRecord {
  const input = FileDeliverableRequestSchema.parse(raw);
  const file = resolve(input);
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("产物文件不存在或不可访问。");
  return { id: createHash("sha256").update(file).digest("hex"), path: input.path, name: path.basename(file), kind: mediaKind(file) || "file", byteSize: stat.size };
}
