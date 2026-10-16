import { useLocale } from "../i18n";
import { useEffect, useMemo, useRef, type ReactNode } from "react";
import { messages as m } from "@shared/messages";

type LogTone = "neutral" | "success" | "warning" | "danger" | "muted";

export function LogViewer({
  text,
  label = m.designSystem.logViewer,
  empty = m.designSystem.logViewerEmpty,
  status,
  actions
}: {
  text: string;
  label?: string;
  empty?: string;
  status?: ReactNode;
  actions?: ReactNode;
}) {
  const locale = useLocale();
  const scrollerRef = useRef<HTMLDivElement>(null);
  const followRef = useRef(true);
  const lines = useMemo(() => splitLogLines(text), [text, locale]);

  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller || !followRef.current) return;
    scroller.scrollTop = scroller.scrollHeight;
  }, [text]);

  return (
    <section className="ui-log-viewer" aria-label={label}>
      <header>
        <div>
          <strong>{label}</strong>
          {status}
        </div>
        {actions ? <div className="ui-log-actions">{actions}</div> : null}
      </header>
      <div
        ref={scrollerRef}
        className="ui-log-lines"
        role="log"
        aria-live="polite"
        onScroll={(event) => {
          const target = event.currentTarget;
          followRef.current = target.scrollHeight - target.scrollTop - target.clientHeight < 50;
        }}
      >
        {lines.length ? lines.map((line, index) => (
          <div key={`${index}:${line.raw.slice(0, 20)}`} className={`ui-log-line ${line.tone}`}>
            <span>{line.time || "--:--:--"}</span>
            <code>{line.body}</code>
          </div>
        )) : (
          <div className="ui-log-empty">{empty}</div>
        )}
      </div>
    </section>
  );
}

function splitLogLines(text: string): Array<{ raw: string; time: string; body: string; tone: LogTone }> {
  return text
    .split(/\n/)
    .map((raw) => raw.trimEnd())
    .filter(Boolean)
    .map((raw) => {
      const match = raw.match(/^\[([^\]]+)\]\s*(.*)$/);
      const body = match ? match[2] : raw;
      return {
        raw,
        time: match ? match[1] : "",
        body,
        tone: logTone(raw)
      };
    });
}

function logTone(line: string): LogTone {
  if (/(error|failed|failure|exception|stderr|失败|错误|异常)/i.test(line)) return "danger";
  if (/(warn|warning|approval|retry|timeout|需审批|警告|超时)/i.test(line)) return "warning";
  if (/(success|done|completed|finished|成功|完成|已生成|已保存)/i.test(line)) return "success";
  if (/^\[[^\]]+\]/.test(line)) return "neutral";
  return "muted";
}
