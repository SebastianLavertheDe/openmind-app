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
const existingMaterial = {
  projectName: summary.name,
  relativePath: "materials/research.md",
  title: "研究资料",
  kind: "document",
  status: "ready",
  source: { type: "file" },
  createdAt: "2026-08-30T00:00:00.000Z",
  updatedAt: "2026-08-31T00:00:00.000Z"
};
const existingDocument = {
  projectName: summary.name,
  relativePath: "outputs/report.md",
  title: "研究文档",
  sourceTaskId: null,
  sourceSessionId: null,
  sourceMessageId: null,
  createdAt: "2026-08-30T00:00:00.000Z",
  updatedAt: "2026-08-30T12:00:00.000Z"
};

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

    const search = await screen.findByLabelText("搜索项目");
    expect(search.getAttribute("placeholder")).toBe("你的项目");
    expect(search.nextElementSibling?.tagName.toLocaleLowerCase()).toBe("svg");
    fireEvent.change(search, { target: { value: "安全" } });

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

  it("shows materials and editable documents in one flat file list", async () => {
    installApi({
      listProjectMaterials: vi.fn(async () => [existingMaterial]),
      readProjectMaterial: vi.fn(async () => ({ material: existingMaterial, content: "# 研究资料", truncated: false })),
      listProjectOutputs: vi.fn(async () => [existingDocument]),
      readProjectOutput: vi.fn(async () => ({ output: existingDocument, content: "# 研究文档" }))
    });
    renderPage();

    fireEvent.click(await screen.findByRole("button", { name: /AI 安全/ }));
    const filesTab = await screen.findByRole("tab", { name: "文件" });
    fireEvent.click(filesTab);

    await waitFor(() => {
      expect(window.openmind.listProjectMaterials).toHaveBeenCalledWith("AI 安全");
      expect(window.openmind.listProjectOutputs).toHaveBeenCalledWith("AI 安全");
    });
    expect(filesTab.getAttribute("aria-selected")).toBe("true");
    expect(screen.getByLabelText("搜索文件").getAttribute("placeholder")).toBe("你的文件");
    expect(await screen.findByRole("button", { name: "研究资料" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "研究文档" })).toBeTruthy();
    expect(screen.queryByRole("tab", { name: "资料" })).toBeNull();
    expect(screen.queryByRole("tab", { name: "成品" })).toBeNull();
    expect(screen.queryByRole("tablist", { name: "资料类型" })).toBeNull();
  });

  it("offers task, document, and material actions from the project plus menu", async () => {
    installApi({
      listProjectMaterials: vi.fn(async () => [existingMaterial]),
      readProjectMaterial: vi.fn(async () => ({ material: existingMaterial, content: "# 研究资料", truncated: false })),
      listProjectOutputs: vi.fn(async () => [existingDocument]),
      readProjectOutput: vi.fn(async () => ({ output: existingDocument, content: "# 研究文档" }))
    });
    renderPage();

    fireEvent.click(await screen.findByRole("button", { name: /AI 安全/ }));
    fireEvent.click(await screen.findByLabelText("新建项目内容"));

    expect(screen.getByRole("menuitem", { name: "新建任务" })).toBeTruthy();
    const newDocument = screen.getByRole("menuitem", { name: "新建文档" });
    expect(newDocument).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: "添加资料" })).toBeTruthy();

    fireEvent.click(newDocument);
    expect(await screen.findByRole("dialog", { name: "新建文档" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "文件" }).getAttribute("aria-selected")).toBe("true");

    fireEvent.click(screen.getByRole("button", { name: "关闭" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "新建文档" })).toBeNull());
    fireEvent.click(screen.getByLabelText("新建项目内容"));
    fireEvent.click(screen.getByRole("menuitem", { name: "添加资料" }));
    expect(await screen.findByRole("dialog", { name: "添加资料" })).toBeTruthy();
  });

  it("shows active and archived projects in one flat list without status headings", async () => {
    const archived: ProjectSummary = { ...summary, name: "旧选题库", status: "archived" as const };
    installApi({ listProjects: vi.fn(async () => [summary, archived]) });
    const { container } = renderPage();

    const archivedProject = await screen.findByRole("button", { name: /旧选题库/ });
    expect(screen.queryByText("进行中")).toBeNull();
    expect(screen.queryByText("已归档")).toBeNull();
    expect(container.querySelector(".project-list-section")).toBeNull();
    fireEvent.click(archivedProject);
    await waitFor(() => expect(window.openmind.getProject).toHaveBeenCalledWith("旧选题库"));
  });
});
