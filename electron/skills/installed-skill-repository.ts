import fs from "node:fs";
import { writeJsonAtomic } from "../lib/fs-utils";

export const INSTALLED_SKILL_REGISTRY_SCHEMA_VERSION = 1 as const;

export type InstalledSkillStatus = "quarantined" | "installed-not-ready" | "active" | "previous";
export type InstalledSkillReadiness = "installed-not-ready" | "ready" | "blocked" | "stale";
export type InstalledSkillExecutionTrust = "denied" | "inspect-only" | "approved-host";
export type InstalledSkillSignatureStatus = "unsigned" | "valid" | "invalid" | "revoked";
export type InstalledSkillReviewStatus = "unreviewed" | "automated-scan" | "manually-reviewed";
export type InstalledSkillUpdatePolicy = "manual" | "download-only";
export type InstalledSkillSourceType = "directory" | "zip" | "git";

export type InstalledSkillRecord = {
  schemaVersion: typeof INSTALLED_SKILL_REGISTRY_SCHEMA_VERSION;
  key: string;
  id: string;
  publisherId: string;
  version: string;
  digest: string;
  sourcePath: string;
  /** New source metadata is optional for registry v1 backward compatibility. */
  sourceType?: InstalledSkillSourceType;
  sourceLocator?: string;
  sourceRef?: string;
  packagePath: string;
  status: InstalledSkillStatus;
  readiness: InstalledSkillReadiness;
  signatureStatus: InstalledSkillSignatureStatus;
  reviewStatus: InstalledSkillReviewStatus;
  executionTrust: InstalledSkillExecutionTrust;
  skillUpdatePolicy: InstalledSkillUpdatePolicy;
  installedAt: string;
};

export type InstalledSkillRegistryFile = {
  schemaVersion: typeof INSTALLED_SKILL_REGISTRY_SCHEMA_VERSION;
  records: InstalledSkillRecord[];
};

/**
 * Owns only the installed-skill metadata and active/previous pointers.
 * Package bytes are managed by SkillPackageService; this repository never
 * reads or executes an original source directory.
 */
export class InstalledSkillRepository {
  constructor(private readonly registryFile: string) {}

  list(): InstalledSkillRecord[] {
    return this.read().records.slice().sort((left, right) =>
      `${left.key}@${left.version}`.localeCompare(`${right.key}@${right.version}`)
    );
  }

  get(key: string, digest?: string): InstalledSkillRecord | undefined {
    return this.read().records.find((record) => record.key === key && (!digest || record.digest === digest));
  }

  /** Idempotent for the same key + digest; does not alter another version's status. */
  upsert(record: InstalledSkillRecord): InstalledSkillRecord {
    const registry = this.read();
    registry.records = registry.records.filter(
      (candidate) => !(candidate.key === record.key && candidate.digest === record.digest)
    );
    registry.records.push(record);
    this.write(registry);
    return record;
  }

  remove(key: string, digest?: string): InstalledSkillRecord | undefined {
    const registry = this.read();
    const target = registry.records.find((record) => record.key === key && (!digest || record.digest === digest));
    if (!target) return undefined;
    registry.records = registry.records.filter((record) => record !== target);
    this.write(registry);
    return target;
  }

  /**
   * Compatibility-only status update for migration/tests. New callers must
   * use activate/rollback so the active and previous pointers are changed in
   * one registry transaction.
   */
  replaceStatus(key: string, digest: string, status: InstalledSkillStatus): InstalledSkillRecord {
    const registry = this.read();
    const target = registry.records.find((record) => record.key === key && record.digest === digest);
    if (!target) throw new Error(`Installed Skill 不存在：${key}@${digest}`);
    if (status === "active") {
      throw new Error("不能直接写入 active；请使用 activate()。 ");
    }
    if (target.status === "active") {
      throw new Error("当前 active 版本不能通过 replaceStatus() 降级；请使用 rollback()。 ");
    }
    if (status === "previous" && target.readiness !== "ready") {
      throw new Error("只有 ready 版本才能标记为 previous。 ");
    }
    const records = registry.records.map((record) => {
      if (record.key !== key) return record;
      if (record.digest === digest) return { ...record, status };
      return record.status === "previous" && status === "previous"
        ? { ...record, status: "quarantined" as const }
        : record;
    });
    this.write({ schemaVersion: registry.schemaVersion, records });
    return records.find((record) => record.key === key && record.digest === digest)!;
  }

