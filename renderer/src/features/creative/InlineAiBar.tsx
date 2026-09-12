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
  onReplace(start: number, end: number, replacement: string): void;
}) {
  const { snapshot, activeRun, sessionActiveRun } = useAiSnapshot();
  const actions = useAiActions();
  const ui = useAiUi();
  const streamingRunId = sessionActiveRun?.id || activeRun?.id || null;
  const { streaming } = useAiStreaming(streamingRunId);
  const [sel, setSel] = useState<{ start: number; end: number; text: string } | null>(null);
  const [runId, setRunId] = useState<string | null>(null);
  const [range, setRange] = useState<{ start: number; end: number } | null>(null);
  const [done, setDone] = useState(false);
  const [finalText, setFinalText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const pendingRef = useRef(false);
  const lastStream = useRef("");

  useEffect(() => {
    if (runId) return;
    setSel(selection.text ? selection : null);
  }, [runId, selection]);

  // send 之后捕获本次 run 的 id（send 不返回 run id，靠 activeRun 兜底）
  useEffect(() => {
    if (pendingRef.current && activeRun?.id && !runId) {
      setRunId(activeRun.id);
      pendingRef.current = false;
    }
  }, [activeRun, runId]);

  // 镜像流式文本 + 检测完成
  useEffect(() => {
    if (!runId) return;
    if (activeRun?.id === runId && streaming) lastStream.current = streaming;
    const run = snapshot.runs.find((item) => item.id === runId);
    if (run && ["completed", "failed", "cancelled"].includes(run.status) && !done) {
      setDone(true);
      setFinalText(lastStream.current);
      if (run.status === "failed") setError(run.error || m.creativeUi.inlineAi.generateFailed);
    }
  }, [runId, activeRun, streaming, snapshot.runs, done]);

  const busy = Boolean(runId) && !done;

  const start = async (instruction: string) => {
    if (!sel || disabled || ui.isSending) return;
    const text = sel.text;
    setError(null);
    lastStream.current = "";
    setFinalText("");
    setDone(false);
    setRange({ start: sel.start, end: sel.end });
    pendingRef.current = true;
    setRunId(null);
    const prompt = `${instruction}${m.creativeUi.inlineAi.promptSuffix}${m.creativeUi.inlineAi.originalPrefix}${text}`;
    try {
      await actions.send(prompt, { permissionProfile: "read-only" });
    } catch (cause) {
      pendingRef.current = false;
      setError(cause instanceof Error ? cause.message : String(cause));
      setRunId(null);
      setRange(null);
    }
  };

  const accept = () => {
    if (!range) return;
    onReplace(range.start, range.end, finalText);
    reset();
  };

  const cancel = async () => {
    if (runId && !done) {
      try { await actions.cancel(runId); } catch { /* 取消失败忽略 */ }
    }
    reset();
  };

  const reset = () => {
    setRunId(null);
    setRange(null);
    setDone(false);
    setFinalText("");
    setError(null);
    lastStream.current = "";
    setSel(null);
  };

  const preview = done ? finalText : (activeRun?.id === runId ? streaming || lastStream.current : lastStream.current);
  const showSelectionBar = Boolean(sel) && !disabled && !runId;

  return (
    <div className="inline-ai-bar">
      {showSelectionBar && sel ? (
        <div className="inline-ai-selection" role="toolbar" aria-label={m.creativeUi.inlineAi.toolbar}>
          <Sparkles size={13} />
          <span className="inline-ai-sel-label">{m.creativeUi.inlineAi.selectedChars(sel.text.length)}</span>
          {ACTION_KEYS.map((key) => (
            <button
              key={key}
              className="inline-ai-action"
              onClick={() => void start(m.creativeUi.inlineAi[`${key}Instruction`])}
              disabled={ui.isSending}
              title={m.creativeUi.inlineAi[`${key}Instruction`]}
            >
              {m.creativeUi.inlineAi[key]}
            </button>
          ))}
        </div>
      ) : null}
      {runId ? (
        <div className="inline-ai-preview">
          <header>
            <span className="eyebrow">{busy ? <><LoaderCircle className="spin" size={12} /> {m.creativeUi.inlineAi.generating}</> : <><Wand2 size={12} /> {m.creativeUi.inlineAi.result}</>}</span>
            <div className="inline-ai-actions">
              {busy ? <button data-motion="action" onClick={() => void cancel()} title={m.creativeUi.inlineAi.cancel}><X size={12} />{m.creativeUi.inlineAi.cancel}</button> : null}
              {!busy && !error ? <button data-motion="action" onClick={() => void start(m.creativeUi.inlineAi.rewriteInstruction)} title={m.common.retry}><RefreshCw size={12} />{m.creativeUi.inlineAi.retry}</button> : null}
              {!busy && !error ? <button className="primary-button" data-motion="action" onClick={accept} title={m.creativeUi.inlineAi.replaceSelectionTitle}><Check size={12} />{m.creativeUi.inlineAi.replaceSelection}</button> : null}
              {!busy ? <button data-motion="action" onClick={() => void cancel()} title={error ? m.creativeUi.inlineAi.close : m.creativeUi.inlineAi.discard}>{error ? m.creativeUi.inlineAi.close : m.creativeUi.inlineAi.discard}</button> : null}
            </div>
          </header>
          {error ? <p className="inline-error">{error}</p> : null}
          <pre className="inline-ai-out" aria-live="polite">{error ? null : (preview || (busy ? m.creativeUi.inlineAi.busyEllipsis : m.creativeUi.inlineAi.noOutput))}</pre>
          {!busy && !error && range ? <p className="inline-ai-foot">{m.creativeUi.inlineAi.replaceFootnote(range.start + 1, range.end)}</p> : null}
        </div>
      ) : null}
    </div>
  );
}
