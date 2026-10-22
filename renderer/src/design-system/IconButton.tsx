import { forwardRef, type ReactNode } from "react";
import { Tooltip } from "./Tooltip";
import { Button, type ButtonProps } from "./Button";
import type { IconButtonShape } from "./control-contract";

/** Icon-only actions share accessible naming, motion and tooltip behavior. */
export const IconButton = forwardRef<HTMLButtonElement, Omit<ButtonProps, "aria-label" | "title"> & {
  label: string;
  children: ReactNode;
  tooltip?: ReactNode;
  shape?: IconButtonShape;
}>(function IconButton({ label, children, tooltip = true, className = "", variant = "ghost", size = "sm", shape = "rect", loading = false, ...props }, ref) {
  const button = <Button {...props} ref={ref} variant={variant} size={size} loading={loading} data-motion={props["data-motion"] || "icon"} aria-label={label}
    className={`ui-icon-button ${className}`.trim()} data-shape={shape}>{loading ? null : children}</Button>;
  return tooltip ? <Tooltip content={tooltip === true ? label : tooltip}>{button}</Tooltip> : button;
});
