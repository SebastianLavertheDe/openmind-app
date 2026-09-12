import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Eye, FileOutput, LoaderCircle, Pencil, Plus, Save, Search } from "lucide-react";
import { useAiUi } from "../../ai-context";
import { MarkdownReader } from "../../components/MarkdownReader";
import { EmptyState, ErrorState, StatusBadge } from "../../design-system/components";
import { MarkdownEditor, type EditorSelectionSnapshot } from "../creative/MarkdownEditor";
import { ProjectDialog, ProjectTextField } from "./ProjectDialog";
import { ProjectListDetail } from "./ProjectListDetail";
import { projectsApi } from "./projects-api";
import type { ProjectDetail, ProjectOutput } from "./types";

type SaveState = "idle" | "saving" | "saved" | "failed";

export type ProjectOutputNavigationGuard = {
  isDirty(): boolean;
  flush(): Promise<boolean>;
  discard(): void;
};

export function ProjectOutputsPanel({
  project,
  initialOutputPath,
  createRequested,
  onCreateHandled,
  onChanged,
  onNavigationGuardChange,
  onSelectionChange,
  autoSelectFirst = true,
  listHost,
  detailHost
}: {
  project: ProjectDetail;
  initialOutputPath?: string;
  createRequested: boolean;
  onCreateHandled(): void;
  onChanged(): void;
  onNavigationGuardChange?(guard: ProjectOutputNavigationGuard | null): void;
  onSelectionChange?(relativePath?: string): void;
  autoSelectFirst?: boolean;
  /** Hosted mode: the page may provide either or both visible column hosts. */
  listHost?: HTMLElement | null;
  detailHost?: HTMLElement | null;
}) {
  const ui = useAiUi();
  const [outputs, setOutputs] = useState<ProjectOutput[]>([]);
  const [selectedPath, setSelectedPath] = useState(initialOutputPath || "");
  const [selected, setSelected] = useState<ProjectOutput | null>(null);
  const [title, setTitle] = useState("");
  const [draft, setDraft] = useState("");
  const [mode, setMode] = useState<"edit" | "preview">("edit");
  const [dirty, setDirty] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [reading, setReading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [createTitle, setCreateTitle] = useState("");
  const [creating, setCreating] = useState(false);
  const selectedRef = useRef<ProjectOutput | null>(null);
  const selectedPathRef = useRef(initialOutputPath || "");
  const dirtyRef = useRef(false);
  const draftRef = useRef("");
  const titleRef = useRef("");
  const editVersionRef = useRef(0);
  const saveOperationRef = useRef<Promise<boolean> | null>(null);
  const saveRef = useRef<() => Promise<boolean>>(async () => true);
  const savedTimerRef = useRef<number | null>(null);
  const mountedRef = useRef(true);
  const notifyRef = useRef(ui.notify);
  const confirmRef = useRef(ui.confirm);
  selectedRef.current = selected;
  selectedPathRef.current = selectedPath;
  dirtyRef.current = dirty;
  draftRef.current = draft;
  titleRef.current = title;
  notifyRef.current = ui.notify;
  confirmRef.current = ui.confirm;

  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return outputs.filter((item) => !needle || item.title.toLocaleLowerCase().includes(needle));
  }, [outputs, query]);

  const discardChanges = useCallback(() => {
    dirtyRef.current = false;
    if (mountedRef.current) {
      setDirty(false);
      setSaveState("idle");
    }
  }, []);

  const save = useCallback((): Promise<boolean> => {
    if (saveOperationRef.current) return saveOperationRef.current;
    const operation = (async () => {
      while (dirtyRef.current) {
        const current = selectedRef.current;
        if (!current) {
          discardChanges();
          return true;
        }
        const relativePath = current.relativePath;
        const content = draftRef.current;
        const nextTitle = titleRef.current.trim() || current.title;
        const version = editVersionRef.current;
        if (mountedRef.current) setSaveState("saving");
        let next: ProjectOutput;
        try {
          next = await projectsApi.saveOutput(project.name, relativePath, content, nextTitle);
        } catch (cause) {
          if (mountedRef.current) {
            setSaveState("failed");
            notifyRef.current(errorText(cause), "error");
          }
          return false;
        }

        const stillEditingSameVersion = selectedRef.current?.relativePath === relativePath
          && editVersionRef.current === version;
        if (mountedRef.current) {
          setOutputs((items) => items.some((item) => item.relativePath === relativePath)
            ? items.map((item) => item.relativePath === relativePath ? next : item)
            : [next, ...items]);
        }
        if (!stillEditingSameVersion) continue;

        const persistedDraft = next.content ?? content;
        selectedRef.current = next;
        selectedPathRef.current = next.relativePath;
        titleRef.current = next.title;
        draftRef.current = persistedDraft;
        dirtyRef.current = false;
        if (mountedRef.current) {
          setSelected(next);
          setSelectedPath(next.relativePath);
          setTitle(next.title);
          setDraft(persistedDraft);
          setDirty(false);
          setSaveState("saved");
          if (savedTimerRef.current !== null) window.clearTimeout(savedTimerRef.current);
          savedTimerRef.current = window.setTimeout(() => {
            if (mountedRef.current) setSaveState((value) => value === "saved" ? "idle" : value);
          }, 1800);
        }
      }
      return true;
    })();
    saveOperationRef.current = operation;
    void operation.finally(() => {
      if (saveOperationRef.current === operation) saveOperationRef.current = null;
    });
    return operation;
  }, [discardChanges, project.name]);
  saveRef.current = save;

  const confirmTransition = useCallback(async () => {
    if (!dirtyRef.current) return true;
    if (await save()) return true;
    const discard = await confirmRef.current({
      title: "文档保存失败",
      body: "修改仍未保存。要放弃这些修改并继续吗？",
      confirmText: "放弃修改",
      danger: true
    });
    if (discard) discardChanges();
    return discard;
  }, [discardChanges, save]);

  const readOutput = useCallback(async (relativePath: string, confirmDirty = true) => {
    if (relativePath === selectedRef.current?.relativePath) return;
    if (confirmDirty && !await confirmTransition()) return;
    setReading(true);
    setError(null);
    try {
      const next = await projectsApi.readOutput(project.name, relativePath);
      editVersionRef.current += 1;
      selectedPathRef.current = relativePath;
      selectedRef.current = next;
      titleRef.current = next.title;
      draftRef.current = next.content || "";
      dirtyRef.current = false;
      setSelectedPath(relativePath);
      setSelected(next);
      setTitle(next.title);
      setDraft(next.content || "");
      setDirty(false);
      setSaveState("idle");
      setMode("edit");
      onSelectionChange?.(relativePath);
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setReading(false);
    }
  }, [confirmTransition, onSelectionChange, project.name]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const next = await projectsApi.listOutputs(project.name);
      setOutputs(next);
      setError(null);
      const preferred = next.find((item) => item.relativePath === selectedPathRef.current)
        || next.find((item) => item.relativePath === initialOutputPath)
        || (autoSelectFirst ? next[0] : undefined);
      if (preferred && !selectedRef.current) await readOutput(preferred.relativePath, false);
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setLoading(false);
    }
  }, [autoSelectFirst, initialOutputPath, project.name, readOutput]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (!createRequested) return;
    setCreateTitle("");
    setCreateOpen(true);
    onCreateHandled();
  }, [createRequested, onCreateHandled]);

  useEffect(() => {
    if (!dirty || !selected) return;
    const timer = window.setTimeout(() => { void save(); }, 900);
    return () => window.clearTimeout(timer);
  }, [dirty, draft, save, selected?.relativePath, title]);
  const navigationGuard = useMemo<ProjectOutputNavigationGuard>(() => ({
    isDirty: () => dirtyRef.current,
    flush: save,
    discard: discardChanges
  }), [discardChanges, save]);
  useEffect(() => {
    onNavigationGuardChange?.(navigationGuard);
    return () => onNavigationGuardChange?.(null);
  }, [navigationGuard, onNavigationGuardChange]);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (savedTimerRef.current !== null) window.clearTimeout(savedTimerRef.current);
      if (dirtyRef.current) void saveRef.current();
    };
  }, []);
  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (!dirtyRef.current) return;
      void saveRef.current();
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, []);

  const create = async () => {
    if (!createTitle.trim() || creating) return;
    if (!await confirmTransition()) return;
    setCreating(true);
    try {
      const next = await projectsApi.createOutput(project.name, createTitle.trim());
      editVersionRef.current += 1;
      selectedRef.current = next;
      selectedPathRef.current = next.relativePath;
      titleRef.current = next.title;
      draftRef.current = next.content || "";
      dirtyRef.current = false;
      setOutputs((current) => [next, ...current]);
      setSelected(next);
      setSelectedPath(next.relativePath);
      setTitle(next.title);
      setDraft(next.content || "");
      setDirty(false);
      setMode("edit");
      setCreateOpen(false);
      onSelectionChange?.(next.relativePath);
      onChanged();
      window.requestAnimationFrame(() => document.querySelector<HTMLElement>(".project-output-editor .cm-content")?.focus());
    } catch (cause) {
      ui.notify(errorText(cause), "error");
    } finally {
      setCreating(false);
    }
  };

  const closeDetail = async () => {
    if (!await confirmTransition()) return;
    editVersionRef.current += 1;
    selectedRef.current = null;
    selectedPathRef.current = "";
    dirtyRef.current = false;
    setSelected(null);
    setSelectedPath("");
    setDirty(false);
    onSelectionChange?.();
  };

  const hosted = Boolean(listHost || detailHost);
  const list = (
    <>
      {!hosted ? <header className="project-local-list-header"><div><span className="eyebrow">Markdown 创作</span><h2>文档</h2></div><button className="icon-button" aria-label="新建文档" onClick={() => { setCreateTitle(""); setCreateOpen(true); }}><Plus size={16} /></button></header> : null}
      <label className="project-local-search"><Search size={14} /><input aria-label="搜索文档" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索文档" /></label>
      <div className="project-local-count">全部文档 <span>{filtered.length}</span></div>
      <div className="project-item-list">
        {loading ? Array.from({ length: 5 }, (_, index) => <div className="project-item-skeleton" key={index} />) : null}
        {!loading && !error && !filtered.length ? <EmptyState title={outputs.length ? "没有匹配的文档" : "还没有文档"} description={outputs.length ? "换一个标题关键词后再试。" : "创建空白 Markdown，或从项目任务保存 AI 回答。"} /> : null}
        {filtered.map((item) => <button key={item.relativePath} className={item.relativePath === selectedPath ? "active" : ""} onClick={() => void readOutput(item.relativePath)}><FileOutput size={15} /><span><strong>{item.title}</strong><small>{item.sourceTaskId ? "来自项目任务 · " : ""}{formatTime(item.updatedAt)}</small></span></button>)}
      </div>
    </>
  );

  const detail = reading ? <div className="project-detail-loading"><LoaderCircle size={18} className="spin" />正在读取文档…</div> : error ? <ErrorState message={error} retry={() => selectedPath ? void readOutput(selectedPath, false) : void load()} /> : selected ? (
    <div className="project-output-document" onKeyDownCapture={(event) => { if ((event.metaKey || event.ctrlKey) && event.key.toLocaleLowerCase() === "s") { event.preventDefault(); void save(); } }}>
      <header className="project-output-header">
        <div><span className="eyebrow">项目文档</span><input className="project-output-title" value={title} aria-label="文档标题" onChange={(event) => { const value = event.target.value; editVersionRef.current += 1; titleRef.current = value; dirtyRef.current = true; setTitle(value); setDirty(true); setSaveState("idle"); }} /><p>{selected.relativePath}</p></div>
        <div className="project-output-actions">
          <StatusBadge tone={saveState === "failed" ? "danger" : saveState === "saving" ? "info" : "neutral"}>{saveLabel(saveState, dirty)}</StatusBadge>
          <div className="project-preview-mode" role="group" aria-label="文档查看方式"><button className={mode === "edit" ? "active" : ""} aria-pressed={mode === "edit"} onClick={() => setMode("edit")}><Pencil size={14} />编辑</button><button className={mode === "preview" ? "active" : ""} aria-pressed={mode === "preview"} onClick={() => setMode("preview")}><Eye size={14} />预览</button></div>
          <button disabled={!dirty || saveState === "saving"} onClick={() => void save()}>{saveState === "saving" ? <LoaderCircle size={14} className="spin" /> : <Save size={14} />}保存</button>
        </div>
      </header>
      <div className={`project-output-editor ${mode}`}>
        {mode === "preview" ? <MarkdownReader content={draft} layout="file" /> : <MarkdownEditor value={draft} ariaLabel="Markdown 文档内容" onChange={(value) => { editVersionRef.current += 1; draftRef.current = value; dirtyRef.current = true; setDraft(value); setDirty(true); setSaveState("idle"); }} onSelectionChange={ignoreSelection} />}
      </div>
    </div>
  ) : (
    <EmptyState icon={<FileOutput size={30} />} title="选择或新建文档" description="文档会作为 Markdown 文件保存在当前项目中。" action={<button className="primary-button" onClick={() => setCreateOpen(true)}><Plus size={15} />新建文档</button>} />
  );

  const dialogs = (
    <ProjectDialog open={createOpen} title="新建文档" description="创建一个保存在当前项目中的 Markdown 文档。" confirmLabel="创建并编辑" busy={creating} onClose={() => setCreateOpen(false)} onConfirm={create}>
      <ProjectTextField label="文档标题" value={createTitle} placeholder="例如：AI 安全行业分析" autoFocus onChange={setCreateTitle} />
    </ProjectDialog>
  );
  if (hosted) {
    return (
      <>
        {listHost ? createPortal(list, listHost) : null}
        {detailHost ? createPortal(detail, detailHost) : null}
        {dialogs}
      </>
    );
  }
  return (
    <>
      <ProjectListDetail storageKey={`openmind:projects:outputs-layout:${project.name}`} detailOpen={Boolean(selectedPath)} list={list} detail={detail} detailLabel="文档" onBack={() => void closeDetail()} />
      {dialogs}
    </>
  );
}

function ignoreSelection(_selection: EditorSelectionSnapshot): void {
  // Project outputs do not expose Creative's inline rewrite workflow.
}

function saveLabel(state: SaveState, dirty: boolean): string {
  if (state === "saving") return "保存中";
  if (state === "saved") return "已保存";
  if (state === "failed") return "保存失败";
  return dirty ? "待保存" : "已保存";
}

function formatTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(date);
}

function errorText(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
