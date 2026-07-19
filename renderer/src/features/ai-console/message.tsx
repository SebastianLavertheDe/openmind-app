import { isValidElement, memo, useMemo, useState, type AnchorHTMLAttributes, type HTMLAttributes, type ImgHTMLAttributes, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import "katex/dist/katex.min.css";
import { CheckCircle2, ChevronDown, Copy, GitFork, Image as ImageIcon, LoaderCircle, Pencil, Quote, Redo2 } from "lucide-react";
import type { AiEvent, ContextReference } from "@shared/contracts";
import { messages as m } from "@shared/messages";
import { formatDateTime } from "../../ai-utils";
import { useAi } from "../../ai-context";
import { AnimatedDisclosure } from "../../design-system/animated-disclosure";
import { OverflowBox } from "../../design-system/OverflowBox";
import { localFileReference, useFilePreview } from "./file-preview-context";

const MARKDOWN_CACHE_LIMIT = 96;
const markdownCache = new Map<string, { text: string; node: ReactNode }>();

export function UserMessage({ event }: { event: AiEvent }) {
  const ai = useAi();
  const text = String(event.payload.text || "");
  const contexts = Array.isArray(event.payload.contexts) ? event.payload.contexts as ContextReference[] : [];
  return (
    <article className="message user-message">
      {/* P0-AI-1: 用户头像 */}
      <div className="message-body">
        <MessageMeta label={m.ai.message.you} timestamp={event.timestamp}>
          <button data-motion="icon" aria-label={m.ai.message.quoteMessage} title={m.ai.message.quote} onClick={() => ai.addContext(messageContext(event, text))}><Quote size={13} /></button>
          <button data-motion="icon" aria-label={m.ai.message.editResend} title={m.ai.message.editResend} onClick={() => ai.editRun(event.runId)}><Pencil size={13} /></button>
          <button data-motion="icon" aria-label={m.ai.message.branchFromMessage} title={m.ai.message.branchFromMessage} onClick={() => void ai.branchRun(event.runId)}><GitFork size={13} /></button>
          <button data-motion="icon" aria-label={m.ai.message.rerun} title={m.ai.message.rerun} onClick={() => void ai.rerun(event.runId)}><Redo2 size={13} /></button>
          <CopyButton text={text} />
        </MessageMeta>
        <p>{text}</p>
        {contexts.length ? <SentContexts contexts={contexts} /> : null}
      </div>
    </article>
  );
}

export function AssistantMessage({ text, streaming = false, event }: { text: string; streaming?: boolean; event?: AiEvent }) {
  const ai = useAi();
  return (
    <article className={`message assistant-message${streaming ? " streaming" : ""}`}>
      <div className="message-body">
        <MessageMeta label="AI" timestamp={event?.timestamp} visuallyHidden>
          {streaming ? <LoaderCircle className="spin" size={13} /> : (
            <>
              {event ? <button data-motion="icon" aria-label={m.ai.message.quoteReply} title={m.ai.message.quote} onClick={() => ai.addContext(messageContext(event, text))}><Quote size={13} /></button> : null}
              {event ? <button data-motion="icon" aria-label={m.ai.message.branchFromReply} title={m.ai.message.branchFromReply} onClick={() => void ai.branchRun(event.runId)}><GitFork size={13} /></button> : null}
              {event ? <button data-motion="icon" aria-label={m.ai.message.rerun} title={m.ai.message.rerun} onClick={() => void ai.rerun(event.runId)}><Redo2 size={13} /></button> : null}
              <CopyButton text={text} />
            </>
          )}
        </MessageMeta>
        <ChatMarkdown text={text} streaming={streaming} />
      </div>
    </article>
  );
}

export function ChatMarkdown({
  text,
  streaming = false,
  className = ""
}: {
  text: string;
  streaming?: boolean;
  className?: string;
}) {
  const cacheKey = useMemo(() => markdownCacheKey(text), [text]);
  const markdown = useMemo(
    () => (streaming ? renderStreamingMarkdown(text) : renderCachedMarkdown(cacheKey, text)),
    [streaming, cacheKey, text]
  );
  const classes = ["chat-markdown", className].filter(Boolean).join(" ");
  return <div className={classes}>{markdown}</div>;
}

export function markdownCacheKey(text: string): string {
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `${text.length}:${(hash >>> 0).toString(36)}`;
}

function renderCachedMarkdown(cacheKey: string, text: string): ReactNode {
  const cached = markdownCache.get(cacheKey);
  if (cached?.text === text) {
    markdownCache.delete(cacheKey);
    markdownCache.set(cacheKey, cached);
    return cached.node;
  }
  const node = <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeHighlight, rehypeKatex]} components={{ a: MarkdownLink, code: MarkdownCode, img: SafeMarkdownImage, pre: MarkdownPre }}>{text}</ReactMarkdown>;
  markdownCache.set(cacheKey, { text, node });
  while (markdownCache.size > MARKDOWN_CACHE_LIMIT) {
    const oldest = markdownCache.keys().next().value;
    if (!oldest) break;
    markdownCache.delete(oldest);
  }
  return node;
}

function renderStreamingMarkdown(text: string): ReactNode {
  // 流式期间跳过 rehype-highlight（代码高亮是 CPU 大头）且不写入 markdownCache，
  // 避免长回复每 24ms 全量 highlight 解析 + 中途 key 撑爆 96 项 LRU。
  // 数学公式（remark-math + rehype-katex）开销可控，流式期间保留实时渲染，
  // 避免 $$...$$ 在生成过程中以裸文本闪烁。落定（streaming=false）后由
  // renderCachedMarkdown 完整渲染（含高亮）并进 LRU。
  return (
    <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex]} components={{ a: MarkdownLink, code: MarkdownCode, img: SafeMarkdownImage, pre: MarkdownPre }}>
      {text}
    </ReactMarkdown>
  );
}

