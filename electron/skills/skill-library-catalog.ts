import { app } from "electron";
import fs from "node:fs";
import path from "node:path";
import { SKILL_LIBRARY_CATALOG_FILE, SKILL_LIBRARY_PUBLISHER, SKILL_LIBRARY_SOURCE, SkillLibraryCatalogSchema, type SkillLibraryCatalog } from "../../shared/skill-library-catalog";
import { messages } from "../../shared/messages";
import type { InstalledSkillRecord } from "./installed-skill-repository";

type LibraryRecord = Pick<InstalledSkillRecord, "id" | "publisherId" | "sourceType" | "sourcePath" | "sourceLocator">;

/** Compatibility for the first App bundle; Git imports must never match. */
export function isLegacyAppLibraryInstall(record: LibraryRecord): boolean {
  return record.publisherId === "cctools" && record.sourceType === undefined
    && record.sourcePath.replace(/\\/g, "/").endsWith(`/skill-library/${record.id}`);
}

export function isAppLibraryInstall(record: LibraryRecord): boolean {
  return record.sourceType === "builtin" && record.publisherId === SKILL_LIBRARY_PUBLISHER && record.sourceLocator === SKILL_LIBRARY_SOURCE
    || isLegacyAppLibraryInstall(record);
}

export function resolveSkillLibraryBundleRoot(): string {
  return process.env.OPENMIND_SKILL_LIBRARY_BUNDLE || (app?.isPackaged
    ? path.join(process.resourcesPath, "skill-library")
    : path.resolve(__dirname, "../../../skill-library"));
}

/** Read on demand so catalog changes do not require recompiling application code. */
export function readSkillLibraryCatalog(bundleRoot = resolveSkillLibraryBundleRoot()): SkillLibraryCatalog {
  const file = path.join(bundleRoot, SKILL_LIBRARY_CATALOG_FILE);
  try {
    return SkillLibraryCatalogSchema.parse(JSON.parse(fs.readFileSync(file, "utf8")));
  } catch (cause) {
    throw new Error(`${messages.skillLibrary.errors.catalog} (${file}): ${cause instanceof Error ? cause.message : String(cause)}`, { cause });
  }
}
