import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useEffect } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AiSnapshot, DesktopApi } from "@shared/contracts";
import { AiProvider, useAi } from "../ai-context";
import { ResponsiveLayoutProvider } from "../app/responsive-layout";
import { AiSidebar } from "./AiSidebar";

const snapshot: AiSnapshot = {
  projectRoot: "/project",
  providers: [{ id: "codex-native", provider: "codex", label: "Codex", runtime: "native", available: true, version: "1", supportsApprovals: true, supportsResume: true, supportsImages: true, diagnostic: null, detectedModel: null, contextWindow: null, installable: false, oneMillion: false }],
  sessions: [{
    schemaVersion: 1, id: "sess-1", projectId: "p", scope: { type: "workspace" }, projectRoot: "/project", title: "我的会话",
    provider: "codex", providerId: "codex-native", providerSessionId: null, cwd: ".", permissionProfile: "edit",
    status: "idle", pinned: false, archived: false, createdAt: "2026-07-07T00:00:00.000Z", updatedAt: "2026-07-07T00:00:00.000Z", lastRunId: null
  }],
  runs: [],
  pendingApprovals: []
};

function installApi() {
  window.openmind = {
    aiRefresh: async () => snapshot,
    aiGetEvents: async () => [],
    aiCancelRun: async () => true,
    aiResolveApproval: async () => true,
    aiListTurns: async () => ({ data: [], nextCursor: null, total: 0, parseErrors: 0 }),
    runSkill: vi.fn(async () => true),
    selectFiles: async () => [],
    selectOpenmindFiles: async () => [],
    searchOpenmindFiles: async () => ({ items: [], indexedCount: 0, truncated: false }),
    openPath: vi.fn(async (p: string) => p),
    revealPath: async () => true,
    onAiEvent: () => () => {},
    onSkillEvent: () => () => {}
  } as unknown as DesktopApi;
}

beforeEach(() => {
  installApi();
  // expand the sidebar by default so the <aside> renders (panelMode reads this key on mount)
  window.localStorage.setItem("openmind.ai.panel-mode.v1", JSON.stringify("default"));
});

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  document.documentElement.style.removeProperty("--ai-sidebar-preferred-width");
  document.documentElement.style.removeProperty("--ai-workspace-min-width");
});

function renderSidebar() {
  const openWorkbench = vi.fn();
  render(<AiProvider initial={snapshot}><AiSidebar openWorkbench={openWorkbench} /></AiProvider>);
  return { openWorkbench };
}

