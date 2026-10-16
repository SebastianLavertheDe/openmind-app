import { useLocale } from "../../i18n";
import { messages } from "@shared/messages";
import { Textarea } from "../../design-system/components";
import { useRef, useState } from "react";
import { MarkdownEditor, type EditorSelectionSnapshot, type MarkdownEditorHandle } from "../creative/MarkdownEditor";
import { InlineAiBar } from "../creative/InlineAiBar";

/** The document instance lives across edit/read transitions; changing files remounts it. */
export function ProjectOutputEditor({ content, title, readOnly, autoFocus, onContent, onTitle }: {
  content: string; title: string; readOnly: boolean; autoFocus: boolean;
  onContent(value: string): void; onTitle(value: string): void;
}) {
  useLocale();
  const editor = useRef<MarkdownEditorHandle>(null);
  const [selection, setSelection] = useState<EditorSelectionSnapshot>({ start: 0, end: 0, text: "" });
  return <MarkdownEditor ref={editor} autoFocus={autoFocus} value={content} readOnly={readOnly}
    ariaLabel={messages.projectUi.markdownContent} onChange={onContent} onSelectionChange={setSelection}
    documentHeader={<Textarea variant="inline" rows={1} maxLength={255} className="project-output-title" value={title} readOnly={readOnly} aria-label={messages.projectUi.documentTitle} placeholder={messages.projectUi.untitledDocument} onChange={event => onTitle(event.target.value.replace(/[\r\n]+/g, " "))} onKeyDown={event => {
      if (event.key === "Enter" && !event.nativeEvent.isComposing) { event.preventDefault(); editor.current?.focus(); }
    }} />}
    accessory={<InlineAiBar selection={selection} disabled={readOnly}
      onReplace={(start, end, replacement, bookmark) => editor.current?.replaceRange(start, end, replacement, bookmark) ?? false} />} />;
}
