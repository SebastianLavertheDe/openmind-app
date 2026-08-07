import fs from "node:fs";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { zipSync } from "fflate";
import { SkillManifestSchema, type ProcessManifest } from "../../shared/skill-manifest-schema";
import { buildAppPaths, ensureAppPaths } from "../paths/app-paths-service";
import type { RuntimePackRecord } from "./runtime-pack-repository";
import { RuntimeManager, RuntimeManagerError } from "./runtime-manager";
import { RuntimePackUsageRegistry } from "./runtime-pack-usage";

const roots: string[] = [];
const digest = "a".repeat(64);
const hostPython = resolveCommand("python3");
const hostUv = resolveCommand("uv");

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("RuntimeManager", () => {
  it("fails closed when the declared active Pack is missing", () => {
    const { paths, packageRoot } = fixture();
    const manager = new RuntimeManager(paths, { target: "linux-x64" });
    expect(() => manager.resolve(manifest(), packageRoot, digest)).toThrowError(
      expect.objectContaining<Partial<RuntimeManagerError>>({ code: "pack-not-ready" })
    );
  });

  it("resolves an absolute executable only from an active Pack and prepares it", async () => {
    const { paths, packageRoot, pack } = fixture();
    const prepare = vi.fn(async () => undefined);
    const manager = new RuntimeManager(paths, {
      target: "linux-x64",
      getActivePack: () => pack,
      resolveExecutable: () => process.execPath,
      prepareEnvironment: prepare
    });
    const resolved = manager.resolve(manifest(), packageRoot, digest);
    expect(resolved.executable).toBe(process.execPath);
    expect(resolved.env.CCTOOLS_RUNTIME_PACK_DIGEST).toBe(pack.digest);
    expect(resolved.fingerprint).toMatch(/^[a-f0-9]{64}$/);
    resolved.acquire("run-runtime");
    expect(new RuntimePackUsageRegistry(paths).isInUse(pack.packId, pack.target, pack.digest)).toBe(true);
    resolved.release("run-runtime");
    await resolved.prepare();
    expect(prepare).toHaveBeenCalledOnce();
  });

  it("rejects an active Pack whose canonical path escapes runtimePacks", () => {
    const { paths, packageRoot } = fixture();
    const outside = path.join(os.tmpdir(), `cctools-runtime-outside-${Date.now()}`);
    fs.writeFileSync(outside, "not-a-pack");
    roots.push(outside);
    const manager = new RuntimeManager(paths, {
      target: "linux-x64",
      getActivePack: () => ({ ...packRecord(outside), status: "active" }),
      resolveExecutable: () => process.execPath
    });
    expect(() => manager.resolve(manifest(), packageRoot, digest)).toThrowError(
      expect.objectContaining<Partial<RuntimeManagerError>>({ code: "pack-path-invalid" })
    );
  });

  it("extracts a verified ZIP Pack and prepares an app-private Python environment", async () => {
    const { paths, packageRoot, pack } = fixture();
    const zipPath = path.join(paths.runtimePacks, "python-core", "linux-x64", "1.0.0-pack", "python.zip");
    fs.writeFileSync(zipPath, zipSync({
      "bin/python": new Uint8Array([1, 2, 3]),
      "bin/uv": new Uint8Array([4, 5, 6])
    }));
    const zipDigest = crypto.createHash("sha256").update(fs.readFileSync(zipPath)).digest("hex");
    const zipPack = { ...pack, packagePath: zipPath, digest: zipDigest, sbom: { ...pack.sbom, digest: zipDigest } };
    const commands: string[][] = [];
    const executables: string[] = [];
    const environments: Record<string, string>[] = [];
    const manager = new RuntimeManager(paths, {
      target: "linux-x64",
      getActivePack: () => zipPack,
      runCommand: async (executable, args, _cwd, env) => {
        executables.push(executable);
        commands.push(args);
        environments.push(env);
        if (args[0] === "venv") {
          fs.mkdirSync(path.join(args.at(-1)!, "bin"), { recursive: true });
          fs.writeFileSync(path.join(args.at(-1)!, "bin", "python"), "managed-python");
        }
      }
    });
    const resolved = manager.resolve(manifest(), packageRoot, digest);
    expect(resolved.executable).toContain(path.join(".packs", "python-core", "linux-x64", zipPack.digest, "bin", "python"));
    await resolved.prepare();
    expect(resolved.executable).toContain(path.join("runtimes", "environments", "cctools", "runtime-fixture"));
    expect(resolved.env.VIRTUAL_ENV).toContain(resolved.fingerprint);
    expect(commands.map((args) => args[0])).toEqual(["venv", "sync"]);
    const managedUv = path.join(paths.runtimeEnvironments, ".packs", "python-core", "linux-x64", zipPack.digest, "bin", "uv");
    expect(executables).toEqual([managedUv, managedUv]);
    expect(environments).toHaveLength(2);
    expect(environments.every((env) => !Object.hasOwn(env, "PATH"))).toBe(true);
    expect(environments.map((env) => env.UV_PYTHON_DOWNLOADS)).toEqual(["never", "never"]);
  });

  it.skipIf(process.platform !== "linux")("executes only Pack-provided tools when the host PATH is empty", async () => {
    const { paths, packageRoot } = fixture();
    const zipPath = path.join(paths.runtimePacks, "python-core", "linux-x64", "1.0.0-pack", "python.zip");
    const managedPython = "#!/bin/sh\nexit 0\n";
    const managedUv = [
      "#!/bin/sh",
      "set -eu",
      "script_dir=${0%/*}",
      "/bin/printf '%s\\n' \"$1\" >> \"$script_dir/invocations.log\"",
      "if [ \"$1\" = \"venv\" ]; then",
      "  /bin/mkdir -p \"$4/bin\"",
      "  /bin/cp \"$3\" \"$4/bin/python\"",
      "fi",
      ""
    ].join("\n");
    fs.writeFileSync(zipPath, zipSync({
      "bin/python": new TextEncoder().encode(managedPython),
      "bin/uv": new TextEncoder().encode(managedUv)
    }, { level: 0 }));
    const pack = { ...packRecord(zipPath), packagePath: zipPath };
    const manager = new RuntimeManager(paths, {
      target: "linux-x64",
      getActivePack: () => pack
    });
    const previousPath = process.env.PATH;
    process.env.PATH = "";
    try {
      const resolved = manager.resolve(manifest(), packageRoot, digest);
      await resolved.prepare();
      expect(resolved.executable).toContain(path.join("runtimes", "environments", "cctools", "runtime-fixture"));
      expect(fs.existsSync(resolved.executable)).toBe(true);
      const invocationLog = path.join(
        paths.runtimeEnvironments,
        ".packs",
        "python-core",
        "linux-x64",
        pack.digest,
        "bin",
        "invocations.log"
      );
      expect(fs.readFileSync(invocationLog, "utf8").trim().split(/\r?\n/)).toEqual(["venv", "sync"]);
    } finally {
      if (previousPath === undefined) delete process.env.PATH;
      else process.env.PATH = previousPath;
    }
  });

  it.skipIf(process.platform !== "linux" || !hostPython || !hostUv)("prepares a Python environment using only executables copied into the managed Pack", async () => {
    const { paths, packageRoot } = fixture();
    fs.writeFileSync(path.join(packageRoot, "main.py"), "print('managed-python')\n");
    fs.writeFileSync(path.join(packageRoot, "pyproject.toml"), [
      "[project]",
      "name = 'runtime-fixture'",
      "version = '1.0.0'",
      "requires-python = '>=3.11,<3.13'",
      "dependencies = []",
      ""
    ].join("\n"));
    // Generate the fixture lock with the host tool only as test setup. The
    // RuntimeManager path below uses the copy extracted from the Pack for both
    // `venv` and locked `sync`.
    execFileSync(hostUv!, ["lock", "--project", packageRoot], {
      cwd: packageRoot,
      env: { ...process.env, UV_PYTHON_DOWNLOADS: "never" }
    });

    const zipPath = path.join(paths.runtimePacks, "python-core", "linux-x64", "1.0.0-pack", "python.zip");
    fs.mkdirSync(path.dirname(zipPath), { recursive: true });
    fs.writeFileSync(zipPath, zipSync({
      "bin/python": new Uint8Array(fs.readFileSync(hostPython)),
      "bin/uv": new Uint8Array(fs.readFileSync(hostUv))
    }, { level: 0 }));
    const pack = { ...packRecord(zipPath), packagePath: zipPath };
    const manager = new RuntimeManager(paths, {
      target: "linux-x64",
      getActivePack: () => pack
    });
    const resolved = manager.resolve(manifest(), packageRoot, digest);

    await resolved.prepare();

    expect(resolved.env.VIRTUAL_ENV).toContain(path.join("runtimes", "environments"));
    expect(resolved.executable).toContain(path.join("runtimes", "environments", ".packs", "python-core", "linux-x64", pack.digest, "bin", "python"));
    expect(fs.existsSync(path.join(resolved.env.VIRTUAL_ENV, "cctools-runtime-environment.json"))).toBe(true);
    expect(fs.existsSync(resolved.executable)).toBe(true);
    expect(fs.existsSync(path.join(paths.runtimeEnvironments, ".packs", "python-core", "linux-x64", pack.digest, "bin", "uv"))).toBe(true);
  }, 30_000);
});

