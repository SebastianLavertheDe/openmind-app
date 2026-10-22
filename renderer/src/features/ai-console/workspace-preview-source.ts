import { messages as uiMessages } from "@shared/messages";
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
    unsupportedBinaryReason: uiMessages.interface.binaryAiFile
  });
}
