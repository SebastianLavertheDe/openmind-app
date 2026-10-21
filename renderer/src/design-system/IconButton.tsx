import { type ComponentProps, type ReactNode } from "react";
import { Tooltip } from "./Tooltip";

/** Icon-only actions share accessible naming, motion and tooltip behavior. */
export function IconButton({ label, children, tooltip = true, className, ...props }: Omit<ComponentProps<"button">, "aria-label" | "title"> & {
  label: string;
  children: ReactNode;
  tooltip?: ReactNode;
}) {
  const button = <button type="button" data-motion="icon" {...props} aria-label={label}
    className={className ?? "icon-button"}>{children}</button>;
  return tooltip ? <Tooltip content={tooltip === true ? label : tooltip}>{button}</Tooltip> : button;
}
