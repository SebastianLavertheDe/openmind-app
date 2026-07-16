import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppShell } from "./AppShell";
import { ResponsiveLayoutProvider } from "./responsive-layout";

beforeEach(() => {
  window.cctools = { openPath: vi.fn().mockResolvedValue("") } as never;
});

afterEach(() => cleanup());

describe("AppShell", () => {
  it("renders fixed primary navigation and opens global search", () => {
    const navigate = vi.fn();
    const openSearch = vi.fn();
    const setNavCollapsed = vi.fn();
    render(
      <AppShell
        page="sources"
        navigate={navigate}
        onOpenSearch={openSearch}
        navCollapsed={false}
        setNavCollapsed={setNavCollapsed}
        repoRoot="/repo"
        runtime="linux"
        environment={{ mode: "desktop" }}
        pendingApprovals={2}
        aiMode="default"
      >
        <div>Sources</div>
      </AppShell>
    );

    expect(screen.getByRole("button", { name: "资料库" }).getAttribute("aria-current")).toBe("page");
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
        page="settings"
        navigate={vi.fn()}
        onOpenSearch={vi.fn()}
        navCollapsed={false}
        setNavCollapsed={setNavCollapsed}
        repoRoot="/repo"
        runtime="linux"
        environment={{ mode: "desktop" }}
        pendingApprovals={0}
        aiMode="default"
      >
        <div>Settings</div>
      </AppShell>
    );

    fireEvent.click(screen.getByRole("button", { name: "收起导航" }));
    expect(setNavCollapsed).toHaveBeenCalledWith(true);
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
          <AppShell page="creative" navigate={vi.fn()} onOpenSearch={vi.fn()} navCollapsed={false} setNavCollapsed={vi.fn()} repoRoot="/repo" runtime="linux" environment={{ mode: "desktop" }} pendingApprovals={0} aiMode="collapsed">
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
            environment={{ mode: "desktop" }}
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

  it("places the conversation module between core nav and settings on the AI page", () => {
    render(
      <AppShell
        page="ai"
        navigate={vi.fn()}
        onOpenSearch={vi.fn()}
        navCollapsed={false}
        setNavCollapsed={vi.fn()}
        repoRoot="/repo"
        runtime="linux"
        environment={{ mode: "desktop" }}
        pendingApprovals={0}
        aiMode="default"
        aiNavigation={<div>会话记录模块</div>}
      >
        <div>AI</div>
      </AppShell>
    );

    const settings = screen.getByRole("button", { name: "设置" });
    const conversations = screen.getByText("会话记录模块");
    // 设置在上、会话沉底：设置应在会话之前（文档顺序）
    expect(conversations.compareDocumentPosition(settings) & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy();
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
        environment={{ mode: "desktop" }}
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
        environment={{ mode: "desktop" }}
        pendingApprovals={0}
        aiMode="default"
      >
        <div>Creative</div>
      </AppShell>
    );

    expect(screen.queryByText("核心功能")).toBeNull();
    expect(screen.queryByText("系统")).toBeNull();
    // 新建任务在顶部、设置在核心功能之后：设置应排在创作之后
    const create = screen.getByRole("button", { name: "新建任务" });
    const creative = screen.getByRole("button", { name: "创作" });
    const settings = screen.getByRole("button", { name: "设置" });
    expect(create.compareDocumentPosition(creative) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(creative.compareDocumentPosition(settings) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("uses structured environment state instead of parsing the runtime label", () => {
    const props = {
      page: "sources" as const,
      navigate: vi.fn(),
      onOpenSearch: vi.fn(),
      navCollapsed: false,
      setNavCollapsed: vi.fn(),
      repoRoot: "/repo",
      pendingApprovals: 0,
      aiMode: "collapsed"
    };
    const { rerender } = render(
      <AppShell {...props} runtime="Preview-shaped diagnostic text" environment={{ mode: "desktop" }}>
        <div>Sources</div>
      </AppShell>
    );
    expect(screen.getByRole("status").textContent).toContain("已连接");

    rerender(
      <AppShell {...props} runtime="linux" environment={{ mode: "preview" }}>
        <div>Sources</div>
      </AppShell>
    );
    expect(screen.getByRole("status").textContent).toContain("Preview");
  });

  it("renders recent tasks slot between core nav and settings", () => {
    render(
      <AppShell
        page="sources"
        navigate={vi.fn()}
        onOpenSearch={vi.fn()}
        navCollapsed={false}
        setNavCollapsed={vi.fn()}
        repoRoot="/repo"
        runtime="linux"
        environment={{ mode: "desktop" }}
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
});
