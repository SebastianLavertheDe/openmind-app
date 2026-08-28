import { useCallback, useState } from "react";
import type { ContentRecord } from "@shared/contracts";
import { messages as m } from "@shared/messages";
import { useAi } from "../../ai-context";

export function useTopicFileEditor() {
  const ai = useAi();
  const [selectedTopicFilePath, setSelectedTopicFilePath] = useState("");
  const [selectedTopicFile, setSelectedTopicFile] = useState<ContentRecord | null>(null);
  const [topicFileDraft, setTopicFileDraft] = useState("");
  const [topicFileMode, setTopicFileMode] = useState<"preview" | "edit">("preview");
  const [topicFileDirty, setTopicFileDirty] = useState(false);
  const [topicFileSaving, setTopicFileSaving] = useState(false);

  const resetTopicFile = useCallback(() => {
    setSelectedTopicFilePath("");
    setSelectedTopicFile(null);
    setTopicFileDraft("");
    setTopicFileMode("preview");
    setTopicFileDirty(false);
  }, []);

  const openTopicFile = useCallback(async (path: string): Promise<boolean> => {
    if (!path) return false;
    if (topicFileDirty && !await ai.confirm({ title: m.creativeUi.topicFile.switch.title, body: m.creativeUi.topicFile.switch.body, confirmText: m.creativeUi.topicFile.switch.confirm, danger: true })) return false;
    try {
      const next = await window.openmind.readContent(path);
      setSelectedTopicFilePath(path);
      setSelectedTopicFile(next);
      setTopicFileDraft(next.content || "");
      setTopicFileMode("preview");
      setTopicFileDirty(false);
      return true;
    } catch (cause) {
      ai.notify(cause instanceof Error ? cause.message : String(cause), "error");
      return false;
    }
  }, [ai, topicFileDirty]);

  const saveTopicFile = useCallback(async () => {
    if (!selectedTopicFile || !topicFileDirty || topicFileSaving || selectedTopicFile.truncated) return;
    setTopicFileSaving(true);
    try {
      const next = await window.openmind.writeContent(selectedTopicFile.path, topicFileDraft);
      setSelectedTopicFile(next);
      setTopicFileDraft(next.content || topicFileDraft);
      setTopicFileDirty(false);
      setTopicFileMode("preview");
      ai.notify(m.creativeUi.topicFile.savedNotice, "success");
    } catch (cause) {
      ai.notify(cause instanceof Error ? cause.message : String(cause), "error");
    } finally {
      setTopicFileSaving(false);
    }
  }, [ai, selectedTopicFile, topicFileDirty, topicFileDraft, topicFileSaving]);

  return {
    selectedTopicFilePath,
    selectedTopicFile,
    topicFileDraft,
    topicFileMode,
    topicFileDirty,
    topicFileSaving,
    setTopicFileDraft,
    setTopicFileMode,
    setTopicFileDirty,
    resetTopicFile,
    openTopicFile,
    saveTopicFile
  };
}
