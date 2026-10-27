import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { SKILL_LIBRARY_PUBLISHER, SKILL_LIBRARY_SOURCE } from "../../shared/skill-library-catalog";
import { isCctoolsSkillsSourceLocator } from "../../shared/skill-package-sources";
import { writeJsonAtomic } from "../lib/fs-utils";
import { isAppLibraryInstall, readSkillLibraryCatalog, resolveSkillLibraryBundleRoot } from "./skill-library-catalog";
import type { SkillPackageService } from "./skill-package-service";
import type { InstalledSkillRecord } from "./installed-skill-repository";
import { withRssLock } from "../rss/file-lock";
import { RunStore } from "../execution/run-store";

export function isManagedLegacyDefault(record: InstalledSkillRecord): boolean {
  return record.publisherId === "cctools" && record.sourceType === "git" && isCctoolsSkillsSourceLocator(record.sourceLocator || record.sourcePath);
}

/** Caller quiesces admitted tasks before replacing an existing package. */
export function installBuiltinDefault(packages: SkillPackageService, id: string, bundleRoot = resolveSkillLibraryBundleRoot(), retained: (key: string) => boolean = () => false): InstalledSkillRecord {
  if (!packages.appPaths.skills) throw new Error("Select a content root before installing built-in packages.");
  return withRssLock(path.join(path.dirname(packages.appPaths.skills), "skill-data", "builtin-migration"), "install", () => install(packages, id, bundleRoot, retained));
}

function retainedInstall(packages: SkillPackageService, key: string): boolean {
  if (!packages.appPaths.skills) return false;
  const root = fs.realpathSync(path.resolve(packages.appPaths.skills, "../.."));
  const rootKey = crypto.createHash("sha256").update(root).digest("hex").slice(0, 24);
  const file = path.join(packages.appPaths.catalog, rootKey, "user-installations.json");
  return fs.existsSync(file) && JSON.parse(fs.readFileSync(file, "utf8")).includes(key);
}

function assertInactive(packages: SkillPackageService, id: string): void {
  const active = new RunStore(packages.appPaths.runs).list().some(run => run.request.skillId === id && !run.terminalState && [run.ownerPid, run.processPid].some(pid => { if (!pid) return false; try { process.kill(pid, 0); return true; } catch (error) { return (error as NodeJS.ErrnoException).code !== "ESRCH"; } }));
  if (active) throw new Error(`Wait for active tasks before updating ${id}.`);
}

function install(packages: SkillPackageService, id: string, bundleRoot: string, retained: (key: string) => boolean): InstalledSkillRecord {
  const rootKey = crypto.createHash("sha256").update(packages.appPaths.skills || "").digest("hex").slice(0, 24);
  const file = path.join(packages.appPaths.migrations, `builtin-skills-${rootKey}.json`);
  const journal = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : { schemaVersion: 1, packages: {} };
  const entry = readSkillLibraryCatalog(bundleRoot).skills.find(row => row.id === id && row.packageDirectory);
  if (!entry) throw new Error(`Unknown built-in package: ${id}`);
  const source = path.join(bundleRoot, id);
  const expected = JSON.parse(fs.readFileSync(path.join(bundleRoot, "bundle.json"), "utf8")).packages[id];
  const inspection = packages.inspect(source);
  if (!inspection.valid || inspection.digest !== expected || inspection.manifest?.publisher.id !== SKILL_LIBRARY_PUBLISHER) throw new Error(`Invalid built-in package: ${id}`);
  const previous = packages.getInstalledById(id);
  const wasEnabled = !previous || packages.isEnabled(previous);
  if (previous) {
    if (!isAppLibraryInstall(previous) && (!isManagedLegacyDefault(previous) || retained(previous.key) || retainedInstall(packages, previous.key))) throw new Error(`Skill source conflict: ${id}. Resolve the imported copy in Skill settings.`);
    if (!packages.inspectInstalledCopy(previous).valid) throw new Error(`Locally modified Skill must be resolved before migration: ${id}`);
    if (previous.digest === expected && isAppLibraryInstall(previous)) {
      if (journal.packages[id]?.status === "pending") {
        packages.setEnabled(previous.key, previous.digest, journal.packages[id].enabled);
        journal.packages[id] = { ...journal.packages[id], status: "complete", to: previous.key, migratedAt: new Date().toISOString() };
        writeJsonAtomic(file, journal);
      }
      return previous;
    }
    assertInactive(packages, id);
  }
  const legacy = previous && !isAppLibraryInstall(previous) ? { key: previous.key, digest: previous.digest } : undefined;
  journal.packages[id] = { from: journal.packages[id]?.from || previous?.key || null, digest: expected, enabled: wasEnabled, status: "pending" };
  writeJsonAtomic(file, journal);
  const record = packages.install(source, { sourceType: "builtin", sourceLocator: SKILL_LIBRARY_SOURCE, sourcePackageRef: id }, legacy);
  if (!wasEnabled) packages.setEnabled(record.key, record.digest, false);
  journal.packages[id] = { ...journal.packages[id], status: "complete", to: record.key, migratedAt: new Date().toISOString() };
  writeJsonAtomic(file, journal);
  return record;
}

export function removeManagedWikiGenerator(packages: SkillPackageService, retained: (key: string) => boolean): void {
  for (const record of packages.listInstalled()) {
    if (record.id !== "knowledge-wiki-compiler" || !isManagedLegacyDefault(record) || retained(record.key) || retainedInstall(packages, record.key) || !packages.inspectInstalledCopy(record).valid) continue;
    assertInactive(packages, record.id);
    packages.uninstall(record.key, record.digest);
  }
}
