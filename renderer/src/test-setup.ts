import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

// jsdom does not implement matchMedia. Many components (AiSidebar, App, GlobalSearch, ColumnSplitter…)
// query media queries on mount. Provide a minimal polyfill so component tests don't need to repeat it.
if (typeof window !== "undefined" && typeof window.matchMedia !== "function") {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    configurable: true,
    value: (query: string): MediaQueryList => {
      const listeners = new Set<(event: MediaQueryListEvent) => void>();
      return {
        matches: false,
        media: query,
        onchange: null,
        addEventListener: (_event: string, listener: (event: MediaQueryListEvent) => void) => listeners.add(listener),
        removeEventListener: (_event: string, listener: (event: MediaQueryListEvent) => void) => listeners.delete(listener),
        dispatchEvent: () => false,
        addListener: (listener: (event: MediaQueryListEvent) => void) => listeners.add(listener),
        removeListener: (listener: (event: MediaQueryListEvent) => void) => listeners.delete(listener)
      } as MediaQueryList;
    }
  });
}

// jsdom also lacks ResizeObserver, used by some layout/virtual-list code paths.
if (typeof window !== "undefined" && typeof (window as unknown as { ResizeObserver?: unknown }).ResizeObserver === "undefined") {
  (window as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
    observe(): void { /* no-op */ }
    unobserve(): void { /* no-op */ }
    disconnect(): void { /* no-op */ }
  };
}

// RTL cleanup after each test to keep the DOM isolated across the suite.
afterEach(() => {
  cleanup();
});
