import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BUILTIN_SKILL_IDS } from "../../shared/skill-registry";
import { SkillLibraryCatalogSchema } from "../../shared/skill-library-catalog";
import { getLocale, setLocale } from "../../shared/messages";
import { OPENMIND_SKILLS_REPO_URL } from "../../shared/skill-package-sources";
import { buildAppPaths, ensureAppPaths } from "../paths/app-paths-service";
import { prepareSkillLibraryBundle } from "./skill-library-bundle";
import { SkillLibraryService } from "./skill-library-service";
import { SkillPackageService } from "./skill-package-service";
import { publishSkillRegistry } from "./skill-registry-publisher";
import { RemoteSkillPackageUnavailableError, RemoteSkillRegistry } from "./remote-skill-registry";
import { resolveSkillRegistrySource } from "./skill-registry-source";
import { InstalledSkillExecutionResolver } from "./installed-skill-execution-resolver";
import { RuntimeManager } from "../runtime/runtime-manager";

const roots: string[] = [];
const initialLocale = getLocale();
afterEach(() => {
  vi.unstubAllEnvs(); vi.restoreAllMocks(); setLocale(initialLocale);
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

function fixture(production = false) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "openmind-remote-library-")); roots.push(root);
  const content = path.join(root, "content"); fs.mkdirSync(content);
  const paths = buildAppPaths(path.join(root, "state"), path.join(content, ".agent/skills")); ensureAppPaths(paths);
  const config = production ? path.resolve("config/skill-library") : path.join(root, "config");
  const definition = SkillLibraryCatalogSchema.parse({ schemaVersion: 1, executionRules: ["Cite supplied evidence."], skills: [
    { id: "daily-topic-selector", category: "research", discoverable: false, instructions: ["Local instructions."], display: { en: { title: "Local builtin" } } },
    { id: "new-remote-card", category: "writing", recommended: true, instructions: ["Remote instructions."], display: { en: { title: "New remote card" } } }
  ] });
  const write = () => fs.writeFileSync(path.join(config, "catalog.json"), JSON.stringify(definition));
  if (!production) { fs.mkdirSync(config); write(); }
  const bundle = path.join(root, ".build/skill-library");
  prepareSkillLibraryBundle(config, bundle, { includeIds: BUILTIN_SKILL_IDS });
  const source = path.join(root, "skill-registry");
  const published = publishSkillRegistry(config, source);
  const packages = new SkillPackageService(paths);
  const registry = new RemoteSkillRegistry(paths, source);
  const service = new SkillLibraryService(content, paths, packages, bundle, registry);
  return { root, content, paths, config, definition, write, bundle, source, published, packages, registry, service };
}

