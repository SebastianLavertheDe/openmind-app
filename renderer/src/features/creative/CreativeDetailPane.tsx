import type { Dispatch, RefObject, SetStateAction } from "react";
import {
  Archive,
  Bold,
  Check,
  Code,
  Code2,
  Copy,
  ExternalLink,
  FileText,
  FolderOpen,
  Heading2,
  Image as ImageIcon,
  Italic,
  Link as LinkIcon,
  List,
  ListOrdered,
  Quote,
  Save
} from "lucide-react";
import type { ContentRecord, CreativeProjectDetail, CreativeProjectSummary, CreativeTopic, CreativeVersion } from "@shared/contracts";
import { messages as m } from "@shared/messages";
import { EmptyState, StatusBadge } from "../../design-system/components";
import { MarkdownReader } from "../../components/MarkdownReader";
import { HistoryView, ReleaseLogView } from "./history-release";
import { PublishForm, TopicWorkspace, WritingStats } from "./panels";
import { InlineAiBar } from "./InlineAiBar";
import { MarkdownEditor, type EditorSelectionSnapshot, type MarkdownEditorHandle } from "./MarkdownEditor";
import { TopicFileWorkspace } from "./TopicFileWorkspace";
import { type PlatformOption, type Stage, type WorkspaceView, nextStage, platformLabel, stageLabel } from "./types";

