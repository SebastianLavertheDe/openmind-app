const REDACTED = "[REDACTED]";

const SECRET_PATTERNS: readonly RegExp[] = [
  /(["']?(?:api[_-]?key|access[_-]?token|auth[_-]?token|refresh[_-]?token|client[_-]?secret|password|cookie|secret)["']?\s*[:=]\s*["']?)([^\s,"'}]+)(["']?)/gi,
  /(-----BEGIN [A-Z ]*PRIVATE KEY-----)([\s\S]*?)(-----END [A-Z ]*PRIVATE KEY-----)/gi,
  /\b(sk-[A-Za-z0-9_-]{12,}|nvapi-[A-Za-z0-9_-]{12,}|ghp_[A-Za-z0-9]{12,}|xox[baprs]-[A-Za-z0-9-]{12,})\b/g
];

export class LogRedactor {
  redact(value: string, knownSecrets: readonly string[] = []): string {
    let redacted = value;
    for (const secret of knownSecrets) {
      if (secret.length < 4) continue;
      redacted = redacted.split(secret).join(REDACTED);
    }
    redacted = redacted.replace(SECRET_PATTERNS[0], `$1${REDACTED}$3`);
    redacted = redacted.replace(SECRET_PATTERNS[1], `$1${REDACTED}$3`);
    redacted = redacted.replace(SECRET_PATTERNS[2], REDACTED);
    return redacted;
  }

  redactValue<T>(value: T, knownSecrets: readonly string[] = []): T {
    return this.walk(value, knownSecrets) as T;
  }

  private walk(value: unknown, knownSecrets: readonly string[]): unknown {
    if (typeof value === "string") return this.redact(value, knownSecrets);
    if (Array.isArray(value)) return value.map((item) => this.walk(item, knownSecrets));
    if (!value || typeof value !== "object") return value;
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, this.walk(item, knownSecrets)]));
  }
}

export const logRedactor = new LogRedactor();