describe("remote Skill library integration", () => {
  it("discovers new cards and previews prompts without downloading or installing packages", async () => {
    const f = fixture();
    const acquire = vi.spyOn(f.registry, "packageFile");
    const first = await f.service.snapshot();
    expect(first.remote.state).toBe("fresh");
    expect(first.entries.find(entry => entry.id === "new-remote-card")).toMatchObject({ distribution: "remote", recommended: true, installed: false });
    expect(f.service.prompt("new-remote-card")).toContain("Cite supplied evidence.");
    f.definition.skills.push({ ...f.definition.skills[1], id: "published-later" }); f.write();
    publishSkillRegistry(f.config, f.source);
    expect((await f.service.snapshot(true)).entries.map(entry => entry.id)).toContain("published-later");
    expect(acquire).not.toHaveBeenCalled();
    expect(f.packages.listInstalled()).toHaveLength(0);
  });

  it("installs a verified package, persists its catalog source, and reinstalls from cache offline", async () => {
    const f = fixture();
    const entry = await f.service.installFromCatalog("new-remote-card");
    expect(entry).toMatchObject({ installed: true, usable: true, enabled: true, updateAvailable: false });
    const record = f.packages.getInstalled(entry.key!, entry.digest!)!;
    expect(record).toMatchObject({ sourceType: "catalog", sourceLocator: f.source, sourcePackageRef: "new-remote-card", sourceRevision: f.published.skills[0].package.sha256 });
    expect(new SkillPackageService(f.paths).getInstalled(entry.key!, entry.digest!)).toMatchObject({ sourceType: "catalog" });
    expect(fs.readFileSync(path.join(record.packagePath, "SKILL.md"), "utf8")).toContain("Remote instructions.");
    fs.renameSync(f.source, `${f.source}-offline`);
    const offline = await f.service.snapshot(true);
    expect(offline.remote.state).toBe("cached");
    expect(offline.entries.find(item => item.id === entry.id)).toMatchObject({ installed: true, usable: true, cached: true });
    f.packages.uninstall(entry.key!, entry.digest!);
    expect(await f.service.installFromCatalog(entry.id)).toMatchObject({ installed: true, digest: entry.digest });
  });

  it("keeps installed rules until explicit update, and keeps them usable when a newer catalog is offline", async () => {
    const f = fixture();
    const original = await f.service.installFromCatalog("new-remote-card");
    f.definition.skills[1].version = "1.1.0";
    f.definition.skills[1].instructions = ["Updated remote instructions."]; f.write(); publishSkillRegistry(f.config, f.source);
    const pending = (await f.service.snapshot(true)).entries.find(entry => entry.id === original.id)!;
    expect(pending).toMatchObject({ updateAvailable: true, digest: original.digest, version: "1.0.0" });
    expect(f.service.prompt(original.id)).toContain("Remote instructions.");
    fs.renameSync(f.source, `${f.source}-offline`);
    expect((await f.service.snapshot(true)).entries.find(entry => entry.id === original.id)).toMatchObject({ updateAvailable: false, usable: true, digest: original.digest });
    fs.renameSync(`${f.source}-offline`, f.source);
    const updated = await f.service.installFromCatalog(original.id);
    expect(updated).toMatchObject({ version: "1.1.0", updateAvailable: false });
    expect(updated.digest).not.toBe(original.digest);
    expect(f.service.prompt(original.id)).toContain("Updated remote instructions.");
  });

  it("converts an existing bundled card only on explicit use", async () => {
    const f = fixture();
    const oldBundle = path.join(f.root, "old-bundle"); prepareSkillLibraryBundle(f.config, oldBundle);
    const oldService = new SkillLibraryService(f.content, f.paths, f.packages, oldBundle, new RemoteSkillRegistry(f.paths, null));
    const installed = oldService.installPreset("new-remote-card");
    expect((await f.service.snapshot()).entries.find(entry => entry.id === installed.id)).toMatchObject({ installed: true, digest: installed.digest });
    expect(f.packages.getInstalledById(installed.id)?.sourceType).toBe("builtin");
    await f.service.installFromCatalog(installed.id);
    expect(f.packages.getInstalledById(installed.id)).toMatchObject({ sourceType: "catalog", digest: installed.digest });
  });

  it.each(["directory-offline", "package-unreachable"])("uses the installed version if an advertised update becomes unavailable: %s", async failure => {
    const f = fixture();
    const installed = await f.service.installFromCatalog("new-remote-card");
    f.definition.skills[1].version = "1.1.0";
    f.definition.skills[1].instructions = ["New package that has not been downloaded."];
    f.write(); publishSkillRegistry(f.config, f.source);
    expect((await f.service.snapshot(true)).entries.find(entry => entry.id === installed.id)?.updateAvailable).toBe(true);
    if (failure === "directory-offline") fs.renameSync(f.source, `${f.source}-offline`);
    else vi.spyOn(f.registry, "packageFile").mockRejectedValue(new RemoteSkillPackageUnavailableError("Package unavailable"));
    expect(await f.service.installFromCatalog(installed.id)).toMatchObject({ digest: installed.digest, version: "1.0.0", usable: true });
    expect(f.service.prompt(installed.id)).toContain("Remote instructions.");
  });

  it("does not hide corrupted update archives behind an installed-version fallback", async () => {
    const f = fixture();
    const installed = await f.service.installFromCatalog("new-remote-card");
    f.definition.skills[1].instructions = ["Updated content."]; f.write();
    const update = publishSkillRegistry(f.config, f.source).skills[0];
    const archive = path.join(f.source, update.package.path);
    const bytes = fs.readFileSync(archive); bytes[0] ^= 1; fs.writeFileSync(archive, bytes);
    await expect(f.service.installFromCatalog(installed.id)).rejects.toThrow(/checksum/);
    expect(f.packages.getInstalled(installed.key!, installed.digest!)).toBeTruthy();
  });

  it("migrates an intact official legacy browser only on explicit use", async () => {
    const f = fixture(true);
    const legacy = f.packages.install(path.resolve("config/skill-library/packages/agent-browser"), {
      sourceType: "git", sourceLocator: OPENMIND_SKILLS_REPO_URL, sourcePackageRef: "agent-browser"
    });
    f.packages.setEnabled(legacy.key, legacy.digest, false);
    const snapshot = await f.service.snapshot();
    expect(snapshot.entries.find(entry => entry.id === "agent-browser")).toMatchObject({ installed: true, enabled: false, usable: true, updateAvailable: true, key: legacy.key });
    expect(f.packages.getInstalledById("agent-browser")).toMatchObject({ key: legacy.key, publisherId: "cctools", sourceType: "git" });
    expect(f.packages.isEnabled(legacy)).toBe(false);
    const updated = await f.service.installFromCatalog("agent-browser");
    expect(updated).toMatchObject({ installed: true, enabled: true, key: "openmind-library/agent-browser", updateAvailable: false });
    expect(f.packages.getInstalled(legacy.key, legacy.digest)).toBeUndefined();
    expect(f.packages.getInstalledById("agent-browser")).toMatchObject({ sourceType: "catalog", sourceLocator: f.source });
  });

  it("keeps an explicitly retained official Git browser separate from the directory card", async () => {
    const f = fixture(true);
    const legacy = f.packages.install(path.resolve("config/skill-library/packages/agent-browser"), {
      sourceType: "git", sourceLocator: OPENMIND_SKILLS_REPO_URL, sourcePackageRef: "agent-browser"
    });
    f.service.retainUserInstall(legacy.key);
    const snapshot = await f.service.snapshot();
    expect(snapshot.entries.find(entry => entry.id === "agent-browser")).toMatchObject({ installed: false, usable: false });
    expect(snapshot.entries.find(entry => entry.key === legacy.key)).toMatchObject({ installed: true, usable: true, origin: "git" });
    await expect(f.service.installFromCatalog("agent-browser")).rejects.toThrow();
    expect(f.packages.getInstalledById("agent-browser")).toMatchObject({ key: legacy.key, digest: legacy.digest, sourceType: "git", sourceLocator: OPENMIND_SKILLS_REPO_URL });
  });

  it("does not apply the legacy native migration exception to a generated preset", async () => {
    const f = fixture();
    const oldBundle = path.join(f.root, "legacy-bundle"); prepareSkillLibraryBundle(f.config, oldBundle);
    const source = path.join(oldBundle, "new-remote-card");
    const manifestFile = path.join(source, "openmind.skill.yaml");
    const manifest = JSON.parse(fs.readFileSync(manifestFile, "utf8"));
    manifest.publisher.id = "cctools";
    fs.writeFileSync(manifestFile, JSON.stringify(manifest));
    const legacy = f.packages.install(source, { sourceType: "git", sourceLocator: OPENMIND_SKILLS_REPO_URL });
    expect((await f.service.snapshot()).entries.find(entry => entry.id === "new-remote-card")).toMatchObject({ installed: false, usable: false });
    await expect(f.service.installFromCatalog("new-remote-card")).rejects.toThrow();
    expect(f.packages.getInstalled(legacy.key, legacy.digest)?.sourceType).toBe("git");
  });

  it.each(["git", "directory"] as const)("preserves an imported %s package with the same ID", async sourceType => {
    const f = fixture();
    const imported = f.packages.install(path.join(f.source, f.published.skills[0].package.path), { sourceType, sourceLocator: "https://example.com/another/source" });
    const snapshot = await f.service.snapshot();
    expect(snapshot.entries.find(entry => entry.id === "new-remote-card")).toMatchObject({ installed: false, usable: false });
    expect(snapshot.entries.find(entry => entry.key === imported.key)).toMatchObject({ installed: true, usable: true, origin: sourceType === "git" ? "git" : "local" });
    await expect(f.service.installFromCatalog("new-remote-card")).rejects.toThrow();
    expect(f.packages.getInstalled(imported.key, imported.digest)?.sourceType).toBe(sourceType);
  });

  it("does not overwrite an installed package from a different registry", async () => {
    const f = fixture();
    const installed = await f.service.installFromCatalog("new-remote-card");
    const other = path.join(f.root, "other-registry"); fs.cpSync(f.source, other, { recursive: true });
    const service = new SkillLibraryService(f.content, f.paths, f.packages, f.bundle, new RemoteSkillRegistry(f.paths, other));
    await expect(service.installFromCatalog(installed.id)).rejects.toThrow();
    expect(f.packages.getInstalled(installed.key!, installed.digest!)?.sourceLocator).toBe(f.source);
  });

  it.each(["digest", "version"] as const)("rejects a catalog/package %s mismatch and preserves the installed version", async field => {
    const f = fixture();
    const installed = await f.service.installFromCatalog("new-remote-card");
    if (field === "digest") f.published.skills[0].package.digest = "0".repeat(64);
    else f.published.skills[0].preset.version = "9.9.9";
    fs.writeFileSync(path.join(f.source, "catalog.json"), JSON.stringify(f.published));
    await expect(f.service.installFromCatalog(installed.id)).rejects.toThrow();
    expect(f.packages.getInstalled(installed.key!, installed.digest!)).toBeTruthy();
  });

  it("checks the project root again after download before installing", async () => {
    const f = fixture();
    const guard = vi.fn(() => { throw new Error("Root changed"); });
    await expect(f.service.installFromCatalog("new-remote-card", guard)).rejects.toThrow("Root changed");
    expect(guard).toHaveBeenCalledOnce();
    expect(f.packages.listInstalled()).toHaveLength(0);
  });

  it("preserves both card languages in the installed execution metadata without a registry cache", async () => {
    const f = fixture();
    f.definition.skills[1].display["zh-CN"] = { title: "远程写作", subtitle: "使用给定资料", inputHint: "提供写作要求" };
    f.write(); publishSkillRegistry(f.config, f.source);
    vi.stubEnv("OPENMIND_SKILL_LIBRARY_BUNDLE", f.bundle);
    setLocale("zh-CN");
    const installed = await f.service.installFromCatalog("new-remote-card");
    fs.rmSync(path.join(f.paths.cache, "skill-registry"), { recursive: true });
    fs.renameSync(f.source, `${f.source}-offline`);
    const resolver = new InstalledSkillExecutionResolver(f.packages, new RuntimeManager(f.paths), f.content, 1);
    expect(resolver.captureSessionSnapshot().find(entry => entry.definition.id === installed.id)?.definition).toMatchObject({ title: installed.title, inputHint: installed.inputHint });
    setLocale("en");
    expect(resolver.captureSessionSnapshot().find(entry => entry.definition.id === installed.id)?.definition.title).toBe("New remote card");
  });

  it("publishes and installs all fifteen actual cards including ten restored handraw packages", async () => {
    const f = fixture(true);
    const snapshot = await f.service.snapshot();
    expect(snapshot.entries.filter(entry => entry.distribution === "builtin")).toHaveLength(7);
    expect(snapshot.entries.filter(entry => entry.distribution === "remote")).toHaveLength(15);
    for (const remote of f.published.skills) {
      const installed = await f.service.installFromCatalog(remote.preset.id);
      expect(installed).toMatchObject({ installed: true, digest: remote.package.digest });
      const record = f.packages.getInstalled(installed.key!, installed.digest!)!;
      expect(f.packages.inspectInstalledCopy(record).valid).toBe(true);
      if (remote.preset.contributor?.nick === "yang0") expect(fs.readFileSync(path.join(record.packagePath, "ATTRIBUTION.md"), "utf8")).toContain("yang0/handraw-style");
    }
    expect(f.packages.listInstalled().filter(record => record.sourceType === "catalog")).toHaveLength(15);
  });
});

