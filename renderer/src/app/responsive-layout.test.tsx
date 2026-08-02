import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useLayoutEffect, useRef, type CSSProperties } from "react";
import { ResponsiveLayoutProvider, RESPONSIVE_LAYOUT_QUERIES, useResponsiveCompositionReporter, useResponsiveLayout, useResponsiveWorkspaceMinimum } from "./responsive-layout";

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

function LayoutProbe({ composition }: { composition?: { viewportWidth: number; companionWidth: number; companionMinWidth?: number } }) {
  const layout = useResponsiveLayout();
  const reportComposition = useResponsiveCompositionReporter();
  useLayoutEffect(() => {
    if (composition) reportComposition(composition);
  }, [composition, reportComposition]);
  return <output aria-label="layout">{`${layout.shell}/${layout.companion}/${layout.workspace}/${layout.density}/${layout.actions}`}</output>;
}

function CompactWorkspaceRequirement() {
  const ref = useRef<HTMLDivElement>(null);
  useResponsiveWorkspaceMinimum("--test-workspace-min", ref);
  return <div ref={ref} style={{ "--test-workspace-min": "34rem" } as CSSProperties} />;
}

afterEach(() => vi.restoreAllMocks());

describe("ResponsiveLayoutProvider", () => {
  it.each([
    [3_840, "expanded/docked/split/comfortable/full"],
    [2_560, "expanded/docked/split/comfortable/full"],
    [1_920, "expanded/docked/split/comfortable/full"],
    [1_536, "expanded/compact/split/comfortable/full"],
    [1_440, "expanded/compact/single/comfortable/full"],
    [1_400, "expanded/compact/single/comfortable/full"],
    [1_399, "expanded/overlay/single/comfortable/full"],
    [1_280, "expanded/overlay/single/comfortable/full"],
    [1_020, "expanded/overlay/single/comfortable/full"],
    [900, "rail/overlay/single/comfortable/compact"],
    [840, "drawer/canvas/single/comfortable/minimal"],
    [720, "drawer/canvas/single/narrow/minimal"]
  ])("resolves a 420px companion at %ipx CSS viewport", (viewportWidth, expected) => {
    const viewport = installViewportQueries(viewportWidth);
    try {
      render(
        <ResponsiveLayoutProvider>
          <LayoutProbe composition={{ viewportWidth, companionWidth: 420, companionMinWidth: 380 }} />
        </ResponsiveLayoutProvider>
      );
      expect(screen.getByLabelText("layout").textContent).toBe(expected);
    } finally {
      viewport.restore();
    }
  });

  it.each([380, 420, 760, 960])("does not let a %ipx preferred companion width collapse navigation", (companionWidth) => {
    const viewport = installViewportQueries(1_536);
    try {
      render(
        <ResponsiveLayoutProvider>
          <LayoutProbe composition={{ viewportWidth: 1_536, companionWidth, companionMinWidth: 380 }} />
        </ResponsiveLayoutProvider>
      );
      expect(screen.getByLabelText("layout").textContent).toBe("expanded/compact/split/comfortable/full");
    } finally {
      viewport.restore();
    }
  });

  it("uses CSS viewport width consistently under high-DPI display scaling", () => {
    const viewport = installViewportQueries(1_280);
    const originalRatio = window.devicePixelRatio;
    Object.defineProperty(window, "devicePixelRatio", { configurable: true, value: 1.5 });
    try {
      render(
        <ResponsiveLayoutProvider>
          <LayoutProbe composition={{ viewportWidth: 1_280, companionWidth: 420, companionMinWidth: 380 }} />
        </ResponsiveLayoutProvider>
      );
      expect(screen.getByLabelText("layout").textContent).toBe("expanded/overlay/single/comfortable/full");
    } finally {
      viewport.restore();
      Object.defineProperty(window, "devicePixelRatio", { configurable: true, value: originalRatio });
    }
  });

  it("lets a container-adaptive workspace keep a minimum companion attached", () => {
    const viewport = installViewportQueries(1_280);
    try {
      const { rerender } = render(
        <ResponsiveLayoutProvider>
          <LayoutProbe composition={{ viewportWidth: 1_280, companionWidth: 420, companionMinWidth: 380 }} />
          <CompactWorkspaceRequirement />
        </ResponsiveLayoutProvider>
      );
      expect(screen.getByLabelText("layout").textContent).toBe("expanded/compact/single/comfortable/full");

      rerender(
        <ResponsiveLayoutProvider>
          <LayoutProbe composition={{ viewportWidth: 1_280, companionWidth: 420, companionMinWidth: 380 }} />
        </ResponsiveLayoutProvider>
      );
      expect(screen.getByLabelText("layout").textContent).toBe("expanded/overlay/single/comfortable/full");
    } finally {
      viewport.restore();
    }
  });

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

  it("preserves expanded navigation and floats a companion that cannot fit", () => {
    const viewport = installViewportQueries(1356);
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => { callback(0); return 1; });
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => undefined);
    try {
      const { rerender } = render(<ResponsiveLayoutProvider><LayoutProbe composition={{ viewportWidth: 1356, companionWidth: 0 }} /></ResponsiveLayoutProvider>);
      expect(screen.getByLabelText("layout").textContent).toContain("expanded/");
      rerender(<ResponsiveLayoutProvider><LayoutProbe composition={{ viewportWidth: 1356, companionWidth: 420, companionMinWidth: 380 }} /></ResponsiveLayoutProvider>);
      expect(screen.getByLabelText("layout").textContent).toBe("expanded/overlay/single/comfortable/full");
      rerender(<ResponsiveLayoutProvider><LayoutProbe composition={{ viewportWidth: 1356, companionWidth: 0 }} /></ResponsiveLayoutProvider>);
      expect(screen.getByLabelText("layout").textContent).toContain("expanded/");
    } finally {
      viewport.restore();
    }
  });

  it("attaches, overlays, and canvases the companion from minimum viable widths", () => {
    const viewport = installViewportQueries(1_280);
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => { callback(0); return 1; });
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => undefined);
    try {
      const { rerender } = render(
        <ResponsiveLayoutProvider>
          <LayoutProbe composition={{ viewportWidth: 1_280, companionWidth: 420, companionMinWidth: 380 }} />
        </ResponsiveLayoutProvider>
      );
      expect(screen.getByLabelText("layout").textContent).toBe("expanded/overlay/single/comfortable/full");

      viewport.setWidth(1_100);
      rerender(<ResponsiveLayoutProvider><LayoutProbe composition={{ viewportWidth: 1_100, companionWidth: 420, companionMinWidth: 380 }} /></ResponsiveLayoutProvider>);
      expect(screen.getByLabelText("layout").textContent).toBe("expanded/overlay/single/comfortable/full");

      viewport.setWidth(900);
      rerender(<ResponsiveLayoutProvider><LayoutProbe composition={{ viewportWidth: 900, companionWidth: 420, companionMinWidth: 380 }} /></ResponsiveLayoutProvider>);
      expect(screen.getByLabelText("layout").textContent).toBe("rail/overlay/single/comfortable/compact");

      viewport.setWidth(841);
      rerender(<ResponsiveLayoutProvider><LayoutProbe composition={{ viewportWidth: 841, companionWidth: 420, companionMinWidth: 380 }} /></ResponsiveLayoutProvider>);
      expect(screen.getByLabelText("layout").textContent).toBe("rail/overlay/single/comfortable/compact");

      viewport.setWidth(840);
      rerender(<ResponsiveLayoutProvider><LayoutProbe composition={{ viewportWidth: 840, companionWidth: 420, companionMinWidth: 380 }} /></ResponsiveLayoutProvider>);
      expect(screen.getByLabelText("layout").textContent).toBe("drawer/canvas/single/comfortable/minimal");

      viewport.setWidth(720);
      rerender(<ResponsiveLayoutProvider><LayoutProbe composition={{ viewportWidth: 720, companionWidth: 420, companionMinWidth: 380 }} /></ResponsiveLayoutProvider>);
      expect(screen.getByLabelText("layout").textContent).toBe("drawer/canvas/single/narrow/minimal");

      viewport.setWidth(841);
      rerender(<ResponsiveLayoutProvider><LayoutProbe composition={{ viewportWidth: 841, companionWidth: 420, companionMinWidth: 380 }} /></ResponsiveLayoutProvider>);
      expect(screen.getByLabelText("layout").textContent).toBe("rail/overlay/single/comfortable/compact");

      viewport.setWidth(1_280);
      rerender(<ResponsiveLayoutProvider><LayoutProbe composition={{ viewportWidth: 1_280, companionWidth: 760, companionMinWidth: 380 }} /></ResponsiveLayoutProvider>);
      expect(screen.getByLabelText("layout").textContent).toBe("expanded/overlay/single/comfortable/full");

      viewport.setWidth(1_400);
      rerender(<ResponsiveLayoutProvider><LayoutProbe composition={{ viewportWidth: 1_400, companionWidth: 960, companionMinWidth: 380 }} /></ResponsiveLayoutProvider>);
      expect(screen.getByLabelText("layout").textContent).toBe("expanded/compact/single/comfortable/full");
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
