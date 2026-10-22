import { forwardRef, type ButtonHTMLAttributes } from "react";
import { X } from "lucide-react";
import type { ImageThumbnailVariant } from "./control-contract";
import { IconButton } from "./IconButton";

/** Image actions use a media surface, while normal actions use Button/IconButton. */
export const ImageThumbnail = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & { label: string; variant?: ImageThumbnailVariant }>(
  function ImageThumbnail({ label, variant = "default", className = "", ...props }, ref) {
    return <button {...props} ref={ref} type="button" aria-label={label} aria-haspopup="dialog" data-ui-control="image-thumbnail"
      data-motion="action" data-variant={variant} className={`ui-image-thumbnail ${className}`.trim()} />;
  }
);

/** A draft image and its removable overlay share one stable thumbnail surface. */
export function ImageAttachment({ src, label, removeLabel, onOpen, onRemove }: {
  src: string; label: string; removeLabel: string; onOpen(): void; onRemove(): void;
}) {
  return <div className="ui-image-attachment">
    <ImageThumbnail variant="attachment" label={label} onClick={onOpen}><img src={src} alt={label} /></ImageThumbnail>
    <IconButton className="ui-image-attachment-remove" shape="circle" variant="primary" label={removeLabel} tooltip={false} onClick={onRemove}><X size={12} aria-hidden /></IconButton>
  </div>;
}
