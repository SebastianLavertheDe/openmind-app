import { forwardRef, type ButtonHTMLAttributes } from "react";

/** Image actions use a media surface, while normal actions use Button/IconButton. */
export const ImageThumbnail = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & { label: string }>(
  function ImageThumbnail({ label, className = "", ...props }, ref) {
    return <button {...props} ref={ref} type="button" aria-label={label} aria-haspopup="dialog" data-ui-control="image-thumbnail"
      data-motion="action" className={`ui-image-thumbnail ${className}`.trim()} />;
  }
);
