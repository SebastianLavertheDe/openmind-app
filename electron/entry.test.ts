// @vitest-environment node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import { transformSync } from "esbuild";
import { afterEach, describe, expect, it, vi } from "vitest";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });
const entry = transformSync(fs.readFileSync(path.resolve("electron/entry.ts"), "utf8"), { loader: "ts", format: "cjs" }).code;
const frameRenderer = fs.readFileSync(path.resolve("config/skill-library/assets/om-short-video/scripts/render_frames.cjs"), "utf8");

function fixture(packaged: boolean, argumentsFor: (root: string) => string[]) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "openmind-entry-")); roots.push(root);
  const compiledRoot = path.join(root, ".build/electron/electron");
  const resources = path.join(root, "resources");
  const bundle = path.join(packaged ? resources : path.join(root, ".build"), "skill-library");
  const renderer = path.join(bundle, "om-short-video/scripts/render_frames.cjs");
  fs.mkdirSync(path.dirname(renderer), { recursive: true }); fs.writeFileSync(renderer, frameRenderer);
  fs.writeFileSync(path.join(root, "storyboard.json"), JSON.stringify({ width: 320, height: 180, slides: [{ text: "Hello <world>" }] }));
  const app = { isPackaged: packaged, setPath: vi.fn(), commandLine: { appendSwitch: vi.fn() }, whenReady: vi.fn(async () => undefined), quit: vi.fn(), exit: vi.fn() };
  const desktop = vi.fn(); const compositor = vi.fn(); const html: string[] = []; const stderr = vi.fn();
  class BrowserWindow {
    webContents = { setWindowOpenHandler: vi.fn(), executeJavaScript: vi.fn(), capturePage: async () => ({ toPNG: () => Buffer.from("fixture-frame") }) };
    async loadURL(url: string) { html.push(decodeURIComponent(url)); }
    destroy() {}
  }
  const context = vm.createContext({
    __dirname: compiledRoot, exports: {}, module: { exports: {} },
    process: { argv: ["OpenMind", ...argumentsFor(root)], resourcesPath: resources, stderr: { write: stderr } },
    require: (id: string) => {
      if (id === "electron") return { app, BrowserWindow };
      if (id === "node:path") return path;
      if (id === "node:fs") return fs;
      if (id === "./main") return desktop();
      if (id === "./images/skill-image-cli") return compositor();
      if (id !== renderer) throw new Error(`Unexpected module: ${id}`);
      return vm.runInContext(`(function () {\n${fs.readFileSync(id, "utf8")}\n})()`, context);
    }
  });
  vm.runInContext(entry, context);
  return { root, app, desktop, compositor, html, stderr };
}

describe("Electron entry dispatch", () => {
  it.each([false, true])("dispatches image composition to the fixed app module (packaged=%s)", packaged => {
    const f = fixture(packaged, root => ["/untrusted/script.js", "--openmind-compose-image", path.join(root, "job.json"), path.join(root, "result.png")]);
    expect(f.compositor).toHaveBeenCalledOnce();
    expect(f.desktop).not.toHaveBeenCalled();
  });
  it.each([false, true])("renders in an isolated profile without loading the desktop (packaged=%s)", async packaged => {
    const f = fixture(packaged, root => ["--no-sandbox", "/untrusted/render_frames.cjs", "--openmind-render-video-frames", path.join(root, "storyboard.json"), path.join(root, "frames")]);
    await vi.waitFor(() => expect(f.app.quit).toHaveBeenCalled());
    expect(f.desktop).not.toHaveBeenCalled();
    expect(f.app.exit).not.toHaveBeenCalled();
    expect(f.app.setPath).toHaveBeenCalledWith("userData", path.join(f.root, "frames/electron-profile"));
    expect(f.app.setPath).toHaveBeenCalledWith("sessionData", path.join(f.root, "frames/electron-profile"));
    expect(fs.readFileSync(path.join(f.root, "frames/frame-0.png"), "utf8")).toBe("fixture-frame");
    expect(f.html[0]).toContain("Hello &lt;world&gt;");
  });

  it("supports the arguments of an already installed video Skill", async () => {
    const f = fixture(true, root => ["--no-sandbox", "/installed/render_frames.cjs", path.join(root, "storyboard.json"), path.join(root, "frames")]);
    await vi.waitFor(() => expect(f.app.quit).toHaveBeenCalled());
    expect(f.desktop).not.toHaveBeenCalled();
  });

  it("fails malformed rendering arguments without opening the desktop or a profile", async () => {
    const f = fixture(true, () => ["--openmind-render-video-frames"]);
    await vi.waitFor(() => expect(f.app.exit).toHaveBeenCalledWith(1));
    expect(f.desktop).not.toHaveBeenCalled();
    expect(f.app.setPath).not.toHaveBeenCalled();
    expect(f.stderr).toHaveBeenCalledWith(expect.stringContaining("Expected storyboard JSON"));
  });

  it("starts the ordinary desktop when no rendering mode is requested", () => {
    const f = fixture(true, () => ["--e2e-test"]);
    expect(f.desktop).toHaveBeenCalledOnce();
    expect(f.app.setPath).not.toHaveBeenCalled();
  });
});
