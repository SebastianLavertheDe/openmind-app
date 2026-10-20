import { useLocale } from "../i18n";
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
import { isDefaultSkillsPage, type AppPage, type Navigate } from "./routes";
import type { AppEnvironment } from "@shared/contracts";
import { NAV_ITEMS, preloadRoute, type NavGroup, type NavItem } from "./route-registry";
import { ResponsiveActionBar, ResponsiveContextBadge, Tooltip, useModalFocusScope, type ResponsiveAction } from "../design-system/components";
import { RESPONSIVE_LAYOUT_BREAKPOINTS, useResponsiveCompositionReporter, useResponsiveLayout } from "./responsive-layout";
import { useNavigationMotion } from "./use-navigation-motion";
import { useExitPresence } from "../design-system/use-exit-presence";
import { useMotionTokens } from "../design-system/motion-tokens";

export function AppShell({
  page,
  defaultSkillsEnabled,
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
  recentTasks,
  onNewTask
}: {
  page: AppPage;
  defaultSkillsEnabled: boolean;
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
  recentTasks?: ReactNode;
  onNewTask?(): void;
}) {
  const locale = useLocale();
  const navItems = NAV_ITEMS.filter((item) => defaultSkillsEnabled || !isDefaultSkillsPage(item.id));
  // sources / skills remain valid legacy routes, but now live inside the
  // dedicated settings information architecture.
  const settingsMode = page === "settings" || page === "sources" || page === "skills";
  const onboardingMode = page === "onboarding";
  const fullPageMode = settingsMode || onboardingMode;
  const showAiSidebar = page !== "ai" && !fullPageMode;
  const hasAiSidebar = Boolean(aiSidebar);
  const previewMode = environment.mode === "preview";
  const windowsMica = environment.mode === "desktop" && environment.platform === "win32";
  const responsiveLayout = useResponsiveLayout();
  const reportComposition = useResponsiveCompositionReporter();
  const compactShell = responsiveLayout.shell === "drawer";
  const railShell = responsiveLayout.shell === "rail";
  // 顶栏只保留给抽屉壳：桌面布局下搜索、待审批入口已由侧边导航承载，
  // 保留这条 48px 工具条只会挤占正文高度。
  const showGlobalToolbar = !fullPageMode && compactShell;
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const navRef = useRef<HTMLElement>(null);
  const navTriggerRef = useRef<HTMLButtonElement>(null);
  const closeMobileNav = useCallback(() => setMobileNavOpen(false), []);
  const motionTokens = useMotionTokens();
  const scrimPresence = useExitPresence(!fullPageMode && compactShell && mobileNavOpen, motionTokens.exitMs);
  const effectiveNavCollapsed = !compactShell && (railShell || navCollapsed);
  const toggleNavigation = useNavigationMotion(navRef, navCollapsed, setNavCollapsed, !compactShell && !railShell && !fullPageMode, page);
  const navigationInlineSize = fullPageMode || compactShell
    ? 0
    : effectiveNavCollapsed
      ? RESPONSIVE_LAYOUT_BREAKPOINTS.railNavigationWidth
      : RESPONSIVE_LAYOUT_BREAKPOINTS.expandedNavigationWidth;
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
    const companionVisible = showAiSidebar
      && hasAiSidebar
      && (aiMode === "default" || aiMode === "wide");
    reportComposition({
      viewportWidth: window.visualViewport?.width || document.documentElement.clientWidth || window.innerWidth,
      navigationInlineSize,
      // Continuous pixels stay in CSS. React only owns the semantic minimum
      // and whether the companion participates in the shell composition.
      companionWidth: companionVisible ? 1 : 0,
      companionMinWidth: companionVisible ? RESPONSIVE_LAYOUT_BREAKPOINTS.minimumCompanionWidth : 0
    });
  }, [aiMode, compactShell, effectiveNavCollapsed, fullPageMode, hasAiSidebar, reportComposition, showAiSidebar]);
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
      onSelect: () => void window.openmind.openPath(".")
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
      onSelect: () => void window.openmind.openPath("README.md")
    }
  ];
  return (
    <div
      className={`app-shell page-${page} layout-shell-${responsiveLayout.shell} layout-companion-${responsiveLayout.companion} layout-workspace-${responsiveLayout.workspace} layout-density-${responsiveLayout.density} ${page === "ai" ? "ai-page" : ""}${settingsMode ? " settings-mode" : ""}${onboardingMode ? " onboarding-mode" : ""} ${showAiSidebar ? `with-ai-${aiMode}` : ""}${mobileNavOpen ? " mobile-nav-open" : ""}${windowsMica ? " window-chrome-mica" : ""}`}
      style={{
        "--nav-width": `${navigationInlineSize}px`,
        "--layout-nav-expanded-width": `${RESPONSIVE_LAYOUT_BREAKPOINTS.expandedNavigationWidth}px`,
        "--layout-nav-rail-width": `${RESPONSIVE_LAYOUT_BREAKPOINTS.railNavigationWidth}px`,
        "--layout-companion-min-width": `${RESPONSIVE_LAYOUT_BREAKPOINTS.minimumCompanionWidth}px`,
        "--layout-workspace-min-width": `${responsiveLayout.workspaceMinWidth}px`,
        "--nav-preferred-ratio-offset": `${navigationInlineSize / 3}px`
      } as CSSProperties}
    >
      {windowsMica ? <div className="window-titlebar-drag-region" aria-hidden="true" /> : null}
      {!fullPageMode && compactShell && scrimPresence.visible ? <button className="app-nav-scrim" aria-hidden="true" tabIndex={-1} inert={!mobileNavOpen} data-leaving={scrimPresence.leaving || undefined} data-focus-scope-backdrop="" data-motion="action" onClick={closeMobileNav} /> : null}
      {!fullPageMode ? <aside
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
          <div className="brand-copy"><strong>OpenMind</strong></div>
          {!railShell ? (
            <Tooltip content={compactShell ? m.shell.navCollapse : navCollapsed ? m.shell.navExpand : m.shell.navCollapse} side="bottom">
              <button
                className="icon-button nav-collapse-button"
                data-motion="icon"
                aria-label={compactShell ? m.shell.navCollapse : navCollapsed ? m.shell.navExpand : m.shell.navCollapse}
                aria-expanded={compactShell ? mobileNavOpen : !effectiveNavCollapsed}
                aria-controls="primary-navigation"
                onClick={compactShell ? closeMobileNav : toggleNavigation}
              >
                {compactShell || !navCollapsed ? <PanelLeftClose size={16} /> : <PanelLeftOpen size={16} />}
              </button>
            </Tooltip>
          ) : null}
        </div>
        <div className="app-nav-body">
          <nav aria-label={m.shell.navMain}>
            {(["create", "core"] as NavGroup[]).map((group) => {
              const items = navItems.filter((item) => item.group === group);
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
              const items = navItems.filter((item) => item.group === "system");
              if (!items.length) return null;
              return (
                <div className="nav-group nav-group-system" key="system">
                  {!navCollapsed && m.navGroup.system ? <span className="nav-group-label">{m.navGroup.system}</span> : null}
                  {items.map((item) => renderNavButton(item, page, pendingApprovals, Boolean(aiSessionOpen), onNewTask ? newTaskFromNav : undefined, navigateFromNav, effectiveNavCollapsed))}
                </div>
              );
            })()}
          </nav>
        </div>
        <footer className="app-project-status">
          <Boxes size={16} />
          <div><strong>{runtime}</strong><span title={repoRoot}>{repoRoot}</span></div>
        </footer>
      </aside> : null}
      <section className={`app-stage${showGlobalToolbar ? "" : " app-stage-without-toolbar"}`}>
        {showGlobalToolbar ? <header className="global-toolbar">
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
      onClick={() => {
        // Keyboard activation and direct programmatic clicks may not pass
        // through hover/focus first; begin the lazy route import before the
        // navigation state renders its Suspense boundary.
        preloadRoute(item.id);
        if (item.id === "ai" && onNewTask) onNewTask();
        else navigate(item.id);
      }}
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
