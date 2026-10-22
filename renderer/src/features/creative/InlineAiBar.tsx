import { Button } from "../../design-system/components";
import { useLocale } from "../../i18n";
import { useEffect, useRef, useState } from "react";
import { Check, LoaderCircle, RefreshCw, Sparkles, Wand2, X } from "lucide-react";
import { messages as m } from "@shared/messages";
import { useAiActions, useAiSnapshot, useAiStreaming, useAiUi } from "../../ai-context";
import type { EditorSelectionSnapshot } from "./MarkdownEditor";

type ActionKey = "rewrite" | "extend" | "shorten" | "tone" | "translate";

const ACTION_KEYS: ActionKey[] = ["rewrite", "extend", "shorten", "tone", "translate"];

/**
 * 编辑器内联 AI（P1-A）。
 * 选中正文 → 出现动作条 → 经现有 agent 运行时流式生成 → 接受则替换选中段、放弃则取消。
 * 走 ai.send / useAiStreaming / ai.cancel，不引入新的 IPC。
 */
export function InlineAiBar({
  selection,
  disabled,
  onReplace
}: {
  selection: EditorSelectionSnapshot;
  disabled?: boolean;
  onReplace(start: number, end: number, replacement: string, bookmark?: number): boolean | void;
}) {
  useLocale();
  const { snapshot, activeSession } = useAiSnapshot();
  const actions = useAiActions();
  const ui = useAiUi();
  const [sel, setSel] = useState<EditorSelectionSnapshot | null>(null);
  const [runId, setRunId] = useState<string | null>(null);
  const [range, setRange] = useState<EditorSelectionSnapshot | null>(null);
  const [done, setDone] = useState(false);
  const [finalText, setFinalText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const requestRef = useRef(0);
  const ownRunRef = useRef<string | null>(null);
  const { streaming } = useAiStreaming(runId);
  const lastStream = useRef("");

  useEffect(() => {
    if (runId || pending) return;
    setSel(selection.text ? selection : null);
  }, [runId, pending, selection]);

  useEffect(() => () => {
    requestRef.current++;
    if (ownRunRef.current) void actions.cancel(ownRunRef.current).catch(() => {});
  }, [actions.cancel]);

  useEffect(() => { if (streaming) lastStream.current = streaming; }, [streaming]);
  const run = snapshot.runs.find(item => item.id === runId);
  const terminal = run && ["completed", "failed", "cancelled"].includes(run.status);
  useEffect(() => {
    if (!runId || !terminal || !run) return;
    let active = true;
    ownRunRef.current = null;
    // The final durable message can arrive without deltas, or after the stream
    // store has cleared. Read this run's transcript rather than another active chat.
    void window.openmind.aiGetEvents(run.sessionId).then(events => {
      if (!active) return;
      const message = events.filter(event => event.runId === runId && event.kind === "assistant-message").at(-1);
      const text = typeof message?.payload.text === "string" ? message.payload.text : lastStream.current;
      setFinalText(text); setDone(true);
      if (run.status === "failed") setError(run.error || m.creativeUi.inlineAi.generateFailed);
      else if (run.status === "cancelled") setError(m.editor.rewriteCanceled);
      else if (!text.trim()) setError(m.editor.noReplacementGenerated);
    }).catch(cause => {
      if (active) { setError(cause instanceof Error ? cause.message : String(cause)); setDone(true); }
    });
    return () => { active = false; };
  }, [runId, terminal, run?.sessionId, run?.status, run?.error]);

  const busy = pending || Boolean(runId) && !done;

  const start = async (instruction: string) => {
    if (!sel || disabled || ui.isSending || pending) return;
    const text = sel.text;
    setError(null);
    lastStream.current = "";
    setFinalText("");
    setDone(false);
    setRange(sel);
    setPending(true);
    const request = ++requestRef.current;
    setRunId(null);
    const prompt = `${instruction}${m.creativeUi.inlineAi.promptSuffix}${m.creativeUi.inlineAi.originalPrefix}${text}`;
    try {
      const started = await actions.send(prompt, { permissionProfile: "read-only", sessionId: null, providerId: activeSession?.providerId, contexts: [], preserveDraft: true });
      if (request !== requestRef.current) { void actions.cancel(started.id).catch(() => {}); return; }
      ownRunRef.current = started.id;
      setRunId(started.id);
      setPending(false);
    } catch (cause) {
      if (request !== requestRef.current) return;
      setPending(false);
      setError(cause instanceof Error ? cause.message : String(cause));
      setRunId(null);
      setRange(null);
    }
  };

  const accept = () => {
    if (!range || disabled || !finalText.trim()) return;
    if (onReplace(range.start, range.end, finalText, range.bookmark) === false) {
      setError(m.editor.selectionChanged);
      return;
    }
    reset();
  };

  const cancel = async () => {
    if (runId && !done) {
      try { await actions.cancel(runId); } catch { /* 取消失败忽略 */ }
    }
    reset();
  };

  const reset = () => {
    requestRef.current++;
    ownRunRef.current = null;
    setPending(false);
    setRunId(null);
    setRange(null);
    setDone(false);
    setFinalText("");
    setError(null);
    lastStream.current = "";
    setSel(null);
  };

  const preview = done ? finalText : streaming || lastStream.current;
  const showSelectionBar = Boolean(sel) && !disabled && !runId && !pending;

  return (
    <div className="inline-ai-bar">
      {showSelectionBar && sel ? (
        <div className="inline-ai-selection" role="toolbar" aria-label={m.creativeUi.inlineAi.toolbar}>
          <Sparkles size={13} />
          <span className="inline-ai-sel-label">{m.creativeUi.inlineAi.selectedChars(sel.text.length)}</span>
          {ACTION_KEYS.map((key) => (
            <Button
              key={key}
              className="inline-ai-action"
              onClick={() => void start(m.creativeUi.inlineAi[`${key}Instruction`])}
              disabled={ui.isSending}
              title={m.creativeUi.inlineAi[`${key}Instruction`]}
            >
              {m.creativeUi.inlineAi[key]}
            </Button>
          ))}
        </div>
      ) : null}
      {error && !runId ? <p className="inline-error" role="alert">{error}</p> : null}
      {runId || pending ? (
        <div className="inline-ai-preview">
          <header>
            <span className="eyebrow">{busy ? <><LoaderCircle className="spin" size={12} /> {m.creativeUi.inlineAi.generating}</> : <><Wand2 size={12} /> {m.creativeUi.inlineAi.result}</>}</span>
            <div className="inline-ai-actions">
              {busy ? <Button variant="ghost" data-motion="action" onClick={() => void cancel()} title={m.creativeUi.inlineAi.cancel}><X size={12} />{m.creativeUi.inlineAi.cancel}</Button> : null}
              {!busy && !error ? <Button variant="ghost" data-motion="action" onClick={() => void start(m.creativeUi.inlineAi.rewriteInstruction)} title={m.common.retry}><RefreshCw size={12} />{m.creativeUi.inlineAi.retry}</Button> : null}
              {!busy && !error ? <Button variant="primary"  data-motion="action" disabled={disabled || !finalText.trim()} onClick={accept} title={m.creativeUi.inlineAi.replaceSelectionTitle}><Check size={12} />{m.creativeUi.inlineAi.replaceSelection}</Button> : null}
              {!busy ? <Button variant="ghost" data-motion="action" onClick={() => void cancel()} title={error ? m.creativeUi.inlineAi.close : m.creativeUi.inlineAi.discard}>{error ? m.creativeUi.inlineAi.close : m.creativeUi.inlineAi.discard}</Button> : null}
            </div>
          </header>
          {error ? <p className="inline-error">{error}</p> : null}
          <pre className="inline-ai-out" aria-live="polite">{error ? null : (preview || (busy ? m.creativeUi.inlineAi.busyEllipsis : m.creativeUi.inlineAi.noOutput))}</pre>
          {!busy && !error && range ? <p className="inline-ai-foot">{m.editor.confirmReplacement}</p> : null}
        </div>
      ) : null}
    </div>
  );
}
