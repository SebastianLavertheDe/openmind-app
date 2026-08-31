import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppShell } from "./AppShell";
import { ResponsiveLayoutProvider } from "./responsive-layout";

beforeEach(() => {
  window.openmind = { openPath: vi.fn().mockResolvedValue("") } as never;
});

afterEach(() => cleanup());

describe("AppShell", () => {
  it("renders fixed primary navigation and opens global search", () => {
    const navigate = vi.fn();
    const openSearch = vi.fn();
    const setNavCollapsed = vi.fn();
    render(
      <AppShell
        page="brief"
        navigate={navigate}
        onOpenSearch={openSearch}
        navCollapsed={false}
        setNavCollapsed={setNavCollapsed}
        repoRoot="/repo"
        runtime="linux"
        environment={{ mode: "desktop", platform: "linux" }}
        pendingApprovals={2}
        aiMode="default"
      >
        <div>Brief</div>
      </AppShell>
    );

    expect(screen.getByRole("button", { name: "每日简报" }).getAttribute("aria-current")).toBe("page");
    expect(screen.queryByRole("button", { name: "资料库" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Skills" })).toBeNull();
    expect(screen.getByRole("button", { name: "每日简报" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "新建任务" }));
    expect(navigate).toHaveBeenCalledWith("ai");
    fireEvent.click(within(screen.getByRole("complementary")).getByRole("button", { name: /搜索资料/ }));
    expect(openSearch).toHaveBeenCalled();
  });

  it("collapses navigation with an accessible icon button", () => {
    const setNavCollapsed = vi.fn();
    render(
      <AppShell
        page="brief"
        navigate={vi.fn()}
        onOpenSearch={vi.fn()}
        navCollapsed={false}
        setNavCollapsed={setNavCollapsed}
        repoRoot="/repo"
        runtime="linux"
        environment={{ mode: "desktop", platform: "linux" }}
        pendingApprovals={0}
        aiMode="default"
      >
        <div>Settings</div>
      </AppShell>
    );

    fireEvent.click(screen.getByRole("button", { name: "收起导航" }));
    expect(setNavCollapsed).toHaveBeenCalledWith(true);
  });

  it("uses a dedicated settings shell without the application navigation or toolbar", () => {
    const { container } = render(
      <AppShell
        page="settings"
        navigate={vi.fn()}
        onOpenSearch={vi.fn()}
        navCollapsed={false}
        setNavCollapsed={vi.fn()}
        repoRoot="/repo"
        runtime="linux"
        environment={{ mode: "desktop", platform: "linux" }}
        pendingApprovals={0}
        aiMode="collapsed"
      >
        <div>Settings content</div>
      </AppShell>
    );

    expect(container.querySelector(".app-shell")?.classList.contains("settings-mode")).toBe(true);
    expect(container.querySelector(".app-nav")).toBeNull();
    expect(container.querySelector(".global-toolbar")).toBeNull();
    expect(container.querySelector(".main-area")?.textContent).toContain("Settings content");
  });

  it("exposes one draggable Mica-backed shell on Windows desktop", () => {
    const { container, unmount } = render(
      <AppShell
        page="sources"
        navigate={vi.fn()}
        onOpenSearch={vi.fn()}
        navCollapsed={false}
        setNavCollapsed={vi.fn()}
        repoRoot="/repo"
        runtime="Windows → WSL"
        environment={{ mode: "desktop", platform: "win32" }}
        pendingApprovals={0}
        aiMode="collapsed"
      >
        <div>Sources</div>
      </AppShell>
    );

    expect(container.querySelector(".app-shell")?.classList.contains("window-chrome-mica")).toBe(true);
    expect(container.querySelector(".window-titlebar-drag-region")).not.toBeNull();
    expect(document.documentElement.dataset.windowChrome).toBe("mica");
    unmount();
    expect(document.documentElement.dataset.windowChrome).toBeUndefined();
  });

  it("uses a semantic icon rail before switching to a drawer", () => {
    const originalMatchMedia = window.matchMedia;
    const originalWidth = window.innerWidth;
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 900 });
    window.matchMedia = vi.fn((query: string) => ({
      matches: false,
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
          <AppShell page="creative" navigate={vi.fn()} onOpenSearch={vi.fn()} navCollapsed={false} setNavCollapsed={vi.fn()} repoRoot="/repo" runtime="linux" environment={{ mode: "desktop", platform: "linux" }} pendingApprovals={0} aiMode="collapsed">
            <div>Creative</div>
          </AppShell>
        </ResponsiveLayoutProvider>
      );
      expect(container.querySelector(".app-shell")?.classList.contains("layout-shell-rail")).toBe(true);
      expect(container.querySelector(".app-nav")?.classList.contains("collapsed")).toBe(true);
      expect(container.querySelector(".app-nav")?.getAttribute("aria-hidden")).toBeNull();
      const creative = screen.getByRole("button", { name: "创作" });
      expect(creative.getAttribute("title")).toBeNull();
      fireEvent.focus(creative);
      expect(screen.getByRole("tooltip").textContent).toBe("创作");
      expect(screen.getByRole("tooltip").getAttribute("data-side")).toBe("right");
    } finally {
      window.matchMedia = originalMatchMedia;
      Object.defineProperty(window, "innerWidth", { configurable: true, value: originalWidth });
    }
  });

  it("turns navigation into a focus-contained drawer and restores its trigger", async () => {
    const originalMatchMedia = window.matchMedia;
    window.matchMedia = vi.fn((query: string) => ({
      matches: query.includes("840px"),
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
          <AppShell
            page="creative"
            navigate={vi.fn()}
            onOpenSearch={vi.fn()}
            navCollapsed={true}
            setNavCollapsed={vi.fn()}
            repoRoot="/repo"
            runtime="linux"
            environment={{ mode: "desktop", platform: "linux" }}
            pendingApprovals={0}
            aiMode="collapsed"
          >
            <div>Creative</div>
          </AppShell>
        </ResponsiveLayoutProvider>
      );

      const nav = container.querySelector(".app-nav") as HTMLElement;
      expect(nav.getAttribute("aria-hidden")).toBe("true");
      const trigger = container.querySelector(".responsive-nav-toggle") as HTMLButtonElement;
      fireEvent.click(trigger);
      expect(nav.classList.contains("mobile-open")).toBe(true);
      expect(nav.getAttribute("aria-hidden")).toBeNull();
      expect(nav.getAttribute("role")).toBe("dialog");
      expect(nav.getAttribute("aria-modal")).toBe("true");
      expect(within(nav).getByRole("button", { name: "收起导航" })).toBeTruthy();
      expect(within(nav).queryByRole("button", { name: "展开导航" })).toBeNull();
      await waitFor(() => expect(nav.contains(document.activeElement)).toBe(true));
      expect((container.querySelector(".app-stage") as HTMLElement).inert).toBe(true);
      const drawerButtons = Array.from(nav.querySelectorAll<HTMLButtonElement>("button:not([disabled])"));
      drawerButtons.at(-1)?.focus();
      fireEvent.keyDown(document, { key: "Tab" });
      expect(document.activeElement).toBe(drawerButtons[0]);
      fireEvent.keyDown(document, { key: "Escape" });
      expect(nav.classList.contains("mobile-open")).toBe(false);
      await waitFor(() => expect(document.activeElement).toBe(trigger));
      expect((container.querySelector(".app-stage") as HTMLElement).inert).toBeFalsy();
    } finally {
      window.matchMedia = originalMatchMedia;
    }
  });

  it("floats a preferred wide companion instead of collapsing navigation", async () => {
    const originalMatchMedia = window.matchMedia;
    const originalWidth = window.innerWidth;
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 1_365 });
    window.matchMedia = vi.fn((query: string) => {
      const max = Number(query.match(/max-width:\s*(\d+)px/)?.[1] || Number.POSITIVE_INFINITY);
      return {
        matches: window.innerWidth <= max,
        media: query,
        onchange: null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(() => true),
        addListener: vi.fn(),
        removeListener: vi.fn()
      } as MediaQueryList;
    });
    try {
      const { container } = render(
        <ResponsiveLayoutProvider>
          <AppShell
            page="creative"
            navigate={vi.fn()}
            onOpenSearch={vi.fn()}
            navCollapsed={false}
            setNavCollapsed={vi.fn()}
            repoRoot="/repo"
            runtime="linux"
            environment={{ mode: "desktop", platform: "linux" }}
            pendingApprovals={0}
            aiMode="wide"
            aiSidebar={<aside className="ai-sidebar" data-layout-width={760} data-layout-min-width={380}>AI</aside>}
          >
            <div>Creative</div>
          </AppShell>
        </ResponsiveLayoutProvider>
      );
      await waitFor(() => expect(container.querySelector(".app-shell")?.classList.contains("layout-companion-overlay")).toBe(true));
      expect(container.querySelector(".app-shell")?.classList.contains("layout-shell-expanded")).toBe(true);
      expect(container.querySelector(".app-nav")?.classList.contains("collapsed")).toBe(false);
      expect(container.querySelector(".app-shell")?.classList.contains("layout-companion-canvas")).toBe(false);
    } finally {
      window.matchMedia = originalMatchMedia;
      Object.defineProperty(window, "innerWidth", { configurable: true, value: originalWidth });
    }
  });

  it("does not mark New Task active while an existing AI session is open", () => {
    render(
      <AppShell
        page="ai"
        navigate={vi.fn()}
        onOpenSearch={vi.fn()}
        navCollapsed={false}
        setNavCollapsed={vi.fn()}
        repoRoot="/repo"
        runtime="linux"
        environment={{ mode: "desktop", platform: "linux" }}
        pendingApprovals={0}
        aiSessionOpen
        aiMode="default"
      >
        <div>Existing session</div>
      </AppShell>
    );

    const newTask = screen.getByRole("button", { name: "新建任务" });
    expect(newTask.classList.contains("active")).toBe(false);
    expect(newTask.getAttribute("aria-current")).toBeNull();
  });

  it("renders a compact task-first navigation with settings pinned to bottom", () => {
    render(
      <AppShell
        page="creative"
        navigate={vi.fn()}
        onOpenSearch={vi.fn()}
        navCollapsed={false}
        setNavCollapsed={vi.fn()}
        repoRoot="/repo"
        runtime="linux"
        environment={{ mode: "desktop", platform: "linux" }}
        pendingApprovals={0}
        aiMode="default"
      >
        <div>Creative</div>
      </AppShell>
    );

    expect(screen.queryByText("核心功能")).toBeNull();
    expect(screen.queryByText("系统")).toBeNull();
    // 新建任务在顶部；项目作为独立创作空间排在现有 Creative 之前。
    const create = screen.getByRole("button", { name: "新建任务" });
    const projects = screen.getByRole("button", { name: "项目" });
    const creative = screen.getByRole("button", { name: "创作" });
    const settings = screen.getByRole("button", { name: "设置" });
    expect(screen.queryByRole("button", { name: "运行中心" })).toBeNull();
    expect(create.compareDocumentPosition(projects) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(projects.compareDocumentPosition(creative) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(creative.compareDocumentPosition(settings) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("uses structured environment state instead of parsing the runtime label", () => {
    const props = {
      page: "brief" as const,
      navigate: vi.fn(),
      onOpenSearch: vi.fn(),
      navCollapsed: false,
      setNavCollapsed: vi.fn(),
      repoRoot: "/repo",
      pendingApprovals: 0,
      aiMode: "collapsed"
    };
    const { rerender } = render(
      <AppShell {...props} runtime="Preview-shaped diagnostic text" environment={{ mode: "desktop", platform: "linux" }}>
        <div>Sources</div>
      </AppShell>
    );
    expect(screen.getByRole("status").textContent).toContain("已连接");

    rerender(
      <AppShell {...props} runtime="linux" environment={{ mode: "preview", platform: "web" }}>
        <div>Sources</div>
      </AppShell>
    );
    expect(screen.getByRole("status").textContent).toContain("Preview");
  });

  it("renders recent tasks slot between core nav and settings", () => {
    render(
      <AppShell
        page="brief"
        navigate={vi.fn()}
        onOpenSearch={vi.fn()}
        navCollapsed={false}
        setNavCollapsed={vi.fn()}
        repoRoot="/repo"
        runtime="linux"
        environment={{ mode: "desktop", platform: "linux" }}
        pendingApprovals={0}
        aiMode="default"
        recentTasks={<div>最近任务区块</div>}
      >
        <div>Sources</div>
      </AppShell>
    );

    const creative = screen.getByRole("button", { name: "创作" });
    const recent = screen.getByText("最近任务区块");
    const settings = screen.getByRole("button", { name: "设置" });
    expect(creative.compareDocumentPosition(recent) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(recent.compareDocumentPosition(settings) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("hides the global recent-task slot inside a project to avoid a duplicate task list", () => {
    render(
      <AppShell
        page="projects"
        navigate={vi.fn()}
        onOpenSearch={vi.fn()}
        navCollapsed={false}
        setNavCollapsed={vi.fn()}
        repoRoot="/repo"
        runtime="linux"
        environment={{ mode: "desktop", platform: "linux" }}
        pendingApprovals={0}
        aiMode="collapsed"
        recentTasks={<div>最近任务区块</div>}
      >
        <div>Project</div>
      </AppShell>
    );

    expect(screen.queryByText("最近任务区块")).toBeNull();
    expect(screen.getByRole("button", { name: "项目" }).getAttribute("aria-current")).toBe("page");
  });
});