describe("Skill registry configuration", () => {
  it("defaults only development bundles to the repository directory and accepts settings/env overrides", () => {
    const f = fixture();
    vi.stubEnv("OPENMIND_SKILL_REGISTRY", "");
    expect(resolveSkillRegistrySource(f.paths, f.bundle)).toBe(f.source);
    const packaged = path.join(f.root, "resources/skill-library");
    expect(resolveSkillRegistrySource(f.paths, packaged)).toBeNull();
    fs.writeFileSync(path.join(f.paths.settings, "skill-registry.json"), JSON.stringify({ source: "https://example.com/skills/" }));
    expect(resolveSkillRegistrySource(f.paths, packaged)).toBe("https://example.com/skills/");
    vi.stubEnv("OPENMIND_SKILL_REGISTRY", f.source);
    expect(resolveSkillRegistrySource(f.paths, packaged)).toBe(f.source);
  });

  it("keeps local cards accessible when the registry configuration is invalid", async () => {
    const f = fixture();
    vi.stubEnv("OPENMIND_SKILL_REGISTRY", "");
    fs.writeFileSync(path.join(f.paths.settings, "skill-registry.json"), "invalid JSON");
    const service = new SkillLibraryService(f.content, f.paths, f.packages, f.bundle);
    const snapshot = await service.snapshot();
    expect(snapshot.remote.state).toBe("unavailable");
    expect(snapshot.entries.map(entry => entry.id)).toEqual(["daily-topic-selector"]);
  });
});
