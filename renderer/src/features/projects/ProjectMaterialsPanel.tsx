import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AlertTriangle, ExternalLink, File, FileOutput, FilePlus2, FileText, Globe2, LoaderCircle, Play, Plus, RefreshCw, Search, Trash2, Video } from "lucide-react";
import { useAi } from "../../ai-context";
import { MarkdownReader } from "../../components/MarkdownReader";
import { EmptyState, ErrorState } from "../../design-system/components";
import { ProjectDialog, ProjectTextField } from "./ProjectDialog";
import { ProjectListDetail } from "./ProjectListDetail";
import { projectsApi } from "./projects-api";
import type { ProjectDetail, ProjectMaterial, ProjectMaterialKind, ProjectTranscriptSegment } from "./types";
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
  const ai = useAi();
  const [materials, setMaterials] = useState<ProjectMaterial[]>([]);
  const [selectedPath, setSelectedPath] = useState(initialMaterialPath || "");
  const [selected, setSelected] = useState<ProjectMaterial | null>(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<MaterialFilter>("all");
  const [loading, setLoading] = useState(true);
  const [reading, setReading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [addMode, setAddMode] = useState<"file" | "url">("file");
  const [url, setUrl] = useState("");
  const [adding, setAdding] = useState(false);
  const [retryingPath, setRetryingPath] = useState("");
  const materialsRef = useRef<ProjectMaterial[]>([]);
  materialsRef.current = materials;

  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return materials.filter((item) => (filter === "all" || item.kind === filter) && (!needle || `${item.title} ${item.relativePath} ${item.sourceUrl || ""}`.toLocaleLowerCase().includes(needle)));
  }, [filter, materials, query]);

  const openMaterial = useCallback(async (relativePath: string) => {
    setSelectedPath(relativePath);
    onSelectionChange?.(relativePath);
    setError(null);
    const known = materialsRef.current.find((item) => item.relativePath === relativePath);
    if (known && known.status !== "ready") {
      setSelected(known);
      setReading(false);
      return;
    }
    setReading(true);
    try {
      setSelected(await projectsApi.readMaterial(project.name, relativePath));
    } catch (cause) {
      setSelected(null);
      setError(errorText(cause));
    } finally {
      setReading(false);
    }
  }, [onSelectionChange, project.name]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const next = await projectsApi.listMaterials(project.name);
      setMaterials(next);
      materialsRef.current = next;
      const preferred = next.find((item) => item.relativePath === selectedPath)
        || next.find((item) => item.relativePath === initialMaterialPath)
        || (autoSelectFirst ? next[0] : undefined);
      if (preferred) await openMaterial(preferred.relativePath);
      else {
        setSelectedPath("");
        setSelected(null);
        if (autoSelectFirst) onSelectionChange?.();
      }
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setLoading(false);
    }
  }, [autoSelectFirst, initialMaterialPath, onSelectionChange, openMaterial, project.name]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (!createRequested) return;
    setAddOpen(true);
    onCreateHandled();
  }, [createRequested, onCreateHandled]);

  const addFiles = async () => {
    if (adding) return;
    setAdding(true);
    try {
      const created = await projectsApi.addFiles(project.name);
      setAddOpen(false);
      await load();
      if (created[0]?.relativePath) await openMaterial(created[0].relativePath);
      if (created.length) ai.notify(`已添加并转换 ${created.length} 项资料。`, "success");
      onChanged();
    } catch (cause) {
      ai.notify(errorText(cause), "error");
      // Converters persist a failed record before surfacing the error so it
      // can be retried. Refresh immediately instead of hiding that record
      // behind a page reload (also exposes partial success in a batch import).
      setAddOpen(false);
      await load();
    } finally {
      setAdding(false);
    }
  };

  const addUrl = async () => {
    if (!url.trim() || adding) return;
    setAdding(true);
    try {
      const created = await projectsApi.addUrl(project.name, url.trim());
      setAddOpen(false);
      setUrl("");
      await load();
      if (created.relativePath) await openMaterial(created.relativePath);
      ai.notify("链接已加入项目并完成转换。", "success");
      onChanged();
    } catch (cause) {
      ai.notify(errorText(cause), "error");
      setAddOpen(false);
      await load();
    } finally {
      setAdding(false);
    }
  };

  const remove = async () => {
    if (!selected) return;
    const confirmed = await ai.confirm({ title: "移出项目", body: `从项目移出“${selected.title}”？项目外部的原始文件不会被删除。`, confirmText: "移出", danger: true });
    if (!confirmed) return;
    try {
      await projectsApi.removeMaterial(project.name, selected.relativePath);
      setSelected(null);
      setSelectedPath("");
      onSelectionChange?.();
      await load();
      onChanged();
      ai.notify("资料已移出项目。", "success");
    } catch (cause) {
      ai.notify(errorText(cause), "error");
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
      ai.notify(next.status === "ready" ? "资料转换已完成。" : next.error || "资料转换仍然失败。", next.status === "ready" ? "success" : "error");
    } catch (cause) {
      ai.notify(errorText(cause), "error");
    } finally {
      setRetryingPath("");
    }
  };

  const copyAsOutput = async (material: ProjectMaterial) => {
    if (material.truncated) {
      ai.notify("当前资料预览不完整，不能转为文档。请让 AI 按需读取原资料。", "error");
      return;
    }
    try {
      await projectsApi.createOutput(project.name, material.title, material.content || "");
      onChanged();
      ai.notify("资料已转为可编辑文档。", "success");
    } catch (cause) {
      ai.notify(errorText(cause), "error");
    }
  };

  const hosted = Boolean(listHost || detailHost);
  const list = (
    <>
      {!hosted ? <header className="project-local-list-header"><div><span className="eyebrow">项目资料</span><h2>资料</h2></div><button className="icon-button" aria-label="添加资料" onClick={() => setAddOpen(true)}><Plus size={16} /></button></header> : null}
      <label className="project-local-search"><Search size={14} /><input aria-label="搜索资料" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索资料" /></label>
      <div className="project-material-filters" role="tablist" aria-label="资料类型">
        {(["all", "document", "web", "video"] as MaterialFilter[]).map((item) => <button role="tab" aria-selected={filter === item} className={filter === item ? "active" : ""} key={item} onClick={() => setFilter(item)}>{materialFilterLabel(item)}</button>)}
      </div>
      <div className="project-local-count">{materialFilterLabel(filter)} <span>{filtered.length}</span></div>
      <div className="project-item-list">
        {loading ? Array.from({ length: 5 }, (_, index) => <div className="project-item-skeleton" key={index} />) : null}
        {!loading && !error && !filtered.length ? <EmptyState title={materials.length ? "没有匹配的资料" : "还没有资料"} description={materials.length ? "调整搜索词或资料类型后再试。" : "添加 Markdown、文档、网页或受支持的视频链接。"} /> : null}
        {filtered.map((item) => {
          const Icon = materialIcon(item.kind);
          return <button key={item.relativePath} className={item.relativePath === selectedPath ? "active" : ""} onClick={() => void openMaterial(item.relativePath)}><Icon size={15} /><span><strong>{item.title}</strong><small>{materialKindLabel(item.kind)} · {materialStatusLabel(item.status)}</small></span></button>;
        })}
      </div>
    </>
  );

  const detail = reading ? <div className="project-detail-loading"><LoaderCircle className="spin" size={18} />正在读取资料…</div> : error ? <ErrorState message={error} retry={() => selectedPath ? void openMaterial(selectedPath) : void load()} /> : selected ? (
    <MaterialDetail material={selected} retrying={retryingPath === selected.relativePath} onRetry={() => void retry(selected)} onRemove={() => void remove()} onCopyOutput={() => void copyAsOutput(selected)} onCreateTask={onCreateTask} />
  ) : (
    <EmptyState icon={<FilePlus2 size={30} />} title="选择或添加资料" description="文档和网页会转换为 Markdown；视频保存 URL、元数据和字幕。" action={<button className="primary-button" onClick={() => setAddOpen(true)}><Plus size={15} />添加资料</button>} />
  );

  if (hosted) {
    return (
      <>
        {listHost ? createPortal(list, listHost) : null}
        {detailHost ? createPortal(detail, detailHost) : null}
        <ProjectDialog open={addOpen} title="添加资料" description="文件会复制到当前项目；链接会被识别为网页或受支持的视频。" confirmLabel={addMode === "file" ? "选择文件" : "添加链接"} busy={adding} onClose={() => setAddOpen(false)} onConfirm={addMode === "file" ? addFiles : addUrl}>
          <div className="project-dialog-tabs" role="tablist" aria-label="资料来源"><button type="button" role="tab" aria-selected={addMode === "file"} className={addMode === "file" ? "active" : ""} onClick={() => setAddMode("file")}><File size={15} />本地文件</button><button type="button" role="tab" aria-selected={addMode === "url"} className={addMode === "url" ? "active" : ""} onClick={() => setAddMode("url")}><Globe2 size={15} />网页或视频链接</button></div>
          {addMode === "file" ? <div className="project-file-picker-copy"><FilePlus2 size={26} /><strong>选择一个或多个文件</strong><p>支持 Markdown、纯文本、PDF、DOCX、PPTX 和 XLSX；文档会转换为可阅读的 Markdown。</p></div> : <ProjectTextField label="URL" value={url} placeholder="https://…" autoFocus onChange={setUrl} />}
        </ProjectDialog>
      </>
    );
  }
  return (
    <>
      <ProjectListDetail storageKey={`openmind:projects:materials-layout:${project.name}`} detailOpen={Boolean(selectedPath)} list={list} detail={detail} detailLabel="资料" onBack={() => { setSelectedPath(""); setSelected(null); onSelectionChange?.(); }} />
      <ProjectDialog open={addOpen} title="添加资料" description="文件会复制到当前项目；链接会被识别为网页或受支持的视频。" confirmLabel={addMode === "file" ? "选择文件" : "添加链接"} busy={adding} onClose={() => setAddOpen(false)} onConfirm={addMode === "file" ? addFiles : addUrl}>
        <div className="project-dialog-tabs" role="tablist" aria-label="资料来源"><button type="button" role="tab" aria-selected={addMode === "file"} className={addMode === "file" ? "active" : ""} onClick={() => setAddMode("file")}><File size={15} />本地文件</button><button type="button" role="tab" aria-selected={addMode === "url"} className={addMode === "url" ? "active" : ""} onClick={() => setAddMode("url")}><Globe2 size={15} />网页或视频链接</button></div>
        {addMode === "file" ? <div className="project-file-picker-copy"><FilePlus2 size={26} /><strong>选择一个或多个文件</strong><p>支持 Markdown、纯文本、PDF、DOCX、PPTX 和 XLSX；文档会转换为可阅读的 Markdown。</p></div> : <ProjectTextField label="URL" value={url} placeholder="https://…" autoFocus onChange={setUrl} />}
      </ProjectDialog>
    </>
  );
}

