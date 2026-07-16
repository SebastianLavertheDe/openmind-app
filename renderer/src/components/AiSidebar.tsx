import { useCallback, useEffect, useRef, useState } from "react";
import { Maximize2, MessageSquare, Minimize2, PanelRightClose, PanelRightOpen, Plus, Rows3 } from "lucide-react";
import { messages as m } from "@shared/messages";
import { storageJson, writeStorage } from "../ai-utils";
import { useAi } from "../ai-context";
import { Select, Tooltip, useModalFocusScope } from "../design-system/components";
import { useResponsiveLayout } from "../app/responsive-layout";
import { Chat } from "./Chat";

const WIDTHS_KEY = "cctools.ai.sidebar-widths.v1";
const SIDEBAR_MIN_WIDTH = 380;
const SIDEBAR_MAX_WIDTH = 960;
const MAIN_MIN_WIDTH = 820;

function clampSidebarWidth(width: number, detached: boolean): number {
  if (typeof window === "undefined") return Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, width));
  const available = detached ? window.innerWidth - 64 : window.innerWidth - MAIN_MIN_WIDTH;
  const max = Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, available));
  return Math.min(max, Math.max(SIDEBAR_MIN_WIDTH, width));
}

export function AiSidebar({ openWorkbench }: { openWorkbench(): void }) {
  const ai = useAi();
  const responsiveLayout = useResponsiveLayout();
  const presentation = responsiveLayout.companion;
  const detached = presentation === "canvas";
  const [widths, setWidths] = useState(() => storageJson(WIDTHS_KEY, { default: 420, wide: 760 }));
  const previousMode = useRef<"default" | "wide">("default");
  const panelModeRef = useRef(ai.panelMode);
  const sidebarRef = useRef<HTMLElement>(null);
  const railTriggerRef = useRef<HTMLButtonElement>(null);
  const full = ai.panelMode === "full";
  panelModeRef.current = ai.panelMode;

  const dismissCanvas = useCallback(() => {
    if (panelModeRef.current === "full") ai.setPanelMode(previousMode.current);
    else ai.setPanelMode("collapsed");
  }, [ai.setPanelMode]);

  useModalFocusScope({
    open: detached && ai.panelMode !== "collapsed",
    containerRef: sidebarRef,
    triggerRef: railTriggerRef,
    onDismiss: dismissCanvas
  });

  useEffect(() => writeStorage(WIDTHS_KEY, widths), [widths]);
  useEffect(() => {
    if (ai.panelMode === "default" || ai.panelMode === "wide") previousMode.current = ai.panelMode;
    if (ai.panelMode === "default") document.documentElement.style.setProperty("--ai-sidebar-width", `${clampSidebarWidth(widths.default, detached)}px`);
    if (ai.panelMode === "wide") document.documentElement.style.setProperty("--ai-sidebar-width", `${clampSidebarWidth(widths.wide, detached)}px`);
  }, [ai.panelMode, detached, widths]);
  useEffect(() => {
    if (detached || !full) return;
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") ai.setPanelMode(previousMode.current);
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [ai.setPanelMode, detached, full]);

  if (ai.panelMode === "collapsed") return <button ref={railTriggerRef} className="ai-rail" data-motion="icon" aria-label={m.ai.sidebar.expand} title={m.ai.sidebar.expand} onClick={() => ai.setPanelMode("default")}><MessageSquare size={18} /></button>;
  const mode = ai.panelMode === "wide" ? "wide" : previousMode.current;
  // Once the viewport selects a single canvas it remains the visual surface,
  // even if a persisted/fullscreen panel mode is active.
  const presentationClass = detached ? " layout-companion-canvas" : full ? "" : ` layout-companion-${presentation}`;
  return (
    <aside
      ref={sidebarRef}
      className={`ai-sidebar mode-${ai.panelMode}${presentationClass}`}
      role={detached ? "dialog" : undefined}
      aria-modal={detached ? "true" : undefined}
      aria-label={detached ? "AI Assistant" : undefined}
      tabIndex={detached ? -1 : undefined}
    >
        {!full && !detached ? (
          <div
            className="ai-sidebar-resizer"
            role="separator"
            aria-label={m.ai.sidebar.width}
            aria-orientation="vertical"
            tabIndex={0}
            onDoubleClick={() => setWidths((current) => ({ ...current, [mode]: mode === "wide" ? 860 : 520 }))}
            onKeyDown={(event) => {
              if (event.key === "ArrowLeft") setWidths((current) => ({ ...current, [mode]: clampSidebarWidth(current[mode] + 20, detached) }));
              if (event.key === "ArrowRight") setWidths((current) => ({ ...current, [mode]: Math.max(SIDEBAR_MIN_WIDTH, current[mode] - 20) }));
            }}
            onPointerDown={(event) => {
              const element = event.currentTarget;
              element.setPointerCapture(event.pointerId);
              const startX = event.clientX;
              const startWidth = element.parentElement?.getBoundingClientRect().width || widths[mode];
              const move = (moveEvent: PointerEvent) => {
                const width = clampSidebarWidth(startWidth + startX - moveEvent.clientX, detached);
                setWidths((current) => ({ ...current, [mode]: width }));
              };
              const key = (keyEvent: KeyboardEvent) => {
                if (keyEvent.key !== "Escape") return;
                setWidths((current) => ({ ...current, [mode]: startWidth }));
                up();
              };
              const up = () => {
                window.removeEventListener("pointermove", move);
                window.removeEventListener("pointerup", up);
                window.removeEventListener("pointercancel", up);
                window.removeEventListener("keydown", key);
              };
              window.addEventListener("pointermove", move);
              window.addEventListener("pointerup", up, { once: true });
              window.addEventListener("pointercancel", up, { once: true });
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
            <Tooltip content={m.ai.sidebar.toggleWide}><button data-motion="icon" aria-label={m.ai.sidebar.toggleWide} onClick={() => ai.setPanelMode(ai.panelMode === "wide" ? "default" : "wide")}><Rows3 size={15} /></button></Tooltip>
            <Tooltip content={full ? m.ai.sidebar.exitFullscreen : m.ai.sidebar.fullscreen}><button data-motion="icon" aria-label={full ? m.ai.sidebar.exitFullscreen : m.ai.sidebar.fullscreen} onClick={() => ai.setPanelMode(full ? previousMode.current : "full")}>{full ? <Minimize2 size={15} /> : <Maximize2 size={15} />}</button></Tooltip>
            <Tooltip content={m.ai.sidebar.collapse}><button data-motion="icon" aria-label={m.ai.sidebar.collapse} onClick={() => ai.setPanelMode("collapsed")}><PanelRightClose size={15} /></button></Tooltip>
          </div>
        </header>
        <Chat compact />
    </aside>
  );
}
