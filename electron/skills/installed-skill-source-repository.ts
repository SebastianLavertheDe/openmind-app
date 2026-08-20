import fs from "node:fs";
import path from "node:path";
import { normalizeGitSourceLocator as normalizeSharedGitSourceLocator } from "../../shared/skill-package-sources";
import { writeJsonAtomic } from "../lib/fs-utils";

export const INSTALLED_SKILL_SOURCE_REGISTRY_SCHEMA_VERSION = 1 as const;

export type InstalledSkillSourcePackageSnapshot = {
  packageRef: string;
  key: string;
  id: string;
  version: string;
  digest: string;
};

/**
 * Receipt written only after every package discovered in one Git checkout was
 * installed successfully. It records the installed snapshot; it is not an
 * assertion that a remote repository has not changed since installation.
 */
export type InstalledSkillSourceReceipt = {
  schemaVersion: typeof INSTALLED_SKILL_SOURCE_REGISTRY_SCHEMA_VERSION;
  sourceType: "git";
  sourceLocator: string;
  sourceRef?: string;
  sourceRevision?: string;
  packages: InstalledSkillSourcePackageSnapshot[];
  installedAt: string;
};

type InstalledSkillSourceRegistryFile = {
  schemaVersion: typeof INSTALLED_SKILL_SOURCE_REGISTRY_SCHEMA_VERSION;
  installations: InstalledSkillSourceReceipt[];
};

type InstalledSkillSourceRegistryRead = {
  registry: InstalledSkillSourceRegistryFile;
  corrupt: boolean;
};

/**
 * Isolated source-level installation receipts. Corruption must never make the
 * Installed Skill registry unreadable: reads fail closed to an empty set, and
 * the next explicit complete installation replaces the damaged file through
 * an atomic write.
 */
export class InstalledSkillSourceRepository {
  readonly filePath: string | null;

  constructor(skillStoreRoot: string | null) {
    this.filePath = skillStoreRoot
      ? path.join(path.resolve(skillStoreRoot), "source-installations.json")
      : null;
  }

  list(): InstalledSkillSourceReceipt[] {
    return this.read().installations.map(cloneReceipt);
  }

  get(sourceLocator: string): InstalledSkillSourceReceipt | undefined {
    let normalized: string;
    try { normalized = normalizeGitSourceLocator(sourceLocator); }
    catch { return undefined; }
    const receipt = this.read().installations.find((candidate) => candidate.sourceLocator === normalized);
    return receipt ? cloneReceipt(receipt) : undefined;
  }

  /** Distinguishes an absent legacy receipt from a damaged receipt store. */
  isCorrupt(): boolean {
    return this.readResult().corrupt;
  }

  replace(receipt: InstalledSkillSourceReceipt): InstalledSkillSourceReceipt {
    if (!this.filePath) throw new Error("Skill 来源安装记录不可用：尚未绑定 mymind 根目录。");
    const normalized = validateReceipt({
      ...receipt,
      sourceLocator: normalizeGitSourceLocator(receipt.sourceLocator),
      packages: receipt.packages.slice().sort((left, right) => left.packageRef.localeCompare(right.packageRef))
    });
    const registry = this.read();
    const installations = registry.installations
      .filter((candidate) => candidate.sourceLocator !== normalized.sourceLocator);
    installations.push(normalized);
    installations.sort((left, right) => left.sourceLocator.localeCompare(right.sourceLocator));
    writeJsonAtomic(this.filePath, {
      schemaVersion: INSTALLED_SKILL_SOURCE_REGISTRY_SCHEMA_VERSION,
      installations
    } satisfies InstalledSkillSourceRegistryFile);
    return cloneReceipt(normalized);
  }

  private read(): InstalledSkillSourceRegistryFile {
    return this.readResult().registry;
  }

  private readResult(): InstalledSkillSourceRegistryRead {
    if (!this.filePath || !fs.existsSync(this.filePath)) return { registry: emptyRegistry(), corrupt: false };
    try {
      const parsed = JSON.parse(fs.readFileSync(this.filePath, "utf8")) as Partial<InstalledSkillSourceRegistryFile>;
      if (parsed.schemaVersion !== INSTALLED_SKILL_SOURCE_REGISTRY_SCHEMA_VERSION || !Array.isArray(parsed.installations)) {
        return { registry: emptyRegistry(), corrupt: true };
      }
      const installations = parsed.installations.map((receipt) => validateReceipt(receipt));
      const locators = new Set<string>();
      for (const receipt of installations) {
        if (locators.has(receipt.sourceLocator)) return { registry: emptyRegistry(), corrupt: true };
        locators.add(receipt.sourceLocator);
      }
      return {
        registry: { schemaVersion: INSTALLED_SKILL_SOURCE_REGISTRY_SCHEMA_VERSION, installations },
        corrupt: false
      };
    } catch {
      return { registry: emptyRegistry(), corrupt: true };
    }
  }
}

