import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { buildAppPaths, ensureAppPaths } from "../paths/app-paths-service";
import { SkillPackageService } from "./skill-package-service";
import { InstalledSkillExecutionResolver } from "./installed-skill-execution-resolver";
import { RuntimeManager } from "../runtime/runtime-manager";
import { AutomationRepository } from "../automation/automation-repository";
import { AutomationScheduler } from "../automation/automation-scheduler";
import { DEFAULT_AUTOMATION_RULES } from "../../shared/automation-defaults";
import { isRetiredBuiltinCandidate, RETIRED_SKILL_REASON } from "../../shared/retired-skills";
import { migrateBuiltinPackages } from "./builtin-package-migration";
import { SkillLibraryService } from "./skill-library-service";
import type { AiSessionSkillSnapshotEntry } from "../../shared/contracts";
import { createExplicitContentSource } from "../product/content-source";
import { ContentIndexStore } from "../product/content-index";
import { OpenmindFileSearchEngine } from "../openmind-file-search-engine";
import { prepareSkillLibraryBundle } from "./skill-library-bundle";
import { BUILTIN_SKILL_IDS } from "../../shared/skill-registry";

const roots: string[] = [];
let fixtureRoot = "";
let builtinBundle = "";
let remoteFixtures = "";
beforeAll(() => {
  fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "openmind-retirement-packages-"));
  builtinBundle = path.join(fixtureRoot, "builtin");
  remoteFixtures = path.join(fixtureRoot, "remote");
  const config = path.resolve(__dirname, "../../config/skill-library");
  prepareSkillLibraryBundle(config, builtinBundle, { includeIds: BUILTIN_SKILL_IDS });
  prepareSkillLibraryBundle(config, remoteFixtures, { includeIds: ["agent-browser"] });
});
afterAll(() => { if (fixtureRoot) fs.rmSync(fixtureRoot, { recursive: true, force: true }); });
const retiredFixtureIds = [
  "daily-writing-orchestrator", "skill-run-reporter", "video-burnin-subtitles",
  "om-image-editor", "om-slide-outline", "om-slide-deck",
  "om-storyboard", "om-short-video", "om-landing-page", "om-mini-tool",
  "om-research-brief", "om-source-compare", "om-article-writer", "om-text-rewriter"
];
afterEach(() => { vi.restoreAllMocks(); for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });
function fixture(sourceType: "builtin" | "directory" | "git" | "catalog" = "builtin", skillId = "daily-writing-orchestrator") {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "openmind-retired-skill-")); roots.push(root);
  const content = path.join(root, "content"); fs.mkdirSync(content);
  const paths = buildAppPaths(path.join(root, "state"), path.join(content, ".agent", "skills")); ensureAppPaths(paths);
  const source = path.join(root, "source");
  const template = skillId.startsWith("om-") ? "agent-browser" : "daily-topic-selector";
  fs.cpSync(path.join(skillId.startsWith("om-") ? remoteFixtures : builtinBundle, template), source, { recursive: true });
  const manifestFile = path.join(source, "openmind.skill.yaml");
  const manifest = JSON.parse(fs.readFileSync(manifestFile, "utf8"));
  manifest.id = skillId;
  fs.writeFileSync(manifestFile, JSON.stringify(manifest));
  fs.writeFileSync(path.join(source, "SKILL.md"), `---\nname: ${skillId}\ndescription: Retired package fixture\n---\n\nPreserved instructions.\n`);
  const packages = new SkillPackageService(paths);
  const record = packages.install(source, { sourceType, sourceLocator: sourceType === "builtin" ? "openmind:skill-library" : source, sourcePackageRef: manifest.id });
  const resolver = new InstalledSkillExecutionResolver(packages, new RuntimeManager(paths), content, 1);
  return { root, content, paths, source, packages, record, resolver, kind: manifest.kind };
}
function installWorkflow(root: string, packages: SkillPackageService, dependency: string) {
  const source = path.join(root, "workflow-source");
  fs.cpSync(path.join(builtinBundle, "rss-to-summary-workflow"), source, { recursive: true });
  const file = path.join(source, "openmind.skill.yaml");
  const manifest = JSON.parse(fs.readFileSync(file, "utf8"));
  manifest.id = "user-writing-workflow";
  manifest.workflow.steps = [{ id: "write", skill: dependency, version: "*", with: { date: "{{ inputs.date }}" } }];
  fs.writeFileSync(file, JSON.stringify(manifest));
  const workflow = packages.install(source, { sourceType: "directory", sourceLocator: source });
  return { source, file, manifest, workflow };
}
describe("retired built-in packages", () => {
  it.each(["om-research-brief", "om-source-compare", "om-article-writer", "om-text-rewriter"])("also retires previously installed app catalog presets: %s", skillId => {
    const { packages, record, resolver } = fixture("catalog", skillId);
    expect(packages.isRetired(record)).toBe(true);
    expect(packages.listInstalledViews()).toEqual([]);
    expect(resolver.captureSessionSnapshot()).toEqual([]);
    expect(() => packages.setEnabled(record.key, record.digest, true)).toThrow(RETIRED_SKILL_REASON);
  });
  it.each(retiredFixtureIds)("blocks new catalog/admission and re-enablement without deleting bytes or invalidating admitted work: %s", skillId => {
    const { packages, record, resolver, kind } = fixture("builtin", skillId);
    expect(packages.isRetired(record)).toBe(true);
    expect(packages.isEnabled(record)).toBe(false);
    expect(packages.listInstalledViews()).toEqual([]);
    expect(packages.listInstalledRunnableViews()).toEqual([]);
    expect(resolver.captureSessionSnapshot(true)).toEqual([]);
    expect(() => resolver.assertBrokerRunnable({ skillId: record.id })).toThrow();
    expect(() => packages.setEnabled(record.key, record.digest, true)).toThrow(RETIRED_SKILL_REASON);
    if (kind === "process") expect(() => resolver.assertAdmittedBrokerRunnable({ skillId: record.id, version: record.version, digest: record.digest })).not.toThrow();
    expect(fs.existsSync(path.join(record.packagePath, "SKILL.md"))).toBe(true);
  });
  it.each(retiredFixtureIds.flatMap(skillId => (["directory", "git"] as const).map(sourceType => [skillId, sourceType] as const)))("preserves a user-imported package with the same retired id: %s (%s)", (skillId, sourceType) => {
    const { packages, record, resolver } = fixture(sourceType, skillId);
    expect(packages.isRetired(record)).toBe(false);
    expect(packages.isEnabled(record)).toBe(true);
    expect(resolver.captureSessionSnapshot().map(entry => entry.definition.id)).toContain(record.id);
    expect(resolver.isRetiredTarget(record.id)).toBe(false);
  });
  it.each(["builtin", "directory"] as const)("retires dependent workflows only when their dependency is App-owned (%s)", sourceType => {
    const { root, packages, record, resolver } = fixture(sourceType);
    const { workflow } = installWorkflow(root, packages, record.id);
    expect(packages.isRetired(workflow)).toBe(false);
    expect(resolver.isRetiredTarget(workflow.id)).toBe(sourceType === "builtin");
    if (sourceType === "builtin") expect(() => resolver.admitWorkflow(workflow.id)).toThrow();
    else expect(resolver.admitWorkflow(workflow.id).steps[0]).toMatchObject({ skillId: record.id, digest: record.digest });
  });
  it("deduplicates disabled rules and avoids re-hashing unchanged packages on later scheduler ticks", async () => {
    const { paths, packages, resolver } = fixture();
    const live = packages.install(path.join(builtinBundle, "daily-topic-selector"));
    const repository = new AutomationRepository(paths);
    for (let index = 0; index < 8; index++) repository.saveRule({
      ...DEFAULT_AUTOMATION_RULES[0], id: `disabled-${index}`, enabled: false,
      target: { type: "skill", id: live.id, versionPolicy: "*" }
    });
    const inspect = vi.spyOn(packages, "inspectInstalledCopy");
    const isRetiredTarget = vi.fn((id: string) => resolver.isRetiredTarget(id));
    const unexpected = vi.fn(() => { throw new Error("Disabled rules must not execute"); });
    const scheduler = new AutomationScheduler({
      repository, rootGeneration: 1, isRetiredTarget,
      submitSkill: unexpected, submitWorkflow: unexpected, readSkill: unexpected, readWorkflow: unexpected,
      cancelSkill: async () => unexpected(), cancelWorkflow: async () => unexpected()
    });
    expect(isRetiredTarget).toHaveBeenCalledExactlyOnceWith(live.id);
    expect(inspect).toHaveBeenCalledOnce();
    for (let tick = 0; tick < 3; tick++) {
      isRetiredTarget.mockClear(); inspect.mockClear();
      await scheduler.tick();
      expect(isRetiredTarget).toHaveBeenCalledExactlyOnceWith(live.id);
      expect(inspect).not.toHaveBeenCalled();
    }
    expect(unexpected).not.toHaveBeenCalled();
    expect(repository.listRuns()).toEqual([]);
  });
  it("refreshes cached workflow dependencies after another service replaces or reinstalls its identity", () => {
    const { root, paths, packages, record, resolver } = fixture();
    const live = packages.install(path.join(builtinBundle, "daily-topic-selector"));
    const { source, file, manifest, workflow } = installWorkflow(root, packages, record.id);
    const inspect = vi.spyOn(packages, "inspectInstalledCopy");
    expect(resolver.isRetiredTarget(workflow.id)).toBe(true);
    const otherService = new SkillPackageService(paths);
    manifest.workflow.steps[0].skill = live.id;
    fs.writeFileSync(file, JSON.stringify(manifest));
    const replacement = otherService.install(source);
    expect(replacement.version).toBe(workflow.version);
    expect(replacement.digest).not.toBe(workflow.digest);
    expect(resolver.isRetiredTarget(workflow.id)).toBe(false);
    expect(inspect).toHaveBeenCalledTimes(2);
    otherService.uninstall(replacement.key, replacement.digest);
    expect(resolver.isRetiredTarget(workflow.id)).toBe(false);
    otherService.install(source);
    expect(resolver.isRetiredTarget(workflow.id)).toBe(false);
    expect(inspect).toHaveBeenCalledTimes(3);
  });
  it("rechecks dependency ownership and explicit retention without re-hashing the cached workflow", () => {
    const { root, content, paths, source, packages, record, resolver } = fixture();
    const { workflow } = installWorkflow(root, packages, record.id);
    const inspect = vi.spyOn(packages, "inspectInstalledCopy");
    expect(resolver.isRetiredTarget(workflow.id)).toBe(true);
    const key = crypto.createHash("sha256").update(fs.realpathSync(content)).digest("hex").slice(0, 24);
    const directory = path.join(paths.catalog, key); fs.mkdirSync(directory, { recursive: true });
    const retained = path.join(directory, "user-installations.json");
    fs.writeFileSync(retained, JSON.stringify([record.key]));
    expect(resolver.isRetiredTarget(workflow.id)).toBe(false);
    fs.writeFileSync(retained, "[]");
    expect(resolver.isRetiredTarget(workflow.id)).toBe(true);
    new SkillPackageService(paths).install(source, { sourceType: "directory", sourceLocator: source });
    expect(resolver.isRetiredTarget(workflow.id)).toBe(false);
    expect(inspect).toHaveBeenCalledOnce();
  });
  it("keeps fresh Broker and Workflow integrity checks after retirement metadata is cached", () => {
    const { root, packages, resolver } = fixture();
    const live = packages.install(path.join(builtinBundle, "daily-topic-selector"));
    const { workflow } = installWorkflow(root, packages, live.id);
    expect(resolver.isRetiredTarget(live.id)).toBe(false);
    expect(resolver.isRetiredTarget(workflow.id)).toBe(false);
    for (const record of [live, workflow]) {
      const file = path.join(record.packagePath, "openmind.skill.yaml");
      const before = fs.statSync(file);
      fs.writeFileSync(file, fs.readFileSync(file, "utf8").replace('"version": "1.0.0"', '"version": "1.0.1"').replace('"version":"1.0.0"', '"version":"1.0.1"'));
      fs.utimesSync(file, before.atime, before.mtime);
      expect(fs.statSync(file).size).toBe(before.size);
      expect(resolver.isRetiredTarget(record.id)).toBe(false);
    }
    expect(() => resolver.assertBrokerRunnable({ skillId: live.id })).toThrow(/digest/);
    expect(() => resolver.assertAdmittedBrokerRunnable({ skillId: live.id, version: live.version, digest: live.digest })).toThrow(/digest/);
    expect(() => resolver.admitWorkflow(workflow.id)).toThrow(/digest/);
  });
  it("preserves explicitly retained copies", () => {
    const { content, paths, packages, record } = fixture();
    const key = crypto.createHash("sha256").update(fs.realpathSync(content)).digest("hex").slice(0, 24);
    const directory = path.join(paths.catalog, key); fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(path.join(directory, "user-installations.json"), JSON.stringify([record.key]));
    expect(packages.isRetired(record)).toBe(false);
    expect(packages.isEnabled(record)).toBe(true);
  });
  it.each(retiredFixtureIds)("persists retirement across repeated startup without reinstalling packages or exposing old snapshots: %s", skillId => {
    const { content, paths, packages, record, resolver } = fixture("builtin", skillId);
    const bundle = builtinBundle;
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
  it("preserves drafts, versions, assets, releases and Skill data through repeated upgrade", async () => {
    const { content, paths, packages, record } = fixture();
    const relative = "creative/01-内容生产/文稿库/02-制作中/中文旧文稿";
    const files = new Map([
      [`${relative}/draft.md`, Buffer.from("# 旧文稿\n正文保持原样\n")],
      [`${relative}/versions/draft/v001.md`, Buffer.from("# 历史版本\n")],
      [`${relative}/assets/cover.png`, Buffer.from([137, 80, 78, 71, 0, 255])],
      [`${relative}/release-log.json`, Buffer.from('[{"status":"published"}]\n')],
      [`.agent/skill-data/${record.id}/state.json`, Buffer.from('{"completed":true}\n')]
    ]);
    for (const [file, bytes] of files) {
      fs.mkdirSync(path.dirname(path.join(content, file)), { recursive: true });
      fs.writeFileSync(path.join(content, file), bytes);
    }
    const bundle = builtinBundle;
    for (let attempt = 0; attempt < 2; attempt++) {
      migrateBuiltinPackages(content, packages, bundle);
      const source = createExplicitContentSource(content);
      expect(new ContentIndexStore(content, source, paths.state).searchContent("旧文稿")).toEqual([]);
      expect(source.readContent(`openmind/${relative}/draft.md`).content).toContain("正文保持原样");
      const found = await new OpenmindFileSearchEngine(content, "openmind").search("draft.md");
      expect(found.items.map(item => item.path)).toContain(`openmind/${relative}/draft.md`);
      for (const [file, bytes] of files) expect(fs.readFileSync(path.join(content, file))).toEqual(bytes);
    }
  });
  it.each(["git", "directory", "zip"])("does not retire same-id %s imports", sourceType => {
    expect(isRetiredBuiltinCandidate({ id: "creative-writing", publisherId: "openmind-library", sourceType, sourceLocator: "openmind:skill-library", sourcePath: "C:/old/skill-library/creative-writing" })).toBe(false);
  });
  it.each(retiredFixtureIds)("recognizes provenance of the first App bundle: %s", skillId => {
    expect(isRetiredBuiltinCandidate({ id: skillId, publisherId: "cctools", sourcePath: `C:\\app\\skill-library\\${skillId}` })).toBe(true);
  });
  it.each(retiredFixtureIds)("disables only affected schedules, preserves history and does not reactivate on repeated migration: %s", skillId => {
    const { paths, packages, record } = fixture("builtin", skillId);
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
