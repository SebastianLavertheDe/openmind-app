import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SkillManifestSchema, type ProcessManifest } from "../../shared/skill-manifest-schema";
import { detectRuntimeTarget, type RuntimeTarget } from "../../shared/runtime-targets";
import { buildAppPaths, ensureAppPaths } from "../paths/app-paths-service";
import { SharedPythonRuntimeService, type SharedPythonProject } from "./shared-python-runtime";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("SharedPythonRuntimeService", () => {
  it("leaves the enable switch retryable when bundled assets are missing", async () => {
    const fixture = createFixture();
    fs.rmSync(path.join(fixture.assets, fixture.target), { recursive: true, force: true });
    const service = new SharedPythonRuntimeService(fixture.paths, {
      bundledAssetRoot: fixture.assets,
      target: fixture.target,
      projects: () => []
    });

    await expect(service.setEnabled(true)).rejects.toThrow(`发行包缺少内置 Python 资源：${fixture.target}`);
    expect(service.status()).toMatchObject({ enabled: false, ready: false, phase: "error" });
  });

  it("accepts a packaged runtime when only empty source directories were pruned", async () => {
    const fixture = createFixture();
    fs.mkdirSync(path.join(fixture.assets, fixture.target, "distribution", "empty-runtime-directory"));
    const service = new SharedPythonRuntimeService(fixture.paths, {
      bundledAssetRoot: fixture.assets,
      target: fixture.target,
      projects: () => [],
      runCommand: fakeUvRunner()
    });

    await expect(service.setEnabled(true)).resolves.toMatchObject({ enabled: true, ready: true, phase: "ready" });
  });

  it("repairs a changed installed distribution without keeping the bad copy active", async () => {
    const fixture = createFixture();
    const assetFile = path.join(fixture.assets, fixture.target, "distribution", "stdlib.py");
    fs.writeFileSync(assetFile, "VALUE = 1\n");
    const stableTime = new Date("2024-01-02T03:04:05.000Z");
    fs.utimesSync(assetFile, stableTime, stableTime);
    rewriteManifest(fixture.assets, fixture.target);
    const service = new SharedPythonRuntimeService(fixture.paths, {
      bundledAssetRoot: fixture.assets,
      target: fixture.target,
      projects: () => [],
      runCommand: fakeUvRunner()
    });

    await service.setEnabled(true);
    const state = readState(fixture.paths.runtimeEnvironments);
    const installedRoot = path.join(fixture.paths.runtimeEnvironments, "shared-python", "distributions", state.assetDigest);
    const installedFile = path.join(installedRoot, "distribution", "stdlib.py");
    expect(fs.statSync(installedFile).mtimeMs).toBe(stableTime.getTime());

    fs.writeFileSync(installedFile, "VALUE = 'changed'\n");
    await service.setEnabled(false);
    await expect(service.setEnabled(true)).resolves.toMatchObject({ ready: true, phase: "ready" });
    expect(fs.readFileSync(installedFile, "utf8")).toBe("VALUE = 1\n");
    expect(digestTree(installedRoot, new Set(["manifest.json"]))).toBe(state.assetDigest);
  });

  it("creates one uv environment containing every approved Python Skill", async () => {
    const fixture = createFixture();
    const alpha = createProject(fixture.root, "alpha", "requests>=2");
    const beta = createProject(fixture.root, "beta", "PyYAML>=6");
    const projects = [alpha, beta];
    const runCommand = fakeUvRunner();
    const service = new SharedPythonRuntimeService(fixture.paths, {
      bundledAssetRoot: fixture.assets,
      target: fixture.target,
      projects: () => projects,
      runCommand
    });

    const status = await service.setEnabled(true);
    expect(status).toMatchObject({ enabled: true, ready: true, phase: "ready", managedSkills: 2, pythonVersion: "3.12.10" });

    const generatedProject = findGeneratedFile(fixture.paths.runtimeEnvironments, "pyproject.toml");
    const contents = fs.readFileSync(generatedProject, "utf8");
    expect(contents).toContain('requires-python = ">=3.12,<3.13"');
    expect(contents).toContain("alpha @ file:");
    expect(contents).toContain("beta @ file:");

    const alphaPreparation = service.resolve(manifest("alpha"), alpha.packageRoot, alpha.digest);
    const betaPreparation = service.resolve(manifest("beta"), beta.packageRoot, beta.digest);
    expect(alphaPreparation.env.PYTHONDONTWRITEBYTECODE).toBe("1");
    await alphaPreparation.prepare();
    await betaPreparation.prepare();
    expect(alphaPreparation.executable).toBe(betaPreparation.executable);
    expect(alphaPreparation.env.VIRTUAL_ENV).toBe(betaPreparation.env.VIRTUAL_ENV);
    expect(runCommand).toHaveBeenCalledWith(
      expect.any(String),
      expect.arrayContaining(["sync", "--locked", "--no-install-package", "alpha", "--no-install-package", "beta"]),
      expect.any(String),
      expect.objectContaining({ PYTHONDONTWRITEBYTECODE: "1" })
    );
  });

  it("keeps the last shared generation when a new dependency set conflicts", async () => {
    const fixture = createFixture();
    const alpha = createProject(fixture.root, "alpha", "shared-lib==1");
    const beta = createProject(fixture.root, "beta", "shared-lib==2");
    let projects = [alpha];
    let fail = false;
    const runCommand = fakeUvRunner(() => fail);
    const service = new SharedPythonRuntimeService(fixture.paths, {
      bundledAssetRoot: fixture.assets,
      target: fixture.target,
      projects: () => projects,
      runCommand
    });

    await service.setEnabled(true);
    const before = readState(fixture.paths.runtimeEnvironments);
    const oldPython = environmentPython(path.join(fixture.paths.runtimeEnvironments, "shared-python", "generations", before.currentFingerprint));
    expect(fs.existsSync(oldPython)).toBe(true);

    projects = [alpha, beta];
    fail = true;
    const preparation = service.resolve(manifest("beta"), beta.packageRoot, beta.digest);
    await expect(preparation.prepare()).rejects.toThrow("已保留原环境");
    const after = readState(fixture.paths.runtimeEnvironments);
    expect(after.currentFingerprint).toBe(before.currentFingerprint);
    expect(fs.existsSync(oldPython)).toBe(true);
    expect(service.status()).toMatchObject({ enabled: true, phase: "error", ready: false });
  });

  it("disables new Python runs without deleting the installed environment", async () => {
    const fixture = createFixture();
    const alpha = createProject(fixture.root, "alpha", "requests>=2");
    const service = new SharedPythonRuntimeService(fixture.paths, {
      bundledAssetRoot: fixture.assets,
      target: fixture.target,
      projects: () => [alpha],
      runCommand: fakeUvRunner()
    });
    await service.setEnabled(true);
    const generations = path.join(fixture.paths.runtimeEnvironments, "shared-python", "generations");
    expect(fs.readdirSync(generations).length).toBe(1);

    expect(await service.setEnabled(false)).toMatchObject({ enabled: false, phase: "disabled" });
    expect(fs.readdirSync(generations).length).toBe(1);
    expect(() => service.resolve(manifest("alpha"), alpha.packageRoot, alpha.digest)).toThrow("尚未开启");
  });
});

function createFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "openmind-shared-python-test-"));
  roots.push(root);
  const paths = buildAppPaths(path.join(root, "user-data"));
  ensureAppPaths(paths);
  const assets = path.join(root, "assets");
  const runtimeTarget = detectRuntimeTarget({ platform: process.platform, arch: process.arch }) as RuntimeTarget;
  const target = path.join(assets, runtimeTarget);
  writeExecutable(path.join(target, "distribution", ...(process.platform === "win32" ? ["python.exe"] : ["bin", "python"])));
  writeExecutable(path.join(target, "bin", process.platform === "win32" ? "uv.exe" : "uv"));
  fs.writeFileSync(path.join(target, "manifest.json"), JSON.stringify({
    schemaVersion: 2,
    target: runtimeTarget,
    pythonVersion: "3.12.10",
    uvVersion: "0.5.27",
    filesDigest: digestTree(target, new Set(["manifest.json"]))
  }));
  return { root, paths, assets, target: runtimeTarget };
}

function createProject(root: string, id: string, dependency: string): SharedPythonProject {
  const packageRoot = path.join(root, "skills", id);
  fs.mkdirSync(packageRoot, { recursive: true });
  fs.writeFileSync(path.join(packageRoot, "pyproject.toml"), `[project]\nname = "${id}"\nversion = "1.0.0"\ndependencies = ["${dependency}"]\n`);
  fs.writeFileSync(path.join(packageRoot, "main.py"), "print('ok')\n");
  return { id, version: "1.0.0", digest: crypto.createHash("sha256").update(id).digest("hex"), packageRoot };
}

