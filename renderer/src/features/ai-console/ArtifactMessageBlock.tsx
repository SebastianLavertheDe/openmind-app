import { AlertTriangle, Check, Copy, FileText, LoaderCircle } from "lucide-react";
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
          <span className="assistant-artifact-icon" aria-hidden><FileText size={16} strokeWidth={1.5} /></span>
          <div className="assistant-artifact-details">
            <span className="assistant-artifact-kind">{m.ai.message.artifactDocument}</span>
            <span className="assistant-artifact-format">Markdown</span>
            <span className={`assistant-artifact-status${block.status === "complete" ? " ui-visually-hidden" : ""}`} role="status">
              {block.status === "streaming" ? <><LoaderCircle className="spin" size={12} strokeWidth={1.5} aria-hidden />{m.ai.message.artifactStreaming}</> : null}
              {block.status === "complete" ? m.ai.message.artifactComplete : null}
              {block.status === "incomplete" ? <><AlertTriangle size={12} strokeWidth={1.5} aria-hidden />{m.ai.message.artifactIncomplete}</> : null}
            </span>
          </div>
        </div>
        <button type="button" className="assistant-artifact-copy" data-motion="action" aria-label={copied ? m.ai.message.copied : m.ai.message.copyArtifact} title={m.ai.message.copyArtifact} onClick={() => void copy()}>
          {copied ? <Check size={14} strokeWidth={1.5} aria-hidden /> : <Copy size={14} strokeWidth={1.5} aria-hidden />}
          <span aria-live="polite">{copied ? m.ai.message.copied : m.ai.message.copy}</span>
        </button>
      </header>
      <div className="assistant-artifact-content">{children}</div>
      {block.status === "incomplete" ? (
        <p className="assistant-artifact-warning" role="status">
          <AlertTriangle size={14} strokeWidth={1.5} aria-hidden />
          {m.ai.message.artifactIncompleteDetail}
        </p>
      ) : null}
    </section>
  );
}
