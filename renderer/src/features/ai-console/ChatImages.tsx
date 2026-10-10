import { createContext, useCallback, useContext, useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { ChevronLeft, ChevronRight, ImageOff, LoaderCircle, Maximize2, Minimize2, X } from "lucide-react";
import type { ChatImageData, GeneratedImage } from "@shared/image-generation";
import { IMAGE_PROVIDERS } from "@shared/image-generation";
import { useModalFocusScope } from "../../design-system/use-modal-focus-scope";
import { useExitPresence } from "../../design-system/use-exit-presence";
import { useMotionTokens } from "../../design-system/motion-tokens";

type GalleryImage = { id: string; source: string; title: string; element?: HTMLElement | null };
type GalleryContextValue = {
  projectName?: string;
  register(image: GalleryImage): () => void;
  open(image: GalleryImage): void;
};
const GalleryContext = createContext<GalleryContextValue | null>(null);

/** One gallery per conversation, shared by generated artifacts and Markdown. */
export function ChatImageGallery({ children, projectName }: { children: ReactNode; projectName?: string }) {
  const parent = useContext(GalleryContext);
  return parent ? children : <OwnedGallery projectName={projectName}>{children}</OwnedGallery>;
}

function OwnedGallery({ children, projectName }: { children: ReactNode; projectName?: string }) {
  const images = useRef(new Map<string, GalleryImage>());
  const [viewer, setViewer] = useState<{ images: GalleryImage[]; index: number; open: boolean; revision: number } | null>(null);
  const register = useCallback((image: GalleryImage) => {
    images.current.set(image.id, image);
    return () => { images.current.delete(image.id); };
  }, []);
  const open = useCallback((image: GalleryImage) => {
    const ordered = [...images.current.values()].sort((a, b) => {
      if (!a.element || !b.element) return 0;
      return a.element.compareDocumentPosition(b.element) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1;
    });
    if (!ordered.some(value => value.id === image.id)) ordered.push(image);
    const unique = ordered.filter((value, index) => ordered.findIndex(other => other.source === value.source) === index);
    setViewer(previous => ({ images: unique, index: Math.max(0, unique.findIndex(value => value.source === image.source)), open: true, revision: (previous?.revision || 0) + 1 }));
  }, []);
  const value = useMemo(() => ({ register, open, projectName }), [register, open, projectName]);
  return <GalleryContext.Provider value={value}>
    {children}
    {viewer ? <ImageLightbox key={viewer.revision} images={viewer.images} initialIndex={viewer.index} open={viewer.open} projectName={projectName} onClose={() => setViewer(value => value ? { ...value, open: false } : null)} /> : null}
  </GalleryContext.Provider>;
}

function useImageData(source: string, variant: "thumbnail" | "original", projectName?: string, revision = 0) {
  const [state, setState] = useState<{ source: string; data?: ChatImageData; error?: string }>({ source });
  useEffect(() => {
    let current = true;
    setState({ source });
    if (!source) return;
    if (/^data:image\/(?:png|jpeg|webp|gif);base64,[A-Za-z0-9+/=]+$/.test(source) && source.length <= 28_000_000) {
      setState({ source, data: { dataUrl: source, width: 0, height: 0 } });
      return;
    }
    const request = window.openmind.readChatImage?.({ source, variant, ...(projectName ? { projectName } : {}) });
    if (!request) { setState({ source, error: "图片预览不可用" }); return; }
    void request.then(data => { if (current) setState({ source, data }); }, cause => {
      if (current) setState({ source, error: cause instanceof Error ? cause.message : "图片加载失败" });
    });
    return () => { current = false; };
  }, [source, variant, projectName, revision]);
  return state.source === source ? state : { source };
}

export function ChatImage({ source, title = "图片" }: { source: string; title?: string }) {
  const gallery = useContext(GalleryContext);
  const id = useId();
  const button = useRef<HTMLButtonElement>(null);
  const [visible, setVisible] = useState(false);
  const [revision, setRevision] = useState(0);
  const data = useImageData(visible ? source : "", "thumbnail", gallery?.projectName, revision);
  useEffect(() => {
    if (!button.current || typeof IntersectionObserver === "undefined") { setVisible(true); return; }
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) { setVisible(true); observer.disconnect(); }
    }, { rootMargin: "240px" });
    observer.observe(button.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => gallery?.register({ id, source, title, element: button.current }), [gallery, id, source, title]);
  return <span className="chat-image-card">
    <button ref={button} type="button" className="chat-image-thumbnail" data-motion="action"
      aria-label={data.error ? `重新加载图片：${title}` : `查看原图：${title}`}
      onClick={() => data.error ? setRevision(value => value + 1) : gallery?.open({ id, source, title, element: button.current })}>
      {data.data ? <img src={data.data.dataUrl} alt={title} loading="lazy" decoding="async" />
        : <span className="chat-image-placeholder" role="status">{data.error ? <><ImageOff size={22} /><span>图片加载失败 · 点击重试</span></> : <LoaderCircle size={22} className="spin" />}</span>}
      {data.data ? <span className="chat-image-open"><Maximize2 size={13} />查看原图</span> : null}
    </button>
    {data.error ? <span className="chat-image-error">{data.error}</span> : null}
  </span>;
}

export function GeneratedImages({ images }: { images: readonly GeneratedImage[] }) {
  return <div className="generated-images" aria-label="生成的图片">
    {images.map(image => <div className="generated-image" key={image.id}>
      <ChatImage source={image.source} title={image.title} />
      <span className="generated-image-caption">{IMAGE_PROVIDERS.find(provider => provider.id === image.provider)?.models.find(model => model.id === image.model)?.name || image.model}</span>
    </div>)}
  </div>;
}

