import fs from "node:fs";
import { writeJsonAtomic } from "./lib/fs-utils";

export const WINDOW_STATE_SCHEMA_VERSION = 1;

export type WindowBounds = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type WindowState = {
  schemaVersion: typeof WINDOW_STATE_SCHEMA_VERSION;
  bounds: WindowBounds;
  maximized: boolean;
};

export type WindowSize = Pick<WindowBounds, "width" | "height">;

const MIN_VISIBLE_WIDTH = 64;
const MIN_VISIBLE_HEIGHT = 32;

function finiteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function intersection(candidate: WindowBounds, workArea: WindowBounds): { width: number; height: number; area: number } {
  const width = Math.max(0, Math.min(candidate.x + candidate.width, workArea.x + workArea.width) - Math.max(candidate.x, workArea.x));
  const height = Math.max(0, Math.min(candidate.y + candidate.height, workArea.y + workArea.height) - Math.max(candidate.y, workArea.y));
  return { width, height, area: width * height };
}

function fitSize(size: WindowSize, workArea: WindowBounds, minimumSize: WindowSize): WindowSize {
  const width = clamp(size.width, Math.min(minimumSize.width, workArea.width), workArea.width);
  const height = clamp(size.height, Math.min(minimumSize.height, workArea.height), workArea.height);
  return { width, height };
}

function centeredBounds(workArea: WindowBounds, size: WindowSize, minimumSize: WindowSize): WindowBounds {
  const fitted = fitSize(size, workArea, minimumSize);
  return {
    x: Math.round(workArea.x + (workArea.width - fitted.width) / 2),
    y: Math.round(workArea.y + (workArea.height - fitted.height) / 2),
    ...fitted
  };
}

/**
 * First launch keeps the desktop workspace aspect ratio: the default only
 * shrinks proportionally to the work area (independent clamping would inflate
 * the height on short displays), never grows, and stays visible on displays
 * smaller than the minimum size.
 */
export function fittedDefaultSize(defaultSize: WindowSize, workArea: WindowBounds, minimumSize: WindowSize): WindowSize {
  const scale = Math.min(1, workArea.width / defaultSize.width, workArea.height / defaultSize.height);
  if (scale >= 1) return { ...defaultSize };
  const proportional = {
    width: Math.max(minimumSize.width, Math.floor(defaultSize.width * scale)),
    height: Math.max(minimumSize.height, Math.floor(defaultSize.height * scale))
  };
  return fitSize(proportional, workArea, minimumSize);
}

function fallbackBounds(workAreas: WindowBounds[], defaultSize: WindowSize, minimumSize: WindowSize): WindowBounds {
  const primary = workAreas[0];
  if (primary) return centeredBounds(primary, fittedDefaultSize(defaultSize, primary, minimumSize), minimumSize);
  return {
    x: 0,
    y: 0,
    width: Math.max(minimumSize.width, defaultSize.width),
    height: Math.max(minimumSize.height, defaultSize.height)
  };
}

function parseBounds(value: unknown): WindowBounds | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<WindowBounds>;
  if (![candidate.x, candidate.y, candidate.width, candidate.height].every(finiteNumber)) return null;
  if (candidate.width! <= 0 || candidate.height! <= 0) return null;
  return {
    x: Math.round(candidate.x!),
    y: Math.round(candidate.y!),
    width: Math.round(candidate.width!),
    height: Math.round(candidate.height!)
  };
}

/**
 * Restores a window into a visible display work area. `workAreas[0]` is the
 * primary display and is used when the stored display is no longer attached.
 */
export function normalizeWindowState(
  value: unknown,
  workAreas: WindowBounds[],
  defaultSize: WindowSize,
  minimumSize: WindowSize
): WindowState {
  const raw = value && typeof value === "object" ? value as Partial<WindowState> : null;
  const storedBounds = raw?.schemaVersion === WINDOW_STATE_SCHEMA_VERSION ? parseBounds(raw.bounds) : null;
  if (!storedBounds || !workAreas.length) {
    return {
      schemaVersion: WINDOW_STATE_SCHEMA_VERSION,
      bounds: fallbackBounds(workAreas, defaultSize, minimumSize),
      maximized: Boolean(storedBounds && raw?.maximized === true)
    };
  }

  const match = workAreas
    .map((workArea) => ({ workArea, overlap: intersection(storedBounds, workArea) }))
    .sort((left, right) => right.overlap.area - left.overlap.area)[0];
  if (!match || match.overlap.width < MIN_VISIBLE_WIDTH || match.overlap.height < MIN_VISIBLE_HEIGHT) {
    return {
      schemaVersion: WINDOW_STATE_SCHEMA_VERSION,
      bounds: fallbackBounds(workAreas, defaultSize, minimumSize),
      maximized: raw?.maximized === true
    };
  }

  const size = fitSize(storedBounds, match.workArea, minimumSize);
  return {
    schemaVersion: WINDOW_STATE_SCHEMA_VERSION,
    bounds: {
      x: clamp(storedBounds.x, match.workArea.x, match.workArea.x + match.workArea.width - size.width),
      y: clamp(storedBounds.y, match.workArea.y, match.workArea.y + match.workArea.height - size.height),
      ...size
    },
    maximized: raw?.maximized === true
  };
}

export function loadWindowState(
  filePath: string,
  workAreas: WindowBounds[],
  defaultSize: WindowSize,
  minimumSize: WindowSize
): WindowState {
  let value: unknown = null;
  try {
    value = JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    // Missing and malformed state both safely fall back to the primary display.
  }
  return normalizeWindowState(value, workAreas, defaultSize, minimumSize);
}

export function saveWindowState(filePath: string, bounds: WindowBounds, maximized: boolean): void {
  const normalizedBounds = parseBounds(bounds);
  if (!normalizedBounds) return;
  writeJsonAtomic(filePath, {
    schemaVersion: WINDOW_STATE_SCHEMA_VERSION,
    bounds: normalizedBounds,
    maximized: Boolean(maximized)
  } satisfies WindowState);
}
