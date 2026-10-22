import { forwardRef, type ButtonHTMLAttributes } from "react";
import type { SelectItemVariant, SelectTone } from "./control-contract";

export interface SelectItemProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "role"> {
  role?: "option" | "menuitem" | "menuitemradio";
  variant?: SelectItemVariant;
  tone?: SelectTone;
}

/** Choice rows keep Select's spacing and states; the owning menu handles navigation. */
export const SelectItem = forwardRef<HTMLButtonElement, SelectItemProps>(function SelectItem({
  role = "option", variant = "option", tone = "neutral", className = "", type = "button", ...props
}, ref) {
  return <button {...props} ref={ref} type={type} role={role} data-ui-control="select-option" data-motion="selection"
    data-variant={variant} data-tone={tone} className={`ui-select-option ${className}`.trim()} />;
});
