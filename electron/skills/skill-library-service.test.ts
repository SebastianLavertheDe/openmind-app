import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AuthoredSkillSchema } from "../../shared/skill-library";
import { filterSkillLibrary } from "../../shared/skill-library";
import { getLocale, setLocale } from "../../shared/messages";
import { SkillLibraryCatalogSchema, SkillLibraryPresetSchema } from "../../shared/skill-library-catalog";
import { buildAppPaths, ensureAppPaths } from "../paths/app-paths-service";
import { SkillPackageService } from "./skill-package-service";
import { SkillLibraryService } from "./skill-library-service";
import { InstalledSkillExecutionResolver } from "./installed-skill-execution-resolver";
import { prepareSkillLibraryBundle } from "./skill-library-bundle";
import { DefaultSkillsService } from "./default-skills-service";
import type { SkillSourceService } from "./skill-source-service";
import { OPENMIND_SKILLS_REPO_URL } from "../../shared/skill-package-sources";
import { SkillToolRegistry } from "../ai/skill-tool-registry";
import * as libraryRuntime from "./skill-library-runtime";

const roots: string[] = [];
const initialLocale = getLocale();
afterEach(() => {
  vi.unstubAllEnvs(); vi.restoreAllMocks(); setLocale(initialLocale);
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});
function fixture() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "openmind-library-test-")); roots.push(directory);
  const content = path.join(directory, "content"); fs.mkdirSync(content);
  const paths = buildAppPaths(path.join(directory, "state"), path.join(content, ".agent", "skills")); ensureAppPaths(paths);
  const packages = new SkillPackageService(paths);
  const bundle = path.join(directory, "skill-library");
  const configRoot = path.join(directory, "config"); fs.mkdirSync(configRoot);
  const catalog = SkillLibraryCatalogSchema.parse({ schemaVersion: 1, skills: [{ id: "om-research-brief", category: "research", instructions: ["Read the supplied evidence."], display: { en: { title: "Research brief", subtitle: "Research the supplied materials", inputHint: "What should I research?" } } }] });
  const writeCatalog = () => {
    fs.writeFileSync(path.join(configRoot, "catalog.json"), JSON.stringify(catalog));
    if (fs.existsSync(bundle)) fs.writeFileSync(path.join(bundle, "catalog.json"), JSON.stringify(catalog));
  };
  writeCatalog();
  prepareSkillLibraryBundle(configRoot, bundle);
  const service = new SkillLibraryService(content, paths, packages, bundle);
  const document = () => { const doc = service.editor(); doc.name = `Skill ${doc.id.slice(0, 5)}`; doc.instructions[0].text = "Read the user's materials and produce a clear answer."; doc.inputHint = "What should I work on?"; return doc; };
  return { directory, content, paths, packages, service, document, bundle, configRoot, catalog, writeCatalog };
}