export function normalizeGitSourceLocator(value: string): string {
  const normalized = normalizeSharedGitSourceLocator(value);
  if (!normalized) throw new Error("Git 来源必须是不含凭据、参数或片段且带仓库路径的 HTTPS URL。");
  return normalized;
}

function validateReceipt(value: unknown): InstalledSkillSourceReceipt {
  if (!value || typeof value !== "object") throw new Error("Skill 来源安装记录不是对象。");
  const receipt = value as Partial<InstalledSkillSourceReceipt>;
  if (receipt.schemaVersion !== INSTALLED_SKILL_SOURCE_REGISTRY_SCHEMA_VERSION
    || receipt.sourceType !== "git"
    || typeof receipt.sourceLocator !== "string"
    || !nonEmptyString(receipt.installedAt)
    || !Array.isArray(receipt.packages)
    || receipt.packages.length === 0) {
    throw new Error("Skill 来源安装记录格式错误。");
  }
  const sourceLocator = normalizeGitSourceLocator(receipt.sourceLocator);
  if (receipt.sourceRef !== undefined
    && (!nonEmptyString(receipt.sourceRef)
      || receipt.sourceRef.length > 256
      || !/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(receipt.sourceRef))) {
    throw new Error("Skill 来源 ref 格式错误。");
  }
  if (receipt.sourceRevision !== undefined && !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i.test(receipt.sourceRevision)) {
    throw new Error("Skill 来源 revision 格式错误。");
  }

  const refs = new Set<string>();
  const keys = new Set<string>();
  const ids = new Set<string>();
  const packages = receipt.packages.map((entry) => validatePackageSnapshot(entry));
  for (const entry of packages) {
    if (refs.has(entry.packageRef) || keys.has(entry.key) || ids.has(entry.id)) {
      throw new Error("Skill 来源安装记录包含重复包。");
    }
    refs.add(entry.packageRef);
    keys.add(entry.key);
    ids.add(entry.id);
  }
  return {
    schemaVersion: INSTALLED_SKILL_SOURCE_REGISTRY_SCHEMA_VERSION,
    sourceType: "git",
    sourceLocator,
    ...(receipt.sourceRef ? { sourceRef: receipt.sourceRef } : {}),
    ...(receipt.sourceRevision ? { sourceRevision: receipt.sourceRevision.toLowerCase() } : {}),
    packages,
    installedAt: receipt.installedAt
  };
}

function validatePackageSnapshot(value: unknown): InstalledSkillSourcePackageSnapshot {
  if (!value || typeof value !== "object") throw new Error("Skill 来源包快照不是对象。");
  const snapshot = value as Partial<InstalledSkillSourcePackageSnapshot>;
  const digest = snapshot.digest;
  if (!nonEmptyString(snapshot.packageRef) || !safePackageRef(snapshot.packageRef)
    || !nonEmptyString(snapshot.key) || !nonEmptyString(snapshot.id)
    || !nonEmptyString(snapshot.version) || typeof digest !== "string" || !/^[a-f0-9]{64}$/i.test(digest)) {
    throw new Error("Skill 来源包快照格式错误。");
  }
  if (!snapshot.key.endsWith(`/${snapshot.id}`)) throw new Error("Skill 来源包身份不一致。");
  return {
    packageRef: snapshot.packageRef,
    key: snapshot.key,
    id: snapshot.id,
    version: snapshot.version,
    digest: digest.toLowerCase()
  };
}

function safePackageRef(value: string): boolean {
  if (value === ".") return true;
  if (value.includes("\\") || value.startsWith("/") || /[\u0000-\u001f\u007f]/.test(value)) return false;
  return value.split("/").every((segment) => segment.length > 0 && segment !== "." && segment !== "..");
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function emptyRegistry(): InstalledSkillSourceRegistryFile {
  return { schemaVersion: INSTALLED_SKILL_SOURCE_REGISTRY_SCHEMA_VERSION, installations: [] };
}

function cloneReceipt(receipt: InstalledSkillSourceReceipt): InstalledSkillSourceReceipt {
  return { ...receipt, packages: receipt.packages.map((entry) => ({ ...entry })) };
}
