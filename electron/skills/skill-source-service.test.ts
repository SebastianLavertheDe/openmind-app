import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildAppPaths, ensureAppPaths, type AppPaths } from "../paths/app-paths-service";
import { SkillPackageService } from "./skill-package-service";
import { SkillSourceError, SkillSourceService, type GitCommandRunner } from "./skill-source-service";

const MANIFEST = `apiVersion: cctools.dev/skill/v1
id: git-demo
version: 1.0.0
publisher:
  id: cctools
  displayName: cctools
kind: process
display:
  name: Git Demo
  description: Git source fixture
  group: test
entrypoint:
  runtime: shell
  script: run.sh
  args: []
runtime:
  version: ">=3.11"
  dependencyFile: pyproject.toml
capabilities:
  mymind:
    read: [article/**]
    write: [daily-summary/**]
  network:
    required: false
    hosts: []
  subprocess:
    allowed: false
platforms: [windows-x64]
compatibility:
  minAppVersion: 1.0.0
`;

describe("SkillSourceService", () => {
  let tempRoot = "";
  let paths: AppPaths;
  let checkoutPaths: string[];

  beforeEach(() => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "cctools-skill-source-"));
    paths = buildAppPaths(path.join(tempRoot, "user-data"));
    ensureAppPaths(paths);
    checkoutPaths = [];
  });

  afterEach(() => {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  it("validates HTTPS Git, uses a shallow non-interactive clone, and cleans the checkout", async () => {
    const runGit: GitCommandRunner = async (args, options) => {
      const checkout = args.at(-1)!;
      checkoutPaths.push(checkout);
      fs.mkdirSync(checkout, { recursive: true });
      fs.writeFileSync(path.join(checkout, "cctools.skill.yaml"), MANIFEST);
      fs.writeFileSync(path.join(checkout, "run.sh"), "echo ok\n");
      fs.writeFileSync(path.join(checkout, "pyproject.toml"), "[project]\nname='git-demo'\n");
      expect(args).toEqual(expect.arrayContaining([
        "clone", "--depth", "1", "--no-tags", "--single-branch", "--no-recurse-submodules",
        "--branch", "main"
      ]));
      expect(args).not.toContain("--recurse-submodules");
      expect(options.env.GIT_TERMINAL_PROMPT).toBe("0");
      expect(options.env.GIT_CONFIG_NOSYSTEM).toBe("1");
      return { stdout: "", stderr: "" };
    };
    const service = new SkillSourceService(new SkillPackageService(paths), paths, runGit);
    const source = { type: "git" as const, locator: "https://github.com/example/git-demo.git", ref: "main" };

    const inspection = await service.inspect(source);
    expect(inspection.valid).toBe(true);
    expect(inspection.sourceKind).toBe("git");
    expect(inspection.sourcePath).toBe(source.locator);
    expect(checkoutPaths.every((candidate) => !fs.existsSync(candidate))).toBe(true);

    const installed = await service.install(source);
    expect(installed.sourceType).toBe("git");
    expect(installed.sourceLocator).toBe(source.locator);
    expect(installed.sourceRef).toBe("main");
    expect(installed.sourcePath).toBe(source.locator);
    expect(fs.existsSync(path.join(installed.packagePath, "run.sh"))).toBe(true);
    expect(checkoutPaths.every((candidate) => !fs.existsSync(candidate))).toBe(true);
  });

  it("rejects credentials, non-HTTPS locators, and ambiguous repositories", async () => {
    const packages = new SkillPackageService(paths);
    const invalid = new SkillSourceService(packages, paths, async () => ({ stdout: "", stderr: "" }));
    await expect(invalid.inspect({ type: "git", locator: "https://user:secret@example.com/skill.git" })).rejects.toThrow();
    await expect(invalid.inspect({ type: "git", locator: "http://example.com/skill.git" })).rejects.toThrow();

    const runGit: GitCommandRunner = async (args) => {
      const checkout = args.at(-1)!;
      for (const name of ["one", "two"]) {
        const candidate = path.join(checkout, name);
        fs.mkdirSync(candidate, { recursive: true });
        fs.writeFileSync(path.join(candidate, "cctools.skill.yaml"), MANIFEST.replace("git-demo", name));
      }
      return { stdout: "", stderr: "" };
    };
    const ambiguous = new SkillSourceService(packages, paths, runGit);
    await expect(ambiguous.inspect({ type: "git", locator: "https://github.com/example/many-skills.git" }))
      .rejects.toMatchObject<SkillSourceError>({ code: "git-package-ambiguous" });
  });

  it("cancels an in-flight Git inspection and removes its staging checkout", async () => {
    let started!: () => void;
    const startedPromise = new Promise<void>((resolve) => { started = resolve; });
    const runGit: GitCommandRunner = async (_args, options) => {
      started();
      await new Promise<never>((_resolve, reject) => {
        options.signal?.addEventListener("abort", () => reject(new SkillSourceError("git-cancelled", "已取消 Git 来源检查。")), { once: true });
      });
      return { stdout: "", stderr: "" };
    };
    const service = new SkillSourceService(new SkillPackageService(paths), paths, runGit);
    const pending = service.inspect({ type: "git", locator: "https://github.com/example/slow.git" }, "request-1");
    await startedPromise;
    expect(service.cancelInspection("request-1")).toBe(true);
    await expect(pending).rejects.toMatchObject<SkillSourceError>({ code: "git-cancelled" });
    expect(fs.readdirSync(paths.staging)).toHaveLength(0);
  });
});
