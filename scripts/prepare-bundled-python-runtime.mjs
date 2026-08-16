import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import runtimeUtils from "./bundled-python-runtime-utils.cjs";

const { listIncompatibleWindowsDistlibLaunchers, pruneIncompatibleWindowsDistlibLaunchers } = runtimeUtils;

const scriptRoot = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(scriptRoot, "..");
const resourcesRoot = path.join(appRoot, "resources", "python-runtime");
const pythonVersion = process.env.CCTOOLS_BUNDLED_PYTHON_VERSION || "3.12.8";
const target = argument("target") || currentTarget();
const expectedTarget = currentTarget();

if (!target || target !== expectedTarget) {
  throw new Error(`Python runtime must be prepared on its native build host. Requested ${target || "unsupported"}, current ${expectedTarget || "unsupported"}.`);
}

const targetRoot = path.resolve(argument("output") || path.join(resourcesRoot, target));
assertInside(resourcesRoot, targetRoot);

if (process.argv.includes("--if-missing") && preparedRuntimeExists(targetRoot, target)) {
  console.log(`Embedded Python already present: ${targetRoot}`);
  process.exit(0);
}

const uvExecutable = resolveUvExecutable();

const stagingRoot = fs.mkdtempSync(path.join(os.tmpdir(), "cctools-python-runtime-stage-"));
const preparedRoot = path.join(stagingRoot, target);
fs.mkdirSync(path.join(preparedRoot, "bin"), { recursive: true });
const distributionRoot = path.join(preparedRoot, "distribution");
const cacheRoot = fs.mkdtempSync(path.join(os.tmpdir(), "cctools-python-build-cache-"));
try {
  console.log(`Preparing embedded Python ${pythonVersion} for ${target}`);
  execFileSync(uvExecutable, ["python", "install", "--install-dir", distributionRoot, "--cache-dir", cacheRoot, "--reinstall", pythonVersion], {
    cwd: stagingRoot,
    stdio: "inherit",
    windowsHide: true
  });
  const uvName = process.platform === "win32" ? "uv.exe" : "uv";
  fs.copyFileSync(uvExecutable, path.join(preparedRoot, "bin", uvName));
  if (process.platform !== "win32") fs.chmodSync(path.join(preparedRoot, "bin", uvName), 0o755);

  const pythonExecutable = findNamedFile(distributionRoot, process.platform === "win32" ? ["python.exe"] : ["python3", "python"]);
  if (!pythonExecutable) throw new Error("uv installed Python but no interpreter was found in the staged distribution.");
  const resolvedPythonVersion = execFileSync(pythonExecutable, ["--version"], { encoding: "utf8", windowsHide: true }).trim().replace(/^Python\s+/i, "");
  const resolvedUvVersion = execFileSync(uvExecutable, ["--version"], { encoding: "utf8", windowsHide: true }).trim().replace(/^uv\s+/i, "").split(/\s+/)[0];
  const prunedLaunchers = pruneIncompatibleWindowsDistlibLaunchers(preparedRoot, target);
  if (prunedLaunchers.length) console.log(`Pruned ${prunedLaunchers.length} incompatible distlib launcher(s) for ${target}.`);
  const filesDigest = digestTree(preparedRoot, new Set(["manifest.json"]));

  fs.writeFileSync(path.join(preparedRoot, "manifest.json"), `${JSON.stringify({ schemaVersion: 2, target, pythonVersion: resolvedPythonVersion, uvVersion: resolvedUvVersion, filesDigest }, null, 2)}\n`, "utf8");
  if (fs.existsSync(targetRoot)) fs.rmSync(targetRoot, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(targetRoot), { recursive: true });
  copyDirectoryRecursively(preparedRoot, targetRoot);
  console.log(`Embedded Python ready: ${targetRoot}`);
  console.log(`Python ${resolvedPythonVersion}, uv ${resolvedUvVersion}, sha256 ${filesDigest}`);
} finally {
  fs.rmSync(cacheRoot, { recursive: true, force: true });
  fs.rmSync(stagingRoot, { recursive: true, force: true });
}

function argument(name) {
  const prefix = `--${name}=`;
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length) || "";
}

