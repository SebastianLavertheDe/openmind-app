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

function fixture(packaged: boolean, argumentsFor: (root: string) => string[]) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "openmind-entry-")); roots.push(root);
  const compiledRoot = path.join(root, ".build/electron/electron");
  const resources = path.join(root, "resources");
  const app = { isPackaged: packaged, setPath: vi.fn(), exit: vi.fn() };
  const desktop = vi.fn(); const compositor = vi.fn(); const stderr = vi.fn();
  const context = vm.createContext({
    __dirname: compiledRoot, exports: {}, module: { exports: {} },
    process: { argv: ["OpenMind", ...argumentsFor(root)], resourcesPath: resources, stderr: { write: stderr } },
    require: (id: string) => {
      if (id === "electron") return { app };
      if (id === "node:path") return path;
      if (id === "./main") return desktop();
      if (id === "./images/skill-image-cli") return compositor();
      throw new Error(`Unexpected module: ${id}`);
    }
  });
  vm.runInContext(entry, context);
  return { root, app, desktop, compositor, stderr };
}

describe("Electron entry dispatch", () => {
  it.each([false, true])("dispatches image composition to the fixed app module (packaged=%s)", packaged => {
    const f = fixture(packaged, root => ["/untrusted/script.js", "--openmind-compose-image", path.join(root, "job.json"), path.join(root, "result.png")]);
    expect(f.compositor).toHaveBeenCalledOnce();
    expect(f.desktop).not.toHaveBeenCalled();
  });
  it.each([false, true])("rejects retired video rendering without loading scripts or the desktop (packaged=%s)", packaged => {
    const f = fixture(packaged, root => ["--no-sandbox", "/untrusted/render_frames.cjs", "--openmind-render-video-frames", path.join(root, "storyboard.json"), path.join(root, "frames")]);
    expect(f.app.exit).toHaveBeenCalledWith(1);
    expect(f.desktop).not.toHaveBeenCalled();
    expect(f.compositor).not.toHaveBeenCalled();
    expect(f.app.setPath).not.toHaveBeenCalled();
    expect(f.stderr).toHaveBeenCalledWith(expect.stringContaining("retired"));
    expect(fs.existsSync(path.join(f.root, "frames"))).toBe(false);
  });

  it.each([false, true])("rejects legacy video Skill arguments without opening the desktop (packaged=%s)", packaged => {
    const f = fixture(packaged, root => ["--no-sandbox", "/installed/render_frames.cjs", path.join(root, "storyboard.json"), path.join(root, "frames")]);
    expect(f.app.exit).toHaveBeenCalledWith(1);
    expect(f.desktop).not.toHaveBeenCalled();
    expect(f.app.setPath).not.toHaveBeenCalled();
    expect(f.stderr).toHaveBeenCalledWith(expect.stringContaining("retired"));
  });

  it("rejects retired rendering even with missing arguments", () => {
    const f = fixture(true, () => ["--openmind-render-video-frames"]);
    expect(f.app.exit).toHaveBeenCalledWith(1);
    expect(f.desktop).not.toHaveBeenCalled();
    expect(f.app.setPath).not.toHaveBeenCalled();
    expect(f.stderr).toHaveBeenCalledWith(expect.stringContaining("retired"));
  });

  it("starts the ordinary desktop when no rendering mode is requested", () => {
    const f = fixture(true, () => ["--e2e-test"]);
    expect(f.desktop).toHaveBeenCalledOnce();
    expect(f.app.setPath).not.toHaveBeenCalled();
  });
});
