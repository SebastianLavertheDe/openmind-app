import { useFeedback } from "../../feedback-context";
import { FileDropzone } from "../../design-system/components";
import { Button } from "../../design-system/components";
import { SegmentedControl } from "../../design-system/controls";
import { useLocale } from "../../i18n";
import { messages } from "@shared/messages";
import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import { AlertTriangle, FilePlus2, FileText, LoaderCircle, Plus, RefreshCw, Upload } from "lucide-react";
import { EmptyState, ErrorState, Textarea } from "../../design-system/components";
import { PreviewRenderer, useFilePreviewController } from "../file-preview";
import type { PreviewResource } from "../file-preview/model";
import { ProjectDialog } from "./ProjectDialog";
import { projectMaterialPreviewSource } from "./project-material-preview-source";
import { projectsApi } from "./projects-api";
import type { ProjectDetail, ProjectMaterial, ProjectMaterialKind } from "./types";

type MaterialFilter = "all" | ProjectMaterialKind;

export type ProjectMaterialDetailProps = {
  project: ProjectDetail;
  materialPath?: string;
  material?: ProjectMaterial;
  createRequested: boolean;
  onCreateHandled(): void;
  onChanged(): void | Promise<void>;
  onSelectionChange?(relativePath?: string): void;
  renderDetail?: boolean;
};

