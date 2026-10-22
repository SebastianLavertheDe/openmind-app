import { Button } from "../../design-system/components";
import { useLocale } from "../../i18n";
import type { Dispatch, RefObject, SetStateAction } from "react";
import { Archive, Check, Copy, ExternalLink, FileText, LoaderCircle, Save } from "lucide-react";
import type { ContentRecord, CreativeProjectDetail, CreativeProjectSummary, CreativeTopic } from "@shared/contracts";
import { getLocale, messages as m } from "@shared/messages";
import { EmptyState, StatusBadge, Tabs } from "../../design-system/components";
import { MarkdownReader } from "../../components/MarkdownReader";
import { PublishForm, TopicWorkspace, WritingStats } from "./panels";
import { InlineAiBar } from "./InlineAiBar";
import { MarkdownEditor, type EditorSelectionSnapshot, type MarkdownEditorHandle } from "./MarkdownEditor";
import { TopicFileWorkspace } from "./TopicFileWorkspace";
import { type PlatformOption, type Stage, nextStage, platformLabel, stageLabel } from "./types";

export function CreativeDetailPane({
  stage,
  detail,
  selectedProject,
  selectedTopic,
  selectedTopicDate,
  selectedTopicFile,
  topicFileDraft,
  topicFileMode,
  topicFileDirty,
  topicFileSaving,
  setTopicFileDraft,
  setTopicFileMode,
  openTopicFileExternal,
  saveTopicFile,
  activeFile,
  chooseFile,
  setDetail,
  setDraft,
  createProject,
  creatingProjectKey,
  detailLoading,
  addContext,
  dirty,
  autoSaveStatus,
  saving,
  save,
  copyProject,
  archiveProject,
  advance,
  exportDraft,
  exporting,
  publishChecklistEnabled,
  editorMode,
  setEditorMode,
  draft,
  editorSelection,
  replaceRange,
  editorRef,
  setDirty,
  setEditorSelection,
  insertLocalFileLink,
  updateManifest
}: {
  stage: Stage;
  detail: CreativeProjectDetail | null;
  selectedProject: CreativeProjectSummary | null;
  selectedTopic: CreativeTopic | null;
  selectedTopicDate: string;
  selectedTopicFile: ContentRecord | null;
  topicFileDraft: string;
  topicFileMode: "preview" | "edit";
  topicFileDirty: boolean;
  topicFileSaving: boolean;
  setTopicFileDraft: (value: string) => void;
  setTopicFileMode: (mode: "preview" | "edit") => void;
  openTopicFileExternal(): void;
  saveTopicFile(): Promise<void>;
  activeFile: string;
  chooseFile(file: string): Promise<void>;
  setDetail: Dispatch<SetStateAction<CreativeProjectDetail | null>>;
  setDraft: Dispatch<SetStateAction<string>>;
  createProject(platform?: PlatformOption, topicOverride?: CreativeTopic): Promise<void>;
  creatingProjectKey: string | null;
  detailLoading: boolean;
  addContext(): void;
  dirty: boolean;
  autoSaveStatus: "idle" | "saving" | "saved" | "failed";
  saving: boolean;
  save(): Promise<void>;
  copyProject(): Promise<void>;
  archiveProject(): Promise<void>;
  advance(): Promise<void>;
  exportDraft(): Promise<void>;
  exporting: boolean;
  publishChecklistEnabled: boolean;
  editorMode: "edit" | "preview";
  setEditorMode: (mode: "edit" | "preview") => void;
  draft: string;
  editorSelection: EditorSelectionSnapshot;
  replaceRange(start: number, end: number, replacement: string, bookmark?: number): boolean;
  editorRef: RefObject<MarkdownEditorHandle | null>;
  setDirty(value: boolean): void;
  setEditorSelection: (selection: EditorSelectionSnapshot) => void;
  insertLocalFileLink(): Promise<void>;
  updateManifest(patch: Record<string, unknown>): Promise<void>;
}) {
  useLocale();
  if (selectedTopicFile) {
    return <TopicFileWorkspace
      file={selectedTopicFile}
      draft={topicFileDraft}
      mode={topicFileMode}
      dirty={topicFileDirty}
      saving={topicFileSaving}
      onMode={setTopicFileMode}
      onDraft={setTopicFileDraft}
      onSave={() => void saveTopicFile()}
      onOpenExternal={openTopicFileExternal}
    />;
  }
  if (selectedTopic) {
    return <TopicWorkspace
      topic={selectedTopic}
      date={selectedTopicDate}
      createProject={createProject}
      addContext={addContext}
      creatingKey={creatingProjectKey}
    />;
  }
  if (detailLoading && selectedProject) {
    return <div className="creative-project-loading" role="status" aria-live="polite"><LoaderCircle size={18} className="spin" /><div><strong>{selectedProject.topic}</strong><span>{m.creativeUi.topic.loadingProject(selectedProject.topic)}</span></div></div>;
  }
  if (!detail || !selectedProject) {
    return <EmptyState title={m.creativeUi.editor.selectLeftTitle} description={m.creativeUi.editor.selectLeftDesc} icon={<FileText size={28} />} />;
  }
  return <CreativeDocumentEditor
    stage={stage}
    detail={detail}
    selectedProject={selectedProject}
    activeFile={activeFile}
    chooseFile={chooseFile}
    dirty={dirty}
    autoSaveStatus={autoSaveStatus}
    saving={saving}
    save={save}
    copyProject={copyProject}
    archiveProject={archiveProject}
    advance={advance}
    exportDraft={exportDraft}
    exporting={exporting}
    publishChecklistEnabled={publishChecklistEnabled}
    draft={draft}
    setDraft={setDraft}
    editorMode={editorMode}
    setEditorMode={setEditorMode}
    editorSelection={editorSelection}
    replaceRange={replaceRange}
    editorRef={editorRef}
    setDirty={setDirty}
    setEditorSelection={setEditorSelection}
    insertLocalFileLink={insertLocalFileLink}
    updateManifest={updateManifest}
  />;
}