describe("AiSidebar", () => {
  it("renders the active session title and header actions", () => {
    const { openWorkbench } = renderSidebar();
    // the title appears in the sidebar header <strong> (and again as a select option)
    expect(screen.getAllByText("我的会话").length).toBeGreaterThanOrEqual(1);
    const wb = screen.getByRole("button", { name: /在 AI 工作台打开/ });
    fireEvent.click(wb);
    expect(openWorkbench).toHaveBeenCalled();
  });

  it("lists non-archived sessions in the session switcher and offers a new-draft option", () => {
    renderSidebar();
    const select = screen.getByRole("combobox", { name: /切换 AI 会话/ }) as HTMLSelectElement;
    const options = Array.from(select.options).map((o) => o.textContent);
    expect(options).toContain("我的会话");
    expect(options).toContain("新会话草稿");
  });

  it("does not expose Project Task sessions in the global session switcher", () => {
    const projectSession = {
      ...snapshot.sessions[0],
      id: "project-session",
      title: "项目内部会话",
      scope: { type: "project-task" as const, projectId: "5a111111-1111-4111-8111-111111111111", projectName: "AI 安全", taskId: "task-1" }
    };
    render(
      <AiProvider initial={{ ...snapshot, sessions: [projectSession, snapshot.sessions[0]] }}>
        <AiSidebar openWorkbench={vi.fn()} />
      </AiProvider>
    );
    const select = screen.getByRole("combobox", { name: /切换 AI 会话/ }) as HTMLSelectElement;
    const options = Array.from(select.options).map((option) => option.textContent);
    expect(options).toContain("我的会话");
    expect(options).not.toContain("项目内部会话");
  });

  it("renders readable custom session options inside the sidebar header", () => {
    renderSidebar();
    fireEvent.click(screen.getByRole("button", { name: /切换 AI 会话.*下拉菜单/ }));

    const listbox = screen.getByRole("listbox", { name: /切换 AI 会话/ });
    const option = within(listbox).getByRole("option", { name: "我的会话" });
    expect(option.querySelector(".ui-select-option-label")?.textContent).toBe("我的会话");
  });

  it("toggles wide mode via the toggleWide button", () => {
    renderSidebar();
    const wideBtn = screen.getByRole("button", { name: /切换宽屏/ });
    fireEvent.click(wideBtn);
    fireEvent.click(wideBtn);
  });

  it("treats fullscreen as a focus-contained modal over the whole shell", async () => {
    render(
      <AiProvider initial={snapshot}>
        <div data-testid="covered-workspace"><button>工作区操作</button></div>
        <AiSidebar openWorkbench={vi.fn()} />
      </AiProvider>
    );
    const fullscreenBtn = screen.getByRole("button", { name: /全屏/ });
    fireEvent.click(fullscreenBtn);

    const dialog = screen.getByRole("dialog", { name: "AI Assistant" });
    expect(dialog.classList.contains("mode-full")).toBe(true);
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    await waitFor(() => expect((screen.getByTestId("covered-workspace") as HTMLElement).inert).toBe(true));

    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "AI Assistant" })).toBeNull());
    expect((screen.getByTestId("covered-workspace") as HTMLElement).inert).toBe(false);
  });

  it("does not restore stale background isolation over a newer responsive state", async () => {
    render(
      <AiProvider initial={snapshot}>
        <div data-testid="responsive-workspace" inert={true} aria-hidden="true">
          <button>Workspace action</button>
        </div>
        <AiSidebar openWorkbench={vi.fn()} />
      </AiProvider>
    );
    fireEvent.click(screen.getByRole("button", { name: /\u5168\u5c4f/ }));

    const workspace = screen.getByTestId("responsive-workspace") as HTMLElement;
    await waitFor(() => expect(workspace.inert).toBe(true));

    // Simulate a breakpoint render taking ownership while the modal effect is
    // still active. Its cleanup must not reapply the captured compact state.
    workspace.inert = false;
    workspace.removeAttribute("aria-hidden");
    fireEvent.keyDown(document, { key: "Escape" });

    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "AI Assistant" })).toBeNull();
      expect(workspace.inert).toBe(false);
      expect(workspace.getAttribute("aria-hidden")).toBeNull();
    });
  });

  it("collapses to the rail via the collapse button", () => {
    renderSidebar();
    fireEvent.click(screen.getByRole("button", { name: /收起/ }));
    expect(screen.getByRole("button", { name: /展开 AI 侧栏/ })).toBeTruthy();
  });

  it("persists adaptive sidebar ratios to localStorage on mount without synchronous resize writes", async () => {
    renderSidebar();
    await waitFor(() => {
      expect(JSON.parse(window.localStorage.getItem("openmind.ai.sidebar-layout.v2") || "null")).toEqual({
        schemaVersion: 1,
        ratios: { default: 1 / 3, wide: 1 / 2 }
      });
    });
  });

  it("migrates legacy fixed widths into container ratios", async () => {
    const originalWidth = window.innerWidth;
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 2_200 });
    window.localStorage.setItem("openmind.ai.sidebar-widths.v1", JSON.stringify({ default: 2_000, wide: 100 }));
    try {
      renderSidebar();
      await waitFor(() => {
        const stored = JSON.parse(window.localStorage.getItem("openmind.ai.sidebar-layout.v2") || "null");
        expect(stored.schemaVersion).toBe(1);
        expect(stored.ratios.default).toBeCloseTo(1_180 / 1_940);
        expect(stored.ratios.wide).toBeCloseTo(380 / 1_940);
      });
    } finally {
      Object.defineProperty(window, "innerWidth", { configurable: true, value: originalWidth });
    }
  });

  it("rejects damaged or unknown adaptive preference schemas", async () => {
    window.localStorage.setItem("openmind.ai.sidebar-layout.v2", JSON.stringify({
      schemaVersion: 99,
      ratios: { default: .4, wide: .6 }
    }));
    renderSidebar();

    await waitFor(() => {
      expect(JSON.parse(window.localStorage.getItem("openmind.ai.sidebar-layout.v2") || "null")).toEqual({
        schemaVersion: 1,
        ratios: { default: 1 / 3, wide: 1 / 2 }
      });
    });
  });

  it("rejects damaged values inside the adaptive preference schema", async () => {
    window.localStorage.setItem("openmind.ai.sidebar-layout.v2", JSON.stringify({
      schemaVersion: 1,
      ratios: { default: "broken", wide: .5 }
    }));
    renderSidebar();

    await waitFor(() => {
      expect(JSON.parse(window.localStorage.getItem("openmind.ai.sidebar-layout.v2") || "null")).toEqual({
        schemaVersion: 1,
        ratios: { default: 1 / 3, wide: 1 / 2 }
      });
    });
  });

  it("resets both modes to their real defaults and exposes separator values", () => {
    const originalWidth = window.innerWidth;
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 2_200 });
    window.localStorage.setItem("openmind.ai.sidebar-layout.v2", JSON.stringify({ schemaVersion: 1, ratios: { default: 600 / 1_940, wide: 900 / 1_940 } }));
    try {
      renderSidebar();
      let separator = screen.getByRole("separator", { name: /AI 侧栏宽度/ });
      expect(separator.getAttribute("aria-valuemin")).toBe("380");
      expect(separator.getAttribute("aria-valuemax")).toBe("1180");
      expect(separator.getAttribute("aria-valuenow")).toBe("600");

      fireEvent.doubleClick(separator);
      expect(separator.getAttribute("aria-valuenow")).toBe("647");
      fireEvent.keyDown(separator, { key: "ArrowLeft" });
      expect(separator.getAttribute("aria-valuenow")).toBe("685");
      fireEvent.keyDown(separator, { key: "Home" });
      expect(separator.getAttribute("aria-valuenow")).toBe("647");

      fireEvent.click(screen.getByRole("button", { name: /切换宽屏/ }));
      separator = screen.getByRole("separator", { name: /AI 侧栏宽度/ });
      expect(separator.getAttribute("aria-valuenow")).toBe("900");
      fireEvent.doubleClick(separator);
      expect(separator.getAttribute("aria-valuenow")).toBe("970");
    } finally {
      Object.defineProperty(window, "innerWidth", { configurable: true, value: originalWidth });
    }
  });

  it("publishes a stable proportional CSS width across native viewport changes", () => {
    const originalWidth = window.innerWidth;
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 2_560 });
    window.localStorage.setItem("openmind.ai.sidebar-layout.v2", JSON.stringify({ schemaVersion: 1, ratios: { default: 1 / 2, wide: 1 / 2 } }));
    try {
      renderSidebar();
      const preferred = document.documentElement.style.getPropertyValue("--ai-sidebar-preferred-width");
      expect(preferred).toBe("calc(50% - 130px)");

      Object.defineProperty(window, "innerWidth", { configurable: true, value: 2_200 });
      fireEvent(window, new Event("resize"));
      expect(document.documentElement.style.getPropertyValue("--ai-sidebar-preferred-width")).toBe(preferred);
    } finally {
      Object.defineProperty(window, "innerWidth", { configurable: true, value: originalWidth });
    }
  });

  it("restores the actual drag-start width on Escape and batches pointer movement per frame", async () => {
    const originalWidth = window.innerWidth;
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 2_200 });
    window.localStorage.setItem("openmind.ai.sidebar-layout.v2", JSON.stringify({ schemaVersion: 1, ratios: { default: 600 / 1_940, wide: 1 / 2 } }));
    try {
      const { container } = render(
        <div className="app-shell">
          <AiProvider initial={snapshot}><AiSidebar openWorkbench={vi.fn()} /></AiProvider>
        </div>
      );
      const shell = container.querySelector(".app-shell") as HTMLElement;
      const separator = screen.getByRole("separator", { name: /AI 侧栏宽度/ });

      const pointerDown = new Event("pointerdown", { bubbles: true });
      Object.defineProperties(pointerDown, {
        button: { value: 0 },
        isPrimary: { value: true },
        pointerId: { value: 1 },
        clientX: { value: 1_000 }
      });
      fireEvent(separator, pointerDown);
      expect(shell.classList.contains("ai-sidebar-resizing")).toBe(true);
      const pointerMove = new Event("pointermove");
      Object.defineProperties(pointerMove, { pointerId: { value: 1 }, clientX: { value: 900 } });
      fireEvent(window, pointerMove);
      await waitFor(() => expect(separator.getAttribute("aria-valuenow")).toBe("700"));
      fireEvent.keyDown(window, { key: "Escape" });
      expect(separator.getAttribute("aria-valuenow")).toBe("600");
      expect(shell.classList.contains("ai-sidebar-resizing")).toBe(false);
    } finally {
      Object.defineProperty(window, "innerWidth", { configurable: true, value: originalWidth });
    }
  });

  it("uses a full-canvas panel without a scrim on compact windows", () => {
    const originalMatchMedia = window.matchMedia;
    window.matchMedia = vi.fn((query: string) => ({
      matches: query.includes("1760px") || query.includes("840px"),
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(() => true),
      addListener: vi.fn(),
      removeListener: vi.fn()
    } as MediaQueryList));

    try {
      const { container } = render(
        <ResponsiveLayoutProvider>
          <AiProvider initial={snapshot}>
            <div>
              <button data-testid="covered-workspace">底层工作区</button>
              <AiSidebar openWorkbench={vi.fn()} />
            </div>
          </AiProvider>
        </ResponsiveLayoutProvider>
      );
      const canvas = screen.getByRole("dialog", { name: "AI Assistant" });
      expect(canvas.classList.contains("layout-companion-canvas")).toBe(true);
      expect(canvas.getAttribute("aria-modal")).toBe("true");
      expect(container.querySelector(".ai-sidebar-scrim")).toBeNull();
      expect(container.querySelector(".ai-sidebar-resizer")).toBeNull();
      expect(screen.queryByRole("button", { name: /切换宽屏/ })).toBeNull();
      expect(screen.queryByRole("button", { name: /^全屏$/ })).toBeNull();
      expect((screen.getByTestId("covered-workspace") as HTMLElement).inert).toBe(true);
      expect(screen.getByTestId("covered-workspace").getAttribute("aria-hidden")).toBe("true");

      fireEvent.keyDown(document, { key: "Escape" });

      expect(screen.getByRole("button", { name: /展开 AI 侧栏/ })).toBeTruthy();
      expect((screen.getByTestId("covered-workspace") as HTMLElement).inert).toBe(false);
      expect(screen.getByTestId("covered-workspace").getAttribute("aria-hidden")).toBeNull();
    } finally {
      window.matchMedia = originalMatchMedia;
    }
  });

  it("keeps the compact companion docked before the full-canvas breakpoint", () => {
    const originalMatchMedia = window.matchMedia;
    window.matchMedia = vi.fn((query: string) => ({
      matches: query.includes("1760px"),
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(() => true),
      addListener: vi.fn(),
      removeListener: vi.fn()
    } as MediaQueryList));

    try {
      const { container } = render(<ResponsiveLayoutProvider><AiProvider initial={snapshot}><AiSidebar openWorkbench={vi.fn()} /></AiProvider></ResponsiveLayoutProvider>);
      expect(container.querySelector(".ai-sidebar")?.classList.contains("layout-companion-compact")).toBe(true);
      expect(container.querySelector(".ai-sidebar-scrim")).toBeNull();
      expect(container.querySelector(".ai-sidebar-resizer")).toBeTruthy();
    } finally {
      window.matchMedia = originalMatchMedia;
    }
  });

  it("routes a new conversation to the open project as a project task instead of a workspace session", async () => {
    const projectTask = {
      projectId: "5a111111-1111-4111-8111-111111111111", projectName: "2", taskId: "task-9", title: "帮我统计资料", providerId: "codex-native", sessionId: null, previousSessionIds: [],
      status: "running", createdAt: "2026-09-05T00:00:00.000Z", updatedAt: "2026-09-05T00:00:00.000Z"
    };
    const projectSession = {
      ...snapshot.sessions[0], id: "project-session-9",
      scope: { type: "project-task" as const, projectId: projectTask.projectId, projectName: "2", taskId: "task-9" }
    };
    const createTask = vi.fn(async () => projectTask);
    const startTaskRun = vi.fn(async () => ({ task: projectTask, session: projectSession, run: { id: "run-9" } }));
    const startRun = vi.fn();
    window.openmind = {
      ...window.openmind,
      createProjectTask: createTask,
      projectStartTaskRun: startTaskRun,
      aiStartRun: startRun
    } as unknown as DesktopApi;
    function TargetSetter() {
      const ai = useAi();
      const setTarget = ai.setProjectComposeTarget;
      const setActiveSession = ai.setActiveSession;
      useEffect(() => {
        setTarget({ projectId: projectTask.projectId, projectName: "2" });
        // AiProvider 挂载时会自动选中首个会话，推迟到其后再清空为新对话草稿
        const timer = setTimeout(() => { void setActiveSession(null); }, 0);
        return () => clearTimeout(timer);
      }, [setTarget, setActiveSession]);
      return null;
    }
    render(
      <AiProvider initial={snapshot}>
        <TargetSetter />
        <AiSidebar openWorkbench={vi.fn()} />
      </AiProvider>
    );

    // 新对话草稿态：占位文案从「继续 …」切回新建文案后再输入
    const textarea = await waitFor(() => {
      const el = screen.getByRole("combobox", { name: "AI 消息" }) as HTMLTextAreaElement;
      if (!el.placeholder.startsWith("描述要整理")) throw new Error("still in continue-session state");
      return el;
    });
    fireEvent.change(textarea, { target: { value: "帮我统计资料\n第二行" } });
    fireEvent.click(screen.getByRole("button", { name: "发送" }));

    await waitFor(() => expect(createTask).toHaveBeenCalledWith({ projectName: "2", title: "帮我统计资料", providerId: "codex-native" }));
    await waitFor(() => expect(startTaskRun).toHaveBeenCalledWith({ projectName: "2", taskId: "task-9", providerId: "codex-native", prompt: "帮我统计资料\n第二行" }));
    expect(startRun).not.toHaveBeenCalled();
  });
});
