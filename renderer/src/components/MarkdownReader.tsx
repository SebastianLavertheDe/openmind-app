import { DocumentReader } from "./document/DocumentReader";
export { addCjkLatinSpacing, normalizeMarkdownTables, remarkCjkSpacing } from "./markdown-normalize";

export type MarkdownReaderLayout = "article" | "file";

export function MarkdownReader({ content, className = "", layout = "article" }: {
  content: string; className?: string; layout?: MarkdownReaderLayout;
}) {
  return <DocumentReader content={content} className={[
    "reader-markdown", "reader-body", layout === "file" ? "file-reader" : "", className
  ].filter(Boolean).join(" ")}/>;
}