function manifest(id: string): ProcessManifest {
  return SkillManifestSchema.parse({
    apiVersion: "openmind.dev/skill/v1",
    id,
    version: "1.0.0",
    publisher: { id: "openmind", displayName: "openmind" },
    kind: "process",
    display: { name: id, description: id, group: "test" },
    entrypoint: { runtime: "python", script: "main.py", args: [] },
    runtime: { version: ">=3.11,<3.13", dependencyFile: "pyproject.toml", packs: ["python-core"] },
    capabilities: { openmind: { read: [], write: [] }, network: { required: false, hosts: [] }, subprocess: { allowed: false } },
    artifacts: [],
    execution: { concurrency: { maxInstances: 1, mutexes: [] }, timeoutSeconds: 60, gracefulStopSeconds: 2, retry: { maxAttempts: 0 } },
    platforms: [detectRuntimeTarget({ platform: process.platform, arch: process.arch })!],
    compatibility: { minAppVersion: "1.0.0" }
  }) as ProcessManifest;
}

function fakeUvRunner(shouldFail: () => boolean = () => false) {
  return vi.fn(async (_executable: string, args: string[], cwd: string) => {
    if (shouldFail()) throw new Error("dependency conflict");
    if (args[0] === "lock") fs.writeFileSync(path.join(cwd, "uv.lock"), "version = 1\n");
    if (args[0] === "sync") writeExecutable(environmentPython(cwd));
  });
}

function environmentPython(root: string): string {
  return process.platform === "win32" ? path.join(root, ".venv", "Scripts", "python.exe") : path.join(root, ".venv", "bin", "python");
}

function writeExecutable(file: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, "#!/bin/sh\nexit 0\n");
  fs.chmodSync(file, 0o755);
}

function findGeneratedFile(root: string, name: string): string {
  const stack = [root];
  while (stack.length) {
    const current = stack.pop()!;
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const absolute = path.join(current, entry.name);
      if (entry.isFile() && entry.name === name) return absolute;
      if (entry.isDirectory()) stack.push(absolute);
    }
  }
  throw new Error(`${name} not found`);
}

function readState(runtimeEnvironments: string): { assetDigest: string; currentFingerprint: string } {
  return JSON.parse(fs.readFileSync(path.join(runtimeEnvironments, "shared-python", "state.json"), "utf8"));
}

function rewriteManifest(assets: string, target: RuntimeTarget): void {
  const root = path.join(assets, target);
  const manifestFile = path.join(root, "manifest.json");
  const manifest = JSON.parse(fs.readFileSync(manifestFile, "utf8"));
  fs.writeFileSync(manifestFile, JSON.stringify({ ...manifest, filesDigest: digestTree(root, new Set(["manifest.json"])) }));
}

function digestTree(root: string, excluded: Set<string>): string {
  const hash = crypto.createHash("sha256");
  const walk = (directory: string) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
      const absolute = path.join(directory, entry.name);
      const relative = path.relative(root, absolute).split(path.sep).join("/");
      if (excluded.has(relative)) continue;
      if (entry.isDirectory()) walk(absolute);
      else {
        hash.update(relative); hash.update("\0");
        hash.update(fs.readFileSync(absolute)); hash.update("\0");
      }
    }
  };
  walk(root);
  return hash.digest("hex");
}