function fixture(): { paths: ReturnType<typeof buildAppPaths>; packageRoot: string; pack: RuntimePackRecord } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cctools-runtime-manager-"));
  roots.push(root);
  const paths = buildAppPaths(path.join(root, "user-data"));
  ensureAppPaths(paths);
  const packageRoot = path.join(root, "skill");
  fs.mkdirSync(packageRoot, { recursive: true });
  const packPath = path.join(paths.runtimePacks, "python-core", "linux-x64", "1.0.0-pack", "python.tar.zst");
  fs.mkdirSync(path.dirname(packPath), { recursive: true });
  fs.writeFileSync(packPath, "verified-pack-bytes");
  return { paths, packageRoot, pack: packRecord(packPath) };
}

function packRecord(packagePath: string): RuntimePackRecord {
  const packDigest = crypto.createHash("sha256").update(fs.readFileSync(packagePath)).digest("hex");
  return {
    schemaVersion: 1,
    packId: "python-core",
    target: "linux-x64",
    version: "1.0.0",
    digest: packDigest,
    packagePath,
    status: "active",
    verifiedAt: new Date().toISOString(),
    license: "Apache-2.0",
    sbom: { format: "spdx", digest: packDigest }
  };
}

function manifest(): ProcessManifest {
  return SkillManifestSchema.parse({
    apiVersion: "cctools.dev/skill/v1",
    id: "runtime-fixture",
    version: "1.0.0",
    publisher: { id: "cctools", displayName: "cctools" },
    kind: "process",
    display: { name: "Runtime Fixture", description: "" },
    entrypoint: { runtime: "python", script: "main.py", args: [] },
    runtime: { version: ">=3.11,<3.13", dependencyFile: "pyproject.toml", packs: ["python-core"] },
    capabilities: { mymind: { read: [], write: [] }, network: { required: false, hosts: [] } },
    artifacts: [],
    execution: { concurrency: { maxInstances: 1, mutexes: [] }, timeoutSeconds: 60, gracefulStopSeconds: 1, retry: { maxAttempts: 0 } },
    platforms: ["linux-x64"],
    compatibility: { minAppVersion: "1.0.0" }
  });
}

function resolveCommand(command: string): string | undefined {
  try {
    const resolved = execFileSync("which", [command], { encoding: "utf8" }).trim();
    return resolved && fs.statSync(resolved).isFile() ? fs.realpathSync(resolved) : undefined;
  } catch {
    return undefined;
  }
}
