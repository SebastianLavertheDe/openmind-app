import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import { createPortal } from "react-dom";
import { AlertTriangle, ExternalLink, FilePlus2, FileText, Globe2, LoaderCircle, Plus, RefreshCw, Search, Upload, Video } from "lucide-react";
import { useAi } from "../../ai-context";
import { MarkdownReader } from "../../components/MarkdownReader";
import { EmptyState, ErrorState } from "../../design-system/components";
import { useContainerLayoutMode } from "../../design-system/use-container-layout-mode";
import { ProjectDialog } from "./ProjectDialog";
import { ProjectListDetail } from "./ProjectListDetail";
import { projectsApi } from "./projects-api";
import type { ProjectDetail, ProjectMaterial, ProjectMaterialKind, ProjectTranscriptSegment } from "./types";
import type { ProjectTaskSeed } from "./ProjectTasksPanel";

type MaterialFilter = "all" | ProjectMaterialKind;

const VIDEO_DETAIL_SPLIT_MIN_INLINE_SIZE = 720;

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
  const [url, setUrl] = useState("");
  const [adding, setAdding] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [retryingPath, setRetryingPath] = useState("");
  const materialsRef = useRef<ProjectMaterial[]>([]);
  const selectedPathRef = useRef(initialMaterialPath || "");
  const onSelectionChangeRef = useRef(onSelectionChange);
  materialsRef.current = materials;
  selectedPathRef.current = selectedPath;
  onSelectionChangeRef.current = onSelectionChange;

  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return materials.filter((item) => (filter === "all" || item.kind === filter) && (!needle || `${item.title} ${item.relativePath} ${item.sourceUrl || ""}`.toLocaleLowerCase().includes(needle)));
  }, [filter, materials, query]);

  const openMaterial = useCallback(async (relativePath: string) => {
    selectedPathRef.current = relativePath;
    setSelectedPath(relativePath);
    onSelectionChangeRef.current?.(relativePath);
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
  }, [project.name]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
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
        if (autoSelectFirst) onSelectionChangeRef.current?.();
      }
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setLoading(false);
    }
  }, [autoSelectFirst, initialMaterialPath, openMaterial, project.name]);

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
      ai.notify("无法读取拖入文件的路径，请改用点击上传。", "error");
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
      ai.notify(created > 1 ? `已添加 ${created} 个链接并完成转换。` : "链接已加入项目并完成转换。", "success");
    } catch (cause) {
      ai.notify(created ? `已添加 ${created} 个链接，其余添加失败：${errorText(cause)}` : errorText(cause), "error");
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
      ai.notify(next.status === "ready" ? "资料转换已完成。" : next.error || "资料转换仍然失败。", next.status === "ready" ? "success" : "error");
    } catch (cause) {
      ai.notify(errorText(cause), "error");
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
    <MaterialDetail material={selected} retrying={retryingPath === selected.relativePath} onRetry={() => void retry(selected)} />
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
      <ProjectListDetail storageKey={`openmind:projects:materials-layout:${project.name}`} detailOpen={Boolean(selectedPath)} list={list} detail={detail} detailLabel="资料" onBack={() => { setSelectedPath(""); setSelected(null); onSelectionChange?.(); }} />
      {addDialog}
    </>
  );
}

