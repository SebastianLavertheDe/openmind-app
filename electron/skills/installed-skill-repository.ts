import fs from "node:fs";
import { writeJsonAtomic } from "../lib/fs-utils";

/**
 * v3: one metadata record per installed skill. Runtime availability is
 * derived from the installed package and runtime inspection, so the old
 * persisted status/readiness state machine is no longer part of the registry.
 */
export const INSTALLED_SKILL_REGISTRY_SCHEMA_VERSION = 3 as const;

export type InstalledSkillSignatureStatus = "unsigned" | "valid" | "invalid" | "revoked";
export type InstalledSkillReviewStatus = "unreviewed" | "automated-scan" | "manually-reviewed";
export type InstalledSkillUpdatePolicy = "manual" | "download-only";
export type InstalledSkillSourceType = "directory" | "zip" | "git" | "builtin";

export type InstalledSkillRecord = {
  schemaVersion: typeof INSTALLED_SKILL_REGISTRY_SCHEMA_VERSION;
  key: string;
  id: string;
  publisherId: string;
  version: string;
  digest: string;
  sourcePath: string;
  /** Source metadata is optional for registry backward compatibility. */
  sourceType?: InstalledSkillSourceType;
  sourceLocator?: string;
  sourceRef?: string;
  /** Repository-relative package identity and resolved revision, when known. */
  sourcePackageRef?: string;
  sourceRevision?: string;
  packagePath: string;
  signatureStatus: InstalledSkillSignatureStatus;
  reviewStatus: InstalledSkillReviewStatus;
  skillUpdatePolicy: InstalledSkillUpdatePolicy;
  installedAt: string;
};

export type InstalledSkillRegistryFile = {
  schemaVersion: typeof INSTALLED_SKILL_REGISTRY_SCHEMA_VERSION;
  records: InstalledSkillRecord[];
};

type LegacyInstalledSkillStatus = "quarantined" | "installed-not-ready" | "active" | "previous";
type LegacyInstalledSkillReadiness = "installed-not-ready" | "ready" | "blocked" | "stale";
type LegacyInstalledSkillRecord = Omit<InstalledSkillRecord, "schemaVersion"> & {
  schemaVersion: 1 | 2;
  status: LegacyInstalledSkillStatus;
  readiness: LegacyInstalledSkillReadiness;
};

const SIGNATURE_STATUSES = ["unsigned", "valid", "invalid", "revoked"] as const;
const REVIEW_STATUSES = ["unreviewed", "automated-scan", "manually-reviewed"] as const;
const UPDATE_POLICIES = ["manual", "download-only"] as const;
const SOURCE_TYPES = ["directory", "zip", "git", "builtin"] as const;
const V1_STATUSES = ["quarantined", "installed-not-ready", "active", "previous"] as const;
const V2_STATUSES = ["quarantined", "active"] as const;
const LEGACY_READINESS = ["installed-not-ready", "ready", "blocked", "stale"] as const;

/**
 * Owns only installed-skill metadata, one record per key. Package bytes are
 * managed by SkillPackageService; legacy package paths are preserved during
 * metadata migration and remain valid until a later reinstall replaces them.
 */
export class InstalledSkillRepository {
  /**
   * @param registryFile null when no openmind root is bound: reads report an
   * empty store; writes fail fast as an internal invariant.
   */
  constructor(private readonly registryFile: string | null) {}

  list(): InstalledSkillRecord[] {
    return this.read().records.slice().sort((left, right) => left.key.localeCompare(right.key));
  }

  get(key: string, digest?: string): InstalledSkillRecord | undefined {
    return this.read().records.find((record) => record.key === key && (!digest || record.digest === digest));
  }

  /** Idempotent for the same key; a new digest replaces the previous record. */
  upsert(record: InstalledSkillRecord): InstalledSkillRecord {
    const canonical = validateCurrentRecord(record);
    const registry = this.read();
    registry.records = registry.records.filter((candidate) => candidate.key !== canonical.key);
    registry.records.push(canonical);
    this.write(registry);
    return canonical;
  }

