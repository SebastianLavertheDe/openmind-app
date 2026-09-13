import { memo, useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, LoaderCircle, Minus, Plus, Search, X } from "lucide-react";
import type { PDFDocumentProxy, PDFWorker } from "pdfjs-dist";
import type { EventBus, PDFViewer } from "pdfjs-dist/web/pdf_viewer.mjs";
import "pdfjs-dist/web/pdf_viewer.css";

let modules: Promise<[typeof import("pdfjs-dist"), typeof import("pdfjs-dist/web/pdf_viewer.mjs"), typeof import("pdfjs-dist/build/pdf.worker.min.mjs?worker&inline")["default"]]> | undefined;
function loadViewer() {
  return modules ??= Promise.all([
    import("pdfjs-dist"),
    import("pdfjs-dist/build/pdf.worker.min.mjs?worker&inline")
  ]).then(async ([pdfjs, { default: Worker }]) => {
    // pdf_viewer consumes globalThis.pdfjsLib; core must finish evaluating first.
    const viewer = await import("pdfjs-dist/web/pdf_viewer.mjs");
    return [pdfjs, viewer, Worker] as [typeof pdfjs, typeof viewer, typeof Worker];
  }).catch(error => { modules = undefined; throw error; });
}

/** React owns controls; the official viewer owns page views, rendering and caches. */

// 拖拽落定延迟：短于该间隔的连续容器宽度变化只做 CSS zoom 跟手，停顿后一次性缩放。
const PDF_RESIZE_SETTLE_MS = 140;

