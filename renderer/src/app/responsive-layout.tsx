import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useState, type ReactNode, type RefObject } from "react";
import type { ActionPresentation } from "../design-system/ResponsiveActionBar";
import { RESPONSIVE_LAYOUT_BREAKPOINTS } from "@shared/responsive-policy";
export { RESPONSIVE_LAYOUT_BREAKPOINTS } from "@shared/responsive-policy";

const maxWidth = (value: number) => `(max-width: ${value}px)`;

export const RESPONSIVE_LAYOUT_QUERIES = {
  // Companion density is independent from navigation disclosure. Its minimum
  // viable width determines whether it remains attached or becomes an overlay;
  // its user-preferred width never collapses primary navigation.
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
  companion: "docked" | "compact" | "overlay" | "canvas";
  workspace: "split" | "single";
  workspaceMinWidth: number;
  density: "comfortable" | "narrow";
  actions: ActionPresentation;
};

const WIDE_LAYOUT: ResponsiveLayout = {
  shell: "expanded",
  companion: "docked",
  workspace: "split",
  workspaceMinWidth: RESPONSIVE_LAYOUT_BREAKPOINTS.minimumWorkspaceWidth,
  density: "comfortable",
  actions: "full"
};

export type LayoutComposition = {
  viewportWidth: number;
  /** Measured navigation track; it reflects a user-collapsed rail as well. */
  navigationInlineSize?: number;
  companionWidth: number;
  companionMinWidth?: number;
  workspaceMinWidth?: number;
};

/**
 * Measured from the application shell rather than from the browser viewport.
 * Split panes consume this one value so maximized, restored, and high-DPI
 * windows cannot follow independent width calculations.
 */
export type ShellLayoutMetrics = {
  inlineSize: number;
  navigationInlineSize: number;
  measured: boolean;
};

const EMPTY_SHELL_LAYOUT_METRICS: ShellLayoutMetrics = {
  inlineSize: 0,
  navigationInlineSize: 0,
  measured: false
};

type ResponsiveLayoutContextValue = {
  layout: ResponsiveLayout;
  reportComposition(composition: LayoutComposition): void;
  reportWorkspaceMinimum(minWidth: number | null): void;
};

const ResponsiveLayoutContext = createContext<ResponsiveLayoutContextValue | null>(null);
const ShellLayoutMetricsContext = createContext<ShellLayoutMetrics>(EMPTY_SHELL_LAYOUT_METRICS);

export function ShellLayoutMetricsProvider({ value, children }: { value: ShellLayoutMetrics; children: ReactNode }) {
  return <ShellLayoutMetricsContext.Provider value={value}>{children}</ShellLayoutMetricsContext.Provider>;
}

export function useShellLayoutMetrics(): ShellLayoutMetrics {
  return useContext(ShellLayoutMetricsContext);
}

function currentViewportWidth(): number {
  return window.visualViewport?.width || document.documentElement.clientWidth || window.innerWidth;
}

function readLayout(media: Record<keyof typeof RESPONSIVE_LAYOUT_QUERIES, MediaQueryList>, composition: LayoutComposition): ResponsiveLayout {
  // Navigation disclosure is based only on whether the primary workspace can
  // remain usable. A user-resized companion is a preference, not a hard
  // requirement, so it must not force the primary navigation into a rail.
  const workspaceMinWidth = Math.max(0, composition.workspaceMinWidth ?? RESPONSIVE_LAYOUT_BREAKPOINTS.minimumWorkspaceWidth);
  const expandedWorkspaceWidth = composition.viewportWidth - RESPONSIVE_LAYOUT_BREAKPOINTS.expandedNavigationWidth;
  const shell = media.shellDrawer.matches
    ? "drawer"
    : expandedWorkspaceWidth < workspaceMinWidth
      ? "rail"
      : "expanded";
  const fallbackNavigationWidth = shell === "expanded"
    ? RESPONSIVE_LAYOUT_BREAKPOINTS.expandedNavigationWidth
    : shell === "rail"
      ? RESPONSIVE_LAYOUT_BREAKPOINTS.railNavigationWidth
      : 0;
  const navigationWidth = shell === "drawer"
    ? 0
    : composition.navigationInlineSize && composition.navigationInlineSize > 0
      ? composition.navigationInlineSize
      : fallbackNavigationWidth;
  const companionMinWidth = composition.companionWidth > 0
    ? Math.max(0, composition.companionMinWidth ?? RESPONSIVE_LAYOUT_BREAKPOINTS.minimumCompanionWidth)
    : 0;
  const companionRoom = composition.viewportWidth - navigationWidth - workspaceMinWidth;
  const companionNeedsOverlay = companionMinWidth > 0 && companionRoom < companionMinWidth;
  const companion = media.shellDrawer.matches
    ? "canvas"
    : companionNeedsOverlay
      ? "overlay"
      : media.companionCompact.matches
        ? "compact"
        : "docked";
  return {
    shell,
    companion,
    workspace: media.workspaceSingle.matches ? "single" : "split",
    workspaceMinWidth,
    density: media.narrowDensity.matches ? "narrow" : "comfortable",
    actions: shell === "drawer" ? "minimal" : shell === "rail" ? "compact" : "full"
  };
}