describe("Skill library and authoring", () => {
  it("keeps App library installs separate from GitHub imports and default removal", async () => {
    const f = fixture();
    const preset = f.service.installPreset("om-research-brief");
    expect(preset.key).toBe("openmind-library/om-research-brief");
    expect(f.packages.getInstalled(preset.key!, preset.digest!)).toMatchObject({ sourceType: "builtin", sourceLocator: "openmind:skill-library" });
    const external = path.join(f.directory, "github"); fs.mkdirSync(external);
    fs.writeFileSync(path.join(external, "SKILL.md"), "---\nname: rss-article-saver\ndescription: External RSS skill\n---\nRead feeds.\n");
    const imported = f.packages.install(external, { sourceType: "git", sourceLocator: OPENMIND_SKILLS_REPO_URL });
    expect(filterSkillLibrary(f.service.list(), "explore", "all").map(entry => entry.id)).toEqual([preset.id]);
    expect(filterSkillLibrary(f.service.list(), "mine", "github-installed").map(entry => entry.key)).toEqual([imported.key]);
    const defaults = new DefaultSkillsService(f.packages, {} as SkillSourceService, { stop: vi.fn(), refresh: vi.fn(), setEnabled: vi.fn() });
    await defaults.setEnabled(false);
    expect(f.packages.getInstalled(imported.key)).toBeUndefined();
    expect(f.packages.getInstalled(preset.key!)).toBeTruthy();
  });

  it("migrates only a bound legacy App install to the independent publisher", () => {
    const f = fixture();
    const source = path.join(f.bundle, "om-research-brief");
    const manifestPath = path.join(source, "openmind.skill.yaml");
    const original = fs.readFileSync(manifestPath, "utf8");
    const legacyManifest = JSON.parse(original); legacyManifest.publisher.id = "cctools";
    fs.writeFileSync(manifestPath, JSON.stringify(legacyManifest));
    const legacy = f.packages.install(source);
    const bindingRoot = path.join(f.paths.catalog, crypto.createHash("sha256").update(fs.realpathSync(f.content)).digest("hex").slice(0, 24));
    fs.mkdirSync(bindingRoot, { recursive: true });
    fs.writeFileSync(path.join(bindingRoot, "bindings.json"), JSON.stringify({ [legacy.id]: { key: legacy.key, digest: legacy.digest } }));
    expect(f.service.list()[0].installed).toBe(true);
    fs.writeFileSync(manifestPath, original);
    const current = f.service.installPreset(legacy.id);
    expect(current.key).toBe("openmind-library/om-research-brief");
    expect(f.packages.getInstalled(legacy.key)).toBeUndefined();
    expect(f.packages.listInstalled()).toHaveLength(1);
  });

  it.each(["cctools", "openmind-library"])("never treats a GitHub package from %s as an App preset or replaces it", publisher => {
    const f = fixture();
    const source = path.join(f.directory, "github");
    fs.cpSync(path.join(f.bundle, "om-research-brief"), source, { recursive: true });
    const manifestPath = path.join(source, "openmind.skill.yaml");
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    manifest.publisher.id = publisher; manifest.display.name = "External package title";
    fs.writeFileSync(manifestPath, JSON.stringify(manifest));
    const imported = f.packages.install(source, { sourceType: "git", sourceLocator: OPENMIND_SKILLS_REPO_URL });
    f.packages.setEnabled(imported.key, imported.digest, true);
    vi.stubEnv("OPENMIND_SKILL_LIBRARY_BUNDLE", f.bundle);
    const resolver = new InstalledSkillExecutionResolver(f.packages, {} as never, f.content, 1);
    expect(resolver.captureSessionSnapshot()[0].definition.title).toBe("External package title");
    expect(f.service.list().find(entry => entry.id === "om-research-brief")?.installed).toBe(false);
    expect(() => f.service.installPreset("om-research-brief")).toThrow();
    expect(f.packages.getInstalled(imported.key, imported.digest)).toBeTruthy();
    expect(f.packages.isInstalledCopyUsable(imported)).toBe(true);
  });

  it("keeps Explore separate from installed and authored Mine entries", () => {
    const f = fixture();
    expect(filterSkillLibrary(f.service.list(), "explore", "all")).toHaveLength(1);
    expect(filterSkillLibrary(f.service.list(), "mine", "all")).toHaveLength(0);
    const installed = f.service.installPreset("om-research-brief");
    expect(installed.installed && installed.enabled).toBe(true);
    expect(filterSkillLibrary(f.service.list(), "mine", "all")).toHaveLength(1);
    f.service.editor();
    expect(filterSkillLibrary(f.service.list(), "mine", "all")).toHaveLength(2);
    expect(filterSkillLibrary(f.service.list(), "mine", "github-installed")).toHaveLength(0);
  });

  it("discovers and installs a newly configured skill and uses its copy in chat", () => {
    const f = fixture();
    vi.spyOn(libraryRuntime, "resolveSkillLibraryTools").mockReturnValue({ python: "/fixture/python", ffmpeg: null, electron: process.execPath });
    // This id is deliberately absent from application code and the shipped catalog.
    const id = "fixture-new-skill";
    const en = { title: "New skill", subtitle: "Write from evidence", description: "Detailed configured description", inputHint: "Give me a topic" };
    const zh = { title: "新技能", subtitle: "依据资料写作", description: "配置中的完整说明", inputHint: "提供一个主题" };
    const newPreset = SkillLibraryPresetSchema.parse({ id, category: "writing", requirement: "python", instructions: ["Follow the new configured rules."], display: { en, "zh-CN": zh } });
    f.catalog.skills.unshift(newPreset);
    f.writeCatalog();
    prepareSkillLibraryBundle(f.configRoot, f.bundle);
    vi.stubEnv("OPENMIND_SKILL_LIBRARY_BUNDLE", f.bundle);

    setLocale("en");
    expect(f.service.list().map(entry => entry.id)).toEqual([id, "om-research-brief"]);
    expect(filterSkillLibrary(f.service.list(), "explore", "writing", "Detailed")[0]).toMatchObject({ id, ...en, installed: false });
    const installed = f.service.installPreset(id);
    expect(installed).toMatchObject({ id, installed: true, enabled: true, ...en });
    const resolver = new InstalledSkillExecutionResolver(f.packages, {} as never, f.content, 1);
    expect(resolver.captureSessionSnapshot()[0].definition).toMatchObject({ id, title: en.title, inputHint: en.inputHint, description: en.description });
    const registry = new SkillToolRegistry(f.content, { paths: f.paths, openmindRoot: f.content, rootGeneration: 1, installedResolver: resolver });
    expect(registry.providerSkillCatalog(resolver.captureSessionSnapshot())[0].tools?.python).toBe("/fixture/python");

    setLocale("zh-CN");
    expect(f.service.list()[0]).toMatchObject(zh);
    expect(resolver.captureSessionSnapshot()[0].definition).toMatchObject({ title: zh.title, inputHint: zh.inputHint });
    zh.title = "更新后的技能"; newPreset.display["zh-CN"]!.title = zh.title; f.writeCatalog();
    expect(f.service.list()[0].title).toBe(zh.title);
    expect(resolver.captureSessionSnapshot()[0].definition.title).toBe(zh.title);

    f.catalog.skills.shift(); f.writeCatalog();
    expect(filterSkillLibrary(f.service.list(), "explore", "all").map(entry => entry.id)).toEqual(["om-research-brief"]);
    expect(filterSkillLibrary(f.service.list(), "mine", "all")).toHaveLength(1);
    expect(() => f.service.installPreset(id)).toThrow();
  });

  it("reports invalid or missing configuration without installing a skill", () => {
    const f = fixture();
    f.catalog.skills.push(f.catalog.skills[0]); f.writeCatalog();
    expect(() => f.service.list()).toThrow("Duplicate Skill id");
    expect(() => f.service.installPreset("om-research-brief")).toThrow("catalog.json");
    fs.rmSync(path.join(f.bundle, "catalog.json"));
    expect(() => f.service.list()).toThrow("catalog.json");
    expect(f.packages.listInstalled()).toHaveLength(0);
  });

  it("keeps missing configured packages visible but unavailable", () => {
    const f = fixture();
    f.catalog.skills.push(SkillLibraryPresetSchema.parse({ id: "missing-package", category: "web", instructions: ["Fixture"], display: { en: { title: "Missing package" } } }));
    f.writeCatalog();
    expect(f.service.list().find(entry => entry.id === "missing-package")).toMatchObject({ usable: false, installed: false, reason: expect.any(String) });
    expect(() => f.service.installPreset("missing-package")).toThrow();
  });

  it("validates bundle bytes and does not admit a changed preset", () => {
    const f = fixture();
    fs.appendFileSync(path.join(f.bundle, "om-research-brief", "SKILL.md"), "Changed after build");
    expect(() => f.service.installPreset("om-research-brief")).toThrow();
    expect(f.packages.listInstalled()).toHaveLength(0);
  });

  it("publishes a real installed package and retries the same operation without creating a revision", () => {
    const f = fixture(); const doc = f.document(); const operationId = crypto.randomUUID();
    const first = f.service.publish(doc, operationId);
    const second = f.service.publish(doc, operationId);
    expect(first.key).toBe(`user/om-user-${doc.id}`);
    expect(first.digest).toBe(second.digest);
    expect(second.revision).toBe(1);
    const resolver = new InstalledSkillExecutionResolver(f.packages, {} as never, f.content, 1);
    const snapshot = resolver.captureSessionSnapshot();
    const bridge = resolver.providerSkillBridge(snapshot[0]);
    expect(bridge?.instructions).toContain(doc.instructions[0].text);
    expect(snapshot[0].definition.inputHint).toBe(doc.inputHint);
    expect(f.service.editor(doc.id).name).toBe(doc.name);
  });

  it("rejects stale edits and keeps the active revision intact", () => {
    const f = fixture(); const doc = f.document();
    f.service.publish(doc, crypto.randomUUID());
    const edit = f.service.editor(doc.id); edit.instructions[0].text = "The revised rules";
    const result = f.service.publish(edit, crypto.randomUUID());
    expect(result.revision).toBe(2);
    expect(() => f.service.publish(doc, crypto.randomUUID())).toThrow();
    expect(f.packages.getInstalled(result.key!, result.digest!)).toBeTruthy();
    expect(f.service.editor(doc.id).instructions[0].text).toBe("The revised rules");
  });

  it("recovers an activated revision after source persistence fails and retries it idempotently", () => {
    const f = fixture(); const doc = f.document(); const operationId = crypto.randomUUID();
    const install = f.packages.install.bind(f.packages);
    vi.spyOn(f.packages, "install").mockImplementation((...args) => {
      install(...args);
      throw new Error("lost installation response");
    });
    expect(() => f.service.publish(doc, operationId)).toThrow("lost installation response");
    vi.restoreAllMocks();
    const recovered = new SkillLibraryService(f.content, f.paths, f.packages, f.bundle);
    expect(recovered.editor(doc.id).revision).toBe(1);
    expect(recovered.publish(doc, operationId).revision).toBe(1);
    expect(f.packages.listInstalled()).toHaveLength(1);
    expect(() => recovered.publish({ ...doc, name: "different request" }, operationId)).toThrow();
  });

  it("copies every authored block, model and material into an independent editable source", () => {
    const f = fixture(); const doc = f.document();
    const source = path.join(f.directory, "reference.txt"); fs.writeFileSync(source, "copied material");
    doc.instructions[0].assets = f.service.importAssets(doc.id, [source], false);
    doc.instructions.push({ id: crypto.randomUUID(), text: "Second ordered instruction", assets: [], skills: [] });
    doc.executionModel = { provider: "codex", model: "fixture-model" };
    const original = f.service.publish(doc, crypto.randomUUID());
    const copy = f.service.copy({ key: original.key!, digest: original.digest! });
    expect(copy.instructions.map(block => block.text)).toEqual(doc.instructions.map(block => block.text));
    expect(copy.instructions[0].id).not.toBe(doc.instructions[0].id);
    expect(copy.executionModel).toEqual(doc.executionModel);
    const installed = f.service.publish(copy, crypto.randomUUID());
    const record = f.packages.getInstalled(installed.key!, installed.digest!)!;
    expect(fs.readFileSync(path.join(record.packagePath, "references", `${doc.instructions[0].assets[0].id}.txt`), "utf8")).toBe("copied material");
    expect(f.packages.getInstalled(original.key!, original.digest!)).toBeTruthy();
  });

  it("checks unique personal names and the published instruction requirement", () => {
    const f = fixture(); const first = f.document(); first.name = "Research"; f.service.publish(first, crypto.randomUUID());
    const second = f.document(); second.name = " research ";
    expect(() => f.service.publish(second, crypto.randomUUID())).toThrow();
    second.name = "Another"; second.instructions[0].text = " ";
    expect(() => f.service.publish(second, crypto.randomUUID())).toThrow();
  });

  it("counts Unicode code points consistently and validates showcase limits", () => {
    const f = fixture(); const doc = f.document(); doc.name = "😀".repeat(40);
    expect(AuthoredSkillSchema.safeParse(doc).success).toBe(true);
    doc.name += "x";
    expect(AuthoredSkillSchema.safeParse(doc).success).toBe(false);
    expect(AuthoredSkillSchema.safeParse({ ...doc, name: "valid", inputHint: "x".repeat(201) }).success).toBe(false);
  });

  it("copies an installed skill without editing its bytes or identity", () => {
    const f = fixture(); const original = f.service.installPreset("om-research-brief");
    const copy = f.service.copy({ key: original.key!, digest: original.digest! });
    copy.instructions[0].text += "\nMy own revision";
    const installed = f.service.publish(copy, crypto.randomUUID());
    expect(installed.key).not.toBe(original.key);
    expect(f.packages.getInstalled(original.key!, original.digest!)).toBeTruthy();
    expect(filterSkillLibrary(f.service.list(), "mine", "research", "", "authored")).toHaveLength(1);
    expect(f.service.editor(copy.id).copiedFrom?.digest).toBe(original.digest);
  });

  it("imports reference materials into the generated package", () => {
    const f = fixture(); const doc = f.document(); const source = path.join(f.directory, "reference.txt"); fs.writeFileSync(source, "Known fixture text");
    const assets = f.service.importAssets(doc.id, [source], false); doc.instructions[0].assets = assets;
    const result = f.service.publish(doc, crypto.randomUUID());
    const record = f.packages.getInstalled(result.key!, result.digest!)!;
    expect(fs.readFileSync(path.join(record.packagePath, "references", `${assets[0].id}.txt`), "utf8")).toBe("Known fixture text");
    expect(fs.readFileSync(path.join(record.packagePath, "SKILL.md"), "utf8")).toContain(`references/${assets[0].id}.txt`);
  });

  it("wraps a Process Skill by reference without copying its runtime implementation", () => {
    const f = fixture(); const source = path.join(f.directory, "process"); fs.mkdirSync(source);
    const base = f.document(); const agent = f.service.publish(base, crypto.randomUUID());
    const record = f.packages.getInstalled(agent.key!, agent.digest!)!;
    const manifest = JSON.parse(fs.readFileSync(path.join(record.packagePath, "cctools.skill.yaml"), "utf8"));
    Object.assign(manifest, { id: "process-fixture", kind: "process", entrypoint: { runtime: "shell", script: "run.sh", args: [] }, runtime: { version: ">=1.0.0", dependencyFile: "runtime.txt" } });
    fs.writeFileSync(path.join(source, "cctools.skill.yaml"), JSON.stringify(manifest));
    fs.writeFileSync(path.join(source, "run.sh"), "echo fixture\n"); fs.writeFileSync(path.join(source, "runtime.txt"), "fixture\n");
    fs.writeFileSync(path.join(source, "SKILL.md"), "---\nname: process-fixture\ndescription: Fixture process\n---\nUse the process entrypoint.\n");
    const installed = f.packages.install(source);
    const copy = f.service.copy({ key: installed.key, digest: installed.digest });
    expect(copy.instructions[0].skills).toEqual([{ key: installed.key, digest: installed.digest }]);
    const wrapped = f.service.publish(copy, crypto.randomUUID());
    const wrappedRecord = f.packages.getInstalled(wrapped.key!, wrapped.digest!)!;
    expect(fs.existsSync(path.join(wrappedRecord.packagePath, "run.sh"))).toBe(false);
    expect(fs.readFileSync(path.join(wrappedRecord.packagePath, "SKILL.md"), "utf8")).toContain(installed.key);
  });

  it("rejects self references and outdated dependency identities", () => {
    const f = fixture(); const child = f.document(); const installed = f.service.publish(child, crypto.randomUUID());
    const parent = f.document(); parent.instructions[0].skills = [{ key: installed.key!, digest: installed.digest! }];
    f.service.publish(parent, crypto.randomUUID());
    const update = f.service.editor(child.id); update.instructions[0].text += " Revised"; f.service.publish(update, crypto.randomUUID());
    const parentEdit = f.service.editor(parent.id);
    expect(() => f.service.publish(parentEdit, crypto.randomUUID())).toThrow();
    const own = f.packages.listInstalled().find(item => item.id === `om-user-${parent.id}`)!;
    parentEdit.instructions[0].skills = [{ key: own.key, digest: own.digest }];
    expect(() => f.service.publish(parentEdit, crypto.randomUUID())).toThrow();
  });

  it("refuses an escaping asset directory and preserves outside files", () => {
    const f = fixture(); const doc = f.document(); const outside = path.join(f.directory, "outside"); fs.mkdirSync(outside);
    const source = path.join(f.directory, "reference.txt"); fs.writeFileSync(source, "fixture");
    const author = path.join(f.content, ".agent", "authored-skills", doc.id); fs.mkdirSync(author, { recursive: true }); fs.symlinkSync(outside, path.join(author, "assets"), "dir");
    expect(() => f.service.importAssets(doc.id, [source], false)).toThrow();
    expect(fs.readdirSync(outside)).toEqual([]);
  });

  it("keeps model preferences and deletes only the authored skill", () => {
    const f = fixture(); const preset = f.service.installPreset("om-research-brief"); const doc = f.document(); doc.executionModel = { provider: "claude", model: "fixture-model" };
    const entry = f.service.publish(doc, crypto.randomUUID());
    expect(entry.executionModel).toEqual(doc.executionModel);
    f.service.remove(doc.id);
    expect(f.service.list().some(item => item.id === doc.id)).toBe(false);
    expect(f.packages.getInstalled(preset.key!, preset.digest!)).toBeTruthy();
  });
});
