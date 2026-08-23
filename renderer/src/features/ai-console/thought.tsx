import { useEffect, useRef, useState } from "react";
import { BrainCircuit, LoaderCircle } from "lucide-react";
import type { AiEvent } from "@shared/contracts";
import { messages as m } from "@shared/messages";
import { AnimatedDisclosure } from "../../design-system/animated-disclosure";
import { OverflowBox } from "../../design-system/OverflowBox";
import { firstLine } from "./timeline";
import { PlanCard } from "./plan";
import { formatDuration } from "../../ai-utils";

/**
 * 推理过程默认留在消息流里，点击后内联展开并在固定高度内滚动。
 */
export function ReasoningCard({
  events = [],
  text = "",
  streaming = false,
  defaultOpen = false,
  pending = false
}: {
  events?: AiEvent[];
  text?: string;
  streaming?: boolean;
  defaultOpen?: boolean;
  pending?: boolean;
}) {
  const content = text || events.map((event) => String(event.payload.text || "")).join("");
  const hasContent = Boolean(content.trim());
  const [open, setOpen] = useState(hasContent && (streaming || defaultOpen));
  const startTime = useRef(events[0]?.timestamp || new Date().toISOString());
  const [liveNow, setLiveNow] = useState(Date.now());

  // P2-THT-2: pending / streaming elapsed timer
  useEffect(() => {
    if (!streaming && !pending) return;
    const id = window.setInterval(() => setLiveNow(Date.now()), 1_000);
    return () => window.clearInterval(id);
  }, [streaming, pending]);

  // P2-THT-4: streaming 结束自动收起
  useEffect(() => {
    if (!streaming && !defaultOpen) setOpen(false);
  }, [streaming, defaultOpen]);

  useEffect(() => {
    if (hasContent && (streaming || defaultOpen)) setOpen(true);
  }, [defaultOpen, hasContent, streaming]);

  if (!hasContent && !pending) return null;

  const provider = events[0]?.provider;
  const label = streaming || pending ? m.ai.thought.thinking : provider === "codex" ? m.ai.thought.codexSummary : m.ai.thought.process;
  const elapsed = formatDuration(startTime.current, new Date(liveNow).toISOString());
  const chars = content.length;
  const preview = hasContent && !open ? firstLine(content) : "";

  // pending 态：思考中但还没内容
  if (!hasContent && pending) {
    return (
      <section className="reasoning-event streaming pending" role="status" aria-live="polite" aria-label={label}>
        <div className="reasoning-summary-row pending-thinking">
          <LoaderCircle className="spin" size={14} />
          <strong>{m.ai.thought.thinkingFor(elapsed)}</strong>
          <ShimmerText />
        </div>
      </section>
    );
  }

  const meta = streaming ? null : m.ai.common.chars(chars);
  const title = streaming ? <strong>{m.ai.thought.streaming}</strong> : preview ? <small>{preview}</small> : null;
  return (
    <AnimatedDisclosure
      className={`reasoning-event${streaming ? " streaming" : ""}`}
      open={open}
      onOpenChange={setOpen}
      triggerAriaLabel={label}
      summary={
        <>
          {streaming ? <LoaderCircle className="spin" size={14} /> : <BrainCircuit size={14} />}
          <span className="reasoning-title">{title}</span>
          {meta ? <span className="reasoning-meta">{meta}</span> : null}
        </>
      }
    >
      <OverflowBox className="reasoning-inline-overflow" maxHeight={300}>
        <pre className="reasoning-content">{content}</pre>
      </OverflowBox>
      <PlanCard events={events} />
    </AnimatedDisclosure>
  );
}

/**
 * P2-THT-3: 替换三点为 shimmer 文本流 —— fade-in bottom 边缘的 shimmer。
 */
function ShimmerText() {
  return <span className="reasoning-shimmer" aria-hidden="true"><i /><i /><i /></span>;
}