/** Owns only the selected resource and import/retry lifecycle; never lists files. */
export function ProjectMaterialDetail({ project, materialPath, material, createRequested, onCreateHandled, onChanged, onSelectionChange, renderDetail = true }: ProjectMaterialDetailProps) {
  useLocale();
  const feedback = useFeedback();

  const selectedPath = materialPath || "";
  const [selected, setSelected] = useState<ProjectMaterial | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [url, setUrl] = useState("");
  const [adding, setAdding] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [retryingPath, setRetryingPath] = useState("");
  const materialRef = useRef(material);
  materialRef.current = material;
  const selectedRef = useRef<ProjectMaterial | null>(null);
  const previewResourceRef = useRef<PreviewResource | null>(null);
  const selectedPathRef = useRef("");
  const onSelectionChangeRef = useRef(onSelectionChange);
  selectedRef.current = selected;
  onSelectionChangeRef.current = onSelectionChange;
  const preview = useFilePreviewController();
  previewResourceRef.current = preview.resource;

  useEffect(() => () => {
    // The preview controller cancels pending loads during StrictMode cleanup.
    // Allow the replayed mount to start a fresh load for the same selection.
    selectedPathRef.current = "";
  }, []);

  const openMaterial = useCallback(async (relativePath: string) => {
    if (relativePath === selectedPathRef.current && selectedRef.current?.status === "ready" && previewResourceRef.current) return;
    selectedPathRef.current = relativePath;
    onSelectionChangeRef.current?.(relativePath);
    const known = materialRef.current?.relativePath === relativePath ? materialRef.current : undefined;
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

  const load = useCallback(async () => { await onChanged(); }, [onChanged]);
  useEffect(() => {
    if (materialPath && materialPath !== selectedPathRef.current) void openMaterial(materialPath);
    else if (!materialPath) {
      selectedPathRef.current = "";
      setSelected(null);
      preview.discard();
      void preview.close();
    }
  }, [materialPath, openMaterial, preview.close, preview.discard]);
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
      if (created.length) feedback.notify(messages.projectUi.materialsAdded(created.length), "success");
    } catch (cause) {
      feedback.notify(errorText(cause), "error");
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
      feedback.notify(messages.projectUi.droppedFilePathUnavailable, "error");
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
      feedback.notify(created > 1 ? messages.projectUi.linksAdded(created) : messages.projectUi.linkAdded, "success");
    } catch (cause) {
      feedback.notify(created ? messages.projectUi.linksPartiallyAdded(created, errorText(cause)) : errorText(cause), "error");
    } finally {
      setAddOpen(false);
      setUrl("");
      await load();
      if (first?.relativePath) await openMaterial(first.relativePath);
      setAdding(false);
    }
  };

  const retry = async (material: ProjectMaterial) => {
    if (retryingPath) return;
    setRetryingPath(material.relativePath);
    try {
      const next = await projectsApi.retryMaterial(project.name, material.relativePath);
      materialRef.current = next;
      setSelected(next);
      if (next.status === "ready") await openMaterial(next.relativePath);
      await load();
      feedback.notify(next.status === "ready" ? messages.projectUi.materialConverted : next.error || messages.projectUi.materialConversionStillFailed, next.status === "ready" ? "success" : "error");
    } catch (cause) {
      feedback.notify(errorText(cause), "error");
    } finally {
      setRetryingPath("");
    }
  };

  const addDialog = (
    <ProjectDialog
      open={addOpen}
      title={messages.projectUi.addMaterials}
      confirmLabel={messages.projectUi.addLinks}
      busy={adding}
      className="project-material-add-dialog"
      showFooter={false}
      onClose={() => setAddOpen(false)}
      onConfirm={addUrls}
    >
      <FileDropzone
        type="button"
        dragOver={dragOver}
        data-motion="action"
        label={messages.projectUi.uploadFiles}
        disabled={adding}
        onClick={() => void addFiles()}
        onDragOver={(event) => { event.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={dropFiles}
      >
        <span className="project-material-upload-icon" aria-hidden="true">
          {adding ? <LoaderCircle className="spin" size={22} /> : <Upload size={22} />}
        </span>
        <strong>{adding ? messages.projectUi.addingMaterials : messages.projectUi.dropOrUpload}</strong>
        <small>{messages.projectUi.supportedFileTypes}</small>
      </FileDropzone>
      <div className="project-material-url-entry">
        <Textarea variant="inline"
          aria-label={messages.projectUi.materialUrl}
          value={url}
          placeholder={messages.projectUi.materialUrlPlaceholder}
          disabled={adding}
          onChange={(event) => setUrl(event.target.value)}
        />
        <div className="project-material-url-actions">
          <span>{links.length}/50</span>
          <Button variant="primary" type="submit"  disabled={!links.length || adding} aria-busy={adding || undefined}>
            {adding ? messages.projectUi.adding : messages.projectUi.addLinks}
          </Button>
        </div>
      </div>
    </ProjectDialog>
  );
  const error = preview.error;
  const detail = preview.loading ? <div className="project-detail-loading"><LoaderCircle className="spin" size={18} />{messages.projectUi.readingMaterials}</div> : error ? <ErrorState message={error} retry={() => selectedPath ? void openMaterial(selectedPath) : void onChanged()} /> : selected ? (
    <MaterialDetail key={selected.relativePath}
      material={selected}
      resource={preview.resource}
      projectName={project.name}
      retrying={retryingPath === selected.relativePath}
      onRetry={() => void retry(selected)}
      onOpenExternal={() => void preview.source?.openExternal?.()}
    />
  ) : (
    <EmptyState icon={<FilePlus2 size={30} />} title={messages.projectUi.selectOrAddMaterials} description={messages.projectUi.materialsStorageHint} action={<Button variant="primary"  onClick={() => setAddOpen(true)}><Plus size={15} />{messages.projectUi.addMaterials}</Button>} />
  );

  return <>{renderDetail ? detail : null}{addDialog}</>;
}

function MaterialDetail({ material, resource, projectName, retrying, onRetry, onOpenExternal }: { material: ProjectMaterial; resource: PreviewResource | null; projectName: string; retrying: boolean; onRetry(): void; onOpenExternal(): void }) {
  useLocale();
  return (
    <div className={`project-material-detail${material.truncated ? " is-truncated" : ""}`}>
      <header className="project-detail-header">
        <div><span className="eyebrow">{materialKindLabel(material.kind)} · {materialStatusLabel(material.status)}</span><h2>{material.title}</h2><p title={material.relativePath}>{material.sourceUrl || material.relativePath}</p></div>
      </header>
      {material.truncated ? <div className="project-material-warning" role="status"><AlertTriangle size={18} /><div><strong>{messages.projectUi.partialMaterialPreview}</strong><p>{messages.projectUi.truncatedMaterialHint}</p></div></div> : null}
      {material.status === "failed" ? <div className="project-material-error"><div><strong>{messages.projectUi.materialConversionFailed}</strong><p>{material.error || messages.projectUi.noConversionResult}</p></div><Button variant="ghost" type="button" data-motion="action" disabled={retrying} onClick={onRetry}>{retrying ? <LoaderCircle className="spin" size={14} /> : <RefreshCw size={14} />}{retrying ? messages.projectUi.retrying : messages.projectUi.retry}</Button></div> : null}
      {material.status === "importing" || material.status === "converting" ? <div className="project-material-processing"><LoaderCircle size={18} className="spin" /><div><strong>{material.status === "importing" ? messages.projectUi.importing : messages.projectUi.convertingToMarkdown}</strong><p>{messages.projectUi.reopenAfterConversion}</p></div></div> : null}
      {material.status === "ready" && material.kind === "video" && resource?.kind === "video" ? <PreviewRenderer resource={resource} onOpenExternal={onOpenExternal} onRetryTranscript={onRetry} retryingTranscript={retrying} /> : null}
      {material.status === "ready" && material.kind !== "video" && resource?.kind === "document" ? <DocumentMaterialDetail material={material} resource={resource} projectName={projectName} /> : null}
      {material.status === "ready" && resource?.kind === "unsupported" ? <PreviewRenderer resource={resource} /> : null}
    </div>
  );
}

type DocumentViewMode = "pdf" | "read" | "markdown";

function DocumentMaterialDetail({ material, resource, projectName }: { material: ProjectMaterial; resource: PreviewResource; projectName: string }) {
  useLocale();
  const hasPdfOriginal = Boolean(material.originalPath?.toLowerCase().endsWith(".pdf"));
  const [mode, setMode] = useState<DocumentViewMode>(hasPdfOriginal ? "pdf" : "read");
  return (
    <div className="project-markdown-material">
      <SegmentedControl value={mode} onChange={setMode} label={messages.projectUi.materialViewMode} options={[
        ...(hasPdfOriginal ? [{ value: "pdf" as const, label: "PDF" }] : []),
        { value: "read", label: messages.projectUi.read }, { value: "markdown", label: "Markdown" }
      ]} />
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
  useLocale();
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
        <strong>{messages.projectUi.pdfOriginalUnavailable}</strong>
        <p>{error}</p>
        <Button variant="ghost" type="button" data-motion="action" onClick={onFallback}>{messages.projectUi.viewExtractedText}</Button>
      </div>
    );
  }
  return preview.resource?.kind === "pdf"
    ? <PreviewRenderer resource={preview.resource} onError={(message) => setFailed(message)} />
    : <div className="project-pdf-loading"><LoaderCircle className="spin" size={18} />{messages.projectUi.loadingOriginalPdf}</div>;
}


function materialFilterLabel(kind: MaterialFilter): string {
  return kind === "document" ? messages.projectUi.document : kind === "web" ? messages.projectUi.webpage : kind === "video" ? messages.projectUi.video : messages.projectUi.all;
}

function materialKindLabel(kind: ProjectMaterialKind): string {
  return materialFilterLabel(kind);
}

function materialStatusLabel(status: ProjectMaterial["status"]): string {
  return status === "importing" ? messages.projectUi.importingStatus : status === "converting" ? messages.projectUi.convertingStatus : status === "failed" ? messages.projectUi.conversionFailedStatus : messages.projectUi.readyStatus;
}

const MAX_MATERIAL_LINKS = 50;

/** 按空格/换行拆分粘贴内容，只保留 HTTP(S) 链接；每项独立导入，上限 50 个。 */
function parseMaterialLinks(value: string): string[] {
  const links: string[] = [];
  for (const token of value.split(/\s+/)) {
    if (!token) continue;
    try {
      const parsed = new URL(token);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") continue;
      links.push(token);
    } catch { /* 非 URL 片段直接忽略。 */ }
    if (links.length >= MAX_MATERIAL_LINKS) break;
  }
  return links;
}

function errorText(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
