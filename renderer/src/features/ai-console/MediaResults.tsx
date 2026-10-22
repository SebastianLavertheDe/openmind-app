import { useEffect, useState } from "react";
import { Film, Image, Music2, Play, Eye } from "lucide-react";
import { MediaPreviewRecordSchema, type MediaPreviewRecord } from "@shared/media-preview";
import { messages as m } from "@shared/messages";
import { Button } from "../../design-system/components";
import { useLocale } from "../../i18n";
import { useFilePreview } from "./file-preview-context";
import { ownedProjectRelativePath } from "./project-preview-source";

export function MediaResults({ paths, projectName }: { paths: string[]; projectName?: string }) {
  useLocale();
  const openPreview = useFilePreview();
  const [loaded, setLoaded] = useState<{ key: string; files: MediaPreviewRecord[] } | null>(null);
  const key = JSON.stringify([projectName || null, paths]);
  useEffect(() => {
    let cancelled = false;
    if (!window.openmind.readMediaPreview || !paths.length) return;
    const scopedPaths = projectName ? paths.map(path => ownedProjectRelativePath(path, projectName)).filter((path): path is string => path !== null) : paths;
    void Promise.allSettled(scopedPaths.map(async path => MediaPreviewRecordSchema.parse(await window.openmind.readMediaPreview({ path, ...(projectName ? { projectName } : {}) })))).then(results => {
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
      const Icon = file.kind === "video" ? Film : file.kind === "audio" ? Music2 : Image;
      return <article className="reply-media-card" key={file.id}>
        <span className="reply-media-icon" aria-hidden><Icon size={22} /></span>
        <div className="reply-media-description"><strong>{file.name}</strong><span>{m.interface.mediaKind[file.kind]} · {formatMediaSize(file.byteSize)}</span></div>
        <Button variant="ghost" size="sm" leadingIcon={file.kind === "image" ? <Eye size={15} /> : <Play size={15} />}
          aria-label={`${m.interface.previewMedia} ${file.name}`} disabled={!openPreview && Boolean(projectName)}
          onClick={() => { if (openPreview) openPreview(file.path, projectName ? { projectName } : undefined); else if (!projectName) void window.openmind.openPath(file.path); }}>
          {m.interface.previewMedia}
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
