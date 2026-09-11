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
afterEach(() => { cleanup(); state.tasks.length = 0; state.viewers.length = 0; state.options.length = 0; });

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
});
