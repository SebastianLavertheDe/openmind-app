import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { Bot, Command, CornerDownLeft, FileText, FolderKanban, Sparkles, X } from "lucide-react";
import type { GlobalSearchResult, PermissionProfile } from "@shared/contracts";
import { messages as m } from "@shared/messages";
import type { Navigate } from "./routes";
import { useAi } from "../ai-context";
import { Tooltip } from "../design-system/components";
import { useExitPresence } from "../design-system/use-exit-presence";
import { useModalFocusScope } from "../design-system/use-modal-focus-scope";

type PaletteAction = {
  intent: "summarize" | "create-draft" | "compare";
  badge: string;
  title: string;
  why: string;
  prompt: string;
  permissionProfile: PermissionProfile;
};

function todayStr(): string {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function interpretAction(raw: string): PaletteAction | null {
  const text = raw.trim();
  if (text.length < 2) return null;
  const base = m.search.userPrefix(text);
  const date = todayStr();
  if (m.search.intentPatterns.summarize.test(text)) {
    const action = m.search.actions.summarize;
    return {
      intent: "summarize",
      badge: action.badge,
      title: action.title,
      why: action.why(date),
      prompt: m.search.prompts.summarize(date, base),
      permissionProfile: "read-only"
    };
  }
  if (m.search.intentPatterns.createDraft.test(text)) {
    const action = m.search.actions.createDraft;
    return {
      intent: "create-draft",
      badge: action.badge,
      title: action.title,
      why: action.why,
      prompt: m.search.prompts.createDraft(text, base),
      permissionProfile: "edit"
    };
  }
  if (m.search.intentPatterns.compare.test(text)) {
    const action = m.search.actions.compare;
    return {
      intent: "compare",
      badge: action.badge,
      title: action.title,
      why: action.why,
      prompt: m.search.prompts.compare(base),
      permissionProfile: "read-only"
    };
  }
  return null;
}

export function GlobalSearch({
  open,
  onClose,
  navigate,
  onOpenContent
}: {
  open: boolean;
  onClose(): void;
  navigate: Navigate;
  onOpenContent(path: string): void;
}) {
  const ai = useAi();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<GlobalSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [running, setRunning] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const scopeRef = useRef<HTMLDivElement>(null);

  const { visible, leaving } = useExitPresence(open, 160);
  useModalFocusScope({
    open: visible,
    containerRef: scopeRef,
    onDismiss: onClose,
    layer: "global"
  });

  useEffect(() => {
    if (!visible || query.trim().length < 2) {
      setResults([]);
      setActiveIndex(0);
      setLoading(false);
      return;
    }
    let active = true;
    setLoading(true);
    const timer = window.setTimeout(() => {
      void window.openmind.searchWorkspace(query).then((next) => {
        if (!active) return;
        setResults(next);
      }).finally(() => {
        if (active) setLoading(false);
      });
    }, 160);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [visible, query]);

  const action = useMemo(() => interpretAction(query), [query]);
  const actionOffset = action ? 1 : 0;
  // 默认选中第一项：有动作时选中动作，否则选中首个结果。
  useEffect(() => { setActiveIndex(0); setActionError(null); }, [query]);

  const groups = useMemo(() => {
    const order: GlobalSearchResult["kind"][] = ["content", "project", "session", "skill"];
    return order.flatMap((kind) => {
      const items = results.filter((result) => result.kind === kind);
      return items.length ? [{ kind, items }] : [];
    });
  }, [results]);

  const runAction = async (target: PaletteAction) => {
    if (running) return;
    setActionError(null);
    setRunning(true);
    try {
      await ai.send(target.prompt, { permissionProfile: target.permissionProfile });
      setQuery("");
      onClose();
      navigate("ai");
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setRunning(false);
    }
  };

  const choose = async (result: GlobalSearchResult) => {
    if (result.kind === "content") {
      if (result.path) onOpenContent(result.path);
      else navigate("brief", { date: result.date || undefined });
    } else if (result.kind === "project") {
      navigate("creative", { projectDir: result.targetId });
    } else if (result.kind === "session") {
      await ai.setActiveSession(result.targetId);
      navigate("ai");
    } else {
      navigate("skills", { skillId: result.targetId });
    }
    setQuery("");
    onClose();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((value) => Math.min(actionOffset + Math.max(results.length - 1, 0), value + 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((value) => Math.max(0, value - 1));
    } else if (event.key === "Enter") {
      event.preventDefault();
      if (actionOffset && activeIndex === 0 && action) {
        void runAction(action);
        return;
      }
      const result = results[activeIndex - actionOffset];
      if (result) void choose(result);
    }
  };

  if (!visible || typeof document === "undefined") return null;
  let flatIndex = actionOffset - 1;
  const showHint = query.trim().length < 2;
  const showEmpty = !loading && query.trim().length >= 2 && !results.length && !action;
  return createPortal(
    <div
      ref={scopeRef}
      className="global-search-scrim ui-overlay"
      data-leaving={leaving || undefined}
      onClick={onClose}
      tabIndex={-1}
    >
      <section className="global-search-dialog" role="dialog" aria-modal="true" aria-label={m.search.dialogLabel} onClick={(event) => event.stopPropagation()}>
        <header>
          <Sparkles size={18} style={{ color: "var(--accent)" }} />
          <input
            aria-label={m.search.inputAria}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={onKeyDown}
            placeholder={m.search.placeholder}
          />
          {loading ? <span className="global-search-loading">{m.search.loading}</span> : null}
          <Tooltip content={m.common.close}><button data-motion="icon" aria-label={m.common.close} onClick={onClose}><X size={16} /></button></Tooltip>
        </header>
        <div className="global-search-results" role="listbox" aria-label={m.search.resultsAria}>
          {showHint ? <div className="global-search-hint">{m.search.hintShort}</div> : null}
          {action ? (
            <section className="global-search-action-section">
              <h3>{m.search.actionSection}</h3>
              <button
                className={`global-search-action${activeIndex === 0 ? " active" : ""}`}
                role="option"
                aria-selected={activeIndex === 0}
                onMouseEnter={() => setActiveIndex(0)}
                onClick={() => void runAction(action)}
                disabled={running}
              >
                <span className="global-result-icon action"><Sparkles size={16} /></span>
                <div>
                  <strong>{action.title}</strong>
                  <small>{action.why}</small>
                  {actionError ? <small className="global-search-action-error">{actionError}</small> : null}
                </div>
                <em>{action.badge}{running ? ` ${m.search.runningSuffix}` : null}<CornerDownLeft size={11} /></em>
              </button>
            </section>
          ) : null}
          {showEmpty ? <div className="global-search-hint">{m.search.hintEmpty}</div> : null}
          {groups.map((group) => (
            <section key={group.kind}>
              <h3>{groupLabel(group.kind)}</h3>
              {group.items.map((result) => {
                flatIndex += 1;
                const index = flatIndex;
                return (
                  <button
                    data-motion="selection"
                    key={result.id}
                    role="option"
                    aria-selected={index === activeIndex}
                    className={index === activeIndex ? "active" : ""}
                    onMouseEnter={() => setActiveIndex(index)}
                    onClick={() => void choose(result)}
                  >
                    <span className={`global-result-icon ${result.kind}`}>{resultIcon(result.kind)}</span>
                    <div><strong>{result.title}</strong><small>{result.subtitle}</small></div>
                    {result.status ? <em>{result.status}</em> : null}
                  </button>
                );
              })}
            </section>
          ))}
        </div>
      </section>
    </div>,
    document.body
  );
}

function groupLabel(kind: GlobalSearchResult["kind"]): string {
  return m.search.groups[kind];
}

function resultIcon(kind: GlobalSearchResult["kind"]) {
  if (kind === "content") return <FileText size={16} />;
  if (kind === "project") return <FolderKanban size={16} />;
  if (kind === "session") return <Bot size={16} />;
  return <Command size={16} />;
}
