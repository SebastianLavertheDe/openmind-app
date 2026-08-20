#!/usr/bin/env node
"use strict";

/**
 * Scan the contents of real distributable containers after extraction.
 *
 * package-safety-scan.js already covers the compiled tree and unpacked
 * Electron app. This companion closes the gap between that directory and
 * the actual ZIP/Portable/NSIS container by extracting each artifact with
 * 7-Zip and sending the extracted tree through the same scanner. It is a
 * local artifact-level check; it is not Windows GUI, clean-machine or
 * installer acceptance.
 */

const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { listIncompatibleWindowsDistlibLaunchers } = require("./bundled-python-runtime-utils.cjs");

const appRoot = path.resolve(__dirname, "..");
const args = parseArgs(process.argv.slice(2));
const platform = args.platform || "win";
const distRoot = path.resolve(args.dist || path.join(appRoot, "dist"));
const output = path.resolve(args.output || path.join(appRoot, ".build", "package-artifact-safety-report.json"));
const allowMissingTargets = args["allow-missing-targets"] === "true" || args["allow-missing-targets"] === "1";
const scanner = path.join(appRoot, "scripts", "package-safety-scan.js");
const requiredKinds = platform === "win" ? ["portable", "nsis", "zip"] : ["dmg", "zip"];

if (!["win", "mac"].includes(platform)) throw new Error("Use --platform win or --platform mac.");
if (!fs.existsSync(distRoot) || !fs.statSync(distRoot).isDirectory()) throw new Error(`Artifact directory is missing: ${distRoot}`);

const workRoot = fs.mkdtempSync(path.join(os.tmpdir(), "openmind-artifact-safety-"));
let report;
try {
  report = run();
  writeReport(report);
  const allowedPartialTarget = report.status === "manual-required"
    && allowMissingTargets
    && !report.error
    && report.missingKinds?.length > 0
    && report.failedArtifacts?.length === 0;
  if (report.status !== "passed" && !allowedPartialTarget) {
    console.error(`Package artifact safety is ${report.status}: ${report.failedArtifacts.length} artifact(s) failed or could not be extracted.`);
    process.exitCode = 1;
  } else if (allowedPartialTarget) {
    console.log(`Package artifact safety partially passed: ${report.passedArtifacts}/${report.artifacts.length} artifact(s); missing target kind(s): ${report.missingKinds.join(", ")}.`);
  } else {
    console.log(`Package artifact safety passed: ${report.passedArtifacts}/${report.artifacts.length} distributable artifact(s).`);
  }
} catch (error) {
  report = {
    schemaVersion: 1,
    kind: "openmind-package-artifact-safety",
    generatedAt: new Date().toISOString(),
    platform,
    status: "manual-required",
    error: error instanceof Error ? error.message : String(error),
    artifacts: [],
    passedArtifacts: 0,
    failedArtifacts: [],
    externalGates: ["Windows/macOS GUI and clean-machine acceptance", "packaged Provider/Chrome E2E"]
  };
  writeReport(report);
  console.error(report.error);
  process.exitCode = 1;
} finally {
  fs.rmSync(workRoot, { recursive: true, force: true });
}

function run() {
  const extractor = findExtractor();
  const artifacts = fs.readdirSync(distRoot, { withFileTypes: true })
    .filter((entry) => entry.isFile() && isContainer(entry.name, platform))
    .map((entry) => ({
      name: entry.name,
      file: path.join(distRoot, entry.name),
      kind: artifactKind(entry.name, platform),
      bytes: fs.statSync(path.join(distRoot, entry.name)).size,
      sha256: sha256File(path.join(distRoot, entry.name))
    }))
    .sort((left, right) => left.name.localeCompare(right.name));

  if (!artifacts.length) throw new Error(`No ${platform} distributable container found in ${distRoot}.`);
  const foundKinds = new Set(artifacts.map((artifact) => artifact.kind));
  const missingKinds = requiredKinds.filter((kind) => !foundKinds.has(kind));
  if (missingKinds.length && !allowMissingTargets) {
    throw new Error(`Expected ${platform} artifact kind(s) are missing: ${missingKinds.join(", ")}.`);
  }

  const checked = artifacts.map((artifact, index) => scanArtifact(artifact, extractor, index));
  const failedArtifacts = checked.filter((artifact) => artifact.status !== "passed");
  return {
    schemaVersion: 1,
    kind: "openmind-package-artifact-safety",
    generatedAt: new Date().toISOString(),
    platform,
    host: { platform: process.platform, arch: process.arch, node: process.version, os: os.release() },
    extractor,
    status: failedArtifacts.length === 0 && missingKinds.length === 0 ? "passed" : "manual-required",
    artifacts: checked,
    requiredKinds,
    foundKinds: [...foundKinds].sort(),
    missingKinds,
    passedArtifacts: checked.filter((artifact) => artifact.status === "passed").length,
    failedArtifacts: failedArtifacts.map((artifact) => artifact.name),
    externalGates: [
      "Windows/macOS GUI and clean-machine acceptance",
      "packaged Provider/Chrome E2E",
      "installer/update/force-quit recovery on the target OS"
    ]
  };
}

