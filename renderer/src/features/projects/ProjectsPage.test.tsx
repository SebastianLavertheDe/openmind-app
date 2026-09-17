import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AiSession, AiSnapshot, DesktopApi } from "@shared/contracts";
import { AiProvider } from "../../ai-context";
import { FeedbackHost } from "../../components/FeedbackHost";
import { ResponsiveLayoutProvider } from "../../app/responsive-layout";
import { ProjectsPage } from "./ProjectsPage";
import type { ProjectDetail, ProjectSummary } from "./types";

const summary: ProjectSummary = {
  id: "5a111111-1111-4111-8111-111111111111",
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
    updateProject: vi.fn(async () => detail),
    archiveProject: vi.fn(async () => detail),
    listProjectTasks: vi.fn(async () => []),
    listProjectMaterials: vi.fn(async () => []),
    listProjectOutputs: vi.fn(async () => []),
    ...overrides
  } as unknown as DesktopApi;
}

function renderPage(initial: AiSnapshot = snapshot) {
  return render(<AiProvider initial={initial}><ProjectsPage /><FeedbackHost /></AiProvider>);
}

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  document.documentElement.style.removeProperty("--dur-exit");
  vi.useRealTimers();
});

describe("ProjectsPage", () => {
  it("retains the last archived row and group for CSS exit, then removes both", async () => {
    document.documentElement.style.setProperty("--dur-exit", "160ms");
    let finish!: (project: ProjectDetail) => void;
    installApi({ listProjects: vi.fn(async () => [{ ...summary, favorite: true }]), archiveProject: vi.fn(() => new Promise(resolve => { finish = resolve; })) });
    renderPage();
    const trigger = await screen.findByRole("button", { name: "项目操作：AI 安全" });
    trigger.focus();
    fireEvent.click(trigger);
    const archive = within(await screen.findByRole("menu")).getByRole("menuitem", { name: "归档" });
    // Own both exit timers before closing the menu, without freezing Motion's clock.
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    fireEvent.click(archive);
    await act(async () => finish({ ...detail, status: "archived" }));
    const leaving = document.querySelector('.project-list-row[data-leaving="true"]');
    expect(leaving).toBeTruthy();
    expect(leaving?.hasAttribute("inert")).toBe(true);
    expect(leaving?.getAttribute("aria-hidden")).toBe("true");
    // Portals do not inherit inert from the retained project row.
    expect(document.querySelector('.project-project-menu')?.hasAttribute("inert")).toBe(true);
    expect(screen.getByRole("region", { name: "收藏" })).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByLabelText("搜索项目"));
    act(() => vi.advanceTimersByTime(139));
    expect(document.querySelector('.project-project-menu')?.hasAttribute("inert")).toBe(true);
    act(() => vi.advanceTimersByTime(1));
    expect(document.querySelector('.project-project-menu')).toBeNull();
    act(() => vi.advanceTimersByTime(19));
    expect(leaving?.isConnected).toBe(true);
    act(() => vi.advanceTimersByTime(1));
    expect(document.querySelector(".project-list-row")).toBeNull();
    expect(screen.queryByRole("region", { name: "收藏" })).toBeNull();
    expect(screen.getByText("还没有项目")).toBeTruthy();
  });

  it("does not retain an archived row with reduced motion", async () => {
    document.documentElement.style.setProperty("--dur-exit", "160ms");
    vi.spyOn(window, "matchMedia").mockReturnValue({ matches: true } as MediaQueryList);
    installApi({ archiveProject: vi.fn(async () => ({ ...detail, status: "archived" })) });
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "项目操作：AI 安全" }));
    fireEvent.click(within(await screen.findByRole("menu")).getByRole("menuitem", { name: "归档" }));
    await waitFor(() => expect(screen.getByText("还没有项目")).toBeTruthy());
    expect(document.querySelector("[data-leaving] .project-list-row, .project-list-row[data-leaving]")).toBeNull();
  });

  it("keeps the project list inside the page and opens a project from it", async () => {
    installApi();
    renderPage();

    const search = await screen.findByLabelText("搜索项目");
    expect(search).toBeTruthy();
    const projectButton = screen.getByRole("button", { name: "AI 安全" });
    expect(projectButton.querySelectorAll("svg")).toHaveLength(1);
    fireEvent.click(projectButton);

    await waitFor(() => expect(window.openmind.getProject).toHaveBeenCalledWith("AI 安全"));
    // 项目名会同时出现在详情标题和侧栏 composer 的归属徽标中
    expect((await screen.findAllByText("AI 安全")).length).toBeGreaterThanOrEqual(1);
    const tabs = await screen.findAllByRole("tab", { name: /任务/ });
    expect(tabs.length).toBeGreaterThanOrEqual(1);
    expect(screen.getByLabelText("搜索任务")).toBeTruthy();
    expect(document.querySelector(".project-task-session.is-draft")).toBeTruthy();
  });

  it("marks the target project pending immediately while its detail is loading", async () => {
    let resolveProject!: (value: ProjectDetail) => void;
    const pending = new Promise<ProjectDetail>((resolve) => { resolveProject = resolve; });
    const getProject = vi.fn(() => pending);
    installApi({ getProject });
    renderPage();

    const projectButton = await screen.findByRole("button", { name: "AI 安全" });
    fireEvent.click(projectButton);

    expect(projectButton.getAttribute("aria-busy")).toBe("true");
    expect((projectButton as HTMLButtonElement).disabled).toBe(true);
    expect(projectButton.closest(".project-list-row")?.classList.contains("pending")).toBe(true);
    expect(screen.getByRole("status").textContent).toContain("正在打开“AI 安全”");
    fireEvent.click(projectButton);
    expect(getProject).toHaveBeenCalledTimes(1);

    await act(async () => resolveProject(detail));
    expect(await screen.findByLabelText("搜索任务")).toBeTruthy();
  });

  it("supports arrow-key navigation across the project content tabs", async () => {
    installApi();
    renderPage();

    fireEvent.click(await screen.findByRole("button", { name: "AI 安全" }));
    const tasksTab = await screen.findByRole("tab", { name: "任务" });
    tasksTab.focus();
    fireEvent.keyDown(tasksTab, { key: "ArrowRight" });

    const filesTab = await screen.findByRole("tab", { name: "文件" });
    await waitFor(() => expect(filesTab.getAttribute("aria-selected")).toBe("true"));
    await waitFor(() => expect(document.activeElement).toBe(filesTab));
    expect(tasksTab.tabIndex).toBe(-1);
    expect(filesTab.tabIndex).toBe(0);

    fireEvent.keyDown(filesTab, { key: "ArrowRight" });
    const outputsTab = await screen.findByRole("tab", { name: "产物" });
    await waitFor(() => expect(outputsTab.getAttribute("aria-selected")).toBe("true"));
    await waitFor(() => expect(document.activeElement).toBe(outputsTab));
    fireEvent.keyDown(outputsTab, { key: "ArrowRight" });
    await waitFor(() => expect(tasksTab.getAttribute("aria-selected")).toBe("true"));
  });

  it("moves focus to the list restore control when a compact file selection opens detail", async () => {
    const originalMatchMedia = window.matchMedia;
    window.matchMedia = vi.fn((query: string) => ({
      matches: query === "(max-width: 1480px)",
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(() => true)
    } as MediaQueryList));
    installApi({
      listProjectMaterials: vi.fn(async () => [existingMaterial]),
      readProjectMaterial: vi.fn(async () => ({ material: existingMaterial, content: "# 研究资料", truncated: false }))
    });

    try {
      render(<ResponsiveLayoutProvider><AiProvider initial={snapshot}><ProjectsPage /></AiProvider></ResponsiveLayoutProvider>);
      fireEvent.click(await screen.findByRole("button", { name: "AI 安全" }));
      fireEvent.click(await screen.findByRole("button", { name: "展开项目列表" }));

      const tasksTab = await screen.findByRole("tab", { name: "任务" });
      tasksTab.focus();
      fireEvent.keyDown(tasksTab, { key: "ArrowRight" });

      const reopen = await screen.findByRole("button", { name: "展开项目列表" });
      await waitFor(() => expect(document.activeElement).toBe(reopen));
      const host = document.querySelector(".project-detail-fill");
      const row = document.querySelector<HTMLButtonElement>(".project-file-row.active > button")!;
      fireEvent.click(reopen);
      expect(document.querySelector(".project-main-pane")?.hasAttribute("inert")).toBe(true);
      await waitFor(() => expect(document.activeElement).toBe(row));
      fireEvent.click(row);
      await waitFor(() => expect(document.querySelector(".project-workspace")?.classList.contains("compact-detail-open")).toBe(true));
      expect(document.querySelector(".project-detail-fill")).toBe(host);
      expect(window.openmind.readProjectMaterial).toHaveBeenCalledOnce();
    } finally {
      window.matchMedia = originalMatchMedia;
    }
  });

  it("keeps an edited output mounted when showing its compact list and selecting it again", async () => {
    vi.spyOn(window, "matchMedia").mockImplementation(query => ({ matches: query === "(max-width: 1480px)", media: query, addEventListener: vi.fn(), removeEventListener: vi.fn() } as unknown as MediaQueryList));
    const readProjectOutput = vi.fn(async () => ({ output: existingDocument, content: "# 原稿" }));
    installApi({ listProjectOutputs: vi.fn(async () => [existingDocument]), readProjectOutput,
      saveProjectOutput: vi.fn(async ({ title, content }) => ({ output: { ...existingDocument, title }, content })) });
    render(<ResponsiveLayoutProvider><AiProvider initial={snapshot}><ProjectsPage initialProjectName={summary.name} initialSection="outputs" initialItem={existingDocument.relativePath} /></AiProvider></ResponsiveLayoutProvider>);
    const editor = await screen.findByRole<HTMLInputElement>("textbox", { name: "文档标题" });
    fireEvent.change(editor, { target: { value: "保留中的草稿" } });
    const detailHost = document.querySelector(".project-detail-fill");
    fireEvent.click(screen.getByRole("button", { name: "展开项目列表" }));
    expect(editor.isConnected).toBe(true);
    expect(document.querySelector(".project-main-pane")?.getAttribute("aria-hidden")).toBe("true");
    const selected = document.querySelector<HTMLButtonElement>(".project-list-pane .project-item-list > button.active")!;
    fireEvent.click(selected);
    await waitFor(() => expect(screen.getByRole("textbox", { name: "文档标题" })).toBe(editor));
    expect(editor.value).toBe("保留中的草稿");
    expect(document.querySelector(".project-detail-fill")).toBe(detailHost);
    expect(readProjectOutput).toHaveBeenCalledOnce();
  });

  it("keeps the new-conversation view until a concrete task is selected", async () => {
    const workspaceSession: AiSession = {
      schemaVersion: 1,
      id: "workspace-session",
      projectId: "workspace",
      scope: { type: "workspace" },
      projectRoot: "/project",
      title: "之前打开的会话",
      provider: "codex",
      providerId: "codex-native",
      providerSessionId: null,
      cwd: ".",
      permissionProfile: "edit",
      status: "idle",
      pinned: false,
      archived: false,
      createdAt: "2026-08-30T00:00:00.000Z",
      updatedAt: "2026-08-31T00:00:00.000Z",
      lastRunId: null
    };
    const task = {
      taskId: "task-1",
      projectId: summary.id,
      projectName: summary.name,
      title: "具体任务",
      sessionId: null,
      previousSessionIds: [],
      providerId: "codex-native",
      status: "active",
      createdAt: "2026-08-30T00:00:00.000Z",
      updatedAt: "2026-08-31T00:00:00.000Z"
    };
    installApi({ listProjectTasks: vi.fn(async () => [task]) });
    const { container } = renderPage({ ...snapshot, sessions: [workspaceSession] });

    fireEvent.click(await screen.findByRole("button", { name: "AI 安全" }));

    const taskButton = (await screen.findByText("具体任务")).closest("button")!;
    expect(taskButton.closest(".project-task-row")?.classList.contains("active")).toBe(false);
    expect(document.querySelector(".project-task-session.is-draft")).toBeTruthy();
    expect(screen.queryByText("之前打开的会话")).toBeNull();
    expect(container.querySelector(".project-task-session-bar")).toBeNull();

    fireEvent.click(taskButton);

    expect(taskButton.closest(".project-task-row")?.classList.contains("active")).toBe(true);
    expect(await screen.findByText("基于“AI 安全”开始创作")).toBeTruthy();
  });

  it("filters the pane list through the project search", async () => {
    const other: ProjectSummary = { ...summary, id: "5a222222-2222-4222-8222-222222222222", name: "每日简报实验", description: "", updatedAt: "2026-08-30T00:00:00.000Z" };
    installApi({ listProjects: vi.fn(async () => [summary, other]) });
    renderPage();

    const search = await screen.findByLabelText("搜索项目");
    expect(search.getAttribute("placeholder")).toBe("你的项目");
    expect(search.nextElementSibling?.tagName.toLocaleLowerCase()).toBe("svg");
    fireEvent.change(search, { target: { value: "安全" } });

    await waitFor(() => expect(screen.queryByRole("button", { name: /每日简报实验/ })).toBeNull());
    expect(screen.getByRole("button", { name: "AI 安全" })).toBeTruthy();
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

    fireEvent.click(screen.getByRole("button", { name: "关闭" }));
    await waitFor(() => expect(container.querySelector(".project-dialog-backdrop")?.getAttribute("data-leaving")).toBe("true"));
    expect(container.querySelector(".project-dialog-backdrop")?.hasAttribute("inert")).toBe(true);
    await waitFor(() => expect(container.querySelector(".project-dialog-backdrop")).toBeNull());
  });

  it("shows materials and editable documents in one flat file list", async () => {
    installApi({
      listProjectMaterials: vi.fn(async () => [existingMaterial]),
      readProjectMaterial: vi.fn(async () => ({ material: existingMaterial, content: "# 研究资料", truncated: false })),
      listProjectOutputs: vi.fn(async () => [existingDocument]),
      readProjectOutput: vi.fn(async () => ({ output: existingDocument, content: "# 研究文档" }))
    });
    renderPage();

    fireEvent.click(await screen.findByRole("button", { name: "AI 安全" }));
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

  it("offers task, material and output actions in the project plus menu", async () => {
    installApi({
      listProjectMaterials: vi.fn(async () => [existingMaterial]),
      readProjectMaterial: vi.fn(async () => ({ material: existingMaterial, content: "# 研究资料", truncated: false })),
      listProjectOutputs: vi.fn(async () => [existingDocument]),
      readProjectOutput: vi.fn(async () => ({ output: existingDocument, content: "# 研究文档" }))
    });
    renderPage();

    fireEvent.click(await screen.findByRole("button", { name: "AI 安全" }));
    fireEvent.click(await screen.findByLabelText("新建项目内容"));

    expect(screen.getByRole("menuitem", { name: "新建任务" })).toBeTruthy();
    const addMaterial = screen.getByRole("menuitem", { name: "添加资料" });
    expect(addMaterial).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: "新建产物" })).toBeTruthy();
    expect(screen.queryByRole("menuitem", { name: "新建文档" })).toBeNull();
    expect(screen.queryByLabelText("项目操作")).toBeNull();

    fireEvent.click(addMaterial);
    expect(await screen.findByRole("dialog", { name: "添加资料" })).toBeTruthy();
  });

  it("shows saved articles in the outputs tab and opens an output deep link", async () => {
    installApi({
      listProjectOutputs: vi.fn(async () => [existingDocument]),
      readProjectOutput: vi.fn(async () => ({ output: existingDocument, content: "# 研究文档" }))
    });
    render(<AiProvider initial={snapshot}><ProjectsPage initialProjectName={summary.name} initialSection="outputs" initialItem={existingDocument.relativePath} /></AiProvider>);

    const tab = await screen.findByRole("tab", { name: "产物" });
    expect(tab.getAttribute("aria-selected")).toBe("true");
    expect(await screen.findByLabelText("搜索产物")).toBeTruthy();
    expect(await screen.findByRole("textbox", { name: "文档标题" })).toBeTruthy();
    expect(window.openmind.readProjectOutput).toHaveBeenCalledWith({ projectName: summary.name, relativePath: existingDocument.relativePath });
    expect(window.openmind.listProjectMaterials).not.toHaveBeenCalled();
  });

  it("creates an output from the plus menu while keeping its dialog open", async () => {
    const createProjectOutput = vi.fn(async () => ({ output: existingDocument, content: "" }));
    installApi({
      createProjectOutput,
      readProjectOutput: vi.fn(async () => ({ output: existingDocument, content: "" }))
    });
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: summary.name }));
    fireEvent.click(await screen.findByLabelText("新建项目内容"));
    fireEvent.click(screen.getByRole("menuitem", { name: "新建产物" }));
    const dialog = await screen.findByRole("dialog", { name: "新建文档" });
    fireEvent.change(within(dialog).getByRole("textbox", { name: "文档标题" }), { target: { value: "新文章" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "创建并编辑" }));
    await waitFor(() => expect(createProjectOutput).toHaveBeenCalledWith(expect.objectContaining({ projectName: summary.name, title: "新文章" })));
    expect(screen.getByRole("tab", { name: "产物" }).getAttribute("aria-selected")).toBe("true");
  });

  it("closes the project plus menu when clicking outside it", async () => {
    installApi();
    renderPage();

    fireEvent.click(await screen.findByRole("button", { name: "AI 安全" }));
    const trigger = await screen.findByLabelText("新建项目内容");
    fireEvent.click(trigger);

    expect(await screen.findByRole("menuitem", { name: "新建任务" })).toBeTruthy();

    fireEvent.pointerDown(document.body);

    await waitFor(() => expect(screen.queryByRole("menuitem", { name: "新建任务" })).toBeNull());
  });

  it("opens the reused AI conversation workbench when creating a task", async () => {
    installApi();
    renderPage();

    fireEvent.click(await screen.findByRole("button", { name: "AI 安全" }));
    fireEvent.click(await screen.findByLabelText("新建项目内容"));
    fireEvent.click(screen.getByRole("menuitem", { name: "新建任务" }));

    expect(document.querySelector(".project-task-session.is-draft")).toBeTruthy();
    expect(screen.getByText("从资料到创作，让 AI 帮你推进")).toBeTruthy();
    expect(screen.getByLabelText("AI 消息")).toBeTruthy();
    expect(screen.queryByText("基于“AI 安全”开始创作")).toBeNull();
  });

  it("renames and deletes a task from its row menu", async () => {
    const task = {
      taskId: "task-1",
      projectName: summary.name,
      title: "暑期保养预告海报",
      sessionId: null,
      providerId: "codex-native",
      status: "active",
      createdAt: "2026-08-30T00:00:00.000Z",
      updatedAt: "2026-08-31T00:00:00.000Z"
    };
    const renamedTask = { ...task, title: "暑期保养海报" };
    const renameProjectTask = vi.fn(async () => renamedTask);
    const archiveProjectTask = vi.fn(async () => ({ ...renamedTask, status: "archived" }));
    installApi({
      listProjectTasks: vi.fn(async () => [task]),
      renameProjectTask,
      archiveProjectTask
    });
    renderPage();

    fireEvent.click(await screen.findByRole("button", { name: "AI 安全" }));
    const taskButton = (await screen.findByText("暑期保养预告海报")).closest("button")!;
    fireEvent.click(taskButton);
    expect(taskButton.closest(".project-task-row")?.classList.contains("active")).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "任务操作：暑期保养预告海报" }));
    const taskMenu = await screen.findByRole("menu", { name: "暑期保养预告海报的任务操作" });
    fireEvent.click(within(taskMenu).getByRole("menuitem", { name: "重命名" }));

    const renameDialog = await screen.findByRole("dialog", { name: "重命名任务" });
    fireEvent.change(within(renameDialog).getByLabelText("任务名称"), { target: { value: "暑期保养海报" } });
    fireEvent.click(within(renameDialog).getByRole("button", { name: "保存" }));

    await waitFor(() => expect(renameProjectTask).toHaveBeenCalledWith({
      projectName: "AI 安全",
      taskId: "task-1",
      title: "暑期保养海报"
    }));
    expect((await screen.findByText("暑期保养海报")).closest("button")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "任务操作：暑期保养海报" }));
    const renamedMenu = await screen.findByRole("menu", { name: "暑期保养海报的任务操作" });
    fireEvent.click(within(renamedMenu).getByRole("menuitem", { name: "删除" }));
    const confirm = await screen.findByRole("alertdialog", { name: "删除任务" });
    fireEvent.click(within(confirm).getByRole("button", { name: "删除" }));

    await waitFor(() => expect(archiveProjectTask).toHaveBeenCalledWith({ projectName: "AI 安全", taskId: "task-1" }));
    await waitFor(() => expect(screen.queryByText("暑期保养海报")).toBeNull());
    expect(document.querySelector(".project-task-session.is-draft")).toBeTruthy();
  });

  it("edits a project name, color and icon from the three-dot menu", async () => {
    const renamed = { ...detail, name: "Chaos" };
    const renameProject = vi.fn(async () => renamed);
    const updateProject = vi.fn(async ({ icon, color }: { icon: string; color: string }) => ({ ...renamed, icon, color }));
    installApi({ renameProject, updateProject });
    renderPage();

    fireEvent.click(await screen.findByRole("button", { name: "项目操作：AI 安全" }));
    const menu = await screen.findByRole("menu", { name: "AI 安全的项目操作" });
    expect(within(menu).getAllByRole("menuitem").map((item) => item.textContent)).toEqual(["编辑", "收藏", "归档"]);
    fireEvent.click(within(menu).getByRole("menuitem", { name: "编辑" }));

    const dialog = await screen.findByRole("dialog", { name: "编辑项目" });
    fireEvent.change(within(dialog).getByLabelText("项目名称"), { target: { value: "Chaos" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "图标" }));
    const picker = await screen.findByRole("dialog", { name: "选择项目图标" });
    fireEvent.click(within(picker).getByRole("button", { name: "游戏" }));
    expect(screen.queryByRole("dialog", { name: "选择项目图标" })).toBeNull();
    fireEvent.click(within(dialog).getByRole("button", { name: "粉色" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "更新" }));

    await waitFor(() => expect(renameProject).toHaveBeenCalledWith({ projectName: "AI 安全", newName: "Chaos" }));
    await waitFor(() => expect(updateProject).toHaveBeenCalledWith({ projectName: "Chaos", icon: "gamepad", color: "pink" }));
    expect(await screen.findByRole("button", { name: "Chaos" })).toBeTruthy();
  });

  it("moves a favorite out of Recent Projects into Favorites only", async () => {
    const updateProject = vi.fn(async () => ({ ...detail, favorite: true }));
    installApi({ updateProject });
    renderPage();

    expect(await screen.findByRole("region", { name: "近期项目" })).toBeTruthy();
    screen.getByRole("button", { name: "项目操作：AI 安全" }).focus();
    fireEvent.click(screen.getByRole("button", { name: "项目操作：AI 安全" }));
    fireEvent.click(within(await screen.findByRole("menu", { name: "AI 安全的项目操作" })).getByRole("menuitem", { name: "收藏" }));

    const favorites = await screen.findByRole("region", { name: "收藏" });
    expect(within(favorites).getByRole("button", { name: "AI 安全" })).toBeTruthy();
    expect(screen.queryByRole("region", { name: "近期项目" })).toBeNull();
    expect(updateProject).toHaveBeenCalledWith({ projectName: "AI 安全", favorite: true });
    expect(document.activeElement).toBe(within(favorites).getByRole("button", { name: "项目操作：AI 安全" }));
  });

  it("does not steal focus from another project menu when a favorite request finishes", async () => {
    let finish!: (project: ProjectDetail) => void;
    installApi({
      listProjects: vi.fn(async () => [summary, { ...summary, id: "second-project", name: "另一项目" }]),
      updateProject: vi.fn(() => new Promise<ProjectDetail>(resolve => { finish = resolve; }))
    });
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "项目操作：AI 安全" }));
    fireEvent.click(within(await screen.findByRole("menu", { name: "AI 安全的项目操作" })).getByRole("menuitem", { name: "收藏" }));
    fireEvent.click(screen.getByRole("button", { name: "项目操作：另一项目" }));
    const otherItem = within(await screen.findByRole("menu", { name: "另一项目的项目操作" })).getByRole("menuitem", { name: "编辑" });
    otherItem.focus();
    await act(async () => finish({ ...detail, favorite: true }));
    expect(await screen.findByRole("region", { name: "收藏" })).toBeTruthy();
    expect(document.activeElement).toBe(otherItem);
  });

  it("archives a project from its menu and keeps archived projects out of the recent group", async () => {
    const archived: ProjectSummary = { ...summary, name: "旧选题库", status: "archived" as const };
    const archiveProject = vi.fn(async () => ({ ...detail, status: "archived" as const }));
    installApi({ listProjects: vi.fn(async () => [summary, archived]), archiveProject });
    renderPage();

    expect(await screen.findByRole("region", { name: "近期项目" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "旧选题库" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "项目操作：AI 安全" }));
    fireEvent.click(within(await screen.findByRole("menu", { name: "AI 安全的项目操作" })).getByRole("menuitem", { name: "归档" }));

    await waitFor(() => expect(archiveProject).toHaveBeenCalledWith({ projectName: "AI 安全", archived: true }));
    await waitFor(() => expect(screen.queryByRole("button", { name: "AI 安全" })).toBeNull());
  });
});
