import { useState } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AiSnapshot, DesktopApi } from "@shared/contracts";
import { AiProvider } from "../../ai-context";
import { AiFilePreviewPane } from "./AiFilePreviewPane";
import { useFilePreview } from "./file-preview-context";
import { clearProjectPreviewSourceCacheForTests } from "./project-preview-source";

vi.mock("../creative/MarkdownEditor", () => ({
  MarkdownEditor: ({ value, onChange, ariaLabel }: { value: string; onChange(value: string): void; ariaLabel: string }) => (
    <textarea aria-label={ariaLabel} value={value} onChange={(event) => onChange(event.target.value)} />
  )
}));

const snapshot: AiSnapshot = {
  projectRoot: "/workspace",
  providers: [],
  sessions: [],
  runs: [],
  pendingApprovals: []
};

beforeEach(() => {
  clearProjectPreviewSourceCacheForTests();
  window.localStorage.clear();
});

describe("AiFilePreviewPane", () => {
  it("renders a Project .video.md reference with the shared semantic video preview", async () => {
    const material = {
      projectName: "AI 安全",
      relativePath: "materials/videos/Uny6Lpmjral.video.md",
      title: "语义视频",
      kind: "video",
      status: "ready",
      source: { type: "url", url: "https://www.youtube.com/watch?v=Uny6Lpmjral" },
      createdAt: "2026-09-14T00:00:00.000Z",
      updatedAt: "2026-09-14T00:00:00.000Z"
    };
    const readContent = vi.fn();
    const readProjectMaterial = vi.fn(async () => ({
      material,
      content: "",
      video: {
        provider: "youtube",
        sourceUrl: material.source.url,
        embedUrl: "https://www.youtube-nocookie.com/embed/Uny6Lpmjral?enablejsapi=1",
        videoId: "Uny6Lpmjral",
        title: material.title,
        transcript: [{ startMs: 7_000, endMs: 12_000, text: "来自项目字幕" }]
      }
    }));
    window.openmind = {
      aiRefresh: vi.fn(async () => snapshot),
      aiGetEvents: vi.fn(async () => []),
      aiListTurns: vi.fn(async () => ({ data: [], nextCursor: null, total: 0, parseErrors: 0 })),
      onAiEvent: vi.fn(() => () => {}),
      listProjectMaterials: vi.fn(async () => [material]),
      listProjectOutputs: vi.fn(async () => []),
      readProjectMaterial,
      readContent
    } as unknown as DesktopApi;

    render(
      <AiProvider initial={snapshot}>
        <AiFilePreviewPane surface={{ kind: "project-task", projectName: "AI 安全" }}>
          <PreviewTrigger path="Uny6Lpmjral.video.md" />
        </AiFilePreviewPane>
      </AiProvider>
    );

    fireEvent.click(screen.getByRole("button", { name: "打开引用" }));
    expect(await screen.findByTitle("语义视频")).toBeTruthy();
    expect(screen.getByText("来自项目字幕")).toBeTruthy();
    await waitFor(() => expect(readProjectMaterial).toHaveBeenCalledWith({
      projectName: "AI 安全",
      relativePath: material.relativePath
    }));
    expect(readContent).not.toHaveBeenCalled();
    expect((screen.getByRole("button", { name: "编辑文件" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("edits and saves a Workspace document through the shared controller", async () => {
    const path = "openmind/daily-summary/20260914_daily_summary.md";
    const readContent = vi.fn(async () => ({ path, name: "今日简报.md", content: "# 初始", truncated: false }));
    const writeContent = vi.fn(async (_path: string, content: string) => ({ path, name: "今日简报.md", content, truncated: false }));
    window.openmind = {
      aiRefresh: vi.fn(async () => snapshot),
      aiGetEvents: vi.fn(async () => []),
      aiListTurns: vi.fn(async () => ({ data: [], nextCursor: null, total: 0, parseErrors: 0 })),
      onAiEvent: vi.fn(() => () => {}),
      readContent,
      writeContent
    } as unknown as DesktopApi;

    render(
      <AiProvider initial={snapshot}>
        <PersistedWorkspacePreview path={path} />
      </AiProvider>
    );

    const trigger = screen.getByRole("button", { name: "打开引用" });
    trigger.focus();
    fireEvent.click(trigger);
    expect(await screen.findByRole("heading", { name: "初始" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "编辑文件" }));
    fireEvent.change(await screen.findByLabelText("编辑文件内容"), { target: { value: "# 已修改" } });
    fireEvent.click(screen.getByRole("button", { name: "保存文件" }));

    await waitFor(() => expect(writeContent).toHaveBeenCalledWith(path, "# 已修改"));
    expect(readContent).toHaveBeenCalledWith(path);

    fireEvent.click(screen.getByRole("button", { name: "关闭文件预览" }));
    await waitFor(() => expect(screen.queryByRole("complementary", { name: "文件预览" })).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });
});

function PreviewTrigger({ path }: { path: string }) {
  const open = useFilePreview();
  return <button type="button" onClick={() => open?.(path)}>打开引用</button>;
}

function PersistedWorkspacePreview({ path }: { path: string }) {
  const [restoredPath, setRestoredPath] = useState<string | null>(null);
  return (
    <AiFilePreviewPane
      surface={{ kind: "workspace" }}
      restoredPreviewPath={restoredPath}
      onPreviewPathChange={setRestoredPath}
    >
      <PreviewTrigger path={path} />
    </AiFilePreviewPane>
  );
}