export function CreativeDetailPane({
  view,
  stage,
  date,
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
  setTopicFileDirty,
  saveTopicFile,
  versions,
  activeFile,
  chooseFile,
  setVersions,
  setDetail,
  setDraft,
  createProject,
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
  insertAtCursor,
  editorSelection,
  replaceRange,
  editorRef,
  setDirty,
  setEditorSelection,
  insertLocalFileLink,
  updateManifest
}: {
  view: WorkspaceView;
  stage: Stage;
  date: string;
  detail: CreativeProjectDetail | null;
  selectedProject: CreativeProjectSummary | null;
  selectedTopic: CreativeTopic | null;
  selectedTopicDate: string;
  selectedTopicFile: ContentRecord | null;
  topicFileDraft: string;
  topicFileMode: "preview" | "edit";
  topicFileDirty: boolean;
  topicFileSaving: boolean;
  setTopicFileDraft: Dispatch<SetStateAction<string>>;
  setTopicFileMode: (mode: "preview" | "edit") => void;
  setTopicFileDirty: Dispatch<SetStateAction<boolean>>;
  saveTopicFile(): Promise<void>;
  versions: CreativeVersion[];
  activeFile: string;
  chooseFile(file: string): Promise<void>;
  setVersions: Dispatch<SetStateAction<CreativeVersion[]>>;
  setDetail: Dispatch<SetStateAction<CreativeProjectDetail | null>>;
  setDraft: Dispatch<SetStateAction<string>>;
  createProject(platform?: PlatformOption, topicOverride?: CreativeTopic): Promise<void>;
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
  insertAtCursor(before: string, after?: string, placeholder?: string): void;
  editorSelection: EditorSelectionSnapshot;
  replaceRange(start: number, end: number, replacement: string): void;
  editorRef: RefObject<MarkdownEditorHandle | null>;
  setDirty(value: boolean): void;
  setEditorSelection: (selection: EditorSelectionSnapshot) => void;
  insertLocalFileLink(): Promise<void>;
  updateManifest(patch: Record<string, unknown>): Promise<void>;
}) {
  if (view === "history") {
    return <HistoryView detail={detail} selectedProject={selectedProject} activeFile={activeFile} versions={versions} chooseFile={chooseFile} files={detail ? Object.keys(detail.files || {}) : []} onVersionsChange={setVersions} onRestored={(next) => { setDetail(next); setDraft(next.files?.[activeFile] || ""); }} />;
  }
  if (view === "release") return <ReleaseLogView detail={detail} selectedProject={selectedProject} />;
  if (selectedTopicFile) {
    return <TopicFileWorkspace
      file={selectedTopicFile}
      draft={topicFileDraft}
      mode={topicFileMode}
      dirty={topicFileDirty}
      saving={topicFileSaving}
      onMode={setTopicFileMode}
      onDraft={(value) => { setTopicFileDraft(value); setTopicFileDirty(true); }}
      onSave={() => void saveTopicFile()}
    />;
  }
  if (selectedTopic) {
    return <TopicWorkspace
      topic={selectedTopic}
      date={selectedTopicDate}
      createProject={createProject}
      addContext={addContext}
    />;
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
    insertAtCursor={insertAtCursor}
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
  insertAtCursor,
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
  insertAtCursor(before: string, after?: string, placeholder?: string): void;
  editorSelection: EditorSelectionSnapshot;
  replaceRange(start: number, end: number, replacement: string): void;
  editorRef: RefObject<MarkdownEditorHandle | null>;
  setDirty(value: boolean): void;
  setEditorSelection: (selection: EditorSelectionSnapshot) => void;
  insertLocalFileLink(): Promise<void>;
  updateManifest(patch: Record<string, unknown>): Promise<void>;
}) {
  const published = stage === "published";
  const publish = (detail.manifest as Record<string, unknown> | undefined)?.publish as Record<string, unknown> | undefined;
  const exported = String(publish?.exportedPath || "");
  return (
    <>
      <header className="creative-document-header">
        <div><div className="document-status"><StatusBadge tone={published ? "success" : "info"}>{stageLabel(stage)}</StatusBadge><span>{dirty ? "编辑中…" : autoSaveStatus === "saving" ? "自动保存中…" : autoSaveStatus === "failed" ? "自动保存失败，可重试保存" : autoSaveStatus === "saved" ? "已自动保存" : "已保存"}</span></div><h1>{selectedProject.topic}</h1><p>{detail.dir}</p></div>
        <div>
          <button data-motion="action" onClick={() => window.openmind.openPath(detail.dir)}><ExternalLink size={14} />{m.creativeUi.editor.openDir}</button>
          <button data-motion="action" aria-busy={saving || undefined} disabled={!dirty || saving} onClick={() => void save()}><Save size={14} />{saving ? "保存中" : "保存版本"}</button>
          {published ? <button data-motion="action" onClick={() => void copyProject()}><Copy size={14} />复制</button> : null}
          {published || stage === "ready" ? <button data-motion="action" onClick={() => void archiveProject()}><Archive size={14} />归档</button> : null}
          {!published ? <button className="primary-button" data-motion="action" onClick={() => void advance()}><Check size={14} />进入{stageLabel(nextStage(stage))}</button> : null}
        </div>
      </header>
      <nav className="document-tabs">{Object.keys(detail.files || {}).map((file) => <button data-motion="selection" key={file} className={activeFile === file ? "active" : ""} onClick={() => void chooseFile(file)}>{file}</button>)}</nav>
      {published ? (
        <section className="published-summary">
          <header><StatusBadge tone="success">{m.creativeUi.editor.publishedSummary}</StatusBadge>{publish?.publishedAt ? <span>{new Date(String(publish.publishedAt)).toLocaleString("zh-CN")}</span> : null}{publish?.platform ? <em>{platformLabel(String(publish.platform))}</em> : null}</header>
          <p>{m.creativeUi.editor.exportFileLabel}：{exported || m.creativeUi.editor.exportNotRecorded}{exported ? <button data-motion="icon" onClick={() => void window.openmind.openPath(exported)}>{m.creativeUi.editor.openExportedFile}</button> : null}</p>
          <div className="publish-actions"><button data-motion="action" onClick={() => void exportDraft()}>{m.creativeUi.editor.reexport}</button><button data-motion="action" onClick={() => void window.openmind.openPath(detail.dir)}>{m.creativeUi.editor.openDir}</button></div>
          <small>{m.creativeUi.editor.publishMetricsNote}</small>
        </section>
      ) : null}
      {stage === "ready" ? <PublishForm detail={detail} content={draft} exporting={exporting} enforceChecklist={publishChecklistEnabled} onExport={() => void exportDraft()} onPatch={(patch) => void updateManifest(patch)} /> : null}
      {detail.truncatedFiles?.includes(activeFile) ? <p className="creative-warn">{m.creativeUi.editor.fileTruncatedWarn}</p> : null}
      <div className="creative-editor">
        {published ? <MarkdownReader content={draft} layout="file" /> : (
          <>
            <div className="editor-mode-bar" role="tablist" aria-label={m.creativeUi.editor.modeBar}>
              <button data-motion="selection" role="tab" aria-selected={editorMode === "edit"} className={editorMode === "edit" ? "active" : ""} onClick={() => setEditorMode("edit")}>{m.creativeUi.editor.edit}</button>
              <button data-motion="selection" role="tab" aria-selected={editorMode === "preview"} className={editorMode === "preview" ? "active" : ""} onClick={() => setEditorMode("preview")}>{m.creativeUi.editor.preview}</button>
            </div>
            <div key={editorMode} className="view-fade">
              {editorMode === "preview" ? draft.trim() ? <MarkdownReader content={draft} layout="file" className="creative-preview" /> : <EmptyState title={m.creativeUi.editor.previewEmptyTitle} description={m.creativeUi.editor.previewEmptyDesc} /> : (
                <>
                  <MarkdownToolbar insertAtCursor={insertAtCursor} insertLocalFileLink={insertLocalFileLink} />
                  <InlineAiBar selection={editorSelection} onReplace={replaceRange} />
                  <MarkdownEditor
                    ref={editorRef}
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

function MarkdownToolbar({ insertAtCursor, insertLocalFileLink }: { insertAtCursor(before: string, after?: string, placeholder?: string): void; insertLocalFileLink(): Promise<void> }) {
  return <div className="editor-toolbar" role="toolbar" aria-label={m.creativeUi.editor.toolbar}>
    <button data-motion="icon" onClick={() => insertAtCursor("## ", "", m.creativeUi.editor.headingPlaceholder)} title={m.creativeUi.editor.heading} aria-label={m.creativeUi.editor.heading}><Heading2 size={15} /></button>
    <button data-motion="icon" onClick={() => insertAtCursor("**", "**", m.creativeUi.editor.boldPlaceholder)} title={m.creativeUi.editor.shortcutBold} aria-label={m.creativeUi.editor.bold}><Bold size={15} /></button>
    <button data-motion="icon" onClick={() => insertAtCursor("*", "*", m.creativeUi.editor.italicPlaceholder)} title={m.creativeUi.editor.shortcutItalic} aria-label={m.creativeUi.editor.italic}><Italic size={15} /></button>
    <span className="editor-toolbar-sep" aria-hidden="true" />
    <button data-motion="icon" onClick={() => insertAtCursor("- ", "", m.creativeUi.editor.listPlaceholder)} title={m.creativeUi.editor.list} aria-label={m.creativeUi.editor.list}><List size={15} /></button>
    <button data-motion="icon" onClick={() => insertAtCursor("1. ", "", m.creativeUi.editor.listPlaceholder)} title={m.creativeUi.editor.orderedList} aria-label={m.creativeUi.editor.orderedList}><ListOrdered size={15} /></button>
    <button data-motion="icon" onClick={() => insertAtCursor("> ", "", m.creativeUi.editor.quotePlaceholder)} title={m.creativeUi.editor.quote} aria-label={m.creativeUi.editor.quote}><Quote size={15} /></button>
    <span className="editor-toolbar-sep" aria-hidden="true" />
    <button data-motion="icon" onClick={() => insertAtCursor("`", "`", m.creativeUi.editor.inlineCodePlaceholder)} title={m.creativeUi.editor.shortcutCode} aria-label={m.creativeUi.editor.inlineCode}><Code size={15} /></button>
    <button data-motion="icon" onClick={() => insertAtCursor("\n```\n", "\n```\n", m.creativeUi.editor.codePlaceholder)} title={m.creativeUi.editor.code} aria-label={m.creativeUi.editor.code}><Code2 size={15} /></button>
    <span className="editor-toolbar-sep" aria-hidden="true" />
    <button data-motion="icon" onClick={() => insertAtCursor("[", "](https://)", m.creativeUi.editor.linkPlaceholder)} title={m.creativeUi.editor.shortcutLink} aria-label={m.creativeUi.editor.link}><LinkIcon size={15} /></button>
    <button data-motion="icon" onClick={() => insertAtCursor("![", "](https://)", m.creativeUi.editor.imagePlaceholder)} title={m.creativeUi.editor.image} aria-label={m.creativeUi.editor.image}><ImageIcon size={15} /></button>
    <button data-motion="icon" onClick={() => void insertLocalFileLink()} title={m.creativeUi.editor.localFile} aria-label={m.creativeUi.editor.localFile}><FolderOpen size={15} /></button>
  </div>;
}