export function MessageMeta({
  label,
  timestamp,
  children,
  visuallyHidden = false
}: {
  label: string;
  timestamp?: string;
  children: ReactNode;
  visuallyHidden?: boolean;
}) {
  const metadataClass = visuallyHidden ? "ui-visually-hidden" : undefined;
  return (
    <div className="message-meta">
      <span className={metadataClass}>{label}</span>
      {timestamp ? <time className={metadataClass}>{formatDateTime(timestamp)}</time> : null}
      <div className="message-actions">{children}</div>
    </div>
  );
}

export function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1_500);
    } catch {
      setCopied(false);
    }
  };
  return <button data-motion="icon" aria-label={copied ? m.ai.message.copied : m.ai.message.copy} title={copied ? m.ai.message.copied : m.ai.message.copy} onClick={() => void copy()}>{copied ? <CheckCircle2 className="copy-check-pop" size={13} /> : <Copy size={13} />}</button>;
}

function SentContexts({ contexts }: { contexts: ContextReference[] }) {
  const [open, setOpen] = useState(false);
  return (
    <AnimatedDisclosure
      className="sent-contexts"
      open={open}
      onOpenChange={setOpen}
      summary={m.ai.message.contextsUsed(contexts.length)}
    >
      {/* P0-OFL-5: sent-contexts 限高 240px + 滚动,防止一次拖入 20 个文件撑爆消息 */}
      <OverflowBox className="sent-contexts-overflow" maxHeight={240}>
        {contexts.map((context) => <div key={context.id}><strong>{context.label}</strong><span>{context.kind === "image" ? <><ImageIcon size={12} aria-hidden /> {m.ai.message.imageAttachment}</> : context.path || context.kind}</span></div>)}
      </OverflowBox>
    </AnimatedDisclosure>
  );
}

export function MarkdownLink({ href, onClick, ...props }: AnchorHTMLAttributes<HTMLAnchorElement>) {
  const openPreview = useFilePreview();
  const localPath = localFileReference(href);
  if (!localPath) return <a {...props} href={href} onClick={onClick} target="_blank" rel="noreferrer" />;
  return (
    <a
      {...props}
      href={href}
      className="local-file-link"
      onClick={(event) => {
        event.preventDefault();
        onClick?.(event);
        if (openPreview) openPreview(localPath);
        else void window.cctools.openPath(localPath);
      }}
    />
  );
}

function MarkdownCode({ children, className, ...props }: HTMLAttributes<HTMLElement>) {
  const openPreview = useFilePreview();
  const text = extractText(children).trim();
  const localPath = !className ? localFileReference(text) : null;
  if (!localPath) return <code {...props} className={className}>{children}</code>;
  return (
    <button
      data-motion="icon"
      type="button"
      className="local-file-code"
      title={m.ai.message.previewFile(localPath)}
      onClick={() => {
        if (openPreview) openPreview(localPath);
        else void window.cctools.openPath(localPath);
      }}
    >
      <code {...props}>{children}</code>
    </button>
  );
}

export function SafeMarkdownImage({ src, alt }: ImgHTMLAttributes<HTMLImageElement>) {
  return <a className="safe-image-link" href={src} target="_blank" rel="noreferrer">{m.ai.message.viewImage(String(alt || ""), String(src || ""))}</a>;
}

function MarkdownPre({ children, ...props }: HTMLAttributes<HTMLPreElement>) {
  const text = extractText(children);
  const lineCount = text ? text.split(/\r?\n/).length : 0;
  const language = detectLanguage(children);
  // P0-OFL-4: 代码块限高 480px（约 30 行）+ macOS titlebar + 渐变遮罩 + 展开全部
  return (
    <div className="markdown-code-block" data-language={language || undefined}>
      <header className="markdown-code-titlebar">
        <span className="terminal-lights" aria-hidden="true"><i /><i /><i /></span>
        <span className="markdown-code-lang">{language || "text"}</span>
        {lineCount > 1 ? <small className="markdown-code-lines">{m.ai.common.chars(text.length)}</small> : null}
        <CopyButton text={text} />
      </header>
      <OverflowBox className="markdown-code-overflow" maxHeight={480} expandable expandLabel={m.ai.overflow.expandLines(lineCount)}>
        <pre {...props}>{children}</pre>
      </OverflowBox>
    </div>
  );
}

/** 从 rehype-highlight 的 className (language-xxx) 推断语言标签。 */
function detectLanguage(node: ReactNode): string {
  if (!isValidElement<{ className?: string }>(node)) return "";
  const className = node.props?.className || "";
  const match = /language-([\w-]+)/.exec(className);
  return match ? match[1] : "";
}

function messageContext(event: AiEvent, text: string): ContextReference {
  return {
    id: `message:${event.id}`,
    kind: "selection",
    label: `${event.kind === "user-message" ? m.ai.message.userLabel : m.ai.message.assistantLabel} · ${formatDateTime(event.timestamp)}`,
    content: text
  };
}

function extractText(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(extractText).join("");
  if (isValidElement<{ children?: ReactNode }>(node)) return extractText(node.props.children);
  return "";
}
