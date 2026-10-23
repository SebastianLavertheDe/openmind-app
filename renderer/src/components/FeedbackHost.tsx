import { Button, ConfirmDialog } from "../design-system/components";
import { IconButton } from "../design-system/IconButton";
import { useLocale } from "../i18n";
import { motion } from "motion/react";
import { AlertTriangle, CheckCircle2, Info, X } from "lucide-react";
import { messages as m } from "@shared/messages";
import { useFeedback, useFeedbackState } from "../feedback-context";
import { useExitingList } from "../design-system/use-exiting-list";
import { useCollectionMotion } from "../design-system/use-collection-motion";

// Bound measurements, never the number of notifications delivered.
const TOAST_LAYOUT_LIMIT = 8;

export function FeedbackHost() {
  useLocale();
  const ui = { ...useFeedback(), ...useFeedbackState() };
  const confirmOpen = Boolean(ui.confirmState);
  const confirmation = ui.confirmState;

  const toastMotion = useCollectionMotion(ui.toasts.length, TOAST_LAYOUT_LIMIT);
  const { tokens } = toastMotion;
  const toastList = useExitingList(ui.toasts, (toast) => String(toast.id), tokens.exitMs);
  const animateToasts = toastMotion.enabled && toastList.length <= TOAST_LAYOUT_LIMIT;
  // CSS owns exit presence. Neighbours move when the actual display list changes,
  // including the later timer commit that finally removes an exiting toast.
  const toastLayoutDependency = toastList.map(({ item }) => item.id).join(",");
  const confirmDialog = <ConfirmDialog open={confirmOpen} title={confirmation?.title || ""}
    description={confirmation?.body} tone={confirmation?.danger ? "danger" : "neutral"}
    confirmLabel={confirmation?.confirmText || m.designSystem.confirm} cancelLabel={m.feedback.cancel}
    onClose={() => ui.resolveConfirm(false)} onConfirm={() => ui.resolveConfirm(true)} />;
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
                <Button
                  className="toast-action"
                  onClick={() => {
                    toast.action?.onClick();
                    ui.dismissToast(toast.id);
                  }}
                >
                  {toast.action.label}
                </Button>
              ) : null}
              <IconButton data-motion="icon" onClick={() => ui.dismissToast(toast.id)}  label={m.designSystem.dismissToast}><X size={13} /></IconButton>
            </div>
          </motion.div>
        ))}
      </motion.div>
      {confirmDialog}
    </>
  );
}
