import { ImageThumbnail } from "../../design-system/components";
import { useLocale } from "../../i18n";
import { messages as uiMessages } from "@shared/messages";
import { createContext, useCallback, useContext, useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { ImageOff, LoaderCircle, Maximize2 } from "lucide-react";
import type { ChatImageData, GeneratedImage } from "@shared/image-generation";
import { IMAGE_PROVIDERS } from "@shared/image-generation";
import { ImageViewer } from "../../design-system/components";
import type { ImageThumbnailVariant } from "../../design-system/control-contract";

type GalleryImage = { id: string; source: string; title: string; element?: HTMLElement | null };
type GalleryContextValue = {
  projectName?: string;
  register(image: GalleryImage): () => void;
  open(image: GalleryImage): void;
};
const GalleryContext = createContext<GalleryContextValue | null>(null);

/** One gallery per conversation, shared by generated artifacts and Markdown. */
export function ChatImageGallery({ children, projectName }: { children: ReactNode; projectName?: string }) {
  useLocale();
  const parent = useContext(GalleryContext);
  return parent ? children : <OwnedGallery projectName={projectName}>{children}</OwnedGallery>;
}

function OwnedGallery({ children, projectName }: { children: ReactNode; projectName?: string }) {
  const locale = useLocale();
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
  const value = useMemo(() => ({ register, open, projectName }), [register, open, projectName, locale]);
  return <GalleryContext.Provider value={value}>
    {children}
    {viewer ? <ImageLightbox key={viewer.revision} images={viewer.images} initialIndex={viewer.index} open={viewer.open} projectName={projectName} onClose={() => setViewer(value => value ? { ...value, open: false } : null)} /> : null}
  </GalleryContext.Provider>;
}

function useImageData(source: string, variant: "thumbnail" | "original", projectName?: string, revision = 0, enabled = true) {
  const [state, setState] = useState<{ source: string; data?: ChatImageData; error?: string }>({ source });
  useEffect(() => {
    let current = true;
    setState({ source });
    if (!enabled) return;
    if (!source) { setState({ source, error: uiMessages.interface.imageUnavailable }); return; }
    if (/^data:image\/(?:png|jpeg|webp|gif);base64,[A-Za-z0-9+/=]+$/.test(source) && source.length <= 28_000_000) {
      setState({ source, data: { dataUrl: source, width: 0, height: 0 } });
      return;
    }
    const request = window.openmind.readChatImage?.({ source, variant, ...(projectName ? { projectName } : {}) });
    if (!request) { setState({ source, error: uiMessages.interface.imageUnavailable }); return; }
    void request.then(data => { if (current) setState({ source, data }); }, cause => {
      if (current) setState({ source, error: cause instanceof Error ? cause.message : uiMessages.interface.imageLoadFailed });
    });
    return () => { current = false; };
  }, [source, variant, projectName, revision, enabled]);
  return state.source === source ? state : { source };
}

export function ChatImage({ source, title = uiMessages.interface.image, variant = "default" }: { source: string; title?: string; variant?: ImageThumbnailVariant }) {
  useLocale();
  const gallery = useContext(GalleryContext);
  const id = useId();
  const button = useRef<HTMLButtonElement>(null);
  const [visible, setVisible] = useState(false);
  const [revision, setRevision] = useState(0);
  const data = useImageData(source, "thumbnail", gallery?.projectName, revision, visible);
  useEffect(() => {
    if (!button.current || typeof IntersectionObserver === "undefined") { setVisible(true); return; }
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) { setVisible(true); observer.disconnect(); }
    }, { rootMargin: "240px" });
    observer.observe(button.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => gallery?.register({ id, source, title, element: button.current }), [gallery, id, source, title]);
  return <span className="chat-image-card" data-variant={variant}>
    <ImageThumbnail ref={button} variant={variant} type="button" data-motion="action"
      label={data.error ? uiMessages.interface.reloadImage(title) : uiMessages.interface.viewOriginal(title)}
      onClick={() => data.error ? setRevision(value => value + 1) : gallery?.open({ id, source, title, element: button.current })}>
      {data.data ? <img src={data.data.dataUrl} alt={title} loading="lazy" decoding="async" />
        : <span className="chat-image-placeholder" role="status">{data.error ? <><ImageOff size={22} /><span>{uiMessages.interface.imageRetry}</span></> : <LoaderCircle size={22} className="spin" />}</span>}
      {data.data && variant === "default" ? <span className="chat-image-open"><Maximize2 size={13} />{uiMessages.interface.originalImage}</span> : null}
    </ImageThumbnail>
    {data.error && variant !== "tool" ? <span className="chat-image-error">{data.error}</span> : null}
  </span>;
}

export function GeneratedImages({ images }: { images: readonly GeneratedImage[] }) {
  useLocale();
  return <div className="generated-images" aria-label={uiMessages.interface.generatedImage}>
    {images.map(image => <div className="generated-image" key={image.id}>
      <ChatImage source={image.source} title={image.title} />
      <span className="generated-image-caption">{IMAGE_PROVIDERS.find(provider => provider.id === image.provider)?.models.find(model => model.id === image.model)?.name || image.model}</span>
    </div>)}
  </div>;
}

function ImageLightbox({ images, initialIndex, open, projectName, onClose }: {
  images: GalleryImage[]; initialIndex: number; open: boolean; projectName?: string; onClose(): void;
}) {
  useLocale();
  const [selectedId, setSelectedId] = useState(images[initialIndex]?.id || null);
  const current = images.find(image => image.id === selectedId);
  const data = useImageData(open ? current?.source || "" : "", "original", projectName);
  return <ImageViewer open={open} images={images} selectedId={selectedId} onSelect={setSelectedId} onClose={onClose}
    src={data.data?.dataUrl} width={data.data?.width} height={data.data?.height}
    placeholder={data.error ? <><ImageOff size={30} /><span>{data.error}</span></> : <><LoaderCircle className="spin" size={28} /><span>{uiMessages.interface.loadingOriginal}</span></>} />;
}
