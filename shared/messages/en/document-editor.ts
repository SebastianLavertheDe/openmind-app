import type { TranslationOf } from "../types";
import type { documentEditorMessages as zhCN } from "../zh-CN/document-editor";

const count = (n: number, noun: string) => `${n} ${noun}${n === 1 ? "" : "s"}`;

export const documentEditorMessages = { inlineAi: {
    rewrite: "Rewrite", extend: "Continue", shorten: "Shorten", tone: "Change tone", translate: "Translate",
    rewriteInstruction: "Rewrite the following passage in a different way, preserving its meaning and Markdown structure",
    extendInstruction: "Continue the following passage, preserving its tone and Markdown structure",
    shortenInstruction: "Condense the following passage into key points, preserving essential information and Markdown structure",
    toneInstruction: "Make the following passage more conversational, as if explaining it to a friend, following Kill the AI Tone",
    translateInstruction: "Translate the following passage into English (or into Chinese if it is already in English), preserving its Markdown structure",
    generateFailed: "Generation failed", promptSuffix: ". Return only the resulting text, with no explanation or enclosing code fence. Follow Kill the AI Tone: state ideas directly, use concrete situations and examples, and avoid “not X, but Y” framing.", originalPrefix: "Original:\n\n",
    toolbar: "AI actions for selected text", selectedChars: (n: number) => `${count(n, "character")} selected`, generating: "Generating", result: "AI result", cancel: "Cancel", retry: "Retry", close: "Close", busyEllipsis: "…", replaceSelection: "Replace selection", replaceSelectionTitle: "Replace selected text", discard: "Discard", replaceFootnote: (start: number, end: number) => `Replaces the selected characters ${start}–${end}. The draft is saved automatically.`, noOutput: "(No output)"
  } } satisfies TranslationOf<typeof zhCN>;
