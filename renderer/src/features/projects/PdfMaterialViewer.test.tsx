import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PdfMaterialViewer } from "./PdfMaterialViewer";

const state = vi.hoisted(() => ({ tasks: [] as any[], viewers: [] as any[], options: [] as any[] }));
vi.mock("pdfjs-dist/build/pdf.worker.min.mjs?worker&inline", () => ({ default: class { terminate() {} } }));
vi.mock("pdfjs-dist", () => ({
  AnnotationMode: { DISABLE: 0 }, GlobalWorkerOptions: {},
  PDFWorker: class { static create() { return new this(); } destroy() {} },
  getDocument: (options: unknown) => {
    state.options.push(options);
    const task = { promise: Promise.resolve({ numPages: 500 }), destroy: vi.fn(async () => {}) };
    state.tasks.push(task); return task;
  }
}));
vi.mock("pdfjs-dist/web/pdf_viewer.mjs", () => ({
  EventBus: class {
    handlers = new Map<string, (event: unknown) => void>();
    on(name: string, handler: (event: unknown) => void) { this.handlers.set(name, handler); }
    dispatch(name: string, event: unknown) { this.handlers.get(name)?.(event); }
  },
  PDFLinkService: class { setViewer() {} setDocument() {} },
  PDFFindController: class {},
  PDFViewer: class {
    currentScale = 1;
    currentPageNumber = 1;
    setDocument = vi.fn((doc: unknown) => { if (doc) this.options.eventBus.dispatch("pagesinit", {}); });
    update = vi.fn();
    updateScale = vi.fn();
    getPageView = vi.fn(() => ({ viewport: { width: 600 } }));
    constructor(public options: any) { state.viewers.push(this); }
  }
}));
afterEach(() => {
  cleanup();
  state.tasks.length = 0;
  state.viewers.length = 0;
  state.options.length = 0;
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("PDF viewer lifecycle", () => {
  it("lets the viewer own all pages and reuses it across unrelated React renders", async () => {
    const data = new Uint8Array([1, 2, 3]);
    const onError = vi.fn();
    const { rerender, unmount } = render(<PdfMaterialViewer data={data} title="Large PDF" onError={onError}/>);
    await waitFor(() => expect(screen.getByText("/ 500")).toBeTruthy());
    expect(state.viewers).toHaveLength(1);
    expect(state.viewers[0].setDocument).toHaveBeenCalledTimes(1);
    expect(state.options[0].data).not.toBe(data);
    expect(state.options[0].isEvalSupported).toBe(false);
    expect(state.viewers[0].options.annotationMode).toBe(0);
    const signal = state.viewers[0].options.abortSignal;
    rerender(<PdfMaterialViewer data={data} title="Renamed PDF" onError={vi.fn()}/>);
    expect(state.tasks).toHaveLength(1);
    unmount();
    expect(state.viewers[0].setDocument).toHaveBeenLastCalledWith(null);
    expect(state.tasks[0].destroy).toHaveBeenCalledOnce();
    expect(signal.aborted).toBe(true);
    expect(onError).not.toHaveBeenCalled();
  });
  it("disposes the previous document on replacement", async () => {
    const { rerender } = render(<PdfMaterialViewer data={new Uint8Array([1])} title="one" onError={vi.fn()}/>);
    await waitFor(() => expect(state.viewers).toHaveLength(1));
    rerender(<PdfMaterialViewer data={new Uint8Array([2])} title="two" onError={vi.fn()}/>);
    await waitFor(() => expect(state.viewers).toHaveLength(2));
    expect(state.tasks[0].destroy).toHaveBeenCalledOnce();
    expect(state.viewers[0].options.abortSignal.aborted).toBe(true);
  });
  it("keeps the centered page geometry stable while resizing without refreshing pdf.js per frame", async () => {
    let resize: ResizeObserverCallback | undefined;
    class ResizeObserverMock {
      constructor(callback: ResizeObserverCallback) { resize = callback; }
      observe() { /* no-op */ }
      disconnect() { /* no-op */ }
      unobserve() { /* no-op */ }
    }
    vi.stubGlobal("ResizeObserver", ResizeObserverMock);
    const frames = new Map<number, FrameRequestCallback>();
    let frameId = 0;
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      const id = ++frameId;
      frames.set(id, callback);
      return id;
    });
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation((id) => { frames.delete(id); });

    let width = 640;
    const view = render(<PdfMaterialViewer data={new Uint8Array([1])} title="Resizable PDF" onError={vi.fn()}/>);
    const scroll = view.container.querySelector<HTMLElement>(".pdf-scroll")!;
    Object.defineProperty(scroll, "clientWidth", { configurable: true, get: () => width });
    await waitFor(() => expect(resize).toBeTypeOf("function"));
    const surface = scroll.querySelector<HTMLElement>(".pdfViewer")!;
    const viewer = state.viewers[0];
    vi.useFakeTimers();

    for (const nextWidth of [700, 760, 820, 880, 940]) {
      width = nextWidth;
      resize?.([], {} as ResizeObserver);
      for (const [id, callback] of [...frames]) {
        frames.delete(id);
        callback(performance.now());
      }
    }

    // The page has already centered itself in the wider layout, so scaling around
    // that center keeps it stationary without freezing width or forcing layout.
    expect(surface.style.width).toBe("");
    expect(surface.style.transformOrigin).toBe("top center");
    expect(surface.style.transform).toBe("scale(1.5)");
    expect(surface.style.transition).toBe("transform 120ms linear");
    expect(viewer.updateScale).not.toHaveBeenCalled();
    expect(viewer.update).not.toHaveBeenCalled();

    vi.advanceTimersByTime(140);
    expect(surface.style.transform).toBe("");
    expect(surface.style.transition).toBe("");
    expect(surface.style.transformOrigin).toBe("");
    expect(viewer.updateScale).toHaveBeenCalledOnce();
    expect(viewer.updateScale).toHaveBeenCalledWith({ scaleFactor: 1.5, drawingDelay: 120 });
    expect(viewer.update).toHaveBeenCalledOnce();
  });
});