function MaterialDetail({ material, retrying, onRetry }: { material: ProjectMaterial; retrying: boolean; onRetry(): void }) {
  const [raw, setRaw] = useState(false);
  return (
    <div className={`project-material-detail${material.truncated ? " is-truncated" : ""}`}>
      <header className="project-detail-header">
        <div><span className="eyebrow">{materialKindLabel(material.kind)} · {materialStatusLabel(material.status)}</span><h2>{material.title}</h2><p title={material.relativePath}>{material.sourceUrl || material.relativePath}</p></div>
      </header>
      {material.truncated ? <div className="project-material-warning" role="status"><AlertTriangle size={18} /><div><strong>当前只显示资料的部分内容</strong><p>预览已截断，不能直接转为文档；项目任务仍可按需读取原资料。</p></div></div> : null}
      {material.status === "failed" ? <div className="project-material-error"><div><strong>资料转换失败</strong><p>{material.error || "没有可用的转换结果，请稍后重试或重新添加。"}</p></div><button type="button" disabled={retrying} onClick={onRetry}>{retrying ? <LoaderCircle className="spin" size={14} /> : <RefreshCw size={14} />}{retrying ? "正在重试" : "重试"}</button></div> : null}
      {material.status === "importing" || material.status === "converting" ? <div className="project-material-processing"><LoaderCircle size={18} className="spin" /><div><strong>{material.status === "importing" ? "正在导入" : "正在转换为 Markdown"}</strong><p>转换完成后，重新进入资料页即可查看。</p></div></div> : null}
      {material.status === "ready" && material.kind === "video" ? <VideoMaterialDetail material={material} /> : null}
      {material.status === "ready" && material.kind !== "video" ? (
        <div className="project-markdown-material">
          <div className="project-preview-mode" role="group" aria-label="资料查看方式"><button className={!raw ? "active" : ""} aria-pressed={!raw} onClick={() => setRaw(false)}>阅读</button><button className={raw ? "active" : ""} aria-pressed={raw} onClick={() => setRaw(true)}>Markdown</button></div>
          <div className="project-material-reader">{raw ? <pre>{material.content || ""}</pre> : <MarkdownReader content={material.content || ""} layout="file" />}</div>
        </div>
      ) : null}
    </div>
  );
}

function VideoMaterialDetail({ material }: { material: ProjectMaterial }) {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const videoLayout = useContainerLayoutMode<HTMLDivElement>({ splitMinInlineSize: VIDEO_DETAIL_SPLIT_MIN_INLINE_SIZE });
  const [currentMs, setCurrentMs] = useState(0);
  const segments = useMemo(() => material.video?.transcript?.length ? material.video.transcript : parseTranscript(material.content || ""), [material.content, material.video?.transcript]);

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

  return (
    <div ref={videoLayout.ref} className={`project-video-layout layout-${videoLayout.mode}`} data-layout-width={videoLayout.inlineSize ? Math.round(videoLayout.inlineSize) : undefined}>
      <div className="project-video-detail">
        <div className="project-video-media-column">
          <section className="project-video-player">
            {embedUrl ? <iframe ref={frameRef} title={material.title} src={embedUrl} onLoad={connectEmbeddedPlayer} sandbox="allow-scripts allow-same-origin allow-presentation" allow="autoplay; encrypted-media; picture-in-picture" allowFullScreen /> : <div className="project-video-unavailable"><Video size={28} /><strong>当前链接无法安全内嵌播放</strong><p>字幕仍可阅读；可以在浏览器中打开原视频。</p>{material.sourceUrl ? <button onClick={() => void window.openmind.openExternal(material.sourceUrl!)}><ExternalLink size={14} />浏览器打开</button> : null}</div>}
          </section>
        </div>
        <div className="project-video-inspector-column">
          <section className="project-transcript project-video-inspector">
            <div className="project-transcript-list">
              {!segments.length ? <EmptyState title="暂无字幕" description="当前视频没有可用的平台字幕；原始链接仍会保留在项目资料中。" /> : null}
              {segments.map((item) => {
                const active = currentMs >= item.startMs && currentMs < Math.max(item.startMs + 1, item.endMs);
                return <div className={`project-transcript-row${active ? " active" : ""}`} key={item.id}><button className="project-timecode" onClick={() => seek(item.startMs)}>{formatDisplayTime(item.startMs)}</button><span>{item.speaker ? <strong>{item.speaker} </strong> : null}{item.text}</span></div>;
              })}
            </div>
          </section>
        </div>
      </div>
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
