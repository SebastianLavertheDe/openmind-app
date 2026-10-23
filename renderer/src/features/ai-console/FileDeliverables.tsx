import { useEffect, useState } from "react";
import { Film, Image, Music2, Play, Eye, FileText } from "lucide-react";
import { FileDeliverableRecordSchema, fileDeliverableKey, type FileDeliverable, type FileDeliverableRecord } from "@shared/file-deliverables";
import type { GeneratedImage } from "@shared/image-generation";
import { messages as m } from "@shared/messages";
import { Button } from "../../design-system/components";
import { useLocale } from "../../i18n";
import { useFilePreview } from "./file-preview-context";
import { ownedProjectRelativePath } from "./project-preview-source";
import { ChatImage } from "./ChatImages";

type DisplayFile = Omit<FileDeliverableRecord, "byteSize"> & { byteSize?: number; title?: string };

export function FileDeliverables({ declarations, images = [], projectName }: { declarations: readonly FileDeliverable[]; images?: readonly GeneratedImage[]; projectName?: string }) {
  useLocale();
  const openPreview = useFilePreview();
  const [loaded, setLoaded] = useState<{ key: string; files: DisplayFile[] } | null>(null);
  const key = JSON.stringify([projectName || null, declarations, images.map(image => [image.id, image.source])]);
  useEffect(() => {
    let cancelled = false;
    if (!declarations.length) return;
    void Promise.allSettled(declarations.map(async declaration => {
      // Generated assets live outside Project outputs. Only an image actually
      // recorded for this turn may use that existing conversation-image route.
      const image = images.find(image => fileDeliverableKey(image.source) === fileDeliverableKey(declaration.path));
      if (image) return { id: image.id, path: image.source, name: image.source.split("/").at(-1) || image.title, kind: "image" as const, title: declaration.title || image.title };
      const path = projectName ? ownedProjectRelativePath(declaration.path, projectName) : declaration.path;
      if (!path) throw new Error("Invalid project file");
      const record = FileDeliverableRecordSchema.parse(await window.openmind.readFileDeliverable({ path, ...(projectName ? { projectName } : {}) }));
      return { ...record, title: declaration.title };
    })).then(results => {
      if (cancelled) return;
      const files = results.flatMap(result => result.status === "fulfilled" ? [result.value] : []);
      setLoaded({ key, files: [...new Map(files.map(file => [file.id, file])).values()] });
    });
    return () => { cancelled = true; };
  }, [key]);
  const files = loaded?.key === key ? loaded.files : [];
  if (!files.length) return null;
  return <section className="reply-media-results" aria-label={m.interface.mediaDeliverables}>
    <strong className="reply-media-heading">{m.interface.mediaDeliverables}</strong>
    <div className="reply-media-list">{files.map(file => {
      const Icon = file.kind === "video" ? Film : file.kind === "audio" ? Music2 : file.kind === "image" ? Image : FileText;
      const label = file.title || file.name;
      if (file.kind === "image") return <div className="generated-images" key={file.id}>
        <article className="generated-image"><ChatImage source={file.path} title={label} /></article>
      </div>;
      const action = file.kind === "file" ? m.interface.openDeliverable : m.interface.previewMedia;
      return <article className="reply-media-card" key={file.id}>
        <span className="reply-media-icon" aria-hidden><Icon size={22} /></span>
        <div className="reply-media-description"><strong>{label}</strong><span>{file.kind === "file" ? file.name : m.interface.mediaKind[file.kind]}{file.byteSize !== undefined ? ` · ${formatMediaSize(file.byteSize)}` : ""}</span></div>
        <Button variant="ghost" size="sm" leadingIcon={file.kind === "file" ? <Eye size={15} /> : <Play size={15} />}
          aria-label={`${action} ${label}`} disabled={file.kind !== "file" && !openPreview && Boolean(projectName)}
          onClick={() => {
            if (file.kind === "file") void window.openmind.openPath(projectName ? `openmind/projects/${projectName}/${file.path}` : file.path);
            else if (openPreview) openPreview(file.path, projectName ? { projectName } : undefined);
            else if (!projectName) void window.openmind.openPath(file.path);
          }}>
          {action}
        </Button>
      </article>;
    })}</div>
  </section>;
}

function formatMediaSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
