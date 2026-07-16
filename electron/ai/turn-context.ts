import type { AiContextState, AiTurnContext } from "../../shared/contracts";

export function captureTurnContext(
  cwd: string,
  now = new Date(),
  timezone = resolvedTimezone()
): AiTurnContext {
  return {
    cwd,
    currentDate: formatCalendarDate(now, timezone),
    timezone,
    capturedAt: now.toISOString()
  };
}

export function withTurnContext(prompt: string, context: AiTurnContext): string {
  return [
    "<cctools_turn_context>",
    `  <cwd>${escapeXml(context.cwd)}</cwd>`,
    `  <current_date>${context.currentDate}</current_date>`,
    `  <timezone>${escapeXml(context.timezone)}</timezone>`,
    "  <instruction>Resolve relative dates such as today, yesterday, and tomorrow from this current_date and timezone.</instruction>",
    "</cctools_turn_context>",
    "",
    prompt
  ].join("\n");
}

export function withRecoveredHistory(
  prompt: string,
  state: AiContextState,
  currentTurnId: string
): string {
  const candidates = state.history.filter((item) => item.turnId !== currentTurnId);
  if (!candidates.length) return prompt;
  const selected: typeof candidates = [];
  let chars = 0;
  for (let index = candidates.length - 1; index >= 0; index--) {
    const item = candidates[index];
    const size = item.content.length + JSON.stringify(item.payload).length;
    if (selected.length && chars + size > 48_000) break;
    selected.unshift(item);
    chars += size;
  }
  const history = selected.map((item) => {
    const attributes = [
      `kind="${item.kind}"`,
      item.role ? `role="${item.role}"` : "",
      item.name ? `name="${escapeXml(item.name)}"` : "",
      item.callId ? `call_id="${escapeXml(item.callId)}"` : ""
    ].filter(Boolean).join(" ");
    return `  <item ${attributes}>${escapeXml(item.content)}</item>`;
  });
  return [
    '<cctools_recovered_history source="local_rollout">',
    ...history,
    "</cctools_recovered_history>",
    "",
    prompt
  ].join("\n");
}

function resolvedTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || process.env.TZ || "UTC";
  } catch {
    return process.env.TZ || "UTC";
  }
}

function formatCalendarDate(date: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value || "";
  return `${value("year")}-${value("month")}-${value("day")}`;
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}
