import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { buildAppPaths, ensureAppPaths } from "../paths/app-paths-service";
import { SkillPackageService } from "./skill-package-service";
import { InstalledSkillExecutionResolver } from "./installed-skill-execution-resolver";
import { RuntimeManager } from "../runtime/runtime-manager";
import { AutomationRepository } from "../automation/automation-repository";
import { DEFAULT_AUTOMATION_RULES } from "../../shared/automation-defaults";
import { isRetiredBuiltinCandidate, RETIRED_SKILL_REASON } from "../../shared/retired-skills";
import { migrateBuiltinPackages } from "./builtin-package-migration";
import { SkillLibraryService } from "./skill-library-service";
import type { AiSessionSkillSnapshotEntry } from "../../shared/contracts";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });
function fixture(sourceType: "builtin" | "directory" = "builtin") {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "openmind-retired-skill-")); roots.push(root);
  const content = path.join(root, "content"); fs.mkdirSync(content);
  const paths = buildAppPaths(path.join(root, "state"), path.join(content, ".agent", "skills")); ensureAppPaths(paths);
  const source = path.join(root, "source");
  fs.cpSync(path.resolve(__dirname, "../../.build/skill-library/daily-topic-selector"), source, { recursive: true });
  const manifestFile = path.join(source, "openmind.skill.yaml");
  const manifest = JSON.parse(fs.readFileSync(manifestFile, "utf8"));
  manifest.id = "daily-writing-orchestrator";
  fs.writeFileSync(manifestFile, JSON.stringify(manifest));
  fs.writeFileSync(path.join(source, "SKILL.md"), "---\nname: daily-writing-orchestrator\ndescription: Retired package fixture\n---\n\nPreserved instructions.\n");
  const packages = new SkillPackageService(paths);
  const record = packages.install(source, { sourceType, sourceLocator: sourceType === "builtin" ? "openmind:skill-library" : source, sourcePackageRef: manifest.id });
  const resolver = new InstalledSkillExecutionResolver(packages, new RuntimeManager(paths), content, 1);
  return { root, content, paths, packages, record, resolver };
}
describe("retired writing packages", () => {
  it("blocks new catalog/admission and re-enablement without deleting bytes or invalidating admitted work", () => {
    const { packages, record, resolver } = fixture();
    expect(packages.isRetired(record)).toBe(true);
    expect(packages.isEnabled(record)).toBe(false);
    expect(packages.listInstalledViews()).toEqual([]);
    expect(packages.listInstalledRunnableViews()).toEqual([]);
    expect(resolver.captureSessionSnapshot(true)).toEqual([]);
    expect(() => resolver.assertBrokerRunnable({ skillId: record.id })).toThrow();
    expect(() => packages.setEnabled(record.key, record.digest, true)).toThrow(RETIRED_SKILL_REASON);
    expect(() => resolver.assertAdmittedBrokerRunnable({ skillId: record.id, version: record.version, digest: record.digest })).not.toThrow();
    expect(fs.existsSync(path.join(record.packagePath, "SKILL.md"))).toBe(true);
  });
  it("preserves a user-imported package with the same retired id", () => {
    const { packages, record, resolver } = fixture("directory");
    expect(packages.isRetired(record)).toBe(false);
    expect(packages.isEnabled(record)).toBe(true);
    expect(resolver.captureSessionSnapshot().map(entry => entry.definition.id)).toContain(record.id);
  });
  it("preserves explicitly retained copies", () => {
    const { content, paths, packages, record } = fixture();
    const key = crypto.createHash("sha256").update(fs.realpathSync(content)).digest("hex").slice(0, 24);
    const directory = path.join(paths.catalog, key); fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(path.join(directory, "user-installations.json"), JSON.stringify([record.key]));
    expect(packages.isRetired(record)).toBe(false);
    expect(packages.isEnabled(record)).toBe(true);
  });
  it("persists retirement across repeated startup without reinstalling packages or exposing old snapshots", () => {
    const { content, paths, packages, record, resolver } = fixture();
    const bundle = path.resolve(__dirname, "../../.build/skill-library");
    const bytes = fs.readFileSync(path.join(record.packagePath, "SKILL.md"));
    const snapshot = { definition: { id: record.id }, installed: { key: record.key, version: record.version, digest: record.digest } } as AiSessionSkillSnapshotEntry;
    expect(() => resolver.providerSkillBridge(snapshot)).toThrow(/退役/);
    migrateBuiltinPackages(content, packages, bundle);
    migrateBuiltinPackages(content, new SkillPackageService(paths), bundle);
    const reloaded = new SkillPackageService(paths);
    expect(reloaded.getInstalledById(record.id)).toEqual(record);
    expect(reloaded.isEnabled(record)).toBe(false);
    expect(fs.readFileSync(path.join(record.packagePath, "SKILL.md"))).toEqual(bytes);
    expect(new SkillLibraryService(content, paths, reloaded, bundle).list().map(entry => entry.skillId)).not.toContain(record.id);
    expect(JSON.parse(fs.readFileSync(path.join(paths.skills!, "skill-preferences.json"), "utf8"))).toBeTruthy();
  });
  it.each(["git", "directory", "zip"])("does not retire same-id %s imports", sourceType => {
    expect(isRetiredBuiltinCandidate({ id: "creative-writing", publisherId: "openmind-library", sourceType, sourceLocator: "openmind:skill-library", sourcePath: "C:/old/skill-library/creative-writing" })).toBe(false);
  });
  it("recognizes provenance of the first App bundle", () => {
    expect(isRetiredBuiltinCandidate({ id: "creative-writing", publisherId: "cctools", sourcePath: "C:\\app\\skill-library\\creative-writing" })).toBe(true);
  });
  it("disables only affected schedules, preserves history and does not reactivate on repeated migration", () => {
    const { paths, packages, record } = fixture();
    const repository = new AutomationRepository(paths);
    const template = DEFAULT_AUTOMATION_RULES.find(rule => rule.id === "daily-topic-generation")!;
    repository.saveRule({ ...template, enabled: true });
    const old = repository.saveRule({ ...template, id: "legacy-writing", enabled: true, target: { type: "skill", id: record.id, versionPolicy: "*" } });
    const history = repository.createRun({ ruleId: old.id, target: old.target, state: "succeeded", childRunId: "old-child", triggerReason: "manual", scheduledFor: null, createdAt: old.createdAt, completedAt: old.updatedAt, error: null });
    const retire = (id: string) => { const installed = packages.getInstalledById(id); return Boolean(installed && packages.isRetired(installed)); };
    repository.retireRules(retire, RETIRED_SKILL_REASON);
    const migrated = repository.getRule(old.id)!;
    expect(migrated).toMatchObject({ enabled: false, trigger: old.trigger, target: old.target });
    expect(migrated.description).toContain(RETIRED_SKILL_REASON);
    expect(repository.getRule(template.id)?.enabled).toBe(true);
    expect(repository.listRuns()).toEqual([history]);
    repository.retireRules(retire, RETIRED_SKILL_REASON);
    expect(repository.getRule(old.id)).toEqual(migrated);
  });
});
