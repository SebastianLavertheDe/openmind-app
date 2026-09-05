import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, LoaderCircle, Minus, Plus } from "lucide-react";
import type { PDFDocumentProxy, PDFPageProxy } from "pdfjs-dist";

type PdfModule = typeof import("pdfjs-dist");

const PAGE_MARGIN = 22;
const PAGE_GAP = 18;
const SCROLLBAR_ALLOWANCE = 14;
const MIN_PERCENT = 25;
const MAX_PERCENT = 400;
const ZOOM_STEP = 10;
const RENDER_BUFFER = 1;

// pdf.js 与它的 worker 都是体积可观的模块，且 worker 只需创建一次。
// 惰性加载让首屏与不打开 PDF 的会话完全不受影响。
let pdfjsPromise: Promise<PdfModule> | null = null;

function loadPdfjs(): Promise<PdfModule> {
  if (!pdfjsPromise) {
    pdfjsPromise = (async () => {
      const [{ default: PdfWorker }, pdfjs] = await Promise.all([
        import("pdfjs-dist/build/pdf.worker.min.mjs?worker&inline"),
        import("pdfjs-dist")
      ]);
      pdfjs.GlobalWorkerOptions.workerPort = new PdfWorker();
      return pdfjs;
    })();
  }
  return pdfjsPromise;
}

function errorText(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

/**
 * 纸张式连续滚动 PDF 阅读器：浅色底、居中白页、底部悬浮工具条。
 * 只渲染视口附近的页面，翻页/缩放后以当前页为锚点保持位置。
 */
export function PdfMaterialViewer({ data, title, onError }: { data: Uint8Array; title: string; onError(message: string): void }) {
  const [phase, setPhase] = useState<"loading" | "ready">("loading");
  const [pdfjs, setPdfjs] = useState<PdfModule | null>(null);
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [base, setBase] = useState<{ width: number; height: number } | null>(null);
  const [numPages, setNumPages] = useState(0);
  const [percent, setPercent] = useState<number | null>(null);
  const [containerWidth, setContainerWidth] = useState(0);
  const [range, setRange] = useState<[number, number]>([1, 1]);
  const [current, setCurrent] = useState(1);
  const [pageDraft, setPageDraft] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const currentPageRef = useRef(1);
  const anchorPageRef = useRef<number | null>(null);
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;

  useEffect(() => {
    let active = true;
    let task: { destroy(): void } | null = null;
    let loaded: PDFDocumentProxy | null = null;
    setPhase("loading");
    setDoc(null);
    setBase(null);
    setNumPages(0);
    setCurrent(1);
    currentPageRef.current = 1;
    (async () => {
      try {
        const module = await loadPdfjs();
        const load = module.getDocument({ data });
        task = load;
        loaded = await load.promise;
        if (!active) return;
        const viewport = (await loaded.getPage(1)).getViewport({ scale: 1 });
        if (!active) return;
        setPdfjs(module);
        setDoc(loaded);
        setBase({ width: viewport.width, height: viewport.height });
        setNumPages(loaded.numPages);
        setPhase("ready");
      } catch (cause) {
        if (active) onErrorRef.current(errorText(cause));
      }
    })();
    return () => {
      active = false;
      void loaded?.destroy();
      void task?.destroy();
    };
  }, [data]);

  const fitScale = base && containerWidth > 0
    ? (containerWidth - PAGE_MARGIN * 2 - SCROLLBAR_ALLOWANCE) / base.width
    : 0;
  const scale = base ? (percent === null ? fitScale : percent / 100) : 0;
  const slotHeight = base ? base.height * scale : 0;
  const effectivePercent = Math.round(scale * 100);

  const updateVisible = useCallback(() => {
    const el = scrollRef.current;
    if (!el || !base || scale <= 0) return;
    const stride = base.height * scale + PAGE_GAP;
    const first = Math.max(1, Math.floor((el.scrollTop - PAGE_MARGIN) / stride) + 1);
    const last = Math.min(numPages, Math.max(first, Math.ceil((el.scrollTop + el.clientHeight - PAGE_MARGIN) / stride)));
    setRange((prev) => (prev[0] === first && prev[1] === last ? prev : [first, last]));
    const center = Math.max(1, Math.floor((el.scrollTop + el.clientHeight / 2 - PAGE_MARGIN) / stride) + 1);
    if (center !== currentPageRef.current) {
      currentPageRef.current = center;
      setCurrent(center);
      setPageDraft(null);
    }
  }, [base, scale, numPages]);

  // 滚动容器只在 ready 分支渲染，因此随 phase 重新挂载观察器。
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || phase !== "ready" || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width;
      if (width) setContainerWidth(Math.floor(width));
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [phase]);

  useEffect(() => {
    updateVisible();
  }, [updateVisible]);

  // 缩放后回到缩放前正在阅读的页面，避免视觉跳页。
  useEffect(() => {
    const el = scrollRef.current;
    const anchor = anchorPageRef.current;
    if (!el || !base || scale <= 0 || anchor === null) return;
    anchorPageRef.current = null;
    el.scrollTop = Math.max(0, PAGE_MARGIN + (anchor - 1) * (base.height * scale + PAGE_GAP) - 12);
    updateVisible();
  }, [base, scale, updateVisible]);

  const scrollToPage = useCallback((target: number) => {
    const el = scrollRef.current;
    if (!el || !base || scale <= 0) return;
    const clamped = Math.min(numPages, Math.max(1, target));
    el.scrollTop = Math.max(0, PAGE_MARGIN + (clamped - 1) * (base.height * scale + PAGE_GAP) - 12);
    updateVisible();
  }, [base, scale, numPages, updateVisible]);

  const zoomTo = useCallback((next: number) => {
    anchorPageRef.current = currentPageRef.current;
    setPercent(Math.min(MAX_PERCENT, Math.max(MIN_PERCENT, Math.round(next))));
  }, []);

  if (phase === "loading" || !pdfjs || !doc || !base) {
    return <div className="project-pdf-loading"><LoaderCircle className="spin" size={18} />正在解析 PDF…</div>;
  }
  const activePercent = percent === null ? effectivePercent : percent;
  return (
    <div className="project-pdf-viewer" role="region" aria-label={`${title} PDF 预览`}>
      <div ref={scrollRef} className="pdf-scroll" onScroll={updateVisible}>
        <div className="pdf-pages" style={{ gap: PAGE_GAP, padding: PAGE_MARGIN }}>
          {Array.from({ length: numPages }, (_, index) => index + 1).map((pageNumber) => (
            <PdfPage
              key={pageNumber}
              pdfjs={pdfjs}
              doc={doc}
              pageNumber={pageNumber}
              base={base}
              scale={scale}
              shouldRender={pageNumber >= range[0] - RENDER_BUFFER && pageNumber <= range[1] + RENDER_BUFFER}
            />
          ))}
        </div>
      </div>
      <div className="pdf-toolbar">
        <button type="button" aria-label="上一页" disabled={current <= 1} onClick={() => scrollToPage(current - 1)}><ChevronLeft size={15} /></button>
        <input
          className="pdf-page-input"
          aria-label="当前页码"
          value={pageDraft ?? current}
          onChange={(event) => setPageDraft(event.target.value.replace(/\D/g, "").slice(0, 5))}
          onFocus={(event) => event.currentTarget.select()}
          onBlur={() => { if (pageDraft !== null) { scrollToPage(Number(pageDraft)); setPageDraft(null); } }}
          onKeyDown={(event) => { if (event.key === "Enter") (event.currentTarget as HTMLInputElement).blur(); }}
        />
        <span className="pdf-page-total">/ {numPages}</span>
        <button type="button" aria-label="下一页" disabled={current >= numPages} onClick={() => scrollToPage(current + 1)}><ChevronRight size={15} /></button>
        <span className="pdf-toolbar-divider" />
        <button type="button" aria-label="缩小" disabled={activePercent <= MIN_PERCENT} onClick={() => zoomTo(activePercent - ZOOM_STEP)}><Minus size={15} /></button>
        <button type="button" className="pdf-zoom-label" title="适应宽度" onClick={() => { anchorPageRef.current = currentPageRef.current; setPercent(null); }}>{activePercent}%</button>
        <button type="button" aria-label="放大" disabled={activePercent >= MAX_PERCENT} onClick={() => zoomTo(activePercent + ZOOM_STEP)}><Plus size={15} /></button>
      </div>
    </div>
  );
}

