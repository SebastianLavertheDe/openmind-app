import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  AiSnapshot,
  CreativeAnalytics,
  CreativeProjectDetail,
  CreativeProjectSummary,
  CreativeReleaseEvent,
  CreativeVersion,
  DesktopApi
} from "@shared/contracts";
import { AiProvider } from "../../ai-context";
import { FeedbackHost } from "../../components/FeedbackHost";
import { AnalyticsView, HistoryView, ReleaseLogView } from "./history-release";

const snapshot: AiSnapshot = {
  projectRoot: "/project",
  providers: [{ id: "codex-native", provider: "codex", label: "Codex", runtime: "native", available: true, version: "1", supportsApprovals: true, supportsResume: true, supportsImages: true, diagnostic: null, detectedModel: null, contextWindow: null, oneMillion: false }],
  sessions: [], runs: [], pendingApprovals: []
};

const detail: CreativeProjectDetail = { dir: "mymind/creative/proj", stage: "drafting", manifest: { topic: "AI 工作台" }, files: { "draft.md": "# draft" } };
const selectedProject: CreativeProjectSummary = { dir: "mymind/creative/proj", topic: "AI 工作台", stage: "drafting", completion: 72 };

function installApi(overrides: Partial<DesktopApi> = {}) {
  window.cctools = {
    listCreativeVersions: async () => [{ id: "v1", file: "draft.md", path: "versions/draft/v1.md", createdAt: "2026-07-07T00:00:00.000Z", note: "自动保存", size: 1024 }] as CreativeVersion[],
    readCreativeVersion: async () => ({ path: "p", content: "# v1\n\nold content" }),
    restoreCreativeVersion: async () => ({ dir: "mymind/creative/proj", stage: "drafting", manifest: { topic: "AI 工作台" }, files: { "draft.md": "# restored" } }),
    getCreativeReleaseLog: async () => [
      { id: "e1", createdAt: "2026-07-07T00:00:00.000Z", action: "content_exported", stage: "ready", status: "exported", detail: "导出 Markdown" }
    ] as CreativeReleaseEvent[],
    openPath: vi.fn(async (p: string) => p),
    aiRefresh: async () => snapshot,
    aiGetEvents: async () => [],
    aiCancelRun: async () => true,
    aiResolveApproval: async () => true,
    runSkill: vi.fn(async () => true),
    selectFiles: async () => [],
    selectMymindFiles: async () => [],
    searchMymindFiles: async () => ({ items: [], indexedCount: 0, truncated: false }),
    revealPath: async () => true,
    onAiEvent: () => () => {},
    ...overrides
  } as unknown as DesktopApi;
}

beforeEach(() => {
  installApi();
});

afterEach(() => {
  window.localStorage.clear();
});

