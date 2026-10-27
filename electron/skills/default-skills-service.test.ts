import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ALL_SKILL_IDS } from "../../shared/skill-compatibility-matrix";
import { OPENMIND_SKILLS_REPO_URL } from "../../shared/skill-package-sources";
import { buildAppPaths, ensureAppPaths } from "../paths/app-paths-service";
import { SkillPackageService } from "./skill-package-service";
import type { SkillSourceService } from "./skill-source-service";
import { DefaultSkillsService } from "./default-skills-service";
import { installBuiltinDefault, removeManagedWikiGenerator } from "./builtin-default-packages";
import { SkillLibraryService } from "./skill-library-service";

const roots: string[] = [];
const bundle = path.resolve(__dirname, "../../.build/skill-library");
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });
function harness() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "builtin-defaults-")); roots.push(root);
  const content = path.join(root, "content"); fs.mkdirSync(content);
  const paths = buildAppPaths(path.join(root, "user-data"), path.join(content, ".agent", "skills")); ensureAppPaths(paths);
  const packages = new SkillPackageService(paths);
  const sources = { install: vi.fn(async () => { throw new Error("Git installation must not be called"); }) } as unknown as SkillSourceService;
  const automation = { stop: vi.fn(async () => undefined), refresh: vi.fn(async () => undefined), setEnabled: vi.fn(async (_enabled: boolean) => undefined) };
  const service = new DefaultSkillsService(packages, sources, automation, () => false, bundle);
  const legacy = (id: string, locator = OPENMIND_SKILLS_REPO_URL) => {
    const source = path.join(root, "old", id); fs.cpSync(path.join(bundle, "rss-article-saver"), source, { recursive: true });
    const manifest = JSON.parse(fs.readFileSync(path.join(source, "openmind.skill.yaml"), "utf8"));
    manifest.id = id; manifest.publisher = { id: "cctools", displayName: "cctools" };
    fs.writeFileSync(path.join(source, "openmind.skill.yaml"), JSON.stringify(manifest));
    return packages.install(source, { sourceType: "git", sourceLocator: locator });
  };
  return { root, content, paths, packages, sources, automation, service, legacy };
}
describe("built-in defaults", () => {
  it("installs all fifteen kinds locally and keeps packages and content when disabled", async () => {
    const h = harness(); await h.service.setEnabled(true);
    expect(h.packages.listInstalled().map(row => row.id).sort()).toEqual([...ALL_SKILL_IDS].sort());
    expect(h.packages.listInstalled().every(row => row.sourceType === "builtin" && row.publisherId === "openmind-library")).toBe(true);
    expect(h.sources.install).not.toHaveBeenCalled();
    fs.mkdirSync(path.join(h.content, "article")); fs.writeFileSync(path.join(h.content, "article/saved.md"), "keep");
    await h.service.setEnabled(false);
    expect(h.packages.listInstalled()).toHaveLength(15); expect(fs.readFileSync(path.join(h.content, "article/saved.md"), "utf8")).toBe("keep");
  });
  it("migrates a proven official identity and preserves its disabled preference", () => {
    const h = harness(); const old = h.legacy("rss-article-saver"); h.packages.setEnabled(old.key, old.digest, false);
    const current = installBuiltinDefault(h.packages, old.id, bundle);
    expect(current.key).toBe("openmind-library/rss-article-saver"); expect(h.packages.getInstalled(old.key)).toBeUndefined(); expect(h.packages.isEnabled(current)).toBe(false);
    expect(installBuiltinDefault(h.packages, old.id, bundle)).toEqual(current);
    expect(fs.readdirSync(h.paths.migrations).length).toBeGreaterThan(0);
  });
  it("preserves third-party, user-retained and modified packages on conflicts", () => {
    const h = harness(); const old = h.legacy("rss-article-saver", "https://github.com/example/custom");
    expect(() => installBuiltinDefault(h.packages, old.id, bundle)).toThrow(/conflict/); expect(h.packages.getInstalled(old.key)).toBeTruthy();
    h.packages.uninstall(old.key, old.digest);
    const official = h.legacy("rss-article-saver");
    expect(() => installBuiltinDefault(h.packages, official.id, bundle, () => true)).toThrow(/conflict/);
    fs.appendFileSync(path.join(official.packagePath, "pipeline.py"), "\n# user modification\n");
    expect(() => installBuiltinDefault(h.packages, official.id, bundle)).toThrow(/digest/); expect(fs.readFileSync(path.join(official.packagePath, "pipeline.py"), "utf8")).toContain("user modification");
  });
  it("resumes a migration interrupted after installation without re-enabling the old disabled skill", () => {
    const h = harness(); const old = h.legacy("rss-article-saver");
    h.packages.setEnabled(old.key, old.digest, false);
    const enable = vi.spyOn(h.packages, "setEnabled").mockImplementationOnce(() => { throw new Error("simulated interruption"); });
    expect(() => installBuiltinDefault(h.packages, old.id, bundle)).toThrow("simulated interruption");
    const journalPath = path.join(h.paths.migrations, fs.readdirSync(h.paths.migrations).find(name => name.startsWith("builtin-skills-"))!);
    expect(JSON.parse(fs.readFileSync(journalPath, "utf8")).packages[old.id]).toMatchObject({ status: "pending", enabled: false, from: old.key });
    enable.mockRestore();
    const recovered = installBuiltinDefault(h.packages, old.id, bundle);
    expect(h.packages.isEnabled(recovered)).toBe(false);
    expect(h.packages.listInstalled()).toHaveLength(1);
    expect(JSON.parse(fs.readFileSync(journalPath, "utf8")).packages[old.id]).toMatchObject({ status: "complete", to: recovered.key, from: old.key });
  });
  it("respects the persistent user-retained registry even when called from the CLI without a callback", () => {
    const h = harness(); const old = h.legacy("rss-article-saver");
    new SkillLibraryService(h.content, h.paths, h.packages, bundle).retainUserInstall(old.key);
    expect(() => installBuiltinDefault(h.packages, old.id, bundle)).toThrow(/conflict/);
    expect(h.packages.getInstalled(old.key)).toEqual(old);
  });
  it("removes only the proven wiki package while keeping history and imported copies", () => {
    const h = harness(); const wiki = h.legacy("knowledge-wiki-compiler");
    fs.mkdirSync(path.join(h.content, "wiki")); fs.writeFileSync(path.join(h.content, "wiki/old.md"), "history");
    removeManagedWikiGenerator(h.packages, () => false); expect(h.packages.getInstalled(wiki.key)).toBeUndefined(); expect(fs.existsSync(wiki.packagePath)).toBe(false);
    expect(fs.readFileSync(path.join(h.content, "wiki/old.md"), "utf8")).toBe("history");
    const custom = h.legacy("knowledge-wiki-compiler", "https://github.com/example/wiki");
    removeManagedWikiGenerator(h.packages, () => false); expect(h.packages.getInstalled(custom.key)).toBeTruthy();
  });
  it("does not replace any package while stopping active jobs fails", async () => {
    const h = harness(); h.automation.stop.mockRejectedValue(new Error("still running"));
    await expect(h.service.setEnabled(true)).rejects.toThrow("still running"); expect(h.packages.listInstalled()).toEqual([]);
  });
});
