import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StrictMode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AiRun, AiSession, AiSnapshot, DesktopApi } from "@shared/contracts";
import { messages as m } from "@shared/messages";
import { AiProvider, useAiActions } from "../../ai-context";
import type { SkillLibraryEntry } from "@shared/skill-library";
import { FeedbackHost } from "../../components/FeedbackHost";
import { ProjectFilesPanel } from "./ProjectFilesPanel";
import { ProjectMaterialsPanel } from "./ProjectMaterialsPanel";
import { ProjectOutputsPanel, type ProjectOutputNavigationGuard } from "./ProjectOutputsPanel";
import { ProjectTasksPanel } from "./ProjectTasksPanel";
import { ProjectsPage } from "./ProjectsPage";
import type { ProjectDetail } from "./types";

vi.mock("./ProjectOutputEditor", () => ({
  ProjectOutputEditor: ({ title, content, readOnly, onTitle, onContent }: { title: string; content: string; readOnly: boolean; onTitle(value: string): void; onContent(value: string): void }) => <>
    <textarea aria-label="文档标题" value={title} readOnly={readOnly} onChange={(event) => onTitle(event.target.value)} />
    <textarea aria-label="Markdown 文档内容" value={content} readOnly={readOnly} onChange={(event) => onContent(event.target.value)} />
  </>
}));

