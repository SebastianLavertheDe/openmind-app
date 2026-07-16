import crypto from "node:crypto";
import type { RiskFinding } from "../../shared/contracts";

const rules: Array<{ kind: RiskFinding["kind"]; severity: RiskFinding["severity"]; summary: string; pattern: RegExp }> = [
  { kind: "private-key", severity: "high", summary: "可能包含私钥", pattern: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/i },
  { kind: "token", severity: "high", summary: "可能包含访问令牌", pattern: /\b(?:sk-[A-Za-z0-9_-]{20,}|ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|nvapi-[A-Za-z0-9_-]{20,})\b/i },
  { kind: "credential", severity: "high", summary: "可能包含凭据赋值", pattern: /\b(?:api[_-]?key|secret|password|passwd|access[_-]?token)\s*[:=]\s*[^\s"'`]{8,}/i },
  { kind: "cookie", severity: "warning", summary: "可能包含 Cookie", pattern: /\b(?:cookie|set-cookie)\s*:\s*[^\n]{12,}/i },
  { kind: "absolute-path", severity: "warning", summary: "包含本机绝对路径", pattern: /(?:[A-Za-z]:\\Users\\[^\\\s]+|\/home\/[^/\s]+|\\\\wsl(?:\.localhost|\$)\\[^\\\s]+)/i }
];

export function scanRisks(value: unknown, eventId?: string): RiskFinding[] {
  const text = boundedRiskText(value);
  return rules
    .filter((rule) => rule.pattern.test(text))
    .map((rule) => ({
      id: crypto.randomUUID(),
      kind: rule.kind,
      severity: rule.severity,
      summary: rule.summary,
      eventId
    }));
}

function boundedRiskText(value: unknown, maxLength = 64 * 1024): string {
  if (typeof value === "string") return value.slice(0, maxLength);
  const parts: string[] = [];
  const seen = new Set<unknown>();
  let length = 0;
  const append = (text: string) => {
    if (length >= maxLength) return;
    const chunk = text.slice(0, maxLength - length);
    parts.push(chunk);
    length += chunk.length;
  };
  const visit = (current: unknown): void => {
    if (length >= maxLength || current == null) return;
    if (typeof current === "string" || typeof current === "number" || typeof current === "boolean" || typeof current === "bigint") {
      append(String(current));
      return;
    }
    if (typeof current !== "object" || seen.has(current)) return;
    seen.add(current);
    if (Array.isArray(current)) {
      for (const item of current) {
        visit(item);
        append("\n");
        if (length >= maxLength) break;
      }
      return;
    }
    for (const [key, item] of Object.entries(current as Record<string, unknown>)) {
      append(`${key}:`);
      visit(item);
      append("\n");
      if (length >= maxLength) break;
    }
  };
  visit(value);
  return parts.join("");
}
