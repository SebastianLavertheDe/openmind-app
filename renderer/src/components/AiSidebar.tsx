import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Maximize2, MessageSquare, Minimize2, PanelRightClose, PanelRightOpen, Plus, Rows3 } from "lucide-react";
import { messages as m } from "@shared/messages";
import { storageJson, writeStorage } from "../ai-utils";
import { useAi } from "../ai-context";
import { Select, Tooltip, useModalFocusScope } from "../design-system/components";
import { RESPONSIVE_LAYOUT_BREAKPOINTS, useResponsiveLayout, type ResponsiveLayout } from "../app/responsive-layout";
import { Chat } from "./Chat";

const WIDTHS_KEY = "openmind.ai.sidebar-widths.v1";
const SIDEBAR_MIN_WIDTH = 380;
const SIDEBAR_MAX_WIDTH = 960;
const WIDTHS_SCHEMA_VERSION = 1;
const DEFAULT_SIDEBAR_WIDTHS = { default: 420, wide: 760 } as const;

type SidebarMode = keyof typeof DEFAULT_SIDEBAR_WIDTHS;
type SidebarWidths = Record<SidebarMode, number>;

function clampPreferredWidth(width: number): number {
  return Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, width));
}

function normalizeSidebarWidths(value: unknown): SidebarWidths | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const source = "schemaVersion" in record
    ? record.schemaVersion === WIDTHS_SCHEMA_VERSION && record.widths && typeof record.widths === "object"
      ? record.widths as Record<string, unknown>
      : null
    : record;
  if (!source) return null;
  const defaultWidth = source.default;
  const wideWidth = source.wide;
  if (typeof defaultWidth !== "number" || !Number.isFinite(defaultWidth)
    || typeof wideWidth !== "number" || !Number.isFinite(wideWidth)) return null;
  return {
    default: clampPreferredWidth(defaultWidth),
    wide: clampPreferredWidth(wideWidth)
  };
}

function readSidebarWidths(): SidebarWidths {
  return normalizeSidebarWidths(storageJson<unknown>(WIDTHS_KEY, null))
    || { ...DEFAULT_SIDEBAR_WIDTHS };
}

function currentViewportWidth(): number {
  if (typeof window === "undefined") return Number.POSITIVE_INFINITY;
  return window.visualViewport?.width || window.innerWidth;
}

function maximumRenderedWidth(
  viewportWidth: number,
  floating: boolean,
  shell: ResponsiveLayout["shell"],
  workspaceMinWidth: number
): number {
  const navigationWidth = shell === "expanded"
    ? RESPONSIVE_LAYOUT_BREAKPOINTS.expandedNavigationWidth
    : shell === "rail"
      ? RESPONSIVE_LAYOUT_BREAKPOINTS.railNavigationWidth
      : 0;
  if (floating) {
    const available = viewportWidth - navigationWidth - 32;
    return Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, available));
  }
  const available = viewportWidth - navigationWidth - workspaceMinWidth;
  return Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, available));
}

function clampRenderedWidth(
  width: number,
  viewportWidth: number,
  floating: boolean,
  shell: ResponsiveLayout["shell"],
  workspaceMinWidth: number
): number {
  return Math.min(maximumRenderedWidth(viewportWidth, floating, shell, workspaceMinWidth), clampPreferredWidth(width));
}