function PdfPage({ pdfjs, doc, pageNumber, base, scale, shouldRender }: {
  pdfjs: PdfModule;
  doc: PDFDocumentProxy;
  pageNumber: number;
  base: { width: number; height: number };
  scale: number;
  shouldRender: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const textRef = useRef<HTMLDivElement>(null);
  const [page, setPage] = useState<PDFPageProxy | null>(null);
  const [size, setSize] = useState({ width: base.width * scale, height: base.height * scale });

  useEffect(() => {
    let active = true;
    doc.getPage(pageNumber).then((resolved) => { if (active) setPage(resolved); }).catch(() => {});
    return () => { active = false; };
  }, [doc, pageNumber]);

  const viewport = page ? page.getViewport({ scale }) : null;
  useEffect(() => {
    if (viewport) setSize({ width: viewport.width, height: viewport.height });
  }, [viewport]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const textHost = textRef.current;
    if (!page || !canvas || !viewport) return;
    if (!shouldRender) {
      canvas.width = 0;
      canvas.height = 0;
      textHost?.replaceChildren();
      return;
    }
    let cancelled = false;
    const outputScale = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.floor(viewport.width * outputScale);
    canvas.height = Math.floor(viewport.height * outputScale);
    const context = canvas.getContext("2d");
    if (!context) return;
    const transform = outputScale === 1 ? undefined : ([outputScale, 0, 0, outputScale, 0, 0] as [number, number, number, number, number, number]);
    const task = page.render({ canvas, canvasContext: context, viewport, transform });
    task.promise.then(() => {
      if (cancelled || !textHost) return;
      textHost.replaceChildren();
      // 文字层让正文可选中/可复制；个别文档解析失败时静默退化为纯图像页。
      const layer = new pdfjs.TextLayer({ textContentSource: page.streamTextContent(), container: textHost, viewport });
      return layer.render().catch(() => {});
    }).catch(() => {});
    return () => {
      cancelled = true;
      task.cancel();
    };
  }, [pdfjs, page, viewport, shouldRender]);

  return (
    <div className="pdf-page-slot" style={{ width: size.width, height: size.height }}>
      <canvas ref={canvasRef} style={{ width: size.width, height: size.height }} aria-label={`第 ${pageNumber} 页`} />
      <div ref={textRef} className="pdf-page-text" />
    </div>
  );
}
