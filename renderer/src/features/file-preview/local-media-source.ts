import { MediaPreviewRecordSchema, mediaKind } from "@shared/media-preview";
import type { FilePreviewSource } from "./model";

export function localMediaSource(path: string, projectName?: string): FilePreviewSource {
  const id = `media:${projectName || "workspace"}:${path}`;
  return {
    id, path, capabilities: { editContent: false, editTitle: false, openExternal: !projectName },
    async load() {
      const record = MediaPreviewRecordSchema.parse(await window.openmind.readMediaPreview({ path, ...(projectName ? { projectName } : {}) }));
      if (record.kind === "image") {
        const image = await window.openmind.readChatImage({ source: path, ...(projectName ? { projectName } : {}), variant: "original" });
        return { kind: "image", id, path, title: record.name, dataUrl: image.dataUrl };
      }
      if (record.kind === "audio") return { kind: "audio", id, path, title: record.name, mediaUrl: record.mediaUrl };
      return { kind: "video", id, path, title: record.name, playback: { kind: "local-video", mediaUrl: record.mediaUrl }, transcript: [] };
    },
    ...(!projectName ? { async openExternal() { await window.openmind.openPath(path); } } : {})
  };
}
export { mediaKind };
