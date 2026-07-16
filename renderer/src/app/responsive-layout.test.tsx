import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useLayoutEffect } from "react";
import { ResponsiveLayoutProvider, RESPONSIVE_LAYOUT_QUERIES, useResponsiveCompositionReporter, useResponsiveLayout } from "./responsive-layout";

type MutableQuery = MediaQueryList & { setMatches(value: boolean): void };

function installResponsiveQueries() {
  const original = window.matchMedia;
  const queries = new Map<string, MutableQuery>();
  window.matchMedia = vi.fn((query: string) => {
    const listeners = new Set<(event: MediaQueryListEvent) => void>();
    let matches = false;
    const media = {
      get matches() { return matches; },
      media: query,
      onchange: null,
      addEventListener: (_event: string, listener: (event: MediaQueryListEvent) => void) => listeners.add(listener),
      removeEventListener: (_event: string, listener: (event: MediaQueryListEvent) => void) => listeners.delete(listener),
      dispatchEvent: () => true,
      addListener: (listener: (event: MediaQueryListEvent) => void) => listeners.add(listener),
      removeListener: (listener: (event: MediaQueryListEvent) => void) => listeners.delete(listener),
      setMatches(value: boolean) {
        matches = value;
        listeners.forEach((listener) => listener({ matches, media: query } as MediaQueryListEvent));
      }
    } as MutableQuery;
    queries.set(query, media);
    return media;
  }) as typeof window.matchMedia;
  return {
    set(query: string, matches: boolean) {
      act(() => queries.get(query)?.setMatches(matches));
    },
    setSilently(query: string, matches: boolean) {
      const media = queries.get(query);
      if (!media) return;
      Object.defineProperty(media, "matches", { configurable: true, value: matches });
    },
    restore() { window.matchMedia = original; }
  };
}

function installViewportQueries(initialWidth: number) {
  const original = window.matchMedia;
  const originalWidth = window.innerWidth;
  let width = initialWidth;
  Object.defineProperty(window, "innerWidth", { configurable: true, value: width });
  const entries: Array<{ query: string; listeners: Set<(event: MediaQueryListEvent) => void> }> = [];
  window.matchMedia = vi.fn((query: string) => {
    const listeners = new Set<(event: MediaQueryListEvent) => void>();
    const max = Number(query.match(/max-width:\s*(\d+)px/)?.[1] || Number.POSITIVE_INFINITY);
    const entry = { query, listeners };
    entries.push(entry);
    return {
      get matches() { return width <= max; },
      media: query,
      onchange: null,
      addEventListener: (_event: string, listener: (event: MediaQueryListEvent) => void) => listeners.add(listener),
      removeEventListener: (_event: string, listener: (event: MediaQueryListEvent) => void) => listeners.delete(listener),
      dispatchEvent: () => true,
      addListener: (listener: (event: MediaQueryListEvent) => void) => listeners.add(listener),
      removeListener: (listener: (event: MediaQueryListEvent) => void) => listeners.delete(listener)
    } as MediaQueryList;
  }) as typeof window.matchMedia;
  return {
    setWidth(nextWidth: number) {
      width = nextWidth;
      Object.defineProperty(window, "innerWidth", { configurable: true, value: width });
      act(() => entries.forEach(({ query, listeners }) => listeners.forEach((listener) => listener({ matches: true, media: query } as MediaQueryListEvent))));
    },
    restore() {
      window.matchMedia = original;
      Object.defineProperty(window, "innerWidth", { configurable: true, value: originalWidth });
    }
  };
}

function LayoutProbe({ composition }: { composition?: { viewportWidth: number; companionWidth: number } }) {
  const layout = useResponsiveLayout();
  const reportComposition = useResponsiveCompositionReporter();
  useLayoutEffect(() => {
    if (composition) reportComposition(composition);
  }, [composition, reportComposition]);
  return <output aria-label="layout">{`${layout.shell}/${layout.companion}/${layout.workspace}/${layout.density}/${layout.actions}`}</output>;
}

afterEach(() => vi.restoreAllMocks());

