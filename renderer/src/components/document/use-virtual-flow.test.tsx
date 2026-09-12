import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { reflowMountedVirtualRows, useVirtualFlow } from "./use-virtual-flow";

const resizedEntry = {
  borderBoxSize: [{ blockSize: 999, inlineSize: 400 }]
} as unknown as ResizeObserverEntry;

describe("useVirtualFlow resize measurement", () => {
  it.each([
    ["application companion", "app-shell ai-sidebar-resizing"],
    ["workbench preview", "ai-workbench is-resizing-preview"]
  ])("keeps cached row heights during an active %s drag", (_label, className) => {
    const { result } = renderHook(() => useVirtualFlow({
      count: 1,
      keyAt: (index) => `row-${index}`,
      estimate: () => 88,
      enabled: true
    }));
    const host = document.createElement("div");
    host.className = className;
    const row = document.createElement("div");
    row.dataset.index = "0";
    host.append(row);
    document.body.append(host);

    const virtualizer = result.current.virtualizer;
    virtualizer.itemSizeCache.set("row-0", 123);
    expect(virtualizer.options.measureElement(row, resizedEntry, virtualizer)).toBe(123);

    host.className = "";
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
