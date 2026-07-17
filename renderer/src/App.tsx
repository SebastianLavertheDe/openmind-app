import { Suspense, useCallback, useEffect, useState } from "react";
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
  const [route, setRoute] = useState<AppRoute>({ page: "ai", state: {}, nonce: 0 });
  const [searchOpen, setSearchOpen] = useState(false);
  const [navCollapsed, setNavCollapsed] = useState(() => storageJson(NAV_COLLAPSED_KEY, false));
  const ai = useAi();
  const showAiCompanion = route.page === "creative" || route.page === "projects";
  const navigate: Navigate = useCallback((page, state: AppRouteState = {}) => {
    setRoute((current) => {
      // MOTION-P0-002: 点击当前已激活导航且没有新 state 时，不递增 nonce、不重挂载页面、不重放入场动画。
      const samePage = current.page === page;
      const sameState = JSON.stringify(current.state) === JSON.stringify(state);
      if (samePage && sameState) return current;
      return { page, state, nonce: current.nonce + 1 };
    });
  }, []);
  const openSearch = useCallback(() => setSearchOpen(true), []);
  const closeSearch = useCallback(() => setSearchOpen(false), []);
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
    // Companion pages expose an explicit rail trigger. Do not auto-open the
    // companion on navigation: its measured width can otherwise force the
    // primary navigation into a rail even though the user did not collapse it.
    if (!showAiCompanion && ai.panelMode !== "collapsed") ai.setPanelMode("collapsed");
  }, [showAiCompanion, ai.panelMode, ai.setPanelMode]);
  // 窗口重新获焦时异步重探 provider：登录在后、换模型、新装 CLI 都能被捡起。
  // 探测在 worker 进程用 spawn 跑、非阻塞，完成后自动推送 snapshot，绝不卡 send。
  useEffect(() => {
    const onFocus = () => { void window.cctools.aiRefreshProviders?.().catch(() => undefined); };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, []);
  useEffect(() => {
    if (route.page === "settings") void window.cctools.aiRefreshProviders?.().catch(() => undefined);
  }, [route.page]);
  return (
    <AppShell
      page={route.page}
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
          {renderActiveRoute({ route, bootstrap, navigate, providers: ai.snapshot.providers, onRepo: () => void window.cctools.getBootstrap().then(setBootstrap) })}
        </Suspense>
      <GlobalSearch open={searchOpen} onClose={closeSearch} navigate={navigate} />
      <FeedbackHost />
    </AppShell>
  );
}
