import type { ComponentPropsWithoutRef } from "react";

/** Shared visual surface for simple selects and grouped model menus. */
export function SelectMenuSurface({ side = "bottom", leaving, className = "", ...props }: ComponentPropsWithoutRef<"div"> & {
  side?: "top" | "bottom" | "left" | "right";
  leaving?: boolean;
}) {
  return <div {...props} className={`ui-select-surface ${className}`.trim()} data-side={side} data-leaving={leaving || undefined} />;
}
