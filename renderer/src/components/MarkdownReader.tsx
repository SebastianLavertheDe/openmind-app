import { DocumentReader, type ReaderComponents } from "./document/DocumentReader";
export { addCjkLatinSpacing, normalizeMarkdownTables, remarkCjkSpacing } from "./markdown-normalize";

export type MarkdownReaderLayout = "article" | "file";

export function MarkdownReader({ content, className = "", layout = "article", customComponents }: {
  content: string; className?: string; layout?: MarkdownReaderLayout; customComponents?: ReaderComponents;
}) {
  return <DocumentReader content={content} className={[
    "reader-markdown", "reader-body", layout === "file" ? "file-reader" : "", className
  ].filter(Boolean).join(" ")} customComponents={customComponents}/>;
}
