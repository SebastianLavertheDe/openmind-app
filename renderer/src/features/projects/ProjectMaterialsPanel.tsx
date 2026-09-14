import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import { createPortal } from "react-dom";
import { AlertTriangle, FilePlus2, FileText, Globe2, LoaderCircle, Plus, RefreshCw, Search, Upload, Video } from "lucide-react";
import { useAiUi } from "../../ai-context";
import { EmptyState, ErrorState } from "../../design-system/components";
import { PreviewRenderer, useFilePreviewController } from "../file-preview";
import type { PreviewResource } from "../file-preview/model";
import { ProjectDialog } from "./ProjectDialog";
import { ProjectListDetail } from "./ProjectListDetail";
import { projectMaterialPreviewSource } from "./project-material-preview-source";
import { projectsApi } from "./projects-api";
import type { ProjectDetail, ProjectMaterial, ProjectMaterialKind } from "./types";
import type { ProjectTaskSeed } from "./ProjectTasksPanel";

type MaterialFilter = "all" | ProjectMaterialKind;

export function ProjectMaterialsPanel({
  project,
  initialMaterialPath,
  createRequested,
  onCreateHandled,
  onCreateTask,
  onChanged,
  onSelectionChange,
  autoSelectFirst = true,
  listHost,
  detailHost
}: {
  project: ProjectDetail;
  initialMaterialPath?: string;
  createRequested: boolean;
  onCreateHandled(): void;
  onCreateTask(seed: ProjectTaskSeed): void;
  onChanged(): void;
  onSelectionChange?(relativePath?: string): void;
  autoSelectFirst?: boolean;
  /** Hosted mode: the page may provide either or both visible column hosts. */
  listHost?: HTMLElement | null;
  detailHost?: HTMLElement | null;
}) {
  const ui = useAiUi();
  const [materials, setMaterials] = useState<ProjectMaterial[]>([]);
  const [selectedPath, setSelectedPath] = useState(initialMaterialPath || "");
  const [selected, setSelected] = useState<ProjectMaterial | null>(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<MaterialFilter>("all");
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [url, setUrl] = useState("");
  const [adding, setAdding] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [retryingPath, setRetryingPath] = useState("");
  const materialsRef = useRef<ProjectMaterial[]>([]);
  const selectedRef = useRef<ProjectMaterial | null>(null);
  const previewResourceRef = useRef<PreviewResource | null>(null);
  const selectedPathRef = useRef(initialMaterialPath || "");
  const onSelectionChangeRef = useRef(onSelectionChange);
  materialsRef.current = materials;
  selectedRef.current = selected;
  onSelectionChangeRef.current = onSelectionChange;
  const preview = useFilePreviewController();
  previewResourceRef.current = preview.resource;

  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return materials.filter((item) => (filter === "all" || item.kind === filter) && (!needle || `${item.title} ${item.relativePath} ${item.sourceUrl || ""}`.toLocaleLowerCase().includes(needle)));
  }, [filter, materials, query]);

  const openMaterial = useCallback(async (relativePath: string) => {
    if (relativePath === selectedPathRef.current && selectedRef.current?.status === "ready" && previewResourceRef.current) return;
    selectedPathRef.current = relativePath;
    setSelectedPath(relativePath);
    onSelectionChangeRef.current?.(relativePath);
    setListError(null);
    const known = materialsRef.current.find((item) => item.relativePath === relativePath);
    if (known && known.status !== "ready") {
      setSelected(known);
      preview.discard();
      void preview.close();
      return;
    }
    setSelected(null);
    await preview.openSource(projectMaterialPreviewSource(project.name, relativePath, {
      onMaterial: (material) => {
        if (selectedPathRef.current === relativePath) setSelected(material);
      }
    }), { force: true });
  }, [preview.close, preview.discard, preview.openSource, project.name]);

  const load = useCallback(async () => {
    setLoading(true);
    setListError(null);
    try {
      const next = await projectsApi.listMaterials(project.name);
      setMaterials(next);
      materialsRef.current = next;
      const preferred = next.find((item) => item.relativePath === selectedPathRef.current)
        || next.find((item) => item.relativePath === initialMaterialPath)
        || (autoSelectFirst ? next[0] : undefined);
      if (preferred) await openMaterial(preferred.relativePath);
      else {
        selectedPathRef.current = "";
        setSelectedPath("");
        setSelected(null);
        preview.discard();
        void preview.close();
        if (autoSelectFirst) onSelectionChangeRef.current?.();
      }
    } catch (cause) {
      setListError(errorText(cause));
    } finally {
      setLoading(false);
    }
  }, [autoSelectFirst, initialMaterialPath, openMaterial, preview.close, preview.discard, project.name]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (!createRequested) return;
    setAddOpen(true);
    onCreateHandled();
  }, [createRequested, onCreateHandled]);

  const links = useMemo(() => parseMaterialLinks(url), [url]);

  const addFiles = async (filePaths?: string[]) => {
    if (adding) return;
    setAdding(true);
    try {
      const created = await projectsApi.addFiles(project.name, filePaths);
      // 未传路径时主进程会打开原生选择器；用户取消返回空数组，
      // 此时保持对话框打开，不能把整个「添加资料」一起关掉。
      if (!filePaths && !created.length) return;
      setAddOpen(false);
      await load();
      if (created[0]?.relativePath) await openMaterial(created[0].relativePath);
      if (created.length) ui.notify(`已添加并转换 ${created.length} 项资料。`, "success");
      onChanged();
    } catch (cause) {
      ui.notify(errorText(cause), "error");
      // Converters persist a failed record before surfacing the error so it
      // can be retried. Refresh immediately instead of hiding that record
      // behind a page reload (also exposes partial success in a batch import).
      setAddOpen(false);
      await load();
    } finally {
      setAdding(false);
    }
  };

  const dropFiles = (event: DragEvent<HTMLElement>) => {
    event.preventDefault();
    setDragOver(false);
    if (adding) return;
    const files = Array.from(event.dataTransfer?.files ?? []);
    if (!files.length) return;
    const paths = files
      .map((file) => typeof window.openmind.pathForFile === "function" ? window.openmind.pathForFile(file) : "")
      .filter(Boolean);
    if (!paths.length) {
      ui.notify("无法读取拖入文件的路径，请改用点击上传。", "error");
      return;
    }
    void addFiles(paths);
  };

  const addUrls = async () => {
    if (adding || !links.length) return;
    setAdding(true);
    let created = 0;
    let first: ProjectMaterial | undefined;
    try {
      for (const link of links) {
        const material = await projectsApi.addUrl(project.name, link);
        created += 1;
        first ??= material;
      }
      ui.notify(created > 1 ? `已添加 ${created} 个链接并完成转换。` : "链接已加入项目并完成转换。", "success");
    } catch (cause) {
      ui.notify(created ? `已添加 ${created} 个链接，其余添加失败：${errorText(cause)}` : errorText(cause), "error");
    } finally {
      setAddOpen(false);
      setUrl("");
      await load();
      if (first?.relativePath) await openMaterial(first.relativePath);
      onChanged();
      setAdding(false);
    }
  };

  const retry = async (material: ProjectMaterial) => {
    if (retryingPath) return;
    setRetryingPath(material.relativePath);
    try {
      const next = await projectsApi.retryMaterial(project.name, material.relativePath);
      const nextMaterials = materialsRef.current.map((item) => item.relativePath === next.relativePath ? next : item);
      materialsRef.current = nextMaterials;
      setMaterials(nextMaterials);
      setSelected(next);
      if (next.status === "ready") await openMaterial(next.relativePath);
      onChanged();
      ui.notify(next.status === "ready" ? "资料转换已完成。" : next.error || "资料转换仍然失败。", next.status === "ready" ? "success" : "error");
    } catch (cause) {
      ui.notify(errorText(cause), "error");
    } finally {
      setRetryingPath("");
    }
  };

  const hosted = Boolean(listHost || detailHost);
  const addDialog = (
    <ProjectDialog
      open={addOpen}
      title="添加资料"
      confirmLabel="添加链接"
      busy={adding}
      className="project-material-add-dialog"
      showFooter={false}
      onClose={() => setAddOpen(false)}
      onConfirm={addUrls}
    >
      <button
        type="button"
        className={`project-material-upload${dragOver ? " drag-over" : ""}`}
        data-motion="action"
        aria-label="上传文件"
        disabled={adding}
        onClick={() => void addFiles()}
        onDragOver={(event) => { event.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={dropFiles}
      >
        <span className="project-material-upload-icon" aria-hidden="true">
          {adding ? <LoaderCircle className="spin" size={22} /> : <Upload size={22} />}
        </span>
        <strong>{adding ? "正在添加资料…" : "拖拽文件到这里，或点击上传文件"}</strong>
        <small>支持 PDF、文档、图片、音频、视频等</small>
      </button>
      <div className="project-material-url-entry">
        <textarea
          aria-label="资料 URL"
          value={url}
          placeholder={"或者将链接粘贴到这里，从 YouTube、播客或任意网页添加内容\n如需添加多个链接，请使用空格或换行分隔"}
          disabled={adding}
          onChange={(event) => setUrl(event.target.value)}
        />
        <div className="project-material-url-actions">
          <span>{links.length}/50</span>
          <button type="submit" className="primary-button" disabled={!links.length || adding} aria-busy={adding || undefined}>
            {adding ? "添加中…" : "添加链接"}
          </button>
        </div>
      </div>
    </ProjectDialog>
  );
  const list = (
    <>
      {!hosted ? <header className="project-local-list-header"><div><span className="eyebrow">项目资料</span><h2>资料</h2></div><button className="icon-button" aria-label="添加资料" onClick={() => setAddOpen(true)}><Plus size={16} /></button></header> : null}
      <label className="project-local-search"><Search size={14} /><input aria-label="搜索资料" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索资料" /></label>
      <div className="project-material-filters" role="group" aria-label="资料类型">
        {(["all", "document", "web", "video"] as MaterialFilter[]).map((item) => <button type="button" aria-pressed={filter === item} data-motion="selection" className={filter === item ? "active" : ""} key={item} onClick={() => setFilter(item)}>{materialFilterLabel(item)}</button>)}
      </div>
      <div className="project-local-count">{materialFilterLabel(filter)} <span>{filtered.length}</span></div>
      <div className="project-item-list">
        {loading ? Array.from({ length: 5 }, (_, index) => <div className="project-item-skeleton" key={index} />) : null}
        {!loading && !listError && !preview.error && !filtered.length ? <EmptyState title={materials.length ? "没有匹配的资料" : "还没有资料"} description={materials.length ? "调整搜索词或资料类型后再试。" : "添加 Markdown、文档、网页或受支持的视频链接。"} /> : null}
        {filtered.map((item) => {
          const Icon = materialIcon(item.kind);
          return <button key={item.relativePath} className={item.relativePath === selectedPath ? "active" : ""} data-motion="selection" onClick={() => void openMaterial(item.relativePath)}><Icon size={15} /><span><strong>{item.title}</strong><small>{materialKindLabel(item.kind)} · {materialStatusLabel(item.status)}</small></span></button>;
        })}
      </div>
    </>
  );

  const error = listError || preview.error;
  const detail = preview.loading ? <div className="project-detail-loading"><LoaderCircle className="spin" size={18} />正在读取资料…</div> : error ? <ErrorState message={error} retry={() => selectedPath ? void openMaterial(selectedPath) : void load()} /> : selected ? (
    <MaterialDetail
      material={selected}
      resource={preview.resource}
      projectName={project.name}
      retrying={retryingPath === selected.relativePath}
      onRetry={() => void retry(selected)}
      onOpenExternal={() => void preview.source?.openExternal?.()}
    />
  ) : (
    <EmptyState icon={<FilePlus2 size={30} />} title="选择或添加资料" description="文档和网页会转换为 Markdown；视频保存 URL、元数据和字幕。" action={<button className="primary-button" onClick={() => setAddOpen(true)}><Plus size={15} />添加资料</button>} />
  );

  if (hosted) {
    return (
      <>
        {listHost ? createPortal(list, listHost) : null}
        {detailHost ? createPortal(detail, detailHost) : null}
        {addDialog}
      </>
    );
  }
  return (
    <>
      <ProjectListDetail storageKey={`openmind:projects:materials-layout:${project.name}`} detailOpen={Boolean(selectedPath)} list={list} detail={detail} detailLabel="资料" onBack={() => { selectedPathRef.current = ""; setSelectedPath(""); setSelected(null); preview.discard(); void preview.close(); onSelectionChange?.(); }} />
      {addDialog}
    </>
  );
}

function MaterialDetail({ material, resource, projectName, retrying, onRetry, onOpenExternal }: { material: ProjectMaterial; resource: PreviewResource | null; projectName: string; retrying: boolean; onRetry(): void; onOpenExternal(): void }) {
  return (
    <div className={`project-material-detail${material.truncated ? " is-truncated" : ""}`}>
      <header className="project-detail-header">
        <div><span className="eyebrow">{materialKindLabel(material.kind)} · {materialStatusLabel(material.status)}</span><h2>{material.title}</h2><p title={material.relativePath}>{material.sourceUrl || material.relativePath}</p></div>
      </header>
      {material.truncated ? <div className="project-material-warning" role="status"><AlertTriangle size={18} /><div><strong>当前只显示资料的部分内容</strong><p>预览已截断，不能直接转为文档；项目任务仍可按需读取原资料。</p></div></div> : null}
      {material.status === "failed" ? <div className="project-material-error"><div><strong>资料转换失败</strong><p>{material.error || "没有可用的转换结果，请稍后重试或重新添加。"}</p></div><button type="button" data-motion="action" disabled={retrying} onClick={onRetry}>{retrying ? <LoaderCircle className="spin" size={14} /> : <RefreshCw size={14} />}{retrying ? "正在重试" : "重试"}</button></div> : null}
      {material.status === "importing" || material.status === "converting" ? <div className="project-material-processing"><LoaderCircle size={18} className="spin" /><div><strong>{material.status === "importing" ? "正在导入" : "正在转换为 Markdown"}</strong><p>转换完成后，重新进入资料页即可查看。</p></div></div> : null}
      {material.status === "ready" && material.kind === "video" && resource?.kind === "video" ? <PreviewRenderer resource={resource} onOpenExternal={resource.playback.kind === "external-only" && resource.playback.sourceUrl ? onOpenExternal : undefined} /> : null}
      {material.status === "ready" && material.kind !== "video" && resource?.kind === "document" ? <DocumentMaterialDetail material={material} resource={resource} projectName={projectName} /> : null}
      {material.status === "ready" && resource?.kind === "unsupported" ? <PreviewRenderer resource={resource} /> : null}
    </div>
  );
}

type DocumentViewMode = "pdf" | "read" | "markdown";

function DocumentMaterialDetail({ material, resource, projectName }: { material: ProjectMaterial; resource: PreviewResource; projectName: string }) {
  const hasPdfOriginal = Boolean(material.originalPath?.toLowerCase().endsWith(".pdf"));
  const [mode, setMode] = useState<DocumentViewMode>(hasPdfOriginal ? "pdf" : "read");
  return (
    <div className="project-markdown-material">
      <div className="project-preview-mode" role="group" aria-label="资料查看方式">
        {hasPdfOriginal ? <button className={mode === "pdf" ? "active" : ""} aria-pressed={mode === "pdf"} data-motion="selection" onClick={() => setMode("pdf")}>PDF</button> : null}
        <button className={mode === "read" ? "active" : ""} aria-pressed={mode === "read"} data-motion="selection" onClick={() => setMode("read")}>阅读</button>
        <button className={mode === "markdown" ? "active" : ""} aria-pressed={mode === "markdown"} data-motion="selection" onClick={() => setMode("markdown")}>Markdown</button>
      </div>
      <div className="project-material-reader">
        {mode === "pdf" && hasPdfOriginal
          ? <PdfMaterialFrame projectName={projectName} material={material} onFallback={() => setMode("read")} />
          : mode === "markdown"
            ? <pre>{material.content || ""}</pre>
            : <PreviewRenderer resource={resource} layout="file" />}
      </div>
    </div>
  );
}

/** 拉取保留的 PDF 原件，交给内置 pdf.js 阅读器渲染。 */
function PdfMaterialFrame({ projectName, material, onFallback }: { projectName: string; material: ProjectMaterial; onFallback(): void }) {
  const preview = useFilePreviewController();
  const [failed, setFailed] = useState<string | null>(null);
  useEffect(() => {
    setFailed(null);
    void preview.openSource(projectMaterialPreviewSource(projectName, material.relativePath, {
      initialMaterial: material,
      logicalPath: material.originalPath || material.relativePath,
      view: "pdf"
    }), { force: true });
  }, [material, preview.openSource, projectName]);
  const error = failed || preview.error;
  if (error) {
    return (
      <div className="project-pdf-unavailable">
        <FileText size={28} />
        <strong>无法加载 PDF 原件</strong>
        <p>{error}</p>
        <button type="button" data-motion="action" onClick={onFallback}>查看提取文本</button>
      </div>
    );
  }
  return preview.resource?.kind === "pdf"
    ? <PreviewRenderer resource={preview.resource} onError={(message) => setFailed(message)} />
    : <div className="project-pdf-loading"><LoaderCircle className="spin" size={18} />正在加载 PDF 原件…</div>;
}

function materialIcon(kind: ProjectMaterialKind) {
  return kind === "video" ? Video : kind === "web" ? Globe2 : FileText;
}

function materialFilterLabel(kind: MaterialFilter): string {
  return kind === "document" ? "文档" : kind === "web" ? "网页" : kind === "video" ? "视频" : "全部";
}

function materialKindLabel(kind: ProjectMaterialKind): string {
  return materialFilterLabel(kind);
}

function materialStatusLabel(status: ProjectMaterial["status"]): string {
  return status === "importing" ? "导入中" : status === "converting" ? "转换中" : status === "failed" ? "转换失败" : "可用";
}

const MAX_MATERIAL_LINKS = 50;

/** 按空格/换行拆分粘贴内容，只保留 HTTP(S) 链接；按规范化结果去重，上限 50 个。 */
function parseMaterialLinks(value: string): string[] {
  const seen = new Set<string>();
  const links: string[] = [];
  for (const token of value.split(/\s+/)) {
    if (!token) continue;
    try {
      const parsed = new URL(token);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") continue;
      const normalized = parsed.toString();
      if (seen.has(normalized)) continue;
      seen.add(normalized);
      links.push(token);
    } catch { /* 非 URL 片段直接忽略。 */ }
    if (links.length >= MAX_MATERIAL_LINKS) break;
  }
  return links;
}

function errorText(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
