import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { ActionPresentation } from "../design-system/ResponsiveActionBar";
import { RESPONSIVE_LAYOUT_BREAKPOINTS } from "@shared/responsive-policy";
export { RESPONSIVE_LAYOUT_BREAKPOINTS } from "@shared/responsive-policy";

const maxWidth = (value: number) => `(max-width: ${value}px)`;

export const RESPONSIVE_LAYOUT_QUERIES = {
  // Companion density is independent from navigation disclosure. The shell
  // state additionally uses measured companion width plus the shared target
  // workspace width, so adding a companion can promote navigation to a rail.
  // The companion itself remains attached until the true single-canvas query;
  // its rendered width is clamped independently as the window narrows.
  companionCompact: maxWidth(RESPONSIVE_LAYOUT_BREAKPOINTS.companionCompact),
  // Split document workspaces move to master/detail before either pane becomes
  // too narrow. Navigation and companion presentation remain independent.
  workspaceSingle: maxWidth(RESPONSIVE_LAYOUT_BREAKPOINTS.workspaceSingle),
  // Navigation simplifies progressively: full/user-controlled, automatic rail,
  // then modal drawer. Rail selection is composition-aware, not a viewport query.
  shellDrawer: maxWidth(RESPONSIVE_LAYOUT_BREAKPOINTS.shellDrawer),
  narrowDensity: maxWidth(RESPONSIVE_LAYOUT_BREAKPOINTS.narrowDensity)
} as const;

export type ResponsiveLayout = {
  shell: "expanded" | "rail" | "drawer";
  companion: "docked" | "compact" | "canvas";
  workspace: "split" | "single";
  density: "comfortable" | "narrow";
  actions: ActionPresentation;
};

const WIDE_LAYOUT: ResponsiveLayout = {
  shell: "expanded",
  companion: "docked",
  workspace: "split",
  density: "comfortable",
  actions: "full"
};

type LayoutComposition = { viewportWidth: number; companionWidth: number };
type ResponsiveLayoutContextValue = {
  layout: ResponsiveLayout;
  reportComposition(composition: LayoutComposition): void;
};

const ResponsiveLayoutContext = createContext<ResponsiveLayoutContextValue | null>(null);

function currentViewportWidth(): number {
  return window.visualViewport?.width || document.documentElement.clientWidth || window.innerWidth;
}

function readLayout(media: Record<keyof typeof RESPONSIVE_LAYOUT_QUERIES, MediaQueryList>, composition: LayoutComposition): ResponsiveLayout {
  const expandedWidth = RESPONSIVE_LAYOUT_BREAKPOINTS.expandedNavigationWidth
    + RESPONSIVE_LAYOUT_BREAKPOINTS.minimumWorkspaceWidth
    + composition.companionWidth;
  const shell = media.shellDrawer.matches ? "drawer" : composition.viewportWidth < expandedWidth ? "rail" : "expanded";
  const companion = media.shellDrawer.matches
    ? "canvas"
    : media.companionCompact.matches
      ? "compact"
      : "docked";
  return {
    shell,
    companion,
    workspace: media.workspaceSingle.matches ? "single" : "split",
    density: media.narrowDensity.matches ? "narrow" : "comfortable",
    actions: shell === "drawer" ? "minimal" : shell === "rail" ? "compact" : "full"
  };
}

function sameLayout(a: ResponsiveLayout, b: ResponsiveLayout): boolean {
  return a.shell === b.shell
    && a.companion === b.companion
    && a.workspace === b.workspace
    && a.density === b.density
    && a.actions === b.actions;
}

export function ResponsiveLayoutProvider({ children }: { children: ReactNode }) {
  const media = useMemo(() => ({
    companionCompact: window.matchMedia(RESPONSIVE_LAYOUT_QUERIES.companionCompact),
    workspaceSingle: window.matchMedia(RESPONSIVE_LAYOUT_QUERIES.workspaceSingle),
    shellDrawer: window.matchMedia(RESPONSIVE_LAYOUT_QUERIES.shellDrawer),
    narrowDensity: window.matchMedia(RESPONSIVE_LAYOUT_QUERIES.narrowDensity)
  }), []);
  const [composition, setComposition] = useState<LayoutComposition>(() => ({ viewportWidth: currentViewportWidth(), companionWidth: 0 }));
  const [layout, setLayout] = useState<ResponsiveLayout>(() => readLayout(media, composition));
  const reportComposition = useCallback((next: LayoutComposition) => {
    setComposition((current) => current.viewportWidth === next.viewportWidth && current.companionWidth === next.companionWidth ? current : next);
  }, []);

  useEffect(() => {
    setLayout((current) => {
      const next = readLayout(media, composition);
      return sameLayout(current, next) ? current : next;
    });
  }, [composition, media]);

  useEffect(() => {
    let frame = 0;
    const commit = () => {
      frame = 0;
      const next = readLayout(media, { ...composition, viewportWidth: currentViewportWidth() });
      setLayout((current) => sameLayout(current, next) ? current : next);
    };
    const schedule = () => {
      if (frame) window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(commit);
    };
    Object.values(media).forEach((query) => query.addEventListener("change", schedule));
    // Electron/embedded Chromium can update matchMedia().matches during a
    // native window resize without consistently delivering every MediaQuery
    // change event. All viewport signals feed the same atomic state machine;
    // none introduce a second breakpoint path.
    window.addEventListener("resize", schedule, { passive: true });
    window.visualViewport?.addEventListener("resize", schedule, { passive: true });
    const viewportObserver = typeof ResizeObserver === "undefined"
      ? null
      : new ResizeObserver(schedule);
    viewportObserver?.observe(document.documentElement);
    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      Object.values(media).forEach((query) => query.removeEventListener("change", schedule));
      window.removeEventListener("resize", schedule);
      window.visualViewport?.removeEventListener("resize", schedule);
      viewportObserver?.disconnect();
    };
  }, [composition, media]);

  const value = useMemo(() => ({ layout, reportComposition }), [layout, reportComposition]);
  return <ResponsiveLayoutContext.Provider value={value}>{children}</ResponsiveLayoutContext.Provider>;
}

export function useResponsiveLayout(): ResponsiveLayout {
  return useContext(ResponsiveLayoutContext)?.layout || WIDE_LAYOUT;
}

export function useResponsiveCompositionReporter(): (composition: LayoutComposition) => void {
  return useContext(ResponsiveLayoutContext)?.reportComposition || (() => undefined);
}
