import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_PREVIEW_RATIO,
  FILE_PREVIEW_SPLIT_MIN_INLINE_SIZE,
  FILE_PREVIEW_LAYOUT_STORAGE_KEY,
  filePreviewLayoutMode,
  loadPreviewRatio,
  normalizePreviewLayout,
  savePreviewRatio
} from "./file-preview-layout";

describe("AI file preview layout persistence", () => {
  it("derives the rendering mode from the workbench container boundary", () => {
    expect(filePreviewLayoutMode(null)).toBe("split");
    expect(filePreviewLayoutMode(FILE_PREVIEW_SPLIT_MIN_INLINE_SIZE - 1)).toBe("preview-only");
    expect(filePreviewLayoutMode(FILE_PREVIEW_SPLIT_MIN_INLINE_SIZE)).toBe("split");
  });

  it("loads a valid versioned ratio", () => {
    const storage = { getItem: vi.fn(() => JSON.stringify({ schemaVersion: 1, ratio: 0.61 })), setItem: vi.fn() };
    expect(loadPreviewRatio(storage)).toBe(0.61);
  });

  it("clamps finite stored ratios into the supported range", () => {
    expect(normalizePreviewLayout({ schemaVersion: 1, ratio: 0.1 })).toBe(0.34);
    expect(normalizePreviewLayout({ schemaVersion: 1, ratio: 0.99 })).toBe(0.7);
  });

  it("falls back for malformed JSON, obsolete schemas, and non-finite ratios", () => {
    expect(loadPreviewRatio({ getItem: () => "{broken", setItem: vi.fn() })).toBe(DEFAULT_PREVIEW_RATIO);
    expect(normalizePreviewLayout({ schemaVersion: 0, ratio: 0.61 })).toBe(DEFAULT_PREVIEW_RATIO);
    expect(normalizePreviewLayout({ schemaVersion: 1, ratio: Number.NaN })).toBe(DEFAULT_PREVIEW_RATIO);
    expect(normalizePreviewLayout({ schemaVersion: 1, ratio: "0.61" })).toBe(DEFAULT_PREVIEW_RATIO);
  });

  it("survives storage access failures", () => {
    const storage = {
      getItem: vi.fn(() => { throw new Error("blocked"); }),
      setItem: vi.fn(() => { throw new Error("full"); })
    };
    expect(loadPreviewRatio(storage)).toBe(DEFAULT_PREVIEW_RATIO);
    expect(() => savePreviewRatio(storage, 0.6)).not.toThrow();
  });

  it("writes a clamped versioned value", () => {
    const storage = { getItem: vi.fn(), setItem: vi.fn() };
    savePreviewRatio(storage, 1.5);
    expect(storage.setItem).toHaveBeenCalledWith(
      FILE_PREVIEW_LAYOUT_STORAGE_KEY,
      JSON.stringify({ schemaVersion: 1, ratio: 0.7 })
    );
  });
});
