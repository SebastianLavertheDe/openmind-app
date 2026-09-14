import type { FilePreviewSource } from "../file-preview/model";
import { workspaceFileSource } from "../file-preview/workspace-file-source";

export { isBinaryPreviewPath } from "../file-preview/workspace-file-source";

export type ConversationSurface =
  | { kind: "workspace" }
  | { kind: "project-task"; projectName: string };

export function workspacePreviewSource(path: string): FilePreviewSource {
  return workspaceFileSource(path, {
    editable: true,
    binary: "unsupported",
    unsupportedBinaryReason: /\.(?:mp4|mov|webm)$/i.test(path)
      ? "本地二进制视频暂不支持应用内预览。"
      : "该二进制文件暂不支持在 AI 文件窗格中预览。"
  });
}