  markReadiness(key: string, digest: string, readiness: InstalledSkillReadiness): InstalledSkillRecord {
    const registry = this.read();
    const index = registry.records.findIndex((record) => record.key === key && record.digest === digest);
    if (index < 0) throw new Error(`Installed Skill 不存在：${key}@${digest}`);
    const current = registry.records[index];
    if ((current.status === "active" || current.status === "previous") && readiness !== "ready") {
      throw new Error("active/previous 版本不能直接变为非 ready；请先切换或卸载该版本。 ");
    }
    const target = { ...current, readiness };
    registry.records[index] = target;
    this.write(registry);
    return target;
  }

  /** Explicit user trust for one exact active package digest. */
  approveHostExecution(key: string, digest: string): InstalledSkillRecord {
    const registry = this.read();
    const index = registry.records.findIndex((record) => record.key === key && record.digest === digest);
    if (index < 0) throw new Error(`Installed Skill 不存在：${key}@${digest}`);
    const current = registry.records[index];
    if (current.status !== "active") throw new Error("只有 active Skill 才能获得 approved-host 授权。 ");
    if (current.readiness !== "ready") throw new Error("只有 ready Skill 才能获得 approved-host 授权。 ");
    const target = { ...current, executionTrust: "approved-host" as const };
    registry.records[index] = target;
    this.write(registry);
    return target;
  }

  /**
   * Mark a package as changed after installation. This deliberately updates
   * the trust dimensions independently: a valid signature becomes invalid,
   * review evidence is discarded, and host execution approval is revoked.
   * Unsigned packages remain unsigned because there was no signature to
   * invalidate, but they still require a fresh review/trust decision.
   */
  markModified(key: string, digest: string): InstalledSkillRecord {
    const registry = this.read();
    const index = registry.records.findIndex((record) => record.key === key && record.digest === digest);
    if (index < 0) throw new Error(`Installed Skill 不存在：${key}@${digest}`);
    const current = registry.records[index];
    const target: InstalledSkillRecord = {
      ...current,
      signatureStatus: current.signatureStatus === "valid" ? "invalid" : current.signatureStatus,
      reviewStatus: "unreviewed",
      executionTrust: "inspect-only"
    };
    if (sameTrustState(current, target)) return current;
    registry.records[index] = target;
    this.write(registry);
    return target;
  }

  /**
   * Atomically promote a ready candidate and demote the previous active
   * version. A single registry write makes a crash visible as either the old
   * active pointer or the new one, never a half-written pair.
   */
  activate(key: string, digest: string): { active: InstalledSkillRecord; previous?: InstalledSkillRecord } {
    const registry = this.read();
    const target = registry.records.find((record) => record.key === key && record.digest === digest);
    if (!target) throw new Error(`Installed Skill 不存在：${key}@${digest}`);
    if (target.readiness !== "ready") throw new Error("Skill 尚未达到 ready，不能切换 active。");
    if (target.status === "active") return { active: target };
    const previous = registry.records.find((record) => record.key === key && record.status === "active");
    const records = registry.records.map((record) => {
      if (record.key !== key) return record;
      if (record.digest === digest) {
        // A newly promoted digest must never inherit host execution approval
        // from a malformed/legacy registry record. The user must explicitly
        // approve this exact active package again.
        return { ...record, status: "active" as const, executionTrust: "inspect-only" as const };
      }
      if (record.status === "active") return { ...record, status: "previous" as const };
      if (record.status === "previous") return { ...record, status: "quarantined" as const };
      return record;
    });
    this.write({ schemaVersion: registry.schemaVersion, records });
    return {
      active: records.find((record) => record.key === key && record.digest === digest)!,
      ...(previous ? { previous: records.find((record) => record.digest === previous.digest && record.key === key) } : {})
    };
  }

  /** Atomically swap the current active version with the newest previous one. */
  rollback(key: string): { active: InstalledSkillRecord; previous: InstalledSkillRecord } {
    const registry = this.read();
    const active = registry.records.find((record) => record.key === key && record.status === "active");
    const previous = registry.records
      .filter((record) => record.key === key && record.status === "previous")
      .sort((left, right) => right.installedAt.localeCompare(left.installedAt))[0];
    if (!active || !previous) throw new Error("没有可回滚的 Skill previous 版本。");
    if (previous.readiness !== "ready") throw new Error("previous 版本尚未达到 ready，不能回滚。");
    const records = registry.records.map((record) => {
      if (record.key !== key) return record;
      if (record.digest === previous.digest) return { ...record, status: "active" as const };
      if (record.digest === active.digest) return { ...record, status: "previous" as const };
      return record;
    });
    this.write({ schemaVersion: registry.schemaVersion, records });
    return {
      active: records.find((record) => record.key === key && record.status === "active")!,
      previous: records.find((record) => record.key === key && record.status === "previous" && record.digest === active.digest)!
    };
  }

