import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Eye, FileOutput, LoaderCircle, Pencil, Plus, Save, Search } from "lucide-react";
import { useAiUi } from "../../ai-context";
import { EmptyState, ErrorState, StatusBadge } from "../../design-system/components";
import { MarkdownEditor, type EditorSelectionSnapshot } from "../creative/MarkdownEditor";
import { PreviewRenderer, useFilePreviewController } from "../file-preview";
import type { FilePreviewSource, PreviewResource } from "../file-preview/model";
import { ProjectDialog, ProjectTextField } from "./ProjectDialog";
import { ProjectListDetail } from "./ProjectListDetail";
import { projectOutputPreviewSource } from "./project-output-preview-source";
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
  const [focusPath, setFocusPath] = useState("");
  const [selected, setSelected] = useState<ProjectOutput | null>(null);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [createTitle, setCreateTitle] = useState("");
  const [creating, setCreating] = useState(false);
  const selectedPathRef = useRef(initialOutputPath || "");
  const previewSourceRef = useRef<FilePreviewSource | null>(null);
  const previewResourceRef = useRef<PreviewResource | null>(null);
  const dirtyRef = useRef(false);
  const mountedRef = useRef(true);
  const savedTimerRef = useRef<number | null>(null);
  const saveRef = useRef<() => Promise<boolean>>(async () => true);
  const notifyRef = useRef(ui.notify);
  const confirmRef = useRef(ui.confirm);
  notifyRef.current = ui.notify;
  confirmRef.current = ui.confirm;

  const preview = useFilePreviewController({
    flushOnUnmount: true,
    onSaveError(message) {
      if (mountedRef.current) setSaveState("failed");
      notifyRef.current(message, "error");
    }
  });
  previewSourceRef.current = preview.source;
  previewResourceRef.current = preview.resource;
  dirtyRef.current = preview.dirty;
  const resource = preview.resource?.kind === "document" ? preview.resource : null;

  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return outputs.filter((item) => !needle || item.title.toLocaleLowerCase().includes(needle));
  }, [outputs, query]);

  const acceptOutput = useCallback((next: ProjectOutput) => {
    if (!mountedRef.current) return;
    setOutputs((items) => items.some((item) => item.relativePath === next.relativePath)
      ? items.map((item) => item.relativePath === next.relativePath ? next : item)
      : [next, ...items]);
    if (selectedPathRef.current === next.relativePath) setSelected(next);
  }, []);

  const discardChanges = useCallback(() => {
    dirtyRef.current = false;
    preview.discard();
    if (mountedRef.current) setSaveState("idle");
  }, [preview.discard]);

  const markSaved = useCallback(() => {
    if (!mountedRef.current) return;
    setSaveState("saved");
    if (savedTimerRef.current !== null) window.clearTimeout(savedTimerRef.current);
    savedTimerRef.current = window.setTimeout(() => {
      if (mountedRef.current) setSaveState((value) => value === "saved" ? "idle" : value);
    }, 1800);
  }, []);

  const save = useCallback(async (): Promise<boolean> => {
    if (!dirtyRef.current) return true;
    if (mountedRef.current) setSaveState("saving");
    const saved = await preview.save();
    if (saved) markSaved();
    return saved;
  }, [markSaved, preview.save]);
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

  const readOutput = useCallback(async (
    relativePath: string,
    confirmDirty = true,
    initialOutput?: ProjectOutput
  ): Promise<boolean> => {
    if (relativePath === selectedPathRef.current && previewResourceRef.current) return true;
    if (confirmDirty && !await confirmTransition()) return false;
    selectedPathRef.current = relativePath;
    setSelectedPath(relativePath);
    setSelected(initialOutput || null);
    setSaveState("idle");
    setListError(null);
    onSelectionChange?.(relativePath);
    return preview.openSource(projectOutputPreviewSource(project.name, relativePath, {
      initialOutput,
      onOutput: acceptOutput
    }), { initialMode: "edit", force: true });
  }, [acceptOutput, confirmTransition, onSelectionChange, preview.openSource, project.name]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const next = await projectsApi.listOutputs(project.name);
      setOutputs(next);
      setListError(null);
      const preferred = next.find((item) => item.relativePath === selectedPathRef.current)
        || next.find((item) => item.relativePath === initialOutputPath)
        || (autoSelectFirst ? next[0] : undefined);
      if (preferred && !previewSourceRef.current) await readOutput(preferred.relativePath, false);
    } catch (cause) {
      setListError(errorText(cause));
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
    if (!preview.dirty || !resource) return;
    const timer = window.setTimeout(() => { void save(); }, 900);
    return () => window.clearTimeout(timer);
  }, [preview.dirty, preview.draft.content, preview.draft.title, resource?.path, save]);

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
      setFocusPath(next.relativePath);
      setOutputs((current) => [next, ...current]);
      await readOutput(next.relativePath, false, next);
      setCreateOpen(false);
      onChanged();
    } catch (cause) {
      ui.notify(errorText(cause), "error");
    } finally {
      setCreating(false);
    }
  };

  const closeDetail = async () => {
    if (!await confirmTransition()) return;
    await preview.close();
    selectedPathRef.current = "";
    dirtyRef.current = false;
    setSelected(null);
    setSelectedPath("");
    setSaveState("idle");
    onSelectionChange?.();
  };

  const hosted = Boolean(listHost || detailHost);
  const error = listError || preview.error;
  const saving = preview.saving || saveState === "saving";
  const list = (
    <>
      {!hosted ? <header className="project-local-list-header"><div><span className="eyebrow">Markdown 创作</span><h2>文档</h2></div><button className="icon-button" aria-label="新建文档" onClick={() => { setCreateTitle(""); setCreateOpen(true); }}><Plus size={16} /></button></header> : null}
      <label className="project-local-search"><Search size={14} /><input aria-label="搜索产物" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索产物" /></label>
      <div className="project-local-count">全部产物 <span>{filtered.length}</span></div>
      <div className="project-item-list">
        {loading ? Array.from({ length: 5 }, (_, index) => <div className="project-item-skeleton" key={index} />) : null}
        {!loading && !error && !filtered.length ? <EmptyState title={outputs.length ? "没有匹配的产物" : "还没有产物"} description={outputs.length ? "换一个标题关键词后再试。" : "项目任务完成后，完整生成的文章会自动保存在这里；也可以通过加号新建产物。"} /> : null}
        {filtered.map((item) => <button key={item.relativePath} className={item.relativePath === selectedPath ? "active" : ""} data-motion="selection" onClick={() => void readOutput(item.relativePath)}><FileOutput size={15} /><span><strong>{item.title}</strong><small>{item.sourceTaskId ? "来自项目任务 · " : ""}{formatTime(item.updatedAt)}</small></span></button>)}
      </div>
    </>
  );

  const detail = preview.loading ? <div className="project-detail-loading"><LoaderCircle size={18} className="spin" />正在读取文档…</div> : error ? <ErrorState message={error} retry={() => selectedPath ? void readOutput(selectedPath, false) : void load()} /> : selected && resource ? (
    <div className="project-output-document" onKeyDownCapture={(event) => { if ((event.metaKey || event.ctrlKey) && event.key.toLocaleLowerCase() === "s") { event.preventDefault(); void save(); } }}>
      <header className="project-output-header">
        <div><span className="eyebrow">项目文档</span><input className="project-output-title" value={preview.draft.title} aria-label="文档标题" onChange={(event) => { preview.setTitle(event.target.value); setSaveState("idle"); }} /><p>{selected.relativePath}</p></div>
        <div className="project-output-actions">
          <StatusBadge tone={saveState === "failed" ? "danger" : saving ? "info" : "neutral"}>{saveLabel(saving ? "saving" : saveState, preview.dirty)}</StatusBadge>
          <div className="project-preview-mode" role="group" aria-label="文档查看方式"><button className={preview.mode === "edit" ? "active" : ""} aria-pressed={preview.mode === "edit"} data-motion="selection" onClick={() => void preview.setMode("edit")}><Pencil size={14} />编辑</button><button className={preview.mode === "preview" ? "active" : ""} aria-pressed={preview.mode === "preview"} data-motion="selection" onClick={() => void preview.setMode("preview")}><Eye size={14} />预览</button></div>
          <button data-motion="action" disabled={!preview.dirty || saving} onClick={() => void save()}>{saving ? <LoaderCircle size={14} className="spin" /> : <Save size={14} />}保存</button>
        </div>
      </header>
      <div className={`project-output-editor ${preview.mode}`}>
        {preview.mode === "preview" ? <PreviewRenderer resource={resource} content={preview.draft.content} layout="file" /> : <MarkdownEditor autoFocus={selectedPath === focusPath} value={preview.draft.content} ariaLabel="Markdown 文档内容" onChange={(value) => { preview.setContent(value); setSaveState("idle"); }} onSelectionChange={ignoreSelection} />}
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
