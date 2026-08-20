#!/usr/bin/env node
"use strict";

/**
 * Target-host packaged recovery smoke.
 *
 * This is intentionally separate from recovery-drill.js: it launches the
 * actual packaged executable, force-terminates it, creates the same
 * app-state restore transaction that can be left by a crash, then launches
 * the package again and verifies that startup recovery restores the previous
 * state. The user-data directory is required to be disposable TEMP data.
 *
 * It does not claim Runtime Pack install/update recovery, clean-machine or
 * disaster-recovery acceptance. Those scenarios remain in the external
 * acceptance matrix.
 */

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFile, spawn } = require("node:child_process");
const { promisify } = require("node:util");

const execFileAsync = promisify(execFile);
const args = parseArgs(process.argv.slice(2));
const appExecutable = requireAbsoluteFile(args.app, "--app");
const userDataDir = requireDisposableUserData(args["user-data-dir"]);
const output = path.resolve(args.output || path.join(path.dirname(appExecutable), "packaged-recovery-report.json"));
const timeoutMs = parseTimeout(args["timeout-ms"] || "30000");
const keepUserData = args["keep-user-data"] === "true" || args["keep-user-data"] === "1";
const settingsDir = path.join(userDataDir, "settings");
const settingsFile = path.join(settingsDir, "settings.json");
const stagingDir = path.join(userDataDir, "staging");
const transactionDir = path.join(stagingDir, "state-backup-restore-recovery");
const report = {
  schemaVersion: 1,
  kind: "openmind-packaged-recovery-smoke",
  generatedAt: new Date().toISOString(),
  status: "failed",
  host: { platform: process.platform, arch: process.arch, node: process.version, os: os.release() },
  app: path.basename(appExecutable),
  userData: path.basename(userDataDir),
  scenarios: [],
  externalGates: [
    "Runtime Pack install/update force-quit",
    "Windows/macOS Clean-machine Matrix",
    "target-OS disaster recovery"
  ],
  error: null
};

run().then(() => {
  report.status = "passed";
  writeReport();
  console.log("Packaged recovery smoke passed: forced termination, startup restore and transaction cleanup.");
}).catch(async (error) => {
  report.error = sanitize(String(error?.message || error));
  writeReport();
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exitCode = 1;
}).finally(() => {
  if (!keepUserData && fs.existsSync(userDataDir)) {
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
});

async function run() {
  if (fs.existsSync(userDataDir)) throw new Error(`Disposable user-data directory already exists: ${userDataDir}`);
  fs.mkdirSync(userDataDir, { recursive: true });

  const initial = await launchAndForceQuit("initial-startup");
  report.scenarios.push(initial);
  if (!initial.forcedTermination) throw new Error("Packaged app exited before the forced-termination step.");

  writeInterruptedRestoreTransaction();
  const recovery = await launchAndForceQuit("startup-recovery", { waitForRecovery: true });
  if (!recovery.forcedTermination) throw new Error("Packaged app exited normally during the startup-recovery force-quit step.");
  const restored = fs.existsSync(settingsFile) && fs.readFileSync(settingsFile, "utf8") === "before-crash\n";
  const transactionRemoved = !fs.existsSync(transactionDir);
  report.scenarios.push({
    ...recovery,
    restoredPreviousState: restored,
    transactionRemoved
  });
  if (!restored) throw new Error("Packaged startup did not restore the previous app-state snapshot.");
  if (!transactionRemoved) throw new Error("Packaged startup left the interrupted restore transaction behind.");
}

async function launchAndForceQuit(id, options = {}) {
  const child = spawn(appExecutable, [`--user-data-dir=${userDataDir}`], {
    cwd: path.dirname(appExecutable),
    detached: process.platform !== "win32",
    windowsHide: true,
    stdio: "ignore",
    env: sanitizedEnvironment()
  });
  const startedAt = new Date().toISOString();
  try {
    await waitForStartup(child);
    if (options.waitForRecovery) await waitForRecovery(child);
    else await delay(750);
    const exit = await terminateProcessTree(child);
    const forcedTermination = process.platform === "win32"
      ? exit.code !== 0 || exit.signal !== null
      : exit.signal === "SIGKILL";
    return {
      id,
      status: forcedTermination ? "passed" : "failed",
      startedAt,
      readyAt: new Date().toISOString(),
      forcedTermination,
      exit: { code: exit.code, signal: exit.signal }
    };
  } catch (error) {
    if (child.exitCode === null && child.signalCode === null) {
      await terminateProcessTree(child).catch(() => undefined);
    }
    throw error;
  }
}

async function waitForRecovery(child) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (fs.existsSync(settingsFile)
      && fs.readFileSync(settingsFile, "utf8") === "before-crash\n"
      && !fs.existsSync(transactionDir)) return;
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(`Packaged app exited before startup recovery completed: code=${child.exitCode} signal=${child.signalCode}`);
    }
    await delay(100);
  }
  throw new Error(`Packaged startup recovery did not restore and clean its transaction within ${timeoutMs}ms.`);
}

