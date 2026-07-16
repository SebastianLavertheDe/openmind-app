import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AiSnapshot, DesktopApi } from "@shared/contracts";
import { AiProvider } from "../ai-context";
import { ResponsiveLayoutProvider } from "../app/responsive-layout";
import { AiSidebar } from "./AiSidebar";

const snapshot: AiSnapshot = {
  projectRoot: "/project",
  providers: [{ id: "codex-native", provider: "codex", label: "Codex", runtime: "native", available: true, version: "1", supportsApprovals: true, supportsResume: true, supportsImages: true, diagnostic: null, detectedModel: null, contextWindow: null, oneMillion: false }],
  sessions: [{
    schemaVersion: 1, id: "sess-1", projectId: "p", projectRoot: "/project", title: "我的会话",
    provider: "codex", providerId: "codex-native", providerSessionId: null, cwd: ".", permissionProfile: "edit",
    status: "idle", pinned: false, archived: false, createdAt: "2026-07-07T00:00:00.000Z", updatedAt: "2026-07-07T00:00:00.000Z", lastRunId: null
  }],
  runs: [],
  pendingApprovals: []
};

function installApi() {
  window.cctools = {
    aiRefresh: async () => snapshot,
    aiGetEvents: async () => [],
    aiCancelRun: async () => true,
    aiResolveApproval: async () => true,
    aiListTurns: async () => ({ data: [], nextCursor: null, total: 0, parseErrors: 0 }),
    runSkill: vi.fn(async () => true),
    selectFiles: async () => [],
    selectMymindFiles: async () => [],
    searchMymindFiles: async () => ({ items: [], indexedCount: 0, truncated: false }),
    openPath: vi.fn(async (p: string) => p),
    revealPath: async () => true,
    onAiEvent: () => () => {},
    onSkillEvent: () => () => {}
  } as unknown as DesktopApi;
}

beforeEach(() => {
  installApi();
  // expand the sidebar by default so the <aside> renders (panelMode reads this key on mount)
  window.localStorage.setItem("cctools.ai.panel-mode.v1", JSON.stringify("default"));
});

afterEach(() => {
  window.localStorage.clear();
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

  it("persists sidebar widths to localStorage on mount", () => {
    renderSidebar();
    expect(JSON.parse(window.localStorage.getItem("cctools.ai.sidebar-widths.v1") || "null")).toEqual({
      schemaVersion: 1,
      widths: { default: 420, wide: 760 }
    });
  });

  it("migrates legacy widths and clamps persisted values to the supported schema", () => {
    window.localStorage.setItem("cctools.ai.sidebar-widths.v1", JSON.stringify({ default: 2_000, wide: 100 }));
    renderSidebar();

    expect(JSON.parse(window.localStorage.getItem("cctools.ai.sidebar-widths.v1") || "null")).toEqual({
      schemaVersion: 1,
      widths: { default: 960, wide: 380 }
    });
  });

  it("rejects damaged or unknown width schemas", () => {
    window.localStorage.setItem("cctools.ai.sidebar-widths.v1", JSON.stringify({
      schemaVersion: 99,
      widths: { default: 640, wide: 800 }
    }));
    renderSidebar();

    expect(JSON.parse(window.localStorage.getItem("cctools.ai.sidebar-widths.v1") || "null")).toEqual({
      schemaVersion: 1,
      widths: { default: 420, wide: 760 }
    });
  });

  it("rejects damaged values inside the current width schema", () => {
    window.localStorage.setItem("cctools.ai.sidebar-widths.v1", JSON.stringify({
      schemaVersion: 1,
      widths: { default: "broken", wide: 800 }
    }));
    renderSidebar();

    expect(JSON.parse(window.localStorage.getItem("cctools.ai.sidebar-widths.v1") || "null")).toEqual({
      schemaVersion: 1,
      widths: { default: 420, wide: 760 }
    });
  });

  it("resets both modes to their real defaults and exposes separator values", () => {
    const originalWidth = window.innerWidth;
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 2_200 });
    window.localStorage.setItem("cctools.ai.sidebar-widths.v1", JSON.stringify({ default: 600, wide: 900 }));
    try {
      renderSidebar();
      let separator = screen.getByRole("separator", { name: /AI 侧栏宽度/ });
      expect(separator.getAttribute("aria-valuemin")).toBe("380");
      expect(separator.getAttribute("aria-valuemax")).toBe("960");
      expect(separator.getAttribute("aria-valuenow")).toBe("600");

      fireEvent.doubleClick(separator);
      expect(separator.getAttribute("aria-valuenow")).toBe("420");
      fireEvent.keyDown(separator, { key: "ArrowLeft" });
      expect(separator.getAttribute("aria-valuenow")).toBe("440");
      fireEvent.keyDown(separator, { key: "Home" });
      expect(separator.getAttribute("aria-valuenow")).toBe("420");

      fireEvent.click(screen.getByRole("button", { name: /切换宽屏/ }));
      separator = screen.getByRole("separator", { name: /AI 侧栏宽度/ });
      expect(separator.getAttribute("aria-valuenow")).toBe("900");
      fireEvent.doubleClick(separator);
      expect(separator.getAttribute("aria-valuenow")).toBe("760");
    } finally {
      Object.defineProperty(window, "innerWidth", { configurable: true, value: originalWidth });
    }
  });

  it("restores the actual drag-start width on Escape and disables shell transition while dragging", () => {
    const originalWidth = window.innerWidth;
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 2_200 });
    window.localStorage.setItem("cctools.ai.sidebar-widths.v1", JSON.stringify({ default: 600, wide: 760 }));
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
      expect(separator.getAttribute("aria-valuenow")).toBe("700");
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
});
