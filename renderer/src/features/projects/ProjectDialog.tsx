import { IconButton } from "../../design-system/IconButton";
import { Dialog } from "../../design-system/Dialog";
import { useLocale } from "../../i18n";
import { messages } from "@shared/messages";
import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from "react";
import { X } from "lucide-react";
import { Textarea, Input } from "../../design-system/components";
import { useExitPresence } from "../../design-system/use-exit-presence";

export function ProjectDialog({
  open,
  title,
  description,
  confirmLabel,
  cancelLabel = messages.projectUi.cancel,
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
  useLocale();
  const dialogRef = useRef<HTMLElement>(null);
  const titleId = useId();
  const { visible, leaving } = useExitPresence(open, 160);
  const [stashed, setStashed] = useState({ title, description, confirmLabel, cancelLabel, children });
  useEffect(() => {
    if (open) setStashed({ title, description, confirmLabel, cancelLabel, children });
  }, [cancelLabel, children, confirmLabel, description, open, title]);

  if (!visible) return null;
  const content = open ? { title, description, confirmLabel, cancelLabel, children } : stashed;
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!busy) void onConfirm();
  };
  return (
    <Dialog as="section" open={open} presence={{ visible, leaving }} onClose={onClose} portal={false} backdropClassName={`project-dialog-backdrop${backdropClassName ? ` ${backdropClassName}` : ""}`} containerRef={dialogRef} className={`project-dialog${className ? ` ${className}` : ""}`} aria-labelledby={titleId} role="dialog">
        <form onSubmit={submit}>
          <header>
            <div><h2 id={titleId}>{content.title}</h2>{content.description ? <p>{content.description}</p> : null}</div>
            <IconButton type="button" className="icon-button" onClick={onClose} label={messages.projectUi.close}><X size={16} /></IconButton>
          </header>
          <div className="project-dialog-body">{content.children}</div>
          {showFooter ? <footer>
            {content.cancelLabel ? <button type="button" className="settings-subtle-action" data-motion="action" onClick={onClose}>{content.cancelLabel}</button> : null}
            <button type="submit" className="primary-button" disabled={busy} aria-busy={busy || undefined}>{busy ? messages.projectUi.processing : content.confirmLabel}</button>
          </footer> : null}
        </form>
      </Dialog>
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
  useLocale();
  return (
    <label className="project-field">
      <span>{label}</span>
      {multiline
        ? <Textarea value={value} placeholder={placeholder} autoFocus={autoFocus} onChange={(event) => onChange(event.target.value)} />
        : <Input value={value} placeholder={placeholder} autoFocus={autoFocus} onChange={(event) => onChange(event.target.value)} />}
    </label>
  );
}
