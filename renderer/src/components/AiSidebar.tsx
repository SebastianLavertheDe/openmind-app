import { Drawer } from "../design-system/components";
import { IconButton } from "../design-system/IconButton";
import { usePointerResize } from "../design-system/use-pointer-resize";
import { useLocale } from "../i18n";
import { messages as uiMessages } from "@shared/messages";
import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { MessageSquare, Minimize2, X } from "lucide-react";
import { messages as m } from "@shared/messages";
import { storageJson, writeStorage } from "../ai-utils";
import { useAiActions, useAiSnapshot, useAiUi, useSetAiDraft } from "../ai-context";

import { useExitPresence } from "../design-system/use-exit-presence";
import { RESPONSIVE_LAYOUT_BREAKPOINTS, useResponsiveLayout, type ResponsiveLayout } from "../app/responsive-layout";
import type { ChatDraftSubmitInput } from "../features/ai-console/composer";
import { FilePreviewProvider, useFilePreview } from "../features/ai-console/file-preview-context";
import { projectsApi } from "../features/projects/projects-api";
import { AI_SIDEBAR_LAYOUT_KEY, AI_SIDEBAR_LAYOUT_SCHEMA_VERSION, DEFAULT_SIDEBAR_RATIOS, LEGACY_AI_SIDEBAR_WIDTHS_KEY, normalizeLegacySidebarWidths, normalizeSidebarRatios, sidebarBounds, sidebarRatioForWidth, sidebarWidthForRatio, type LegacySidebarWidths, type SidebarBounds, type SidebarMode, type SidebarRatios } from "./ai-sidebar-layout";

const SIDEBAR_MIN_WIDTH = RESPONSIVE_LAYOUT_BREAKPOINTS.minimumCompanionWidth;
const Chat = lazy(() => import("./Chat").then((module) => ({ default: module.Chat })));

type SidebarPreferences = {
  ratios: SidebarRatios;
  legacyWidths: LegacySidebarWidths | null;
};

function readSidebarPreferences(): SidebarPreferences {
  const ratios = normalizeSidebarRatios(storageJson<unknown>(AI_SIDEBAR_LAYOUT_KEY, null));
  if (ratios) return { ratios, legacyWidths: null };
  return {
    ratios: { ...DEFAULT_SIDEBAR_RATIOS },
    legacyWidths: normalizeLegacySidebarWidths(storageJson<unknown>(LEGACY_AI_SIDEBAR_WIDTHS_KEY, null), SIDEBAR_MIN_WIDTH)
  };
}

function currentViewportWidth(): number {
  if (typeof window === "undefined") return Number.POSITIVE_INFINITY;
  return window.visualViewport?.width || window.innerWidth;
}

function fallbackNavigationWidth(shell: ResponsiveLayout["shell"], navCollapsed: boolean): number {
  return shell === "expanded"
    ? navCollapsed
      ? RESPONSIVE_LAYOUT_BREAKPOINTS.railNavigationWidth
      : RESPONSIVE_LAYOUT_BREAKPOINTS.expandedNavigationWidth
    : shell === "rail"
      ? RESPONSIVE_LAYOUT_BREAKPOINTS.railNavigationWidth
      : 0;
}

function liveSidebarBounds({
  layout,
  navCollapsed,
  floating,
  floatingInlineGutter
}: {
  layout: ResponsiveLayout;
  navCollapsed: boolean;
  floating: boolean;
  floatingInlineGutter: number;
}): SidebarBounds {
  return sidebarBounds({
    shellInlineSize: currentViewportWidth(),
    navigationInlineSize: fallbackNavigationWidth(layout.shell, navCollapsed),
    workspaceMinInlineSize: layout.workspaceMinWidth,
    sidebarMinInlineSize: SIDEBAR_MIN_WIDTH,
    floating,
    floatingInlineGutter
  });
}

function setNumericAttribute(element: HTMLElement, name: string, value: number): void {
  const next = String(Math.round(value));
  if (element.getAttribute(name) !== next) element.setAttribute(name, next);
}

