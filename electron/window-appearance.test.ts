import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { WINDOWS_TITLEBAR_HEIGHT, windowAppearance, windowsTitleBarOverlay } from "./window-appearance";

describe("windowAppearance", () => {
  it("uses one transparent Mica surface and a hidden title bar on Windows", () => {
    expect(windowAppearance("win32", false)).toEqual({
      backgroundColor: "#00000000",
      backgroundMaterial: "mica",
      titleBarStyle: "hidden",
      titleBarOverlay: {
        color: "#00000000",
        symbolColor: "#5f6368",
        height: WINDOWS_TITLEBAR_HEIGHT
      }
    });
  });

  it("uses light title-bar symbols for dark Windows chrome", () => {
    expect(windowsTitleBarOverlay(true).symbolColor).toBe("#f2f2ef");
  });

  it("keeps native window chrome on other platforms", () => {
    expect(windowAppearance("linux", false)).toEqual({
      backgroundColor: "#f6f7f9"
    });
  });

  it("keeps the renderer titlebar strip in sync with the native overlay height", () => {
    // vitest 从仓库根目录运行，renderer CSS 以根相对路径读取。
    const css = readFileSync(path.resolve(process.cwd(), "renderer/src/styles/workbuddy-refactor.css"), "utf8");
    const declared = css.match(/--window-titlebar-height:\s*(\d+)px/);
    expect(declared?.[1]).toBe(String(WINDOWS_TITLEBAR_HEIGHT));
  });
});
