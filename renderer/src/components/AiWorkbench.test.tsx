import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AiSession, AiSnapshot, ApprovalRequest, DesktopApi } from "@shared/contracts";
import { AiProvider } from "../ai-context";
import { AiSessionNavigation, AiWorkbench } from "./AiWorkbench";
import { FILE_PREVIEW_LAYOUT_STORAGE_KEY } from "../features/ai-console/file-preview-layout";

const sessions: AiSession[] = [
  {
    schemaVersion: 1,
    id: "failed-session",
    projectId: "project",
    projectRoot: "/project",
    provider: "claude",
    providerId: "claude-native",
    providerSessionId: null,
    cwd: "/project",
    title: "失败会话也显示",
    permissionProfile: "edit",
    status: "failed",
    pinned: false,
    archived: false,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-02T00:00:00.000Z",
    lastRunId: null
  },
  {
    schemaVersion: 1,
    id: "archived-session",
    projectId: "project",
    projectRoot: "/project",
    provider: "codex",
    providerId: "codex-native",
    providerSessionId: null,
    cwd: ".",
    title: "归档会话也显示",
    permissionProfile: "edit",
    status: "idle",
    pinned: false,
    archived: true,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    lastRunId: null
  }
];

const snapshot: AiSnapshot = {
  projectRoot: "/project",
  providers: [],
  sessions,
  runs: [],
  pendingApprovals: []
};

beforeEach(() => {
  window.matchMedia = (() => ({
    matches: false,
    media: "",
    onchange: null,
    addListener: () => undefined,
    removeListener: () => undefined,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    dispatchEvent: () => true
  })) as typeof window.matchMedia;
  window.cctools = {
    aiRefresh: async () => snapshot,
    aiGetEvents: async () => [],
    onAiEvent: () => () => undefined
  } as unknown as DesktopApi;
});

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

