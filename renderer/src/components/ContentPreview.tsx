import type { ContentRecord } from "@shared/contracts";
import { messages as m } from "@shared/messages";
import { MarkdownReader, type MarkdownReaderLayout } from "./MarkdownReader";
import { ContentSelectionQuote } from "./ContentSelectionQuote";
import { DocumentReader } from "./document/DocumentReader";

export function ContentPreview({ content, layout = "article" }: { content: ContentRecord; layout?: MarkdownReaderLayout }) {
  const raw = content.content || "";
  const extension = (content.ext || content.extension || content.path || "").toLocaleLowerCase();
  const isHtml = extension.endsWith(".html") || /<html|<!doctype/i.test(raw.slice(0, 500));
  const layoutClassName = layout === "file" ? " file-reader" : "";

  const preview = isHtml
    ? <iframe title={m.designSystem.htmlPreview} className={`html-preview${layoutClassName}`} sandbox="" srcDoc={raw} />
    : isPlainText(extension)
      ? <DocumentReader content={raw} plain className={`reader-markdown reader-body plain-text-reader${layoutClassName}`}/>
      : <MarkdownReader content={raw} layout={layout} />;

  return <ContentSelectionQuote content={content}>{preview}</ContentSelectionQuote>;
}

const PLAIN_TEXT_EXTENSIONS = [
  ".txt", ".text", ".log", ".json", ".csv", ".tsv", ".yaml", ".yml", ".ini", ".conf",
  ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".css", ".scss", ".html", ".py", ".go",
  ".rs", ".java", ".kt", ".swift", ".sh", ".ps1", ".sql", ".toml", ".xml", ".vue", ".svelte"
];

function isPlainText(extension: string): boolean {
  return PLAIN_TEXT_EXTENSIONS.some((suffix) => extension.endsWith(suffix));
}
