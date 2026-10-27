import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PNG } from "pngjs";
import { prepareSkillLibraryBundle } from "./skill-library-bundle";
import { readSkillLibraryCatalog } from "./skill-library-catalog";

const roots: string[] = [];
afterEach(() => { vi.unstubAllEnvs(); for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });

function fixture(files: Array<string | { source: string; target: string }> = []) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "openmind-library-bundle-")); roots.push(root);
  const config = path.join(root, "config"); fs.mkdirSync(config);
  fs.writeFileSync(path.join(config, "catalog.json"), JSON.stringify({ schemaVersion: 1, executionRules: ["Preserve existing files."], skills: [{ id: "new-independent-skill", instructions: ["Follow the supplied evidence."], files, category: "writing", display: { en: { title: "Independent skill" } } }] }));
  return { root, config, output: path.join(root, "output") };
}

describe("App-owned Skill bundle", () => {
  it("builds solely from configuration with no GitHub checkout", () => {
    const f = fixture(); vi.stubEnv("OPENMIND_SKILLS_REPO_ROOT", path.join(f.root, "does-not-exist"));
    expect(prepareSkillLibraryBundle(f.config, f.output)).toBe(1);
    const skill = path.join(f.output, "new-independent-skill");
    const manifest = JSON.parse(fs.readFileSync(path.join(skill, "openmind.skill.yaml"), "utf8"));
    expect(manifest.publisher.id).toBe("openmind-library");
    expect(fs.readFileSync(path.join(skill, "SKILL.md"), "utf8")).toContain("Follow the supplied evidence.\n\nPreserve existing files.");
    expect(readSkillLibraryCatalog(f.output).skills[0].id).toBe("new-independent-skill");
    expect(JSON.parse(fs.readFileSync(path.join(f.output, "bundle.json"), "utf8"))).toMatchObject({ source: "openmind:skill-library", packages: { "new-independent-skill": expect.stringMatching(/^[a-f0-9]{64}$/) } });
  });

  it("includes declared assets and keeps the previous bundle on validation failure", () => {
    const f = fixture(["scripts/run.py"]);
    const asset = path.join(f.config, "assets/new-independent-skill/scripts/run.py");
    fs.mkdirSync(path.dirname(asset), { recursive: true }); fs.writeFileSync(asset, "print('fixture')\n");
    prepareSkillLibraryBundle(f.config, f.output);
    expect(fs.readFileSync(path.join(f.output, "new-independent-skill/scripts/run.py"), "utf8")).toBe("print('fixture')\n");
    const previous = fs.readFileSync(path.join(f.output, "bundle.json"), "utf8");
    fs.rmSync(asset);
    expect(() => prepareSkillLibraryBundle(f.config, f.output)).toThrow();
    expect(fs.readFileSync(path.join(f.output, "bundle.json"), "utf8")).toBe(previous);
  });

  it("rejects assets that would overwrite generated package instructions", () => {
    const f = fixture(["SKILL.md"]);
    expect(() => prepareSkillLibraryBundle(f.config, f.output)).toThrow("Reserved library asset");
  });

  it("copies explicitly mapped shared resources into independent packages", () => {
    const f = fixture([{ source: "_shared/reference.md", target: "references/style.md" }]);
    const asset = path.join(f.config, "assets/_shared/reference.md");
    fs.mkdirSync(path.dirname(asset), { recursive: true }); fs.writeFileSync(asset, "Shared reference and credit\n");
    prepareSkillLibraryBundle(f.config, f.output);
    fs.rmSync(asset);
    expect(fs.readFileSync(path.join(f.output, "new-independent-skill/references/style.md"), "utf8")).toBe("Shared reference and credit\n");
  });

  it.each(["SKILL.md", "skill.md", "openmind.library.json"])("rejects mapped resources targeting generated metadata: %s", target => {
    const f = fixture([{ source: "_shared/reference.md", target }]);
    expect(() => prepareSkillLibraryBundle(f.config, f.output)).toThrow("Reserved library asset");
  });

  it("rejects shared-resource symlinks escaping the assets directory", () => {
    const f = fixture([{ source: "_shared/escape.md", target: "references/escape.md" }]);
    const outside = path.join(f.root, "outside.md"); fs.writeFileSync(outside, "outside");
    const link = path.join(f.config, "assets/_shared/escape.md"); fs.mkdirSync(path.dirname(link), { recursive: true });
    fs.symlinkSync(outside, link);
    expect(() => prepareSkillLibraryBundle(f.config, f.output)).toThrow("Invalid library asset");
  });

  it("does not silently overwrite an asset through another declaration", () => {
    const f = fixture([{ source: "_shared/style.md", target: "references/style.md" }, { source: "_shared/style.md", target: "references/STYLE.md" }]);
    const asset = path.join(f.config, "assets/_shared/style.md"); fs.mkdirSync(path.dirname(asset), { recursive: true }); fs.writeFileSync(asset, "style");
    expect(() => prepareSkillLibraryBundle(f.config, f.output)).toThrow("Duplicate library asset");
  });

  it.each([false, true])("bundles avatars and rejects oversized assets before replacing a build (shared=%s)", shared => {
    const f = fixture(shared ? [{ source: "_shared/member.png", target: "avatars/member.png" }] : []);
    const catalogFile = path.join(f.config, "catalog.json");
    const catalog = JSON.parse(fs.readFileSync(catalogFile, "utf8"));
    catalog.skills[0].contributor = { nick: "@Contributor", avatar: "avatars/member.png" };
    fs.writeFileSync(catalogFile, JSON.stringify(catalog));
    const source = path.join(f.config, "assets", shared ? "_shared/member.png" : "new-independent-skill/avatars/member.png");
    const bytes = PNG.sync.write(new PNG({ width: 128, height: 128 }));
    fs.mkdirSync(path.dirname(source), { recursive: true }); fs.writeFileSync(source, bytes);
    prepareSkillLibraryBundle(f.config, f.output);
    const metadata = JSON.parse(fs.readFileSync(path.join(f.output, "new-independent-skill/openmind.library.json"), "utf8"));
    expect(metadata.contributor).toEqual({ nick: "Contributor", avatar: "avatars/member.png" });
    expect(fs.readFileSync(path.join(f.output, "new-independent-skill/avatars/member.png"))).toEqual(bytes);
    const previous = fs.readFileSync(path.join(f.output, "bundle.json"), "utf8");
    fs.writeFileSync(source, Buffer.concat([bytes, Buffer.alloc(100 * 1024)]));
    expect(() => prepareSkillLibraryBundle(f.config, f.output)).toThrow();
    expect(fs.readFileSync(path.join(f.output, "bundle.json"), "utf8")).toBe(previous);
  });
});
