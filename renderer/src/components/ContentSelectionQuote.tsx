import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Quote } from "lucide-react";
import type { ContentRecord } from "@shared/contracts";
import { messages as m } from "@shared/messages";
import { useAiActions, useAiUi } from "../ai-context";
import { useAnchoredPopover } from "../design-system/use-anchored-popover";
import { readingSelectionText } from "./document/document-selection";

type SelectionAction = {
  text: string;
  lineCount: number;
  range: Range;
  anchor: { left: number; top: number; width: number; height: number };
};

export function ContentSelectionQuote({ content, children }: { content: ContentRecord; children: ReactNode }) {
  const actions = useAiActions();
  const ui = useAiUi();
  const surfaceRef = useRef<HTMLDivElement>(null);
  const anchorRef = useRef<HTMLSpanElement>(null);
  const actionRef = useRef<HTMLButtonElement>(null);
  const [action, setAction] = useState<SelectionAction | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const popover = useAnchoredPopover({
    open: Boolean(action),
    anchorRef,
    floatingRef: actionRef,
    preferredSide: "top",
    align: "center",
    gap: 8
  });

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

    const text = (readingSelectionText(selection, surface) ?? selection.toString()).trim();
    if (!text) {
      setAction(null);
      return;
    }

    const range = selection.getRangeAt(0);
    const rect = typeof range.getBoundingClientRect === "function"
      ? range.getBoundingClientRect()
      : surface.getBoundingClientRect();
    setAction({
      text,
      lineCount: countSelectedLines(text),
      range: range.cloneRange(),
      anchor: selectionAnchorRect(rect)
    });
  }, []);

  const quoteSelection = useCallback(() => {
    if (!action) return;
    const source = selectionSourceLabel(content);
    const label = m.designSystem.selectionQuote.contextLabel(source, action.lineCount);
    actions.addContext({
      id: `selection:${crypto.randomUUID()}`,
      kind: "selection",
      label,
      path: content.path,
      content: action.text
    });
    ui.focusComposer();
    setAnnouncement(m.designSystem.selectionQuote.announced(action.lineCount));
    setAction(null);
    window.getSelection()?.removeAllRanges();
  }, [action, actions.addContext, ui, content]);

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
    const refreshPosition = () => {
      setAction((current) => {
        if (!current) return null;
        const rect = current.range.getBoundingClientRect();
        return { ...current, anchor: selectionAnchorRect(rect) };
      });
    };
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("scroll", refreshPosition, true);
    window.addEventListener("resize", refreshPosition);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("scroll", refreshPosition, true);
      window.removeEventListener("resize", refreshPosition);
    };
  }, [action, quoteSelection]);

  useEffect(() => {
    if (!action) return;
    const frame = requestAnimationFrame(popover.updatePosition);
    return () => cancelAnimationFrame(frame);
  }, [action, popover.updatePosition]);

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
        <>
          <span
            ref={anchorRef}
            className="content-selection-anchor"
            aria-hidden="true"
            style={{ left: action.anchor.left, top: action.anchor.top, width: action.anchor.width, height: action.anchor.height }}
          />
          <button
            ref={actionRef}
            type="button"
            className="content-selection-quote"
            data-motion="action"
            data-side={popover.side}
            style={popover.style}
            aria-label={m.designSystem.selectionQuote.action}
            title={m.designSystem.selectionQuote.actionShortcut}
            onPointerDown={(event) => event.preventDefault()}
            onClick={quoteSelection}
          >
            <Quote size={14} aria-hidden />
            {m.designSystem.selectionQuote.action}
          </button>
        </>,
        document.body
      ) : null}
    </>
  );
}

function selectionAnchorRect(rect: DOMRect): SelectionAction["anchor"] {
  return {
    left: rect.left,
    top: rect.top,
    width: Math.max(1, rect.width),
    height: Math.max(1, rect.height)
  };
}

export function countSelectedLines(text: string): number {
  return Math.max(1, text.split(/\r\n|\r|\n/).filter((line) => line.trim()).length);
}

export function selectionSourceLabel(content: ContentRecord): string {
  const name = content.name || content.path.split(/[\\/]/).at(-1) || m.designSystem.selectionQuote.fallback;
  const dailyBrief = name.match(/(\d{4})(\d{2})(\d{2})_daily_(?:summary|brief)\.md/i);
  if (dailyBrief) return m.designSystem.selectionQuote.dailyBrief(`${dailyBrief[1]}-${dailyBrief[2]}-${dailyBrief[3]}`);
  return name.replace(/\.[^.]+$/, "") || m.designSystem.selectionQuote.fallback;
}
