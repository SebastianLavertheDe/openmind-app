import { isValidElement, useEffect, useMemo, useRef, useState, type AnchorHTMLAttributes, type HTMLAttributes, type ImgHTMLAttributes, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import "katex/dist/katex.min.css";
import { CheckCircle2, Copy, GitFork, Image as ImageIcon, LoaderCircle, Pencil, Quote, Redo2 } from "lucide-react";
import type { AiEvent, ContextReference } from "@shared/contracts";
import { messages as m } from "@shared/messages";
import { formatDateTime } from "../../ai-utils";
import { useAi } from "../../ai-context";
import { AnimatedDisclosure } from "../../design-system/animated-disclosure";
import { OverflowBox } from "../../design-system/OverflowBox";
import { localFileReference, useFilePreview } from "./file-preview-context";
import { DocumentReader, useDocumentCodeText, type ReaderComponents } from "../../components/document/DocumentReader";

const MARKDOWN_CACHE_LIMIT = 96;
const STREAMING_MARKDOWN_INTERVAL_MS = 96;
const STREAMING_MARKDOWN_RICH_TEXT_LIMIT = 8_192;
const markdownCache = new Map<string, { text: string; node: ReactNode }>();

export function UserMessage({ event }: { event: AiEvent }) {
  const ai = useAi();
  const text = String(event.payload.text || "");
  const contexts = Array.isArray(event.payload.contexts) ? event.payload.contexts as ContextReference[] : [];
  return (
    <article className="message user-message">
      {/* P0-AI-1: 用户头像 */}
      <div className="message-body">
        <div className="user-message-bubble">
          {text.length > STREAMING_MARKDOWN_RICH_TEXT_LIMIT ? <DocumentReader content={text} plain/> : <p>{text}</p>}
          {contexts.length ? <SentContexts contexts={contexts} /> : null}
        </div>
        {/* 操作按钮在气泡外右下角（对齐主流聊天 UI）；身份由左右布局区分，
            "你 + 时间"视觉隐藏，保留无障碍语义。 */}
        <MessageMeta label={m.ai.message.you} timestamp={event.timestamp} visuallyHidden>
          <button data-motion="icon" aria-label={m.ai.message.quoteMessage} title={m.ai.message.quote} onClick={() => ai.addContext(messageContext(event, text))}><Quote size={13} /></button>
          <button data-motion="icon" aria-label={m.ai.message.editResend} title={m.ai.message.editResend} onClick={() => ai.editRun(event.runId)}><Pencil size={13} /></button>
          <button data-motion="icon" aria-label={m.ai.message.branchFromMessage} title={m.ai.message.branchFromMessage} onClick={() => void ai.branchRun(event.runId)}><GitFork size={13} /></button>
          <button data-motion="icon" aria-label={m.ai.message.rerun} title={m.ai.message.rerun} onClick={() => void ai.rerun(event.runId)}><Redo2 size={13} /></button>
          <CopyButton text={text} />
        </MessageMeta>
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
  const classes = ["chat-markdown", className].filter(Boolean).join(" ");
  if (!streaming && text.length > STREAMING_MARKDOWN_RICH_TEXT_LIMIT) {
    return <DocumentReader content={text} math className={classes} customComponents={documentComponents}/>;
  }
  return (
    <div className={classes}>
      {streaming ? <StreamingMarkdown text={text} /> : <CachedMarkdown text={text} />}
    </div>
  );
}

const documentComponents: ReaderComponents = {
  a: ({ node: _node, ...props }) => <MarkdownLink {...props}/>,
  pre: function DocumentCode({ node, ...props }) {
    return <MarkdownPre {...props} copyText={useDocumentCodeText(node)}/>;
  },
  code: ({ node: _node, ...props }) => <MarkdownCode {...props}/>
};

function CachedMarkdown({ text }: { text: string }) {
  const cacheKey = useMemo(() => markdownCacheKey(text), [text]);
  return useMemo(() => renderCachedMarkdown(cacheKey, text), [cacheKey, text]);
}

function StreamingMarkdown({ text }: { text: string }) {
  const renderedText = useThrottledStreamingText(text);
  return useMemo(() => renderStreamingMarkdown(renderedText), [renderedText]);
}

function useThrottledStreamingText(text: string): string {
  const [renderedText, setRenderedText] = useState(text);
  const latestText = useRef(text);
  const timer = useRef<number | null>(null);
  latestText.current = text;

  useEffect(() => {
    if (text === renderedText || timer.current !== null) return;
    timer.current = window.setTimeout(() => {
      timer.current = null;
      setRenderedText(latestText.current);
    }, STREAMING_MARKDOWN_INTERVAL_MS);
  }, [renderedText, text]);

  useEffect(() => () => {
    if (timer.current !== null) window.clearTimeout(timer.current);
  }, []);

  return renderedText;
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
  // 流式期间最多每 96ms 解析一次，并跳过 rehype-highlight（代码高亮是 CPU 大头）；
  // 同时不写入 markdownCache，避免中途 key 撑爆 96 项 LRU。超长输出在落定前
  // 使用增量纯文本分块，避免整段文本参与换行；落定后后台解析完整 Markdown。
  if (text.length > STREAMING_MARKDOWN_RICH_TEXT_LIMIT) {
    return <DocumentReader content={text} plain className="streaming-markdown-plain"/>;
  }
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
        else void window.openmind.openPath(localPath);
      }}
    />
  );
}

function MarkdownCode({ children, className, ...props }: HTMLAttributes<HTMLElement>) {
  const openPreview = useFilePreview();
  const text = extractText(children).trim();
  // 含路径分隔符、无空白，或以文件扩展名结尾（如 `Agentic Design Patterns.pdf`）
  // 都视为可能的文件引用；纯 `hello world` 这类无扩展名文本不会误判。
  const looksLikeInlinePath = /[\\/]/.test(text)
    || !/\s/.test(text)
    || /\.[a-z0-9][a-z0-9._-]{0,9}$/i.test(text);
  const localPath = !className && looksLikeInlinePath ? localFileReference(text) : null;
  if (!localPath) return <code {...props} className={className}>{children}</code>;
  return (
    <button
      data-motion="icon"
      type="button"
      className="local-file-code"
      title={m.ai.message.previewFile(localPath)}
      onClick={() => {
        if (openPreview) openPreview(localPath);
        else void window.openmind.openPath(localPath);
      }}
    >
      <code {...props}>{children}</code>
    </button>
  );
}

export function SafeMarkdownImage({ src, alt }: ImgHTMLAttributes<HTMLImageElement>) {
  return <a className="safe-image-link" href={src} target="_blank" rel="noreferrer">{m.ai.message.viewImage(String(alt || ""), String(src || ""))}</a>;
}

function MarkdownPre({ children, copyText, ...props }: HTMLAttributes<HTMLPreElement> & { copyText?: string }) {
  const text = copyText ?? extractText(children);
  return (
    <div className="markdown-code-block">
      <CopyButton text={text} />
      <pre {...props}>{children}</pre>
    </div>
  );
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
