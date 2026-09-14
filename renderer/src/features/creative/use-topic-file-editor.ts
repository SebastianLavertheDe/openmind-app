import { useCallback } from "react";
import { messages as m } from "@shared/messages";
import { useAi } from "../../ai-context";
import { useFilePreviewController, workspaceFileSource } from "../file-preview";

export function useTopicFileEditor() {
  const ai = useAi();
  const preview = useFilePreviewController({
    onLoadError(message) {
      ai.notify(message, "error");
    },
    onSaveError(message) {
      ai.notify(message, "error");
    }
  });
  const selectedTopicFile = preview.resource?.kind === "document" ? preview.resource.record : null;

  const confirmTopicFileDiscard = useCallback(() => ai.confirm({
    title: m.creativeUi.topicFile.switch.title,
    body: m.creativeUi.topicFile.switch.body,
    confirmText: m.creativeUi.topicFile.switch.confirm,
    danger: true
  }), [ai]);

  const resetTopicFile = useCallback(() => preview.close(confirmTopicFileDiscard), [confirmTopicFileDiscard, preview.close]);

  const openTopicFile = useCallback(async (path: string): Promise<boolean> => {
    if (!path) return false;
    return preview.openSource(workspaceFileSource(path, { editable: true }), {
      confirmDiscard: confirmTopicFileDiscard
    });
  }, [confirmTopicFileDiscard, preview.openSource]);

  const saveTopicFile = useCallback(async () => {
    if (!selectedTopicFile || !preview.dirty || preview.saving || selectedTopicFile.truncated) return;
    if (await preview.save()) {
      await preview.setMode("preview");
      ai.notify(m.creativeUi.topicFile.savedNotice, "success");
    }
  }, [ai, preview.dirty, preview.save, preview.saving, preview.setMode, selectedTopicFile]);

  const setTopicFileMode = useCallback((mode: "preview" | "edit") => {
    void preview.setMode(mode);
  }, [preview.setMode]);

  const openTopicFileExternal = useCallback(() => {
    void preview.source?.openExternal?.();
  }, [preview.source]);

  return {
    selectedTopicFilePath: preview.source?.path || "",
    selectedTopicFile,
    topicFileDraft: preview.draft.content,
    topicFileMode: preview.mode,
    topicFileDirty: preview.dirty,
    topicFileSaving: preview.saving,
    setTopicFileDraft: preview.setContent,
    setTopicFileMode,
    resetTopicFile,
    openTopicFile,
    openTopicFileExternal,
    saveTopicFile
  };
}