export function AiSidebar({ navCollapsed = false }: { navCollapsed?: boolean }) {
  const locale = useLocale();
  const { activeSession } = useAiSnapshot();
  const parentOpenFilePreview = useFilePreview();
  const ui = useAiUi();
  const actions = useAiActions();
  const setDraft = useSetAiDraft();
  const responsiveLayout = useResponsiveLayout();
  // 项目详情页打开时，侧栏里的新对话自动创建为当前项目的任务（归属该项目）；
  // 已有会话的续聊保持原作用域，走默认 actions.send。
  const projectComposeTarget = ui.projectComposeTarget;
  const previewProjectName = activeSession?.scope.type === "project-task"
    ? activeSession.scope.projectName
    : undefined;
  const openScopedFilePreview = useCallback((path: string) => {
    parentOpenFilePreview?.(path, previewProjectName ? { projectName: previewProjectName } : undefined);
  }, [parentOpenFilePreview, previewProjectName]);
  const handleProjectDraftSubmit = useCallback(async (input: ChatDraftSubmitInput) => {
    if (!projectComposeTarget) throw new Error(uiMessages.interface.noProject);
    const created = await projectsApi.createTask(projectComposeTarget.projectName, firstLine(input.prompt), input.providerId);
    const result = await projectsApi.startTaskRun(
      projectComposeTarget.projectName,
      created.taskId,
      input.providerId,
      input.prompt,
      input.contexts,
      input.permissionProfile
    );
    setDraft("");
    actions.clearContexts();
    await actions.refresh();
    await actions.setActiveSession(result.session.id);
  }, [actions.clearContexts, actions.refresh, actions.setActiveSession, projectComposeTarget, setDraft]);
  const presentation = responsiveLayout.companion;
  const detached = presentation === "canvas";
  const floating = presentation === "overlay";
  const [initialPreferences] = useState<SidebarPreferences>(readSidebarPreferences);
  const [ratios, setRatios] = useState<SidebarRatios>(initialPreferences.ratios);
  const legacyWidthsRef = useRef<LegacySidebarWidths | null>(initialPreferences.legacyWidths);
  const [preferencesReady, setPreferencesReady] = useState(initialPreferences.legacyWidths === null);
  const [floatingInlineGutter, setFloatingInlineGutter] = useState(0);
  const previousMode = useRef<SidebarMode>("default");
  const panelModeRef = useRef(ui.panelMode);
  const sidebarRef = useRef<HTMLElement>(null);
  const railTriggerRef = useRef<HTMLButtonElement>(null);
  const full = ui.panelMode === "full";
  const modal = detached || full;
  const mode: SidebarMode = ui.panelMode === "default"
    ? "default"
    : ui.panelMode === "wide" ? "wide" : previousMode.current;
  const bounds = liveSidebarBounds({
    layout: responsiveLayout,
    navCollapsed,
    floating: modal || floating,
    floatingInlineGutter: floating ? floatingInlineGutter : 0
  });
  const preferredRatio = ratios[mode];
  const renderedWidth = sidebarWidthForRatio(preferredRatio, bounds);
  panelModeRef.current = ui.panelMode;
  const panelOpen = ui.panelMode !== "collapsed";
  const animatedSurface = modal || floating;
  const panelPresence = useExitPresence(panelOpen && animatedSurface, 200);
  const livePresentationClass = detached ? " layout-companion-canvas" : full ? "" : ` layout-companion-${presentation}`;
  const liveRenderState = { panelMode: ui.panelMode, full, detached, modal, presentationClass: livePresentationClass };
  const lastOpenRenderState = useRef(liveRenderState);
  const lastOpenWasAnimated = useRef(animatedSurface);
  if (panelOpen) {
    lastOpenRenderState.current = liveRenderState;
    lastOpenWasAnimated.current = animatedSurface;
  }
  const exitingPanel = !panelOpen && lastOpenWasAnimated.current && panelPresence.visible;
  const renderState = exitingPanel ? lastOpenRenderState.current : liveRenderState;

  const dismissModal = useCallback(() => {
    if (panelModeRef.current === "full") ui.setPanelMode(previousMode.current);
    else ui.setPanelMode("collapsed");
  }, [ui.setPanelMode]);



  useLayoutEffect(() => {
    if (!floating || !sidebarRef.current) {
      if (floatingInlineGutter !== 0) setFloatingInlineGutter(0);
      return;
    }
    const rightInset = Number.parseFloat(window.getComputedStyle(sidebarRef.current).right);
    const nextGutter = Number.isFinite(rightInset) ? Math.max(0, rightInset * 2) : 0;
    if (nextGutter !== floatingInlineGutter) setFloatingInlineGutter(nextGutter);
  }, [floating, floatingInlineGutter]);

  useLayoutEffect(() => {
    const legacyWidths = legacyWidthsRef.current;
    if (!legacyWidths || bounds.usableInlineSize <= 0) return;
    setRatios({
      default: sidebarRatioForWidth(legacyWidths.default, bounds),
      wide: sidebarRatioForWidth(legacyWidths.wide, bounds)
    });
    legacyWidthsRef.current = null;
    setPreferencesReady(true);
  }, [bounds.maxInlineSize, bounds.minInlineSize, bounds.usableInlineSize]);
  const ratiosRef = useRef(ratios);
  ratiosRef.current = ratios;
  const preferencesReadyRef = useRef(preferencesReady);
  preferencesReadyRef.current = preferencesReady;
  useEffect(() => {
    if (!preferencesReady) return;
    const timer = window.setTimeout(() => writeStorage(AI_SIDEBAR_LAYOUT_KEY, {
      schemaVersion: AI_SIDEBAR_LAYOUT_SCHEMA_VERSION,
      ratios
    }), 120);
    return () => window.clearTimeout(timer);
  }, [preferencesReady, ratios]);
  useEffect(() => () => {
    if (!preferencesReadyRef.current) return;
    writeStorage(AI_SIDEBAR_LAYOUT_KEY, {
      schemaVersion: AI_SIDEBAR_LAYOUT_SCHEMA_VERSION,
      ratios: ratiosRef.current
    });
  }, []);
  useEffect(() => {
    if (ui.panelMode === "default" || ui.panelMode === "wide") previousMode.current = ui.panelMode;
  }, [ui.panelMode]);
  useLayoutEffect(() => {
    if (ui.panelMode === "default" || ui.panelMode === "wide") {
      const navigationInlineSize = fallbackNavigationWidth(responsiveLayout.shell, navCollapsed);
      // Keep the computed CSS expression stable while the native window is
      // resized. Its percentage resolves directly against the live shell, so
      // layout follows every frame without restarting the semantic transition.
      document.documentElement.style.setProperty(
        "--ai-sidebar-preferred-width",
        `calc(${preferredRatio * 100}% - ${navigationInlineSize * preferredRatio}px)`
      );
      document.documentElement.style.setProperty("--ai-workspace-min-width", `${responsiveLayout.workspaceMinWidth}px`);
    }
  }, [ui.panelMode, navCollapsed, preferredRatio, responsiveLayout.shell, responsiveLayout.workspaceMinWidth]);

  useLayoutEffect(() => {
    const sidebar = sidebarRef.current;
    const separator = sidebar?.querySelector<HTMLElement>(".ai-sidebar-resizer");
    if (!sidebar || !separator || typeof ResizeObserver === "undefined") return;
    let frame = 0;
    const syncGeometry = () => {
      frame = 0;
      const liveBounds = liveSidebarBounds({
        layout: responsiveLayout,
        navCollapsed,
        floating: modal || floating,
        floatingInlineGutter: floating ? floatingInlineGutter : 0
      });
      // 拖拽改变宽度时本回调每帧触发：此处读 getBoundingClientRect 会强制
      // 整个工作区同步布局（大文档一次几十毫秒），改用与渲染一致的比值计算。
      const width = sidebarWidthForRatio(ratiosRef.current[mode], liveBounds);
      setNumericAttribute(sidebar, "data-layout-width", width);
      setNumericAttribute(separator, "aria-valuemin", liveBounds.minInlineSize);
      setNumericAttribute(separator, "aria-valuemax", liveBounds.maxInlineSize);
      setNumericAttribute(separator, "aria-valuenow", width);
    };
    const schedule = () => {
      // Pointer resizing owns the live pixel geometry and updates the final
      // attributes itself. Avoid running a second, stale ratio-based geometry
      // writer in parallel with every drag frame.
      if (sidebar.closest(".app-shell")?.classList.contains("ai-sidebar-resizing")) return;
      if (!frame) frame = window.requestAnimationFrame(syncGeometry);
    };
    syncGeometry();
    const observer = new ResizeObserver(schedule);
    observer.observe(sidebar);
    observer.observe(document.documentElement);
    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [floating, floatingInlineGutter, modal, mode, navCollapsed, responsiveLayout]);

  const startResize = usePointerResize(event => {
    const element = event.currentTarget;
    const shell = element.closest<HTMLElement>(".app-shell");
    shell?.classList.add("ai-sidebar-resizing");
    const startBounds = liveSidebarBounds({ layout: responsiveLayout, navCollapsed,
      floating: modal || floating, floatingInlineGutter: floating ? floatingInlineGutter : 0 });
    const startWidth = sidebarRef.current?.getBoundingClientRect().width
      || sidebarWidthForRatio(ratiosRef.current[mode], startBounds);
    let liveWidth = startWidth;
    return {
      move(_delta, total) {
        // Keep per-frame writes local to the grid; commit React state only on release.
        liveWidth = Math.max(startBounds.minInlineSize, Math.min(startBounds.maxInlineSize, startWidth - total));
        shell?.style.setProperty("grid-template-columns", `var(--nav-width, 260px) minmax(0, 1fr) ${Math.round(liveWidth)}px`);
        element.setAttribute("aria-valuenow", String(Math.round(liveWidth)));
      },
      end(cancelled) {
        if (cancelled) liveWidth = startWidth;
        document.documentElement.style.setProperty("--ai-sidebar-preferred-width", `${Math.round(liveWidth)}px`);
        shell?.style.removeProperty("grid-template-columns");
        shell?.classList.remove("ai-sidebar-resizing");
        setRatios(current => ({ ...current, [mode]: sidebarRatioForWidth(liveWidth, startBounds) }));
        element.setAttribute("aria-valuenow", String(Math.round(liveWidth)));
        sidebarRef.current?.setAttribute("data-layout-width", String(Math.round(liveWidth)));
      }
    };
  }, panelOpen && !full && !detached);

  const rail = <IconButton ref={railTriggerRef} className="ai-rail" data-entering={exitingPanel || undefined} data-motion="icon" onClick={() => ui.setPanelMode("default")} label={m.ai.sidebar.expand}><MessageSquare size={18} /></IconButton>;
  if (!panelOpen && !exitingPanel) return rail;
  // Once the viewport selects a single canvas it remains the visual surface,
  // even if a persisted/fullscreen panel mode is active.
  return (
    <>
      {exitingPanel ? rail : null}
      <Drawer modal={renderState.modal} open={modal && ui.panelMode !== "collapsed"} onClose={dismissModal} containerRef={sidebarRef} triggerRef={railTriggerRef}

        className={`ai-sidebar mode-${renderState.panelMode}${renderState.presentationClass}`}
        data-layout-width={Math.round(renderedWidth)}
        data-layout-ratio={preferredRatio}
        data-layout-min-width={SIDEBAR_MIN_WIDTH}
        data-leaving={exitingPanel || undefined}
        aria-hidden={exitingPanel || undefined}
        inert={exitingPanel || undefined}


        aria-label={renderState.modal ? m.ai.sidebar.dialogLabel : undefined}
        tabIndex={renderState.modal ? -1 : undefined}
      >
        <div className="ai-sidebar-actions">
          {renderState.full ? (
            <IconButton type="button" data-motion="icon" onClick={dismissModal}  label={m.ai.sidebar.exitFullscreen}>
              <Minimize2 size={17} aria-hidden="true" />
            </IconButton>
          ) : null}
          <IconButton type="button" className="ai-sidebar-close" data-motion="icon" onClick={() => ui.setPanelMode("collapsed")} label={m.ai.sidebar.close}><X size={18} aria-hidden="true" /></IconButton>
        </div>
        {!renderState.full && !renderState.detached ? (
          <div
            className="ai-sidebar-resizer"
            role="separator"
            aria-label={m.ai.sidebar.width}
            aria-orientation="vertical"
            aria-valuemin={Math.round(bounds.minInlineSize)}
            aria-valuemax={Math.round(bounds.maxInlineSize)}
            aria-valuenow={Math.round(renderedWidth)}
            tabIndex={0}
            onDoubleClick={() => setRatios((current) => ({ ...current, [mode]: DEFAULT_SIDEBAR_RATIOS[mode] }))}
            onKeyDown={(event) => {
              const liveBounds = liveSidebarBounds({
                layout: responsiveLayout,
                navCollapsed,
                floating: modal || floating,
                floatingInlineGutter: floating ? floatingInlineGutter : 0
              });
              const liveWidth = sidebarRef.current?.getBoundingClientRect().width
                || sidebarWidthForRatio(ratiosRef.current[mode], liveBounds);
              if (event.key === "Home") {
                event.preventDefault();
                setRatios((current) => ({ ...current, [mode]: DEFAULT_SIDEBAR_RATIOS[mode] }));
                return;
              }
              if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
              event.preventDefault();
              // Keyboard resizing follows the same proportion as pointer
              // resizing, so it feels consistent on every display size.
              const delta = liveBounds.usableInlineSize / 50 * (event.key === "ArrowLeft" ? 1 : -1);
              setRatios((current) => ({
                ...current,
                [mode]: sidebarRatioForWidth(liveWidth + delta, liveBounds)
              }));
            }}
            onPointerDown={startResize}
          />
        ) : null}
        <Suspense fallback={<div className="route-loading" role="status"><div className="route-loading-skeleton" /></div>}>
          {parentOpenFilePreview ? (
            <FilePreviewProvider open={openScopedFilePreview}>
              <Chat compact onDraftSubmit={projectComposeTarget && !activeSession ? handleProjectDraftSubmit : undefined} />
            </FilePreviewProvider>
          ) : (
            <Chat compact onDraftSubmit={projectComposeTarget && !activeSession ? handleProjectDraftSubmit : undefined} />
          )}
        </Suspense>
      </Drawer>
    </>
  );
}

function firstLine(value: string): string {
  return value.trim().split(/\r?\n/)[0].slice(0, 80) || uiMessages.interface.untitledTask;
}
