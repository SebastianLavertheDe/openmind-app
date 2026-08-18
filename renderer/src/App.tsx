import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { messages as m } from "@shared/messages";
import { AiProvider, useAi } from "./ai-context";
import { storageJson, writeStorage } from "./ai-utils";
import { AppShell } from "./app/AppShell";
import { ResponsiveLayoutProvider } from "./app/responsive-layout";
import { SidebarRecent } from "./app/SidebarRecent";
import { GlobalSearch } from "./app/GlobalSearch";
import type { AppRoute, AppRouteState, Navigate } from "./app/routes";
import { renderActiveRoute, type RouteBootstrap } from "./app/route-registry";
import { AiSidebar } from "./components/AiSidebar";
import { FeedbackHost } from "./components/FeedbackHost";
import { WorkspaceFilePreview } from "./components/WorkspaceFilePreview";
import { FilePreviewProvider } from "./features/ai-console/file-preview-context";
import { applyTheme } from "./theme";

const NAV_COLLAPSED_KEY = "cctools.nav.collapsed.v1";
type Bootstrap = RouteBootstrap;

export function App() {
  const [bootstrap, setBootstrap] = useState<Bootstrap | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!window.cctools) {
      setError(m.app.preloadMissing);
      return;
    }
    void window.cctools.getBootstrap().then(setBootstrap).catch((cause) => setError(cause instanceof Error ? cause.message : String(cause)));
  }, []);
  if (error) return <div className="fatal"><strong>{m.app.fatalTitle}</strong><pre>{error}</pre></div>;
  if (!bootstrap) return <div className="splash"><div className="brand-mark">CC</div><span>{m.app.splashStarting}</span></div>;
  return <ResponsiveLayoutProvider><AiProvider initial={bootstrap.ai} skills={bootstrap.skills}><Workspace bootstrap={bootstrap} setBootstrap={setBootstrap} /></AiProvider></ResponsiveLayoutProvider>;
}

