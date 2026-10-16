import { OPEN_IMAGE_PROVIDER_SETTINGS } from "./provider-configuration-events";
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { messages as m } from "@shared/messages";
import { AiProvider, useAiActions, useAiSnapshot, useAiUi } from "./ai-context";
import { storageJson, writeStorage } from "./ai-utils";
import { AppShell } from "./app/AppShell";
import { ResponsiveLayoutProvider, useResponsiveLayout } from "./app/responsive-layout";
import { SidebarRecent } from "./app/SidebarRecent";
import { GlobalSearch } from "./app/GlobalSearch";
import type { AppRoute, AppRouteState, Navigate } from "./app/routes";
import { renderActiveRoute, type RouteBootstrap } from "./app/route-registry";
import { AiSidebar } from "./components/AiSidebar";
import { FeedbackHost } from "./components/FeedbackHost";
import { useExitPresence } from "./design-system/use-exit-presence";
import { FilePreviewProvider, type OpenFilePreviewOptions } from "./features/ai-console/file-preview-context";
import { applyTheme } from "./theme";
import { applyLocale, useLocale } from "./i18n";

const WorkspaceFilePreview = lazy(() => import("./components/WorkspaceFilePreview")
  .then((module) => ({ default: module.WorkspaceFilePreview })));

const NAV_COLLAPSED_KEY = "openmind.nav.collapsed.v1";
type Bootstrap = RouteBootstrap;

export function App() {
  useLocale();
  const [bootstrap, setBootstrap] = useState<Bootstrap | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!window.openmind) {
      setError(m.app.preloadMissing);
      return;
    }
    void Promise.all([
      window.openmind.getBootstrap(),
      window.openmind.getPreferences().then((preferences) => { applyLocale(preferences); applyTheme(preferences); })
    ]).then(([next]) => setBootstrap(next)).catch((cause) => setError(cause instanceof Error ? cause.message : String(cause)));
  }, []);
  if (error) return <div className="fatal"><strong>{m.app.fatalTitle}</strong><pre>{error}</pre></div>;
  if (!bootstrap) return <div className="splash"><div className="brand-mark">CC</div><span>{m.app.splashStarting}</span></div>;
  const aiStorageScope = `${bootstrap.openmindRoot}\u0000${bootstrap.workspaceRoot}`;
  return <ResponsiveLayoutProvider><WorkspaceHost bootstrap={bootstrap} setBootstrap={setBootstrap} aiStorageScope={aiStorageScope} /></ResponsiveLayoutProvider>;
}

function WorkspaceHost({ bootstrap, setBootstrap, aiStorageScope }: { bootstrap: Bootstrap; setBootstrap(value: Bootstrap): void; aiStorageScope: string }) {
  useLocale();
  // Route state lives above the keyed AI provider so setup can survive the
  // final AI hydration remount; ordinary scope switches are reset explicitly
  // below instead of relying on an outer component remount.
  const [route, setRoute] = useState<AppRoute>(() => ({ page: bootstrap.validRepo && bootstrap.skillsInstalled ? "ai" : "onboarding", state: {}, nonce: 0 }));
  // Keep the whole setup tree mounted while bootstrap advances through its
  // root and Skill gates. Otherwise changing either key remounts OnboardingPage
  // and the horizontal track jumps directly to the next panel instead of
  // animating there. Setup cannot expose drafts or sessions, so it can safely
  // use one transient provider; leaving setup remounts the provider from the
  // final scoped bootstrap before the workbench becomes visible.
  const aiReady = bootstrap.validRepo && bootstrap.skillsInstalled && Boolean(bootstrap.workspaceRoot);
  const previousAiStorageScope = useRef(aiStorageScope);
  useEffect(() => {
    const scopeChanged = previousAiStorageScope.current !== aiStorageScope;
    previousAiStorageScope.current = aiStorageScope;
    if (!scopeChanged) return;
    setRoute((current) => current.page === "onboarding"
      ? current
      : { page: aiReady ? "ai" : "onboarding", state: {}, nonce: 0 });
  }, [aiReady, aiStorageScope]);
  const aiProviderKey = route.page === "onboarding"
    ? "onboarding-setup"
    : `${aiStorageScope}\u0000${aiReady ? "ready" : "setup"}`;
  return <AiProvider key={aiProviderKey} storageScope={aiStorageScope} initial={bootstrap.ai} skills={bootstrap.skills}><Workspace bootstrap={bootstrap} setBootstrap={setBootstrap} route={route} setRoute={setRoute} /></AiProvider>;
}

