import { useId, useRef, type ComponentProps, type ReactNode } from "react";
import { messages } from "@shared/messages";
import { Button } from "./Button";
import { Dialog } from "./Dialog";
import { DialogBody, DialogFooter, DialogHeader } from "./dialog-parts";

const FIRST_FIELD = [
  '.ui-dialog-body input:not([type="hidden"]):not([disabled]):not([readonly])',
  '.ui-dialog-body textarea:not([disabled]):not([readonly])',
  '.ui-dialog-body [data-ui-control="select-trigger"]:not([disabled])'
].join(",");

export type FormDialogProps = Omit<ComponentProps<typeof Dialog>, "children" | "onSubmit" | "title"> & {
  title: string;
  description?: ReactNode;
  children: ReactNode;
  confirmLabel: string;
  cancelLabel?: string | null;
  busy?: boolean;
  confirmDisabled?: boolean;
  tone?: "neutral" | "danger";
  showFooter?: boolean;
  showCloseButton?: boolean;
  onConfirm(): void | Promise<void>;
};

/** No request state or mirrored children: Dialog retains the exit snapshot once. */
export function FormDialog({ title, description, children, confirmLabel, cancelLabel = messages.feedback.cancel,
  busy = false, confirmDisabled = false, tone = "neutral", showFooter = true, showCloseButton = true, onConfirm, onClose,
  initialFocusRef, initialFocusSelector = FIRST_FIELD, dismissDisabled, ...props }: FormDialogProps) {
  const titleId = useId();
  const descriptionId = useId();
  const cancelRef = useRef<HTMLButtonElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const cannotDismiss = busy || dismissDisabled;
  return <Dialog {...props} onClose={onClose} dismissDisabled={cannotDismiss}
    initialFocusRef={initialFocusRef || (props.role === "alertdialog" ? (tone === "danger" ? cancelRef : confirmRef) : undefined)}
    initialFocusSelector={initialFocusSelector}
    aria-labelledby={titleId} aria-describedby={description ? descriptionId : undefined}>
    <form className="ui-dialog-form" onSubmit={event => { event.preventDefault(); if (!busy && !confirmDisabled) void onConfirm(); }}>
      <DialogHeader title={title} description={description} titleId={titleId} descriptionId={descriptionId} onClose={showCloseButton ? onClose : undefined} closeDisabled={cannotDismiss} />
      <DialogBody>{children}</DialogBody>
      {showFooter ? <DialogFooter>
        {cancelLabel ? <Button ref={cancelRef} disabled={cannotDismiss} onClick={onClose}>{cancelLabel}</Button> : null}
        <Button ref={confirmRef} type="submit" variant="primary" tone={tone} loading={busy} disabled={confirmDisabled}>{confirmLabel}</Button>
      </DialogFooter> : null}
    </form>
  </Dialog>;
}

export function ConfirmDialog({ onConfirm, ...props }: Omit<FormDialogProps, "children" | "onConfirm"> & { onConfirm(): void | Promise<void> }) {
  return <FormDialog {...props} size="sm" role="alertdialog" showCloseButton={false} onConfirm={onConfirm}>{null}</FormDialog>;
}