function MaterialDetail({ material, retrying, onRetry, onRemove, onCopyOutput, onCreateTask }: { material: ProjectMaterial; retrying: boolean; onRetry(): void; onRemove(): void; onCopyOutput(): void; onCreateTask(seed: ProjectTaskSeed): void }) {
  const [raw, setRaw] = useState(false);
  const citation = `[[source:${material.relativePath}]]`;
  const createTask = () => onCreateTask({ title: `基于${material.title}创作`, prompt: `请基于资料 ${citation} 进行分析并完成创作。` });
  return (
    <div className={`project-material-detail${material.truncated ? " is-truncated" : ""}`}>
      <header className="project-detail-header">
        <div><span className="eyebrow">{materialKindLabel(material.kind)} · {materialStatusLabel(material.status)}</span><h2>{material.title}</h2><p title={material.relativePath}>{material.sourceUrl || material.relativePath}</p></div>
        <div><button className="primary-button" disabled={material.status !== "ready"} onClick={createTask}><SparklesIcon />基于此资料新建任务</button><button className="icon-button" disabled={material.status !== "ready" || material.truncated} aria-label="转为可编辑文档" title={material.truncated ? "资料预览不完整，不能转为文档" : "转为可编辑文档"} onClick={onCopyOutput}><FileOutput size={15} /></button>{material.sourceUrl ? <button className="icon-button" aria-label="在浏览器打开原始链接" onClick={() => void window.openmind.openExternal(material.sourceUrl!)}><ExternalLink size={15} /></button> : null}<button className="icon-button danger" aria-label="移出项目" onClick={onRemove}><Trash2 size={15} /></button></div>
      </header>
      {material.truncated ? <div className="project-material-warning" role="status"><AlertTriangle size={18} /><div><strong>当前只显示资料的部分内容</strong><p>预览已截断，不能直接转为文档；项目任务仍可按需读取原资料。</p></div></div> : null}
      {material.status === "failed" ? <div className="project-material-error"><div><strong>资料转换失败</strong><p>{material.error || "没有可用的转换结果，请稍后重试或重新添加。"}</p></div><button type="button" disabled={retrying} onClick={onRetry}>{retrying ? <LoaderCircle className="spin" size={14} /> : <RefreshCw size={14} />}{retrying ? "正在重试" : "重试"}</button></div> : null}
      {material.status === "importing" || material.status === "converting" ? <div className="project-material-processing"><LoaderCircle size={18} className="spin" /><div><strong>{material.status === "importing" ? "正在导入" : "正在转换为 Markdown"}</strong><p>转换完成后，重新进入资料页即可查看。</p></div></div> : null}
      {material.status === "ready" && material.kind === "video" ? <VideoMaterialDetail material={material} onCreateTask={onCreateTask} /> : null}
      {material.status === "ready" && material.kind !== "video" ? (
        <div className="project-markdown-material">
          <div className="project-preview-mode" role="group" aria-label="资料查看方式"><button className={!raw ? "active" : ""} aria-pressed={!raw} onClick={() => setRaw(false)}>阅读</button><button className={raw ? "active" : ""} aria-pressed={raw} onClick={() => setRaw(true)}>Markdown</button></div>
          <div className="project-material-reader">{raw ? <pre>{material.content || ""}</pre> : <MarkdownReader content={material.content || ""} layout="file" />}</div>
        </div>
      ) : null}
    </div>
  );
}

