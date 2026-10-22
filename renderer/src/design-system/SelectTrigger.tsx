import { forwardRef, type ButtonHTMLAttributes } from "react";
import type { SelectShape, SelectTone, SelectVariant } from "./control-contract";

/** Simple selects and grouped model menus share the same choice trigger. */
export const SelectTrigger = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & { shape?: SelectShape; variant?: SelectVariant; tone?: SelectTone }>(
  function SelectTrigger({ shape = "pill", variant = "default", tone = "neutral", className = "", ...props }, ref) {
    return <button {...props} ref={ref} type="button" data-ui-control="select-trigger" data-motion="selection"
      data-shape={shape} data-variant={variant} data-tone={tone} className={`ui-select-trigger ${className}`.trim()} />;
  }
);
