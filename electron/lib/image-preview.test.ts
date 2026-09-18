import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IMAGE_PREVIEW_MAX_BYTES } from "../../shared/image-preview";

const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "openmind-image-preview-ud-"));
vi.mock("electron", () => ({ app: { getPath: () => userDataDir } }));
import { readImagePreview } from "./image-preview";

let root: string;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "openmind-image-preview-"));
  vi.stubEnv("OPENMIND_USER_DATA_DIR", userDataDir);
  vi.stubEnv("OPENMIND_WORKSPACE_ROOT", root);
  fs.mkdirSync(path.join(root, "openmind"));
  vi.stubEnv("OPENMIND_ROOT", path.join(root, "openmind"));
});
afterEach(() => {
  vi.unstubAllEnvs();
  fs.rmSync(root, { recursive: true, force: true });
});
afterAll(() => fs.rmSync(userDataDir, { recursive: true, force: true }));

describe("readImagePreview", () => {
  it("returns exact image bytes for relative and absolute screenshot references", async () => {
    const bytes = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aB9sAAAAASUVORK5CYII=", "base64");
    fs.writeFileSync(path.join(root, "shot.PNG"), bytes);
    for (const target of ["shot.PNG", path.join(root, "shot.PNG")]) {
      await expect(readImagePreview(target)).resolves.toEqual({ path: target, name: "shot.PNG", dataUrl: `data:image/png;base64,${bytes.toString("base64")}` });
    }
  });
  it("propagates the workspace boundary rejection", async () => {
    await expect(readImagePreview("../private.png")).rejects.toThrow();
  });
  it("resolves logical content paths through the selected data root", async () => {
    fs.writeFileSync(path.join(root, "openmind", "shot.png"), Buffer.from([137, 80, 78, 71]));
    await expect(readImagePreview("openmind/shot.png")).resolves.toMatchObject({ path: "openmind/shot.png", dataUrl: "data:image/png;base64,iVBORw==" });
    await expect(readImagePreview("openmind/../../private.png")).rejects.toThrow();
  });
  it("rejects oversized images and non-image files", async () => {
    fs.writeFileSync(path.join(root, "huge.png"), "");
    fs.truncateSync(path.join(root, "huge.png"), IMAGE_PREVIEW_MAX_BYTES + 1);
    await expect(readImagePreview("huge.png")).rejects.toThrow("20 MB");
    fs.writeFileSync(path.join(root, "note.md"), "text");
    await expect(readImagePreview("note.md")).rejects.toThrow("图片格式");
  });
});