const project: ProjectDetail = {
  id: "5a111111-1111-4111-8111-111111111111",
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
  it("exports the latest unsaved title and body from the output menu", async () => {
    const copyWechatArticle = vi.fn().mockResolvedValue(undefined);
    const saveProjectOutput = vi.fn(async (input: { relativePath: string; title: string; content: string }) => ({ output: outputRecord(input.title, input.relativePath), content: input.content }));
    installApi({
      listProjectOutputs: vi.fn(async () => [outputRecord()]),
      readProjectOutput: vi.fn(async () => ({ output: outputRecord(), content: "# 初稿" })),
      getWechatAccount: vi.fn(async () => ({ appId: "", author: "", configured: false })),
      copyWechatArticle,
      saveProjectOutput
    });
    renderWithAi(<ProjectOutputsPanel project={project} createRequested={false} onCreateHandled={vi.fn()} onChanged={vi.fn()} />);
    fireEvent.change(await screen.findByRole("textbox", { name: "文档标题" }), { target: { value: "最新未保存标题" } });
    fireEvent.change(screen.getByRole("textbox", { name: "Markdown 文档内容" }), { target: { value: "## 新章节\n\n最新未保存正文。" } });
    fireEvent.click(screen.getByRole("button", { name: "成品更多操作" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "导出到微信公众号" }));
    const dialog = await screen.findByRole("dialog", { name: "导出到微信公众号" });
    expect(within(dialog).getByText("最新未保存标题")).toBeTruthy();
    expect(saveProjectOutput).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole("button", { name: "复制排版" }));
    await waitFor(() => expect(copyWechatArticle).toHaveBeenCalledOnce());
    const copied = copyWechatArticle.mock.calls[0][0] as { html: string; text: string };
    expect(copied.html).toContain("最新未保存正文。");
    expect(copied.html).toContain("新章节");
    expect(copied.html).not.toContain("初稿");
    expect(copied.text).toContain("最新未保存正文。");
    expect(await within(dialog).findByRole("status")).toHaveProperty("textContent", "已复制公众号排版，可粘贴到公众号编辑器。");
  });

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
  it("creates a Project task from the reused conversation composer", async () => {
    const createdTask = {
      taskId: "task-1",
      projectId: project.id,
      projectName: project.name,
      title: "生成项目报告",
      sessionId: null,
      previousSessionIds: [],
      providerId: "codex-native",
      status: "active" as const,
      createdAt: "2026-08-31T00:00:00.000Z",
      updatedAt: "2026-08-31T00:00:00.000Z"
    };
    const session: AiSession = {
      schemaVersion: 1,
      id: "session-1",
      projectId: project.id,
      projectRoot: "/project/AI 安全",
      scope: { type: "project-task", projectId: project.id, projectName: project.name, taskId: createdTask.taskId },
      provider: "codex",
      providerId: "codex-native",
      providerSessionId: null,
      cwd: ".",
      title: createdTask.title,
      permissionProfile: "auto",
      interactionMode: "default",
      status: "running",
      pinned: false,
      archived: false,
      createdAt: createdTask.createdAt,
      updatedAt: createdTask.updatedAt,
      lastRunId: "run-1"
    };
    const run: AiRun = {
      schemaVersion: 1,
      id: "run-1",
      sessionId: session.id,
      projectId: session.projectId,
      scope: session.scope,
      provider: "codex",
      providerId: "codex-native",
      permissionProfile: "auto",
      interactionMode: "default",
      status: "running",
      prompt: "生成项目报告",
      contexts: [],
      turnContext: null,
      workspacePath: null,
      baseCommit: null,
      startedAt: createdTask.createdAt,
      completedAt: null,
      error: null,
      changeSet: null,
      risks: []
    };
    const boundTask = { ...createdTask, sessionId: session.id };
    let refreshedSnapshot = snapshot;
    const createProjectTask = vi.fn(async () => createdTask);
    const projectStartTaskRun = vi.fn(async () => {
      refreshedSnapshot = { ...snapshot, sessions: [session], runs: [run] };
      return { task: boundTask, session, run };
    });
    installApi({
      aiRefresh: vi.fn(async () => refreshedSnapshot),
      listProjectTasks: vi.fn(async () => []),
      createProjectTask,
      projectStartTaskRun
    });
    const view = renderWithAi(<ProjectTasksPanel project={{ ...project, taskCount: 0 }} createRequested seed={{ prompt: "生成项目报告" }} onCreateHandled={vi.fn()} onChanged={vi.fn()} />);

    const send = await screen.findByRole("button", { name: m.ai.composer.send });
    await waitFor(() => expect((send as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(send);

    await waitFor(() => expect(createProjectTask).toHaveBeenCalledWith({
      projectName: project.name,
      title: "生成项目报告",
      providerId: "codex-native"
    }));
    expect(projectStartTaskRun).toHaveBeenCalledWith({
      origin: { page: "ai" },
      projectName: project.name,
      taskId: createdTask.taskId,
      providerId: "codex-native",
      permissionProfile: "auto",
      prompt: "生成项目报告"
    });
    await waitFor(() => expect(view.container.querySelector(".project-task-row.active")).toBeTruthy());
    expect(view.container.querySelector(".project-task-session > .ai-workbench")).toBeTruthy();
  });

  it("continues an existing Project task through its scoped endpoint with the selected permission", async () => {
    const user = userEvent.setup();
    const task = {
      taskId: "task-1",
      projectId: project.id,
      projectName: project.name,
      title: "现有任务",
      sessionId: "session-1",
      previousSessionIds: [],
      providerId: "codex-native",
      status: "active" as const,
      createdAt: "2026-08-31T00:00:00.000Z",
      updatedAt: "2026-08-31T00:00:00.000Z"
    };
    const session: AiSession = {
      schemaVersion: 1,
      id: task.sessionId,
      projectId: project.id,
      projectRoot: "/project/AI 安全",
      scope: { type: "project-task", projectId: project.id, projectName: project.name, taskId: task.taskId },
      provider: "codex",
      providerId: "codex-native",
      providerSessionId: null,
      cwd: ".",
      title: task.title,
      permissionProfile: "auto",
      interactionMode: "default",
      status: "idle",
      pinned: false,
      archived: false,
      createdAt: task.createdAt,
      updatedAt: task.updatedAt,
      lastRunId: null
    };
    const scopedSnapshot = { ...snapshot, sessions: [session] };
    const projectStartTaskRun = vi.fn(async () => ({
      task,
      session: { ...session, status: "running" as const, lastRunId: "run-2" },
      run: { id: "run-2" }
    }));
    const aiStartRun = vi.fn();
    installApi({
      aiRefresh: vi.fn(async () => scopedSnapshot),
      aiStartRun,
      listProjectTasks: vi.fn(async () => [task]),
      projectStartTaskRun
    });
    render(<AiProvider initial={scopedSnapshot}><ProjectTasksPanel project={{ ...project, taskCount: 1 }} initialTaskId={task.taskId} createRequested={false} onCreateHandled={vi.fn()} onChanged={vi.fn()} /><FeedbackHost /></AiProvider>);

    await waitFor(() => expect(screen.getByLabelText(m.ai.composer.messageInput).getAttribute("placeholder")).toBe(m.ai.composer.placeholderContinue(task.title)));
    const composer = screen.getByLabelText(m.ai.composer.messageInput);
    await user.type(composer, "继续完善报告");
    await waitFor(() => expect((screen.getByRole("button", { name: m.ai.composer.send }) as HTMLButtonElement).disabled).toBe(false));
    await user.click(screen.getByRole("button", { name: m.ai.composer.send }));

    await waitFor(() => expect(projectStartTaskRun).toHaveBeenCalledWith({
      projectName: project.name,
      taskId: task.taskId,
      sessionId: task.sessionId,
      providerId: "codex-native",
      permissionProfile: "auto",
      prompt: "继续完善报告"
    }));
    expect(aiStartRun).not.toHaveBeenCalled();
  });

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

    const composer = await screen.findByLabelText(m.ai.composer.messageInput);
    expect((composer as HTMLTextAreaElement).value).toBe("生成报告");
    const send = screen.getByRole("button", { name: m.ai.composer.send });
    await waitFor(() => expect((send as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(send);

    expect(await screen.findByText("运行启动失败")).toBeTruthy();
    expect(screen.getByRole("button", { name: /保留任务.*失败/ })).toBeTruthy();
    expect((screen.getByRole("textbox", { name: "任务内容" }) as HTMLTextAreaElement).value).toBe("生成报告");
    expect(onChanged).toHaveBeenCalled();
  });

  it("retains the selected Skill and attachments on every retry of a failed new task", async () => {
    const task = { taskId: "task-1", projectName: project.name, title: "Retry task", sessionId: null, providerId: "codex-native", status: "failed", createdAt: project.createdAt, updatedAt: project.updatedAt };
    const skill: SkillLibraryEntry = { id: "fixture", title: "Required rules", subtitle: "", description: "", inputHint: "", category: "writing", origin: "authored", installed: true, enabled: true, usable: true, reason: null, key: "user/fixture", digest: "a".repeat(64), version: "1.0.0", skillId: "fixture", authoringId: null, revision: 1, draft: false, imageCount: 0, source: "user", executionModel: null };
    const context = { id: "material-1", kind: "file" as const, path: "materials/evidence.md", label: "Evidence" };
    let created = false;
    const startRun = vi.fn(async (_input: unknown) => { throw new Error("Admission failed"); });
    installApi({ listProjectTasks: vi.fn(async () => created ? [task] : []), createProjectTask: vi.fn(async () => { created = true; return task; }), projectStartTaskRun: startRun, listSkillLibrary: vi.fn(async () => [skill]) });
    let actions!: ReturnType<typeof useAiActions>;
    function DraftActions() { actions = useAiActions(); return null; }
    const view = renderWithAi(<><DraftActions /><ProjectTasksPanel project={project} createRequested seed={{ prompt: "Review these materials" }} onCreateHandled={vi.fn()} onChanged={vi.fn()} /></>);
    await screen.findByLabelText(m.ai.composer.messageInput);
    act(() => {
      actions.addContext(context, `project:${project.id}:new`);
      actions.selectSkill(skill, `project:${project.id}:new`);
    });
    fireEvent.click(screen.getByRole("button", { name: m.ai.composer.send }));
    await screen.findByText("Admission failed");
    expect(startRun.mock.calls[0][0]).toMatchObject({ selectedSkill: { key: skill.key, digest: skill.digest }, contexts: [context] });
    for (let attempt = 2; attempt <= 3; attempt++) {
      fireEvent.click(screen.getByRole("button", { name: m.projectUi.startTask }));
      await waitFor(() => expect(startRun).toHaveBeenCalledTimes(attempt));
      expect(startRun.mock.calls[attempt - 1][0]).toEqual(startRun.mock.calls[0][0]);
    }
    expect(window.openmind.createProjectTask).toHaveBeenCalledTimes(1);
    view.unmount();
    renderWithAi(<ProjectTasksPanel project={project} initialTaskId={task.taskId} createRequested={false} onCreateHandled={vi.fn()} onChanged={vi.fn()} />);
    await waitFor(() => expect((screen.getByRole("textbox", { name: "任务内容" }) as HTMLTextAreaElement).value).toBe("Review these materials"));
    fireEvent.click(screen.getByRole("button", { name: m.projectUi.startTask }));
    await waitFor(() => expect(startRun).toHaveBeenCalledTimes(4));
    expect(startRun.mock.calls[3][0]).toEqual(startRun.mock.calls[0][0]);
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
        projectId: project.id,
        scope: { type: "project-task", projectId: project.id, projectName: project.name, taskId: "task-other" },
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
  it("warns about a truncated read", async () => {
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
      readProjectMaterial: vi.fn(async () => ({ material, content: "# 仅部分内容", truncated: true }))
    });
    renderWithAi(<ProjectMaterialsPanel project={project} createRequested={false} onCreateHandled={vi.fn()} onCreateTask={vi.fn()} onChanged={vi.fn()} />);

    expect(await screen.findByText("当前只显示资料的部分内容")).toBeTruthy();
  });
});

describe("Project material PDF original", () => {
  const pdfMaterial = {
    projectName: project.name,
    relativePath: "materials/documents/Agentic Design Patterns.md",
    title: "Agentic Design Patterns",
    kind: "document",
    status: "ready",
    source: { type: "file", originalName: "Agentic Design Patterns.pdf" },
    originalRelativePath: "materials/originals/Agentic Design Patterns.pdf",
    createdAt: "2026-08-30T00:00:00.000Z",
    updatedAt: "2026-08-31T00:00:00.000Z"
  };

  it("previews the preserved PDF original by default and still offers the extracted text", async () => {
    const readProjectMaterialOriginal = vi.fn(async () => ({
      fileName: "Agentic Design Patterns.pdf",
      mimeType: "application/pdf" as const,
      byteSize: 8,
      data: new Uint8Array([0x25, 0x50, 0x44, 0x46])
    }));
    installApi({
      listProjectMaterials: vi.fn(async () => [pdfMaterial]),
      readProjectMaterial: vi.fn(async () => ({ material: pdfMaterial, content: "# 提取文本", truncated: false })),
      readProjectMaterialOriginal
    });
    renderWithAi(<ProjectMaterialsPanel project={project} createRequested={false} onCreateHandled={vi.fn()} onCreateTask={vi.fn()} onChanged={vi.fn()} />);

    expect((await screen.findByRole("button", { name: "PDF" })).getAttribute("aria-pressed")).toBe("true");
    await waitFor(() => expect(readProjectMaterialOriginal).toHaveBeenCalledWith({ projectName: project.name, relativePath: pdfMaterial.relativePath }));
    // jsdom 无法启动 pdf.js worker，阅读器初始化失败后回落到提取文本卡片。
    expect(await screen.findByText("无法加载 PDF 原件")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "查看提取文本" }));
    expect(await screen.findByText("提取文本")).toBeTruthy();
  });

  it("shows a fallback with a shortcut to the extracted text when the original cannot load", async () => {
    installApi({
      listProjectMaterials: vi.fn(async () => [pdfMaterial]),
      readProjectMaterial: vi.fn(async () => ({ material: pdfMaterial, content: "# 提取文本", truncated: false })),
      readProjectMaterialOriginal: vi.fn(async () => {
        throw new Error("该资料没有保留原始文件。");
      })
    });
    renderWithAi(<ProjectMaterialsPanel project={project} createRequested={false} onCreateHandled={vi.fn()} onCreateTask={vi.fn()} onChanged={vi.fn()} />);

    expect(await screen.findByText("无法加载 PDF 原件")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "查看提取文本" }));
    expect(await screen.findByText("提取文本")).toBeTruthy();
  });
});

