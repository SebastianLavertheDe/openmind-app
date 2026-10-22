import { MenuItem } from "../../design-system/components";
import { useEffect, useState, type ReactNode } from "react";
import { Check } from "lucide-react";
import { DropdownMenu } from "../../design-system/controls";
import { documentMenuHints, documentMenuIconHtml } from "./document-menu-icons";

export function DocumentMenu({ label, name, open, disabled, align = "start", triggerClassName, onOpenChange, children }: {
  label: ReactNode; name: string; open: boolean; disabled?: boolean; align?: "start" | "end";
  onOpenChange(open: boolean): void; children: ReactNode;
  triggerClassName?: string;
}) {
  const [entered, setEntered] = useState(false);
  useEffect(() => {
    if (!open) { setEntered(false); return; }
    // Portals are first positioned while hidden. Let that initial style paint
    // before entering, so the shared CSS transition also runs on first open.
    let settleFrame = 0;
    const entryFrame = requestAnimationFrame(() => {
      settleFrame = requestAnimationFrame(() => setEntered(true));
    });
    return () => { cancelAnimationFrame(entryFrame); cancelAnimationFrame(settleFrame); };
  }, [open]);
  return <DropdownMenu label={label} ariaLabel={name} menuLabel={name} disabled={disabled}
    className={`document-menu-trigger${triggerClassName ? ` ${triggerClassName}` : ""}`}
    menuClassName={`document-menu${entered ? "" : " document-menu-entering"}`} menuAlign={align}
    open={open} onOpenChange={onOpenChange} restoreFocusOnSelect={false}>
    <div className="document-menu-scroll">{children}</div>
    <div className="document-menu-footer" aria-hidden="true" />
  </DropdownMenu>;
}

export function DocumentMenuItem({ icon, label, active, radio, disabled, onClick }: {
  icon: string; label: string; active?: boolean; radio?: boolean; disabled?: boolean; onClick(): void;
}) {
  return <MenuItem type="button" data-motion="selection" className="document-menu-item"
    role={radio ? "menuitemradio" : "menuitem"} aria-checked={radio ? Boolean(active) : undefined}
    data-active={active || undefined} disabled={disabled} onClick={onClick}>
    <span className="document-menu-icon" aria-hidden="true" dangerouslySetInnerHTML={{ __html: documentMenuIconHtml(icon) }} />
    <span className="document-menu-label">{label}</span>
    <span className="document-menu-hint" aria-hidden="true">{active ? <Check size={16} strokeWidth={1.5} /> : documentMenuHints[icon]}</span>
  </MenuItem>;
}

export function DocumentMenuHeading({ children }: { children: ReactNode }) {
  return <div className="document-menu-group-label">{children}</div>;
}
