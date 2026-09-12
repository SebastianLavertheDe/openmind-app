import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AlertTriangle, CheckCircle2, Info, X } from "lucide-react";
import { messages as m } from "@shared/messages";
import { useAi } from "../ai-context";
import { useExitPresence } from "../design-system/use-exit-presence";
import { useExitingList } from "../design-system/use-exiting-list";

export function FeedbackHost() {
  const ai = useAi();
  const dialogRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const descriptionId = useId();
  const confirmOpen = Boolean(ai.confirmState);
  const { visible: confirmVisible, leaving: confirmLeaving } = useExitPresence(confirmOpen, 160);
  const [stashed, setStashed] = useState(ai.confirmState);
  useEffect(() => { if (ai.confirmState) setStashed(ai.confirmState); }, [ai.confirmState]);

  useEffect(() => {
    if (!ai.confirmState) return;
    previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const frame = window.requestAnimationFrame(() => {
      (ai.confirmState?.danger ? cancelRef.current : confirmRef.current)?.focus();
    });

    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        ai.resolveConfirm(false);
        return;
      }
      if (event.key !== "Tab") return;

      const focusable = Array.from(
        dialogRef.current?.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
        ) || []
      );
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable.at(-1) || first;
      const active = document.activeElement;
      if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("keydown", onKey);
      previousFocusRef.current?.focus();
      previousFocusRef.current = null;
    };
  }, [ai.confirmState, ai.resolveConfirm]);

  const toastList = useExitingList(ai.toasts, (toast) => String(toast.id), 160);
  const confirmDialog = confirmVisible && stashed ? (
    <div className="modal-scrim ui-overlay" data-leaving={confirmLeaving || undefined} onClick={() => ai.resolveConfirm(false)}>
      <div
        ref={dialogRef}
        className="modal-card"
        role="alertdialog"
        aria-modal="true"
        aria-label={stashed.title}
        aria-describedby={stashed.body ? descriptionId : undefined}
        onClick={(event) => event.stopPropagation()}
      >
        <strong>{stashed.title}</strong>
        {stashed.body ? <p id={descriptionId}>{stashed.body}</p> : null}
        <div className="modal-actions">
          <button data-motion="action" className="settings-subtle-action" ref={cancelRef} onClick={() => ai.resolveConfirm(false)}>{m.feedback.cancel}</button>
          <button
            ref={confirmRef}
            className={stashed.danger ? "danger-button" : "primary-button"}
            onClick={() => ai.resolveConfirm(true)}
          >
            {stashed.confirmText || m.designSystem.confirm}
          </button>
        </div>
      </div>
    </div>
  ) : null;
  return (
    <>
      <div className="toast-stack" aria-live="polite">
        {toastList.map(({ item: toast, leaving }) => (
          <div key={toast.id} className={`toast toast-${toast.tone}`} role="status" data-leaving={leaving || undefined}>
            {toast.tone === "success" ? <CheckCircle2 size={15} /> : toast.tone === "error" ? <AlertTriangle size={15} /> : <Info size={15} />}
            <div className="toast-body">
              <span>{toast.text}</span>
              {toast.recovery ? <small>{toast.recovery}</small> : null}
            </div>
            {toast.action ? (
              <button
                className="toast-action"
                onClick={() => {
                  toast.action?.onClick();
                  ai.dismissToast(toast.id);
                }}
              >
                {toast.action.label}
              </button>
            ) : null}
            <button data-motion="icon" aria-label={m.designSystem.dismissToast} onClick={() => ai.dismissToast(toast.id)}><X size={13} /></button>
          </div>
        ))}
      </div>
      {confirmDialog && typeof document !== "undefined" ? createPortal(confirmDialog, document.body) : confirmDialog}
    </>
  );
}
