import { DailyPreferences } from "../sources/DailyPreferences";
import { isMissingFileError } from "../file-preview/missing-file";
import { useBeforeSessionNavigation } from "../../app/session-navigation";
import { useSessionOrigin } from "../../app/session-origin-context";
import { useFeedback } from "../../feedback-context";
import { IconButton, Button } from "../../design-system/components";
import { SegmentedControl } from "../../design-system/controls";
import { useLocale } from "../../i18n";
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { ArrowLeft, Eye, FileText, FolderOpen, LoaderCircle, Pencil, RefreshCw, Save } from "lucide-react";
import type { ContentEntry } from "@shared/contracts";
import { messages as m } from "@shared/messages";
import { useResponsiveLayout, useResponsiveWorkspaceMinimum } from "../../app/responsive-layout";
import { WorkspaceFilePreview } from "../../components/WorkspaceFilePreview";
import { useContentListLayout } from "../../components/useContentListLayout";
import { EmptyState, ErrorState, ResponsiveActionBar, Skeleton, type ResponsiveAction, SearchInput, Textarea } from "../../design-system/components";
import { PreviewRenderer, useFilePreviewController, workspaceFileSource } from "../file-preview";

export function DailyBriefPage({
  initialDate,
  initialFilePath,
  embeddedFilePreviewPath = null,
  onCloseEmbeddedFilePreview,
  onManageSources
}: {
  initialDate?: string;
  initialFilePath?: string | null;
  embeddedFilePreviewPath?: string | null;
  onCloseEmbeddedFilePreview?(): void;
  onManageSources?(): void;
}) {
  const locale = useLocale();
  const layoutRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLElement>(null);
  const listLayout = useContentListLayout();
  // The brief can remain usable below the generic split-workspace minimum: its
  // container queries stack the file list and document at this component-owned
  // boundary instead of forcing a global navigation change.
  useResponsiveWorkspaceMinimum("--daily-brief-workspace-min", layoutRef);
  const feedback = useFeedback();
  const { actions: actionPresentation } = useResponsiveLayout();
  const [files, setFiles] = useState<ContentEntry[]>([]);
  const [selectedPath, setSelectedPath] = useState("");
  const restoredSelection = useRef(false);
  useSessionOrigin({ page: "brief", filePath: selectedPath || null, previewPath: embeddedFilePreviewPath });
  const [pendingPath, setPendingPath] = useState("");
  const [loading, setLoading] = useState(true);
  const [hasLoaded, setHasLoaded] = useState(false);
  const loadSequence = useRef(0);
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
      feedback.notify(message, "error");
    }
  });
  useEffect(() => {
    if (initialFilePath !== undefined && isMissingFileError(preview.error)) {
      setSelectedPath("");
      void preview.close();
    }
  }, [initialFilePath, preview.error, preview.close]);
  const record = preview.resource?.kind === "document" ? preview.resource.record : null;
  const closeEmbeddedFilePreview = useCallback(() => onCloseEmbeddedFilePreview?.(), [onCloseEmbeddedFilePreview]);

  const confirmBriefSwitch = useCallback(() => feedback.confirm({
    title: m.brief.library.switchTitle,
    body: m.brief.library.switchBody,
    confirmText: m.brief.library.switchConfirm,
    danger: true
  }), [feedback]);

  useBeforeSessionNavigation(useCallback(() => !preview.dirty || confirmBriefSwitch(), [preview.dirty, confirmBriefSwitch]));

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

  const currentView = useRef({ selectedPath, preview, openFile });
  currentView.current = { selectedPath, preview, openFile };
  const load = useCallback(async ({ preserveDirtyCurrent = false }: { preserveDirtyCurrent?: boolean } = {}) => {
    const request = ++loadSequence.current;
    const selectionIntent = openIntentRef.current;
    setLoading(true);
    setListError("");
    try {
      const next = await window.openmind.listContent("summaries", "");
      if (request !== loadSequence.current) return;
      setFiles(next);
      setHasLoaded(true);
      // A click while the list refreshes owns the selection; a late list response
      // must not navigate back to the file that was selected when it started.
      if (selectionIntent !== openIntentRef.current) return;
      const current = currentView.current;
      const compact = String(initialDate || "").replace(/\D/g, "").slice(0, 8);
      const restoring = initialFilePath !== undefined && !restoredSelection.current;
      const preferred = restoring ? next.find(file => file.path === initialFilePath) : next.find((file) => file.path === current.selectedPath) || next.find((file) => compact && (file.name || file.path).startsWith(compact)) || next[0];
      restoredSelection.current = true;
      const keepDirtyCurrent = preserveDirtyCurrent && current.preview.dirty && preferred?.path === current.selectedPath;
      if (preferred) {
        if (!keepDirtyCurrent) await current.openFile(preferred.path);
      } else if (await current.preview.close(confirmBriefSwitch)) setSelectedPath("");
    } catch (cause) {
      if (request === loadSequence.current) setListError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (request === loadSequence.current) setLoading(false);
    }
  }, [confirmBriefSwitch, initialDate, initialFilePath]);

  useEffect(() => {
    void load();
    return () => { loadSequence.current += 1; };
  }, []);
  useEffect(() => window.openmind.onSkillEvent((event) => {
    if (event.type === "status" && event.state === "success" && String(event.skillId || "") === "daily-article-summarizer") {
      void load({ preserveDirtyCurrent: true });
    }
  }), [load]);

  const filteredFiles = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return files.filter((file) => !needle || `${file.name} ${file.path}`.toLocaleLowerCase().includes(needle));
  }, [files, query, locale]);

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
      feedback.notify(m.brief.library.saved, "success");
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
    <div ref={layoutRef} className="brief-library-container" style={{ "--content-list-width": `${listLayout.layout.listWidth}px` } as CSSProperties}>
      <div className="document-library-page brief-library-page" data-detail-open={Boolean(record) || Boolean(pendingPath) || Boolean(embeddedFilePreviewPath) || undefined}>
      <aside className="document-library-list" ref={listRef}>
        <header>
          <div><span className="eyebrow">{m.brief.library.eyebrow}</span><h1>{m.brief.library.title}</h1></div>
          <IconButton label={m.brief.library.refresh} aria-busy={loading || undefined} disabled={loading} data-motion="icon" onClick={() => void load()}><RefreshCw size={15} className={loading ? "spin" : ""} /></IconButton>
        </header>
          <div className="brief-preference-actions">
            <DailyPreferences />
            {onManageSources ? <Button variant="secondary" size="sm" onClick={onManageSources}>{m.rss.manage}</Button> : null}
          </div>
          <SearchInput className="document-library-search" variant="quiet" value={query} onChange={(event) => setQuery(event.target.value)} aria-label={m.brief.library.search} placeholder={m.brief.library.search} />
        <div className="document-library-count">{m.brief.library.allFiles} <span>{filteredFiles.length}</span></div>
        <div className="document-file-list entrance-stagger" aria-busy={loading || undefined}>
          {loading && !hasLoaded ? Array.from({ length: 7 }, (_, index) => <Skeleton key={index} variant="row" lines={2} label={m.brief.library.loading} />) : null}
          {!loading && !listError && !filteredFiles.length ? <EmptyState title={m.brief.library.emptyTitle} description={m.brief.library.emptyDescription} /> : null}
          {filteredFiles.map((file) => {
            const name = file.name || file.path.split(/[\\/]/).at(-1) || file.path;
            const date = briefFileDate(name);
            const label = briefFileLabel(name);
            return (
              <button aria-pressed={Boolean(selectedPath === file.path)} key={file.path} className={`brief-file-item${selectedPath === file.path ? " active" : ""}${pendingPath === file.path ? " pending" : ""}`} title={label} data-brief-selected={selectedPath === file.path || undefined} aria-busy={pendingPath === file.path || undefined} data-entrance-item data-motion="selection" onClick={() => void selectFile(file.path)}>
                <LoaderCircle size={15} className={`brief-file-pending-icon${pendingPath === file.path ? " is-visible spin" : ""}`} aria-hidden="true" />
                <span><strong>{date || label}</strong>{date ? <small>{m.brief.library.eyebrow}</small> : null}</span>
              </button>
            );
          })}
          {!loading && listError ? <ErrorState message={listError} retry={() => void load()} /> : null}
        </div>
      </aside>
      <section className="document-library-detail">
        {embeddedFilePreviewPath ? (
          <WorkspaceFilePreview path={embeddedFilePreviewPath} onClose={closeEmbeddedFilePreview} embedded />
        ) : preview.error ? <ErrorState message={preview.error} retry={() => void load()} /> : preview.loading || pendingPath ? (
          <div className="document-detail-opening" role="status" aria-live="polite"><LoaderCircle size={18} className="spin" />{m.interface.openingNamed(briefFileLabel(files.find((file) => file.path === pendingPath)?.name || pendingPath.split(/[\\/]/).at(-1) || pendingPath))}</div>
        ) : record && preview.resource ? (
          <div key={selectedPath} className="document-detail-body">
            <header className="document-detail-header">
              <Button type="button" className="brief-detail-back" data-motion="action" onClick={() => void showBriefList()}><ArrowLeft size={15} aria-hidden="true" /><span>{m.brief.library.title}</span></Button>
              <div><span className="eyebrow">{preview.mode === "preview" ? m.brief.library.previewMode : preview.dirty ? m.brief.library.editingDirty : m.brief.library.editMode}</span><h2>{briefFileLabel(record.name || record.path)}</h2><p title={record.path}>{record.path}</p></div>
              <div className="document-detail-actions">
                <SegmentedControl value={preview.mode} onChange={mode => preview.setMode(mode)} label={m.brief.library.viewMode} options={[
                  { value: "preview", label: m.brief.library.preview, icon: <Eye size={14} /> },
                  { value: "edit", label: m.brief.library.edit, icon: <Pencil size={14} />, disabled: !preview.canEditContent }
                ]} />
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
                {preview.mode === "preview" ? <PreviewRenderer resource={preview.resource} content={preview.draft.content} layout="file" /> : <Textarea variant="code" aria-label={m.brief.library.editAria} value={preview.draft.content} spellCheck={false} onChange={(event) => preview.setContent(event.target.value)} onKeyDown={(event) => { if ((event.ctrlKey || event.metaKey) && event.key.toLocaleLowerCase() === "s") { event.preventDefault(); void save(); } }} />}
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
  const date = briefFileDate(name);
  return date ? m.brief.library.fileLabel(date) : name.replace(/\.md$/i, "");
}

function briefFileDate(name: string): string | null {
  const match = name.match(/(\d{4})(\d{2})(\d{2})_daily_(?:summary|brief)\.md/i);
  return match ? `${match[1]}-${match[2]}-${match[3]}` : null;
}