describe("AI workbench session list", () => {
  it("shows compact two-column sessions", async () => {
    const user = userEvent.setup();
    render(<AiProvider initial={snapshot}><AiSessionNavigation /><AiWorkbench /></AiProvider>);

    expect(screen.getAllByText("失败会话也显示").length).toBeGreaterThan(0);
    expect(screen.getByText("归档会话也显示")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /运行中|待审批|失败|已归档/ })).toBeNull();
    expect(screen.queryByLabelText("按 Provider 筛选")).toBeNull();
    const sessionList = screen.getByRole("listbox", { name: /AI/ });
    const firstSession = within(sessionList).getAllByRole("option")[0];
    expect(within(firstSession).queryByText("最近更新")).toBeNull();
    // SessionItem 已简化为与侧栏一致的简洁样式，不再显示 provider 标签
    expect(within(firstSession).queryByText("Claude Code")).toBeNull();

    await user.click(screen.getByText("归档会话也显示"));
    await waitFor(() => expect(screen.getByRole("heading", { name: /归档会话/ })).toBeTruthy());
    expect(screen.queryByText(/已归档/)).toBeNull();

  });

  it("session items use simplified selection style matching sidebar", async () => {
    render(<AiProvider initial={snapshot}><AiSessionNavigation /></AiProvider>);

    const sessionList = screen.getByRole("listbox", { name: /AI/ });
    const firstSession = within(sessionList).getAllByRole("option")[0];
    // 简化后：会话项内无操作按钮（pin/overflow menu），仅标题 + 时间
    expect(within(firstSession).queryByRole("button")).toBeNull();
    expect(within(firstSession).queryByLabelText(/置顶|重命名|归档|删除/)).toBeNull();
  });

  it("shows 等待批准 when the session has a pending approval", () => {
    const activeSession = { ...sessions[0], status: "idle" as const };
    const approval: ApprovalRequest = {
      id: "approval-1",
      runId: "run-1",
      sessionId: activeSession.id,
      providerRequestId: "provider-1",
      category: "command",
      title: "运行测试",
      detail: "",
      command: "npm test",
      paths: [],
      cwd: "/project",
      createdAt: "2026-01-02T00:00:00.000Z",
      status: "pending"
    };
    render(
      <AiProvider initial={{ ...snapshot, sessions: [activeSession], pendingApprovals: [approval] }}>
        <AiSessionNavigation />
      </AiProvider>
    );

    const sessionList = screen.getByRole("listbox", { name: /AI/ });
    const item = within(sessionList).getByRole("option");
    expect(within(item).getByText("等待批准").classList.contains("waiting-approval")).toBe(true);
  });

  it("moves focus through recent sessions with arrow, Home, and End keys", () => {
    render(<AiProvider initial={snapshot}><AiSessionNavigation /></AiProvider>);
    const sessionList = screen.getByRole("listbox", { name: /AI/ });
    const options = within(sessionList).getAllByRole("option");
    options[0].focus();
    fireEvent.keyDown(sessionList, { key: "ArrowDown" });
    expect(document.activeElement).toBe(options[1]);
    fireEvent.keyDown(sessionList, { key: "Home" });
    expect(document.activeElement).toBe(options[0]);
    fireEvent.keyDown(sessionList, { key: "End" });
    expect(document.activeElement).toBe(options.at(-1));
    fireEvent.keyDown(sessionList, { key: "ArrowUp" });
    expect(document.activeElement).toBe(options[0]);
  });

  it("opens a local file reference in the right preview pane", async () => {
    const user = userEvent.setup();
    const activeSession = { ...sessions[0], status: "idle" as const, lastRunId: "run-1" };
    const previewSnapshot: AiSnapshot = {
      ...snapshot,
      sessions: [activeSession],
      runs: [{
        schemaVersion: 1,
        id: "run-1",
        sessionId: activeSession.id,
        projectId: "project",
        provider: "claude",
        providerId: "claude-native",
        permissionProfile: "edit",
        status: "completed",
        prompt: "生成文稿",
        contexts: [],
        turnContext: null,
        workspacePath: null,
        baseCommit: null,
        startedAt: "2026-01-01T00:00:00.000Z",
        completedAt: "2026-01-01T00:00:10.000Z",
        error: null,
        changeSet: null,
        risks: []
      }],
      pendingApprovals: []
    };
    const readContent = vi.fn(async (path: string) => ({
      path,
      name: "demo.md",
      ext: ".md",
      content: "# 预览标题\n\n右侧文件内容"
    }));
    const writeContent = vi.fn(async (path: string, content: string) => ({
      path,
      name: "demo.md",
      ext: ".md",
      content,
      truncated: false
    }));
    window.cctools = {
      ...window.cctools,
      aiRefresh: async () => previewSnapshot,
      aiGetEvents: async () => [{
        schemaVersion: 1,
        id: "answer",
        seq: 1,
        timestamp: "2026-01-01T00:00:10.000Z",
        projectId: "project",
        sessionId: activeSession.id,
        runId: "run-1",
        provider: "claude",
        kind: "assistant-message",
        payload: { text: "文件：`mymind/article/demo.md`" },
        risks: []
      }],
      readContent,
      writeContent
    } as unknown as DesktopApi;
    window.localStorage.setItem(FILE_PREVIEW_LAYOUT_STORAGE_KEY, JSON.stringify({ schemaVersion: 1, ratio: 0.62 }));

    render(<AiProvider initial={previewSnapshot}><AiSessionNavigation /><AiWorkbench /></AiProvider>);

    await user.click(await screen.findByTitle("预览 mymind/article/demo.md"));
    await waitFor(() => expect(readContent).toHaveBeenCalledWith("mymind/article/demo.md"));
    const previewPane = await screen.findByRole("complementary", { name: "文件预览" });
    expect(screen.getByText("空闲")).toBeTruthy();
    expect(previewPane).toBeTruthy();
    expect(screen.getByRole("heading", { name: "预览标题" })).toBeTruthy();

    const previewSeparator = screen.getByRole("separator", { name: "文件预览宽度" });
    expect(previewSeparator.getAttribute("aria-valuemin")).toBe("34");
    expect(previewSeparator.getAttribute("aria-valuemax")).toBe("70");
    expect(previewSeparator.getAttribute("aria-valuenow")).toBe("62");
    fireEvent.keyDown(previewSeparator, { key: "ArrowLeft" });
    expect(Number(previewSeparator.getAttribute("aria-valuenow"))).toBeGreaterThan(62);
    await waitFor(() => {
      const stored = JSON.parse(window.localStorage.getItem(FILE_PREVIEW_LAYOUT_STORAGE_KEY) || "null") as { schemaVersion?: number; ratio?: number } | null;
      expect(stored?.schemaVersion).toBe(1);
      expect(stored?.ratio).toBeGreaterThan(0.62);
    });
    fireEvent.keyDown(previewSeparator, { key: "Home" });
    expect(previewSeparator.getAttribute("aria-valuenow")).toBe("56");

    const modeToggle = within(previewPane).getByRole("toolbar", { name: "文件查看模式" });
    await user.click(within(modeToggle).getByRole("button", { name: "编辑文件" }));
    const editor = within(previewPane).getByLabelText("编辑文件内容");
    await user.clear(editor);
    await user.type(editor, "# 新标题\n\n编辑后的内容");
    await user.click(within(previewPane).getByRole("button", { name: /保存/ }));
    await waitFor(() => expect(writeContent).toHaveBeenCalledWith("mymind/article/demo.md", expect.stringContaining("编辑后的内容")));
    await user.click(within(modeToggle).getByRole("button", { name: "预览" }));
    expect(await screen.findByRole("heading", { name: "新标题" })).toBeTruthy();

    const workbench = previewPane.closest(".ai-workbench") as HTMLElement;
    await user.click(screen.getByRole("button", { name: "关闭文件预览" }));
    expect(workbench.classList.contains("preview-leaving")).toBe(true);
    expect(previewPane.getAttribute("aria-hidden")).toBe("true");
    expect(screen.queryByRole("complementary", { name: "文件预览" })).toBeNull();
    await waitFor(() => expect(workbench.classList.contains("with-file-preview")).toBe(false));
  });

  it("shows a friendly preview error when the file no longer exists", async () => {
    const user = userEvent.setup();
    const activeSession = { ...sessions[0], status: "idle" as const, lastRunId: "run-1" };
    const previewSnapshot: AiSnapshot = {
      ...snapshot,
      sessions: [activeSession],
      runs: [{
        schemaVersion: 1,
        id: "run-1",
        sessionId: activeSession.id,
        projectId: "project",
        provider: "claude",
        providerId: "claude-native",
        permissionProfile: "edit",
        status: "completed",
        prompt: "打开文件",
        contexts: [],
        turnContext: null,
        workspacePath: null,
        baseCommit: null,
        startedAt: "2026-01-01T00:00:00.000Z",
        completedAt: "2026-01-01T00:00:10.000Z",
        error: null,
        changeSet: null,
        risks: []
      }],
      pendingApprovals: []
    };
    const readContent = vi.fn(async () => {
      throw new Error("ENOENT: no such file or directory");
    });
    window.cctools = {
      ...window.cctools,
      aiRefresh: async () => previewSnapshot,
      aiGetEvents: async () => [{
        schemaVersion: 1,
        id: "answer",
        seq: 1,
        timestamp: "2026-01-01T00:00:10.000Z",
        projectId: "project",
        sessionId: activeSession.id,
        runId: "run-1",
        provider: "claude",
        kind: "assistant-message",
        payload: { text: "文件：`mymind/article/missing.md`" },
        risks: []
      }],
      readContent
    } as unknown as DesktopApi;

    render(<AiProvider initial={previewSnapshot}><AiSessionNavigation /><AiWorkbench /></AiProvider>);

    await user.click(await screen.findByTitle("预览 mymind/article/missing.md"));
    await waitFor(() => expect(readContent).toHaveBeenCalledWith("mymind/article/missing.md"));
    expect(await screen.findByText("文件不存在或者已经删除")).toBeTruthy();
  });
});