function VideoMaterialDetail({ material, onCreateTask }: { material: ProjectMaterial; onCreateTask(seed: ProjectTaskSeed): void }) {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const [currentMs, setCurrentMs] = useState(0);
  const [query, setQuery] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const segments = useMemo(() => material.video?.transcript?.length ? material.video.transcript : parseTranscript(material.content || ""), [material.content, material.video?.transcript]);
  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return segments.filter((item) => !needle || item.text.toLocaleLowerCase().includes(needle));
  }, [query, segments]);
  // Project Markdown is user-editable, so never let a persisted direct/HLS URL
  // make the renderer fetch arbitrary hosts. The first release embeds only the
  // provider URL that Main reconstructs for a canonical YouTube id; other
  // videos keep URL + transcript and open explicitly in the system browser.
  const embedUrl = trustedYoutubeEmbedUrl(material.video?.provider, material.video?.embedUrl, material.video?.videoId);
  const embedOrigin = useMemo(() => {
    if (!embedUrl) return null;
    try { return new URL(embedUrl).origin; } catch { return null; }
  }, [embedUrl]);

  useEffect(() => {
    if (!embedOrigin) return;
    const receivePlaybackState = (event: MessageEvent) => {
      if (event.origin !== embedOrigin || event.source !== frameRef.current?.contentWindow) return;
      try {
        const payload = typeof event.data === "string" ? JSON.parse(event.data) as { event?: string; info?: { currentTime?: unknown } } : event.data as { event?: string; info?: { currentTime?: unknown } };
        const currentTime = payload?.event === "infoDelivery" ? payload.info?.currentTime : undefined;
        if (typeof currentTime === "number" && Number.isFinite(currentTime)) setCurrentMs(currentTime * 1000);
      } catch { /* Ignore unrelated messages from the validated player origin. */ }
    };
    window.addEventListener("message", receivePlaybackState);
    return () => window.removeEventListener("message", receivePlaybackState);
  }, [embedOrigin]);

  const connectEmbeddedPlayer = () => {
    if (!frameRef.current?.contentWindow || !embedOrigin) return;
    frameRef.current.contentWindow.postMessage(JSON.stringify({ event: "listening", id: `project-video-${material.relativePath}` }), embedOrigin);
  };

  const seek = (milliseconds: number) => {
    setCurrentMs(milliseconds);
    if (frameRef.current?.contentWindow && embedOrigin) {
      frameRef.current.contentWindow.postMessage(JSON.stringify({ event: "command", func: "seekTo", args: [milliseconds / 1000, true] }), embedOrigin);
    }
  };
  const selectedSegments = segments.filter((item) => selectedIds.has(item.id));
  const createFromSelection = () => {
    if (!selectedSegments.length) {
      onCreateTask({ title: `基于${material.title}创作`, prompt: `请基于视频资料 [[source:${material.relativePath}]] 进行分析并完成创作。` });
      return;
    }
    const start = Math.min(...selectedSegments.map((item) => item.startMs));
    const end = Math.max(...selectedSegments.map((item) => item.endMs));
    onCreateTask({ title: `基于${material.title}片段创作`, prompt: `请重点基于视频片段 [[video:${material.relativePath}@${formatMachineTime(start)}-${formatMachineTime(end)}]] 进行分析并完成创作。` });
  };

  return (
    <div className="project-video-detail">
      <section className="project-video-player">
        {embedUrl ? <iframe ref={frameRef} title={material.title} src={embedUrl} onLoad={connectEmbeddedPlayer} sandbox="allow-scripts allow-same-origin allow-presentation" allow="autoplay; encrypted-media; picture-in-picture" allowFullScreen /> : <div className="project-video-unavailable"><Video size={28} /><strong>当前链接无法安全内嵌播放</strong><p>字幕仍可阅读；可以在浏览器中打开原视频。</p>{material.sourceUrl ? <button onClick={() => void window.openmind.openExternal(material.sourceUrl!)}><ExternalLink size={14} />浏览器打开</button> : null}</div>}
      </section>
      <section className="project-transcript">
        <header><label><Search size={14} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索字幕" /></label><button className="primary-button" disabled={!segments.length} onClick={createFromSelection}><Play size={14} />{selectedIds.size ? `基于 ${selectedIds.size} 段新建任务` : "基于视频新建任务"}</button></header>
        <div className="project-transcript-list">
          {!segments.length ? <EmptyState title="暂无字幕" description="当前视频没有可用的平台字幕；原始链接仍会保留在项目资料中。" /> : null}
          {segments.length && !filtered.length ? <EmptyState title="没有匹配的字幕" description="换一个关键词后再试。" /> : null}
          {filtered.map((item) => {
            const active = currentMs >= item.startMs && currentMs < Math.max(item.startMs + 1, item.endMs);
            return <div className={`project-transcript-row${active ? " active" : ""}`} key={item.id}><button className="project-timecode" onClick={() => seek(item.startMs)}>{formatDisplayTime(item.startMs)}</button><label><input type="checkbox" checked={selectedIds.has(item.id)} onChange={() => setSelectedIds((current) => { const next = new Set(current); if (next.has(item.id)) next.delete(item.id); else next.add(item.id); return next; })} /><span>{item.speaker ? <strong>{item.speaker} </strong> : null}{item.text}</span></label></div>;
          })}
        </div>
      </section>
    </div>
  );
}

