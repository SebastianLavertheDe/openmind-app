import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { prepareWindowPreload } from "./window-preload";

const fixtures: string[] = [];
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "openmind-window-preload-test-"));
  fixtures.push(root);
  const build = path.join(root, ".build");
  fs.mkdirSync(build);
  const source = path.join(build, "preload.js");
  fs.writeFileSync(source, "original bundled preload");
  return { build, source, snapshots: path.join(root, "user-data", "tmp", "preloads") };
}
afterEach(() => {
  for (const root of fixtures.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("window preload", () => {
  it("keeps the loaded bridge available during build cleanup and replacement", () => {
    const { build, source, snapshots } = fixture();
    const preload = prepareWindowPreload(source, snapshots);
    fs.rmSync(build, { recursive: true });
    expect(fs.readFileSync(preload.path, "utf8")).toBe("original bundled preload");
    fs.mkdirSync(build);
    fs.writeFileSync(source, "partially compiled replacement");
    expect(fs.readFileSync(preload.path, "utf8")).toBe("original bundled preload");
    const nextWindow = prepareWindowPreload(source, snapshots);
    expect(fs.readFileSync(nextWindow.path, "utf8")).toBe("partially compiled replacement");
    preload.dispose();
    expect(fs.existsSync(preload.path)).toBe(false);
    expect(fs.existsSync(nextWindow.path)).toBe(true);
    expect(fs.existsSync(source)).toBe(true);
    nextWindow.dispose();
    expect(fs.readdirSync(snapshots)).toEqual([]);
  });

  it("uses the original packaged preload without creating a snapshot", () => {
    const { source } = fixture();
    const preload = prepareWindowPreload(source);
    expect(preload.path).toBe(source);
    preload.dispose();
    expect(fs.existsSync(source)).toBe(true);
  });

  it("removes an incomplete snapshot if the startup preload is missing", () => {
    const { source, snapshots } = fixture();
    fs.unlinkSync(source);
    expect(() => prepareWindowPreload(source, snapshots)).toThrow();
    expect(fs.readdirSync(snapshots)).toEqual([]);
  });
});
