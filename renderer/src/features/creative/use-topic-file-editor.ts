import { useFeedback } from "../../feedback-context";
import { useCallback } from "react";
import { messages as m } from "@shared/messages";
import { useFilePreviewController, workspaceFileSource } from "../file-preview";

export function useTopicFileEditor() {
  const { notify, confirm } = useFeedback();
  const preview = useFilePreviewController({
    onLoadError(message) {
      notify(message, "error");
    },
    onSaveError(message) {
      notify(message, "error");
    }
  });
  const selectedTopicFile = preview.resource?.kind === "document" ? preview.resource.record : null;

  const confirmTopicFileDiscard = useCallback(() => confirm({
    title: m.creativeUi.topicFile.switch.title,
    body: m.creativeUi.topicFile.switch.body,
    confirmText: m.creativeUi.topicFile.switch.confirm,
    danger: true
  }), [confirm]);

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
      notify(m.creativeUi.topicFile.savedNotice, "success");
    }
  }, [notify, preview.dirty, preview.save, preview.saving, preview.setMode, selectedTopicFile]);

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
