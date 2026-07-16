import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AiSnapshot, CreativeProjectDetail, CreativeTopic, DesktopApi } from "@shared/contracts";
import { AiProvider } from "../../ai-context";
import { ReviewPanel, TopicWorkspace } from "./panels";

const snapshot: AiSnapshot = { projectRoot: "/r", providers: [], sessions: [], runs: [], pendingApprovals: [] };

function installApi(overrides: Partial<DesktopApi> = {}) {
  window.cctools = {
    reviewCreativeProject: vi.fn(async () => ({ dir: "d", manifest: { topic: "t" }, files: {} } as CreativeProjectDetail)),
    setCreativeReviewStatus: vi.fn(async () => ({ dir: "d", manifest: { topic: "t" }, files: {} } as CreativeProjectDetail)),
    aiRefresh: async () => snapshot,
    aiGetEvents: async () => [],
    aiCancelRun: async () => true,
    aiResolveApproval: async () => true,
    runSkill: vi.fn(async () => true),
    selectFiles: async () => [],
    selectMymindFiles: async () => [],
    searchMymindFiles: async () => ({ items: [], indexedCount: 0, truncated: false }),
    openPath: vi.fn(async (p: string) => p),
    revealPath: async () => true,
    onAiEvent: () => () => {},
    ...overrides
  } as unknown as DesktopApi;
}

beforeEach(() => installApi());
afterEach(() => window.localStorage.clear());

const topic: CreativeTopic = {
  id: "t1", title: "AI 工作台设计", platform: "公众号", section: "today_pick", score: 9,
  body: "# 推荐理由\n\n这是一个好选题。", starred: false, ignored: false, projectDir: null
} as CreativeTopic;

const detail: CreativeProjectDetail = {
  dir: "mymind/creative/proj", stage: "review", manifest: { topic: "AI 工作台" }, files: { "draft.md": "# d" }
} as CreativeProjectDetail;

describe("TopicWorkspace", () => {
  it("renders the topic title, score, and body markdown", () => {
    render(<AiProvider initial={snapshot}><TopicWorkspace topic={topic} date="20260616" createProject={vi.fn()} addContext={vi.fn()} /></AiProvider>);
    expect(screen.getByText("AI 工作台设计")).toBeTruthy();
    expect(screen.getAllByText(/推荐理由/).length).toBeGreaterThan(0);
  });

  it("reveals the platform picker and calls createProject on selection", async () => {
    const user = userEvent.setup();
    const createProject = vi.fn();
    render(<AiProvider initial={snapshot}><TopicWorkspace topic={topic} date="20260616" createProject={createProject} addContext={vi.fn()} /></AiProvider>);
    await user.click(screen.getByRole("button", { name: /起草|创建草稿/i }));
    // platform grid now visible — pick the generic draft
    await user.click(screen.getByRole("button", { name: /通用草稿|generic/i }));
    expect(createProject).toHaveBeenCalled();
  });

  it("shows an existing-draft notice when topic.projectDir is set", () => {
    render(<AiProvider initial={snapshot}><TopicWorkspace topic={{ ...topic, projectDir: "mymind/creative/x" }} date="20260616" createProject={vi.fn()} addContext={vi.fn()} /></AiProvider>);
    expect(screen.getByText(/已有草稿|has draft/i)).toBeTruthy();
  });
});

describe("ReviewPanel", () => {
  it("renders the live quality checks and a run-review button", () => {
    render(<AiProvider initial={snapshot}><ReviewPanel content="# title\n\nshort" detail={detail} onReviewed={vi.fn()} onStatusChange={vi.fn()} onLocate={vi.fn()} /></AiProvider>);
    // score + checks present
    expect(document.querySelector(".inline-review-panel")).toBeTruthy();
    expect(screen.getByRole("button", { name: /运行|生成|重审|run/i })).toBeTruthy();
  });

  it("runs review on click and notifies onReviewed", async () => {
    const user = userEvent.setup();
    const reviewCreativeProject = vi.fn(async (): Promise<CreativeProjectDetail> => ({ ...detail, reviewReport: { score: 88, status: "pending", dimensions: { structure: 90, accuracy: 85, readability: 88, platform: 86, seo: 87 }, issues: [], createdAt: "2026-06-16T00:00:00.000Z", updatedAt: "2026-06-16T00:00:00.000Z" } }));
    installApi({ reviewCreativeProject });
    const onReviewed = vi.fn();
    render(<AiProvider initial={snapshot}><ReviewPanel content={`# t\n\n${"x".repeat(900)}`} detail={detail} onReviewed={onReviewed} onStatusChange={vi.fn()} onLocate={vi.fn()} /></AiProvider>);
    await user.click(screen.getByRole("button", { name: /运行|生成|重审|run/i }));
    await waitFor(() => expect(reviewCreativeProject).toHaveBeenCalledWith("mymind/creative/proj"));
    await waitFor(() => expect(onReviewed).toHaveBeenCalled());
  });

  it("renders a saved report with dimensions and issues", () => {
    const withReport: CreativeProjectDetail = {
      ...detail,
      reviewReport: { score: 90, status: "approved", dimensions: { structure: 95, accuracy: 90, readability: 92, platform: 88, seo: 89 }, issues: [{ id: "i1", dimension: "structure", severity: "warning", title: "T", detail: "D", line: 5 }], createdAt: "2026-06-16T00:00:00.000Z", updatedAt: "2026-06-16T00:00:00.000Z" }
    };
    render(<AiProvider initial={snapshot}><ReviewPanel content="# t" detail={withReport} onReviewed={vi.fn()} onStatusChange={vi.fn()} onLocate={vi.fn()} /></AiProvider>);
    expect(screen.getAllByText("90").length).toBeGreaterThan(0);
    expect(screen.getByText("T")).toBeTruthy();
  });
});
