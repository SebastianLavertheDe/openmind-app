import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildAppPaths, ensureAppPaths } from "../paths/app-paths-service";
import { SkillPackageService } from "../skills/skill-package-service";
import { InstalledSkillExecutionResolver } from "../skills/installed-skill-execution-resolver";
import { RuntimeManager } from "../runtime/runtime-manager";
import { SkillToolRegistry } from "./skill-tool-registry";
import { skillDiscoveryInstructions } from "./skill-discovery";
import { buildProviderSkillContext } from "./providers/skill-bridge";

describe("Installed Skill automatic discovery", () => {
  let root: string;
  beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), "openmind-discovery-")); });
  afterEach(() => { fs.rmSync(root, { recursive: true, force: true }); });

  function fixture() {
    const contentRoot = path.join(root, "content");
    const paths = buildAppPaths(path.join(root, "userdata"), path.join(contentRoot, ".agent", "skills"));
    ensureAppPaths(paths);
    const source = path.join(root, "skill");
    fs.mkdirSync(source);
    fs.writeFileSync(path.join(source, "SKILL.md"), "---\nname: browser-skill\ndescription: Read logged-in pages and capture screenshots\n---\n# PRIVATE_FULL_INSTRUCTIONS\nUse bsk.\n");
    const packages = new SkillPackageService(paths);
    const installed = packages.install(source);
    const resolver = new InstalledSkillExecutionResolver(packages, new RuntimeManager(paths), contentRoot, 1);
    const registry = new SkillToolRegistry(contentRoot, { paths, openmindRoot: contentRoot, rootGeneration: 1, installedResolver: resolver });
    return { packages, installed, registry };
  }

  it("discovers a differently named source directory and supplies metadata for progressive loading", () => {
    const { installed, registry } = fixture();
    const catalog = registry.providerSkillCatalog(registry.captureSessionSnapshot());
    expect(installed.packagePath).toContain(`${path.sep}browser-skill`);
    expect(catalog).toHaveLength(1);
    const instructions = skillDiscoveryInstructions(catalog);
    expect(instructions).toContain("Read logged-in pages and capture screenshots");
    expect(instructions).toContain(installed.packagePath);
    expect(instructions).toContain("无需用户输入斜杠命令");
    expect(instructions).toContain("必须先用文件读取工具读取对应 SKILL.md");
    expect(instructions).not.toContain("PRIVATE_FULL_INSTRUCTIONS");
    expect(fs.readFileSync(catalog[0].skillPath, "utf8")).toContain("PRIVATE_FULL_INSTRUCTIONS");
  });

  it("excludes disabled and tampered packages instead of falling back to an unmanaged Skill directory", () => {
    const { packages, installed, registry } = fixture();
    packages.setEnabled(installed.key, installed.digest, false);
    expect(registry.captureSessionSnapshot()).toEqual([]);
    packages.setEnabled(installed.key, installed.digest, true);
    fs.appendFileSync(path.join(installed.packagePath, "SKILL.md"), "tampered\n");
    expect(registry.captureSessionSnapshot()).toEqual([]);
    expect(skillDiscoveryInstructions([])).toBe("");
  });

  it("does not invent capability denials for a standard Agent Skill without a manifest", () => {
    const { registry } = fixture();
    const bridge = registry.providerSkillBridge(registry.captureSessionSnapshot()[0])!;
    expect(bridge.capabilitiesDeclared).toBe(false);
    const context = buildProviderSkillContext(bridge);
    expect(context).toContain("current_session_permissions_apply");
    expect(context).not.toContain("browser_allowed: false");
    expect(context).not.toContain("subprocess_allowed: false");
  });

  it("maps physical package paths into the provider runtime", () => {
    const { registry } = fixture();
    const catalog = registry.providerSkillCatalog(registry.captureSessionSnapshot());
    const instructions = skillDiscoveryInstructions(catalog, (value) => `/mapped${value}`);
    expect(instructions).toContain(`/mapped${catalog[0].skillPath}`);
  });
});
