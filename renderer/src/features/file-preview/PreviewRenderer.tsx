import { lazy, Suspense } from "react";
import type { MarkdownReaderLayout } from "../../components/MarkdownReader";
import type { PreviewResource } from "./model";
import { DocumentPreview } from "./renderers/DocumentPreview";
import { UnsupportedPreview } from "./renderers/UnsupportedPreview";

const PdfPreview = lazy(() => import("./renderers/PdfPreview"));
const VideoPreview = lazy(() => import("./renderers/VideoPreview"));

export function PreviewRenderer({ resource, content, layout = "file", onError, onOpenExternal }: {
  resource: PreviewResource;
  content?: string;
  layout?: MarkdownReaderLayout;
  onError?(message: string): void;
  onOpenExternal?(): void;
}) {
  switch (resource.kind) {
    case "document":
      return <DocumentPreview resource={resource} content={content} layout={layout} />;
    case "pdf":
      return <Suspense fallback={<div className="preview-state">正在加载 PDF 阅读器…</div>}><PdfPreview resource={resource} onError={onError} /></Suspense>;
    case "video":
      return <Suspense fallback={<div className="preview-state">正在加载视频预览…</div>}><VideoPreview key={resource.id} resource={resource} onOpenExternal={onOpenExternal} /></Suspense>;
    case "unsupported":
      return <UnsupportedPreview resource={resource} />;
    default:
      return assertNever(resource);
  }
}

function assertNever(value: never): never {
  throw new Error(`Unhandled preview resource: ${JSON.stringify(value)}`);
}
