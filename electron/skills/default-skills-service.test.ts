import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OPENMIND_SKILLS_REPO_URL } from "../../shared/skill-package-sources";
import { buildAppPaths, ensureAppPaths } from "../paths/app-paths-service";
import { SkillPackageService } from "./skill-package-service";
import type { SkillSourceService } from "./skill-source-service";
import { DefaultSkillsService } from "./default-skills-service";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });

function harness() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "openmind-default-skills-"));
  roots.push(root);
  const content = path.join(root, "content");
  const paths = buildAppPaths(path.join(root, "user-data"), path.join(content, ".agent", "skills"));
  ensureAppPaths(paths);
  const packages = new SkillPackageService(paths);
  const source = (id: string) => {
    const dir = path.join(root, "sources", id);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "SKILL.md"), `---\nname: ${id}\ndescription: Test fixture\n---\nUse this test fixture.\n`);
    return dir;
  };
  const installPackage = (id: string, locator = OPENMIND_SKILLS_REPO_URL) =>
    packages.install(source(id), { sourceType: "git", sourceLocator: locator });
  const install = vi.fn(async () => [installPackage("default-one"), installPackage("default-two")]);
  const automation = { stop: vi.fn(async () => undefined), refresh: vi.fn(async () => undefined), setEnabled: vi.fn(async (_enabled: boolean) => undefined) };
  const service = new DefaultSkillsService(packages, { install } as unknown as SkillSourceService, automation);
  return { root, content, paths, packages, installPackage, install, automation, service };
}

describe("DefaultSkillsService", () => {
  it("installs and enables defaults before enabling jobs, and removes only official packages on disable", async () => {
    const h = harness();
    const custom = h.installPackage("custom-skill", "https://github.com/example/skills");
    const personal = path.join(h.content, ".agent", "skill-data", "default-one", "settings.json");
    const article = path.join(h.content, "article", "saved.md");
    for (const file of [personal, article]) {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, "keep");
    }
    h.automation.setEnabled.mockImplementation(async (enabled) => {
      if (enabled) {
        expect(h.packages.listInstalledViews().filter((item) => item.id.startsWith("default-")).every((item) => item.enabled)).toBe(true);
        expect(h.packages.listInstalled()).toHaveLength(3);
        expect(h.automation.refresh).toHaveBeenCalled();
      }
    });
    expect(await h.service.setEnabled(true)).toBe(true);
    expect(h.install).toHaveBeenCalledWith({ type: "git", locator: OPENMIND_SKILLS_REPO_URL });
    h.automation.stop.mockImplementation(async () => { expect(h.packages.listInstalled()).toHaveLength(3); });
    expect(await h.service.setEnabled(false)).toBe(false);
    expect(h.packages.listInstalled().map((item) => item.key)).toEqual([custom.key]);
    expect(fs.readFileSync(personal, "utf8")).toBe("keep");
    expect(fs.readFileSync(article, "utf8")).toBe("keep");
    expect(h.automation.setEnabled).toHaveBeenLastCalledWith(false);
  });

  it("rolls back a partial install without deleting pre-existing packages", async () => {
    const h = harness();
    const existing = h.installPackage("default-one");
    h.install.mockImplementation(async () => {
      h.installPackage("default-two");
      throw new Error("download failed");
    });
    await expect(h.service.setEnabled(true)).rejects.toThrow("download failed");
    expect(h.packages.listInstalled().map((item) => item.key)).toEqual([existing.key]);
    expect(h.automation.setEnabled).not.toHaveBeenCalledWith(true);
    expect(h.automation.setEnabled).toHaveBeenLastCalledWith(false);
  });

  it("keeps installed packages when stopping the jobs fails", async () => {
    const h = harness();
    await h.service.setEnabled(true);
    h.automation.stop.mockRejectedValue(new Error("still running"));
    await expect(h.service.setEnabled(false)).rejects.toThrow("still running");
    expect(h.packages.listInstalled()).toHaveLength(2);
    expect(h.automation.setEnabled).not.toHaveBeenCalledWith(false);
  });

  it("keeps the switch retryable on removal failure and supports enabling again", async () => {
    const h = harness();
    await h.service.setEnabled(true);
    const uninstall = vi.spyOn(h.packages, "uninstall").mockImplementationOnce(() => { throw new Error("locked file"); });
    await expect(h.service.setEnabled(false)).rejects.toThrow("locked file");
    expect(h.automation.setEnabled).not.toHaveBeenCalledWith(false);
    uninstall.mockRestore();
    await h.service.setEnabled(false);
    await h.service.setEnabled(true);
    expect(h.packages.listInstalled()).toHaveLength(2);
    expect(h.automation.setEnabled).toHaveBeenLastCalledWith(true);
  });
});
