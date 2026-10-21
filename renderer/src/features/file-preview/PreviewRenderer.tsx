import { useLocale } from "../../i18n";
import { messages as uiMessages } from "@shared/messages";
import { lazy, Suspense } from "react";
import type { MarkdownReaderLayout } from "../../components/MarkdownReader";
import type { PreviewResource } from "./model";
import { DocumentPreview } from "./renderers/DocumentPreview";
import { UnsupportedPreview } from "./renderers/UnsupportedPreview";
import { ImagePreview } from "./renderers/ImagePreview";

const PdfPreview = lazy(() => import("./renderers/PdfPreview"));
const VideoPreview = lazy(() => import("./renderers/VideoPreview"));

export function PreviewRenderer({ resource, content, layout = "file", onError, onOpenExternal, onRetryTranscript, retryingTranscript }: {
  resource: PreviewResource;
  content?: string;
  layout?: MarkdownReaderLayout;
  onError?(message: string): void;
  onOpenExternal?(): void;
  onRetryTranscript?(): void;
  retryingTranscript?: boolean;
}) {
  useLocale();
  switch (resource.kind) {
    case "image":
      return <ImagePreview key={resource.id} resource={resource} />;
    case "document":
      return <DocumentPreview resource={resource} content={content} layout={layout} />;
    case "pdf":
      return <Suspense fallback={<div className="preview-state">{uiMessages.interface.loadingPdf}</div>}><PdfPreview resource={resource} onError={onError} /></Suspense>;
    case "video":
      return <Suspense fallback={<div className="preview-state">{uiMessages.interface.loadingVideo}</div>}><VideoPreview key={resource.id} resource={resource} onOpenExternal={onOpenExternal} onRetryTranscript={onRetryTranscript} retryingTranscript={retryingTranscript} /></Suspense>;
    case "unsupported":
      return <UnsupportedPreview resource={resource} />;
    default:
      return assertNever(resource);
  }
}

function assertNever(value: never): never {
  throw new Error(`Unhandled preview resource: ${JSON.stringify(value)}`);
}
