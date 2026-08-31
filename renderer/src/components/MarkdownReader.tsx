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

const VALID_TABLE_DELIMITER = /^:?-{3,}:?$/;

/**
 * AI-generated Markdown occasionally concatenates two alignment markers, for
 * example `---:---:`. GFM correctly rejects that row, but the surrounding
 * header and data rows still make the intended table unambiguous. Repair only
 * delimiter rows outside fenced code blocks; the editor value itself remains
 * untouched.
 */
export function normalizeMarkdownTables(content: string): string {
  const lines = content.split(/\r?\n/);
  let fenceMarker: "`" | "~" | null = null;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const trimmed = line.trim();
    const fence = trimmed.match(/^(`{3,}|~{3,})/);
    if (fence) {
      const marker = fence[1][0] as "`" | "~";
      fenceMarker = fenceMarker === marker ? null : fenceMarker || marker;
      continue;
    }
    if (fenceMarker || index === 0) continue;

    const headerCells = splitTableRow(lines[index - 1]);
    const delimiterCells = splitTableRow(line);
    if (!headerCells || !delimiterCells || headerCells.length !== delimiterCells.length || headerCells.length < 2) continue;

    const compactCells = delimiterCells.map((cell) => cell.replace(/\s/g, ""));
    const isDelimiterCandidate = compactCells.every((cell) => /^[-:]+$/.test(cell) && cell.replace(/:/g, "").length >= 3);
    if (!isDelimiterCandidate || compactCells.every((cell) => VALID_TABLE_DELIMITER.test(cell))) continue;

    const indent = line.match(/^\s*/)?.[0] || "";
    const normalizedCells = compactCells.map((cell) => {
      const leftAligned = cell.startsWith(":");
      const rightAligned = cell.endsWith(":");
      return `${leftAligned ? ":" : ""}---${rightAligned ? ":" : ""}`;
    });
    lines[index] = `${indent}| ${normalizedCells.join(" | ")} |`;
  }

  return lines.join("\n");
}

function splitTableRow(line: string): string[] | null {
  const trimmed = line.trim();
  if (!trimmed.includes("|")) return null;
  const body = trimmed.replace(/^\|/, "").replace(/\|$/, "");
  const cells = body.split("|").map((cell) => cell.trim());
  return cells.length >= 2 ? cells : null;
}

export type MarkdownReaderLayout = "article" | "file";

function SafeReaderImage({ src, alt }: { src?: string; alt?: string }) {
  const value = typeof src === "string" ? src.trim() : "";
  if (/^data:image\/(?:png|gif|jpe?g|webp|avif);base64,/i.test(value)) {
    return <img src={value} alt={alt || ""} />;
  }
  if (!value) return <span>{alt || "图片"}</span>;
  // User/imported Markdown is untrusted. Automatically resolving remote image
  // URLs would let a document make the Electron renderer issue requests to
  // local/private hosts. Keep the URL user-visible and require an explicit
  // external navigation instead.
  return <a href={value} target="_blank" rel="noreferrer">{alt || "远程图片（未自动加载）"}</a>;
}

export function MarkdownReader({ content, className = "", layout = "article" }: { content: string; className?: string; layout?: MarkdownReaderLayout }) {
  const normalizedContent = normalizeMarkdownTables(content);
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
        components={{
          a: ({ node: _node, ...props }) => <a {...props} target="_blank" rel="noreferrer" />,
          img: ({ node: _node, src, alt }) => <SafeReaderImage src={src} alt={alt} />,
          table: ({ node: _node, ...props }) => <div className="markdown-table-scroll"><table {...props} /></div>
        }}
      >{normalizedContent}</ReactMarkdown>
    </article>
  );
}
