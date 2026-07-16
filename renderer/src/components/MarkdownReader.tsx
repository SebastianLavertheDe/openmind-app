import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

type MarkdownNode = {
  type?: string;
  value?: string;
  children?: MarkdownNode[];
};

const SPACING_EXCLUDED_NODES = new Set([
  "code",
  "inlineCode",
  "link",
  "linkReference",
  "definition",
  "image",
  "imageReference",
  "html"
]);

/** Add readable CJK/Latin spacing without touching code, links, URLs, or file targets. */
export function remarkCjkSpacing() {
  return (tree: MarkdownNode) => visitText(tree, false);
}

function visitText(node: MarkdownNode, excluded: boolean): void {
  const nextExcluded = excluded || SPACING_EXCLUDED_NODES.has(node.type || "");
  if (!nextExcluded && node.type === "text" && typeof node.value === "string") {
    node.value = addCjkLatinSpacing(node.value);
  }
  node.children?.forEach((child) => visitText(child, nextExcluded));
}

export function addCjkLatinSpacing(value: string): string {
  return value
    .replace(/([\p{Script=Han}])([A-Za-z0-9@#])/gu, "$1 $2")
    .replace(/([A-Za-z0-9%])([\p{Script=Han}])/gu, "$1 $2");
}

export type MarkdownReaderLayout = "article" | "file";

export function MarkdownReader({ content, className = "", layout = "article" }: { content: string; className?: string; layout?: MarkdownReaderLayout }) {
  const classes = [
    "reader-markdown",
    "reader-body",
    layout === "file" ? "file-reader" : "",
    className
  ].filter(Boolean).join(" ");
  return (
    <article className={classes}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkCjkSpacing]}
        components={{ a: ({ node: _node, ...props }) => <a {...props} target="_blank" rel="noreferrer" /> }}
      >{content}</ReactMarkdown>
    </article>
  );
}
