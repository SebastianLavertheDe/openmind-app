import type { ComponentPropsWithoutRef } from "react";

/** Shared visual surface for simple selects and grouped model menus. */
export function SelectMenuSurface({ side = "bottom", variant = "default", leaving, className = "", ...props }: ComponentPropsWithoutRef<"div"> & {
  side?: "top" | "bottom" | "left" | "right";
  variant?: "default" | "grouped";
  leaving?: boolean;
}) {
  return <div {...props} className={`ui-select-surface ${className}`.trim()} data-variant={variant} data-side={side} data-leaving={leaving || undefined} />;
}
