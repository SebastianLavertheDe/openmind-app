import type { ContentRecord } from "@shared/contracts";

export type PreviewTranscriptSegment = {
  id: string;
  startMs: number;
  endMs: number;
  text: string;
  speaker?: string;
};

export type VideoPlayback =
  | { kind: "local-video"; mediaUrl: string }
  | { kind: "trusted-bilibili"; embedUrl: string; videoId: string }
  | {
      kind: "trusted-youtube";
      embedUrl: string;
      videoId: string;
    }
  | {
      kind: "external-only";
      sourceUrl: string;
    };

export type DocumentPreviewResource = {
  kind: "document";
  id: string;
  path: string;
  title: string;
  record: ContentRecord;
};

export type PdfPreviewResource = {
  kind: "pdf";
  id: string;
  path: string;
  title: string;
  data: Uint8Array;
};

export type VideoPreviewResource = {
  kind: "video";
  id: string;
  path: string;
  title: string;
  playback: VideoPlayback;
  transcript: PreviewTranscriptSegment[];
  warnings?: string[];
  durationMs?: number;
};

export type UnsupportedPreviewResource = {
  kind: "unsupported";
  id: string;
  path: string;
  title: string;
  reason: string;
};

export type PreviewResource =
  | DocumentPreviewResource
  | ImagePreviewResource
  | PdfPreviewResource
  | VideoPreviewResource
  | AudioPreviewResource
  | UnsupportedPreviewResource;

export type AudioPreviewResource = {
  kind: "audio"; id: string; path: string; title: string; mediaUrl: string;
};

export type ImagePreviewResource = {
  kind: "image";
  id: string;
  path: string;
  title: string;
  dataUrl: string;
};

export type PreviewDraft = {
  content: string;
  title: string;
};

export type PreviewSaveInput = PreviewDraft;

export type FilePreviewCapabilities = {
  editContent: boolean;
  editTitle: boolean;
  openExternal: boolean;
};

export type FilePreviewSource = {
  readonly id: string;
  readonly path: string;
  readonly capabilities: FilePreviewCapabilities;
  load(signal?: AbortSignal): Promise<PreviewResource>;
  save?(input: PreviewSaveInput): Promise<PreviewResource>;
  openExternal?(): Promise<void>;
};

export function documentPreviewResource(record: ContentRecord, id = record.path): DocumentPreviewResource {
  const path = record.path || id;
  return {
    kind: "document",
    id,
    path,
    title: record.name || path.split(/[\\/]/).at(-1) || path,
    record
  };
}

export function previewResourceDraft(resource: PreviewResource): PreviewDraft {
  return {
    content: resource.kind === "document" ? resource.record.content || "" : "",
    title: resource.title
  };
}

export function previewResourceTruncated(resource: PreviewResource | null): boolean {
  return resource?.kind === "document" && Boolean(resource.record.truncated);
}

export function samePreviewDraft(left: PreviewDraft, right: PreviewDraft): boolean {
  return left.content === right.content && left.title === right.title;
}
