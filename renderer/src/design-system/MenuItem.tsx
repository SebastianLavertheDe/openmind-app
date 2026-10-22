import { forwardRef, type ButtonHTMLAttributes } from "react";

export interface MenuItemProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "role"> {
  "data-motion"?: string;
  role?: "menuitem" | "menuitemradio" | "menuitemcheckbox" | "option";
  tone?: "neutral" | "danger";
}

/** Menu activation/dismissal stays with the shared menu, not every item. */
export const MenuItem = forwardRef<HTMLButtonElement, MenuItemProps>(function MenuItem({
  className = "", role = "menuitem", tone = "neutral", type = "button", ...props
}, ref) {
  return <button {...props} type={type} ref={ref} role={role} data-motion={props["data-motion"] || (role === "menuitem" ? "action" : "selection")}
    data-ui-control="menu-item" data-tone={tone} className={`ui-menu-item ${className}`.trim()} />;
});
