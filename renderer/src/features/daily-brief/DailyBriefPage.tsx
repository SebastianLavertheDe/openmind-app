import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Eye, FileText, FolderOpen, LoaderCircle, Pencil, RefreshCw, Save, Search } from "lucide-react";
import type { ContentEntry } from "@shared/contracts";
import { messages as m } from "@shared/messages";
import { useResponsiveLayout, useResponsiveWorkspaceMinimum } from "../../app/responsive-layout";
import { useAiUi } from "../../ai-context";
import { WorkspaceFilePreview } from "../../components/WorkspaceFilePreview";
import { EmptyState, ErrorState, ResponsiveActionBar, Skeleton, Tooltip, type ResponsiveAction } from "../../design-system/components";
import { PreviewRenderer, useFilePreviewController, workspaceFileSource } from "../file-preview";

export function DailyBriefPage({
  initialDate,
  embeddedFilePreviewPath = null,
  onCloseEmbeddedFilePreview
}: {
  initialDate?: string;
  embeddedFilePreviewPath?: string | null;
  onCloseEmbeddedFilePreview?(): void;
}) {
  const layoutRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLElement>(null);
  // The brief can remain usable below the generic split-workspace minimum: its
  // container queries stack the file list and document at this component-owned
  // boundary instead of forcing a global navigation change.
  useResponsiveWorkspaceMinimum("--daily-brief-workspace-min", layoutRef);
  const ui = useAiUi();
  const { actions: actionPresentation } = useResponsiveLayout();
  const [files, setFiles] = useState<ContentEntry[]>([]);
  const [selectedPath, setSelectedPath] = useState("");
  const [pendingPath, setPendingPath] = useState("");
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState("");
  const [query, setQuery] = useState("");
  const openIntentRef = useRef(0);
  const preview = useFilePreviewController({
    onSaved(resource) {
      if (resource.kind !== "document") return;
      setFiles((current) => current.map((file) => file.path === resource.path
        ? { ...file, modifiedAt: new Date().toISOString(), size: new Blob([resource.record.content || ""]).size }
        : file));
    },
    onSaveError(message) {
      ui.notify(message, "error");
    }
  });
  const record = preview.resource?.kind === "document" ? preview.resource.record : null;
  const closeEmbeddedFilePreview = useCallback(() => onCloseEmbeddedFilePreview?.(), [onCloseEmbeddedFilePreview]);

  const confirmBriefSwitch = useCallback(() => ui.confirm({
    title: m.brief.library.switchTitle,
    body: m.brief.library.switchBody,
    confirmText: m.brief.library.switchConfirm,
    danger: true
  }), [ui]);

  const showBriefList = useCallback(async () => {
    const returnTarget = listRef.current?.querySelector<HTMLButtonElement>('[data-brief-selected="true"]');
    if (!await preview.close(confirmBriefSwitch)) return;
    openIntentRef.current += 1;
    setPendingPath("");
    setSelectedPath("");
    window.requestAnimationFrame(() => returnTarget?.focus());
  }, [confirmBriefSwitch, preview.close]);

  const openFile = useCallback(async (path: string, force = false) => {
    if (!path) return false;
    const intent = ++openIntentRef.current;
    if (!force && preview.dirty && !await confirmBriefSwitch()) return false;
    if (intent !== openIntentRef.current) return false;
    setListError("");
    setPendingPath(path);
    try {
      const opened = await preview.openSource(workspaceFileSource(path, { editable: true }), { force: true });
      if (opened && intent === openIntentRef.current) setSelectedPath(path);
      return opened;
    } finally {
      if (intent === openIntentRef.current) setPendingPath("");
    }
  }, [confirmBriefSwitch, preview.dirty, preview.openSource]);

  const load = useCallback(async ({ preserveDirtyCurrent = false }: { preserveDirtyCurrent?: boolean } = {}) => {
    setLoading(true);
    setListError("");
    try {
      const next = await window.openmind.listContent("summaries", "");
      setFiles(next);
      const compact = String(initialDate || "").replace(/\D/g, "").slice(0, 8);
      const preferred = next.find((file) => compact && (file.name || file.path).startsWith(compact)) || next.find((file) => file.path === selectedPath) || next[0];
      const keepDirtyCurrent = preserveDirtyCurrent && preview.dirty && preferred?.path === selectedPath;
      if (preferred) {
        if (!keepDirtyCurrent) await openFile(preferred.path);
      } else if (await preview.close(confirmBriefSwitch)) setSelectedPath("");
    } catch (cause) {
      setListError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  }, [confirmBriefSwitch, initialDate, openFile, preview.close, preview.dirty, selectedPath]);

  useEffect(() => { void load(); }, []);
  useEffect(() => window.openmind.onSkillEvent((event) => {
    if (event.type === "status" && event.state === "success" && String(event.skillId || "") === "daily-article-summarizer") {
      void load({ preserveDirtyCurrent: true });
    }
  }), [load]);

  const filteredFiles = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return files.filter((file) => !needle || `${file.name} ${file.path}`.toLocaleLowerCase().includes(needle));
  }, [files, query]);

  const selectFile = async (path: string) => {
    if (path === selectedPath) {
      if (embeddedFilePreviewPath) closeEmbeddedFilePreview();
      return;
    }
    if (embeddedFilePreviewPath) closeEmbeddedFilePreview();
    await openFile(path);
  };

  const save = async () => {
    if (!record || !preview.dirty || preview.saving) return;
    if (await preview.save()) {
      await preview.setMode("preview");
      ui.notify(m.brief.library.saved, "success");
    }
  };

  const fileActions: ResponsiveAction[] = record ? [
    {
      id: "save",
      label: preview.saving ? m.brief.library.saving : m.brief.library.save,
      shortLabel: preview.saving ? m.brief.library.saving : m.brief.library.save,
      icon: Save,
      priority: "essential",
      disabled: !preview.dirty || preview.saving || record.truncated,
      className: "document-save-button",
      onSelect: () => void save()
    },
    {
      id: "open",
      label: m.brief.library.openFile,
      shortLabel: m.brief.library.open,
      icon: FolderOpen,
      priority: "secondary",
      className: "document-open-button",
      onSelect: () => void preview.source?.openExternal?.()
    }
  ] : [];

  return (
    <div ref={layoutRef} className="brief-library-container">
      <div className="document-library-page brief-library-page" data-detail-open={Boolean(record) || Boolean(pendingPath) || Boolean(embeddedFilePreviewPath) || undefined}>
      <aside className="document-library-list" ref={listRef}>
        <header>
          <div><span className="eyebrow">{m.brief.library.eyebrow}</span><h1>{m.brief.library.title}</h1></div>
          <Tooltip content={m.brief.library.refresh}><button className="icon-button" aria-label={m.brief.library.refresh} aria-busy={loading || undefined} disabled={loading} data-motion="icon" onClick={() => void load()}><RefreshCw size={15} className={loading ? "spin" : ""} /></button></Tooltip>
        </header>
          <label className="document-library-search"><Search size={14} aria-hidden="true" /><input value={query} onChange={(event) => setQuery(event.target.value)} aria-label={m.brief.library.search} placeholder={m.brief.library.search} /></label>
        <div className="document-library-count">{m.brief.library.allFiles} <span>{filteredFiles.length}</span></div>
        <div className="document-file-list entrance-stagger">
          {loading ? Array.from({ length: 7 }, (_, index) => <Skeleton key={index} variant="row" lines={2} label={m.brief.library.loading} />) : null}
          {!loading && !filteredFiles.length ? <EmptyState title={m.brief.library.emptyTitle} description={m.brief.library.emptyDescription} /> : null}
          {filteredFiles.map((file) => (
            <button key={file.path} className={`brief-file-item${selectedPath === file.path ? " active" : ""}${pendingPath === file.path ? " pending" : ""}`} title={briefFileLabel(file.name || file.path.split(/[\\/]/).at(-1) || file.path)} data-brief-selected={selectedPath === file.path || undefined} aria-busy={pendingPath === file.path || undefined} data-entrance-item data-motion="selection" onClick={() => void selectFile(file.path)}>
              <LoaderCircle size={15} className={`brief-file-pending-icon${pendingPath === file.path ? " is-visible spin" : ""}`} aria-hidden="true" />
              <span><strong>{briefFileLabel(file.name || file.path.split(/[\\/]/).at(-1) || file.path)}</strong><small>{formatBytes(file.size || 0)} · {file.modifiedAt ? formatModified(file.modifiedAt) : ""}</small></span>
            </button>
          ))}
        </div>
      </aside>
      <section className="document-library-detail">
        {embeddedFilePreviewPath ? (
          <WorkspaceFilePreview path={embeddedFilePreviewPath} onClose={closeEmbeddedFilePreview} embedded />
        ) : listError || preview.error ? <ErrorState message={listError || preview.error || ""} retry={() => void load()} /> : preview.loading || pendingPath ? (
          <div className="document-detail-opening" role="status" aria-live="polite"><LoaderCircle size={18} className="spin" />正在打开“{briefFileLabel(files.find((file) => file.path === pendingPath)?.name || pendingPath.split(/[\\/]/).at(-1) || pendingPath)}”…</div>
        ) : record && preview.resource ? (
          <div key={selectedPath} className="document-detail-body">
            <header className="document-detail-header">
              <button type="button" className="brief-detail-back" data-motion="action" onClick={() => void showBriefList()}><ArrowLeft size={15} aria-hidden="true" /><span>{m.brief.library.title}</span></button>
              <div><span className="eyebrow">{preview.mode === "preview" ? m.brief.library.previewMode : preview.dirty ? m.brief.library.editingDirty : m.brief.library.editMode}</span><h2>{briefFileLabel(record.name || record.path)}</h2><p title={record.path}>{record.path}</p></div>
              <div className="document-detail-actions">
                <div className="preview-mode-toggle" role="group" aria-label={m.brief.library.viewMode}>
                  <button type="button" aria-pressed={preview.mode === "preview"} className={preview.mode === "preview" ? "active" : ""} data-motion="selection" onClick={() => void preview.setMode("preview")}><Eye size={14} />{m.brief.library.preview}</button>
                  <button type="button" aria-pressed={preview.mode === "edit"} className={preview.mode === "edit" ? "active" : ""} disabled={!preview.canEditContent} data-motion="selection" onClick={() => void preview.setMode("edit")}><Pencil size={14} />{m.brief.library.edit}</button>
                </div>
                <ResponsiveActionBar
                  actions={fileActions}
                  presentation={actionPresentation}
                  overflowLabel={m.brief.library.fileActions}
                  className="document-file-actions"
                />
              </div>
            </header>
            <section className={`document-content ${preview.mode}`} aria-busy={preview.loading || undefined}>
              {record.truncated ? <div className="document-warning">{m.brief.library.truncated}</div> : null}
              <div key={preview.mode} className="document-content-view">
                {preview.mode === "preview" ? <PreviewRenderer resource={preview.resource} content={preview.draft.content} layout="file" /> : <textarea aria-label={m.brief.library.editAria} value={preview.draft.content} spellCheck={false} onChange={(event) => preview.setContent(event.target.value)} onKeyDown={(event) => { if ((event.ctrlKey || event.metaKey) && event.key.toLocaleLowerCase() === "s") { event.preventDefault(); void save(); } }} />}
              </div>
            </section>
          </div>
        ) : <EmptyState icon={<FileText size={30} />} title={m.brief.library.selectTitle} description={m.brief.library.selectDescription} />}
      </section>
      </div>
    </div>
  );
}

function briefFileLabel(name: string): string {
  const match = name.match(/(\d{4})(\d{2})(\d{2})_daily_(?:summary|brief)\.md/i);
  return match ? m.brief.library.fileLabel(`${match[1]}-${match[2]}-${match[3]}`) : name.replace(/\.md$/i, "");
}

function formatBytes(size: number): string {
  return size < 1024 ? `${size} B` : `${(size / 1024).toFixed(size < 10240 ? 1 : 0)} KB`;
}

function formatModified(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(date);
}