describe("Project file selection", () => {
  it("does not let late material metadata replace the newest selection", async () => {
    const first = {
      projectName: project.name,
      relativePath: "materials/documents/first.md",
      title: "First material",
      kind: "document",
      status: "ready",
      source: { type: "file", originalName: "first.md" },
      createdAt: "2026-08-30T00:00:00.000Z",
      updatedAt: "2026-08-31T00:00:00.000Z"
    };
    const second = { ...first, relativePath: "materials/documents/second.md", title: "Second material", source: { type: "file", originalName: "second.md" } };
    let resolveFirst!: (value: unknown) => void;
    const firstRead = new Promise((resolve) => { resolveFirst = resolve; });
    installApi({
      listProjectMaterials: vi.fn(async () => [first, second]),
      readProjectMaterial: vi.fn((input: { relativePath: string }) => input.relativePath === first.relativePath
        ? firstRead
        : Promise.resolve({ material: second, content: "# Second content", truncated: false }))
    });

    renderWithAi(<ProjectMaterialsPanel project={project} createRequested={false} onCreateHandled={vi.fn()} onCreateTask={vi.fn()} onChanged={vi.fn()} />);
    fireEvent.click(await screen.findByRole("button", { name: /Second material/ }));
    expect(await screen.findByRole("heading", { name: "Second material" })).toBeTruthy();

    await act(async () => {
      resolveFirst({ material: first, content: "# First content", truncated: false });
      await firstRead;
    });
    expect(screen.getByRole("heading", { name: "Second material" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "First material" })).toBeNull();
  });

  it.each([false, true])("does not repeatedly read an already selected YouTube material (StrictMode: %s)", async strict => {
    const videoMaterial = {
      projectName: project.name,
      relativePath: "materials/videos/Uny6Lpmjral.video.md",
      title: "YouTube Uny6Lpmjral",
      kind: "video",
      status: "ready",
      source: { type: "url", url: "https://www.youtube.com/watch?v=Uny6Lpmjral" },
      sourceUrl: "https://www.youtube.com/watch?v=Uny6Lpmjral",
      createdAt: "2026-08-30T00:00:00.000Z",
      updatedAt: "2026-08-31T00:00:00.000Z"
    };
    const readProjectMaterial = vi.fn(async () => ({
      material: videoMaterial,
      content: "# YouTube Uny6Lpmjral",
      video: { provider: "youtube", videoId: "Uny6Lpmjral", transcript: [] }
    }));
    installApi({
      listProjectMaterials: vi.fn(async () => [videoMaterial]),
      listProjectOutputs: vi.fn(async () => []),
      readProjectMaterial
    });
    const listHost = document.createElement("div");
    const detailHost = document.createElement("div");
    document.body.append(listHost, detailHost);

    const files = (
      <ProjectFilesPanel
        project={project}
        initialSection="materials"
        initialItem={videoMaterial.relativePath}
        createRequested={null}
        onCreateHandled={vi.fn()}
        onCreateTask={vi.fn()}
        onChanged={vi.fn()}
        listHost={listHost}
        detailHost={detailHost}
      />
    );
    const view = strict
      ? render(<StrictMode><AiProvider initial={snapshot}>{files}<FeedbackHost /></AiProvider></StrictMode>)
      : renderWithAi(files);

    expect(await within(detailHost).findByText("当前链接无法安全内嵌播放")).toBeTruthy();
    await waitFor(() => expect(readProjectMaterial).toHaveBeenCalledTimes(strict ? 2 : 1));

    view.unmount();
    listHost.remove();
    detailHost.remove();
  });

  it("offers rename, move, download and delete per file and hides download for videos", async () => {
    const videoMaterial = {
      projectName: project.name,
      relativePath: "materials/videos/Uny6Lpmjral.video.md",
      title: "YouTube Uny6Lpmjral",
      kind: "video",
      status: "ready",
      source: { type: "url", url: "https://www.youtube.com/watch?v=Uny6Lpmjral" },
      sourceUrl: "https://www.youtube.com/watch?v=Uny6Lpmjral",
      createdAt: "2026-08-30T00:00:00.000Z",
      updatedAt: "2026-08-31T00:00:00.000Z"
    };
    const documentMaterial = {
      projectName: project.name,
      relativePath: "materials/documents/doc.md",
      title: "安全笔记",
      kind: "document",
      status: "ready",
      source: { type: "file", originalName: "doc.md" },
      createdAt: "2026-08-30T00:00:00.000Z",
      updatedAt: "2026-08-31T00:00:00.000Z"
    };
    const report = outputRecord("报告", "outputs/report.md");
    const renameProjectMaterial = vi.fn(async () => ({ ...documentMaterial, title: "新笔记" }));
    const moveProjectOutput = vi.fn(async () => ({ ...report, projectName: "其他项目" }));
    const removeProjectMaterial = vi.fn(async () => true);
    const listProjects = vi.fn(async () => [
      { ...project, status: "active" },
      { ...project, name: "其他项目", status: "active" }
    ]);
    installApi({
      listProjectMaterials: vi.fn(async () => [videoMaterial, documentMaterial]),
      listProjectOutputs: vi.fn(async () => [report]),
      listProjects,
      renameProjectMaterial,
      moveProjectOutput,
      removeProjectMaterial
    });
    const listHost = document.createElement("div");
    const detailHost = document.createElement("div");
    document.body.append(listHost, detailHost);

    const view = renderWithAi(
      <ProjectFilesPanel
        project={project}
        initialSection="materials"
        createRequested={null}
        onCreateHandled={vi.fn()}
        onCreateTask={vi.fn()}
        onChanged={vi.fn()}
        listHost={listHost}
        detailHost={detailHost}
      />
    );

    await within(listHost).findByText("安全笔记");

    const videoMenuButton = within(listHost).getByRole("button", { name: "文件操作：YouTube Uny6Lpmjral" });
    fireEvent.click(videoMenuButton);
    const videoMenu = await screen.findByRole("menu", { name: "YouTube Uny6Lpmjral的文件操作" });
    expect(within(videoMenu).queryByRole("menuitem", { name: "下载" })).toBeNull();
    for (const label of ["重命名", "移动到其他项目", "删除"]) {
      expect(within(videoMenu).getByRole("menuitem", { name: label })).toBeTruthy();
    }
    fireEvent.click(videoMenuButton);

    fireEvent.click(within(listHost).getByRole("button", { name: "文件操作：安全笔记" }));
    const documentMenu = await screen.findByRole("menu", { name: "安全笔记的文件操作" });
    expect(within(documentMenu).getByRole("menuitem", { name: "下载" })).toBeTruthy();
    fireEvent.click(within(documentMenu).getByRole("menuitem", { name: "重命名" }));

    const renameDialog = await screen.findByRole("dialog", { name: "重命名" });
    fireEvent.change(within(renameDialog).getByLabelText("名称"), { target: { value: "新笔记" } });
    fireEvent.click(within(renameDialog).getByRole("button", { name: "确认" }));
    await waitFor(() => expect(renameProjectMaterial).toHaveBeenCalledWith({
      projectName: project.name,
      relativePath: documentMaterial.relativePath,
      newTitle: "新笔记"
    }));

    fireEvent.click(await within(listHost).findByRole("button", { name: "文件操作：报告" }));
    const outputMenu = await screen.findByRole("menu", { name: "报告的文件操作" });
    fireEvent.click(within(outputMenu).getByRole("menuitem", { name: "移动到其他项目" }));
    await waitFor(() => expect(listProjects).toHaveBeenCalled());
    const moveDialog = await screen.findByRole("dialog", { name: "移动“报告”" });
    fireEvent.change(within(moveDialog).getByRole("combobox", { name: "目标项目" }), { target: { value: "其他项目" } });
    fireEvent.click(within(moveDialog).getByRole("button", { name: "移动" }));
    await waitFor(() => expect(moveProjectOutput).toHaveBeenCalledWith({
      projectName: project.name,
      relativePath: report.relativePath,
      targetProjectName: "其他项目"
    }));

    fireEvent.click(await within(listHost).findByRole("button", { name: "文件操作：安全笔记" }));
    const deleteMenu = await screen.findByRole("menu", { name: "安全笔记的文件操作" });
    fireEvent.click(within(deleteMenu).getByRole("menuitem", { name: "删除" }));
    const confirm = await screen.findByRole("alertdialog", { name: "删除文件" });
    fireEvent.click(within(confirm).getByRole("button", { name: "删除" }));
    await waitFor(() => expect(removeProjectMaterial).toHaveBeenCalledWith({
      projectName: project.name,
      relativePath: documentMaterial.relativePath
    }));

    view.unmount();
    listHost.remove();
    detailHost.remove();
  });

  it("moves transcript views below the video when the material canvas crosses its own width breakpoint", async () => {
    let resizeCallback: ResizeObserverCallback | null = null;
    let resizeTarget: Element | null = null;
    class MockResizeObserver {
      constructor(callback: ResizeObserverCallback) { resizeCallback = callback; }
      observe(target: Element) { resizeTarget = target; }
      disconnect() { /* no-op */ }
      unobserve() { /* no-op */ }
    }
    vi.stubGlobal("ResizeObserver", MockResizeObserver);
    const videoMaterial = {
      projectName: project.name,
      relativePath: "materials/videos/responsive.video.md",
      title: "响应式视频",
      kind: "video",
      status: "ready",
      source: { type: "url", url: "https://www.youtube.com/watch?v=Uny6Lpmjral" },
      sourceUrl: "https://www.youtube.com/watch?v=Uny6Lpmjral",
      createdAt: "2026-08-30T00:00:00.000Z",
      updatedAt: "2026-08-31T00:00:00.000Z"
    };
    installApi({
      listProjectMaterials: vi.fn(async () => [videoMaterial]),
      readProjectMaterial: vi.fn(async () => ({
        material: videoMaterial,
        content: "",
        video: {
          provider: "youtube",
          videoId: "Uny6Lpmjral",
          durationMs: 60_000,
          transcript: [{ startMs: 7_000, endMs: 18_000, text: "responsive transcript" }]
        }
      }))
    });
    const view = renderWithAi(<ProjectMaterialsPanel project={project} initialMaterialPath={videoMaterial.relativePath} createRequested={false} onCreateHandled={vi.fn()} onCreateTask={vi.fn()} onChanged={vi.fn()} />);

    try {
      expect((await screen.findAllByText("responsive transcript")).length).toBeGreaterThanOrEqual(1);
      const layout = document.querySelector(".project-video-layout") as HTMLElement;
      expect(layout.classList.contains("layout-split")).toBe(true);
      expect(screen.getByText("responsive transcript")).toBeTruthy();

      act(() => resizeCallback?.([{
        target: resizeTarget!,
        contentRect: { width: 719 },
        contentBoxSize: [{ inlineSize: 719 }],
        borderBoxSize: [{ inlineSize: 719 }]
      } as unknown as ResizeObserverEntry], {} as ResizeObserver));
      await waitFor(() => expect(layout.classList.contains("layout-stacked")).toBe(true));
      expect(screen.getByText("responsive transcript")).toBeTruthy();

      act(() => resizeCallback?.([{
        target: resizeTarget!,
        contentRect: { width: 720 },
        contentBoxSize: [{ inlineSize: 720 }],
        borderBoxSize: [{ inlineSize: 720 }]
      } as unknown as ResizeObserverEntry], {} as ResizeObserver));
      await waitFor(() => expect(layout.classList.contains("layout-split")).toBe(true));
      expect(screen.getByText("responsive transcript")).toBeTruthy();
      expect(screen.queryByRole("tab", { name: "摘录" })).toBeNull();
      expect(screen.queryByRole("tab", { name: "章节视图" })).toBeNull();
      expect(screen.queryByRole("tab", { name: "描述" })).toBeNull();
    } finally {
      view.unmount();
      vi.unstubAllGlobals();
    }
  });
});

