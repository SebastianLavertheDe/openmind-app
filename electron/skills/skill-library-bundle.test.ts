import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { prepareSkillLibraryBundle } from "./skill-library-bundle";
import { readSkillLibraryCatalog } from "./skill-library-catalog";

const roots: string[] = [];
afterEach(() => { vi.unstubAllEnvs(); for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });

function fixture(files: string[] = []) {
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
});