function scanArtifact(artifact, extractor, index) {
  const identity = { name: artifact.name, kind: artifact.kind, bytes: artifact.bytes, sha256: artifact.sha256 };
  const extractionRoot = path.join(workRoot, `artifact-${index}-${artifact.kind}`);
  const scannerReport = path.join(workRoot, `scanner-${index}.json`);
  fs.mkdirSync(extractionRoot, { recursive: true });
  const extraction = spawnSync(extractor.command, [...extractor.args, artifact.file, `-o${extractionRoot}`], {
    cwd: appRoot,
    encoding: "utf8",
    maxBuffer: 4 * 1024 * 1024
  });
  const extractionError = extraction.error
    ? extraction.error.message
    : extraction.status === 0
      ? null
      : (extraction.stderr || extraction.stdout || `extractor exited with ${extraction.status}`).trim();
  if (extractionError) {
    return { ...identity, status: "manual-required", extractedFiles: 0, error: extractionError };
  }

  const nestedArchives = expandNestedArchives(extractionRoot, extractor);
  const extractedFiles = countFiles(extractionRoot);
  if (extractedFiles === 0) {
    return { ...identity, status: "manual-required", extractedFiles, error: "container extracted no files" };
  }
  const nestedFailure = nestedArchives.find((entry) => entry.status !== "passed");
  if (nestedFailure) {
    return {
      ...identity,
      status: "manual-required",
      extractedFiles,
      nestedArchives,
      containsAsar: containsFileNamed(extractionRoot, "app.asar"),
      error: `nested archive extraction failed: ${nestedFailure.archive}: ${nestedFailure.error}`
    };
  }

  const scan = spawnSync(process.execPath, [scanner, "--only-target", extractionRoot, "--output", scannerReport], {
    cwd: appRoot,
    encoding: "utf8",
    maxBuffer: 4 * 1024 * 1024
  });
  const parsed = readJson(scannerReport);
  const containsAsar = containsFileNamed(extractionRoot, "app.asar");
  const bundledPythonRuntimes = verifyBundledPythonRuntimes(extractionRoot);
  const runtimeFailure = bundledPythonRuntimes.length === 0
    ? { error: "container does not contain a bundled Python runtime" }
    : bundledPythonRuntimes.find((runtime) => runtime.status !== "passed");
  const scanError = scan.status === 0 && parsed?.status === "passed"
    ? null
    : (parsed?.findings?.join("; ") || scan.stderr || scan.stdout || `scanner exited with ${scan.status}`).trim();
  const error = scanError
    || (!containsAsar ? "container does not contain app.asar" : null)
    || (runtimeFailure ? `bundled Python runtime validation failed: ${runtimeFailure.error}` : null);
  return {
    ...identity,
    status: error ? "failed" : "passed",
    extractedFiles,
    nestedArchives,
    containsAsar,
    bundledPythonRuntimes,
    scannedFiles: Number(parsed?.scannedFiles || 0),
    findings: parsed?.findings || [],
    error
  };
}

