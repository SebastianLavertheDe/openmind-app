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
        <span className="assistant-artifact-kind"><FileText size={14} aria-hidden />{m.ai.message.artifactLabel}</span>
        <strong>{block.title}</strong>
        <span className="assistant-artifact-status" role="status">
          {block.status === "streaming" ? <><LoaderCircle className="spin" size={13} aria-hidden />{m.ai.message.artifactStreaming}</> : null}
          {block.status === "complete" ? <><CheckCircle2 size={13} aria-hidden />{m.ai.message.artifactComplete}</> : null}
          {block.status === "incomplete" ? <><AlertTriangle size={13} aria-hidden />{m.ai.message.artifactIncomplete}</> : null}
        </span>
      </header>
      <div className="assistant-artifact-content">{children}</div>
      {block.status === "incomplete" ? (
        <p className="assistant-artifact-warning" role="status">
          <AlertTriangle size={14} aria-hidden />
          {m.ai.message.artifactIncompleteDetail}
        </p>
      ) : null}
      <footer>
        <button type="button" className="assistant-artifact-copy" onClick={() => void copy()}>
          {copied ? <CheckCircle2 className="copy-check-pop" size={14} aria-hidden /> : <Copy size={14} aria-hidden />}
          {copied ? m.ai.message.copied : m.ai.message.copyArtifact}
        </button>
      </footer>
    </section>
  );
}
