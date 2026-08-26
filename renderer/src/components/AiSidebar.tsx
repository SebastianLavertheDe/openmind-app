import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Maximize2, MessageSquare, Minimize2, PanelRightClose, PanelRightOpen, Plus, Rows3 } from "lucide-react";
import { messages as m } from "@shared/messages";
import { storageJson, writeStorage } from "../ai-utils";
import { useAi } from "../ai-context";
import { Select, Tooltip, useModalFocusScope } from "../design-system/components";
import { RESPONSIVE_LAYOUT_BREAKPOINTS, useResponsiveLayout, useShellLayoutMetrics, type ResponsiveLayout } from "../app/responsive-layout";
import { Chat } from "./Chat";
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

function fallbackNavigationWidth(shell: ResponsiveLayout["shell"]): number {
  return shell === "expanded"
    ? RESPONSIVE_LAYOUT_BREAKPOINTS.expandedNavigationWidth
    : shell === "rail"
      ? RESPONSIVE_LAYOUT_BREAKPOINTS.railNavigationWidth
      : 0;
}

export function AiSidebar({ openWorkbench }: { openWorkbench(): void }) {
  const ai = useAi();
  const responsiveLayout = useResponsiveLayout();
  const shellLayoutMetrics = useShellLayoutMetrics();
  const presentation = responsiveLayout.companion;
  const detached = presentation === "canvas";
  const floating = presentation === "overlay";
  const [initialPreferences] = useState<SidebarPreferences>(readSidebarPreferences);
  const [ratios, setRatios] = useState<SidebarRatios>(initialPreferences.ratios);
  const legacyWidthsRef = useRef<LegacySidebarWidths | null>(initialPreferences.legacyWidths);
  const [preferencesReady, setPreferencesReady] = useState(initialPreferences.legacyWidths === null);
  const [floatingInlineGutter, setFloatingInlineGutter] = useState(0);
  const previousMode = useRef<SidebarMode>("default");
  const panelModeRef = useRef(ai.panelMode);
  const sidebarRef = useRef<HTMLElement>(null);
  const railTriggerRef = useRef<HTMLButtonElement>(null);
  const full = ai.panelMode === "full";
  const modal = detached || full;
  const mode: SidebarMode = ai.panelMode === "default"
    ? "default"
    : ai.panelMode === "wide" ? "wide" : previousMode.current;
  const shellInlineSize = shellLayoutMetrics.measured
    ? shellLayoutMetrics.inlineSize
    : currentViewportWidth();
  const navigationInlineSize = shellLayoutMetrics.measured
    ? shellLayoutMetrics.navigationInlineSize
    : fallbackNavigationWidth(responsiveLayout.shell);
  const bounds = sidebarBounds({
    shellInlineSize,
    navigationInlineSize,
    workspaceMinInlineSize: responsiveLayout.workspaceMinWidth,
    sidebarMinInlineSize: SIDEBAR_MIN_WIDTH,
    floating: modal || floating,
    // The overlay's visual edge comes from CSS. Reading it instead of
    // duplicating a pixel value keeps the draggable bound in lockstep with
    // the rendered surface.
    floatingInlineGutter: floating ? floatingInlineGutter : 0
  });
  const boundsRef = useRef<SidebarBounds>(bounds);
  boundsRef.current = bounds;
  const preferredRatio = ratios[mode];
  const renderedWidth = sidebarWidthForRatio(preferredRatio, bounds);
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

  useLayoutEffect(() => {
    if (!floating || !sidebarRef.current) {
      if (floatingInlineGutter !== 0) setFloatingInlineGutter(0);
      return;
    }
    const rightInset = Number.parseFloat(window.getComputedStyle(sidebarRef.current).right);
    const nextGutter = Number.isFinite(rightInset) ? Math.max(0, rightInset * 2) : 0;
    if (nextGutter !== floatingInlineGutter) setFloatingInlineGutter(nextGutter);
  }, [floating, floatingInlineGutter, shellInlineSize]);

  useLayoutEffect(() => {
    const legacyWidths = legacyWidthsRef.current;
    if (!legacyWidths || bounds.usableInlineSize <= 0) return;
    setRatios({
      default: sidebarRatioForWidth(legacyWidths.default, bounds),
      wide: sidebarRatioForWidth(legacyWidths.wide, bounds)
    });
    legacyWidthsRef.current = null;
    setPreferencesReady(true);
  }, [bounds]);
  useEffect(() => {
    if (!preferencesReady) return;
    writeStorage(AI_SIDEBAR_LAYOUT_KEY, {
      schemaVersion: AI_SIDEBAR_LAYOUT_SCHEMA_VERSION,
      ratios
    });
  }, [preferencesReady, ratios]);
  useEffect(() => {
    if (ai.panelMode === "default" || ai.panelMode === "wide") previousMode.current = ai.panelMode;
  }, [ai.panelMode]);
  useLayoutEffect(() => {
    if (ai.panelMode === "default" || ai.panelMode === "wide") {
      document.documentElement.style.setProperty("--ai-sidebar-width", `${renderedWidth}px`);
    }
  }, [ai.panelMode, renderedWidth]);

  if (ai.panelMode === "collapsed") return <button ref={railTriggerRef} className="ai-rail" data-motion="icon" aria-label={m.ai.sidebar.expand} title={m.ai.sidebar.expand} onClick={() => ai.setPanelMode("default")}><MessageSquare size={18} /></button>;
  // Once the viewport selects a single canvas it remains the visual surface,
  // even if a persisted/fullscreen panel mode is active.
  const presentationClass = detached ? " layout-companion-canvas" : full ? "" : ` layout-companion-${presentation}`;
  return (
    <aside
      ref={sidebarRef}
      className={`ai-sidebar mode-${ai.panelMode}${presentationClass}`}
      data-layout-width={Math.round(renderedWidth)}
      data-layout-ratio={preferredRatio}
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
            aria-valuemin={Math.round(bounds.minInlineSize)}
            aria-valuemax={Math.round(bounds.maxInlineSize)}
            aria-valuenow={Math.round(renderedWidth)}
            tabIndex={0}
            onDoubleClick={() => setRatios((current) => ({ ...current, [mode]: DEFAULT_SIDEBAR_RATIOS[mode] }))}
            onKeyDown={(event) => {
              if (event.key === "Home") {
                event.preventDefault();
                setRatios((current) => ({ ...current, [mode]: DEFAULT_SIDEBAR_RATIOS[mode] }));
                return;
              }
              if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
              event.preventDefault();
              // Keyboard resizing follows the same proportion as pointer
              // resizing, so it feels consistent on every display size.
              const delta = bounds.usableInlineSize / 50 * (event.key === "ArrowLeft" ? 1 : -1);
              setRatios((current) => ({
                ...current,
                [mode]: sidebarRatioForWidth(renderedWidth + delta, bounds)
              }));
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
                const currentBounds = boundsRef.current;
                const ratio = sidebarRatioForWidth(startWidth + startX - moveEvent.clientX, currentBounds);
                setRatios((current) => ({ ...current, [mode]: ratio }));
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
                if (restore) {
                  const ratio = sidebarRatioForWidth(startWidth, boundsRef.current);
                  setRatios((current) => ({ ...current, [mode]: ratio }));
                }
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
