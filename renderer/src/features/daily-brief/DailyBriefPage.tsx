import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Eye, FileText, FolderOpen, Pencil, RefreshCw, Save, Search } from "lucide-react";
import type { ContentEntry, ContentRecord } from "@shared/contracts";
import { messages as m } from "@shared/messages";
import { useResponsiveLayout, useResponsiveWorkspaceMinimum } from "../../app/responsive-layout";
import { useAi } from "../../ai-context";
import { ContentPreview } from "../../components/ContentPreview";
import { EmptyState, ErrorState, ResponsiveActionBar, Skeleton, Tooltip, type ResponsiveAction } from "../../design-system/components";

type ViewMode = "preview" | "edit";

export function DailyBriefPage({ initialDate }: { initialDate?: string }) {
  const layoutRef = useRef<HTMLDivElement>(null);
  // The brief can remain usable below the generic split-workspace minimum: its
  // container queries stack the file list and document at this component-owned
  // boundary instead of forcing a global navigation change.
  useResponsiveWorkspaceMinimum("--daily-brief-workspace-min", layoutRef);
  const ai = useAi();
  const { actions: actionPresentation } = useResponsiveLayout();
  const [files, setFiles] = useState<ContentEntry[]>([]);
  const [selectedPath, setSelectedPath] = useState("");
  const [record, setRecord] = useState<ContentRecord | null>(null);
  const [draft, setDraft] = useState("");
  const [mode, setMode] = useState<ViewMode>("preview");
  const [dirty, setDirty] = useState(false);
  const [loading, setLoading] = useState(true);
  const [reading, setReading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");

  const openFile = useCallback(async (path: string) => {
    if (!path) return;
    setReading(true);
    setError("");
    try {
      const next = await window.openmind.readContent(path);
      setSelectedPath(path);
      setRecord(next);
      setDraft(next.content || "");
      setMode("preview");
      setDirty(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setReading(false);
    }
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const next = await window.openmind.listContent("summaries", "");
      setFiles(next);
      const compact = String(initialDate || "").replace(/\D/g, "").slice(0, 8);
      const preferred = next.find((file) => compact && (file.name || file.path).startsWith(compact)) || next.find((file) => file.path === selectedPath) || next[0];
      if (preferred) await openFile(preferred.path);
      else {
        setSelectedPath("");
        setRecord(null);
        setDraft("");
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  }, [initialDate, openFile, selectedPath]);

  useEffect(() => { void load(); }, []);
  useEffect(() => window.openmind.onSkillEvent((event) => {
    if (event.type === "status" && event.state === "success" && String(event.skillId || "") === "daily-article-summarizer") void load();
  }), [load]);

  const filteredFiles = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return files.filter((file) => !needle || `${file.name} ${file.path}`.toLocaleLowerCase().includes(needle));
  }, [files, query]);

  const selectFile = async (path: string) => {
    if (path === selectedPath) return;
    if (dirty && !await ai.confirm({ title: m.brief.library.switchTitle, body: m.brief.library.switchBody, confirmText: m.brief.library.switchConfirm, danger: true })) return;
    await openFile(path);
  };

  const save = async () => {
    if (!record || !dirty || saving) return;
    setSaving(true);
    try {
      const next = await window.openmind.writeContent(record.path, draft);
      setRecord(next);
      setDraft(next.content || draft);
      setDirty(false);
      setMode("preview");
      ai.notify(m.brief.library.saved, "success");
      setFiles((current) => current.map((file) => file.path === next.path ? { ...file, modifiedAt: new Date().toISOString(), size: new Blob([draft]).size } : file));
    } catch (cause) {
      ai.notify(cause instanceof Error ? cause.message : String(cause), "error");
    } finally {
      setSaving(false);
    }
  };

  const fileActions: ResponsiveAction[] = record ? [
    {
      id: "save",
      label: saving ? m.brief.library.saving : m.brief.library.save,
      shortLabel: saving ? m.brief.library.saving : m.brief.library.save,
      icon: Save,
      priority: "essential",
      disabled: !dirty || saving || record.truncated,
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
      onSelect: () => void window.openmind.openPath(record.path)
    }
  ] : [];

  return (
    <div ref={layoutRef} className="brief-library-container">
      <div className="document-library-page brief-library-page">
      <aside className="document-library-list">
        <header>
          <div><span className="eyebrow">{m.brief.library.eyebrow}</span><h1>{m.brief.library.title}</h1></div>
          <Tooltip content={m.brief.library.refresh}><button className="icon-button" aria-label={m.brief.library.refresh} aria-busy={loading || undefined} disabled={loading} data-motion="icon" onClick={() => void load()}><RefreshCw size={15} className={loading ? "spin" : ""} /></button></Tooltip>
        </header>
        <label className="document-library-search"><Search size={14} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={m.brief.library.search} /></label>
        <div className="document-library-count">{m.brief.library.allFiles} <span>{filteredFiles.length}</span></div>
        <div className="document-file-list entrance-stagger">
          {loading ? Array.from({ length: 7 }, (_, index) => <Skeleton key={index} variant="row" lines={2} label={m.brief.library.loading} />) : null}
          {!loading && !filteredFiles.length ? <EmptyState title={m.brief.library.emptyTitle} description={m.brief.library.emptyDescription} /> : null}
          {filteredFiles.map((file) => (
            <button key={file.path} className={`brief-file-item${selectedPath === file.path ? " active" : ""}`} data-entrance-item data-motion="selection" onClick={() => void selectFile(file.path)}>
              <FileText size={16} />
              <span><strong>{briefFileLabel(file.name || file.path.split(/[\\/]/).at(-1) || file.path)}</strong><small>{formatBytes(file.size || 0)} · {file.modifiedAt ? formatModified(file.modifiedAt) : ""}</small></span>
            </button>
          ))}
        </div>
      </aside>
      <main className="document-library-detail">
        {error ? <ErrorState message={error} retry={() => void load()} /> : record ? (
          <div key={selectedPath} className="document-detail-body">
            <header className="document-detail-header">
              <div><span className="eyebrow">{mode === "preview" ? m.brief.library.previewMode : dirty ? m.brief.library.editingDirty : m.brief.library.editMode}</span><h2>{briefFileLabel(record.name || record.path)}</h2><p title={record.path}>{record.path}</p></div>
              <div className="document-detail-actions">
                <div className="preview-mode-toggle" role="group" aria-label={m.brief.library.viewMode}>
                  <button type="button" aria-pressed={mode === "preview"} className={mode === "preview" ? "active" : ""} data-motion="selection" onClick={() => setMode("preview")}><Eye size={14} />{m.brief.library.preview}</button>
                  <button type="button" aria-pressed={mode === "edit"} className={mode === "edit" ? "active" : ""} disabled={record.truncated} data-motion="selection" onClick={() => setMode("edit")}><Pencil size={14} />{m.brief.library.edit}</button>
                </div>
                <ResponsiveActionBar
                  actions={fileActions}
                  presentation={actionPresentation}
                  overflowLabel={m.brief.library.fileActions}
                  className="document-file-actions"
                />
              </div>
            </header>
            <section className={`document-content ${mode}`} aria-busy={reading || undefined}>
              {record.truncated ? <div className="document-warning">{m.brief.library.truncated}</div> : null}
              <div key={mode} className="document-content-view">
                {mode === "preview" ? <ContentPreview content={{ ...record, content: draft }} layout="file" /> : <textarea aria-label={m.brief.library.editAria} value={draft} spellCheck={false} onChange={(event) => { setDraft(event.target.value); setDirty(true); }} onKeyDown={(event) => { if ((event.ctrlKey || event.metaKey) && event.key.toLocaleLowerCase() === "s") { event.preventDefault(); void save(); } }} />}
              </div>
            </section>
          </div>
        ) : <EmptyState icon={<FileText size={30} />} title={m.brief.library.selectTitle} description={m.brief.library.selectDescription} />}
      </main>
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
