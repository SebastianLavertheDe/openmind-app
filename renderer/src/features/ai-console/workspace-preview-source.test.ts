import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DesktopApi } from "@shared/contracts";
import { workspacePreviewSource } from "./workspace-preview-source";
import {
  clearProjectPreviewSourceCacheForTests,
  projectConversationPreviewSource,
  resolveProjectPreviewSource
} from "./project-preview-source";

beforeEach(() => {
  clearProjectPreviewSourceCacheForTests();
});

describe("workspacePreviewSource", () => {
  it("keeps raw binary video explicit and never sends it through text IPC", async () => {
    const readContent = vi.fn();
    window.openmind = { readContent } as unknown as DesktopApi;
    const source = workspacePreviewSource("clips/demo.mp4");

    await expect(source.load()).resolves.toMatchObject({
      kind: "unsupported",
      reason: "本地二进制视频暂不支持应用内预览。"
    });
    expect(source.save).toBeUndefined();
    expect(readContent).not.toHaveBeenCalled();
  });
});

describe("resolveProjectPreviewSource", () => {
  it("uses Project Material semantics for a .video.md reference", async () => {
    const material = videoMaterial();
    const readContent = vi.fn();
    const readProjectMaterial = vi.fn(async () => ({
      material,
      content: "# 视频\n\n[00:07 - 00:12] 第一段",
      video: {
        provider: "youtube",
        sourceUrl: material.source.url,
        embedUrl: "https://www.youtube-nocookie.com/embed/Uny6Lpmjral?enablejsapi=1",
        videoId: "Uny6Lpmjral",
        title: material.title,
        transcript: [{ startMs: 7_000, endMs: 12_000, text: "第一段" }]
      }
    }));
    window.openmind = {
      listProjectMaterials: vi.fn(async () => [material]),
      listProjectOutputs: vi.fn(async () => []),
      readProjectMaterial,
      readContent
    } as unknown as DesktopApi;

    const resolved = await resolveProjectPreviewSource("Uny6Lpmjral.video.md", "AI 安全");
    expect(resolved?.source.save).toBeUndefined();
    await expect(resolved?.source.load()).resolves.toMatchObject({
      kind: "video",
      playback: { kind: "trusted-youtube", videoId: "Uny6Lpmjral" },
      transcript: [{ startMs: 7_000, text: "第一段" }]
    });
    expect(readProjectMaterial).toHaveBeenCalledWith({
      projectName: "AI 安全",
      relativePath: material.relativePath
    });
    expect(readContent).not.toHaveBeenCalled();
  });

  it("loads a registered PDF original through its owning material record", async () => {
    const material = {
      projectName: "PDF 项目",
      relativePath: "materials/documents/report.md",
      title: "Report",
      kind: "document",
      status: "ready",
      source: { type: "file", originalName: "report.pdf" },
      originalRelativePath: "materials/originals/report.pdf",
      createdAt: "2026-09-14T00:00:00.000Z",
      updatedAt: "2026-09-14T00:00:00.000Z"
    };
    const readProjectMaterialOriginal = vi.fn(async () => ({
      fileName: "report.pdf",
      mimeType: "application/pdf",
      byteSize: 4,
      data: new Uint8Array([0x25, 0x50, 0x44, 0x46])
    }));
    window.openmind = {
      listProjectMaterials: vi.fn(async () => [material]),
      listProjectOutputs: vi.fn(async () => []),
      readProjectMaterial: vi.fn(async () => ({ material, content: "# Report" })),
      readProjectMaterialOriginal
    } as unknown as DesktopApi;

    const resolved = await resolveProjectPreviewSource("materials/originals/report.pdf", "PDF 项目");
    await expect(resolved?.source.load()).resolves.toMatchObject({ kind: "pdf", title: "Report" });
    expect(readProjectMaterialOriginal).toHaveBeenCalledWith({
      projectName: "PDF 项目",
      relativePath: material.relativePath
    });
  });

  it("resolves companion basename links to the extracted document and PDF original", async () => {
    const material = {
      projectName: "PDF 项目",
      relativePath: "materials/documents/Agentic Design Patterns.md",
      title: "Agentic Design Patterns",
      kind: "document",
      status: "ready",
      source: { type: "file", originalName: "Agentic Design Patterns.pdf" },
      originalRelativePath: "materials/originals/Agentic Design Patterns.pdf",
      createdAt: "2026-09-14T00:00:00.000Z",
      updatedAt: "2026-09-14T00:00:00.000Z"
    };
    const readContent = vi.fn();
    const readProjectMaterial = vi.fn(async () => ({ material, content: "# 提取文本" }));
    const readProjectMaterialOriginal = vi.fn(async () => ({
      fileName: "Agentic Design Patterns.pdf",
      mimeType: "application/pdf",
      byteSize: 4,
      data: new Uint8Array([0x25, 0x50, 0x44, 0x46])
    }));
    window.openmind = {
      listProjectMaterials: vi.fn(async () => [material]),
      listProjectOutputs: vi.fn(async () => []),
      readProjectMaterial,
      readProjectMaterialOriginal,
      readContent
    } as unknown as DesktopApi;

    await expect(projectConversationPreviewSource("Agentic Design Patterns.md", "PDF 项目").load())
      .resolves.toMatchObject({ kind: "document", record: { content: "# 提取文本" } });
    await expect(projectConversationPreviewSource("Agentic Design Patterns.pdf", "PDF 项目").load())
      .resolves.toMatchObject({ kind: "pdf", title: "Agentic Design Patterns" });

    expect(readProjectMaterial).toHaveBeenCalledWith({
      projectName: "PDF 项目",
      relativePath: material.relativePath
    });
    expect(readProjectMaterialOriginal).toHaveBeenCalledWith({
      projectName: "PDF 项目",
      relativePath: material.relativePath
    });
    expect(readContent).not.toHaveBeenCalled();
  });

  it("uses a read-only Project Output source", async () => {
    const output = {
      projectName: "输出项目",
      relativePath: "outputs/report.md",
      title: "报告",
      createdAt: "2026-09-14T00:00:00.000Z",
      updatedAt: "2026-09-14T00:00:00.000Z"
    };
    const saveProjectOutput = vi.fn();
    window.openmind = {
      listProjectMaterials: vi.fn(async () => []),
      listProjectOutputs: vi.fn(async () => [output]),
      readProjectOutput: vi.fn(async () => ({ output, content: "# 报告" })),
      saveProjectOutput
    } as unknown as DesktopApi;

    const resolved = await resolveProjectPreviewSource("report.md", "输出项目");
    expect(resolved?.source.capabilities.editContent).toBe(false);
    expect(resolved?.source.save).toBeUndefined();
    await expect(resolved?.source.load()).resolves.toMatchObject({ kind: "document", record: { content: "# 报告" } });
    expect(saveProjectOutput).not.toHaveBeenCalled();
  });

  it("rejects logical paths owned by a different Project", async () => {
    const listProjectMaterials = vi.fn();
    window.openmind = { listProjectMaterials } as unknown as DesktopApi;

    await expect(resolveProjectPreviewSource("openmind/projects/别的项目/outputs/a.md", "当前项目")).resolves.toBeNull();
    expect(listProjectMaterials).not.toHaveBeenCalled();
  });

  it.each([
    "openmind/daily-summary/20260914_daily_summary.md",
    "C:/work/openmind/projects/当前项目/outputs/a.md",
    "//server/openmind/projects/当前项目/outputs/a.md"
  ])("rejects paths whose ownership cannot be proven by the current Project: %s", async (path) => {
    const listProjectMaterials = vi.fn();
    const readContent = vi.fn();
    window.openmind = { listProjectMaterials, readContent } as unknown as DesktopApi;

    await expect(resolveProjectPreviewSource(path, "当前项目")).resolves.toBeNull();
    expect(listProjectMaterials).not.toHaveBeenCalled();
    expect(readContent).not.toHaveBeenCalled();
  });

  it.each([
    "../别的项目/outputs/a.md",
    "%2e%2e/别的项目/outputs/a.md",
    "openmind/projects/当前项目/../../别的项目/a.md"
  ])("rejects Project traversal before calling any IPC: %s", async (path) => {
    const listProjectMaterials = vi.fn();
    window.openmind = { listProjectMaterials } as unknown as DesktopApi;

    await expect(resolveProjectPreviewSource(path, "当前项目")).resolves.toBeNull();
    expect(listProjectMaterials).not.toHaveBeenCalled();
  });
});

function videoMaterial() {
  return {
    projectName: "AI 安全",
    relativePath: "materials/videos/Uny6Lpmjral.video.md",
    title: "YouTube 视频",
    kind: "video",
    status: "ready",
    source: { type: "url", url: "https://www.youtube.com/watch?v=Uny6Lpmjral" },
    createdAt: "2026-09-14T00:00:00.000Z",
    updatedAt: "2026-09-14T00:00:00.000Z"
  };
}
