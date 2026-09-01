import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AiSnapshot, DesktopApi } from "@shared/contracts";
import { AiProvider } from "../../ai-context";
import { FeedbackHost } from "../../components/FeedbackHost";
import { ProjectsPage } from "./ProjectsPage";
import type { ProjectDetail, ProjectSummary } from "./types";

const summary: ProjectSummary = {
  name: "AI 安全",
  description: "研究与写作",
  status: "active",
  materialCount: 1,
  taskCount: 1,
  outputCount: 1,
  createdAt: "2026-08-30T00:00:00.000Z",
  updatedAt: "2026-08-31T00:00:00.000Z"
};

const detail: ProjectDetail = { ...summary };

const snapshot: AiSnapshot = {
  projectRoot: "/project",
  providers: [],
  sessions: [],
  runs: [],
  pendingApprovals: []
};

function installApi(overrides: Record<string, unknown> = {}): void {
  window.openmind = {
    aiRefresh: vi.fn(async () => snapshot),
    aiGetEvents: vi.fn(async () => []),
    onAiEvent: vi.fn(() => () => {}),
    onSkillEvent: vi.fn(() => () => {}),
    listProjects: vi.fn(async () => [summary]),
    getProject: vi.fn(async () => detail),
    createProject: vi.fn(async () => detail),
    renameProject: vi.fn(async () => detail),
    archiveProject: vi.fn(async () => detail),
    listProjectTasks: vi.fn(async () => []),
    listProjectMaterials: vi.fn(async () => []),
    listProjectOutputs: vi.fn(async () => []),
    ...overrides
  } as unknown as DesktopApi;
}

function renderPage() {
  return render(<AiProvider initial={snapshot}><ProjectsPage /><FeedbackHost /></AiProvider>);
}

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("ProjectsPage", () => {
  it("keeps the project list inside the page and opens a project from it", async () => {
    installApi();
    renderPage();

    const search = await screen.findByLabelText("搜索项目");
    expect(search).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /AI 安全/ }));

    await waitFor(() => expect(window.openmind.getProject).toHaveBeenCalledWith("AI 安全"));
    expect(await screen.findByText("AI 安全")).toBeTruthy();
    const tabs = await screen.findAllByRole("tab", { name: /任务/ });
    expect(tabs.length).toBeGreaterThanOrEqual(1);
    expect(screen.getByLabelText("搜索任务")).toBeTruthy();
    expect(await screen.findByText("选择或新建任务")).toBeTruthy();
  });

  it("filters the pane list through the project search", async () => {
    const other: ProjectSummary = { ...summary, name: "每日简报实验", description: "", updatedAt: "2026-08-30T00:00:00.000Z" };
    installApi({ listProjects: vi.fn(async () => [summary, other]) });
    renderPage();

    fireEvent.change(await screen.findByLabelText("搜索项目"), { target: { value: "安全" } });

    await waitFor(() => expect(screen.queryByRole("button", { name: /每日简报实验/ })).toBeNull());
    expect(screen.getByRole("button", { name: /AI 安全/ })).toBeTruthy();
  });

  it("uses the full-height workspace and keeps creation in the empty state", async () => {
    installApi();
    const { container } = renderPage();

    expect(await screen.findByText("选择一个项目")).toBeTruthy();
    expect(container.querySelector(".projects-page-header")).toBeNull();
    expect(screen.queryByText("资料驱动创作")).toBeNull();
    const createButton = screen.getByRole("button", { name: "创建项目" });

    fireEvent.click(createButton);
    expect(await screen.findByText("项目名称")).toBeTruthy();
  });

  it("switches content sections in place from the pane tabs", async () => {
    installApi();
    renderPage();

    fireEvent.click(await screen.findByRole("button", { name: /AI 安全/ }));
    const materialsTab = await screen.findByRole("tab", { name: "资料 1" });
    fireEvent.click(materialsTab);

    await waitFor(() => expect(window.openmind.listProjectMaterials).toHaveBeenCalledWith("AI 安全"));
    expect(materialsTab.getAttribute("aria-selected")).toBe("true");
    expect(screen.getByLabelText("搜索资料")).toBeTruthy();
  });

  it("groups archived projects under a muted section of the pane list", async () => {
    const archived: ProjectSummary = { ...summary, name: "旧选题库", status: "archived" as const };
    installApi({ listProjects: vi.fn(async () => [summary, archived]) });
    renderPage();

    expect(await screen.findByText("已归档")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /旧选题库/ }));
    await waitFor(() => expect(window.openmind.getProject).toHaveBeenCalledWith("旧选题库"));
  });
});
