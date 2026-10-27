import path from "node:path";
import { ALL_SKILL_IDS } from "../../shared/skill-compatibility-matrix";
import { RssRepository } from "../rss/rss-repository";
import { readRssCatalog } from "../rss/rss-service";
import { writeJsonAtomic } from "../lib/fs-utils";
import { computeRootId } from "../paths/openmind-path-resolver";
import { installBuiltinDefault, isManagedLegacyDefault, removeManagedWikiGenerator } from "./builtin-default-packages";
import { isAppLibraryInstall, resolveSkillLibraryBundleRoot } from "./skill-library-catalog";
import { SkillLibraryService } from "./skill-library-service";
import type { SkillPackageService } from "./skill-package-service";

/** Runs before Worker admission. Idempotent; conflicts preserve the old copy. */
export function migrateBuiltinPackages(root: string, packages: SkillPackageService, bundle = resolveSkillLibraryBundleRoot()): string[] {
  const candidates = packages.listInstalled().filter(record => isManagedLegacyDefault(record) || isAppLibraryInstall(record) && ALL_SKILL_IDS.includes(record.id as never));
  if (!candidates.length) return [];
  const library = new SkillLibraryService(root, packages.appPaths, packages, bundle);
  const retained = (key: string) => library.isUserRetained(key);
  const warnings: string[] = [];
  let rssReady = true;
  if (candidates.some(record => record.id === "rss-article-saver")) {
    try { new RssRepository(root, readRssCatalog(bundle), [path.join(packages.appPaths.state, computeRootId(root), ".openmind")]).read(); }
    catch (error) { rssReady = false; warnings.push(String(error)); }
  }
  for (const record of candidates) {
    if (record.id === "knowledge-wiki-compiler" || !ALL_SKILL_IDS.includes(record.id as never) || record.id === "rss-article-saver" && !rssReady) continue;
    try { installBuiltinDefault(packages, record.id, bundle, retained); }
    catch (error) { warnings.push(`${record.id}: ${error instanceof Error ? error.message : String(error)}`); }
  }
  try { removeManagedWikiGenerator(packages, retained); } catch (error) { warnings.push(String(error)); }
  writeJsonAtomic(path.join(packages.appPaths.migrations, `builtin-status-${computeRootId(root)}.json`), { schemaVersion: 1, checkedAt: new Date().toISOString(), warnings });
  return warnings;
}
