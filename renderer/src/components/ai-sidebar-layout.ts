export const AI_SIDEBAR_LAYOUT_KEY = "openmind.ai.sidebar-layout.v2";
export const LEGACY_AI_SIDEBAR_WIDTHS_KEY = "openmind.ai.sidebar-widths.v1";
export const AI_SIDEBAR_LAYOUT_SCHEMA_VERSION = 1;

export const DEFAULT_SIDEBAR_RATIOS = {
  default: 1 / 3,
  wide: 1 / 2
} as const;

export type SidebarMode = keyof typeof DEFAULT_SIDEBAR_RATIOS;
export type SidebarRatios = Record<SidebarMode, number>;
export type LegacySidebarWidths = Record<SidebarMode, number>;

export type SidebarBounds = {
  /** The width left after navigation has been removed from the shell. */
  usableInlineSize: number;
  minInlineSize: number;
  maxInlineSize: number;
};

export type SidebarBoundsInput = {
  shellInlineSize: number;
  navigationInlineSize: number;
  workspaceMinInlineSize: number;
  sidebarMinInlineSize: number;
  floating: boolean;
  /** Insets are visual chrome, not a sidebar width cap. */
  floatingInlineGutter?: number;
};

function finitePositive(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function finiteRatio(value: unknown): value is number {
  return finitePositive(value) && value <= 1;
}

export function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

/**
 * The upper bound is the real remaining space in the current shell. There is
 * intentionally no device-specific maximum width here: an ultra-wide shell
 * may offer a proportionally wider AI pane while preserving the page's own
 * minimum workspace contract.
 */
export function sidebarBounds({
  shellInlineSize,
  navigationInlineSize,
  workspaceMinInlineSize,
  sidebarMinInlineSize,
  floating,
  floatingInlineGutter = 0
}: SidebarBoundsInput): SidebarBounds {
  const usableInlineSize = Math.max(0, shellInlineSize - navigationInlineSize);
  const reservedInlineSize = floating
    ? Math.max(0, floatingInlineGutter)
    : Math.max(0, workspaceMinInlineSize);
  const maxInlineSize = Math.max(0, usableInlineSize - reservedInlineSize);
  return {
    usableInlineSize,
    // When a small overlay has less room than the ideal component minimum,
    // fitting the viewport wins. The responsive state machine will promote it
    // to canvas before this can make a docked workspace unusable.
    minInlineSize: Math.min(Math.max(0, sidebarMinInlineSize), maxInlineSize),
    maxInlineSize
  };
}

export function sidebarWidthForRatio(ratio: number, bounds: SidebarBounds): number {
  if (bounds.usableInlineSize <= 0) return 0;
  return clamp(ratio * bounds.usableInlineSize, bounds.minInlineSize, bounds.maxInlineSize);
}

export function sidebarRatioForWidth(width: number, bounds: SidebarBounds): number {
  if (bounds.usableInlineSize <= 0) return 0;
  return clamp(width, bounds.minInlineSize, bounds.maxInlineSize) / bounds.usableInlineSize;
}

export function normalizeSidebarRatios(value: unknown): SidebarRatios | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if (record.schemaVersion !== AI_SIDEBAR_LAYOUT_SCHEMA_VERSION || !record.ratios || typeof record.ratios !== "object") return null;
  const ratios = record.ratios as Record<string, unknown>;
  if (!finiteRatio(ratios.default) || !finiteRatio(ratios.wide)) return null;
  return { default: ratios.default, wide: ratios.wide };
}

/** Reads only the former fixed-pixel shape so it can be converted once. */
export function normalizeLegacySidebarWidths(value: unknown, sidebarMinInlineSize: number): LegacySidebarWidths | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const source = "schemaVersion" in record
    ? record.schemaVersion === 1 && record.widths && typeof record.widths === "object"
      ? record.widths as Record<string, unknown>
      : null
    : record;
  if (!source || !finitePositive(source.default) || !finitePositive(source.wide)) return null;
  return {
    default: Math.max(sidebarMinInlineSize, source.default),
    wide: Math.max(sidebarMinInlineSize, source.wide)
  };
}
