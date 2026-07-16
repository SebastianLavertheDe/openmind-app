import { useCallback, useState } from "react";
import type { ContentRecord } from "@shared/contracts";
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
    if (topicFileDirty && !await ai.confirm({ title: "切换选题文件", body: "当前选题文件有未保存的修改，确定放弃并切换吗？", confirmText: "放弃并切换", danger: true })) return false;
    try {
      const next = await window.cctools.readContent(path);
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
      const next = await window.cctools.writeContent(selectedTopicFile.path, topicFileDraft);
      setSelectedTopicFile(next);
      setTopicFileDraft(next.content || topicFileDraft);
      setTopicFileDirty(false);
      setTopicFileMode("preview");
      ai.notify("选题管理文件已保存", "success");
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
