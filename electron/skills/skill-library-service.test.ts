import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { PNG } from "pngjs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AuthoredSkillSchema, type AuthoredSkill } from "../../shared/skill-library";
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

// Seed the on-disk format written by releases that still supported copying.
function legacySkill(f: ReturnType<typeof fixture>, patch: Partial<AuthoredSkill>) {
  const doc = AuthoredSkillSchema.parse({ id: crypto.randomUUID(), revision: 1, name: "Legacy personal skill", subtitle: "", category: "research", instructions: [{ id: crypto.randomUUID(), text: "Existing personal rules." }], inputHint: "", description: "", ...patch });
  const root = path.join(f.content, ".agent/authored-skills", doc.id);
  fs.mkdirSync(root, { recursive: true });
  fs.writeFileSync(path.join(root, "skill.json"), JSON.stringify(doc));
  return { doc, root };
}

describe("Skill library and authoring", () => {
  it("keeps the installed rules until explicit use applies a changed bundle", () => {
    const f = fixture();
    const original = f.service.installPreset("om-research-brief");
    expect(original.updateAvailable).toBe(false);
    f.catalog.skills[0].version = "1.1.0";
    f.catalog.skills[0].instructions = ["Updated bundled rules."];
    f.writeCatalog(); prepareSkillLibraryBundle(f.configRoot, f.bundle);
    const pending = f.service.list().find(entry => entry.id === "om-research-brief")!;
    expect(pending).toMatchObject({ digest: original.digest, version: "1.0.0", updateAvailable: true });
    const before = f.packages.getInstalled(original.key!, original.digest!)!;
    expect(fs.readFileSync(path.join(before.packagePath, "SKILL.md"), "utf8")).toContain("Read the supplied evidence.");
    const updated = f.service.installPreset("om-research-brief");
    expect(updated).toMatchObject({ version: "1.1.0", updateAvailable: false });
    expect(updated.digest).not.toBe(original.digest);
    const after = f.packages.getInstalled(updated.key!, updated.digest!)!;
    expect(fs.readFileSync(path.join(after.packagePath, "SKILL.md"), "utf8")).toContain("Updated bundled rules.");
  });

  it("retains contributor avatars and homepages through draft, publication, restart and defaults", () => {
    const f = fixture(); const doc = f.document();
    const file = path.join(f.directory, "avatar.png");
    const bytes = PNG.sync.write(new PNG({ width: 128, height: 128 }));
    fs.writeFileSync(file, bytes);
    const avatar = f.service.importAssets(doc.id, [file], true)[0];
    const profileUrl = "https://x.com/contributor";
    doc.contributor = { nick: " @Contributor ", avatar, profileUrl: `${profileUrl}/` };
    f.service.saveDraft(doc);
    expect(f.service.editor(doc.id).contributor).toEqual({ nick: "Contributor", avatar, profileUrl });
    const entry = f.service.publish(doc, crypto.randomUUID());
    expect(entry.contributor).toEqual({ nick: "Contributor", avatarUrl: `data:image/png;base64,${bytes.toString("base64")}`, profileUrl });
    const record = f.packages.getInstalled(entry.key!, entry.digest!)!;
    expect(JSON.parse(fs.readFileSync(path.join(record.packagePath, "openmind.library.json"), "utf8")).contributor).toEqual({ nick: "Contributor", avatar: `references/${avatar.id}.png`, profileUrl });
    expect(fs.readFileSync(path.join(record.packagePath, "references", `${avatar.id}.png`))).toEqual(bytes);
    const reopened = new SkillLibraryService(f.content, f.paths, f.packages, f.bundle);
    expect(reopened.list().find(item => item.id === doc.id)?.contributor).toEqual(entry.contributor);
    // Removing the original must not remove the reusable avatar in userData.
    reopened.remove(doc.id);
    const next = reopened.editor();
    expect(next.contributor?.nick).toBe("Contributor");
    expect(next.contributor?.profileUrl).toBe(profileUrl);
    expect(next.contributor?.avatar?.id).not.toBe(avatar.id);
    expect(reopened.readImage(next.id, next.contributor!.avatar!)).toBe(entry.contributor?.avatarUrl);
  });

  it("shows configured contributors before installation and after removal from the public catalog", () => {
    const f = fixture();
    const profileUrl = "https://github.com/member";
    f.catalog.skills[0].contributor = { nick: "Library member", avatar: "avatar.png", profileUrl };
    const source = path.join(f.configRoot, "assets/om-research-brief/avatar.png");
    fs.mkdirSync(path.dirname(source), { recursive: true });
    fs.writeFileSync(source, PNG.sync.write(new PNG({ width: 128, height: 128 })));
    f.writeCatalog(); prepareSkillLibraryBundle(f.configRoot, f.bundle);
    const original = f.service.list()[0].contributor;
    expect(original).toMatchObject({ nick: "Library member", avatarUrl: expect.stringContaining("data:image/png;base64,"), profileUrl });
    const installed = f.service.installPreset("om-research-brief");
    expect(installed.contributor).toEqual(original);
    expect(f.service.editor().contributor).toBeUndefined();
    f.catalog.skills = []; f.writeCatalog();
    expect(f.service.list().find(item => item.key === installed.key)).toMatchObject({ discoverable: false, contributor: original });
  });

  it("rejects invalid homepages on draft/publication and allows clearing a saved homepage", () => {
    const f = fixture(); const doc = f.document();
    for (const profileUrl of ["https://example.com/author", "https://github.com/author/repository", "https://x.com/author/status/123"]) {
      doc.contributor = { nick: "Author", profileUrl };
      expect(() => f.service.saveDraft(doc)).toThrow();
      expect(() => f.service.publish(doc, crypto.randomUUID())).toThrow();
    }
    doc.contributor = { nick: "", profileUrl: "https://github.com/author" };
    expect(() => f.service.publish(doc, crypto.randomUUID())).toThrow();
    doc.contributor.nick = "Author";
    f.service.publish(doc, crypto.randomUUID());
    const edit = f.service.editor(doc.id);
    edit.contributor!.profileUrl = undefined;
    expect(f.service.publish(edit, crypto.randomUUID()).contributor).toMatchObject({ nick: "Author", profileUrl: undefined });
    expect(f.service.editor(doc.id).contributor?.profileUrl).toBeUndefined();
    expect(f.service.editor().contributor).toEqual({ nick: "Author", profileUrl: undefined });
  });

  it("keeps legacy entries usable, falls back for missing avatars and validates avatars at publication", () => {
    const f = fixture(); const doc = f.document();
    expect(f.service.list()[0].contributor).toBeUndefined();
    doc.contributor = { nick: "Contributor", avatar: { id: crypto.randomUUID(), name: "avatar.png", kind: "image", extension: ".png" } };
    f.service.saveDraft(doc);
    expect(f.service.list().find(item => item.id === doc.id)?.contributor).toEqual({ nick: "Contributor", avatarUrl: undefined });
    expect(() => f.service.publish(doc, crypto.randomUUID())).toThrow();
    doc.contributor.nick = "";
    expect(() => f.service.publish(doc, crypto.randomUUID())).toThrow();
    doc.contributor = { nick: "Contributor" };
    const published = f.service.publish(doc, crypto.randomUUID());
    const edit = f.service.editor(doc.id); edit.contributor = { nick: "" };
    expect(f.service.publish(edit, crypto.randomUUID()).contributor).toBeUndefined();
    expect(f.service.editor().contributor).toBeUndefined();
    expect(published.contributor?.nick).toBe("Contributor");
  });

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

  it.each(["python", "image"] as const)("discovers a configured %s skill and supplies its runtime tools in chat", requirement => {
    const f = fixture();
    vi.spyOn(libraryRuntime, "resolveSkillLibraryTools").mockReturnValue({ python: "/fixture/python", ffmpeg: null, electron: process.execPath, imageComposer: "/fixture/image-composer.js" });
    // This id is deliberately absent from application code and the shipped catalog.
    const id = "fixture-new-skill";
    const en = { title: "New skill", subtitle: "Write from evidence", description: "Detailed configured description", inputHint: "Give me a topic" };
    const zh = { title: "新技能", subtitle: "依据资料写作", description: "配置中的完整说明", inputHint: "提供一个主题" };
    const newPreset = SkillLibraryPresetSchema.parse({ id, category: "writing", requirement, instructions: ["Follow the new configured rules."], display: { en, "zh-CN": zh } });
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
    expect(registry.providerSkillCatalog(resolver.captureSessionSnapshot())[0].tools?.imageComposer).toBe("/fixture/image-composer.js");

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

  it("restores an unpublished draft and clears its pending state after applying it", () => {
    const f = fixture(); const doc = f.document();
    const published = f.service.publish(doc, crypto.randomUUID());
    expect(published.draft).toBe(false);
    const draft = f.service.editor(doc.id); draft.instructions[0].text = "Autosaved revised rules";
    f.service.saveDraft(draft);
    const reopened = new SkillLibraryService(f.content, f.paths, f.packages, f.bundle);
    expect(reopened.editor(doc.id)).toEqual(draft);
    expect(reopened.list().find(entry => entry.id === doc.id)).toMatchObject({ draft: true, revision: 1, digest: published.digest });
    const applied = reopened.publish(reopened.editor(doc.id), crypto.randomUUID());
    expect(applied).toMatchObject({ draft: false, revision: 2 });
    expect(applied.digest).not.toBe(published.digest);
    expect(reopened.editor(doc.id).instructions[0].text).toBe(draft.instructions[0].text);
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

  it("ignores a late autosave of published content without overwriting a newer draft", () => {
    const f = fixture(); const doc = f.document();
    doc.name = ` ${doc.name} `;
    f.service.publish(doc, crypto.randomUUID());
    expect(f.service.saveDraft(doc).revision).toBe(1);
    expect(f.service.list().find(entry => entry.id === doc.id)?.draft).toBe(false);
    const edit = f.service.editor(doc.id); edit.instructions[0].text = "Keep these later unsaved edits";
    f.service.saveDraft(edit);
    f.service.saveDraft(doc);
    expect(f.service.editor(doc.id)).toEqual(edit);
    expect(f.service.publish(edit, crypto.randomUUID()).revision).toBe(2);
  });

  it("preserves conflicting edits instead of discarding them as a late autosave", () => {
    const f = fixture(); const doc = f.document();
    f.service.publish(doc, crypto.randomUUID());
    doc.instructions[0].text = "Different unsaved content";
    f.service.saveDraft(doc);
    expect(f.service.editor(doc.id)).toEqual(doc);
    expect(() => f.service.publish(doc, crypto.randomUUID())).toThrow();
  });

  it.each(["image", "python", "ffmpeg"] as const)("retains %s requirements when reopening and editing a legacy personal skill", requirement => {
    const f = fixture();
    f.catalog.skills[0].requirement = requirement;
    f.writeCatalog(); prepareSkillLibraryBundle(f.configRoot, f.bundle);
    vi.stubEnv("OPENMIND_SKILL_LIBRARY_BUNDLE", f.bundle);
    vi.stubEnv("OPENMIND_USER_DATA_DIR", f.paths.userData);
    const tools = { python: null, ffmpeg: null, electron: "/fixture/OpenMind" };
    vi.spyOn(libraryRuntime, "resolveSkillLibraryTools").mockReturnValue(tools);
    const original = f.service.installPreset("om-research-brief");
    expect(original.usable).toBe(false);
    const { doc: legacy } = legacySkill(f, { requirement, copiedFrom: { key: original.key!, digest: original.digest! } });
    f.packages.uninstall(original.key!, original.digest!);
    const reopened = new SkillLibraryService(f.content, f.paths, f.packages, f.bundle);
    const edit = reopened.editor(legacy.id); edit.instructions[0].text += " Updated instructions.";
    const published = reopened.publish(edit, crypto.randomUUID());
    expect(published).toMatchObject({ usable: false, reason: original.reason });
    const resolver = new InstalledSkillExecutionResolver(f.packages, {} as never, f.content, 1);
    const registry = new SkillToolRegistry(f.content, { paths: f.paths, openmindRoot: f.content, rootGeneration: 1, installedResolver: resolver });
    const readyTools = { python: "/fixture/python3", ffmpeg: "/fixture/ffmpeg", electron: "/fixture/OpenMind" };
    vi.mocked(libraryRuntime.resolveSkillLibraryTools).mockReturnValue(readyTools);
    const catalog = registry.providerSkillCatalog(resolver.captureSessionSnapshot());
    if (requirement !== "image") {
      expect(reopened.list().find(entry => entry.id === legacy.id)?.usable).toBe(true);
      expect(catalog.find(entry => entry.id === published.skillId)?.tools).toEqual(readyTools);
      if (requirement === "ffmpeg") {
        vi.mocked(libraryRuntime.resolveSkillLibraryTools).mockReturnValue({ ...readyTools, ffmpeg: null });
        expect(reopened.list().find(entry => entry.id === legacy.id)?.usable).toBe(false);
      }
    }
    expect(reopened.editor(legacy.id).requirement).toBe(requirement);
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

  it("retains authored blocks, models and materials after reopening and applying a revision", () => {
    const f = fixture(); const doc = f.document();
    const source = path.join(f.directory, "reference.txt"); fs.writeFileSync(source, "copied material");
    doc.instructions[0].assets = f.service.importAssets(doc.id, [source], false);
    doc.instructions.push({ id: crypto.randomUUID(), text: "Second ordered instruction", assets: [], skills: [] });
    doc.executionModel = { provider: "codex", model: "fixture-model" };
    const original = f.service.publish(doc, crypto.randomUUID());
    const reopened = new SkillLibraryService(f.content, f.paths, f.packages, f.bundle);
    const edit = reopened.editor(doc.id);
    expect(edit.instructions).toEqual(doc.instructions);
    expect(edit.executionModel).toEqual(doc.executionModel);
    edit.instructions[1].text += " Updated.";
    const installed = reopened.publish(edit, crypto.randomUUID());
    const record = f.packages.getInstalled(installed.key!, installed.digest!)!;
    expect(fs.readFileSync(path.join(record.packagePath, "references", `${doc.instructions[0].assets[0].id}.txt`), "utf8")).toBe("copied material");
    expect(installed.key).toBe(original.key);
    expect(installed.digest).not.toBe(original.digest);
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

  it("preserves legacy attribution and support files without changing the original package or author defaults", () => {
    const f = fixture(); const original = f.service.installPreset("om-research-brief");
    const owner = f.document(); owner.contributor = { nick: "Owner" }; f.service.publish(owner, crypto.randomUUID());
    const contributor = { nick: "Original author", profileUrl: "https://github.com/author" };
    const { doc: legacy, root } = legacySkill(f, { contributor, copiedFrom: { key: original.key!, digest: original.digest! } });
    fs.mkdirSync(path.join(root, "support/scripts"), { recursive: true });
    fs.writeFileSync(path.join(root, "support/scripts/helper.py"), "# Existing helper\n");
    const reopened = new SkillLibraryService(f.content, f.paths, f.packages, f.bundle);
    const edit = reopened.editor(legacy.id); edit.instructions[0].text += "\nMy own revision";
    const installed = reopened.publish(edit, crypto.randomUUID());
    expect(installed.key).not.toBe(original.key);
    expect(f.packages.getInstalled(original.key!, original.digest!)).toBeTruthy();
    expect(filterSkillLibrary(reopened.list(), "mine", "research", "", "authored").some(entry => entry.id === legacy.id)).toBe(true);
    expect(reopened.editor(legacy.id).copiedFrom?.digest).toBe(original.digest);
    expect(installed.contributor).toMatchObject(contributor);
    expect(reopened.editor().contributor?.nick).toBe("Owner");
    const record = f.packages.getInstalled(installed.key!, installed.digest!)!;
    expect(fs.readFileSync(path.join(record.packagePath, "scripts/helper.py"), "utf8")).toBe("# Existing helper\n");
  });

  it("imports reference materials into the generated package", () => {
    const f = fixture(); const doc = f.document(); const source = path.join(f.directory, "reference.txt"); fs.writeFileSync(source, "Known fixture text");
    const assets = f.service.importAssets(doc.id, [source], false); doc.instructions[0].assets = assets;
    const result = f.service.publish(doc, crypto.randomUUID());
    const record = f.packages.getInstalled(result.key!, result.digest!)!;
    expect(fs.readFileSync(path.join(record.packagePath, "references", `${assets[0].id}.txt`), "utf8")).toBe("Known fixture text");
    expect(fs.readFileSync(path.join(record.packagePath, "SKILL.md"), "utf8")).toContain(`references/${assets[0].id}.txt`);
  });

  it("uses an explicitly referenced Process Skill without including its runtime implementation", () => {
    const f = fixture(); const source = path.join(f.directory, "process"); fs.mkdirSync(source);
    const base = f.document(); const agent = f.service.publish(base, crypto.randomUUID());
    const record = f.packages.getInstalled(agent.key!, agent.digest!)!;
    const manifest = JSON.parse(fs.readFileSync(path.join(record.packagePath, "cctools.skill.yaml"), "utf8"));
    Object.assign(manifest, { id: "process-fixture", kind: "process", entrypoint: { runtime: "shell", script: "run.sh", args: [] }, runtime: { version: ">=1.0.0", dependencyFile: "runtime.txt" } });
    fs.writeFileSync(path.join(source, "cctools.skill.yaml"), JSON.stringify(manifest));
    fs.writeFileSync(path.join(source, "run.sh"), "echo fixture\n"); fs.writeFileSync(path.join(source, "runtime.txt"), "fixture\n");
    fs.writeFileSync(path.join(source, "SKILL.md"), "---\nname: process-fixture\ndescription: Fixture process\n---\nUse the process entrypoint.\n");
    const installed = f.packages.install(source);
    const doc = f.document(); doc.instructions[0].skills = [{ key: installed.key, digest: installed.digest }];
    const wrapped = f.service.publish(doc, crypto.randomUUID());
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
