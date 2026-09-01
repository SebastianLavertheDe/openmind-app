import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AiSnapshot, DesktopApi } from "@shared/contracts";
import { AiProvider } from "../../ai-context";
import { FeedbackHost } from "../../components/FeedbackHost";
import { ProjectMaterialsPanel } from "./ProjectMaterialsPanel";
import { ProjectOutputsPanel, type ProjectOutputNavigationGuard } from "./ProjectOutputsPanel";
import { ProjectTasksPanel } from "./ProjectTasksPanel";
import { ProjectsPage } from "./ProjectsPage";
import type { ProjectDetail } from "./types";

const project: ProjectDetail = {
  name: "AI 安全",
  description: "研究与写作",
  status: "active",
  materialCount: 1,
  taskCount: 0,
  outputCount: 1,
  createdAt: "2026-08-30T00:00:00.000Z",
  updatedAt: "2026-08-31T00:00:00.000Z"
};

const snapshot: AiSnapshot = {
  projectRoot: "/project",
  providers: [{
    id: "codex-native",
    provider: "codex",
    label: "Codex",
    runtime: "native",
    available: true,
    version: "1",
    supportsApprovals: true,
    supportsResume: true,
    supportsImages: true,
    diagnostic: null,
    detectedModel: null,
    contextWindow: null,
    installable: false,
    oneMillion: false
  }],
  sessions: [],
  runs: [],
  pendingApprovals: []
};

function installApi(overrides: Record<string, unknown> = {}): void {
  window.openmind = {
    aiRefresh: vi.fn(async () => snapshot),
    aiGetEvents: vi.fn(async () => []),
    aiCancelRun: vi.fn(async () => true),
    aiResolveApproval: vi.fn(async () => true),
    aiListTurns: vi.fn(async () => ({ data: [], nextCursor: null, total: 0, parseErrors: 0 })),
    selectFiles: vi.fn(async () => []),
    selectOpenmindFiles: vi.fn(async () => []),
    searchOpenmindFiles: vi.fn(async () => ({ items: [], indexedCount: 0, truncated: false })),
    openPath: vi.fn(async (path: string) => path),
    revealPath: vi.fn(async () => true),
    onAiEvent: vi.fn(() => () => {}),
    onSkillEvent: vi.fn(() => () => {}),
    ...overrides
  } as unknown as DesktopApi;
}

function renderWithAi(node: React.ReactNode) {
  return render(<AiProvider initial={snapshot}>{node}<FeedbackHost /></AiProvider>);
}

function outputRecord(title = "报告", relativePath = "outputs/report.md") {
  return {
    projectName: project.name,
    relativePath,
    title,
    sourceTaskId: null,
    sourceSessionId: null,
    sourceMessageId: null,
    createdAt: "2026-08-30T00:00:00.000Z",
    updatedAt: "2026-08-31T00:00:00.000Z"
  };
}

beforeEach(() => {
  window.localStorage.clear();
});