export const PdfMaterialViewer = memo(function PdfMaterialViewer({ data, title, onError }: {
  data: Uint8Array; title: string; onError(message: string): void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const controller = useRef<{ viewer: PDFViewer; bus: EventBus } | null>(null);
  const errorRef = useRef(onError);
  errorRef.current = onError;
  const fit = useRef(true);
  const [ready, setReady] = useState(false);
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(0);
  const [percent, setPercent] = useState(100);
  const [draft, setDraft] = useState<string | null>(null);
  const [findOpen, setFindOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [matches, setMatches] = useState({ current: 0, total: 0 });

  useEffect(() => {
    const container = host.current;
    if (!container) return;
    const abort = new AbortController();
    let doc: PDFDocumentProxy | undefined;
    let loading: { destroy(): Promise<void> } | undefined;
    let worker: PDFWorker | undefined;
    let port: Worker | undefined;
    let viewer: PDFViewer | undefined;
    let observer: ResizeObserver | undefined;
    let surface: HTMLDivElement | undefined;
    let frame = 0;
    let lastWidth = 0;
    let settleTimer = 0;
    let gestureZoom = 1;
    setReady(false); setPage(1); setPages(0); setDraft(null); setQuery("");
    fit.current = true;
    void (async () => {
      try {
        const [pdfjs, ui, WorkerPort] = await loadViewer();
        if (abort.signal.aborted) return;
        const bus = new ui.EventBus();
        const links = new ui.PDFLinkService({ eventBus: bus });
        links.externalLinkEnabled = false;
        const find = new ui.PDFFindController({ eventBus: bus, linkService: links });
        const surfaceElement = document.createElement("div");
        surfaceElement.className = "pdfViewer";
        // 拖拽手势用 transform:scale 跟手；左上锚点保证缩放时页面顶端不漂移。
        surfaceElement.style.transformOrigin = "top left";
        surface = surfaceElement;
        container.replaceChildren(surfaceElement);
        const viewerOptions = {
          container, viewer: surfaceElement, eventBus: bus, linkService: links, findController: find,
          annotationMode: pdfjs.AnnotationMode.DISABLE, enableAutoLinking: false,
          maxCanvasPixels: 8_388_608, capCanvasAreaFactor: 150, abortSignal: abort.signal
        };
        viewer = new ui.PDFViewer(viewerOptions);
        links.setViewer(viewer);
        controller.current = { viewer, bus };
        bus.on("pagechanging", (event: { pageNumber: number }) => { setPage(event.pageNumber); setDraft(null); });
        bus.on("scalechanging", (event: { scale: number }) => setPercent(Math.round(event.scale * 100)));
        bus.on("updatefindmatchescount", (event: { matchesCount: { current: number; total: number } }) => setMatches(event.matchesCount));
        bus.on("updatefindcontrolstate", (event: { matchesCount: { current: number; total: number } }) => setMatches(event.matchesCount));
        bus.on("pagesinit", () => {
          if (abort.signal.aborted || !viewer) return;
          viewer.currentScaleValue = "page-width";
          lastWidth = container.clientWidth;
          setReady(true);
        });
        bus.on("pagerendered", (event: { error?: unknown }) => {
          if (event.error && !abort.signal.aborted) errorRef.current(String(event.error));
        });
        // A worker belongs to this document. Reusing a global port races with
        // asynchronous destruction when switching/reopening files.
        port = new WorkerPort();
        worker = pdfjs.PDFWorker.create({ port });
        const task = pdfjs.getDocument({ data: data.slice(), isEvalSupported: false, worker });
        loading = task;
        doc = await task.promise;
        if (abort.signal.aborted) { await doc.destroy(); return; }
        setPages(doc.numPages);
        links.setDocument(doc);
        viewer.setDocument(doc);
        observer = new ResizeObserver(() => {
          cancelAnimationFrame(frame);
          frame = requestAnimationFrame(() => {
            const width = container.clientWidth;
            if (!viewer || !width || width === lastWidth) return;
            const current = viewer.getPageView(viewer.currentPageNumber - 1);
            const pageWidth = current?.viewport?.width;
            if (fit.current && viewer.currentScale > 0 && pageWidth && lastWidth > 0) {
              // 拖拽热路径：逐帧 updateScale 会让 pdf.js 同步 refresh 全部页面
              // （500 页也要逐页 viewport clone + 样式写）并重扫可见性。直接写
              // transform 则每帧都触发合成器重新光栅大面积 canvas，软件渲染下
              // 仍然跳帧。改为 transform 过渡动画：动画期间合成器冻结光栅
              // scale、逐帧只重采样既有位图；落定后再一次性做真实缩放。
              gestureZoom *= width / lastWidth;
              surface?.style.setProperty("transition", "transform 120ms linear");
              surface?.style.setProperty("transform", `scale(${gestureZoom})`);
            }
            lastWidth = width;
            if (settleTimer) window.clearTimeout(settleTimer);
            settleTimer = window.setTimeout(() => {
              settleTimer = 0;
              const finalWidth = container.clientWidth;
              if (!viewer || !finalWidth) return;
              surface?.style.removeProperty("transform");
              surface?.style.removeProperty("transition");
              gestureZoom = 1;
              if (fit.current && viewer.currentScale > 0) {
                const settledPage = viewer.getPageView(viewer.currentPageNumber - 1);
                // 手势期间 pdf.js 未缩放，viewport.width 仍是落定前逻辑宽度，
                // 与 page-width 适配公式一致。
                const settledPageWidth = settledPage?.viewport?.width;
                if (settledPageWidth) {
                  viewer.updateScale({ scaleFactor: Math.max(40, finalWidth - 40) / settledPageWidth, drawingDelay: 120 });
                }
              }
              viewer.update();
            }, PDF_RESIZE_SETTLE_MS);
          });
        });
        observer.observe(container);
      } catch (error) {
        if (!abort.signal.aborted) errorRef.current(error instanceof Error ? error.message : String(error));
      }
    })();
    return () => {
      abort.abort(); observer?.disconnect(); cancelAnimationFrame(frame);
      if (settleTimer) window.clearTimeout(settleTimer);
      surface?.style.removeProperty("transform");
      controller.current = null;
      // The JS API accepts null to dispose; its declaration omits that overload.
      viewer?.setDocument(null as unknown as PDFDocumentProxy);
      void (loading?.destroy() || Promise.resolve()).catch(() => {}).finally(() => { worker?.destroy(); port?.terminate(); });
      container.replaceChildren();
    };
  }, [data]);

  function search(value: string, again = false, previous = false) {
    controller.current?.bus.dispatch("find", {
      source: host.current, type: again ? "again" : "", query: value,
      caseSensitive: false, entireWord: false, highlightAll: true, findPrevious: previous, matchDiacritics: false
    });
  }
  function go(target: number) {
    const viewer = controller.current?.viewer;
    if (viewer) viewer.currentPageNumber = Math.min(pages, Math.max(1, target || 1));
  }
  function zoom(delta: number) {
    const viewer = controller.current?.viewer;
    if (!viewer) return;
    fit.current = false;
    viewer.updateScale({ scaleFactor: Math.min(4, Math.max(.25, viewer.currentScale + delta)) / viewer.currentScale, drawingDelay: 120 });
  }
  return <div className="project-pdf-viewer" role="region" aria-label={`${title} PDF 预览`} tabIndex={0} onKeyDown={event => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "f") { event.preventDefault(); event.stopPropagation(); setFindOpen(true); }
  }}>
    <div className="pdf-scroll" ref={host} />
    {!ready ? <div className="project-pdf-loading"><LoaderCircle className="spin" size={18} />正在解析 PDF…</div> : null}
    {findOpen ? <div className="document-findbar">
      <input autoFocus aria-label="搜索 PDF" value={query} onChange={event => { setQuery(event.target.value); search(event.target.value); }} onKeyDown={event => {
        if (event.key === "Enter") search(query, true, event.shiftKey);
        if (event.key === "Escape") { setFindOpen(false); controller.current?.bus.dispatch("findbarclose", {}); }
      }} />
      <span>{matches.current} / {matches.total}</span>
      <button aria-label="上一个匹配" data-motion="icon" onClick={() => search(query, true, true)}><ChevronLeft size={14} /></button>
      <button aria-label="下一个匹配" data-motion="icon" onClick={() => search(query, true)}><ChevronRight size={14} /></button>
      <button aria-label="关闭搜索" data-motion="icon" onClick={() => { setFindOpen(false); controller.current?.bus.dispatch("findbarclose", {}); }}><X size={14} /></button>
    </div> : null}
    <div className="pdf-toolbar">
      <button aria-label="搜索 PDF" data-motion="icon" onClick={() => setFindOpen(true)}><Search size={15}/></button>
      <button aria-label="上一页" data-motion="icon" disabled={page <= 1} onClick={() => go(page - 1)}><ChevronLeft size={15}/></button>
      <input className="pdf-page-input" aria-label="当前页码" value={draft ?? page} onChange={event => setDraft(event.target.value.replace(/\D/g, "").slice(0, 5))} onBlur={() => { if (draft !== null) { go(Number(draft)); setDraft(null); } }} onKeyDown={event => { if (event.key === "Enter") event.currentTarget.blur(); }}/>
      <span className="pdf-page-total">/ {pages}</span>
      <button aria-label="下一页" data-motion="icon" disabled={page >= pages} onClick={() => go(page + 1)}><ChevronRight size={15}/></button>
      <span className="pdf-toolbar-divider"/>
      <button aria-label="缩小" data-motion="icon" disabled={percent <= 25} onClick={() => zoom(-.1)}><Minus size={15}/></button>
      <button className="pdf-zoom-label" data-motion="action" title="适应宽度" onClick={() => { fit.current = true; if (controller.current) controller.current.viewer.currentScaleValue = "page-width"; }}>{percent}%</button>
      <button aria-label="放大" data-motion="icon" disabled={percent >= 400} onClick={() => zoom(.1)}><Plus size={15}/></button>
    </div>
  </div>;
});
