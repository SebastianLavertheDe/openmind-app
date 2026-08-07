import type { ReactNode } from "react";
import { Database, Folder, Rss } from "lucide-react";
import type { SourceDefinition, SourceKind } from "@shared/contracts";
import { messages as m } from "@shared/messages";

export function SourceMetricCard({ icon, label, value, detail, tone }: { icon: ReactNode; label: string; value: number | string; detail: string; tone: "info" | "success" | "warning" | "danger" | "violet" }) {
  return <article className={`source-metric-card ${tone}`}><span className="source-metric-icon">{icon}</span><div><span>{label}</span><strong>{value}</strong><small>{detail}</small></div></article>;
}

export function sourceIcon(kind: SourceKind) {
  if (kind === "rss") return <Rss size={16} />;
  if (kind === "web" || kind === "manual") return <Folder size={16} />;
  return <Database size={16} />;
}

export function sourceKindLabel(kind: SourceKind): string {
  return m.sources.kind[kind];
}

export function splitSourceTags(value: string): string[] {
  return [...new Set(value.split(/[，,\n]/).map((tag) => tag.trim()).filter(Boolean))].slice(0, 8);
}

export function formatFullDateTime(value: string): string {
  return new Date(value).toLocaleString("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

export function isToday(value: string | null | undefined): boolean {
  if (!value) return false;
  const date = new Date(value);
  const now = new Date();
  return date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth() && date.getDate() === now.getDate();
}

export function todayCompact(): string {
  const date = new Date();
  return `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, "0")}${String(date.getDate()).padStart(2, "0")}`;
}

export function statusLabel(value: SourceDefinition["status"]): string {
  return ({
    idle: m.sources.status.pending,
    running: m.sources.status.running,
    success: m.sources.status.ok,
    warning: m.sources.status.attention,
    failed: m.sources.status.failed,
    disabled: m.sources.status.disabled
  } as const)[value];
}

export function statusTone(value: SourceDefinition["status"]): "neutral" | "success" | "warning" | "danger" | "info" {
  if (value === "success") return "success";
  if (value === "warning") return "warning";
  if (value === "failed") return "danger";
  if (value === "running") return "info";
  return "neutral";
}
