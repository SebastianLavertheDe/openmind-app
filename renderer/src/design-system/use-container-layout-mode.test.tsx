import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useContainerLayoutMode } from "./use-container-layout-mode";

describe("useContainerLayoutMode", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("derives one semantic mode from the observed container border-box boundary", () => {
    let callback: ResizeObserverCallback | null = null;
    let target: Element | null = null;
    class MockResizeObserver {
      constructor(next: ResizeObserverCallback) { callback = next; }
      observe(next: Element) { target = next; }
      disconnect() { /* no-op */ }
      unobserve() { /* no-op */ }
    }
    vi.stubGlobal("ResizeObserver", MockResizeObserver);

    function Probe() {
      const layout = useContainerLayoutMode<HTMLDivElement>({ splitMinInlineSize: 860 });
      return <div ref={layout.ref} data-testid="probe" data-mode={layout.mode} data-width={layout.inlineSize ?? "unknown"} />;
    }

    render(<Probe />);
    expect(screen.getByTestId("probe").dataset.mode).toBe("split");

    act(() => callback?.([{
      target: target!,
      contentRect: { width: 860 },
      contentBoxSize: [{ inlineSize: 860 }],
      borderBoxSize: [{ inlineSize: 859 }]
    } as unknown as ResizeObserverEntry], {} as ResizeObserver));
    expect(screen.getByTestId("probe").dataset.mode).toBe("stacked");
    expect(screen.getByTestId("probe").dataset.width).toBe("859");

    act(() => callback?.([{
      target: target!,
      contentRect: { width: 859 },
      contentBoxSize: [{ inlineSize: 859 }],
      borderBoxSize: [{ inlineSize: 860 }]
    } as unknown as ResizeObserverEntry], {} as ResizeObserver));
    expect(screen.getByTestId("probe").dataset.mode).toBe("split");
  });

  it("starts observing when the measured element mounts after a loading state", () => {
    const observed: Element[] = [];
    class MockResizeObserver {
      constructor(_callback: ResizeObserverCallback) { /* no-op */ }
      observe(next: Element) { observed.push(next); }
      disconnect() { /* no-op */ }
      unobserve() { /* no-op */ }
    }
    vi.stubGlobal("ResizeObserver", MockResizeObserver);

    function Probe({ ready }: { ready: boolean }) {
      const layout = useContainerLayoutMode<HTMLDivElement>({ splitMinInlineSize: 860 });
      return ready ? <div ref={layout.ref} data-testid="late-probe" /> : <div>loading</div>;
    }

    const view = render(<Probe ready={false} />);
    expect(observed).toHaveLength(0);
    view.rerender(<Probe ready />);
    expect(observed).toEqual([screen.getByTestId("late-probe")]);
  });
});
