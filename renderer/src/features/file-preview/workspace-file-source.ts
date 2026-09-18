import type { ContentRecord } from "@shared/contracts";
import { ImagePreviewRecordSchema, imagePreviewMimeType } from "@shared/image-preview";
import { documentPreviewResource, type FilePreviewSource } from "./model";

const BINARY_PREVIEW_EXTENSIONS = /\.(pdf|png|jpe?g|gif|webp|svg|ico|bmp|zip|gz|7z|tar|rar|mp4|mov|webm|mp3|wav|ogg|woff2?|ttf|otf|eot|exe|dll)$/i;
const DEFAULT_BINARY_REASON = "该二进制文件暂不支持应用内预览。";

export function workspaceFileSource(path: string, {
  editable = false,
  binary = "document",
  unsupportedBinaryReason = DEFAULT_BINARY_REASON
}: {
  editable?: boolean;
  binary?: "document" | "unsupported";
  unsupportedBinaryReason?: string;
} = {}): FilePreviewSource {
  const image = Boolean(imagePreviewMimeType(path));
  const unsupportedBinary = binary === "unsupported" && isBinaryPreviewPath(path) && !image;
  const source: FilePreviewSource = {
    id: `workspace:${path}`,
    path,
    capabilities: {
      editContent: editable && !unsupportedBinary && !image,
      editTitle: false,
      openExternal: true
    },
    async load() {
      if (image) {
        const record = ImagePreviewRecordSchema.parse(await window.openmind.readImagePreview(path));
        return { kind: "image", id: source.id, path: record.path, title: record.name, dataUrl: record.dataUrl };
      }
      if (unsupportedBinary) {
        return {
          kind: "unsupported",
          id: `workspace:${path}`,
          path,
          title: path.split(/[\\/]/).at(-1) || path,
          reason: unsupportedBinaryReason
        };
      }
      return documentPreviewResource(await window.openmind.readContent(path), `workspace:${path}`);
    },
    async openExternal() {
      await window.openmind.openPath(path);
    }
  };
  if (editable && !unsupportedBinary && !image) {
    source.save = async ({ content }) => {
      const record: ContentRecord = await window.openmind.writeContent(path, content);
      return documentPreviewResource(record, source.id);
    };
  }
  return source;
}

export function isBinaryPreviewPath(path: string): boolean {
  return BINARY_PREVIEW_EXTENSIONS.test(path.trim());
}
