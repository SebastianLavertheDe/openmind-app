import { useEffect, useRef, useState, type ReactNode } from "react";
import { ChevronLeft, ChevronRight, Maximize2, Minimize2 } from "lucide-react";
import { messages } from "@shared/messages";
import { useLocale } from "../i18n";
import { Dialog } from "./Dialog";
import { Button } from "./Button";
import { IconButton } from "./IconButton";
import { useMotionTokens } from "./motion-tokens";
import { useMotionPreference } from "./use-motion-preference";
import { X } from "lucide-react";

const m = messages.interface;
type ViewerImage = { id: string; title: string };

/** Image loading stays with the owner; navigation, gestures and modality are shared. */
export function ImageViewer({ open, images, selectedId, onSelect, onClose, src, width, height, placeholder,
  label = m.imageViewer, closeLabel = m.closeImage, previousLabel = m.previousImage, nextLabel = m.nextImage
}: {
  open: boolean;
  images: ViewerImage[];
  selectedId: string | null;
  onSelect(id: string): void;
  onClose(): void;
  src?: string;
  width?: number;
  height?: number;
  placeholder?: ReactNode;
  label?: string;
  closeLabel?: string;
  previousLabel?: string;
  nextLabel?: string;
}) {
  useLocale();
  const snapshot = useRef({ images, selectedId, src, width, height, placeholder });
  if (open) snapshot.current = { images, selectedId, src, width, height, placeholder };
  const shown = open ? { images, selectedId, src, width, height, placeholder } : snapshot.current;
  const index = shown.images.findIndex(image => image.id === shown.selectedId);
  const current = shown.images[index];
  const [actualSize, setActualSize] = useState(true);
  const [dragX, setDragX] = useState(0);
  const [direction, setDirection] = useState(0);
  const gesture = useRef<{ x: number; y: number; delta: number; horizontal: boolean } | null>(null);
  const stage = useRef<HTMLDivElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const reduced = useMotionPreference();
  const { exitMs } = useMotionTokens();
  useEffect(() => {
    if (stage.current) { stage.current.scrollTop = 0; stage.current.scrollLeft = 0; }
    gesture.current = null;
    setDragX(0);
  }, [selectedId, actualSize, open]);
  const step = (delta: number) => {
    if (!open || shown.images.length < 2 || index < 0) return;
    setDirection(delta);
    onSelect(shown.images[(index + delta + shown.images.length) % shown.images.length].id);
    setDragX(0);
  };
  const start = (x: number, y: number) => { gesture.current = { x, y, delta: 0, horizontal: false }; };
  const move = (x: number, y: number) => {
    const active = gesture.current;
    if (!active || shown.images.length < 2) return;
    active.delta = x - active.x;
    active.horizontal = Math.abs(active.delta) > Math.abs(y - active.y) + 8;
    setDragX(!reduced && active.horizontal ? Math.max(-160, Math.min(160, active.delta)) : 0);
  };
  const cancel = () => { gesture.current = null; setDragX(0); };
  const finish = (x?: number, y?: number) => {
    if (x != null && y != null) move(x, y);
    const active = gesture.current;
    if (active?.horizontal && Math.abs(active.delta) > 60) step(active.delta < 0 ? 1 : -1);
    cancel();
  };
  return <Dialog surface="media" open={open && Boolean(current)} onClose={onClose} exitMs={exitMs} initialFocusRef={closeButton}
    backdropClassName="chat-image-lightbox ui-overlay" className="chat-image-dialog" aria-label={label}
    onKeyDown={event => {
      if (event.key === "ArrowLeft" || event.key === "ArrowRight") { event.preventDefault(); step(event.key === "ArrowLeft" ? -1 : 1); }
    }}>
    <header className="chat-image-toolbar">
      <div><strong>{m.imagePreview}</strong><span aria-live="polite">{index + 1} / {shown.images.length}{shown.width ? ` · ${shown.width} × ${shown.height}` : ""}</span></div>
      <div>
        <Button variant="ghost" size="sm" type="button" data-motion="icon" className="chat-image-toolbar-button" onClick={() => setActualSize(value => !value)} aria-label={actualSize ? m.fitWindow : m.originalSize}>
          {actualSize ? <Minimize2 size={17} /> : <Maximize2 size={17} />}<span>{actualSize ? m.fitWindow : m.originalSize}</span>
        </Button>
        <IconButton ref={closeButton} className="chat-image-toolbar-button" onClick={onClose} label={closeLabel}><X size={20} /></IconButton>
      </div>
    </header>
    <div ref={stage} className={`chat-image-stage${actualSize ? " is-original" : ""}`} data-dragging={Boolean(dragX) || undefined}
      onPointerDown={event => {
        if (event.pointerType !== "mouse" || event.button !== 0 || shown.images.length < 2) return;
        start(event.clientX, event.clientY); event.currentTarget.setPointerCapture?.(event.pointerId);
      }}
      onPointerMove={event => { if (event.pointerType === "mouse") move(event.clientX, event.clientY); }}
      onPointerUp={event => { if (event.pointerType === "mouse") finish(event.clientX, event.clientY); }}
      onPointerCancel={cancel} onLostPointerCapture={cancel}
      onTouchStart={event => { const point = event.touches[0]; if (event.touches.length === 1) start(point.clientX, point.clientY); else cancel(); }}
      onTouchMove={event => { const point = event.touches[0]; if (event.touches.length === 1) move(point.clientX, point.clientY); else cancel(); }}
      onTouchEnd={event => { const point = event.changedTouches[0]; finish(point?.clientX, point?.clientY); }} onTouchCancel={cancel}>
      {shown.src && current ? <img key={current.id} className="chat-image-full" src={shown.src} alt={current.title} draggable={false}
        data-direction={direction < 0 ? "previous" : "next"} style={{ transform: dragX ? `translateX(${dragX}px)` : undefined }} />
        : <div className="chat-image-loading" role="status">{shown.placeholder}</div>}
    </div>
    {shown.images.length > 1 ? <>
      <IconButton size="lg" className="chat-image-nav is-previous" label={previousLabel} onClick={() => step(-1)}><ChevronLeft size={24} /></IconButton>
      <IconButton size="lg" className="chat-image-nav is-next" label={nextLabel} onClick={() => step(1)}><ChevronRight size={24} /></IconButton>
    </> : null}
    <footer className="chat-image-bottom"><span>{current?.title}</span>{shown.images.length > 1 ? <small>{m.imageKeys}</small> : null}</footer>
  </Dialog>;
}
