export const FILE_PREVIEW_LAYOUT_STORAGE_KEY = "openmind:ai-file-preview-layout:v1";
export const FILE_PREVIEW_LAYOUT_SCHEMA_VERSION = 1;
export const DEFAULT_PREVIEW_RATIO = 0.56;
export const MIN_PREVIEW_RATIO = 0.34;
export const MAX_PREVIEW_RATIO = 0.7;
export const FILE_PREVIEW_SPLIT_MIN_INLINE_SIZE = 980;
export const FILE_PREVIEW_PANE_MIN_INLINE_SIZE = 360;
export const FILE_PREVIEW_SPLITTER_INLINE_SIZE = 4;

export type FilePreviewLayoutMode = "split" | "preview-only";

export function filePreviewLayoutMode(inlineSize: number | null): FilePreviewLayoutMode {
  return inlineSize === null || inlineSize >= FILE_PREVIEW_SPLIT_MIN_INLINE_SIZE ? "split" : "preview-only";
}

type StorageLike = Pick<Storage, "getItem" | "setItem">;

export function clampPreviewRatio(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_PREVIEW_RATIO;
  return Math.min(MAX_PREVIEW_RATIO, Math.max(MIN_PREVIEW_RATIO, value));
}

export function normalizePreviewLayout(value: unknown): number {
  if (!value || typeof value !== "object") return DEFAULT_PREVIEW_RATIO;
  const candidate = value as { schemaVersion?: unknown; ratio?: unknown };
  if (candidate.schemaVersion !== FILE_PREVIEW_LAYOUT_SCHEMA_VERSION || typeof candidate.ratio !== "number") {
    return DEFAULT_PREVIEW_RATIO;
  }
  return clampPreviewRatio(candidate.ratio);
}

export function loadPreviewRatio(storage: StorageLike | null | undefined): number {
  if (!storage) return DEFAULT_PREVIEW_RATIO;
  try {
    const raw = storage.getItem(FILE_PREVIEW_LAYOUT_STORAGE_KEY);
    return raw ? normalizePreviewLayout(JSON.parse(raw)) : DEFAULT_PREVIEW_RATIO;
  } catch {
    return DEFAULT_PREVIEW_RATIO;
  }
}

export function savePreviewRatio(storage: StorageLike | null | undefined, ratio: number): void {
  if (!storage) return;
  try {
    storage.setItem(FILE_PREVIEW_LAYOUT_STORAGE_KEY, JSON.stringify({
      schemaVersion: FILE_PREVIEW_LAYOUT_SCHEMA_VERSION,
      ratio: clampPreviewRatio(ratio)
    }));
  } catch {
    // Storage may be disabled or full; layout changes should remain usable in-memory.
  }
}
