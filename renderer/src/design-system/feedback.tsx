import { useLocale } from "../i18n";
import type { ReactNode } from "react";
import { AlertTriangle, LoaderCircle } from "lucide-react";
import { messages as m } from "@shared/messages";

export function StatusBadge({
  tone = "neutral",
  children
}: {
  tone?: "neutral" | "success" | "warning" | "danger" | "info";
  children: ReactNode;
}) {
  useLocale();
  return <span className={`ui-status-badge ${tone}`}>{children}</span>;
}

export function EmptyState({
  title,
  description,
  icon,
  action
}: {
  title: string;
  description?: string;
  icon?: ReactNode;
  action?: ReactNode;
}) {
  useLocale();
  return (
    <div className="ui-empty-state">
      {icon ? <div className="ui-empty-icon">{icon}</div> : null}
      <strong>{title}</strong>
      {description ? <p>{description}</p> : null}
      {action}
    </div>
  );
}

export function LoadingState({ label = m.designSystem.loadingDefault }: { label?: string }) {
  useLocale();
  return <div className="ui-loading-state"><LoaderCircle size={18} className="spin" /><span>{label}</span></div>;
}

export function ErrorState({ message, retry }: { message: string; retry?(): void }) {
  useLocale();
  return (
    <div className="ui-error-state" role="alert">
      <AlertTriangle size={20} aria-hidden="true" />
      <div><strong>{m.designSystem.loadFailed}</strong><p>{message}</p></div>
      {retry ? <button data-motion="action" onClick={retry}>{m.common.retry}</button> : null}
    </div>
  );
}

export function Skeleton({
  lines = 3,
  label = m.designSystem.skeletonLabel,
  variant = "block"
}: {
  lines?: number;
  label?: string;
  /** block=默认块状骨架;card=卡片容器;row=列表行;metric=指标卡 */
  variant?: "block" | "card" | "row" | "metric";
}) {
  useLocale();
  const variantClass =
    variant === "card" ? "ui-skeleton-card"
    : variant === "row" ? "ui-skeleton-row"
    : variant === "metric" ? "ui-skeleton-metric"
    : "ui-skeleton";
  const lineCount = variant === "metric" ? 2 : lines;
  return (
    <div className={`ui-skeleton ${variantClass}`} role="status" aria-label={label}>
      {Array.from({ length: lineCount }, (_, index) => <span key={index} />)}
    </div>
  );
}