function verifyBundledPythonRuntimes(root) {
  const runtimeRoots = findBundledPythonRuntimeRoots(root);
  return runtimeRoots.map((runtimeRoot) => {
    const manifestFile = path.join(runtimeRoot, "manifest.json");
    const relativeRoot = path.relative(root, runtimeRoot).replaceAll(path.sep, "/");
    try {
      const manifest = readJson(manifestFile);
      const target = path.basename(runtimeRoot);
      if (!manifest || manifest.schemaVersion !== 2 || manifest.target !== target || !/^[a-f0-9]{64}$/i.test(manifest.filesDigest || "")) {
        return { relativeRoot, status: "failed", error: "manifest is incomplete or has an unexpected target" };
      }
      const actualDigest = digestTree(runtimeRoot, new Set(["manifest.json"]));
      if (actualDigest !== manifest.filesDigest.toLowerCase()) {
        return { relativeRoot, target, status: "failed", error: `digest mismatch (expected ${manifest.filesDigest}, got ${actualDigest})` };
      }
      const incompatibleLaunchers = listIncompatibleWindowsDistlibLaunchers(runtimeRoot, target);
      if (incompatibleLaunchers.length) {
        return {
          relativeRoot,
          target,
          status: "failed",
          error: `contains ${incompatibleLaunchers.length} incompatible distlib launcher(s): ${incompatibleLaunchers.join(", ")}`
        };
      }
      return { relativeRoot, target, status: "passed", digest: actualDigest };
    } catch (error) {
      return { relativeRoot, status: "failed", error: error instanceof Error ? error.message : String(error) };
    }
  });
}

function findBundledPythonRuntimeRoots(root) {
  const roots = [];
  const visit = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
      const child = path.join(directory, entry.name);
      if (entry.name === "python-runtime") {
        for (const target of fs.readdirSync(child, { withFileTypes: true })) {
          if (!target.isDirectory() || target.isSymbolicLink()) continue;
          const runtimeRoot = path.join(child, target.name);
          if (fs.existsSync(path.join(runtimeRoot, "manifest.json"))) roots.push(runtimeRoot);
        }
        continue;
      }
      visit(child);
    }
  };
  visit(root);
  return roots.sort((left, right) => left.localeCompare(right));
}

function digestTree(root, excludedRelativePaths) {
  const hash = crypto.createHash("sha256");
  const walk = (directory) => {
    const entries = fs.readdirSync(directory, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const absolute = path.join(directory, entry.name);
      const relative = path.relative(root, absolute).split(path.sep).join("/");
      if (excludedRelativePaths.has(relative)) continue;
      if (entry.isSymbolicLink()) throw new Error(`bundled runtime contains symlink: ${relative}`);
      if (entry.isDirectory()) walk(absolute);
      else if (entry.isFile()) {
        hash.update(relative); hash.update("\0");
        hash.update(fs.readFileSync(absolute)); hash.update("\0");
      } else throw new Error(`bundled runtime contains unsupported file: ${relative}`);
    }
  };
  walk(root);
  return hash.digest("hex");
}

function expandNestedArchives(root, extractor) {
  const queue = findArchiveFiles(root);
  const expanded = [];
  const seen = new Set();
  for (let index = 0; index < queue.length && expanded.length < 16; index += 1) {
    const archive = queue[index];
    if (seen.has(archive)) continue;
    seen.add(archive);
    const output = `${archive}.openmind-extracted`;
    fs.mkdirSync(output, { recursive: true });
    const result = spawnSync(extractor.command, [...extractor.args, archive, `-o${output}`], {
      cwd: appRoot,
      encoding: "utf8",
      maxBuffer: 4 * 1024 * 1024
    });
    if (result.error || result.status !== 0) {
      expanded.push({ archive: path.relative(root, archive), status: "failed", error: result.error?.message || result.stderr || result.stdout || `extractor exited with ${result.status}` });
      continue;
    }
    expanded.push({ archive: path.relative(root, archive), status: "passed", extractedFiles: countFiles(output) });
    queue.push(...findArchiveFiles(output));
  }
  return expanded;
}

function findArchiveFiles(directory) {
  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...findArchiveFiles(target));
    else if (entry.isFile() && /\.(?:7z|zip|rar|tar|tgz)$/i.test(entry.name)) files.push(target);
  }
  return files;
}

function containsFileNamed(directory, expectedName) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory() && containsFileNamed(target, expectedName)) return true;
    if (entry.isFile() && entry.name.toLowerCase() === expectedName.toLowerCase()) return true;
  }
  return false;
}

