import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadWindowState, normalizeWindowState, saveWindowState, type WindowBounds } from "./window-state";

const primary: WindowBounds = { x: 0, y: 0, width: 1920, height: 1040 };
const secondary: WindowBounds = { x: 1920, y: 0, width: 1440, height: 900 };
const defaults = { width: 1600, height: 1000 };
const minimums = { width: 720, height: 600 };
const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) fs.rmSync(directory, { recursive: true, force: true });
});

describe("window state", () => {
  it("restores a valid secondary-display window and keeps maximized state", () => {
    const state = normalizeWindowState({
      schemaVersion: 1,
      bounds: { x: 2100, y: 80, width: 1200, height: 760 },
      maximized: true
    }, [primary, secondary], defaults, minimums);

    expect(state.bounds).toEqual({ x: 2100, y: 80, width: 1200, height: 760 });
    expect(state.maximized).toBe(true);
  });

  it("moves an off-screen window to the center of the primary display", () => {
    const state = normalizeWindowState({
      schemaVersion: 1,
      bounds: { x: 4000, y: 2000, width: 1000, height: 700 },
      maximized: false
    }, [primary, secondary], defaults, minimums);

    expect(state.bounds).toEqual({ x: 160, y: 20, width: 1600, height: 1000 });
  });

  it("clamps partially visible and oversized bounds into the matching work area", () => {
    const state = normalizeWindowState({
      schemaVersion: 1,
      bounds: { x: 3100, y: -100, width: 1800, height: 1200 },
      maximized: false
    }, [primary, secondary], defaults, minimums);

    expect(state.bounds).toEqual({ x: 1920, y: 0, width: 1440, height: 900 });
  });

  it("falls back for malformed, non-finite, and obsolete state", () => {
    const expected = { x: 160, y: 20, width: 1600, height: 1000 };
    expect(normalizeWindowState(null, [primary], defaults, minimums).bounds).toEqual(expected);
    expect(normalizeWindowState({ schemaVersion: 1, bounds: { x: 0, y: 0, width: Number.NaN, height: 800 } }, [primary], defaults, minimums).bounds).toEqual(expected);
    expect(normalizeWindowState({ schemaVersion: 0, bounds: { x: 20, y: 20, width: 900, height: 700 } }, [primary], defaults, minimums).bounds).toEqual(expected);
  });

  it("atomically persists and reloads normal bounds", () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "cctools-window-state-"));
    temporaryDirectories.push(directory);
    const filePath = path.join(directory, "window-state.json");
    const bounds = { x: 200, y: 100, width: 1280, height: 800 };

    saveWindowState(filePath, bounds, true);

    expect(loadWindowState(filePath, [primary], defaults, minimums)).toEqual({ schemaVersion: 1, bounds, maximized: true });
  });

  it("loads malformed JSON as a safe primary-display fallback", () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "cctools-window-state-"));
    temporaryDirectories.push(directory);
    const filePath = path.join(directory, "window-state.json");
    fs.writeFileSync(filePath, "{broken", "utf8");

    expect(loadWindowState(filePath, [primary], defaults, minimums).bounds).toEqual({ x: 160, y: 20, width: 1600, height: 1000 });
  });
});
