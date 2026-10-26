import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AuthoredSkillSchema } from "../../shared/skill-library";
import { filterSkillLibrary } from "../../shared/skill-library";
import { buildAppPaths, ensureAppPaths } from "../paths/app-paths-service";
import { SkillPackageService } from "./skill-package-service";
import { SkillLibraryService } from "./skill-library-service";
import { InstalledSkillExecutionResolver } from "./installed-skill-execution-resolver";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });
function fixture() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "openmind-library-test-")); roots.push(directory);
  const content = path.join(directory, "content"); fs.mkdirSync(content);
  const paths = buildAppPaths(path.join(directory, "state"), path.join(content, ".agent", "skills")); ensureAppPaths(paths);
  const packages = new SkillPackageService(paths);
  const bundle = path.join(directory, "bundle");
  fs.mkdirSync(path.join(bundle, "om-research-brief"), { recursive: true });
  fs.writeFileSync(path.join(bundle, "om-research-brief", "SKILL.md"), "---\nname: om-research-brief\ndescription: Test research\n---\nRead the supplied evidence.\n");
  const digest = packages.inspect(path.join(bundle, "om-research-brief")).digest;
  fs.writeFileSync(path.join(bundle, "bundle.json"), JSON.stringify({ packages: { "om-research-brief": digest } }));
  const service = new SkillLibraryService(content, paths, packages, bundle);
  const document = () => { const doc = service.editor(); doc.name = `Skill ${doc.id.slice(0, 5)}`; doc.instructions[0].text = "Read the user's materials and produce a clear answer."; doc.inputHint = "What should I work on?"; return doc; };
  return { directory, content, paths, packages, service, document, bundle };
}

describe("Skill library and authoring", () => {
  it("keeps Explore separate from installed and authored Mine entries", () => {
    const f = fixture();
    expect(filterSkillLibrary(f.service.list(), "explore", "all")).toHaveLength(12);
    expect(filterSkillLibrary(f.service.list(), "mine", "all")).toHaveLength(0);
    const installed = f.service.installPreset("om-research-brief");
    expect(installed.installed && installed.enabled).toBe(true);
    expect(filterSkillLibrary(f.service.list(), "mine", "all")).toHaveLength(1);
    f.service.editor();
    expect(filterSkillLibrary(f.service.list(), "mine", "all")).toHaveLength(2);
    expect(filterSkillLibrary(f.service.list(), "mine", "github-installed")).toHaveLength(0);
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
    expect(filterSkillLibrary(f.service.list(), "mine", "research", "", "authored")).toHaveLength(0);
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