function CreativeDocumentEditor({
  stage,
  detail,
  selectedProject,
  activeFile,
  chooseFile,
  dirty,
  autoSaveStatus,
  saving,
  save,
  copyProject,
  archiveProject,
  advance,
  exportDraft,
  exporting,
  publishChecklistEnabled,
  draft,
  setDraft,
  editorMode,
  setEditorMode,
  editorSelection,
  replaceRange,
  editorRef,
  setDirty,
  setEditorSelection,
  insertLocalFileLink,
  updateManifest
}: {
  stage: Stage;
  detail: CreativeProjectDetail;
  selectedProject: CreativeProjectSummary;
  activeFile: string;
  chooseFile(file: string): Promise<void>;
  dirty: boolean;
  autoSaveStatus: "idle" | "saving" | "saved" | "failed";
  saving: boolean;
  save(): Promise<void>;
  copyProject(): Promise<void>;
  archiveProject(): Promise<void>;
  advance(): Promise<void>;
  exportDraft(): Promise<void>;
  exporting: boolean;
  publishChecklistEnabled: boolean;
  draft: string;
  setDraft: Dispatch<SetStateAction<string>>;
  editorMode: "edit" | "preview";
  setEditorMode: (mode: "edit" | "preview") => void;
  editorSelection: EditorSelectionSnapshot;
  replaceRange(start: number, end: number, replacement: string, bookmark?: number): boolean;
  editorRef: RefObject<MarkdownEditorHandle | null>;
  setDirty(value: boolean): void;
  setEditorSelection: (selection: EditorSelectionSnapshot) => void;
  insertLocalFileLink(): Promise<void>;
  updateManifest(patch: Record<string, unknown>): Promise<void>;
}) {
  useLocale();
  const published = stage === "published";
  const publish = (detail.manifest as Record<string, unknown> | undefined)?.publish as Record<string, unknown> | undefined;
  const exported = String(publish?.exportedPath || "");
  return (
    <>
      <header className="creative-document-header">
        <div><div className="document-status"><StatusBadge tone={published ? "success" : "info"}>{stageLabel(stage)}</StatusBadge><span>{dirty ? m.creativeUi.editor.status.editing : autoSaveStatus === "saving" ? m.creativeUi.editor.status.autoSaving : autoSaveStatus === "failed" ? m.creativeUi.editor.status.autoSaveFailed : autoSaveStatus === "saved" ? m.creativeUi.editor.status.autoSaved : m.creativeUi.editor.status.saved}</span></div><h1>{selectedProject.topic}</h1><p>{detail.dir}</p></div>
        <div>
          <Button variant="ghost" data-motion="action" onClick={() => window.openmind.openPath(detail.dir)}><ExternalLink size={14} />{m.creativeUi.editor.openDir}</Button>
          <Button variant="ghost" data-motion="action" aria-busy={saving || undefined} disabled={!dirty || saving} onClick={() => void save()}><Save size={14} />{saving ? m.creativeUi.editor.savingVersion : m.creativeUi.editor.saveVersion}</Button>
          {published ? <Button variant="ghost" data-motion="action" onClick={() => void copyProject()}><Copy size={14} />{m.creativeUi.editor.copy}</Button> : null}
          {published || stage === "ready" ? <Button variant="ghost" data-motion="action" onClick={() => void archiveProject()}><Archive size={14} />{m.creativeUi.editor.archive}</Button> : null}
          {!published ? <Button variant="primary"  data-motion="action" onClick={() => void advance()}><Check size={14} />{m.creativeUi.editor.enterStage(stageLabel(nextStage(stage)))}</Button> : null}
        </div>
      </header>
      <nav className="document-tabs">{Object.keys(detail.files || {}).map((file) => <button aria-pressed={Boolean(activeFile === file)} data-motion="selection" key={file} className={activeFile === file ? "active" : ""} onClick={() => void chooseFile(file)}>{file}</button>)}</nav>
      {published ? (
        <section className="published-summary">
          <header><StatusBadge tone="success">{m.creativeUi.editor.publishedSummary}</StatusBadge>{publish?.publishedAt ? <span>{new Date(String(publish.publishedAt)).toLocaleString(getLocale())}</span> : null}{publish?.platform ? <em>{platformLabel(String(publish.platform))}</em> : null}</header>
          <p>{m.creativeUi.editor.exportFileLabel}：{exported || m.creativeUi.editor.exportNotRecorded}{exported ? <Button variant="ghost" size="sm" data-motion="icon" onClick={() => void window.openmind.openPath(exported)}>{m.creativeUi.editor.openExportedFile}</Button> : null}</p>
          <div className="publish-actions"><Button variant="ghost" data-motion="action" onClick={() => void exportDraft()}>{m.creativeUi.editor.reexport}</Button><Button variant="ghost" data-motion="action" onClick={() => void window.openmind.openPath(detail.dir)}>{m.creativeUi.editor.openDir}</Button></div>
          <small>{m.creativeUi.editor.publishMetricsNote}</small>
        </section>
      ) : null}
      {stage === "ready" ? <PublishForm detail={detail} content={draft} exporting={exporting} enforceChecklist={publishChecklistEnabled} onExport={() => void exportDraft()} onPatch={(patch) => void updateManifest(patch)} /> : null}
      {detail.truncatedFiles?.includes(activeFile) ? <p className="creative-warn">{m.creativeUi.editor.fileTruncatedWarn}</p> : null}
      <div className="creative-editor">
        {published ? <MarkdownReader content={draft} layout="file" /> : (
          <>
            <Tabs
              className="editor-mode-bar"
              value={editorMode}
              label={m.creativeUi.editor.modeBar}
              tabs={[
                { value: "edit", label: m.creativeUi.editor.edit },
                { value: "preview", label: m.creativeUi.editor.preview }
              ]}
              onChange={setEditorMode}
            />
            <div key={editorMode} className="view-fade">
              {editorMode === "preview" ? draft.trim() ? <MarkdownReader content={draft} layout="file" className="creative-preview" /> : <EmptyState title={m.creativeUi.editor.previewEmptyTitle} description={m.creativeUi.editor.previewEmptyDesc} /> : (
                <>
                  <InlineAiBar selection={editorSelection} onReplace={replaceRange} />
                  <MarkdownEditor
                    ref={editorRef}
                    onInsertLocalFile={insertLocalFileLink}
                    ariaLabel={m.creativeUi.editor.textareaAria}
                    value={draft}
                    onChange={(next) => { setDraft(next); setDirty(true); }}
                    onSelectionChange={setEditorSelection}
                  />
                </>
              )}
            </div>
          </>
        )}
      </div>
      <WritingStats content={draft} />
    </>
  );
}
