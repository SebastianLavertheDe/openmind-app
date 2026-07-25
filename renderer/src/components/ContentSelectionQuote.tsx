import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Quote } from "lucide-react";
import type { ContentRecord } from "@shared/contracts";
import { useAi } from "../ai-context";

type SelectionAction = {
  text: string;
  lineCount: number;
  left: number;
  top: number;
};

export function ContentSelectionQuote({ content, children }: { content: ContentRecord; children: ReactNode }) {
  const ai = useAi();
  const surfaceRef = useRef<HTMLDivElement>(null);
  const [action, setAction] = useState<SelectionAction | null>(null);
  const [announcement, setAnnouncement] = useState("");

  const readSelection = useCallback(() => {
    const surface = surfaceRef.current;
    const selection = window.getSelection();
    if (!surface || !selection || selection.rangeCount === 0 || selection.isCollapsed) {
      setAction(null);
      return;
    }
    if (!selection.anchorNode || !selection.focusNode
      || !surface.contains(selection.anchorNode)
      || !surface.contains(selection.focusNode)) {
      setAction(null);
      return;
    }

    const text = selection.toString().trim();
    if (!text) {
      setAction(null);
      return;
    }

    const range = selection.getRangeAt(0);
    const rect = typeof range.getBoundingClientRect === "function"
      ? range.getBoundingClientRect()
      : surface.getBoundingClientRect();
    const viewportWidth = window.visualViewport?.width || window.innerWidth || document.documentElement.clientWidth;
    const left = Math.max(72, Math.min(viewportWidth - 72, rect.left + rect.width / 2));
    const top = Math.max(44, rect.top - 8);
    setAction({ text, lineCount: countSelectedLines(text), left, top });
  }, []);

  const quoteSelection = useCallback(() => {
    if (!action) return;
    const source = selectionSourceLabel(content);
    const label = `引用 · ${source} · ${action.lineCount} 行`;
    ai.addContext({
      id: `selection:${crypto.randomUUID()}`,
      kind: "selection",
      label,
      path: content.path,
      content: action.text
    });
    ai.focusComposer();
    setAnnouncement(`已将 ${action.lineCount} 行内容引用到 AI 输入区`);
    setAction(null);
    window.getSelection()?.removeAllRanges();
  }, [action, ai, content]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && action) {
        setAction(null);
        return;
      }
      if (action && (event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLocaleLowerCase() === "a") {
        event.preventDefault();
        quoteSelection();
      }
    };
    const dismiss = () => setAction(null);
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("scroll", dismiss, true);
    window.addEventListener("resize", dismiss);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("scroll", dismiss, true);
      window.removeEventListener("resize", dismiss);
    };
  }, [action, quoteSelection]);

  return (
    <>
      <div
        ref={surfaceRef}
        className="content-selection-surface"
        onPointerUp={readSelection}
        onKeyUp={readSelection}
      >
        {children}
      </div>
      <span className="ui-visually-hidden" aria-live="polite">{announcement}</span>
      {action ? createPortal(
        <button
          type="button"
          className="content-selection-quote"
          style={{ left: action.left, top: action.top }}
          aria-label="引用到 AI"
          title="引用到 AI（Ctrl+Shift+A）"
          onPointerDown={(event) => event.preventDefault()}
          onClick={quoteSelection}
        >
          <Quote size={14} aria-hidden />
          引用到 AI
        </button>,
        document.body
      ) : null}
    </>
  );
}

export function countSelectedLines(text: string): number {
  return Math.max(1, text.split(/\r\n|\r|\n/).filter((line) => line.trim()).length);
}

export function selectionSourceLabel(content: ContentRecord): string {
  const name = content.name || content.path.split(/[\\/]/).at(-1) || "选中内容";
  const dailyBrief = name.match(/(\d{4})(\d{2})(\d{2})_daily_(?:summary|brief)\.md/i);
  if (dailyBrief) return `${dailyBrief[1]}-${dailyBrief[2]}-${dailyBrief[3]} 每日简报`;
  return name.replace(/\.[^.]+$/, "") || "选中内容";
}
