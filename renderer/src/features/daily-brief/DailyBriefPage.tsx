import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Eye, FileText, FolderOpen, Pencil, RefreshCw, Save, Search } from "lucide-react";
import type { ContentEntry, ContentRecord } from "@shared/contracts";
import type { Navigate } from "../../app/routes";
import { useResponsiveLayout, useResponsiveWorkspaceMinimum } from "../../app/responsive-layout";
import { useAi } from "../../ai-context";
import { ContentPreview } from "../../components/ContentPreview";
import { EmptyState, ErrorState, ResponsiveActionBar, Skeleton, Tooltip, type ResponsiveAction } from "../../design-system/components";

type ViewMode = "preview" | "edit";

export function DailyBriefPage({ initialDate }: { go: Navigate; initialDate?: string }) {
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
    if (dirty && !await ai.confirm({ title: "切换简报", body: "当前简报有未保存的修改，确定放弃并切换吗？", confirmText: "放弃并切换", danger: true })) return;
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
      ai.notify("每日简报已保存", "success");
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
      label: saving ? "保存中" : "保存",
      shortLabel: saving ? "保存中" : "保存",
      icon: Save,
      priority: "essential",
      disabled: !dirty || saving || record.truncated,
      className: "document-save-button",
      onSelect: () => void save()
    },
    {
      id: "open",
      label: "打开文件",
      shortLabel: "打开",
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
          <div><span className="eyebrow">每日简报</span><h1>简报文件</h1></div>
          <Tooltip content="刷新简报"><button className="icon-button" aria-label="刷新简报" aria-busy={loading || undefined} disabled={loading} data-motion="icon" onClick={() => void load()}><RefreshCw size={15} className={loading ? "spin" : ""} /></button></Tooltip>
        </header>
        <label className="document-library-search"><Search size={14} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索简报文件" /></label>
        <div className="document-library-count">全部文件 <span>{filteredFiles.length}</span></div>
        <div className="document-file-list entrance-stagger">
          {loading ? Array.from({ length: 7 }, (_, index) => <Skeleton key={index} variant="row" lines={2} label="正在加载简报" />) : null}
          {!loading && !filteredFiles.length ? <EmptyState title="暂无每日简报" description="运行每日文章总结后，生成的文件会显示在这里。" /> : null}
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
              <div><span className="eyebrow">{mode === "preview" ? "预览模式" : dirty ? "编辑中 · 未保存" : "编辑模式"}</span><h2>{briefFileLabel(record.name || record.path)}</h2><p title={record.path}>{record.path}</p></div>
              <div className="document-detail-actions">
                <div className="preview-mode-toggle" role="group" aria-label="查看模式">
                  <button type="button" aria-pressed={mode === "preview"} className={mode === "preview" ? "active" : ""} data-motion="selection" onClick={() => setMode("preview")}><Eye size={14} />预览</button>
                  <button type="button" aria-pressed={mode === "edit"} className={mode === "edit" ? "active" : ""} disabled={record.truncated} data-motion="selection" onClick={() => setMode("edit")}><Pencil size={14} />编辑</button>
                </div>
                <ResponsiveActionBar
                  actions={fileActions}
                  presentation={actionPresentation}
                  overflowLabel="文件操作"
                  className="document-file-actions"
                />
              </div>
            </header>
            <section className={`document-content ${mode}`} aria-busy={reading || undefined}>
              {record.truncated ? <div className="document-warning">文件过大，仅展示前 1 MB 内容，无法在应用内保存。</div> : null}
              <div key={mode} className="document-content-view">
                {mode === "preview" ? <ContentPreview content={{ ...record, content: draft }} layout="file" /> : <textarea aria-label="编辑每日简报" value={draft} spellCheck={false} onChange={(event) => { setDraft(event.target.value); setDirty(true); }} onKeyDown={(event) => { if ((event.ctrlKey || event.metaKey) && event.key.toLocaleLowerCase() === "s") { event.preventDefault(); void save(); } }} />}
              </div>
            </section>
          </div>
        ) : <EmptyState icon={<FileText size={30} />} title="选择一份简报" description="点击左侧文件后，可在右侧预览或编辑具体内容。" />}
      </main>
      </div>
    </div>
  );
}

function briefFileLabel(name: string): string {
  const match = name.match(/(\d{4})(\d{2})(\d{2})_daily_(?:summary|brief)\.md/i);
  return match ? `${match[1]}-${match[2]}-${match[3]} 每日简报` : name.replace(/\.md$/i, "");
}

function formatBytes(size: number): string {
  return size < 1024 ? `${size} B` : `${(size / 1024).toFixed(size < 10240 ? 1 : 0)} KB`;
}

function formatModified(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(date);
}
