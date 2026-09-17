import { AlertTriangle, CheckCircle2, Copy, FileText, LoaderCircle } from "lucide-react";
import { useState, type ReactNode } from "react";
import { messages as m } from "@shared/messages";
import type { AssistantArtifactBlock } from "./artifact-fence";

export function ArtifactMessageBlock({
  block,
  children
}: {
  block: AssistantArtifactBlock;
  children: ReactNode;
}) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(block.content);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1_500);
    } catch {
      setCopied(false);
    }
  };

  return (
    <section
      className={`assistant-artifact ${block.status}`}
      aria-label={`${m.ai.message.artifactLabel}：${block.title}`}
      aria-busy={block.status === "streaming" || undefined}
    >
      <header className="assistant-artifact-header">
        <div className="assistant-artifact-heading">
          <span className="assistant-artifact-icon" aria-hidden><FileText size={18} /></span>
          <div className="assistant-artifact-details">
            <span className="assistant-artifact-kind">{m.ai.message.artifactLabel}</span>
            <span className="assistant-artifact-status" role="status">
              {block.status === "streaming" ? <><LoaderCircle className="spin" size={12} aria-hidden />{m.ai.message.artifactStreaming}</> : null}
              {block.status === "complete" ? <><CheckCircle2 size={12} aria-hidden />{m.ai.message.artifactComplete}</> : null}
              {block.status === "incomplete" ? <><AlertTriangle size={12} aria-hidden />{m.ai.message.artifactIncomplete}</> : null}
            </span>
          </div>
        </div>
        <button type="button" className="assistant-artifact-copy" data-motion="action" onClick={() => void copy()}>
          {copied ? <CheckCircle2 className="copy-check-pop" size={14} aria-hidden /> : <Copy size={14} aria-hidden />}
          <span aria-live="polite">{copied ? m.ai.message.copied : m.ai.message.copyArtifact}</span>
        </button>
      </header>
      <div className="assistant-artifact-content">{children}</div>
      {block.status === "incomplete" ? (
        <p className="assistant-artifact-warning" role="status">
          <AlertTriangle size={14} aria-hidden />
          {m.ai.message.artifactIncompleteDetail}
        </p>
      ) : null}
    </section>
  );
}