  private read(): InstalledSkillRegistryFile {
    try {
      if (!fs.existsSync(this.registryFile)) {
        return { schemaVersion: INSTALLED_SKILL_REGISTRY_SCHEMA_VERSION, records: [] };
      }
      const parsed = JSON.parse(fs.readFileSync(this.registryFile, "utf8")) as Partial<InstalledSkillRegistryFile>;
      if (parsed.schemaVersion !== INSTALLED_SKILL_REGISTRY_SCHEMA_VERSION || !Array.isArray(parsed.records)) {
        throw new Error("Skill registry schema mismatch");
      }
      const registry = {
        schemaVersion: INSTALLED_SKILL_REGISTRY_SCHEMA_VERSION,
      records: parsed.records.map((record) => validateRecord(record))
      };
      validateRegistry(registry);
      return registry;
    } catch (error) {
      throw new Error(`Skill registry 无法读取，拒绝覆盖现有安装状态：${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private write(registry: InstalledSkillRegistryFile): void {
    validateRegistry(registry);
    writeJsonAtomic(this.registryFile, registry);
  }
}

function validateRegistry(registry: InstalledSkillRegistryFile): void {
  if (registry.schemaVersion !== INSTALLED_SKILL_REGISTRY_SCHEMA_VERSION) {
    throw new Error("Skill registry schema mismatch");
  }
  const activeByKey = new Set<string>();
  const previousByKey = new Set<string>();
  for (const record of registry.records) {
    validateRecord(record);
    if (record.status === "active") {
      if (record.readiness !== "ready") throw new Error("active Skill 必须是 ready");
      if (activeByKey.has(record.key)) throw new Error(`Skill 出现多个 active：${record.key}`);
      activeByKey.add(record.key);
    }
    if (record.status === "previous") {
      if (previousByKey.has(record.key)) throw new Error(`Skill 出现多个 previous：${record.key}`);
      previousByKey.add(record.key);
    }
  }
}

function validateRecord(value: unknown): InstalledSkillRecord {
  if (!value || typeof value !== "object") throw new Error("Skill registry record 不是对象");
  const record = value as Partial<InstalledSkillRecord>;
  const normalized = {
    ...record,
    signatureStatus: record.signatureStatus ?? "unsigned",
    reviewStatus: record.reviewStatus ?? "unreviewed",
    skillUpdatePolicy: record.skillUpdatePolicy ?? "manual"
  };
  const statuses: InstalledSkillStatus[] = ["quarantined", "installed-not-ready", "active", "previous"];
  const readiness: InstalledSkillReadiness[] = ["installed-not-ready", "ready", "blocked", "stale"];
  if (normalized.schemaVersion !== INSTALLED_SKILL_REGISTRY_SCHEMA_VERSION
    || !nonEmptyString(normalized.key) || !nonEmptyString(normalized.id)
    || !nonEmptyString(normalized.publisherId) || !nonEmptyString(normalized.version)
    || !nonEmptyString(normalized.digest) || !nonEmptyString(normalized.sourcePath)
    || !nonEmptyString(normalized.packagePath) || !statuses.includes(normalized.status as InstalledSkillStatus)
    || !readiness.includes(normalized.readiness as InstalledSkillReadiness)
    || !["unsigned", "valid", "invalid", "revoked"].includes(normalized.signatureStatus || "")
    || !["unreviewed", "automated-scan", "manually-reviewed"].includes(normalized.reviewStatus || "")
    || !["denied", "inspect-only", "approved-host"].includes(normalized.executionTrust || "")
    || !["manual", "download-only"].includes(normalized.skillUpdatePolicy || "")
    || !nonEmptyString(normalized.installedAt)) {
    throw new Error("Skill registry record schema mismatch");
  }
  if (normalized.sourceType !== undefined && !["directory", "zip", "git"].includes(normalized.sourceType)) {
    throw new Error("Skill registry source type mismatch");
  }
  if (normalized.sourceType === "git" && !nonEmptyString(normalized.sourceLocator)) {
    throw new Error("Git Skill registry source locator mismatch");
  }
  if (normalized.sourceLocator !== undefined && !nonEmptyString(normalized.sourceLocator)) {
    throw new Error("Skill registry source locator mismatch");
  }
  if (normalized.sourceRef !== undefined && !nonEmptyString(normalized.sourceRef)) {
    throw new Error("Skill registry source ref mismatch");
  }
  return normalized as InstalledSkillRecord;
}

function sameTrustState(left: InstalledSkillRecord, right: InstalledSkillRecord): boolean {
  return left.signatureStatus === right.signatureStatus
    && left.reviewStatus === right.reviewStatus
    && left.executionTrust === right.executionTrust;
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}
