import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { unzipSync } from "fflate";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BUILTIN_SKILL_IDS, RemoteSkillCatalogSchema } from "../../shared/skill-registry";
import { buildAppPaths } from "../paths/app-paths-service";
import { prepareSkillLibraryBundle } from "./skill-library-bundle";
import { readSkillLibraryCatalog } from "./skill-library-catalog";
import { SkillPackageService } from "./skill-package-service";
import { publishSkillRegistry } from "./skill-registry-publisher";

const roots: string[] = [];
afterEach(() => { vi.unstubAllEnvs(); for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "openmind-registry-publish-")); roots.push(root);
  const config = path.join(root, "config"); fs.mkdirSync(config);
  const definition = { schemaVersion: 1, skills: [{ id: "independent-card", category: "writing", instructions: ["Use the user's supplied evidence."], display: { en: { title: "Independent card" } } }] };
  fs.writeFileSync(path.join(config, "catalog.json"), JSON.stringify(definition));
  return { root, config, output: path.join(root, "registry"), definition };
}

describe("remote Skill registry publication", () => {
  it("ships only the seven built-ins and publishes the other fifteen with credits and presentation", () => {
    const f = fixture();
    const config = path.resolve("config/skill-library");
    const sourceCatalog = fs.readFileSync(path.join(config, "catalog.json"), "utf8");
    const bundled = path.join(f.root, "app-bundle");
    expect(prepareSkillLibraryBundle(config, bundled, { includeIds: BUILTIN_SKILL_IDS })).toBe(7);
    expect(readSkillLibraryCatalog(bundled).skills.map(entry => entry.id).sort()).toEqual([...BUILTIN_SKILL_IDS].sort());
    const registry = publishSkillRegistry(config, f.output);
    expect(registry.skills).toHaveLength(15);
    expect(registry.skills.every(entry => !BUILTIN_SKILL_IDS.includes(entry.preset.id as typeof BUILTIN_SKILL_IDS[number]))).toBe(true);
    expect(registry.skills.filter(entry => entry.preset.recommended)).toHaveLength(5);
    expect(registry.skills.filter(entry => entry.coverDataUrl?.startsWith("data:image/jpeg;base64,"))).toHaveLength(5);
    const commonRules = readSkillLibraryCatalog(config).executionRules;
    for (const entry of registry.skills) expect(entry.preset.instructions.slice(-commonRules.length)).toEqual(commonRules);
    const browserPreview = registry.skills.find(entry => entry.preset.id === "agent-browser")!.preset.instructions.join("\n\n");
    expect(browserPreview).toContain("# Browser Automation with agent-browser");
    expect(browserPreview).not.toContain("name: agent-browser");
    const handraw = registry.skills.filter(entry => entry.preset.contributor?.nick === "yang0");
    expect(handraw).toHaveLength(10);
    for (const entry of handraw) {
      expect(entry.avatarDataUrl).toMatch(/^data:image\/jpeg;base64,/);
      const files = unzipSync(fs.readFileSync(path.join(f.output, entry.package.path)));
      expect(Buffer.from(files["ATTRIBUTION.md"]).toString()).toContain("yang0/handraw-style");
      expect(files["avatars/yang0.jpg"]).toBeDefined();
    }
    expect(fs.readFileSync(path.join(config, "catalog.json"), "utf8")).toBe(sourceCatalog);
    expect(fs.readdirSync(bundled).some(file => file.endsWith(".zip"))).toBe(false);
  });

  it("publishes new cards without an App build, external checkout or changes to source", () => {
    const f = fixture();
    vi.stubEnv("OPENMIND_SKILLS_REPO_ROOT", path.join(f.root, "missing-external-repository"));
    const before = fs.readFileSync(path.join(f.config, "catalog.json"), "utf8");
    const first = publishSkillRegistry(f.config, f.output);
    expect(first.skills.map(entry => entry.preset.id)).toEqual(["independent-card"]);
    const entry = first.skills[0];
    const archive = path.join(f.output, entry.package.path);
    const bytes = fs.readFileSync(archive);
    expect(entry.package.size).toBe(bytes.length);
    expect(entry.package.sha256).toBe(crypto.createHash("sha256").update(bytes).digest("hex"));
    const inspector = new SkillPackageService(buildAppPaths(path.join(f.root, "state"), path.join(f.root, "installed")));
    const inspected = inspector.inspect(archive);
    expect(inspected.valid).toBe(true);
    expect(inspected.digest).toBe(entry.package.digest);
    expect(inspected.manifest?.publisher.id).toBe("openmind-library");
    expect(fs.readFileSync(path.join(f.config, "catalog.json"), "utf8")).toBe(before);
    expect(fs.existsSync(path.join(f.root, ".build"))).toBe(false);

    f.definition.skills.push({ ...f.definition.skills[0], id: "new-card" });
    fs.writeFileSync(path.join(f.config, "catalog.json"), JSON.stringify(f.definition));
    expect(publishSkillRegistry(f.config, f.output).skills.map(value => value.preset.id)).toEqual(["independent-card", "new-card"]);
  });

  it("creates deterministic ZIPs and retains old package hashes during updates", () => {
    const f = fixture();
    const first = publishSkillRegistry(f.config, f.output).skills[0];
    const repeated = publishSkillRegistry(f.config, f.output).skills[0];
    expect(repeated.package).toEqual(first.package);
    f.definition.skills[0].instructions.push("Write the complete revised answer.");
    fs.writeFileSync(path.join(f.config, "catalog.json"), JSON.stringify(f.definition));
    const changed = publishSkillRegistry(f.config, f.output).skills[0];
    expect(changed.package.sha256).not.toBe(first.package.sha256);
    expect(fs.existsSync(path.join(f.output, first.package.path))).toBe(true);
    expect(fs.existsSync(path.join(f.output, changed.package.path))).toBe(true);
  });

  it("keeps the previous published catalog and packages when validation fails", () => {
    const f = fixture();
    publishSkillRegistry(f.config, f.output);
    const previous = fs.readFileSync(path.join(f.output, "catalog.json"));
    const packages = fs.readdirSync(path.join(f.output, "packages"));
    fs.writeFileSync(path.join(f.config, "catalog.json"), JSON.stringify({ ...f.definition, skills: [
      f.definition.skills[0], { ...f.definition.skills[0], id: "broken-card", files: ["missing.md"] }
    ] }));
    expect(() => publishSkillRegistry(f.config, f.output)).toThrow();
    expect(fs.readFileSync(path.join(f.output, "catalog.json"))).toEqual(previous);
    expect(fs.readdirSync(path.join(f.output, "packages"))).toEqual(packages);
  });

  it("reports the inspected native package version instead of the preset default", () => {
    const f = fixture();
    const sourceBundle = path.join(f.root, "source-bundle");
    prepareSkillLibraryBundle(f.config, sourceBundle);
    const packageRoot = path.join(f.config, "packages", "native");
    fs.cpSync(path.join(sourceBundle, "independent-card"), packageRoot, { recursive: true });
    const manifestFile = path.join(packageRoot, "openmind.skill.yaml");
    const manifest = JSON.parse(fs.readFileSync(manifestFile, "utf8"));
    manifest.version = "2.3.4";
    fs.writeFileSync(manifestFile, JSON.stringify(manifest));
    fs.writeFileSync(path.join(f.config, "catalog.json"), JSON.stringify({ ...f.definition, skills: [{ ...f.definition.skills[0], packageDirectory: "native" }] }));
    expect(publishSkillRegistry(f.config, f.output).skills[0].preset.version).toBe("2.3.4");
  });

  it("rejects catalogs with built-in replacements, duplicate IDs and unsafe metadata", () => {
    const f = fixture();
    const catalog = publishSkillRegistry(f.config, f.output);
    const entry = catalog.skills[0];
    expect(RemoteSkillCatalogSchema.safeParse({ ...catalog, skills: [entry, entry] }).success).toBe(false);
    expect(RemoteSkillCatalogSchema.safeParse({ ...catalog, skills: [{ ...entry, preset: { ...entry.preset, id: BUILTIN_SKILL_IDS[0] } }] }).success).toBe(false);
    for (const packagePath of ["../escape.zip", "https://example.com/a.zip", "packages/%2e%2e.zip", "packages/../../escape.zip"]) {
      expect(RemoteSkillCatalogSchema.safeParse({ ...catalog, skills: [{ ...entry, package: { ...entry.package, path: packagePath } }] }).success).toBe(false);
    }
    expect(RemoteSkillCatalogSchema.safeParse({ ...catalog, skills: [{ ...entry, coverDataUrl: "data:image/svg+xml;base64,PHN2Zz4=" }] }).success).toBe(false);
    expect(RemoteSkillCatalogSchema.safeParse({ ...catalog, skills: [{ ...entry, package: { ...entry.package, size: 65 * 1024 * 1024 } }] }).success).toBe(false);
  });

  it("does not write a generated registry into its source tree", () => {
    const f = fixture();
    expect(() => publishSkillRegistry(f.config, path.join(f.config, "output"))).toThrow("separate from Skill sources");
    expect(() => publishSkillRegistry(f.config, f.root)).toThrow("separate from Skill sources");
  });
});
