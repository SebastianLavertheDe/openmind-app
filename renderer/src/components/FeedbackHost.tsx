import { useLocale } from "../i18n";
import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { motion } from "motion/react";
import { AlertTriangle, CheckCircle2, Info, X } from "lucide-react";
import { messages as m } from "@shared/messages";
import { useAiUi } from "../ai-context";
import { useExitPresence } from "../design-system/use-exit-presence";
import { useExitingList } from "../design-system/use-exiting-list";
import { useCollectionMotion } from "../design-system/use-collection-motion";
import { useModalFocusScope } from "../design-system/use-modal-focus-scope";

// Bound measurements, never the number of notifications delivered.
const TOAST_LAYOUT_LIMIT = 8;

export function FeedbackHost() {
  useLocale();
  const ui = useAiUi();
  const dialogRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const descriptionId = useId();
  const confirmOpen = Boolean(ui.confirmState);
  const { visible: confirmVisible, leaving: confirmLeaving } = useExitPresence(confirmOpen, 160);
  const [stashed, setStashed] = useState(ui.confirmState);
  useEffect(() => { if (ui.confirmState) setStashed(ui.confirmState); }, [ui.confirmState]);
  const confirmation = ui.confirmState || stashed;

  useModalFocusScope({
    open: confirmOpen && confirmVisible,
    containerRef: dialogRef,
    initialFocusRef: ui.confirmState?.danger ? cancelRef : confirmRef,
    onDismiss: () => ui.resolveConfirm(false),
    layer: "global"
  });

  const toastMotion = useCollectionMotion(ui.toasts.length, TOAST_LAYOUT_LIMIT);
  const { tokens } = toastMotion;
  const toastList = useExitingList(ui.toasts, (toast) => String(toast.id), tokens.exitMs);
  const animateToasts = toastMotion.enabled && toastList.length <= TOAST_LAYOUT_LIMIT;
  // CSS owns exit presence. Neighbours move when the actual display list changes,
  // including the later timer commit that finally removes an exiting toast.
  const toastLayoutDependency = toastList.map(({ item }) => item.id).join(",");
  const confirmDialog = confirmVisible && confirmation ? (
    <div className="modal-scrim ui-overlay" data-leaving={confirmLeaving || undefined}
      inert={confirmLeaving || undefined} aria-hidden={confirmLeaving || undefined} onClick={() => ui.resolveConfirm(false)}>
      <div
        ref={dialogRef}
        className="modal-card"
        role="alertdialog"
        aria-modal="true"
        aria-label={confirmation.title}
        aria-describedby={confirmation.body ? descriptionId : undefined}
        onClick={(event) => event.stopPropagation()}
      >
        <strong>{confirmation.title}</strong>
        {confirmation.body ? <p id={descriptionId}>{confirmation.body}</p> : null}
        <div className="modal-actions">
          <button data-motion="action" className="settings-subtle-action" ref={cancelRef} onClick={() => ui.resolveConfirm(false)}>{m.feedback.cancel}</button>
          <button
            ref={confirmRef}
            className={confirmation.danger ? "danger-button" : "primary-button"}
            onClick={() => ui.resolveConfirm(true)}
          >
            {confirmation.confirmText || m.designSystem.confirm}
          </button>
        </div>
      </div>
    </div>
  ) : null;
  return (
    <>
      <motion.div className="toast-stack" aria-live="polite" layoutRoot layoutScroll>
        {toastList.map(({ item: toast, leaving }) => (
          <motion.div key={toast.id} data-toast-motion={toast.id} data-collection-motion
            layout={animateToasts ? "position" : false} layoutDependency={toastLayoutDependency}
            transition={animateToasts ? tokens.layout : { duration: 0 }}>
            <div className={`toast toast-${toast.tone}`} role="status" data-leaving={leaving || undefined}
              inert={leaving || undefined} aria-hidden={leaving || undefined}>
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
                    ui.dismissToast(toast.id);
                  }}
                >
                  {toast.action.label}
                </button>
              ) : null}
              <button data-motion="icon" aria-label={m.designSystem.dismissToast} onClick={() => ui.dismissToast(toast.id)}><X size={13} /></button>
            </div>
          </motion.div>
        ))}
      </motion.div>
      {confirmDialog && typeof document !== "undefined" ? createPortal(confirmDialog, document.body) : confirmDialog}
    </>
  );
}
