import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { reflowMountedVirtualRows, useVirtualFlow } from "./use-virtual-flow";

const resizedEntry = {
  borderBoxSize: [{ blockSize: 999, inlineSize: 400 }]
} as unknown as ResizeObserverEntry;

describe("useVirtualFlow resize measurement", () => {
  it("leaves short messages in browser flow and starts measuring only when virtualization is needed", () => {
    const host = document.createElement("div");
    host.style.overflowY = "auto";
    const flow = document.createElement("div");
    const measure = vi.spyOn(flow, "getBoundingClientRect");
    Object.defineProperty(flow, "clientWidth", { value: 440 });
    host.append(flow);
    document.body.append(host);
    const keyAt = (index: number) => `row-${index}`;
    const { result, rerender, unmount } = renderHook(({ count }) => useVirtualFlow({ count, keyAt, estimate: () => 80 }), { initialProps: { count: 10 } });
    act(() => result.current.ref(flow));
    act(() => host.dispatchEvent(new Event("scroll")));
    expect(measure).not.toHaveBeenCalled();
    rerender({ count: 100 });
    expect(measure).toHaveBeenCalled();
    expect(result.current.width).toBe(440);
    rerender({ count: 10 });
    measure.mockClear();
    act(() => host.dispatchEvent(new Event("scroll")));
    expect(measure).not.toHaveBeenCalled();
    unmount();
    host.remove();
  });

  it("estimates rows at their layout width while a parent pane is scaled", () => {
    const host = document.createElement("div");
    host.style.overflowY = "auto";
    const flow = document.createElement("div");
    Object.defineProperty(flow, "clientWidth", { value: 440 });
    flow.getBoundingClientRect = () => ({ top: 0, width: 1000, height: 800 }) as DOMRect;
    host.append(flow);
    document.body.append(host);
    const keyAt = (index: number) => `row-${index}`;
    const { result, unmount } = renderHook(() => useVirtualFlow({ count: 100, keyAt, estimate: (_index, width) => width / 2 }));

    act(() => result.current.ref(flow));
    expect(result.current.width).toBe(440);
    expect(result.current.virtualizer.options.estimateSize(0)).toBe(220);
    unmount();
    host.remove();
  });

  it.each([
    ["application companion", "app-shell ai-sidebar-resizing", false],
    ["navigation", "app-shell", true],
    ["workbench preview", "ai-workbench is-resizing-preview", false]
  ] as const)("keeps cached row heights during an active %s resize", (_label, className, navigation) => {
    const { result } = renderHook(() => useVirtualFlow({
      count: 1,
      keyAt: (index) => `row-${index}`,
      estimate: () => 88,
      enabled: true
    }));
    const host = document.createElement("div");
    host.className = className;
    if (navigation) host.setAttribute("data-nav-transitioning", "");
    const row = document.createElement("div");
    row.dataset.index = "0";
    host.append(row);
    document.body.append(host);

    const virtualizer = result.current.virtualizer;
    virtualizer.itemSizeCache.set("row-0", 123);
    expect(virtualizer.options.measureElement(row, resizedEntry, virtualizer)).toBe(123);

    host.className = "";
    host.removeAttribute("data-nav-transitioning");
    expect(virtualizer.options.measureElement(row, resizedEntry, virtualizer)).toBe(999);
    host.remove();
  });

  it("repositions mounted rows from their live wrapped heights during a drag", () => {
    const container = document.createElement("div");
    const heights = [80, 70, 20];
    for (const [index, height] of heights.entries()) {
      const row = document.createElement("div");
      row.dataset.index = String(index);
      row.getBoundingClientRect = () => ({ height }) as DOMRect;
      container.append(row);
    }

    reflowMountedVirtualRows({
      container,
      items: heights.map((_, index) => ({ index, key: `row-${index}`, start: index * 50, size: 50 })),
      cachedSizes: new Map(heights.map((_, index) => [`row-${index}`, 50])),
      scrollMargin: 0,
      totalSize: 150
    });

    expect(Array.from(container.children, row => (row as HTMLElement).style.transform)).toEqual([
      "translate3d(0, 0px, 0)",
      "translate3d(0, 80px, 0)",
      "translate3d(0, 150px, 0)"
    ]);
    expect(container.style.height).toBe("170px");
  });
});