async function waitForStartup(child) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (fs.existsSync(settingsDir) && isAlive(child.pid)) return;
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(`Packaged app exited before startup became ready: code=${child.exitCode} signal=${child.signalCode}`);
    }
    await delay(100);
  }
  throw new Error(`Packaged app did not create its app-private settings directory within ${timeoutMs}ms.`);
}

async function terminateProcessTree(child) {
  if (child.exitCode !== null || child.signalCode !== null) {
    return { code: child.exitCode, signal: child.signalCode };
  }

  if (process.platform === "win32") {
    try { await execFileAsync("taskkill", ["/PID", String(child.pid), "/T", "/F"]); }
    catch { child.kill(); }
  } else {
    try { process.kill(-child.pid, "SIGKILL"); }
    catch { child.kill("SIGKILL"); }
  }
  return waitForExit(child, timeoutMs);
}

function writeInterruptedRestoreTransaction() {
  fs.mkdirSync(path.join(transactionDir, "previous", "settings"), { recursive: true });
  fs.writeFileSync(settingsFile, "partially-applied\n", "utf8");
  fs.writeFileSync(path.join(transactionDir, "previous", "settings", "settings.json"), "before-crash\n", "utf8");
  fs.writeFileSync(path.join(transactionDir, "marker.json"), `${JSON.stringify({
    kind: "openmind-app-state-backup",
    schemaVersion: 1,
    phase: "committing"
  })}\n`, "utf8");
}

function sanitizedEnvironment() {
  const environment = { ...process.env };
  for (const key of [
    "OPENMIND_REPO_ROOT",
    "OPENMIND_USER_DATA_DIR",
    "OPENMIND_STATE_ROOT",
    "OPENMIND_ROOT",
    "OPENAI_API_KEY",
    "ANTHROPIC_API_KEY",
    "GOOGLE_API_KEY",
    "NVIDIA_API_KEY",
    "AWS_SECRET_ACCESS_KEY",
    "PLAYWRIGHT_MCP_EXTENSION_TOKEN",
    "NODE_OPTIONS",
    "NODE_PATH",
    "PYTHONPATH",
    "PYTHONHOME",
    "LD_PRELOAD",
    "DYLD_INSERT_LIBRARIES"
  ]) delete environment[key];
  return environment;
}

function requireAbsoluteFile(value, flag) {
  if (!value) throw new Error(`${flag} is required.`);
  const resolved = path.resolve(value);
  if (!path.isAbsolute(value) || !fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) {
    throw new Error(`${flag} must point to an existing packaged executable: ${value}`);
  }
  return resolved;
}

function requireDisposableUserData(value) {
  if (!value) throw new Error("--user-data-dir is required.");
  const resolved = path.resolve(value);
  const tempRoot = path.resolve(os.tmpdir());
  const relative = path.relative(tempRoot, resolved);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`--user-data-dir must be a child of the system TEMP directory: ${resolved}`);
  }
  let existingParent = path.dirname(resolved);
  while (!fs.existsSync(existingParent) && path.dirname(existingParent) !== existingParent) {
    existingParent = path.dirname(existingParent);
  }
  const realTempRoot = fs.realpathSync(tempRoot);
  const realParent = fs.realpathSync(existingParent);
  const realRelative = path.relative(realTempRoot, realParent);
  if (realRelative.startsWith("..") || path.isAbsolute(realRelative)) {
    throw new Error(`--user-data-dir must resolve below the system TEMP directory: ${resolved}`);
  }
  return resolved;
}

function parseTimeout(value) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 5_000 || parsed > 120_000) throw new Error("--timeout-ms must be an integer between 5000 and 120000.");
  return parsed;
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

function waitForExit(child, waitMs) {
  return new Promise((resolve, reject) => {
    if (child.exitCode !== null || child.signalCode !== null) {
      resolve({ code: child.exitCode, signal: child.signalCode });
      return;
    }
    const timer = setTimeout(() => reject(new Error(`Packaged app did not exit after forced termination within ${waitMs}ms.`)), waitMs);
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("exit", (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal });
    });
  });
}

function isAlive(pid) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function writeReport() {
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`, "utf8");
}

function sanitize(value) {
  return value.replaceAll(userDataDir, "<temporary-user-data>").slice(-4_000);
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
