import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { capabilityFingerprint, ExecutionConsentService } from "./execution-consent-service";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("ExecutionConsentService", () => {
  it("binds host consent to exact digest and capability fingerprint", () => {
    const service = new ExecutionConsentService(path.join(makeRoot(), "consent.json"));
    const input = { skillId: "skill", version: "1.0.0", digest: "a".repeat(64), capabilities: { network: ["api.example.com"], write: ["daily-summary/**"] } };
    service.approve(input);

    expect(service.isApproved(input)).toBe(true);
    expect(service.isApproved({ ...input, digest: "b".repeat(64) })).toBe(false);
    expect(service.isApproved({ ...input, capabilities: { network: ["other.example.com"], write: ["daily-summary/**"] } })).toBe(false);
    expect(capabilityFingerprint({ a: 1, b: 2 })).toBe(capabilityFingerprint({ b: 2, a: 1 }));
  });

  it("revokes only the exact consent record", () => {
    const service = new ExecutionConsentService(path.join(makeRoot(), "consent.json"));
    const input = { skillId: "skill", version: "1.0.0", digest: "a".repeat(64), capabilities: {} };
    service.approve(input);

    expect(service.revoke(input)).toBe(true);
    expect(service.isApproved(input)).toBe(false);
    expect(service.revoke(input)).toBe(false);
  });
});

function makeRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cctools-consent-"));
  roots.push(root);
  return root;
}
