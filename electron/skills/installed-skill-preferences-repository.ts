import fs from "node:fs";
import path from "node:path";
import { writeJsonAtomic } from "../lib/fs-utils";

export const INSTALLED_SKILL_PREFERENCES_SCHEMA_VERSION = 1 as const;

export type InstalledSkillPreferencesFile = {
  schemaVersion: typeof INSTALLED_SKILL_PREFERENCES_SCHEMA_VERSION;
  /** Logical publisher/id keys disabled by the user. Missing keys are enabled. */
  disabledKeys: string[];
};

const SKILL_KEY_RE = /^[a-z][a-z0-9-._]*\/[a-z][a-z0-9-._]*$/;
const MAX_SKILL_KEY_LENGTH = 257;

/**
 * User enablement is intentionally separate from installed package metadata.
 * Installation receipts, package integrity and the startup gate must therefore
 * never depend on this file. Only Main writes it; readers always re-read the
 * atomically replaced file so another process can observe the next snapshot.
 */
export class InstalledSkillPreferencesRepository {
  readonly filePath: string | null;

  constructor(skillStoreRoot: string | null) {
    this.filePath = skillStoreRoot
      ? path.join(path.resolve(skillStoreRoot), "skill-preferences.json")
      : null;
  }

  isEnabled(key: string): boolean {
    const canonicalKey = validateSkillKey(key);
    const disabled = new Set(this.read().disabledKeys);
    return preferenceKeys(canonicalKey).every((candidate) => !disabled.has(candidate));
  }

  listDisabledKeys(): string[] {
    return this.read().disabledKeys.slice();
  }

  setEnabled(key: string, enabled: boolean): void {
    const canonicalKey = validateSkillKey(key);
    if (typeof enabled !== "boolean") throw new Error("Skill enabled 必须是 boolean。");
    if (!this.filePath) throw new Error("Skill 偏好不可用：尚未绑定 openmind 根目录。");

    const current = this.read();
    const disabled = new Set(current.disabledKeys);
    const compatibleKeys = preferenceKeys(canonicalKey);
    const before = [...disabled].sort().join("\0");
    for (const candidate of compatibleKeys) disabled.delete(candidate);
    if (!enabled) disabled.add(canonicalKey);
    const changed = before !== [...disabled].sort().join("\0");
    if (!changed) return;

    writeJsonAtomic(this.filePath, validatePreferences({
      schemaVersion: INSTALLED_SKILL_PREFERENCES_SCHEMA_VERSION,
      disabledKeys: [...disabled].sort((left, right) => left.localeCompare(right))
    }));
  }

  private read(): InstalledSkillPreferencesFile {
    try {
      if (!this.filePath || !fs.existsSync(this.filePath)) return emptyPreferences();
      return validatePreferences(JSON.parse(fs.readFileSync(this.filePath, "utf8")));
    } catch (error) {
      throw new Error(`Skill 偏好无法读取，拒绝覆盖现有配置：${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

/** cctools/* supersedes the official openmind/* identity without re-enabling it. */
function preferenceKeys(key: string): string[] {
  if (!key.startsWith("cctools/")) return [key];
  return [key, `openmind/${key.slice("cctools/".length)}`];
}

function emptyPreferences(): InstalledSkillPreferencesFile {
  return { schemaVersion: INSTALLED_SKILL_PREFERENCES_SCHEMA_VERSION, disabledKeys: [] };
}

function validatePreferences(value: unknown): InstalledSkillPreferencesFile {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Skill 偏好不是对象。");
  }
  const raw = value as Partial<InstalledSkillPreferencesFile>;
  if (raw.schemaVersion !== INSTALLED_SKILL_PREFERENCES_SCHEMA_VERSION || !Array.isArray(raw.disabledKeys)) {
    throw new Error("Skill 偏好 schema mismatch。");
  }
  const disabledKeys = raw.disabledKeys.map(validateSkillKey);
  if (new Set(disabledKeys).size !== disabledKeys.length) throw new Error("Skill 偏好包含重复 key。");
  return {
    schemaVersion: INSTALLED_SKILL_PREFERENCES_SCHEMA_VERSION,
    disabledKeys: disabledKeys.slice().sort((left, right) => left.localeCompare(right))
  };
}

function validateSkillKey(value: unknown): string {
  if (typeof value !== "string" || value.length > MAX_SKILL_KEY_LENGTH || !SKILL_KEY_RE.test(value)) {
    throw new Error("Skill 偏好 key 格式错误。");
  }
  return value;
}
