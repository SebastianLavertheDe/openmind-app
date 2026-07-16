import { ChevronRight } from "lucide-react";
import { useState, type MouseEvent, type ReactNode } from "react";
import { AnimatedDisclosure } from "../../design-system/animated-disclosure";

export type ConversationTone =
  | "user"
  | "assistant"
  | "thought"
  | "tool"
  | "approval"
  | "changes"
  | "error"
  | "system"
  | "activity";

export type ConversationStatusTone = "neutral" | "running" | "success" | "warning" | "danger" | "muted";

export function ConversationCell({
  tone,
  icon,
  label,
  title,
  subtitle,
  meta,
  status,
  statusTone = "neutral",
  actions,
  children,
  collapsible = false,
  defaultOpen = false,
  className = ""
}: {
  tone: ConversationTone;
  icon?: ReactNode;
  label: string;
  title?: ReactNode;
  subtitle?: ReactNode;
  meta?: ReactNode;
  status?: ReactNode;
  statusTone?: ConversationStatusTone;
  actions?: ReactNode;
  children?: ReactNode;
  collapsible?: boolean;
  defaultOpen?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const classes = `conversation-cell ${tone} ${statusTone} ${className}`.trim();
  const header = (
    <ConversationCellHeader
      icon={icon}
      label={label}
      title={title}
      subtitle={subtitle}
      meta={meta}
      status={status}
      statusTone={statusTone}
      actions={actions}
      collapsible={collapsible}
    />
  );

  if (collapsible) {
    return (
      <AnimatedDisclosure
        className={classes}
        open={open}
        onOpenChange={setOpen}
        summary={<>{header}<ChevronRight className="conversation-cell-chevron" size={15} /></>}
      >
        {children ? <ConversationCellBody>{children}</ConversationCellBody> : null}
      </AnimatedDisclosure>
    );
  }

  return (
    <article className={classes}>
      {header}
      {children ? <ConversationCellBody>{children}</ConversationCellBody> : null}
    </article>
  );
}

export function ConversationCellHeader({
  icon,
  label,
  title,
  subtitle,
  meta,
  status,
  statusTone = "neutral",
  actions,
  collapsible = false
}: {
  icon?: ReactNode;
  label: string;
  title?: ReactNode;
  subtitle?: ReactNode;
  meta?: ReactNode;
  status?: ReactNode;
  statusTone?: ConversationStatusTone;
  actions?: ReactNode;
  collapsible?: boolean;
}) {
  return (
    <div className="conversation-cell-header">
      <span className="conversation-cell-icon" aria-hidden="true">{icon}</span>
      <div className="conversation-cell-title">
        <span className="conversation-cell-kicker">{label}</span>
        {title ? <strong>{title}</strong> : null}
        {subtitle ? <small>{subtitle}</small> : null}
      </div>
      {meta ? <ConversationCellMeta>{meta}</ConversationCellMeta> : null}
      {status ? <ConversationStatusPill tone={statusTone}>{status}</ConversationStatusPill> : null}
      {actions ? (
        <ConversationCellActions onClick={(event) => collapsible && event.stopPropagation()}>
          {actions}
        </ConversationCellActions>
      ) : null}
    </div>
  );
}

export function ConversationCellBody({ children }: { children: ReactNode }) {
  return <div className="conversation-cell-body">{children}</div>;
}

export function ConversationCellActions({
  children,
  onClick
}: {
  children: ReactNode;
  onClick?: (event: MouseEvent<HTMLDivElement>) => void;
}) {
  return <div className="conversation-cell-actions" onClick={onClick}>{children}</div>;
}

export function ConversationCellMeta({ children }: { children: ReactNode }) {
  return <span className="conversation-cell-meta">{children}</span>;
}

export function ConversationStatusPill({ tone = "neutral", children }: { tone?: ConversationStatusTone; children: ReactNode }) {
  return <span className={`conversation-status ${tone}`}>{children}</span>;
}

export function ParameterPreview({ children }: { children: ReactNode }) {
  return <code className="parameter-preview">{children}</code>;
}
