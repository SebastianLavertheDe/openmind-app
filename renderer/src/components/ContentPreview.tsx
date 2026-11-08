import { useLocale } from "../i18n";
import type { ContentRecord } from "@shared/contracts";
import { messages as m } from "@shared/messages";
import { MarkdownReader, type MarkdownReaderLayout } from "./MarkdownReader";
import { ContentSelectionQuote } from "./ContentSelectionQuote";
import { DocumentReader, type ReaderComponents } from "./document/DocumentReader";
import { useMemo } from "react";
import { useFilePreview } from "../features/ai-console/file-preview-context";
import { documentFileReference, resolveDocumentFileLink } from "./document/document-file-links";

export function ContentPreview({ content, layout = "article" }: { content: ContentRecord; layout?: MarkdownReaderLayout }) {
  useLocale();
  const openFile = useFilePreview();
  const customComponents = useMemo<ReaderComponents | undefined>(() => openFile ? {
    a: ({ node, href, ...props }) => {
      const reference = String(node?.properties.dataDocumentFileReference || href || "");
      const path = resolveDocumentFileLink(reference, content.path);
      const projectName = content.path.replaceAll("\\", "/").match(/^openmind\/projects\/([^/]+)\//)?.[1];
      if (documentFileReference(reference) && (!path || projectName && !path.startsWith(`openmind/projects/${projectName}/`))) return <a {...props} />;
      return path ? <a {...props} href="#" onClick={event => {
        event.preventDefault();
        event.stopPropagation();
        openFile(path, projectName ? { projectName } : undefined);
      }} /> : <a {...props} href={href} target="_blank" rel="noreferrer" />;
    }
  } : undefined, [openFile, content.path]);
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
      : <MarkdownReader content={raw} layout={layout} customComponents={customComponents} />;

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