function sameLayout(a: ResponsiveLayout, b: ResponsiveLayout): boolean {
  return a.shell === b.shell
    && a.companion === b.companion
    && a.workspace === b.workspace
    && a.workspaceMinWidth === b.workspaceMinWidth
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
  const [composition, setComposition] = useState<LayoutComposition>(() => ({
    viewportWidth: currentViewportWidth(),
    navigationInlineSize: undefined,
    companionWidth: 0,
    companionMinWidth: 0,
    workspaceMinWidth: RESPONSIVE_LAYOUT_BREAKPOINTS.minimumWorkspaceWidth
  }));
  const [layout, setLayout] = useState<ResponsiveLayout>(() => readLayout(media, composition));
  const reportComposition = useCallback((next: LayoutComposition) => {
    setComposition((current) => {
      const merged = { ...current, ...next };
      return current.viewportWidth === merged.viewportWidth
        && current.navigationInlineSize === merged.navigationInlineSize
        && current.companionWidth === merged.companionWidth
        && current.companionMinWidth === merged.companionMinWidth
        && current.workspaceMinWidth === merged.workspaceMinWidth
        ? current
        : merged;
    });
  }, []);
  const reportWorkspaceMinimum = useCallback((minWidth: number | null) => {
    const normalized = minWidth !== null && Number.isFinite(minWidth) && minWidth > 0
      ? minWidth
      : RESPONSIVE_LAYOUT_BREAKPOINTS.minimumWorkspaceWidth;
    setComposition((current) => current.workspaceMinWidth === normalized
      ? current
      : { ...current, workspaceMinWidth: normalized });
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

  const value = useMemo(() => ({ layout, reportComposition, reportWorkspaceMinimum }), [layout, reportComposition, reportWorkspaceMinimum]);
  return <ResponsiveLayoutContext.Provider value={value}>{children}</ResponsiveLayoutContext.Provider>;
}

export function useResponsiveLayout(): ResponsiveLayout {
  return useContext(ResponsiveLayoutContext)?.layout || WIDE_LAYOUT;
}

export function useResponsiveCompositionReporter(): (composition: LayoutComposition) => void {
  return useContext(ResponsiveLayoutContext)?.reportComposition || (() => undefined);
}

function resolveCssLength(value: number | string, element: HTMLElement): number {
  if (typeof value === "number") return value;
  if (value.startsWith("--")) {
    const customValue = window.getComputedStyle(element).getPropertyValue(value).trim();
    return customValue ? resolveCssLength(customValue, element) : RESPONSIVE_LAYOUT_BREAKPOINTS.minimumWorkspaceWidth;
  }
  const numeric = Number.parseFloat(value);
  if (!Number.isFinite(numeric)) return RESPONSIVE_LAYOUT_BREAKPOINTS.minimumWorkspaceWidth;
  if (value.endsWith("rem")) {
    const rootSize = Number.parseFloat(window.getComputedStyle(document.documentElement).fontSize) || 16;
    return numeric * rootSize;
  }
  return numeric;
}

/** Lets an active workspace declare its own minimum viable inline size. */
export function useResponsiveWorkspaceMinimum(
  value: number | `${number}px` | `${number}rem` | `--${string}`,
  elementRef?: RefObject<HTMLElement | null>
): void {
  const reporter = useContext(ResponsiveLayoutContext)?.reportWorkspaceMinimum;
  useLayoutEffect(() => {
    if (!reporter) return;
    reporter(resolveCssLength(value, elementRef?.current || document.documentElement));
    return () => reporter(null);
  }, [elementRef, reporter, value]);
}