function preparedRuntimeExists(root, expectedTargetName) {
  const manifestFile = path.join(root, "manifest.json");
  if (!fs.existsSync(manifestFile)) return false;
  try {
    const manifest = JSON.parse(fs.readFileSync(manifestFile, "utf8"));
    if (
      manifest.schemaVersion !== 2
      || manifest.target !== expectedTargetName
      || !/^[a-f0-9]{64}$/i.test(manifest.filesDigest || "")
      || listIncompatibleWindowsDistlibLaunchers(root, expectedTargetName).length
    ) return false;
    const hasRequiredBinaries = Boolean(
      findNamedFile(path.join(root, "distribution"), process.platform === "win32" ? ["python.exe"] : ["python3", "python"])
      && findNamedFile(path.join(root, "bin"), process.platform === "win32" ? ["uv.exe"] : ["uv"])
    );
    return hasRequiredBinaries
      && digestTree(root, new Set(["manifest.json"])) === manifest.filesDigest.toLowerCase();
  } catch {
    return false;
  }
}

function currentTarget() {
  if (process.platform === "win32") return process.arch === "x64" ? "windows-x64" : process.arch === "arm64" ? "windows-arm64" : null;
  if (process.platform === "darwin") return process.arch === "arm64" ? "macos-arm64" : process.arch === "x64" ? "macos-x64" : null;
  if (process.platform === "linux") return process.arch === "x64" ? "linux-x64" : process.arch === "arm64" ? "linux-arm64" : null;
  return null;
}

function resolveUvExecutable() {
  const explicit = process.env.CCTOOLS_UV_EXECUTABLE || process.env.UV_EXECUTABLE;
  if (explicit && fs.existsSync(explicit)) return path.resolve(explicit);
  const command = process.platform === "win32" ? "where.exe" : "which";
  const result = execFileSync(command, [process.platform === "win32" ? "uv.exe" : "uv"], { encoding: "utf8", windowsHide: true })
    .split(/\r?\n/).map((line) => line.trim()).find(Boolean);
  if (!result || !fs.existsSync(result)) throw new Error("uv is required to prepare the bundled Python runtime. Set CCTOOLS_UV_EXECUTABLE when it is not on PATH.");
  return path.resolve(result);
}

function assertInside(root, candidate) {
  const relative = path.relative(path.resolve(root), candidate);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) throw new Error(`Refusing to write Python runtime outside ${root}`);
}

function findNamedFile(root, names) {
  const wanted = new Set(names.map((name) => name.toLocaleLowerCase()));
  const stack = [root];
  while (stack.length) {
    const directory = stack.pop();
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) continue;
      const absolute = path.join(directory, entry.name);
      if (entry.isFile() && wanted.has(entry.name.toLocaleLowerCase())) return absolute;
      if (entry.isDirectory()) stack.push(absolute);
    }
  }
  return null;
}

function copyDirectoryRecursively(source, target) {
  const sourceStat = fs.lstatSync(source);
  if (!sourceStat.isDirectory() || sourceStat.isSymbolicLink()) throw new Error(`Runtime staging source is not a directory: ${source}`);
  fs.mkdirSync(target, { recursive: true });
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    const from = path.join(source, entry.name);
    const to = path.join(target, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`Bundled runtime may not contain symlinks: ${path.relative(source, from)}`);
    if (entry.isDirectory()) {
      copyDirectoryRecursively(from, to);
      continue;
    }
    if (!entry.isFile()) throw new Error(`Bundled runtime contains unsupported file: ${path.relative(source, from)}`);
    fs.copyFileSync(from, to);
    try { fs.utimesSync(to, fs.statSync(from).atime, fs.statSync(from).mtime); } catch { /* Best effort on Windows. */ }
  }
  try { fs.utimesSync(target, sourceStat.atime, sourceStat.mtime); } catch { /* Best effort on Windows. */ }
}

function digestTree(root, excluded) {
  const hash = crypto.createHash("sha256");
  const walk = (directory) => {
    const entries = fs.readdirSync(directory, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const absolute = path.join(directory, entry.name);
      const relative = path.relative(root, absolute).split(path.sep).join("/");
      if (excluded.has(relative)) continue;
      if (entry.isSymbolicLink()) throw new Error(`Bundled runtime may not contain symlinks: ${relative}`);
      if (entry.isDirectory()) walk(absolute);
      else if (entry.isFile()) {
        // electron-builder removes empty directories from extraResources.
        // Directory entries therefore cannot be part of the payload digest.
        hash.update(relative); hash.update("\0");
        hash.update(fs.readFileSync(absolute)); hash.update("\0");
      }
      else throw new Error(`Bundled runtime contains unsupported file: ${relative}`);
    }
  };
  walk(root);
  return hash.digest("hex");
}