describe("ResponsiveLayoutProvider", () => {
  it("honors every progressive boundary at the boundary pixel", () => {
    const viewport = installViewportQueries(1761);
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => { callback(0); return 1; });
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => undefined);
    try {
      render(<ResponsiveLayoutProvider><LayoutProbe /></ResponsiveLayoutProvider>);
      expect(screen.getByLabelText("layout").textContent).toBe("expanded/docked/split/comfortable/full");
      viewport.setWidth(1760);
      expect(screen.getByLabelText("layout").textContent).toBe("expanded/compact/split/comfortable/full");
      viewport.setWidth(1480);
      expect(screen.getByLabelText("layout").textContent).toBe("expanded/compact/single/comfortable/full");
      viewport.setWidth(1021);
      expect(screen.getByLabelText("layout").textContent).toBe("expanded/compact/single/comfortable/full");
      viewport.setWidth(1020);
      expect(screen.getByLabelText("layout").textContent).toBe("expanded/compact/single/comfortable/full");
      viewport.setWidth(1019);
      expect(screen.getByLabelText("layout").textContent).toBe("rail/compact/single/comfortable/compact");
      viewport.setWidth(841);
      expect(screen.getByLabelText("layout").textContent).toBe("rail/compact/single/comfortable/compact");
      viewport.setWidth(840);
      expect(screen.getByLabelText("layout").textContent).toBe("drawer/canvas/single/comfortable/minimal");
      viewport.setWidth(721);
      expect(screen.getByLabelText("layout").textContent).toBe("drawer/canvas/single/comfortable/minimal");
      viewport.setWidth(720);
      expect(screen.getByLabelText("layout").textContent).toBe("drawer/canvas/single/narrow/minimal");
    } finally {
      viewport.restore();
    }
  });

  it("selects the rail from actual companion composition instead of viewport alone", () => {
    const viewport = installViewportQueries(1356);
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => { callback(0); return 1; });
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => undefined);
    try {
      const { rerender } = render(<ResponsiveLayoutProvider><LayoutProbe composition={{ viewportWidth: 1356, companionWidth: 0 }} /></ResponsiveLayoutProvider>);
      expect(screen.getByLabelText("layout").textContent).toContain("expanded/");
      rerender(<ResponsiveLayoutProvider><LayoutProbe composition={{ viewportWidth: 1356, companionWidth: 420 }} /></ResponsiveLayoutProvider>);
      expect(screen.getByLabelText("layout").textContent).toContain("rail/");
      rerender(<ResponsiveLayoutProvider><LayoutProbe composition={{ viewportWidth: 1356, companionWidth: 0 }} /></ResponsiveLayoutProvider>);
      expect(screen.getByLabelText("layout").textContent).toContain("expanded/");
    } finally {
      viewport.restore();
    }
  });

  it("moves through docked, compact, single-workspace, canvas, and narrow states without regressing", () => {
    const media = installResponsiveQueries();
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => { callback(0); return 1; });
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => undefined);

    try {
      render(<ResponsiveLayoutProvider><LayoutProbe /></ResponsiveLayoutProvider>);
      expect(screen.getByLabelText("layout").textContent).toBe("expanded/docked/split/comfortable/full");

      media.set(RESPONSIVE_LAYOUT_QUERIES.companionCompact, true);
      expect(screen.getByLabelText("layout").textContent).toBe("expanded/compact/split/comfortable/full");

      media.set(RESPONSIVE_LAYOUT_QUERIES.workspaceSingle, true);
      expect(screen.getByLabelText("layout").textContent).toBe("expanded/compact/single/comfortable/full");

      media.set(RESPONSIVE_LAYOUT_QUERIES.narrowDensity, true);
      media.set(RESPONSIVE_LAYOUT_QUERIES.shellDrawer, true);
      expect(screen.getByLabelText("layout").textContent).toBe("drawer/canvas/single/narrow/minimal");

      media.set(RESPONSIVE_LAYOUT_QUERIES.narrowDensity, false);
      media.set(RESPONSIVE_LAYOUT_QUERIES.shellDrawer, false);
      expect(screen.getByLabelText("layout").textContent).toBe("expanded/compact/single/comfortable/full");

      media.set(RESPONSIVE_LAYOUT_QUERIES.workspaceSingle, false);
      media.set(RESPONSIVE_LAYOUT_QUERIES.companionCompact, false);
      expect(screen.getByLabelText("layout").textContent).toBe("expanded/docked/split/comfortable/full");
    } finally {
      media.restore();
    }
  });

  it("recomputes the same layout state on native resize when media change events are missed", () => {
    const media = installResponsiveQueries();
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => { callback(0); return 1; });
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => undefined);

    try {
      render(<ResponsiveLayoutProvider><LayoutProbe /></ResponsiveLayoutProvider>);
      media.setSilently(RESPONSIVE_LAYOUT_QUERIES.companionCompact, true);
      media.setSilently(RESPONSIVE_LAYOUT_QUERIES.workspaceSingle, true);
      media.setSilently(RESPONSIVE_LAYOUT_QUERIES.shellDrawer, true);
      media.setSilently(RESPONSIVE_LAYOUT_QUERIES.narrowDensity, true);

      act(() => window.dispatchEvent(new Event("resize")));

      expect(screen.getByLabelText("layout").textContent).toBe("drawer/canvas/single/narrow/minimal");
    } finally {
      media.restore();
    }
  });
});
