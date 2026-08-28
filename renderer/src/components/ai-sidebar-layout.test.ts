import { describe, expect, it } from "vitest";
import {
  normalizeLegacySidebarWidths,
  normalizeSidebarRatios,
  sidebarBounds,
  sidebarRatioForWidth,
  sidebarWidthForRatio
} from "./ai-sidebar-layout";

describe("AI sidebar adaptive layout", () => {
  it("uses only the actual remaining docked space as its maximum", () => {
    const fullscreen = sidebarBounds({
      shellInlineSize: 2_560,
      navigationInlineSize: 260,
      workspaceMinInlineSize: 544,
      sidebarMinInlineSize: 380,
      floating: false
    });

    expect(fullscreen.maxInlineSize).toBe(1_756);
    expect(sidebarWidthForRatio(1 / 2, fullscreen)).toBe(1_150);
    expect(fullscreen.maxInlineSize).toBeGreaterThan(960);
  });

  it("keeps one user preference proportional across restored and maximized windows", () => {
    const restored = sidebarBounds({
      shellInlineSize: 1_670,
      navigationInlineSize: 260,
      workspaceMinInlineSize: 544,
      sidebarMinInlineSize: 380,
      floating: false
    });
    const maximized = sidebarBounds({
      shellInlineSize: 2_560,
      navigationInlineSize: 260,
      workspaceMinInlineSize: 544,
      sidebarMinInlineSize: 380,
      floating: false
    });

    const ratio = 1 / 2;
    expect(sidebarWidthForRatio(ratio, restored)).toBe(705);
    expect(sidebarWidthForRatio(ratio, maximized)).toBe(1_150);
    expect(sidebarRatioForWidth(1_150, maximized)).toBeCloseTo(ratio);
  });

  it("allows a floating panel to use all available shell space without a fixed cap", () => {
    const overlay = sidebarBounds({
      shellInlineSize: 1_280,
      navigationInlineSize: 260,
      workspaceMinInlineSize: 760,
      sidebarMinInlineSize: 380,
      floating: true
    });

    expect(overlay.maxInlineSize).toBe(1_020);
    expect(sidebarWidthForRatio(.95, overlay)).toBe(969);
  });

  it("compromises the component minimum when the remaining width is smaller", () => {
    const constrained = sidebarBounds({
      shellInlineSize: 1_200,
      navigationInlineSize: 260,
      workspaceMinInlineSize: 800,
      sidebarMinInlineSize: 380,
      floating: false
    });

    expect(constrained.maxInlineSize).toBe(140);
    expect(constrained.minInlineSize).toBe(140);
    expect(sidebarWidthForRatio(1 / 2, constrained)).toBe(140);
  });

  it("accepts only valid adaptive preferences and can migrate the legacy pixel shape", () => {
    expect(normalizeSidebarRatios({ schemaVersion: 1, ratios: { default: 1 / 3, wide: 1 / 2 } })).toEqual({ default: 1 / 3, wide: 1 / 2 });
    expect(normalizeSidebarRatios({ schemaVersion: 1, ratios: { default: 0, wide: 1 / 2 } })).toBeNull();
    expect(normalizeLegacySidebarWidths({ default: 600, wide: 900 }, 380)).toEqual({ default: 600, wide: 900 });
  });
});