function ImageLightbox({ images, initialIndex, open, projectName, onClose }: {
  images: GalleryImage[]; initialIndex: number; open: boolean; projectName?: string; onClose(): void;
}) {
  const [index, setIndex] = useState(initialIndex);
  const [actualSize, setActualSize] = useState(true);
  const [dragX, setDragX] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [direction, setDirection] = useState(0);
  const touch = useRef<{ x: number; y: number } | null>(null);
  const dialog = useRef<HTMLDivElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const tokens = useMotionTokens();
  const presence = useExitPresence(open, tokens.exitMs);
  const snapshot = useRef(images);
  if (open) snapshot.current = images;
  const displayedImages = open ? images : snapshot.current;
  const current = displayedImages[index];
  const data = useImageData(presence.visible ? current?.source || "" : "", "original", projectName);
  useEffect(() => { if (stage.current) { stage.current.scrollTop = 0; stage.current.scrollLeft = 0; } }, [index, actualSize]);
  const step = useCallback((delta: number) => {
    setDirection(delta);
    setIndex(value => (value + delta + displayedImages.length) % displayedImages.length);
    setDragX(0);
  }, [displayedImages.length]);
  useModalFocusScope({ open, containerRef: dialog, initialFocusRef: closeButton, onDismiss: onClose, layer: "global" });
  if (!presence.visible || !current) return null;
  return createPortal(<div className="chat-image-lightbox ui-overlay" data-focus-scope-backdrop data-leaving={presence.leaving || undefined}
    onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <div ref={dialog} className="chat-image-dialog" role="dialog" aria-modal="true" aria-label="图片查看器" tabIndex={-1}
      inert={!open || undefined} aria-hidden={!open || undefined}
      onKeyDown={event => {
        if (event.key === "ArrowLeft" || event.key === "ArrowRight") { event.preventDefault(); if (displayedImages.length > 1) step(event.key === "ArrowLeft" ? -1 : 1); }
      }}>
      <header className="chat-image-toolbar">
        <div><strong>图片预览</strong><span aria-live="polite">{index + 1} / {displayedImages.length}{data.data?.width ? ` · ${data.data.width} × ${data.data.height}` : ""}</span></div>
        <div>
          <button type="button" data-motion="icon" className="chat-image-toolbar-button" onClick={() => setActualSize(value => !value)} aria-label={actualSize ? "适应窗口" : "原始尺寸"} title={actualSize ? "适应窗口" : "原始尺寸"}>{actualSize ? <Minimize2 size={17} /> : <Maximize2 size={17} />}<span>{actualSize ? "适应窗口" : "原始尺寸"}</span></button>
          <button ref={closeButton} type="button" data-motion="icon" className="chat-image-toolbar-button" onClick={onClose} aria-label="关闭图片预览"><X size={20} /></button>
        </div>
      </header>
      <div ref={stage} className={`chat-image-stage${actualSize ? " is-original" : ""}`} data-dragging={dragging || undefined}
        onPointerDown={event => {
          if (event.pointerType !== "mouse" || event.button !== 0 || displayedImages.length < 2) return;
          touch.current = { x: event.clientX, y: event.clientY }; event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={event => {
          if (event.pointerType !== "mouse" || !touch.current) return;
          const x = event.clientX - touch.current.x;
          if (Math.abs(x) > 8) { setDragging(true); setDragX(Math.max(-160, Math.min(160, x))); }
        }}
        onPointerUp={event => {
          if (event.pointerType !== "mouse" || !touch.current) return;
          const x = event.clientX - touch.current.x;
          if (Math.abs(x) > 60) step(x < 0 ? 1 : -1);
          setDragging(false); setDragX(0); touch.current = null;
        }}
        onPointerCancel={() => { setDragging(false); setDragX(0); touch.current = null; }}
        onTouchStart={event => { if (event.touches.length === 1) touch.current = { x: event.touches[0].clientX, y: event.touches[0].clientY }; }}
        onTouchMove={event => {
          if (!touch.current || event.touches.length !== 1 || displayedImages.length < 2) return;
          const x = event.touches[0].clientX - touch.current.x;
          const y = event.touches[0].clientY - touch.current.y;
          if (Math.abs(x) > Math.abs(y) + 8) { setDragging(true); setDragX(Math.max(-160, Math.min(160, x))); }
        }}
        onTouchEnd={() => { if (dragging && Math.abs(dragX) > 60) step(dragX < 0 ? 1 : -1); setDragging(false); setDragX(0); touch.current = null; }}
        onTouchCancel={() => { setDragging(false); setDragX(0); touch.current = null; }}>
        {data.data ? <img key={current.id} className="chat-image-full" src={data.data.dataUrl} alt={current.title} draggable={false}
          data-direction={direction < 0 ? "previous" : "next"} style={{ transform: dragX ? `translateX(${dragX}px)` : undefined }} />
          : <div className="chat-image-loading" role="status">{data.error ? <><ImageOff size={30} /><span>{data.error}</span></> : <><LoaderCircle className="spin" size={28} /><span>正在加载原图…</span></>}</div>}
      </div>
      {displayedImages.length > 1 ? <>
        <button type="button" className="chat-image-nav is-previous" data-motion="icon" aria-label="上一张图片" onClick={() => step(-1)}><ChevronLeft size={24} /></button>
        <button type="button" className="chat-image-nav is-next" data-motion="icon" aria-label="下一张图片" onClick={() => step(1)}><ChevronRight size={24} /></button>
      </> : null}
      <footer className="chat-image-bottom"><span>{current.title}</span>{displayedImages.length > 1 ? <small>← → 切换图片 · 滑动查看</small> : null}</footer>
    </div>
  </div>, document.body);
}