  /** Replace an explicitly named compatibility identity for the same Skill id. */
  replaceIdentity(previousKey: string, record: InstalledSkillRecord): InstalledSkillRecord {
    const canonical = validateCurrentRecord(record);
    const registry = this.read();
    const previous = registry.records.find((candidate) => candidate.key === previousKey);
    if (!previous || previous.id !== canonical.id || previous.key === canonical.key) {
      throw new Error(`Skill identity migration mismatch：${previousKey} → ${canonical.key}`);
    }
    registry.records = registry.records.filter((candidate) =>
      candidate.key !== previousKey && candidate.key !== canonical.key
    );
    registry.records.push(canonical);
    this.write(registry);
    return canonical;
  }

  remove(key: string, digest?: string): InstalledSkillRecord | undefined {
    const registry = this.read();
    const target = registry.records.find((record) => record.key === key && (!digest || record.digest === digest));
    if (!target) return undefined;
    registry.records = registry.records.filter((record) => record !== target);
    this.write(registry);
    return target;
  }

  private read(): InstalledSkillRegistryFile {
    try {
      if (this.registryFile === null || !fs.existsSync(this.registryFile)) {
        return { schemaVersion: INSTALLED_SKILL_REGISTRY_SCHEMA_VERSION, records: [] };
      }
      const parsed = JSON.parse(fs.readFileSync(this.registryFile, "utf8")) as { schemaVersion?: number; records?: unknown };
      if (!Array.isArray(parsed.records)) throw new Error("Skill registry schema mismatch");
      if (parsed.schemaVersion === 1 || parsed.schemaVersion === 2) {
        const migrated = migrateLegacyRegistry(parsed.schemaVersion, parsed.records);
        // A successful schema migration is durable immediately. Invalid legacy
        // input never reaches this write and therefore remains untouched.
        this.write(migrated);
        return migrated;
      }
      if (parsed.schemaVersion !== INSTALLED_SKILL_REGISTRY_SCHEMA_VERSION) {
        throw new Error("Skill registry schema mismatch");
      }
      return validateCurrentRegistry({
        schemaVersion: INSTALLED_SKILL_REGISTRY_SCHEMA_VERSION,
        records: parsed.records
      });
    } catch (error) {
      throw new Error(`Skill registry 无法读取，拒绝覆盖现有安装状态：${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private write(registry: InstalledSkillRegistryFile): void {
    if (this.registryFile === null) {
      throw new Error("Skill store 不可用：尚未绑定 openmind 根目录（内部不变量，正常流程不应到达）。");
    }
    writeJsonAtomic(this.registryFile, validateCurrentRegistry(registry));
  }
}

function migrateLegacyRegistry(schemaVersion: 1 | 2, rawRecords: unknown[]): InstalledSkillRegistryFile {
  const records = rawRecords.map((record) => validateLegacyRecord(record, schemaVersion));
  validateLegacyRegistry(records, schemaVersion);

  const selected = new Map<string, LegacyInstalledSkillRecord>();
  for (const candidate of records) {
    const current = selected.get(candidate.key);
    if (!current || preferLegacyRecord(candidate, current)) selected.set(candidate.key, candidate);
  }

  return validateCurrentRegistry({
    schemaVersion: INSTALLED_SKILL_REGISTRY_SCHEMA_VERSION,
    records: [...selected.values()]
      .map(projectCurrentRecord)
      .sort((left, right) => left.key.localeCompare(right.key))
  });
}

/** Active preserves the user's selected v1 version; otherwise latest install wins. */
function preferLegacyRecord(candidate: LegacyInstalledSkillRecord, current: LegacyInstalledSkillRecord): boolean {
  if ((candidate.status === "active") !== (current.status === "active")) return candidate.status === "active";
  const installedAt = candidate.installedAt.localeCompare(current.installedAt);
  if (installedAt !== 0) return installedAt > 0;
  const digest = candidate.digest.localeCompare(current.digest);
  if (digest !== 0) return digest > 0;
  const packagePath = candidate.packagePath.localeCompare(current.packagePath);
  if (packagePath !== 0) return packagePath > 0;
  return legacyStableKey(candidate).localeCompare(legacyStableKey(current)) > 0;
}

function legacyStableKey(record: LegacyInstalledSkillRecord): string {
  return [
    record.version,
    record.sourcePath,
    record.sourceType || "",
    record.sourceLocator || "",
    record.sourceRef || "",
    record.sourcePackageRef || "",
    record.sourceRevision || "",
    record.signatureStatus,
    record.reviewStatus,
    record.skillUpdatePolicy,
    record.status,
    record.readiness
  ].join("\u0000");
}

function validateLegacyRegistry(records: LegacyInstalledSkillRecord[], schemaVersion: 1 | 2): void {
  const activeByKey = new Set<string>();
  const previousByKey = new Set<string>();
  const keySeen = new Set<string>();
  for (const record of records) {
    if (record.status === "active") {
      if (record.readiness !== "ready") throw new Error("active Skill 必须是 ready");
      if (activeByKey.has(record.key)) throw new Error(`Skill 出现多个 active：${record.key}`);
      activeByKey.add(record.key);
    }
    if (schemaVersion === 1 && record.status === "previous") {
      if (previousByKey.has(record.key)) throw new Error(`Skill 出现多个 previous：${record.key}`);
      previousByKey.add(record.key);
    }
    if (schemaVersion === 2) {
      if (keySeen.has(record.key)) throw new Error(`Skill 出现多个记录：${record.key}`);
      keySeen.add(record.key);
    }
  }
}

function validateCurrentRegistry(value: { schemaVersion: number; records: unknown[] }): InstalledSkillRegistryFile {
  if (value.schemaVersion !== INSTALLED_SKILL_REGISTRY_SCHEMA_VERSION) {
    throw new Error("Skill registry schema mismatch");
  }
  const records = value.records.map(validateCurrentRecord);
  const keySeen = new Set<string>();
  const idSeen = new Set<string>();
  for (const record of records) {
    if (keySeen.has(record.key)) throw new Error(`Skill 出现多个记录：${record.key}`);
    if (idSeen.has(record.id)) throw new Error(`Skill id 出现多个发布者记录：${record.id}`);
    keySeen.add(record.key);
    idSeen.add(record.id);
  }
  return { schemaVersion: INSTALLED_SKILL_REGISTRY_SCHEMA_VERSION, records };
}

function validateCurrentRecord(value: unknown): InstalledSkillRecord {
  const raw = objectRecord(value);
  if (raw.schemaVersion !== INSTALLED_SKILL_REGISTRY_SCHEMA_VERSION) {
    throw new Error("Skill registry record schema mismatch");
  }
  return projectCurrentRecord(validateCommonRecord(raw));
}

function validateLegacyRecord(value: unknown, schemaVersion: 1 | 2): LegacyInstalledSkillRecord {
  const raw = objectRecord(value);
  if (raw.schemaVersion !== schemaVersion) throw new Error("Skill registry record schema mismatch");
  const allowedStatuses = schemaVersion === 1 ? V1_STATUSES : V2_STATUSES;
  if (!includes(allowedStatuses, raw.status) || !includes(LEGACY_READINESS, raw.readiness)) {
    throw new Error("Skill registry record schema mismatch");
  }
  return {
    ...validateCommonRecord(raw),
    schemaVersion,
    status: raw.status,
    readiness: raw.readiness
  };
}

function validateCommonRecord(raw: Record<string, unknown>): Omit<InstalledSkillRecord, "schemaVersion"> {
  const signatureStatus = raw.signatureStatus ?? "unsigned";
  const reviewStatus = raw.reviewStatus ?? "unreviewed";
  const skillUpdatePolicy = raw.skillUpdatePolicy ?? "manual";
  const sourceType = raw.sourceType;
  const sourceLocator = optionalNonEmptyString("sourceLocator", raw.sourceLocator);
  const sourceRef = optionalNonEmptyString("sourceRef", raw.sourceRef);
  const sourcePackageRef = optionalNonEmptyString("sourcePackageRef", raw.sourcePackageRef);
  const sourceRevision = optionalNonEmptyString("sourceRevision", raw.sourceRevision);
  if (!nonEmptyString(raw.key) || !nonEmptyString(raw.id)
    || !nonEmptyString(raw.publisherId) || !nonEmptyString(raw.version)
    || !nonEmptyString(raw.digest) || !nonEmptyString(raw.sourcePath)
    || !nonEmptyString(raw.packagePath) || !nonEmptyString(raw.installedAt)
    || !includes(SIGNATURE_STATUSES, signatureStatus)
    || !includes(REVIEW_STATUSES, reviewStatus)
    || !includes(UPDATE_POLICIES, skillUpdatePolicy)) {
    throw new Error("Skill registry record schema mismatch");
  }
  if (sourceType !== undefined && !includes(SOURCE_TYPES, sourceType)) {
    throw new Error("Skill registry source type mismatch");
  }
  if (sourceType === "git" && sourceLocator === undefined) {
    throw new Error("Git Skill registry source locator mismatch");
  }

  return {
    key: raw.key,
    id: raw.id,
    publisherId: raw.publisherId,
    version: raw.version,
    digest: raw.digest,
    sourcePath: raw.sourcePath,
    ...(sourceType === undefined ? {} : { sourceType }),
    ...(sourceLocator === undefined ? {} : { sourceLocator }),
    ...(sourceRef === undefined ? {} : { sourceRef }),
    ...(sourcePackageRef === undefined ? {} : { sourcePackageRef }),
    ...(sourceRevision === undefined ? {} : { sourceRevision }),
    packagePath: raw.packagePath,
    signatureStatus,
    reviewStatus,
    skillUpdatePolicy,
    installedAt: raw.installedAt
  };
}

function projectCurrentRecord(record: Omit<InstalledSkillRecord, "schemaVersion">): InstalledSkillRecord;
function projectCurrentRecord(record: LegacyInstalledSkillRecord): InstalledSkillRecord;
function projectCurrentRecord(record: Omit<InstalledSkillRecord, "schemaVersion"> | LegacyInstalledSkillRecord): InstalledSkillRecord {
  return {
    schemaVersion: INSTALLED_SKILL_REGISTRY_SCHEMA_VERSION,
    key: record.key,
    id: record.id,
    publisherId: record.publisherId,
    version: record.version,
    digest: record.digest,
    sourcePath: record.sourcePath,
    ...(record.sourceType === undefined ? {} : { sourceType: record.sourceType }),
    ...(record.sourceLocator === undefined ? {} : { sourceLocator: record.sourceLocator }),
    ...(record.sourceRef === undefined ? {} : { sourceRef: record.sourceRef }),
    ...(record.sourcePackageRef === undefined ? {} : { sourcePackageRef: record.sourcePackageRef }),
    ...(record.sourceRevision === undefined ? {} : { sourceRevision: record.sourceRevision }),
    packagePath: record.packagePath,
    signatureStatus: record.signatureStatus,
    reviewStatus: record.reviewStatus,
    skillUpdatePolicy: record.skillUpdatePolicy,
    installedAt: record.installedAt
  };
}

function objectRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Skill registry record 不是对象");
  }
  return value as Record<string, unknown>;
}

function includes<const T extends readonly string[]>(values: T, value: unknown): value is T[number] {
  return typeof value === "string" && (values as readonly string[]).includes(value);
}

function optionalNonEmptyString(field: string, value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (nonEmptyString(value)) return value;
  throw new Error(`Skill registry ${field} mismatch`);
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}
