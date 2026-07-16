import type { ContentRecord } from "@shared/contracts";
import { MarkdownReader, type MarkdownReaderLayout } from "./MarkdownReader";

export function ContentPreview({ content, layout = "article" }: { content: ContentRecord; layout?: MarkdownReaderLayout }) {
  const raw = content.content || "";
  const extension = (content.ext || content.extension || content.path || "").toLocaleLowerCase();
  const isHtml = extension.endsWith(".html") || /<html|<!doctype/i.test(raw.slice(0, 500));
  const layoutClassName = layout === "file" ? " file-reader" : "";

  if (isHtml) {
    return <iframe title="HTML 内容预览" className={`html-preview${layoutClassName}`} sandbox="" srcDoc={raw} />;
  }
  if (isPlainText(extension)) {
    return <article className={`reader-markdown reader-body${layoutClassName}`}><pre className="plain-text-fallback">{raw}</pre></article>;
  }
  return <MarkdownReader content={raw} layout={layout} />;
}

const PLAIN_TEXT_EXTENSIONS = [
  ".txt", ".text", ".log", ".json", ".csv", ".tsv", ".yaml", ".yml", ".ini", ".conf",
  ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".css", ".scss", ".html", ".py", ".go",
  ".rs", ".java", ".kt", ".swift", ".sh", ".ps1", ".sql", ".toml", ".xml", ".vue", ".svelte"
];

function isPlainText(extension: string): boolean {
  return PLAIN_TEXT_EXTENSIONS.some((suffix) => extension.endsWith(suffix));
}
