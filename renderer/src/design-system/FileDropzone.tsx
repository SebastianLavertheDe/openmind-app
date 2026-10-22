import { forwardRef, type ButtonHTMLAttributes } from "react";

/** A file picker/drop target. File access and upload state remain behind the feature's IPC. */
export const FileDropzone = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & {
  label: string;
  dragOver?: boolean;
  variant?: "default" | "compact";
}>(function FileDropzone({ label, dragOver, variant = "default", className = "", ...props }, ref) {
  return <button {...props} ref={ref} type="button" aria-label={label} data-ui-control="dropzone" data-motion="action"
    data-drag-over={dragOver || undefined} data-variant={variant} className={`ui-file-dropzone ${className}`.trim()} />;
});
