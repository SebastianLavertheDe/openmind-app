import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { writeJsonAtomic } from "../lib/fs-utils";

const CONSENT_SCHEMA_VERSION = 1 as const;

const ExecutionConsentSchema = z.object({
  schemaVersion: z.literal(CONSENT_SCHEMA_VERSION),
  id: z.string().min(1).max(120),
  skillId: z.string().min(1).max(128),
  version: z.string().min(1).max(80),
  digest: z.string().regex(/^[a-f0-9]{64}$/),
  capabilityFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  approvedAt: z.string().datetime(),
  revokedAt: z.string().datetime().nullable()
}).strict();
type ExecutionConsent = z.infer<typeof ExecutionConsentSchema>;

export type ConsentInput = {
  skillId: string;
  version: string;
  digest: string;
  capabilities: unknown;
};

type ConsentRegistry = {
  schemaVersion: typeof CONSENT_SCHEMA_VERSION;
  records: ExecutionConsent[];
};

/** Host-execution approval is bound to one exact package digest and capability set. */
export class ExecutionConsentService {
  constructor(
    private readonly registryFile: string,
    private readonly now: () => Date = () => new Date()
  ) {}

  isApproved(input: ConsentInput): boolean {
    const normalized = normalizeConsentInput(input);
    const record = this.read().records.find((item) => item.skillId === normalized.skillId && item.version === normalized.version && item.digest === normalized.digest && item.capabilityFingerprint === normalized.capabilityFingerprint);
    return Boolean(record && !record.revokedAt);
  }

  approve(input: ConsentInput): ExecutionConsent {
    const normalized = normalizeConsentInput(input);
    const registry = this.read();
    const existing = registry.records.find((item) => item.skillId === normalized.skillId && item.version === normalized.version && item.digest === normalized.digest && item.capabilityFingerprint === normalized.capabilityFingerprint);
    if (existing) {
      const refreshed = ExecutionConsentSchema.parse({ ...existing, revokedAt: null });
      this.write({ schemaVersion: registry.schemaVersion, records: registry.records.map((item) => item.id === existing.id ? refreshed : item) });
      return refreshed;
    }
    const record = ExecutionConsentSchema.parse({
      schemaVersion: CONSENT_SCHEMA_VERSION,
      id: `consent-${crypto.randomUUID()}`,
      skillId: normalized.skillId,
      version: normalized.version,
      digest: normalized.digest,
      capabilityFingerprint: normalized.capabilityFingerprint,
      approvedAt: this.now().toISOString(),
      revokedAt: null
    });
    registry.records.push(record);
    this.write(registry);
    return record;
  }

  revoke(input: ConsentInput): boolean {
    const normalized = normalizeConsentInput(input);
    const registry = this.read();
    let changed = false;
    const now = this.now().toISOString();
    const records = registry.records.map((item) => {
      if (item.skillId !== normalized.skillId || item.version !== normalized.version || item.digest !== normalized.digest || item.capabilityFingerprint !== normalized.capabilityFingerprint || item.revokedAt) return item;
      changed = true;
      return { ...item, revokedAt: now };
    });
    if (changed) this.write({ schemaVersion: registry.schemaVersion, records });
    return changed;
  }

  list(): ExecutionConsent[] {
    return this.read().records.map((record) => ({ ...record }));
  }

  private read(): ConsentRegistry {
    if (!fs.existsSync(this.registryFile)) return { schemaVersion: CONSENT_SCHEMA_VERSION, records: [] };
    try {
      const parsed = JSON.parse(fs.readFileSync(this.registryFile, "utf8")) as Partial<ConsentRegistry>;
      if (parsed.schemaVersion !== CONSENT_SCHEMA_VERSION || !Array.isArray(parsed.records)) throw new Error("Execution consent registry schema mismatch");
      return { schemaVersion: CONSENT_SCHEMA_VERSION, records: parsed.records.map((item) => ExecutionConsentSchema.parse(item)) };
    } catch (error) {
      throw new Error(`Execution consent registry 无法读取，拒绝覆盖授权状态：${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private write(registry: ConsentRegistry): void {
    fs.mkdirSync(path.dirname(this.registryFile), { recursive: true });
    writeJsonAtomic(this.registryFile, registry);
  }
}

export function capabilityFingerprint(capabilities: unknown): string {
  return crypto.createHash("sha256").update(stableJson(capabilities)).digest("hex");
}

function normalizeConsentInput(input: ConsentInput): ConsentInput & { capabilityFingerprint: string } {
  if (!/^[a-f0-9]{64}$/i.test(input.digest)) throw new Error("Consent digest 无效。");
  return {
    ...input,
    digest: input.digest.toLowerCase(),
    capabilityFingerprint: capabilityFingerprint(input.capabilities)
  };
}

function stableJson(value: unknown): string {
  if (value === undefined) return "undefined";
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  return `{${Object.keys(value as Record<string, unknown>).sort().map((key) => `${JSON.stringify(key)}:${stableJson((value as Record<string, unknown>)[key])}`).join(",")}}`;
}
