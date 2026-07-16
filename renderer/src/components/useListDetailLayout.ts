import { useCallback, useEffect, useRef, useState } from "react";
import { writeStorage } from "../ai-utils";

export type ListDetailLayout = {
  listWidth: number;
  listCollapsed: boolean;
};

export type ListDetailLayoutOptions = {
  minWidth?: number;
  maxWidth?: number;
  splitterWidth?: number;
  legacyStorageKeys?: string[];
};

export const LIST_WIDTH_MIN = 160;
export const LIST_WIDTH_MAX = 280;
const DEFAULT_SPLITTER_WIDTH = 3;
const STORAGE_SCHEMA_VERSION = 1;

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeDefaults(defaults: ListDetailLayout, minWidth: number, maxWidth: number): ListDetailLayout {
  return {
    listWidth: Number.isFinite(defaults.listWidth)
      ? clamp(defaults.listWidth, minWidth, maxWidth)
      : minWidth,
    listCollapsed: typeof defaults.listCollapsed === "boolean" ? defaults.listCollapsed : false
  };
}

function normalizeCurrentStoredLayout(
  value: unknown,
  minWidth: number,
  maxWidth: number
): ListDetailLayout | null {
  if (!isRecord(value)) return null;
  if (
    value.schemaVersion !== STORAGE_SCHEMA_VERSION
    || typeof value.listWidth !== "number"
    || !Number.isFinite(value.listWidth)
    || typeof value.listCollapsed !== "boolean"
  ) return null;
  return {
    listWidth: clamp(value.listWidth, minWidth, maxWidth),
    listCollapsed: value.listCollapsed
  };
}

function normalizeLegacyStoredLayout(
  value: unknown,
  minWidth: number,
  maxWidth: number
): ListDetailLayout | null {
  if (
    !isRecord(value)
    || typeof value.filterWidth !== "number"
    || !Number.isFinite(value.filterWidth)
    || typeof value.filterCollapsed !== "boolean"
  ) return null;
  return {
    listWidth: clamp(value.filterWidth, minWidth, maxWidth),
    listCollapsed: value.filterCollapsed
  };
}

function readStoredLayout(
  key: string,
  normalize: (value: unknown, minWidth: number, maxWidth: number) => ListDetailLayout | null,
  minWidth: number,
  maxWidth: number
): ListDetailLayout | null {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    return normalize(JSON.parse(raw) as unknown, minWidth, maxWidth);
  } catch {
    return null;
  }
}

function loadLayout(
  storageKey: string,
  legacyStorageKeys: string[],
  defaults: ListDetailLayout,
  minWidth: number,
  maxWidth: number
): ListDetailLayout {
  const current = readStoredLayout(storageKey, normalizeCurrentStoredLayout, minWidth, maxWidth);
  if (current) return current;
  for (const legacyKey of legacyStorageKeys) {
    const legacy = readStoredLayout(legacyKey, normalizeLegacyStoredLayout, minWidth, maxWidth);
    if (legacy) return legacy;
  }
  return defaults;
}

export function useListDetailLayout(
  storageKey: string,
  defaults: ListDetailLayout,
  options: ListDetailLayoutOptions = {}
) {
  const minWidth = options.minWidth ?? LIST_WIDTH_MIN;
  const maxWidth = options.maxWidth ?? LIST_WIDTH_MAX;
  const splitterWidth = options.splitterWidth ?? DEFAULT_SPLITTER_WIDTH;
  const normalizedDefaults = normalizeDefaults(defaults, minWidth, maxWidth);
  const [layout, setLayout] = useState<ListDetailLayout>(() => loadLayout(
    storageKey,
    options.legacyStorageKeys ?? [],
    normalizedDefaults,
    minWidth,
    maxWidth
  ));
  const layoutRef = useRef(layout);
  const resizeStartWidthRef = useRef<number | null>(null);
  const [isResizing, setIsResizing] = useState(false);
  layoutRef.current = layout;

  useEffect(() => {
    writeStorage(storageKey, {
      schemaVersion: STORAGE_SCHEMA_VERSION,
      listWidth: layout.listWidth,
      listCollapsed: layout.listCollapsed
    });
  }, [storageKey, layout]);

  const columns = layout.listCollapsed
    ? "0px 0px minmax(0, 1fr)"
    : `${layout.listWidth}px ${splitterWidth}px minmax(0, 1fr)`;

  const toggleList = useCallback(() => {
    setLayout((value) => ({ ...value, listCollapsed: !value.listCollapsed }));
  }, []);

  const setListWidth = useCallback((width: number) => {
    if (!Number.isFinite(width)) return;
    setLayout((value) => ({ ...value, listWidth: clamp(width, minWidth, maxWidth) }));
  }, [minWidth, maxWidth]);

  const resizeList = useCallback((delta: number) => {
    if (!Number.isFinite(delta)) return;
    setLayout((value) => ({
      ...value,
      listWidth: clamp(value.listWidth + delta, minWidth, maxWidth)
    }));
  }, [minWidth, maxWidth]);

  const reset = useCallback(() => {
    setLayout(normalizedDefaults);
  }, [normalizedDefaults.listCollapsed, normalizedDefaults.listWidth]);

  const beginListResize = useCallback(() => {
    resizeStartWidthRef.current = layoutRef.current.listWidth;
  }, []);

  const cancelListResize = useCallback(() => {
    const startWidth = resizeStartWidthRef.current;
    if (startWidth === null) return;
    setListWidth(startWidth);
    resizeStartWidthRef.current = null;
  }, [setListWidth]);

  const onResizeActiveChange = useCallback((active: boolean) => {
    setIsResizing(active);
    if (!active) resizeStartWidthRef.current = null;
  }, []);

  return {
    layout,
    columns,
    isResizing,
    toggleList,
    setListWidth,
    resizeList,
    reset,
    beginListResize,
    cancelListResize,
    onResizeActiveChange
  };
}
