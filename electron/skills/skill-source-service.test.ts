import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ALL_SKILL_IDS } from "../../shared/skill-compatibility-matrix";
import { CCTOOLS_SKILLS_REPO_URL } from "../../shared/skill-package-sources";
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
const REVISION = "c".repeat(40);

describe("SkillSourceService", () => {
  let tempRoot = "";
  let paths: AppPaths;
  let checkoutPaths: string[];

  beforeEach(() => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "cctools-skill-source-"));
    paths = buildAppPaths(path.join(tempRoot, "user-data"), path.join(tempRoot, "mymind", ".agent", "skills"));
    ensureAppPaths(paths);
    checkoutPaths = [];
  });

  afterEach(() => {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  it("validates HTTPS Git, uses a shallow non-interactive clone, and cleans the checkout", async () => {
    const runGit: GitCommandRunner = async (args, options) => {
      if (args[0] === "rev-parse") {
        expect(options.cwd).toContain(`${path.sep}repo`);
        return { stdout: `${REVISION}\n`, stderr: "" };
      }
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
    expect(inspection.source).toEqual(source);
    expect(inspection.packages).toHaveLength(1);
    expect(inspection.packages[0]).toEqual(expect.objectContaining({
      valid: true,
      sourceKind: "git",
      sourcePath: source.locator,
      packageRef: "."
    }));
    expect(checkoutPaths.every((candidate) => !fs.existsSync(candidate))).toBe(true);

    const [installed] = await service.install(source);
    expect(installed.sourceType).toBe("git");
    expect(installed.sourceLocator).toBe(source.locator);
    expect(installed.sourceRef).toBe("main");
    expect(installed.sourcePackageRef).toBe(".");
    expect(installed.sourceRevision).toBe(REVISION);
    expect(installed.sourcePath).toBe(source.locator);
    expect(fs.existsSync(path.join(installed.packagePath, "run.sh"))).toBe(true);
    expect(service.hasCompleteInstallation(source.locator)).toBe(true);
    expect(fs.existsSync(path.join(paths.skills!, "source-installations.json"))).toBe(true);
    expect(checkoutPaths.every((candidate) => !fs.existsSync(candidate))).toBe(true);
  });

  it("accepts only a complete intact pre-receipt official installation as legacy compatibility", () => {
    const records = ALL_SKILL_IDS.map((id) => ({
      id,
      key: `cctools/${id}`,
      publisherId: "cctools",
      sourceType: "git" as const,
      sourceLocator: CCTOOLS_SKILLS_REPO_URL
    }));
    const packageAdapter = {
      listInstalled: vi.fn(() => records),
      isInstalledCopyUsable: vi.fn(() => true)
    } as unknown as SkillPackageService;
    const service = new SkillSourceService(packageAdapter, paths, async () => ({ stdout: "", stderr: "" }));

    expect(service.hasCompleteInstallation(CCTOOLS_SKILLS_REPO_URL)).toBe(true);
    records.pop();
    expect(service.hasCompleteInstallation(CCTOOLS_SKILLS_REPO_URL)).toBe(false);
    records.push({
      id: ALL_SKILL_IDS.at(-1)!,
      key: `cctools/${ALL_SKILL_IDS.at(-1)!}`,
      publisherId: "cctools",
      sourceType: "git",
      sourceLocator: CCTOOLS_SKILLS_REPO_URL,
      sourcePackageRef: "new-partial-install"
    } as never);
    expect(service.hasCompleteInstallation(CCTOOLS_SKILLS_REPO_URL)).toBe(false);

    fs.writeFileSync(path.join(paths.skills!, "source-installations.json"), "{corrupt", "utf8");
    expect(service.hasCompleteInstallation(CCTOOLS_SKILLS_REPO_URL)).toBe(false);
  });

  it("does not let a complete but undersized official ref bypass app-required Skills", async () => {
    const service = new SkillSourceService(
      new SkillPackageService(paths),
      paths,
      multiPackageGitRunner(["one"])
    );

    await service.install({ type: "git", locator: CCTOOLS_SKILLS_REPO_URL, ref: "undersized-fixture" });

    expect(fs.existsSync(path.join(paths.skills!, "source-installations.json"))).toBe(true);
    expect(service.hasCompleteInstallation(CCTOOLS_SKILLS_REPO_URL)).toBe(false);
  });

  it("accepts a complete official snapshot and verifies it offline on later startup checks", async () => {
    const delegate = multiPackageGitRunner([...ALL_SKILL_IDS]);
    let gitCalls = 0;
    const runGit: GitCommandRunner = async (args, options) => {
      gitCalls += 1;
      return delegate(args, options);
    };
    const service = new SkillSourceService(new SkillPackageService(paths), paths, runGit);

    const installed = await service.install({ type: "git", locator: CCTOOLS_SKILLS_REPO_URL });

    expect(installed).toHaveLength(ALL_SKILL_IDS.length);
    expect(gitCalls).toBe(2); // clone + rev-parse
    expect(service.hasCompleteInstallation(CCTOOLS_SKILLS_REPO_URL)).toBe(true);
    expect(gitCalls).toBe(2);
  });

  it("rejects unsafe locators and supports selecting packages from a multi-Skill repository", async () => {
    const packages = new SkillPackageService(paths);
    const invalid = new SkillSourceService(packages, paths, async () => ({ stdout: "", stderr: "" }));
    await expect(invalid.inspect({ type: "git", locator: "https://user:secret@example.com/skill.git" })).rejects.toThrow();
    await expect(invalid.inspect({ type: "git", locator: "http://example.com/skill.git" })).rejects.toThrow();

    const runGit: GitCommandRunner = async (args) => {
      if (args[0] === "rev-parse") return { stdout: `${REVISION}\n`, stderr: "" };
      const checkout = args.at(-1)!;
      for (const name of ["one", "two"]) {
        const candidate = path.join(checkout, name);
        fs.mkdirSync(candidate, { recursive: true });
        fs.writeFileSync(path.join(candidate, "cctools.skill.yaml"), MANIFEST.replace("git-demo", name));
        fs.writeFileSync(path.join(candidate, "run.sh"), "echo ok\n");
        fs.writeFileSync(path.join(candidate, "pyproject.toml"), `[project]\nname='${name}'\n`);
      }
      return { stdout: "", stderr: "" };
    };
    const multi = new SkillSourceService(packages, paths, runGit);
    const source = { type: "git" as const, locator: "https://github.com/example/many-skills.git" };
    const inspection = await multi.inspect(source);
    expect(inspection.packages.map((item) => item.packageRef)).toEqual(["one", "two"]);
    const installed = await multi.install(source, ["two"]);
    expect(installed).toHaveLength(1);
    expect(installed[0]).toEqual(expect.objectContaining({
      id: "two",
      sourceLocator: source.locator,
      sourcePackageRef: "two",
      sourceRevision: REVISION
    }));
    expect(multi.hasCompleteInstallation(source.locator)).toBe(false);
    expect(fs.existsSync(path.join(paths.skills!, "source-installations.json"))).toBe(false);

    await expect(multi.install(source, [])).rejects.toMatchObject<SkillSourceError>({ code: "git-package-selection-invalid" });
    await expect(multi.install(source, ["one", "one"])).rejects.toMatchObject<SkillSourceError>({ code: "git-package-selection-invalid" });
    await expect(multi.install(source, ["one", "missing"])).rejects.toMatchObject<SkillSourceError>({ code: "git-package-selection-invalid" });

    const complete = await multi.install(source, ["two", "one"]);
    expect(complete).toHaveLength(2);
    expect(multi.hasCompleteInstallation("https://github.com/example/many-skills.git/")).toBe(true);

    fs.writeFileSync(path.join(complete[0].packagePath, "run.sh"), "echo tampered\n");
    expect(multi.hasCompleteInstallation(source.locator)).toBe(false);
  });

  it("pre-inspects every selected package and writes no receipt after a batch failure", async () => {
    const runGit = multiPackageGitRunner(["one", "two"]);
    const packages = new SkillPackageService(paths);
    const service = new SkillSourceService(packages, paths, runGit);
    const source = { type: "git" as const, locator: "https://github.com/example/failing-skills.git" };
    const originalInstall = packages.install.bind(packages);
    let calls = 0;
    vi.spyOn(packages, "install").mockImplementation((...args) => {
      calls += 1;
      if (calls === 2) throw new Error("simulated second package failure");
      return originalInstall(...args);
    });

    await expect(service.install(source)).rejects.toThrow("simulated second package failure");

    expect(packages.listInstalled()).toHaveLength(1);
    expect(service.hasCompleteInstallation(source.locator)).toBe(false);
    expect(fs.existsSync(path.join(paths.skills!, "source-installations.json"))).toBe(false);
  });

  it("rejects an invalid package before installing any member of a complete source", async () => {
    const runGit: GitCommandRunner = async (args) => {
      if (args[0] === "rev-parse") return { stdout: `${REVISION}\n`, stderr: "" };
      const checkout = args.at(-1)!;
      writePackage(checkout, "one");
      const invalid = path.join(checkout, "two");
      fs.mkdirSync(invalid, { recursive: true });
      fs.writeFileSync(path.join(invalid, "SKILL.md"), "---\nname: two\n---\n");
      return { stdout: "", stderr: "" };
    };
    const packages = new SkillPackageService(paths);
    const service = new SkillSourceService(packages, paths, runGit);

    await expect(service.install({ type: "git", locator: "https://github.com/example/invalid-skills.git" })).rejects.toThrow();

    expect(packages.listInstalled()).toEqual([]);
    expect(fs.existsSync(path.join(paths.skills!, "source-installations.json"))).toBe(false);
  });

  it("rejects duplicate manifest identities before mutating the installed store", async () => {
    const runGit: GitCommandRunner = async (args) => {
      if (args[0] === "rev-parse") return { stdout: `${REVISION}\n`, stderr: "" };
      const checkout = args.at(-1)!;
      writePackage(checkout, "one");
      writePackage(checkout, "two");
      fs.writeFileSync(path.join(checkout, "two", "cctools.skill.yaml"), MANIFEST.replaceAll("git-demo", "one"));
      return { stdout: "", stderr: "" };
    };
    const packages = new SkillPackageService(paths);
    const install = vi.spyOn(packages, "install");
    const service = new SkillSourceService(packages, paths, runGit);

    await expect(service.install({ type: "git", locator: "https://github.com/example/duplicate-skills.git" }))
      .rejects.toMatchObject<SkillSourceError>({ code: "git-package-selection-invalid" });

    expect(install).not.toHaveBeenCalled();
    expect(packages.listInstalled()).toEqual([]);
  });

  it("treats a corrupt receipt as incomplete and repairs it on the next complete install", async () => {
    const runGit = multiPackageGitRunner(["one"]);
    const service = new SkillSourceService(new SkillPackageService(paths), paths, runGit);
    const source = { type: "git" as const, locator: "https://github.com/example/repair-skills.git" };

    await service.install(source);
    const receiptFile = path.join(paths.skills!, "source-installations.json");
    expect(service.hasCompleteInstallation(source.locator)).toBe(true);
    fs.writeFileSync(receiptFile, "{broken", "utf8");
    expect(service.hasCompleteInstallation(source.locator)).toBe(false);

    await service.install(source);
    expect(service.hasCompleteInstallation(source.locator)).toBe(true);
    expect(() => JSON.parse(fs.readFileSync(receiptFile, "utf8"))).not.toThrow();
  });

  it("keeps a complete receipt usable when rev-parse is unavailable", async () => {
    const runGit: GitCommandRunner = async (args) => {
      if (args[0] === "rev-parse") throw new Error("rev-parse unavailable");
      writePackage(args.at(-1)!, "one");
      return { stdout: "", stderr: "" };
    };
    const service = new SkillSourceService(new SkillPackageService(paths), paths, runGit);
    const source = { type: "git" as const, locator: "https://github.com/example/no-revision.git" };

    const [installed] = await service.install(source);

    expect(installed.sourceRevision).toBeUndefined();
    expect(service.hasCompleteInstallation(source.locator)).toBe(true);
    expect(JSON.parse(fs.readFileSync(path.join(paths.skills!, "source-installations.json"), "utf8"))
      .installations[0].sourceRevision).toBeUndefined();
  });

  it("fails closed when installed provenance no longer matches the receipt", async () => {
    const service = new SkillSourceService(new SkillPackageService(paths), paths, multiPackageGitRunner(["one"]));
    const source = { type: "git" as const, locator: "https://github.com/example/provenance.git" };
    await service.install(source);
    expect(service.hasCompleteInstallation(source.locator)).toBe(true);

    const registry = JSON.parse(fs.readFileSync(paths.skillRegistryFile!, "utf8"));
    registry.records[0].sourcePackageRef = "different-package-ref";
    fs.writeFileSync(paths.skillRegistryFile!, `${JSON.stringify(registry, null, 2)}\n`, "utf8");

    expect(service.hasCompleteInstallation(source.locator)).toBe(false);
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

function multiPackageGitRunner(names: string[]): GitCommandRunner {
  return async (args) => {
    if (args[0] === "rev-parse") return { stdout: `${REVISION}\n`, stderr: "" };
    const checkout = args.at(-1)!;
    for (const name of names) writePackage(checkout, name);
    return { stdout: "", stderr: "" };
  };
}

function writePackage(checkout: string, name: string): void {
  const candidate = path.join(checkout, name);
  fs.mkdirSync(candidate, { recursive: true });
  fs.writeFileSync(path.join(candidate, "cctools.skill.yaml"), MANIFEST.replaceAll("git-demo", name));
  fs.writeFileSync(path.join(candidate, "run.sh"), "echo ok\n");
  fs.writeFileSync(path.join(candidate, "pyproject.toml"), `[project]\nname='${name}'\n`);
}
