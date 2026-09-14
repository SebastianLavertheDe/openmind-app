import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { X } from "lucide-react";
import { useModalFocusScope } from "../../design-system/components";
import { useExitPresence } from "../../design-system/use-exit-presence";

export function ProjectDialog({
  open,
  title,
  description,
  confirmLabel,
  cancelLabel = "取消",
  busy = false,
  className,
  backdropClassName,
  showFooter = true,
  children,
  onConfirm,
  onClose
}: {
  open: boolean;
  title: string;
  description?: string;
  confirmLabel: string;
  cancelLabel?: string | null;
  busy?: boolean;
  className?: string;
  backdropClassName?: string;
  showFooter?: boolean;
  children: ReactNode;
  onConfirm(): void | Promise<void>;
  onClose(): void;
}) {
  const dialogRef = useRef<HTMLElement>(null);
  const { visible, leaving } = useExitPresence(open, 160);
  const [stashed, setStashed] = useState({ title, description, confirmLabel, cancelLabel, children });
  useEffect(() => {
    if (open) setStashed({ title, description, confirmLabel, cancelLabel, children });
  }, [cancelLabel, children, confirmLabel, description, open, title]);
  useModalFocusScope({ open: open && visible, containerRef: dialogRef, onDismiss: onClose, layer: "global" });
  if (!visible) return null;
  const content = open ? { title, description, confirmLabel, cancelLabel, children } : stashed;
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!busy) void onConfirm();
  };
  return (
    <div
      className={`project-dialog-backdrop${backdropClassName ? ` ${backdropClassName}` : ""}`}
      data-leaving={leaving || undefined}
      aria-hidden={leaving || undefined}
      inert={leaving || undefined}
      onMouseDown={onClose}
    >
      <section ref={dialogRef} className={`project-dialog${className ? ` ${className}` : ""}`} role="dialog" aria-modal="true" aria-labelledby="project-dialog-title" tabIndex={-1} onMouseDown={(event) => event.stopPropagation()}>
        <form onSubmit={submit}>
          <header>
            <div><h2 id="project-dialog-title">{content.title}</h2>{content.description ? <p>{content.description}</p> : null}</div>
            <button type="button" className="icon-button" aria-label="关闭" onClick={onClose}><X size={16} /></button>
          </header>
          <div className="project-dialog-body">{content.children}</div>
          {showFooter ? <footer>
            {content.cancelLabel ? <button type="button" className="settings-subtle-action" data-motion="action" onClick={onClose}>{content.cancelLabel}</button> : null}
            <button type="submit" className="primary-button" disabled={busy} aria-busy={busy || undefined}>{busy ? "处理中…" : content.confirmLabel}</button>
          </footer> : null}
        </form>
      </section>
    </div>
  );
}

export function ProjectTextField({
  label,
  value,
  placeholder,
  autoFocus,
  multiline = false,
  onChange
}: {
  label: string;
  value: string;
  placeholder?: string;
  autoFocus?: boolean;
  multiline?: boolean;
  onChange(value: string): void;
}) {
  return (
    <label className="project-field">
      <span>{label}</span>
      {multiline
        ? <textarea value={value} placeholder={placeholder} autoFocus={autoFocus} onChange={(event) => onChange(event.target.value)} />
        : <input value={value} placeholder={placeholder} autoFocus={autoFocus} onChange={(event) => onChange(event.target.value)} />}
    </label>
  );
}
