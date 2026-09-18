import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { browserSkillStatus, resolveBrowserSkillExecutable, type BrowserSkillCommand } from "./browser-skill";
import { buildAppPaths, ensureAppPaths } from "./paths/app-paths-service";
import { SkillPackageService } from "./skills/skill-package-service";

describe("BrowserSkill connection", () => {
  let root: string;
  let packages: SkillPackageService;
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "openmind-bsk-"));
    const paths = buildAppPaths(path.join(root, "userdata"), path.join(root, "content", ".agent", "skills"));
    ensureAppPaths(paths);
    packages = new SkillPackageService(paths);
  });
  afterEach(() => { fs.rmSync(root, { recursive: true, force: true }); });

  function install() {
    const source = path.join(root, "skill");
    fs.mkdirSync(source);
    fs.writeFileSync(path.join(source, "SKILL.md"), "---\nname: browser-skill\ndescription: Browser tasks\n---\nUse bsk.\n");
    return packages.install(source);
  }

  it("reports a missing Skill and CLI without executing a command", async () => {
    const run = vi.fn();
    expect(await browserSkillStatus(packages, null, run)).toMatchObject({ skillInstalled: false, cliAvailable: false, ready: false });
    expect(run).not.toHaveBeenCalled();
  });

  it("requires an enabled, intact package and a connected browser before reporting ready", async () => {
    const installed = install();
    const run = vi.fn<BrowserSkillCommand>(async (_exe, args) => args[0] === "--version" ? "bsk 0.3.0\n" : JSON.stringify({ browsers: [{ instance_id: "fixture" }] }));
    expect(await browserSkillStatus(packages, "/fixture/bsk", run, true)).toMatchObject({ cliVersion: "bsk 0.3.0", browserConnected: true, ready: true });
    expect(run.mock.calls[0][2]).toMatchObject({ BSK_AUTO_START: "1", BSK_BROWSER_WAIT_MS: "0" });
    packages.setEnabled(installed.key, installed.digest, false);
    expect(await browserSkillStatus(packages, "/fixture/bsk", run, true)).toMatchObject({ skillEnabled: false, ready: false });
    expect(run.mock.calls.at(-1)![2]).toMatchObject({ BSK_AUTO_START: "0" });
    packages.setEnabled(installed.key, installed.digest, true);
    fs.appendFileSync(path.join(installed.packagePath, "SKILL.md"), "tampered");
    expect(await browserSkillStatus(packages, "/fixture/bsk", run)).toMatchObject({ skillInstalled: false, ready: false });
  });

  it("distinguishes an installed CLI from a disconnected daemon or malformed status", async () => {
    install();
    const run = vi.fn<BrowserSkillCommand>(async (_exe, args) => args[0] === "--version" ? "bsk 0.3.0" : "invalid JSON");
    expect(await browserSkillStatus(packages, "/fixture/bsk", run)).toMatchObject({ cliAvailable: true, browserConnected: false, ready: false });
  });

  it("finds the CLI in a user-local bin without needing a shell profile", () => {
    const filename = process.platform === "win32" ? "bsk.exe" : "bsk";
    const executable = path.join(root, ".local", "bin", filename);
    fs.mkdirSync(path.dirname(executable), { recursive: true });
    fs.writeFileSync(executable, "fixture", { mode: 0o755 });
    expect(resolveBrowserSkillExecutable(path.join(root, "userdata"), { HOME: root, USERPROFILE: root, PATH: "" })).toBe(executable);
  });
});
