import type { ReactNode } from "react";
import { useLocale } from "../../i18n";

/** Shared section surface for settings forms and resource editors. */
export function SettingsPanel({ title, scope, action, variant = "standard", children }: {
  title: string;
  scope?: string;
  action?: ReactNode;
  variant?: "standard" | "resource" | "mcp";
  children: ReactNode;
}) {
  useLocale();
  return <section className={`settings-card settings-card--${variant}`} data-entrance-item>
    <header><div className="settings-card-title"><h2>{title}</h2>{scope ? <span>{scope}</span> : null}</div>{action}</header>
    <div className="settings-card-body">{children}</div>
  </section>;
}