export function AiSidebar({ openWorkbench }: { openWorkbench(): void }) {
  const ai = useAi();
  const responsiveLayout = useResponsiveLayout();
  const presentation = responsiveLayout.companion;
  const detached = presentation === "canvas";
  const floating = presentation === "overlay";
  const [widths, setWidths] = useState<SidebarWidths>(readSidebarWidths);
  const [viewportWidth, setViewportWidth] = useState(currentViewportWidth);
  const previousMode = useRef<SidebarMode>("default");
  const panelModeRef = useRef(ai.panelMode);
  const sidebarRef = useRef<HTMLElement>(null);
  const railTriggerRef = useRef<HTMLButtonElement>(null);
  const full = ai.panelMode === "full";
  const modal = detached || full;
  const mode: SidebarMode = ai.panelMode === "default"
    ? "default"
    : ai.panelMode === "wide" ? "wide" : previousMode.current;
  const preferredWidth = widths[mode];
  const renderedMaxWidth = maximumRenderedWidth(viewportWidth, modal || floating, responsiveLayout.shell, responsiveLayout.workspaceMinWidth);
  const renderedWidth = clampRenderedWidth(preferredWidth, viewportWidth, modal || floating, responsiveLayout.shell, responsiveLayout.workspaceMinWidth);
  panelModeRef.current = ai.panelMode;

  const dismissModal = useCallback(() => {
    if (panelModeRef.current === "full") ai.setPanelMode(previousMode.current);
    else ai.setPanelMode("collapsed");
  }, [ai.setPanelMode]);

  useModalFocusScope({
    open: modal && ai.panelMode !== "collapsed",
    containerRef: sidebarRef,
    triggerRef: railTriggerRef,
    onDismiss: dismissModal
  });

  useEffect(() => writeStorage(WIDTHS_KEY, {
    schemaVersion: WIDTHS_SCHEMA_VERSION,
    widths
  }), [widths]);
  useEffect(() => {
    if (ai.panelMode === "default" || ai.panelMode === "wide") previousMode.current = ai.panelMode;
  }, [ai.panelMode]);
  useLayoutEffect(() => {
    if (ai.panelMode === "default" || ai.panelMode === "wide") {
      document.documentElement.style.setProperty("--ai-sidebar-width", `${renderedWidth}px`);
    }
  }, [ai.panelMode, renderedWidth]);
  useEffect(() => {
    const updateViewportWidth = () => setViewportWidth(currentViewportWidth());
    window.addEventListener("resize", updateViewportWidth, { passive: true });
    window.visualViewport?.addEventListener("resize", updateViewportWidth, { passive: true });
    return () => {
      window.removeEventListener("resize", updateViewportWidth);
      window.visualViewport?.removeEventListener("resize", updateViewportWidth);
    };
  }, []);

  if (ai.panelMode === "collapsed") return <button ref={railTriggerRef} className="ai-rail" data-motion="icon" aria-label={m.ai.sidebar.expand} title={m.ai.sidebar.expand} onClick={() => ai.setPanelMode("default")}><MessageSquare size={18} /></button>;
  // Once the viewport selects a single canvas it remains the visual surface,
  // even if a persisted/fullscreen panel mode is active.
  const presentationClass = detached ? " layout-companion-canvas" : full ? "" : ` layout-companion-${presentation}`;
  return (
    <aside
      ref={sidebarRef}
      className={`ai-sidebar mode-${ai.panelMode}${presentationClass}`}
      data-layout-width={preferredWidth}
      data-layout-min-width={SIDEBAR_MIN_WIDTH}
      role={modal ? "dialog" : undefined}
      aria-modal={modal ? "true" : undefined}
      aria-label={modal ? "AI Assistant" : undefined}
      tabIndex={modal ? -1 : undefined}
    >
        {!full && !detached ? (
          <div
            className="ai-sidebar-resizer"
            role="separator"
            aria-label={m.ai.sidebar.width}
            aria-orientation="vertical"
            aria-valuemin={SIDEBAR_MIN_WIDTH}
            aria-valuemax={renderedMaxWidth}
            aria-valuenow={renderedWidth}
            tabIndex={0}
            onDoubleClick={() => setWidths((current) => ({ ...current, [mode]: DEFAULT_SIDEBAR_WIDTHS[mode] }))}
            onKeyDown={(event) => {
              if (event.key === "Home") {
                event.preventDefault();
                setWidths((current) => ({ ...current, [mode]: DEFAULT_SIDEBAR_WIDTHS[mode] }));
                return;
              }
              if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
              event.preventDefault();
              const delta = event.key === "ArrowLeft" ? 20 : -20;
              const width = clampRenderedWidth(renderedWidth + delta, viewportWidth, floating, responsiveLayout.shell, responsiveLayout.workspaceMinWidth);
              setWidths((current) => ({ ...current, [mode]: width }));
            }}
            onPointerDown={(event) => {
              if (event.button > 0 || event.isPrimary === false) return;
              event.preventDefault();
              const element = event.currentTarget;
              element.setPointerCapture?.(event.pointerId);
              const shell = element.closest(".app-shell");
              shell?.classList.add("ai-sidebar-resizing");
              const startX = event.clientX;
              const startWidth = renderedWidth;
              const move = (moveEvent: PointerEvent) => {
                const width = clampRenderedWidth(
                  startWidth + startX - moveEvent.clientX,
                  viewportWidth,
                  floating,
                  responsiveLayout.shell,
                  responsiveLayout.workspaceMinWidth
                );
                setWidths((current) => ({ ...current, [mode]: width }));
              };
              const cleanup = () => {
                if (element.hasPointerCapture?.(event.pointerId)) element.releasePointerCapture(event.pointerId);
                shell?.classList.remove("ai-sidebar-resizing");
                window.removeEventListener("pointermove", move);
                window.removeEventListener("pointerup", up);
                window.removeEventListener("pointercancel", cancel);
                window.removeEventListener("keydown", key);
              };
              const finish = (restore: boolean) => {
                if (restore) setWidths((current) => ({ ...current, [mode]: startWidth }));
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
        <header>
          <button className="sidebar-session-title" title={m.ai.sidebar.viewInWorkbench} onClick={openWorkbench}><span className="eyebrow">AI Assistant</span><strong>{ai.activeSession?.title || m.ai.session.new}</strong>{ai.pendingContexts.length ? <small>{m.ai.sidebar.pendingContexts(ai.pendingContexts.length)}</small> : null}</button>
          <Select
            className="sidebar-session-select"
            size="rect"
            ariaLabel={m.ai.sidebar.switchSession}
            value={ai.activeSession?.id || ""}
            onChange={(value) => void ai.setActiveSession(value || null)}
            options={[
              { value: "" as const, label: m.ai.sidebar.newDraft },
              ...ai.snapshot.sessions.filter((session) => !session.archived).map((session) => ({ value: session.id, label: session.title }))
            ]}
          />
          <div>
            <Tooltip content={m.ai.sidebar.openWorkbench}><button className="sidebar-open-workbench" data-motion="icon" aria-label={m.ai.sidebar.openWorkbench} onClick={openWorkbench}><PanelRightOpen size={15} /></button></Tooltip>
            <Tooltip content={m.ai.session.new}><button data-motion="icon" aria-label={m.ai.session.new} onClick={() => void ai.setActiveSession(null)}><Plus size={15} /></button></Tooltip>
            {!detached ? <>
              <Tooltip content={m.ai.sidebar.toggleWide}><button data-motion="icon" aria-label={m.ai.sidebar.toggleWide} onClick={() => ai.setPanelMode(ai.panelMode === "wide" ? "default" : "wide")}><Rows3 size={15} /></button></Tooltip>
              <Tooltip content={full ? m.ai.sidebar.exitFullscreen : m.ai.sidebar.fullscreen}><button data-motion="icon" aria-label={full ? m.ai.sidebar.exitFullscreen : m.ai.sidebar.fullscreen} onClick={() => ai.setPanelMode(full ? previousMode.current : "full")}>{full ? <Minimize2 size={15} /> : <Maximize2 size={15} />}</button></Tooltip>
            </> : null}
            <Tooltip content={m.ai.sidebar.collapse}><button data-motion="icon" aria-label={m.ai.sidebar.collapse} onClick={() => ai.setPanelMode("collapsed")}><PanelRightClose size={15} /></button></Tooltip>
          </div>
        </header>
        <Chat compact />
    </aside>
  );
}