function Workspace({ bootstrap, setBootstrap }: { bootstrap: Bootstrap; setBootstrap(value: Bootstrap): void }) {
  // A valid mymind root plus the official cctools-skills repository installed
  // are the actual first-start gate. The checklist remains available during
  // setup, but a stale app-private onboarding flag must not stop an already
  // configured workspace on every launch.
  const [route, setRoute] = useState<AppRoute>(() => ({ page: bootstrap.validRepo && bootstrap.skillsInstalled ? "ai" : "onboarding", state: {}, nonce: 0 }));
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsRouteState, setSettingsRouteState] = useState<AppRouteState>({});
  const [searchOpen, setSearchOpen] = useState(false);
  const [workspaceFilePath, setWorkspaceFilePath] = useState<string | null>(null);
  const [aiFilePreviewPath, setAiFilePreviewPath] = useState<string | null>(null);
  const [navCollapsed, setNavCollapsed] = useState(() => storageJson(NAV_COLLAPSED_KEY, false));
  const ai = useAi();
  const showAiCompanion = route.page === "creative" || route.page === "projects" || route.page === "brief";
  const previousRoutePage = useRef<AppRoute["page"] | null>(null);
  const navigate: Navigate = useCallback((page, state: AppRouteState = {}) => {
    if (page === "settings" || page === "skills" || page === "sources") {
      setSettingsRouteState({
        ...state,
        ...(page === "skills" || page === "sources" ? { settingsSection: "skills" as const } : {})
      });
      setSettingsOpen(true);
      return;
    }
    setSettingsOpen(false);
    setRoute((current) => {
      // MOTION-P0-002: 点击当前已激活导航且没有新 state 时，不递增 nonce、不重挂载页面、不重放入场动画。
      const samePage = current.page === page;
      const sameState = JSON.stringify(current.state) === JSON.stringify(state);
      if (samePage && sameState) return current;
      return { page, state, nonce: current.nonce + 1 };
    });
  }, []);
  const exitSettings = useCallback(() => {
    setSettingsOpen(false);
    window.requestAnimationFrame(() => {
      document.querySelector<HTMLButtonElement>('button[aria-label="设置"]')?.focus({ preventScroll: true });
    });
  }, []);
  const openSearch = useCallback(() => setSearchOpen(true), []);
  const closeSearch = useCallback(() => setSearchOpen(false), []);
  const openWorkspaceFile = useCallback((path: string) => setWorkspaceFilePath(path), []);
  const closeWorkspaceFile = useCallback(() => setWorkspaceFilePath(null), []);
  useEffect(() => writeStorage(NAV_COLLAPSED_KEY, navCollapsed), [navCollapsed]);
  useEffect(() => { void window.cctools.getPreferences().then(applyTheme).catch(() => { /* 浅色为 :root 默认,失败无需处理 */ }); }, []);
  useEffect(() => {
    if (typeof performance === "undefined") return;
    performance.mark("app-mounted");
    const raf = window.requestAnimationFrame(() => { void document.fonts?.ready.then(() => { performance?.mark("app-first-contentful-paint"); }); });
    return () => window.cancelAnimationFrame(raf);
  }, []);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const mod = event.metaKey || event.ctrlKey;
      if (!mod) return;
      const key = event.key.toLowerCase();
      if (key === "k") { event.preventDefault(); openSearch(); }
      else if (key === "n") { event.preventDefault(); void ai.setActiveSession(null); navigate("ai"); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [ai.setActiveSession, navigate, openSearch]);
  useEffect(() => {
    const enteredPage = previousRoutePage.current !== route.page;
    previousRoutePage.current = route.page;
    if (!showAiCompanion) {
      if (ai.panelMode !== "collapsed") ai.setPanelMode("collapsed");
      return;
    }
    // 每日简报首次进入时直接提供对话框；同页手动收起后保持用户选择。
    if (route.page === "brief" && enteredPage && ai.panelMode === "collapsed") ai.setPanelMode("default");
  }, [route.page, showAiCompanion, ai.panelMode, ai.setPanelMode]);
  // 窗口重新获焦时异步重探 provider：登录在后、换模型、新装 CLI 都能被捡起。
  // 探测在 worker 进程用 spawn 跑、非阻塞，完成后自动推送 snapshot，绝不卡 send。
  useEffect(() => {
    const onFocus = () => { void window.cctools.aiRefreshProviders?.().catch(() => undefined); };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, []);
  useEffect(() => {
    if (settingsOpen) void window.cctools.aiRefreshProviders?.().catch(() => undefined);
  }, [settingsOpen]);
  useEffect(() => setWorkspaceFilePath(null), [route.page, route.nonce, settingsOpen]);
  const routeRenderProps = {
    bootstrap,
    navigate,
    providers: ai.snapshot.providers,
    aiFilePreviewPath,
    onAiFilePreviewPathChange: setAiFilePreviewPath,
    onRepo: () => void window.cctools.getBootstrap().then(setBootstrap),
    onExitSettings: exitSettings
  };
  return (
    <FilePreviewProvider open={openWorkspaceFile}>
      <AppShell
      page={settingsOpen ? "settings" : route.page}
      navigate={navigate}
      onOpenSearch={openSearch}
      navCollapsed={navCollapsed}
      setNavCollapsed={setNavCollapsed}
      repoRoot={bootstrap.repoRoot}
      runtime={bootstrap.runtime}
      environment={bootstrap.environment}
      pendingApprovals={ai.snapshot.pendingApprovals.length}
      aiSessionOpen={Boolean(ai.activeSession)}
      aiMode={showAiCompanion ? ai.panelMode : "collapsed"}
      aiSidebar={showAiCompanion ? <AiSidebar openWorkbench={() => navigate("ai")} /> : null}
      aiNavigation={null}
      recentTasks={<SidebarRecent activeSessionId={route.page === "ai" ? ai.activeSession?.id || null : null} onOpen={(id) => { void ai.setActiveSession(id); navigate("ai"); }} />}
      onNewTask={() => { void ai.setActiveSession(null); navigate("ai"); }}
      >
      <Suspense fallback={<div className="route-loading" role="status" aria-live="polite"><div className="route-loading-skeleton" /></div>}>
        <div
          className={`settings-preserved-route${settingsOpen ? " is-covered" : ""}`}
          aria-hidden={settingsOpen || Boolean(workspaceFilePath) || undefined}
          inert={settingsOpen || Boolean(workspaceFilePath)}
        >
          {renderActiveRoute({ route, ...routeRenderProps })}
        </div>
      </Suspense>
      {workspaceFilePath && !settingsOpen ? <WorkspaceFilePreview path={workspaceFilePath} onClose={closeWorkspaceFile} /> : null}
      {settingsOpen ? (
        <Suspense fallback={<div className="route-loading" role="status" aria-live="polite"><div className="route-loading-skeleton" /></div>}>
          {renderActiveRoute({ route: { page: "settings", state: settingsRouteState, nonce: 0 }, ...routeRenderProps })}
        </Suspense>
      ) : null}
      <GlobalSearch open={searchOpen} onClose={closeSearch} navigate={navigate} />
      <FeedbackHost />
      </AppShell>
    </FilePreviewProvider>
  );
}
