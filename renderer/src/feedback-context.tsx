import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { messages as m } from "@shared/messages";
import { storageJson, writeStorage } from "./app/storage";

type ToastTone = "info" | "success" | "error";
type ToastAction = { label: string; onClick: () => void };
type Toast = { id: number; text: string; tone: ToastTone; recovery: string | null; action?: ToastAction };
type FeedbackLogEntry = { timestamp: string; text: string; tone: ToastTone; recovery: string | null; sessionId: string | null };
type NotifyOptions = { sessionId?: string | null; action?: ToastAction; durationMs?: number };
export type ConfirmOptions = { title: string; body?: string; confirmText?: string; danger?: boolean };
export type ConfirmAction = (options: ConfirmOptions) => Promise<boolean>;

export interface FeedbackActions {
  notify(text: string, tone?: ToastTone, options?: NotifyOptions): void;
  dismissToast(id: number): void;
  confirm: ConfirmAction;
  resolveConfirm(value: boolean): void;
}
export interface FeedbackState { toasts: Toast[]; confirmState: ConfirmOptions | null }
const ActionsContext = createContext<FeedbackActions | null>(null);
const StateContext = createContext<FeedbackState | null>(null);
const FEEDBACK_LOG_KEY = "openmind.feedback.log.v1";

export function FeedbackProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const toastSeq = useRef(0);
  const toastTimers = useRef(new Map<number, number>());
  const [confirmState, setConfirmState] = useState<ConfirmOptions | null>(null);
  const confirmResolver = useRef<((value: boolean) => void) | null>(null);
  const confirm = useCallback((options: ConfirmOptions) => new Promise<boolean>((resolve) => {
    // A newer prompt supersedes the old one; its caller must still settle.
    confirmResolver.current?.(false);
    confirmResolver.current = resolve;
    setConfirmState(options);
  }), []);
  useEffect(() => () => {
    confirmResolver.current?.(false);
    confirmResolver.current = null;
  }, []);
  const resolveConfirm = useCallback((value: boolean) => {
    confirmResolver.current?.(value);
    confirmResolver.current = null;
    setConfirmState(null);
  }, []);

  const notify = useCallback((text: string, tone: ToastTone = "info", options: NotifyOptions = {}) => {
    const id = ++toastSeq.current;
    const recovery = tone === "error" ? recoveryHint(text) : null;
    recordFeedback({ timestamp: new Date().toISOString(), text, tone, recovery, sessionId: options.sessionId ?? null });
    setToasts((current) => [...current, { id, text, tone, recovery, action: options.action }]);
    // Capture the timer handle so dismiss/unmount can cancel it; after jsdom
    // teardown `window` is gone and a late setToasts would crash the runner.
    const timer = window.setTimeout(() => {
      toastTimers.current.delete(id);
      setToasts((current) => current.filter((item) => item.id !== id));
    }, options.durationMs ?? 2800);
    toastTimers.current.set(id, timer);
  }, []);
  const dismissToast = useCallback((id: number) => {
    const timer = toastTimers.current.get(id);
    if (timer !== undefined) { window.clearTimeout(timer); toastTimers.current.delete(id); }
    setToasts((current) => current.filter((item) => item.id !== id));
  }, []);

  useEffect(() => () => {
    for (const timer of toastTimers.current.values()) window.clearTimeout(timer);
    toastTimers.current.clear();
  }, []);
  const actions = useMemo(() => ({ notify, dismissToast, confirm, resolveConfirm }), [notify, dismissToast, confirm, resolveConfirm]);
  const state = useMemo(() => ({ toasts, confirmState }), [toasts, confirmState]);
  return <ActionsContext.Provider value={actions}><StateContext.Provider value={state}>{children}</StateContext.Provider></ActionsContext.Provider>;
}

/** Standalone AI roots retain feedback support; the app supplies its own root. */
export function FeedbackBoundary({ children }: { children: ReactNode }) {
  return useContext(ActionsContext) ? children : <FeedbackProvider>{children}</FeedbackProvider>;
}
export function useFeedback(): FeedbackActions {
  const value = useContext(ActionsContext);
  if (!value) throw new Error("useFeedback must be used within FeedbackProvider");
  return value;
}
export function useFeedbackState(): FeedbackState {
  const value = useContext(StateContext);
  if (!value) throw new Error("useFeedbackState must be used within FeedbackProvider");
  return value;
}

function recordFeedback(entry: FeedbackLogEntry): void {
  const current = storageJson<FeedbackLogEntry[]>(FEEDBACK_LOG_KEY, []);
  writeStorage(FEEDBACK_LOG_KEY, [...current, entry].slice(-120));
}

function recoveryHint(text: string): string {
  const value = text.toLocaleLowerCase();
  if (/skill|自动化|流水线|采集|数据源|source/.test(value)) return m.ai.recovery.skill;
  if (/provider|claude|codex|ai|审批|权限|会话/.test(value)) return m.ai.recovery.provider;
  if (/索引|资料|内容|inbox|读取/.test(value)) return m.ai.recovery.index;
  if (/文件|路径|目录|导入|导出|权限|保存/.test(value)) return m.ai.recovery.file;
  return m.ai.recovery.default;
}