describe("Project material creation", () => {
  it("shows file upload and URL input together in the add-material dialog", async () => {
    installApi({ listProjectMaterials: vi.fn(async () => []) });
    renderWithAi(<ProjectMaterialsPanel project={project} createRequested onCreateHandled={vi.fn()} onCreateTask={vi.fn()} onChanged={vi.fn()} />);

    const dialog = await screen.findByRole("dialog", { name: "添加资料" });
    expect(within(dialog).getByRole("button", { name: "上传文件" })).toBeTruthy();
    expect(within(dialog).getByRole("textbox", { name: "资料 URL" })).toBeTruthy();
    expect(within(dialog).getByRole("button", { name: "添加链接" })).toBeTruthy();
    expect(within(dialog).getByText("0/50")).toBeTruthy();
    expect(within(dialog).queryByRole("tablist", { name: "资料来源" })).toBeNull();
    expect(within(dialog).queryByRole("button", { name: "取消" })).toBeNull();
  });

  it("opens the existing file picker from the upload area", async () => {
    const addProjectFiles = vi.fn(async () => []);
    installApi({ listProjectMaterials: vi.fn(async () => []), addProjectFiles });
    renderWithAi(<ProjectMaterialsPanel project={project} createRequested onCreateHandled={vi.fn()} onCreateTask={vi.fn()} onChanged={vi.fn()} />);

    fireEvent.click(await screen.findByRole("button", { name: "上传文件" }));
    await waitFor(() => expect(addProjectFiles).toHaveBeenCalledWith({ projectName: project.name }));
  });

  it("keeps the add-material dialog open when the native file picker is canceled", async () => {
    // 主进程在用户取消原生选择器时返回空数组；对话框必须保持打开。
    const addProjectFiles = vi.fn(async () => []);
    installApi({ listProjectMaterials: vi.fn(async () => []), addProjectFiles });
    renderWithAi(<ProjectMaterialsPanel project={project} createRequested onCreateHandled={vi.fn()} onCreateTask={vi.fn()} onChanged={vi.fn()} />);

    fireEvent.click(await screen.findByRole("button", { name: "上传文件" }));
    await waitFor(() => expect(addProjectFiles).toHaveBeenCalledWith({ projectName: project.name }));
    const dialog = screen.getByRole("dialog", { name: "添加资料" });
    expect(within(dialog).getByRole("button", { name: "上传文件" })).toBeTruthy();
    expect(within(dialog).getByRole("button", { name: "上传文件" }).getAttribute("disabled")).toBeNull();
  });

  it("adds dropped files through their resolved local paths", async () => {
    const addProjectFiles = vi.fn(async () => []);
    installApi({
      listProjectMaterials: vi.fn(async () => []),
      addProjectFiles,
      pathForFile: vi.fn((file: File) => `/tmp/${file.name}`)
    });
    renderWithAi(<ProjectMaterialsPanel project={project} createRequested onCreateHandled={vi.fn()} onCreateTask={vi.fn()} onChanged={vi.fn()} />);

    const dropzone = await screen.findByRole("button", { name: "上传文件" });
    fireEvent.drop(dropzone, { dataTransfer: { files: [new File(["x"], "a.pdf"), new File(["y"], "b.md")] } });
    await waitFor(() => expect(addProjectFiles).toHaveBeenCalledWith({ projectName: project.name, filePaths: ["/tmp/a.pdf", "/tmp/b.md"] }));
  });

  it("adds the entered URL through the existing material API", async () => {
    const linkedMaterial = {
      projectName: project.name,
      relativePath: "materials/example.md",
      title: "示例网页",
      kind: "web",
      status: "ready",
      source: { type: "url", url: "https://example.com" },
      sourceUrl: "https://example.com",
      createdAt: "2026-08-30T00:00:00.000Z",
      updatedAt: "2026-08-31T00:00:00.000Z"
    };
    const addProjectUrl = vi.fn(async () => linkedMaterial);
    installApi({ listProjectMaterials: vi.fn(async () => []), addProjectUrl });
    renderWithAi(<ProjectMaterialsPanel project={project} createRequested onCreateHandled={vi.fn()} onCreateTask={vi.fn()} onChanged={vi.fn()} />);

    fireEvent.change(await screen.findByRole("textbox", { name: "资料 URL" }), { target: { value: "https://example.com" } });
    fireEvent.click(screen.getByRole("button", { name: "添加链接" }));
    await waitFor(() => expect(addProjectUrl).toHaveBeenCalledWith({ projectName: project.name, url: "https://example.com" }));
  });

  it.each([false, true])("adds every pasted link separated by spaces or new lines (duplicates: %s)", async repeated => {
    const linkedMaterial = {
      projectName: project.name,
      relativePath: "materials/example.md",
      title: "示例网页",
      kind: "web",
      status: "ready",
      source: { type: "url", url: "https://example.com" },
      sourceUrl: "https://example.com",
      createdAt: "2026-08-30T00:00:00.000Z",
      updatedAt: "2026-08-31T00:00:00.000Z"
    };
    const addProjectUrl = vi.fn(async () => linkedMaterial);
    installApi({ listProjectMaterials: vi.fn(async () => []), addProjectUrl });
    renderWithAi(<ProjectMaterialsPanel project={project} createRequested onCreateHandled={vi.fn()} onCreateTask={vi.fn()} onChanged={vi.fn()} />);

    fireEvent.change(
      await screen.findByRole("textbox", { name: "资料 URL" }),
      { target: { value: repeated
        ? "https://example.com/a https://youtu.be/xyz\nhttps://youtu.be/xyz 不是链接"
        : "https://example.com/a https://youtu.be/xyz\nhttps://example.com/b 不是链接" } }
    );
    expect(screen.getByText("3/50")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "添加链接" }));
    await waitFor(() => expect(addProjectUrl).toHaveBeenCalledTimes(3));
    expect(addProjectUrl).toHaveBeenCalledWith({ projectName: project.name, url: "https://youtu.be/xyz" });
    expect(addProjectUrl).toHaveBeenNthCalledWith(3, { projectName: project.name, url: repeated ? "https://youtu.be/xyz" : "https://example.com/b" });
  });
});