describe("HistoryView", () => {
  it("renders an empty state when no project is selected", () => {
    render(<AiProvider initial={snapshot}><HistoryView detail={null} selectedProject={null} activeFile="" versions={[]} files={[]} chooseFile={vi.fn()} onVersionsChange={vi.fn()} onRestored={vi.fn()} /></AiProvider>);
    expect(screen.getByText(/选择|项目/)).toBeTruthy();
  });

  it("lists files as tabs and loads versions when a file is active", async () => {
    const onVersionsChange = vi.fn();
    render(<AiProvider initial={snapshot}><HistoryView detail={detail} selectedProject={selectedProject} activeFile="draft.md" versions={[]} files={["draft.md", "topic-brief.md"]} chooseFile={vi.fn()} onVersionsChange={onVersionsChange} onRestored={vi.fn()} /></AiProvider>);
    // file tabs
    expect(screen.getByText("draft.md")).toBeTruthy();
    expect(screen.getByText("topic-brief.md")).toBeTruthy();
    // versions loaded via cctools.listCreativeVersions
    await waitFor(() => expect(onVersionsChange).toHaveBeenCalled());
  });

  it("renders the version comparison diff when two versions are selected", async () => {
    const user = userEvent.setup();
    const versions: CreativeVersion[] = [{ id: "v1", file: "draft.md", path: "p1", createdAt: "2026-07-07T00:00:00.000Z", note: "v1", size: 100 }];
    const { rerender } = render(<AiProvider initial={snapshot}><HistoryView detail={detail} selectedProject={selectedProject} activeFile="draft.md" versions={versions} files={["draft.md"]} chooseFile={vi.fn()} onVersionsChange={vi.fn()} onRestored={vi.fn()} /></AiProvider>);
    const selects = screen.getAllByRole("combobox");
    // pick the same version in both A and B to load content (A=current, B=v1 → diff)
    await user.selectOptions(selects[1], "v1");
    // diff pre renders some lines
    await waitFor(() => {
      const pre = document.querySelector(".history-diff");
      expect(pre?.textContent?.length ?? 0).toBeGreaterThan(0);
    });
  });

  it("restore asks for confirmation and calls restoreCreativeVersion on confirm", async () => {
    const user = userEvent.setup();
    const onRestored = vi.fn();
    const versions: CreativeVersion[] = [{ id: "v1", file: "draft.md", path: "p1", createdAt: "2026-07-07T00:00:00.000Z", note: "v1", size: 100 }];
    render(<AiProvider initial={snapshot}><HistoryView detail={detail} selectedProject={selectedProject} activeFile="draft.md" versions={versions} files={["draft.md"]} chooseFile={vi.fn()} onVersionsChange={vi.fn()} onRestored={onRestored} /><FeedbackHost /></AiProvider>);
    const restoreBtn = screen.getByRole("button", { name: /恢复为新版本/ });
    await user.click(restoreBtn);
    // confirmation dialog: restoreConfirm = "恢复"
    const confirmBtn = await screen.findByRole("button", { name: /^恢复$/ });
    await user.click(confirmBtn);
    await waitFor(() => expect(onRestored).toHaveBeenCalled());
  });
});

describe("ReleaseLogView", () => {
  it("renders an empty state when no project is selected", () => {
    render(<AiProvider initial={snapshot}><ReleaseLogView detail={null} selectedProject={null} /></AiProvider>);
    expect(screen.getByText(/选择一篇稿件/)).toBeTruthy();
  });

  it("loads and renders the release timeline, then filters down to empty", async () => {
    const user = userEvent.setup();
    render(<AiProvider initial={snapshot}><ReleaseLogView detail={detail} selectedProject={selectedProject} /></AiProvider>);
    // wait for the timeline to load
    await screen.findByRole("list");
    const filter = screen.getByRole("textbox");
    await user.type(filter, "zzznomatch");
    // filter excludes the event → empty timeline item
    await waitFor(() => expect(screen.getByText(/还没有发布或阶段记录/)).toBeTruthy());
  });
});

describe("AnalyticsView", () => {
  it("renders a loading state while loading with no analytics", () => {
    render(<AnalyticsView analytics={null} loading={true} />);
    expect(document.querySelector("[class*='loading']")).toBeTruthy();
  });

  it("renders an empty state when analytics is null and not loading", () => {
    render(<AnalyticsView analytics={null} loading={false} />);
    expect(screen.getByText(/暂无|no data|无数据/i)).toBeTruthy();
  });

  it("renders metrics, stage distribution, and platform distribution bars", () => {
    const analytics: CreativeAnalytics = {
      total: 5,
      stages: [{ stage: "drafting", count: 3 }, { stage: "published", count: 2 }],
      platforms: [{ platform: "wechat", count: 4 }, { platform: "xiaohongshu", count: 1 }],
      averageCompletion: 72,
      averageCycleHours: 12,
      stageDurations: [{ stage: "drafting", averageHours: 4 }]
    } as CreativeAnalytics;
    render(<AnalyticsView analytics={analytics} loading={false} />);
    expect(screen.getByText("5")).toBeTruthy();
    // bar widths are derived from counts
    const bars = document.querySelectorAll(".analytics-grid i");
    expect(bars.length).toBeGreaterThan(0);
  });
});