function Workspace({
  bootstrap,
  setBootstrap,
  route,
  setRoute
}: {
  bootstrap: Bootstrap;
  setBootstrap(value: Bootstrap): void;
  route: AppRoute;
  setRoute: Dispatch<SetStateAction<AppRoute>>;
}) {
  const locale = useLocale();
  const responsiveLayout = useResponsiveLayout();
  // A valid openmind root plus the official cctools-skills repository installed
  // are the actual first-start gate. The checklist remains available during
  // setup, while an already configured workspace still opens directly on a
  // later launch even if an old app-private onboarding flag is stale.
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsRouteState, setSettingsRouteState] = useState<AppRouteState>({});
  const [searchOpen, setSearchOpen] = useState(false);
  const [workspaceFilePath, setWorkspaceFilePath] = useState<string | null>(null);
  const [workspaceFileProjectName, setWorkspaceFileProjectName] = useState<string | undefined>();
  const [aiFilePreviewPath, setAiFilePreviewPath] = useState<string | null>(null);
  const [navCollapsed, setNavCollapsed] = useState(() => storageJson(NAV_COLLAPSED_KEY, false));
  // Slice subscriptions instead of the full useAi() controller: the workspace
  // shell only needs snapshot data plus UI/actions, so a streaming event
  // flush (events slice) must not re-render the entire route content tree.
  const { snapshot, activeSession } = useAiSnapshot();
  const ui = useAiUi();
  const actions = useAiActions();
  const showAiCompanion = route.page === "creative" || route.page === "brief" || route.page === "projects";
  const previousRoutePage = useRef<AppRoute["page"] | null>(null);
  const searchTriggerRef = useRef<HTMLElement | null>(null);
  const refreshBootstrap = useCallback(async (_root?: string): Promise<Bootstrap> => {
    const next = await window.openmind.getBootstrap();
    setBootstrap(next);
    return next;
  }, [setBootstrap]);
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
  useEffect(() => {
    const openImageSettings = () => navigate("settings", { settingsSection: "providers", providerCategory: "image" });
    window.addEventListener(OPEN_IMAGE_PROVIDER_SETTINGS, openImageSettings);
    return () => window.removeEventListener(OPEN_IMAGE_PROVIDER_SETTINGS, openImageSettings);
  }, [navigate]);
  const openNewTask = useCallback(() => {
    // A new task owns a fresh conversation canvas. Clear both preview surfaces
    // and force a new AI route instance so an in-flight file load cannot keep
    // rendering beside the blank draft.
    setAiFilePreviewPath(null);
    setWorkspaceFilePath(null);
    void actions.setActiveSession(null);
    setSettingsOpen(false);
    setRoute((current) => ({ page: "ai", state: {}, nonce: current.nonce + 1 }));
  }, [actions.setActiveSession, setRoute]);
  const exitSettings = useCallback(() => {
    setSettingsOpen(false);
    window.requestAnimationFrame(() => {
      document.querySelector<HTMLButtonElement>(`button[aria-label="${m.nav.settings}"]`)?.focus({ preventScroll: true });
    });
  }, []);
  const openSearch = useCallback(() => {
    const activeElement = document.activeElement;
    searchTriggerRef.current = activeElement instanceof HTMLElement && activeElement !== document.body
      ? activeElement
      : document.querySelector<HTMLElement>('[data-action-id="search"]');
    setSearchOpen(true);
  }, []);
  const closeSearch = useCallback(() => setSearchOpen(false), []);
  const openWorkspaceFile = useCallback((path: string, options?: OpenFilePreviewOptions) => {
    setWorkspaceFileProjectName(options?.projectName);
    setWorkspaceFilePath(path);
  }, []);
  const closeWorkspaceFile = useCallback(() => setWorkspaceFilePath(null), []);
  const embeddedFilePreviewPath = route.page === "brief" ? workspaceFilePath : null;
  const standaloneFilePreviewPath = route.page === "brief" ? null : workspaceFilePath;
  const standalonePreviewOpen = Boolean(standaloneFilePreviewPath) && !settingsOpen;
  const standalonePreviewPresence = useExitPresence(standalonePreviewOpen, 160);
  const lastStandaloneFilePreviewPath = useRef<string | null>(standaloneFilePreviewPath);
  if (standaloneFilePreviewPath) lastStandaloneFilePreviewPath.current = standaloneFilePreviewPath;
  const renderedStandaloneFilePreviewPath = standaloneFilePreviewPath ?? lastStandaloneFilePreviewPath.current;
  const standalonePreviewCovered = route.page !== "brief" && !settingsOpen && standalonePreviewPresence.visible;
  useEffect(() => writeStorage(NAV_COLLAPSED_KEY, navCollapsed), [navCollapsed]);
  useEffect(() => { void window.openmind.getPreferences().then(applyTheme).catch(() => { /* 浅色为 :root 默认,失败无需处理 */ }); }, []);
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
      // First start is a dedicated configuration surface. Global workbench
      // shortcuts must not provide a hidden route around its explicit flow.
      if (route.page === "onboarding") return;
      const key = event.key.toLowerCase();
      if (key === "k") { event.preventDefault(); openSearch(); }
      else if (key === "n") { event.preventDefault(); openNewTask(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [openNewTask, openSearch, route.page]);
  useEffect(() => {
    const enteredPage = previousRoutePage.current !== route.page;
    previousRoutePage.current = route.page;
    if (!showAiCompanion) {
      if (ui.panelMode !== "collapsed") ui.setPanelMode("collapsed");
      return;
    }
    // 每日简报首次进入时直接提供对话框；同页手动收起后保持用户选择。
    if (route.page === "brief" && enteredPage && ui.panelMode === "collapsed" && responsiveLayout.companion !== "canvas") {
      ui.setPanelMode("default");
    }
  }, [responsiveLayout.companion, route.page, showAiCompanion, ui.panelMode, ui.setPanelMode]);
  useEffect(() => {
    // Project sessions are only valid inside the Project task surface. Clear
    // the global selection when leaving Projects so Creative, Brief and the
    // ordinary AI workbench cannot accidentally render or continue it.
    if (route.page !== "projects" && activeSession?.scope?.type === "project-task") {
      void actions.setActiveSession(null);
    }
  }, [activeSession?.id, activeSession?.scope?.type, actions.setActiveSession, route.page]);
  // 窗口重新获焦时异步重探 provider：登录在后、换模型、新装 CLI 都能被捡起。
  // 探测在 worker 进程用 spawn 跑、非阻塞，完成后自动推送 snapshot，绝不卡 send。
  useEffect(() => {
    const onFocus = () => { void window.openmind.aiRefreshProviders?.().catch(() => undefined); };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, []);
  useEffect(() => {
    if (settingsOpen) void window.openmind.aiRefreshProviders?.().catch(() => undefined);
  }, [settingsOpen]);
  useEffect(() => setWorkspaceFilePath(null), [route.page, route.nonce, settingsOpen]);
  // 导航收起是 AppShell/AiSidebar 关心的状态，路由内容与其无关。缓存这些
  // 元素让 React 在 navCollapsed 变化时整树跳过重渲染（性能：收起导航不应
  // 重新渲染 184 行文件列表 + 预览阅读器 + AI 工作台）。
  const routeRenderProps = useMemo(() => ({
    bootstrap,
    navigate,
    providers: snapshot.providers,
    aiFilePreviewPath,
    onAiFilePreviewPathChange: setAiFilePreviewPath,
    embeddedFilePreviewPath,
    onCloseEmbeddedFilePreview: closeWorkspaceFile,
    confirmAction: ui.confirm,
    onRepo: refreshBootstrap,
    onExitSettings: exitSettings
  }), [bootstrap, navigate, snapshot.providers, aiFilePreviewPath, setAiFilePreviewPath, embeddedFilePreviewPath, closeWorkspaceFile, ui.confirm, refreshBootstrap, exitSettings, locale]);
  const aiSidebarElement = useMemo(
    () => showAiCompanion ? <AiSidebar navCollapsed={navCollapsed} /> : null,
    [showAiCompanion, navCollapsed, locale]
  );
  const recentTasksElement = useMemo(() => <SidebarRecent
    activeSessionId={
      route.page === "ai" && activeSession?.scope.type === "workspace"
        ? activeSession.id
        : route.page === "projects" && activeSession?.scope.type === "project-task"
          ? activeSession.id
          : null
    }
    onOpen={(session) => {
      if (session.scope.type === "project-task") {
        navigate("projects", {
          projectName: session.scope.projectName,
          projectSection: "tasks",
          projectItem: session.scope.taskId
        });
        return;
      }
      void actions.setActiveSession(session.id);
      navigate("ai");
    }}
  />, [route.page, activeSession?.id, activeSession?.scope.type, actions.setActiveSession, navigate, locale]);
  const routeContent = useMemo(() => (
    <>
      <Suspense fallback={<div className="route-loading" role="status" aria-live="polite"><div className="route-loading-skeleton" /></div>}>
        <div
          className={`settings-preserved-route${settingsOpen ? " is-covered" : ""}`}
          aria-hidden={settingsOpen || standalonePreviewCovered || undefined}
          inert={settingsOpen || standalonePreviewCovered}
        >
          {renderActiveRoute({ route, ...routeRenderProps })}
        </div>
      </Suspense>
      {standalonePreviewPresence.visible && renderedStandaloneFilePreviewPath && route.page !== "brief" && !settingsOpen ? (
        <div
          className="standalone-file-preview-presence"
          data-leaving={standalonePreviewPresence.leaving || undefined}
          aria-hidden={standalonePreviewPresence.leaving || undefined}
          inert={standalonePreviewPresence.leaving || undefined}
        >
          <Suspense fallback={<div className="preview-state">{m.ai.workbench.loadingFile}</div>}>
            <WorkspaceFilePreview path={renderedStandaloneFilePreviewPath} projectName={workspaceFileProjectName} onClose={closeWorkspaceFile} />
          </Suspense>
        </div>
      ) : null}
      {settingsOpen ? (
        <Suspense fallback={<div className="route-loading" role="status" aria-live="polite"><div className="route-loading-skeleton" /></div>}>
          {renderActiveRoute({ route: { page: "settings", state: settingsRouteState, nonce: 0 }, ...routeRenderProps })}
        </Suspense>
      ) : null}
    </>
  ), [closeWorkspaceFile, renderedStandaloneFilePreviewPath, route, routeRenderProps, settingsOpen, settingsRouteState, standalonePreviewCovered, standalonePreviewPresence.leaving, standalonePreviewPresence.visible, locale]);
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
      pendingApprovals={snapshot.pendingApprovals.length}
      aiSessionOpen={Boolean(activeSession)}
      aiMode={showAiCompanion ? ui.panelMode : "collapsed"}
      aiSidebar={aiSidebarElement}
      recentTasks={recentTasksElement}
      onNewTask={openNewTask}
      >
      {routeContent}
      <GlobalSearch open={searchOpen} triggerRef={searchTriggerRef} onClose={closeSearch} navigate={navigate} onOpenContent={openWorkspaceFile} />
      <FeedbackHost />
      </AppShell>
    </FilePreviewProvider>
  );
}