describe("Project output persistence", () => {
  it("flushes the latest dirty title through the registered navigation guard", async () => {
    const saveProjectOutput = vi.fn(async (input: { relativePath: string; title: string; content: string }) => ({
      output: outputRecord(input.title, input.relativePath),
      content: input.content
    }));
    installApi({
      listProjectOutputs: vi.fn(async () => [outputRecord()]),
      readProjectOutput: vi.fn(async () => ({ output: outputRecord(), content: "# 初稿" })),
      saveProjectOutput
    });
    let guard: ProjectOutputNavigationGuard | null = null;
    renderWithAi(<ProjectOutputsPanel project={project} createRequested={false} onCreateHandled={vi.fn()} onChanged={vi.fn()} onNavigationGuardChange={(next) => { guard = next; }} />);

    const title = await screen.findByRole("textbox", { name: "文档标题" });
    fireEvent.change(title, { target: { value: "最终报告" } });
    expect(screen.getByText("待保存")).toBeTruthy();

    await act(async () => {
      expect(await guard?.flush()).toBe(true);
    });
    expect(saveProjectOutput).toHaveBeenCalledWith(expect.objectContaining({ title: "最终报告", content: "# 初稿" }));
    expect(screen.getByText("已保存")).toBeTruthy();
  });

  it("starts a flush when the output panel unmounts before the debounce expires", async () => {
    const saveProjectOutput = vi.fn(async (input: { relativePath: string; title: string; content: string }) => ({
      output: outputRecord(input.title, input.relativePath),
      content: input.content
    }));
    installApi({
      listProjectOutputs: vi.fn(async () => [outputRecord()]),
      readProjectOutput: vi.fn(async () => ({ output: outputRecord(), content: "# 初稿" })),
      saveProjectOutput
    });
    const view = renderWithAi(<ProjectOutputsPanel project={project} createRequested={false} onCreateHandled={vi.fn()} onChanged={vi.fn()} />);

    fireEvent.change(await screen.findByRole("textbox", { name: "文档标题" }), { target: { value: "卸载前保存" } });
    view.unmount();

    await waitFor(() => expect(saveProjectOutput).toHaveBeenCalledWith(expect.objectContaining({ title: "卸载前保存" })));
  });

  it("keeps the current output open when a failed flush is not discarded", async () => {
    const second = outputRecord("第二份", "outputs/second.md");
    const readProjectOutput = vi.fn(async (input: { relativePath: string }) => ({
      output: input.relativePath === second.relativePath ? second : outputRecord(),
      content: input.relativePath === second.relativePath ? "# 第二份" : "# 初稿"
    }));
    installApi({
      listProjectOutputs: vi.fn(async () => [outputRecord(), second]),
      readProjectOutput,
      saveProjectOutput: vi.fn(async () => { throw new Error("磁盘写入失败"); })
    });
    renderWithAi(<ProjectOutputsPanel project={project} createRequested={false} onCreateHandled={vi.fn()} onChanged={vi.fn()} />);

    const title = await screen.findByRole("textbox", { name: "文档标题" });
    fireEvent.change(title, { target: { value: "尚未保存" } });
    fireEvent.click(screen.getByRole("button", { name: /第二份/ }));

    const confirm = await screen.findByRole("alertdialog", { name: "文档保存失败" });
    expect(readProjectOutput).toHaveBeenCalledTimes(1);
    fireEvent.click(within(confirm).getByRole("button", { name: "取消" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog", { name: "文档保存失败" })).toBeNull());
    expect((screen.getByRole("textbox", { name: "文档标题" }) as HTMLInputElement).value).toBe("尚未保存");
    expect(readProjectOutput).toHaveBeenCalledTimes(1);
  });

  it("waits for output persistence before switching Project sections", async () => {
    const order: string[] = [];
    installApi({
      listProjects: vi.fn(async () => [project]),
      getProject: vi.fn(async () => ({ project })),
      listProjectMaterials: vi.fn(async () => []),
      listProjectOutputs: vi.fn(async () => [outputRecord()]),
      readProjectOutput: vi.fn(async () => ({ output: outputRecord(), content: "# 初稿" })),
      saveProjectOutput: vi.fn(async (input: { relativePath: string; title: string; content: string }) => {
        order.push("save");
        return { output: outputRecord(input.title, input.relativePath), content: input.content };
      }),
      listProjectTasks: vi.fn(async () => {
        order.push("tasks");
        return [];
      })
    });
    renderWithAi(<ProjectsPage initialProjectName={project.name} initialSection="outputs" />);

    fireEvent.change(await screen.findByRole("textbox", { name: "文档标题" }), { target: { value: "切换前保存" } });
    fireEvent.click(screen.getByRole("tab", { name: "任务" }));

    await waitFor(() => expect(order).toEqual(["save", "tasks"]));
  });
});

describe("Project task recovery", () => {
  it("keeps and selects a created task when starting its run fails", async () => {
    const createdTask = {
      taskId: "task-1",
      projectName: project.name,
      title: "保留任务",
      sessionId: null,
      providerId: "codex-native",
      status: "active",
      createdAt: "2026-08-31T00:00:00.000Z",
      updatedAt: "2026-08-31T00:00:00.000Z"
    };
    const failedTask = { ...createdTask, status: "failed" };
    const listProjectTasks = vi.fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([failedTask]);
    const onChanged = vi.fn();
    installApi({
      listProjectTasks,
      createProjectTask: vi.fn(async () => createdTask),
      projectStartTaskRun: vi.fn(async () => { throw new Error("运行启动失败"); })
    });
    renderWithAi(<ProjectTasksPanel project={{ ...project, taskCount: 0 }} createRequested seed={{ title: "保留任务", prompt: "生成报告" }} onCreateHandled={vi.fn()} onChanged={onChanged} />);

    const start = await screen.findByRole("button", { name: "开始任务" });
    await waitFor(() => expect((start as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(start);

    expect(await screen.findByText("运行启动失败")).toBeTruthy();
    expect(screen.getByRole("button", { name: /保留任务.*失败/ })).toBeTruthy();
    expect((screen.getByRole("textbox", { name: "任务内容" }) as HTMLTextAreaElement).value).toBe("生成报告");
    expect(onChanged).toHaveBeenCalled();
  });

  it("refreshes the task list when any run in the current Project becomes terminal", async () => {
    let emitAiEvent: ((message: unknown) => void) | null = null;
    const listProjectTasks = vi.fn(async () => []);
    const onChanged = vi.fn();
    installApi({
      listProjectTasks,
      onAiEvent: vi.fn((listener: (message: unknown) => void) => {
        emitAiEvent = listener;
        return () => {};
      })
    });
    renderWithAi(<ProjectTasksPanel project={{ ...project, taskCount: 0 }} createRequested={false} onCreateHandled={vi.fn()} onChanged={onChanged} />);
    await waitFor(() => expect(listProjectTasks).toHaveBeenCalledTimes(1));

    const completedSnapshot: AiSnapshot = {
      ...snapshot,
      runs: [{
        schemaVersion: 1,
        id: "run-terminal",
        sessionId: "session-other",
        projectId: "project",
        scope: { type: "project-task", projectName: project.name, taskId: "task-other" },
        provider: "codex",
        providerId: "codex-native",
        permissionProfile: "edit",
        interactionMode: "default",
        status: "completed",
        prompt: "生成报告",
        contexts: [],
        turnContext: null,
        workspacePath: null,
        baseCommit: null,
        startedAt: "2026-08-31T00:00:00.000Z",
        completedAt: "2026-08-31T00:01:00.000Z",
        error: null,
        changeSet: null,
        risks: []
      }]
    };
    act(() => emitAiEvent?.({ kind: "snapshot", snapshot: completedSnapshot }));

    await waitFor(() => expect(listProjectTasks).toHaveBeenCalledTimes(2));
    expect(onChanged).toHaveBeenCalledTimes(1);
  });
});

describe("Project material truncation", () => {
  it("warns about a truncated read and disables copying the partial preview", async () => {
    const createProjectOutput = vi.fn();
    const material = {
      projectName: project.name,
      relativePath: "materials/large.md",
      title: "大型资料",
      kind: "document",
      status: "ready",
      source: { type: "file" },
      createdAt: "2026-08-30T00:00:00.000Z",
      updatedAt: "2026-08-31T00:00:00.000Z"
    };
    installApi({
      listProjectMaterials: vi.fn(async () => [material]),
      readProjectMaterial: vi.fn(async () => ({ material, content: "# 仅部分内容", truncated: true })),
      createProjectOutput
    });
    renderWithAi(<ProjectMaterialsPanel project={project} createRequested={false} onCreateHandled={vi.fn()} onCreateTask={vi.fn()} onChanged={vi.fn()} />);

    expect(await screen.findByText("当前只显示资料的部分内容")).toBeTruthy();
    const copy = screen.getByRole("button", { name: "转为可编辑文档" });
    expect((copy as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(copy);
    expect(createProjectOutput).not.toHaveBeenCalled();
  });
});
