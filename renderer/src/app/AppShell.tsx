import { type CSSProperties, type ReactNode, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { messages as m } from "@shared/messages";
import {
  Bell,
  Boxes,
  CircleHelp,
  PanelLeftClose,
  PanelLeftOpen,
  Search
} from "lucide-react";
import type { AppPage, Navigate } from "./routes";
import type { AppEnvironment } from "@shared/contracts";
import { NAV_ITEMS, preloadRoute, type NavGroup, type NavItem } from "./route-registry";
import { ResponsiveActionBar, ResponsiveContextBadge, Tooltip, useModalFocusScope, type ResponsiveAction } from "../design-system/components";
import { useResponsiveCompositionReporter, useResponsiveLayout } from "./responsive-layout";
import packageJson from "../../../package.json";

export function AppShell({
  page,
  navigate,
  onOpenSearch,
  navCollapsed,
  setNavCollapsed,
  repoRoot,
  runtime,
  environment,
  pendingApprovals,
  aiSessionOpen,
  aiMode,
  children,
  aiSidebar,
  aiNavigation,
  recentTasks,
  onNewTask
}: {
  page: AppPage;
  navigate: Navigate;
  onOpenSearch(): void;
  navCollapsed: boolean;
  setNavCollapsed(value: boolean): void;
  repoRoot: string;
  runtime: string;
  environment: AppEnvironment;
  pendingApprovals: number;
  aiSessionOpen?: boolean;
  aiMode: string;
  children: ReactNode;
  aiSidebar?: ReactNode;
  aiNavigation?: ReactNode;
  recentTasks?: ReactNode;
  onNewTask?(): void;
}) {
  const settingsMode = page === "settings";
  const showAiSidebar = page !== "ai" && !settingsMode;
  const previewMode = environment.mode === "preview";
  const windowsMica = environment.mode === "desktop" && environment.platform === "win32";
  const responsiveLayout = useResponsiveLayout();
  const reportComposition = useResponsiveCompositionReporter();
  const compactShell = responsiveLayout.shell === "drawer";
  const railShell = responsiveLayout.shell === "rail";
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const navRef = useRef<HTMLElement>(null);
  const navTriggerRef = useRef<HTMLButtonElement>(null);
  const shellRef = useRef<HTMLDivElement>(null);
  const closeMobileNav = useCallback(() => setMobileNavOpen(false), []);
  const effectiveNavCollapsed = !compactShell && (railShell || navCollapsed);
  useEffect(() => {
    if (!compactShell) setMobileNavOpen(false);
  }, [compactShell]);
  useLayoutEffect(() => {
    if (!windowsMica) return;
    document.documentElement.dataset.windowChrome = "mica";
    return () => {
      if (document.documentElement.dataset.windowChrome === "mica") delete document.documentElement.dataset.windowChrome;
    };
  }, [windowsMica]);
  useModalFocusScope({ open: compactShell && mobileNavOpen, containerRef: navRef, triggerRef: navTriggerRef, onDismiss: closeMobileNav, layer: "drawer" });
  useLayoutEffect(() => {
    const shell = shellRef.current;
    if (!shell) return;
    const measure = () => {
      const companion = shell.querySelector<HTMLElement>(":scope > .ai-sidebar");
      const preferredWidth = Number(companion?.dataset.layoutWidth);
      reportComposition({
        viewportWidth: shell.getBoundingClientRect().width || window.innerWidth,
        // Fullscreen and collapsed modes do not consume a grid column. Default
        // and wide keep reporting their preferred width so navigation can
        // simplify before the companion itself reaches the canvas breakpoint.
        companionWidth: aiMode === "default" || aiMode === "wide"
          ? Number.isFinite(preferredWidth) && preferredWidth > 0 ? preferredWidth : 0
          : 0
      });
    };
    measure();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    observer?.observe(shell);
    const companion = shell.querySelector<HTMLElement>(":scope > .ai-sidebar");
    if (companion) observer?.observe(companion);
    return () => observer?.disconnect();
  }, [aiMode, aiSidebar, reportComposition, responsiveLayout.companion]);
  const navigateFromNav = useCallback<Navigate>((nextPage, state) => {
    setMobileNavOpen(false);
    if (state === undefined) navigate(nextPage);
    else navigate(nextPage, state);
  }, [navigate]);
  const newTaskFromNav = useCallback(() => {
    setMobileNavOpen(false);
    onNewTask?.();
  }, [onNewTask]);
  const projectName = compactPath(repoRoot);
  const globalActions: ResponsiveAction[] = [
    {
      id: "search",
      label: m.shell.searchPlaceholder,
      displayLabel: m.shell.searchShort,
      shortLabel: m.shell.searchShort,
      icon: Search,
      priority: "essential",
      onSelect: onOpenSearch
    },
    {
      id: "directory",
      label: m.shell.openProject(repoRoot),
      displayLabel: projectName,
      shortLabel: projectName,
      icon: Boxes,
      priority: "primary",
      onSelect: () => void window.cctools.openPath(".")
    },
    {
      id: "notifications",
      label: m.shell.notifications,
      displayLabel: m.shell.notificationsShort,
      labelBehavior: "icon",
      icon: Bell,
      priority: pendingApprovals ? "essential" : "primary",
      badge: pendingApprovals || undefined,
      onSelect: () => navigate("ai")
    },
    {
      id: "help",
      label: m.shell.help,
      displayLabel: m.shell.helpShort,
      labelBehavior: "icon",
      icon: CircleHelp,
      priority: "secondary",
      onSelect: () => void window.cctools.openPath("README.md")
    }
  ];
  return (
    <div
      ref={shellRef}
      className={`app-shell layout-shell-${responsiveLayout.shell} layout-companion-${responsiveLayout.companion} layout-workspace-${responsiveLayout.workspace} layout-density-${responsiveLayout.density} ${page === "ai" ? "ai-page" : ""}${settingsMode ? " settings-mode" : ""} ${showAiSidebar ? `with-ai-${aiMode}` : ""}${mobileNavOpen ? " mobile-nav-open" : ""}${windowsMica ? " window-chrome-mica" : ""}`}
      style={{ "--nav-width": effectiveNavCollapsed ? "60px" : "260px" } as CSSProperties}
    >
      {windowsMica ? <div className="window-titlebar-drag-region" aria-hidden="true" /> : null}
      {!settingsMode && compactShell && mobileNavOpen ? <button className="app-nav-scrim" aria-hidden="true" tabIndex={-1} data-focus-scope-backdrop="" data-motion="action" onClick={closeMobileNav} /> : null}
      {!settingsMode ? <aside
        id="primary-navigation"
        ref={navRef}
        className={`app-nav${effectiveNavCollapsed ? " collapsed" : ""}${mobileNavOpen ? " mobile-open" : ""}`}
        role={compactShell ? "dialog" : undefined}
        aria-modal={compactShell && mobileNavOpen ? "true" : undefined}
        aria-label={m.shell.navMain}
        aria-hidden={compactShell && !mobileNavOpen ? true : undefined}
        inert={compactShell && !mobileNavOpen}
        tabIndex={compactShell ? -1 : undefined}
        onClickCapture={(event) => {
          if (!compactShell) return;
          const button = (event.target as HTMLElement).closest("button");
          if (button && !button.classList.contains("nav-recent-toggle")) setMobileNavOpen(false);
        }}
      >
        <div className="app-brand">
          <div className="brand-mark">CC</div>
          <div className="brand-copy"><strong>CC Tools</strong><span>v{packageJson.version}</span></div>
          {!railShell ? (
            <Tooltip content={compactShell ? m.shell.navCollapse : navCollapsed ? m.shell.navExpand : m.shell.navCollapse} side="bottom">
              <button
                className="icon-button nav-collapse-button"
                data-motion="icon"
                aria-label={compactShell ? m.shell.navCollapse : navCollapsed ? m.shell.navExpand : m.shell.navCollapse}
                onClick={() => compactShell ? closeMobileNav() : setNavCollapsed(!navCollapsed)}
              >
                {compactShell || !navCollapsed ? <PanelLeftClose size={16} /> : <PanelLeftOpen size={16} />}
              </button>
            </Tooltip>
          ) : null}
          <Tooltip content={m.shell.searchPlaceholder} side="bottom">
            <button className="icon-button nav-search-button" data-motion="icon" aria-label={m.shell.searchPlaceholder} onClick={onOpenSearch}>
              <Search size={16} />
            </button>
          </Tooltip>
        </div>
        <div className="app-nav-body">
          <nav aria-label={m.shell.navMain}>
            {(["create", "core"] as NavGroup[]).map((group) => {
              const items = NAV_ITEMS.filter((item) => item.group === group);
              if (!items.length) return null;
              return (
                <div className={`nav-group nav-group-${group}`} key={group}>
                  {m.navGroup[group] ? <span className="nav-group-label">{m.navGroup[group]}</span> : null}
                  {items.map((item) => renderNavButton(item, page, pendingApprovals, Boolean(aiSessionOpen), onNewTask ? newTaskFromNav : undefined, navigateFromNav, effectiveNavCollapsed))}
                </div>
              );
            })}
            {recentTasks}
            {(() => {
              const items = NAV_ITEMS.filter((item) => item.group === "system");
              if (!items.length) return null;
              return (
                <div className="nav-group nav-group-system" key="system">
                  {!navCollapsed && m.navGroup.system ? <span className="nav-group-label">{m.navGroup.system}</span> : null}
                  {items.map((item) => renderNavButton(item, page, pendingApprovals, Boolean(aiSessionOpen), onNewTask ? newTaskFromNav : undefined, navigateFromNav, effectiveNavCollapsed))}
                </div>
              );
            })()}
            {page === "ai" && aiNavigation ? (
              <div className="nav-conversation-module">
                <div className="nav-section-divider" aria-hidden="true" />
                <div className="nav-session-history">{aiNavigation}</div>
              </div>
            ) : null}
          </nav>
        </div>
        <footer className="app-project-status">
          <Boxes size={16} />
          <div><strong>{runtime}</strong><span title={repoRoot}>{repoRoot}</span></div>
        </footer>
      </aside> : null}
      <section className="app-stage">
        {!settingsMode ? <header className="global-toolbar">
          <Tooltip content={m.shell.navMenu} side="bottom">
            <button
              ref={navTriggerRef}
              className="icon-button responsive-nav-toggle"
              aria-label={m.shell.navMenu}
              aria-expanded={mobileNavOpen}
              aria-controls="primary-navigation"
              data-motion="icon"
              onClick={() => setMobileNavOpen(true)}
            >
              <PanelLeftOpen size={17} />
            </button>
          </Tooltip>
          <ResponsiveContextBadge
            presentation={responsiveLayout.actions}
            priority={previewMode ? "essential" : "secondary"}
            label={previewMode ? m.shell.statusPreview : m.shell.statusConnected}
            shortLabel={previewMode ? m.shell.statusPreview : undefined}
            tone={previewMode ? "warning" : "success"}
          />
          <ResponsiveActionBar
            className="global-responsive-actions"
            actions={globalActions}
            presentation={responsiveLayout.actions}
            overflowLabel={m.shell.moreActions}
          />
        </header> : null}
        <main className="main-area">{children}</main>
      </section>
      {showAiSidebar ? aiSidebar : null}
    </div>
  );
}

function compactPath(value: string): string {
  return value.split(/[\\/]/).filter(Boolean).at(-1) || value;
}

/** 渲染单个导航按钮（active 态、角标、新建任务特殊处理）。分组渲染时复用。 */
function renderNavButton(
  item: NavItem,
  page: AppPage,
  pendingApprovals: number,
  aiSessionOpen: boolean,
  onNewTask: (() => void) | undefined,
  navigate: Navigate,
  collapsed: boolean
) {
  const Icon = item.icon;
  const active = page === item.id && !(item.id === "ai" && aiSessionOpen);
  const button = (
    <button
      key={item.id}
      className={active ? "active" : ""}
      aria-current={active ? "page" : undefined}
      aria-label={item.label}
      data-motion="selection"
      onMouseEnter={() => preloadRoute(item.id)}
      onFocus={() => preloadRoute(item.id)}
      onClick={() => item.id === "ai" && onNewTask ? onNewTask() : navigate(item.id)}
    >
      <Icon size={20} />
      <span>{item.label}</span>
      {item.id === "ai" && pendingApprovals ? <b>{pendingApprovals}</b> : null}
    </button>
  );
  return collapsed
    ? <Tooltip key={item.id} content={item.label} side="right">{button}</Tooltip>
    : button;
}
