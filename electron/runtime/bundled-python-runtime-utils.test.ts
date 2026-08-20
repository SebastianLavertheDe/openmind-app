import fs from "node:fs";
import crypto from "node:crypto";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

// The packaging utility is CommonJS so it can be shared by the ESM prepare
// script and electron-builder's CommonJS afterSign hook.
const { listIncompatibleWindowsDistlibLaunchers, pruneIncompatibleWindowsDistlibLaunchers }: {
  listIncompatibleWindowsDistlibLaunchers(root: string, target: string): string[];
  pruneIncompatibleWindowsDistlibLaunchers(root: string, target: string): string[];
} = require("../../scripts/bundled-python-runtime-utils.cjs");
const finalizeBundledPythonRuntime: (context: {
  appOutDir: string;
  packager: { getResourcesDir(appOutDir: string): string };
}) => Promise<void> = require("../../scripts/finalize-bundled-python-runtime.cjs");

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("bundled Python runtime packaging", () => {
  it("finalizes runtime payloads after pack as well as after signing", () => {
    const packageJson = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "..", "package.json"), "utf8"));
    expect(packageJson.build.afterPack).toBe("scripts/finalize-bundled-python-runtime.cjs");
    expect(packageJson.build.afterSign).toBe("scripts/finalize-bundled-python-runtime.cjs");
  });

  it("keeps only native PE launchers in pip's vendored distlib directory", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "openmind-runtime-launchers-"));
    roots.push(root);
    const distlib = path.join(root, "distribution", "cpython", "Lib", "site-packages", "pip", "_vendor", "distlib");
    const unrelated = path.join(root, "distribution", "other", "distlib");
    writePe(path.join(distlib, "native.exe"), 0x8664);
    writePe(path.join(distlib, "arm.exe"), 0xaa64);
    writePe(path.join(distlib, "x86.exe"), 0x014c);
    fs.mkdirSync(distlib, { recursive: true });
    fs.writeFileSync(path.join(distlib, "not-a-pe.exe"), "not a PE launcher");
    writePe(path.join(unrelated, "arm.exe"), 0xaa64);

    const expectedIncompatible = [
      "distribution/cpython/Lib/site-packages/pip/_vendor/distlib/arm.exe",
      "distribution/cpython/Lib/site-packages/pip/_vendor/distlib/x86.exe"
    ];
    expect(listIncompatibleWindowsDistlibLaunchers(root, "windows-x64")).toEqual(expectedIncompatible);
    expect(pruneIncompatibleWindowsDistlibLaunchers(root, "windows-x64")).toEqual(expectedIncompatible);
    expect(fs.existsSync(path.join(distlib, "native.exe"))).toBe(true);
    expect(fs.existsSync(path.join(distlib, "not-a-pe.exe"))).toBe(true);
    expect(fs.existsSync(path.join(unrelated, "arm.exe"))).toBe(true);
  });

  it("finalizes a portable payload only after pruning incompatible launchers", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "openmind-runtime-finalize-"));
    roots.push(root);
    const resources = path.join(root, "resources");
    const runtime = path.join(resources, "python-runtime", "windows-x64");
    const distlib = path.join(runtime, "distribution", "cpython", "Lib", "site-packages", "pip", "_vendor", "distlib");
    writePe(path.join(distlib, "native.exe"), 0x8664);
    writePe(path.join(distlib, "arm.exe"), 0xaa64);
    fs.writeFileSync(path.join(runtime, "manifest.json"), JSON.stringify({
      schemaVersion: 2,
      target: "windows-x64",
      pythonVersion: "3.12.10",
      uvVersion: "0.5.27",
      filesDigest: "0".repeat(64)
    }));

    await finalizeBundledPythonRuntime({ appOutDir: root, packager: { getResourcesDir: () => resources } });

    const manifest = JSON.parse(fs.readFileSync(path.join(runtime, "manifest.json"), "utf8"));
    expect(fs.existsSync(path.join(distlib, "native.exe"))).toBe(true);
    expect(fs.existsSync(path.join(distlib, "arm.exe"))).toBe(false);
    expect(manifest.filesDigest).toBe(digestTree(runtime, new Set(["manifest.json"])));
  });
});

function writePe(file: string, machine: number): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const bytes = Buffer.alloc(256);
  bytes.write("MZ", 0, "ascii");
  bytes.writeUInt32LE(128, 0x3c);
  bytes.write("PE\0\0", 128, "ascii");
  bytes.writeUInt16LE(machine, 132);
  fs.writeFileSync(file, bytes);
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
