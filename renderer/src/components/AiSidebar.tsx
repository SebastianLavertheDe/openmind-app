import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Columns2, Maximize2, MessageSquare, Minimize2, X } from "lucide-react";
import { messages as m } from "@shared/messages";
import { storageJson, writeStorage } from "../ai-utils";
import { useAiActions, useAiSnapshot, useAiUi, useSetAiDraft } from "../ai-context";
import { useModalFocusScope } from "../design-system/components";
import { RESPONSIVE_LAYOUT_BREAKPOINTS, useResponsiveLayout, type ResponsiveLayout } from "../app/responsive-layout";
import { Chat } from "./Chat";
import type { ChatDraftSubmitInput } from "../features/ai-console/composer";
import { projectsApi } from "../features/projects/projects-api";
import {
  AI_SIDEBAR_LAYOUT_KEY,
  AI_SIDEBAR_LAYOUT_SCHEMA_VERSION,
  DEFAULT_SIDEBAR_RATIOS,
  LEGACY_AI_SIDEBAR_WIDTHS_KEY,
  normalizeLegacySidebarWidths,
  normalizeSidebarRatios,
  sidebarBounds,
  sidebarRatioForWidth,
  sidebarWidthForRatio,
  type LegacySidebarWidths,
  type SidebarBounds,
  type SidebarMode,
  type SidebarRatios
} from "./ai-sidebar-layout";

