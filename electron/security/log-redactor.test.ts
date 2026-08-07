import { describe, expect, it } from "vitest";
import { LogRedactor } from "./log-redactor";

describe("LogRedactor", () => {
  const redactor = new LogRedactor();

  it("redacts known secrets and common credential fields", () => {
    expect(redactor.redact("key=super-secret", ["super-secret"])).toBe("key=[REDACTED]");
    expect(redactor.redact('{"apiKey":"sk-abcdefghijklmnopqrstuvwxyz"}')).toContain("[REDACTED]");
    expect(redactor.redact("-----BEGIN PRIVATE KEY-----\nsecret\n-----END PRIVATE KEY-----")).toContain("[REDACTED]");
    expect(redactor.redact("ordinary text stays visible")).toBe("ordinary text stays visible");
  });

  it("walks nested diagnostic payloads", () => {
    expect(redactor.redactValue({ error: "bad", headers: { authorization: "Bearer secret-token" }, values: ["secret-token"] }, ["secret-token"])).toEqual({
      error: "bad",
      headers: { authorization: "Bearer [REDACTED]" },
      values: ["[REDACTED]"]
    });
  });
});
