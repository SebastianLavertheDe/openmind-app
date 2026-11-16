import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AiSessionSkillSnapshotSchema } from "../../shared/contracts";
import { SkillSelectionInputSchema } from "../../shared/skill-library";
import { buildAppPaths, ensureAppPaths } from "../paths/app-paths-service";
import { RuntimeManager } from "../runtime/runtime-manager";
import { SkillToolRegistry } from "../ai/skill-tool-registry";
import { skillDiscoveryInstructions } from "../ai/skill-discovery";
import { InstalledSkillExecutionResolver } from "./installed-skill-execution-resolver";
import { SkillPackageService } from "./skill-package-service";
import { SkillLibraryService } from "./skill-library-service";
import { RemoteSkillRegistry } from "./remote-skill-registry";
import { publishSkillRegistry } from "./skill-registry-publisher";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "openmind-original-skills-")); roots.push(root);
  const config = path.join(root, "config"), content = path.join(root, "content");
  fs.mkdirSync(content);
  const packageRoot = path.join(config, "packages", "original-source");
  const original = new Map([
    ["SKILL.md", "---\nname: shared-original\ndescription: Original repository entrypoint\n---\n# Original root\n"],
    ["skills/first-skill/SKILL.md", "---\nname: first-skill\ndescription: First original capability\n---\n# FIRST_ORIGINAL\nRead ../../resources/source.txt.\n"],
    ["skills/second-skill/SKILL.md", "---\nname: second-skill\ndescription: Second original capability\n---\n# SECOND_ORIGINAL\nRead ../../resources/source.txt.\n"],
    ["resources/source.txt", "Shared original resource.\n"],
    ["LICENSE", "Original source license.\n"]
  ]);
  for (const [file, bytes] of original) {
    fs.mkdirSync(path.dirname(path.join(packageRoot, file)), { recursive: true });
    fs.writeFileSync(path.join(packageRoot, file), bytes);
  }
  fs.writeFileSync(path.join(config, "catalog.json"), JSON.stringify({ schemaVersion: 1,
    executionRules: ["APP_RULE_MUST_NOT_REWRITE_ORIGINAL"],
    skills: ["first-skill", "second-skill"].map(id => ({ id, category: "image", packageDirectory: "original-source",
      packageId: "shared-original", skillPath: `skills/${id}/SKILL.md`,
      upstream: { repository: "https://example.test/original", revision: "a".repeat(40) },
      display: { en: { title: id, subtitle: `Original ${id}` } } })) }));
  const registryRoot = path.join(root, "registry");
  const published = publishSkillRegistry(config, registryRoot);
  const bundle = path.join(root, "empty-bundle"); fs.mkdirSync(bundle);
  fs.writeFileSync(path.join(bundle, "catalog.json"), JSON.stringify({ schemaVersion: 1, skills: [] }));
  const paths = buildAppPaths(path.join(root, "state"), path.join(content, ".agent", "skills")); ensureAppPaths(paths);
  const packages = new SkillPackageService(paths);
  const service = new SkillLibraryService(content, paths, packages, bundle, new RemoteSkillRegistry(paths, registryRoot));
  const resolver = new InstalledSkillExecutionResolver(packages, new RuntimeManager(paths), content, 1);
  const tools = new SkillToolRegistry(content, { paths, openmindRoot: content, rootGeneration: 1, installedResolver: resolver });
  return { root, content, paths, packages, service, resolver, tools, published, registryRoot, original, bundle };
}

describe("original Skill cards with one shared installation", () => {
  it("publishes one ZIP, preserves every original file and selects independent original instructions", async () => {
    const f = fixture();
    expect(f.published.skills).toHaveLength(2);
    expect(new Set(f.published.skills.map(entry => entry.package.path)).size).toBe(1);
    expect(fs.readdirSync(path.join(f.registryRoot, "packages"))).toHaveLength(1);
    const first = await f.service.installFromCatalog("first-skill");
    const reinstall = vi.spyOn(f.packages, "install");
    const second = await f.service.installFromCatalog("second-skill");
    expect(reinstall).not.toHaveBeenCalled();
    expect(first.key).toBe(second.key);
    expect(first.digest).toBe(second.digest);
    expect(first.entrypoint).not.toBe(second.entrypoint);
    expect(f.packages.listInstalled()).toHaveLength(1);
    const installed = f.packages.listInstalled()[0];
    for (const [file, original] of f.original) expect(fs.readFileSync(path.join(installed.packagePath, file), "utf8")).toBe(original);
    expect(f.service.prompt(first.id)).toContain("FIRST_ORIGINAL");
    expect(f.service.prompt(first.id)).not.toContain("APP_RULE_MUST_NOT_REWRITE_ORIGINAL");
    expect(f.service.prompt(second.id)).toContain("SECOND_ORIGINAL");
    const snapshot = AiSessionSkillSnapshotSchema.parse(f.resolver.captureSessionSnapshot());
    expect(snapshot.map(entry => entry.definition.id)).toEqual(["first-skill", "second-skill"]);
    for (const card of [first, second]) {
      const selection = { key: card.key!, digest: card.digest!, entrypoint: card.entrypoint };
      const selected = f.tools.resolveSelection(selection, snapshot, "picker");
      const bridge = f.tools.providerSkillBridge(selected)!;
      expect(bridge.id).toBe(card.id);
      expect(bridge.instructions).toBe(f.original.get(card.entrypoint!));
      const catalog = f.tools.providerSkillCatalog([selected]);
      expect(skillDiscoveryInstructions(catalog)).not.toContain(bridge.skillPath);
      expect(skillDiscoveryInstructions(catalog, undefined, selected.definition.id)).toContain(JSON.stringify(bridge.skillPath));
    }
    const offline = new SkillLibraryService(f.content, f.paths, f.packages, f.bundle, new RemoteSkillRegistry(f.paths, null));
    expect(offline.list().map(entry => entry.skillId)).toEqual(["first-skill", "second-skill"]);
  });

  it("rejects catalog entrypoints that do not belong to the verified original package", async () => {
    const f = fixture();
    const catalogFile = path.join(f.registryRoot, "catalog.json");
    const catalog = JSON.parse(fs.readFileSync(catalogFile, "utf8"));
    catalog.skills[0].preset.skillPath = "skills/second-skill/SKILL.md";
    fs.writeFileSync(catalogFile, JSON.stringify(catalog));
    await f.service.snapshot(true);
    await expect(f.service.installFromCatalog("first-skill")).rejects.toThrow();
    expect(f.packages.listInstalled()).toHaveLength(0);
  });

  it("rejects forged entrypoints and detects changes to shared original resources", async () => {
    const f = fixture();
    const card = await f.service.installFromCatalog("first-skill");
    const snapshot = f.resolver.captureSessionSnapshot();
    expect(SkillSelectionInputSchema.safeParse({ key: card.key, digest: card.digest, entrypoint: "../SKILL.md" }).success).toBe(false);
    expect(() => f.tools.resolveSelection({ key: card.key!, digest: card.digest!, entrypoint: "SKILL.md" }, snapshot, "picker")).toThrow();
    expect(() => f.resolver.providerSkillBridge({ ...snapshot[0], installed: { ...snapshot[0].installed!, entrypoint: "SKILL.md" } })).toThrow();
    const installed = f.packages.listInstalled()[0];
    fs.appendFileSync(path.join(installed.packagePath, "resources/source.txt"), "Changed bytes");
    expect(() => f.resolver.providerSkillBridge(snapshot[0])).toThrow();
  });
});