const SIDEBAR_MIN_WIDTH = RESPONSIVE_LAYOUT_BREAKPOINTS.minimumCompanionWidth;

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
  const { activeSession } = useAiSnapshot();
  const ui = useAiUi();
  const actions = useAiActions();
  const setDraft = useSetAiDraft();
  const responsiveLayout = useResponsiveLayout();
  // 项目详情页打开时，侧栏里的新对话自动创建为当前项目的任务（归属该项目）；
  // 已有会话的续聊保持原作用域，走默认 actions.send。
  const projectComposeTarget = ui.projectComposeTarget;
  const handleProjectDraftSubmit = useCallback(async (input: ChatDraftSubmitInput) => {
    if (!projectComposeTarget) throw new Error("没有可归属的项目。");
    const created = await projectsApi.createTask(projectComposeTarget.projectName, firstLine(input.prompt), input.providerId);
    const result = await projectsApi.startTaskRun(projectComposeTarget.projectName, created.taskId, input.providerId, input.prompt, input.contexts);
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

  const dismissModal = useCallback(() => {
    if (panelModeRef.current === "full") ui.setPanelMode(previousMode.current);
    else ui.setPanelMode("collapsed");
  }, [ui.setPanelMode]);

  useModalFocusScope({
    open: modal && ui.panelMode !== "collapsed",
    containerRef: sidebarRef,
    triggerRef: railTriggerRef,
    onDismiss: dismissModal
  });

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

  if (ui.panelMode === "collapsed") return <button ref={railTriggerRef} className="ai-rail" data-motion="icon" aria-label={m.ai.sidebar.expand} title={m.ai.sidebar.expand} onClick={() => ui.setPanelMode("default")}><MessageSquare size={18} /></button>;
  // Once the viewport selects a single canvas it remains the visual surface,
  // even if a persisted/fullscreen panel mode is active.
  const presentationClass = detached ? " layout-companion-canvas" : full ? "" : ` layout-companion-${presentation}`;
  return (
    <aside
      ref={sidebarRef}
      className={`ai-sidebar mode-${ui.panelMode}${presentationClass}`}
      data-layout-width={Math.round(renderedWidth)}
      data-layout-ratio={preferredRatio}
      data-layout-min-width={SIDEBAR_MIN_WIDTH}
      role={modal ? "dialog" : undefined}
      aria-modal={modal ? "true" : undefined}
      aria-label={modal ? m.ai.sidebar.dialogLabel : undefined}
      tabIndex={modal ? -1 : undefined}
    >
        <div className="ai-sidebar-actions">
          {!detached && !full ? (
            <button
              type="button"
              data-motion="icon"
              aria-label={m.ai.sidebar.toggleWide}
              title={m.ai.sidebar.toggleWide}
              aria-pressed={ui.panelMode === "wide"}
              onClick={() => ui.setPanelMode(ui.panelMode === "wide" ? "default" : "wide")}
            ><Columns2 size={17} aria-hidden="true" /></button>
          ) : null}
          {!detached && !full ? (
            <button type="button" data-motion="icon" aria-label={m.ai.sidebar.fullscreen} title={m.ai.sidebar.fullscreen} onClick={() => ui.setPanelMode("full")}>
              <Maximize2 size={17} aria-hidden="true" />
            </button>
          ) : null}
          {full ? (
            <button type="button" data-motion="icon" aria-label={m.ai.sidebar.exitFullscreen} title={m.ai.sidebar.exitFullscreen} onClick={dismissModal}>
              <Minimize2 size={17} aria-hidden="true" />
            </button>
          ) : null}
          <button
            type="button"
            className="ai-sidebar-close"
            data-motion="icon"
            aria-label={m.ai.sidebar.close}
            title={m.ai.sidebar.close}
            onClick={() => ui.setPanelMode("collapsed")}
          ><X size={18} aria-hidden="true" /></button>
        </div>
        {!full && !detached ? (
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
            onPointerDown={(event) => {
              if (event.button > 0 || event.isPrimary === false) return;
              event.preventDefault();
              const element = event.currentTarget;
              element.setPointerCapture?.(event.pointerId);
              const shell = element.closest<HTMLElement>(".app-shell");
              shell?.classList.add("ai-sidebar-resizing");
              const startX = event.clientX;
              const startBounds = liveSidebarBounds({
                layout: responsiveLayout,
                navCollapsed,
                floating: modal || floating,
                floatingInlineGutter: floating ? floatingInlineGutter : 0
              });
              const startWidth = sidebarRef.current?.getBoundingClientRect().width
                || sidebarWidthForRatio(ratiosRef.current[mode], startBounds);
              let latestX = startX;
              let liveWidth = startWidth;
              let moveFrame = 0;
              const commitMove = () => {
                moveFrame = 0;
                // 拖拽期间绕过 React 与根级 CSS 变量：根变量每帧变化会让全文档
                // 样式失效（219 个 SVG 图标全部重排，实测拖动 1 秒 10 万+ 次
                // "SVG changed" 失效、单次布局 35ms+）。把像素列直接内联写到
                // shell 上，失效范围限定在网格轨道本身；松手后恢复变量并提交比例。
                liveWidth = Math.max(startBounds.minInlineSize, Math.min(startBounds.maxInlineSize, startWidth + startX - latestX));
                shell?.style.setProperty("grid-template-columns", `var(--nav-width, 260px) minmax(0, 1fr) ${Math.round(liveWidth)}px`);
                element.setAttribute("aria-valuenow", String(Math.round(liveWidth)));
              };
              const move = (moveEvent: PointerEvent) => {
                if (moveEvent.pointerId !== event.pointerId) return;
                latestX = moveEvent.clientX;
                if (!moveFrame) moveFrame = window.requestAnimationFrame(commitMove);
              };
              const cleanup = () => {
                if (moveFrame) window.cancelAnimationFrame(moveFrame);
                if (element.hasPointerCapture?.(event.pointerId)) element.releasePointerCapture(event.pointerId);
                shell?.classList.remove("ai-sidebar-resizing");
                window.removeEventListener("pointermove", move);
                window.removeEventListener("pointerup", up);
                window.removeEventListener("pointercancel", cancel);
                window.removeEventListener("keydown", key);
              };
              const finish = (restore: boolean) => {
                if (restore) liveWidth = startWidth;
                else if (moveFrame) commitMove();
                // 先把最终宽度同步为根变量（全文档失效只在松手时发生一次），
                // 再移除拖拽期的内联网格覆盖；随后的 setRatios 提交比例状态，
                // layout effect 会把变量重写为 calc 形式（宽度不变）。
                document.documentElement.style.setProperty("--ai-sidebar-preferred-width", `${Math.round(liveWidth)}px`);
                shell?.style.removeProperty("grid-template-columns");
                setRatios((current) => ({ ...current, [mode]: sidebarRatioForWidth(liveWidth, startBounds) }));
                element.setAttribute("aria-valuenow", String(Math.round(liveWidth)));
                sidebarRef.current?.setAttribute("data-layout-width", String(Math.round(liveWidth)));
                cleanup();
              };
              const key = (keyEvent: KeyboardEvent) => {
                if (keyEvent.key !== "Escape") return;
                keyEvent.preventDefault();
                finish(true);
              };
              const up = () => finish(false);
              const cancel = () => finish(true);
              window.addEventListener("pointermove", move);
              window.addEventListener("pointerup", up, { once: true });
              window.addEventListener("pointercancel", cancel, { once: true });
              window.addEventListener("keydown", key);
            }}
          />
        ) : null}
        <Chat compact onDraftSubmit={projectComposeTarget && !activeSession ? handleProjectDraftSubmit : undefined} />
    </aside>
  );
}

function firstLine(value: string): string {
  return value.trim().split(/\r?\n/)[0].slice(0, 80) || "未命名任务";
}
