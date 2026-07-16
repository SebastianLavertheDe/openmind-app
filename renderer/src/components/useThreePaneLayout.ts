import { useCallback, useEffect, useState } from "react";
import { storageJson, writeStorage } from "../ai-utils";

export type ThreePaneLayout = {
  filterWidth: number;
  itemWidth: number;
  filterCollapsed: boolean;
  itemCollapsed: boolean;
};

export const FILTER_WIDTH_MIN = 160;
export const FILTER_WIDTH_MAX = 280;
export const ITEM_WIDTH_MIN = 260;
export const ITEM_WIDTH_MAX = 460;
const COLLAPSED_WIDTH = 48;
const DEFAULT_SPLITTER_WIDTH = 8;

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

export function useThreePaneLayout(storageKey: string, defaults: ThreePaneLayout, options: { splitterWidth?: number } = {}) {
  const [layout, setLayout] = useState<ThreePaneLayout>(() => storageJson(storageKey, defaults));
  useEffect(() => writeStorage(storageKey, layout), [storageKey, layout]);

  const splitterWidth = options.splitterWidth ?? DEFAULT_SPLITTER_WIDTH;
  const columns = `${layout.filterCollapsed ? COLLAPSED_WIDTH : layout.filterWidth}px ${splitterWidth}px ${layout.itemCollapsed ? COLLAPSED_WIDTH : layout.itemWidth}px ${splitterWidth}px minmax(0, 1fr)`;

  const toggleFilter = useCallback(() => setLayout((value) => ({ ...value, filterCollapsed: !value.filterCollapsed })), []);
  const toggleItem = useCallback(() => setLayout((value) => ({ ...value, itemCollapsed: !value.itemCollapsed })), []);
  const resizeFilter = useCallback((delta: number) => setLayout((value) => ({ ...value, filterWidth: clamp(value.filterWidth + delta, FILTER_WIDTH_MIN, FILTER_WIDTH_MAX) })), []);
  const resizeItem = useCallback((delta: number) => setLayout((value) => ({ ...value, itemWidth: clamp(value.itemWidth + delta, ITEM_WIDTH_MIN, ITEM_WIDTH_MAX) })), []);
  const reset = useCallback(() => setLayout(defaults), [defaults]);

  return { layout, columns, toggleFilter, toggleItem, resizeFilter, resizeItem, reset };
}