function trustedYoutubeEmbedUrl(provider?: string, embedUrl?: string, videoId?: string): string | undefined {
  if (provider !== "youtube" || !videoId || !/^[A-Za-z0-9_-]{11}$/.test(videoId) || !embedUrl) return undefined;
  try {
    const parsed = new URL(embedUrl);
    if (parsed.protocol !== "https:" || parsed.hostname !== "www.youtube-nocookie.com") return undefined;
    if (parsed.pathname !== `/embed/${videoId}` || parsed.searchParams.get("enablejsapi") !== "1") return undefined;
    return parsed.toString();
  } catch {
    return undefined;
  }
}

function parseTranscript(content: string): ProjectTranscriptSegment[] {
  return content.split(/\r?\n/).flatMap((line, index) => {
    const match = line.match(/^\s*\[(\d{1,2}:)?(\d{1,2}):(\d{2}(?:\.\d{1,3})?)\s*[–-]\s*(\d{1,2}:)?(\d{1,2}):(\d{2}(?:\.\d{1,3})?)\]\s*(.+)$/);
    if (!match) return [];
    const startMs = timePartsToMs(match[1], match[2], match[3]);
    const endMs = timePartsToMs(match[4], match[5], match[6]);
    return [{ id: `line-${index}`, startMs, endMs, text: match[7].trim() }];
  });
}

function timePartsToMs(hours: string | undefined, minutes: string, seconds: string): number {
  return ((Number.parseInt(hours || "0", 10) * 3600) + Number.parseInt(minutes, 10) * 60 + Number.parseFloat(seconds)) * 1000;
}

function formatDisplayTime(milliseconds: number): string {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = seconds % 60;
  return `${hours ? `${String(hours).padStart(2, "0")}:` : ""}${String(minutes).padStart(2, "0")}:${String(rest).padStart(2, "0")}`;
}

function formatMachineTime(milliseconds: number): string {
  const totalSeconds = Math.max(0, milliseconds) / 1000;
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = (totalSeconds % 60).toFixed(3).padStart(6, "0");
  return `${hours ? `${String(hours).padStart(2, "0")}:` : ""}${String(minutes).padStart(2, "0")}:${seconds}`;
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

function SparklesIcon() {
  return <span aria-hidden="true">✦</span>;
}

function errorText(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