function findExtractor() {
  const candidates = [];
  if (process.env.OPENMIND_7ZZ) candidates.push(process.env.OPENMIND_7ZZ);
  candidates.push("7zz", "7z");
  candidates.push(path.join(appRoot, "node_modules", "electron-winstaller", "vendor", "7z.exe"));
  candidates.push(...cachedElectronBuilderExtractors());
  for (const candidate of candidates) {
    const probe = spawnSync(candidate, ["i"], { stdio: "ignore" });
    if (!probe.error && probe.status === 0) return { command: candidate, args: ["x", "-y"] };
  }
  throw new Error("7-Zip extractor is required. Set OPENMIND_7ZZ to an executable 7zz path or run electron-builder first so its cached extractor is available.");
}

function cachedElectronBuilderExtractors() {
  const cacheRoots = process.env.ELECTRON_BUILDER_CACHE
    ? [path.resolve(process.env.ELECTRON_BUILDER_CACHE)]
    : defaultElectronBuilderCacheRoots();
  const names = process.platform === "win32" ? ["7zz.exe", "7za.exe", "7z.exe"] : ["7zz", "7za"];
  return cacheRoots.flatMap((cacheRoot) => {
    const sevenZipRoot = path.join(cacheRoot, "7zip@1.0.0");
    if (!fs.existsSync(sevenZipRoot)) return [];
    let entries;
    try { entries = fs.readdirSync(sevenZipRoot, { withFileTypes: true }); } catch { return []; }
    return entries
      .filter((entry) => entry.isDirectory())
      .flatMap((entry) => names.map((name) => path.join(sevenZipRoot, entry.name, "bin", name)))
      .filter((candidate) => fs.existsSync(candidate));
  });
}

function defaultElectronBuilderCacheRoots() {
  const home = os.homedir();
  if (process.platform === "darwin") return [path.join(home, "Library", "Caches", "electron-builder")];
  if (process.platform === "win32") {
    const localAppData = process.env.LOCALAPPDATA?.trim();
    return [
      localAppData ? path.join(localAppData, "electron-builder", "Cache") : null,
      path.join(os.tmpdir(), "electron-builder-cache")
    ].filter(Boolean);
  }
  const xdgCache = process.env.XDG_CACHE_HOME?.trim();
  return [xdgCache ? path.join(xdgCache, "electron-builder") : path.join(home, ".cache", "electron-builder")];
}

function isContainer(name, targetPlatform) {
  const lower = name.toLowerCase();
  if (lower.endsWith(".blockmap")) return false;
  if (targetPlatform === "win") {
    return lower.endsWith(".exe") || (lower.endsWith(".zip") && /(?:^|[-_.])win(?:[-_.]|$)/.test(lower));
  }
  return lower.endsWith(".dmg") || (lower.endsWith(".zip") && /(?:^|[-_.])mac(?:[-_.]|$)/.test(lower));
}

function artifactKind(name, targetPlatform) {
  const lower = name.toLowerCase();
  if (targetPlatform === "win" && lower.includes("portable")) return "portable";
  if (targetPlatform === "win" && (lower.includes("setup") || lower.includes("nsis"))) return "nsis";
  if (lower.endsWith(".dmg")) return "dmg";
  return "zip";
}

function countFiles(directory) {
  let count = 0;
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) count += countFiles(target);
    else if (entry.isFile()) count += 1;
  }
  return count;
}

function sha256File(filePath) {
  const hash = crypto.createHash("sha256");
  const descriptor = fs.openSync(filePath, "r");
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  try {
    let offset = 0;
    let bytesRead;
    do {
      bytesRead = fs.readSync(descriptor, buffer, 0, buffer.length, offset);
      if (bytesRead > 0) hash.update(buffer.subarray(0, bytesRead));
      offset += bytesRead;
    } while (bytesRead > 0);
  } finally {
    fs.closeSync(descriptor);
  }
  return hash.digest("hex");
}

function parseArgs(values) {
  const parsed = {};
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (!value.startsWith("--")) continue;
    const [key, inline] = value.slice(2).split("=", 2);
    parsed[key] = inline ?? values[++index];
  }
  return parsed;
}

function readJson(filePath) {
  try { return JSON.parse(fs.readFileSync(filePath, "utf8")); } catch { return null; }
}

function writeReport(value) {
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}
