import { useLocale } from "../i18n";
import type { ContentRecord } from "@shared/contracts";
import { messages as m } from "@shared/messages";
import { MarkdownReader, type MarkdownReaderLayout } from "./MarkdownReader";
import { ContentSelectionQuote } from "./ContentSelectionQuote";
import { DocumentReader } from "./document/DocumentReader";

export function ContentPreview({ content, layout = "article" }: { content: ContentRecord; layout?: MarkdownReaderLayout }) {
  useLocale();
  const raw = content.content || "";
  const extension = (content.ext || content.extension || content.path || "").toLocaleLowerCase();
  const plain = isPlainText(extension);
  // Known source formats can contain HTML snippets or an XML DOCTYPE.
  // Preserve their bytes instead of treating those strings as an HTML page.
  const isHtml = extension.endsWith(".html") || (!plain && /<html|<!doctype/i.test(raw.slice(0, 500)));
  const layoutClassName = layout === "file" ? " file-reader" : "";

  const preview = isHtml
    ? <iframe title={m.designSystem.htmlPreview} className={`html-preview${layoutClassName}`} sandbox="" srcDoc={raw} />
    : plain
      ? <DocumentReader content={raw} plain className={`reader-markdown reader-body plain-text-reader${layoutClassName}`}/>
      : <MarkdownReader content={raw} layout={layout} />;

  return <ContentSelectionQuote content={content}>{preview}</ContentSelectionQuote>;
}

const PLAIN_TEXT_EXTENSIONS = [
  ".txt", ".text", ".log", ".json", ".csv", ".tsv", ".yaml", ".yml", ".ini", ".conf",
  ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".css", ".scss", ".html", ".py", ".go",
  ".rs", ".java", ".kt", ".swift", ".sh", ".ps1", ".sql", ".toml", ".xml", ".opml", ".vue", ".svelte"
];

function isPlainText(extension: string): boolean {
  return PLAIN_TEXT_EXTENSIONS.some((suffix) => extension.endsWith(suffix));
}
