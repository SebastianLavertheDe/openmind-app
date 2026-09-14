import { describe, expect, it, vi } from "vitest";
import type { DesktopApi } from "@shared/contracts";
import { workspaceFileSource } from "./workspace-file-source";

describe("workspaceFileSource", () => {
  it("keeps read-only sources structurally incapable of saving", async () => {
    const readContent = vi.fn(async (path: string) => ({ path, name: "note.md", content: "# Note" }));
    window.openmind = { readContent, openPath: vi.fn(async () => "") } as unknown as DesktopApi;
    const source = workspaceFileSource("openmind/note.md");

    expect(source.save).toBeUndefined();
    expect(source.capabilities.editContent).toBe(false);
    await expect(source.load()).resolves.toMatchObject({ kind: "document", record: { content: "# Note" } });
    expect(readContent).toHaveBeenCalledWith("openmind/note.md");
  });

  it("saves editable content only through the same typed path", async () => {
    const writeContent = vi.fn(async (path: string, content: string) => ({ path, name: "note.md", content }));
    window.openmind = {
      readContent: vi.fn(async (path: string) => ({ path, name: "note.md", content: "old" })),
      writeContent,
      openPath: vi.fn(async () => "")
    } as unknown as DesktopApi;
    const source = workspaceFileSource("openmind/note.md", { editable: true });

    await expect(source.save?.({ content: "new", title: "ignored" })).resolves.toMatchObject({
      kind: "document",
      record: { content: "new" }
    });
    expect(writeContent).toHaveBeenCalledWith("openmind/note.md", "new");
  });

  it("propagates a Main-process boundary rejection without trying another path", async () => {
    const readContent = vi.fn(async () => { throw new Error("Path is outside the selected openmindRoot"); });
    window.openmind = { readContent } as unknown as DesktopApi;
    const source = workspaceFileSource("../../private.txt");

    await expect(source.load()).rejects.toThrow("outside the selected openmindRoot");
    expect(readContent).toHaveBeenCalledOnce();
  });

  it("returns an unsupported resource for binary files without reading them as text", async () => {
    const readContent = vi.fn();
    const openPath = vi.fn(async () => "");
    window.openmind = { readContent, openPath } as unknown as DesktopApi;
    const source = workspaceFileSource("openmind/archive.zip", { editable: true, binary: "unsupported" });

    expect(source.capabilities.editContent).toBe(false);
    expect(source.capabilities.openExternal).toBe(true);
    expect(source.save).toBeUndefined();
    await expect(source.load()).resolves.toMatchObject({
      kind: "unsupported",
      path: "openmind/archive.zip",
      reason: "该二进制文件暂不支持应用内预览。"
    });
    expect(readContent).not.toHaveBeenCalled();
    await source.openExternal?.();
    expect(openPath).toHaveBeenCalledWith("openmind/archive.zip");
  });
});
