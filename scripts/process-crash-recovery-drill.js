#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");

const appRoot = path.resolve(__dirname, "..");
const buildRunStore = path.join(appRoot, ".build", "electron", "electron", "execution", "run-store.js");
const childScript = path.join(__dirname, "process-crash-recovery-child.js");
const reportOutput = path.resolve(process.env.OPENMIND_PROCESS_CRASH_RECOVERY_OUTPUT || path.join(appRoot, ".build", "process-crash-recovery-report.json"));
const root = fs.mkdtempSync(path.join(os.tmpdir(), "openmind-process-crash-drill-"));
const runsRoot = path.join(root, "runs");
const secret = "process-crash-drill-secret";

run().then(() => {
  writeReport("passed");
}).catch((error) => {
  writeReport("failed", error);
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exitCode = 1;
}).finally(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

function writeReport(status, error = null) {
  fs.mkdirSync(path.dirname(reportOutput), { recursive: true });
  fs.writeFileSync(reportOutput, `${JSON.stringify({
    schemaVersion: 1,
    kind: "openmind-process-crash-recovery-drill",
    generatedAt: new Date().toISOString(),
    status,
    scope: "compiled RunStore restart after child-process forced termination on the current host",
    externalGates: ["packaged Windows/macOS force-quit", "target-OS disaster recovery"],
    error: error ? String(error?.message || error) : null
  }, null, 2)}\n`, "utf8");
}

async function run() {
  if (!fs.existsSync(buildRunStore)) throw new Error("Compiled RunStore is missing. Run npm run build first.");
  const child = spawn(process.execPath, [childScript, runsRoot], {
    cwd: appRoot,
    stdio: ["ignore", "pipe", "pipe"]
  });
  let stderr = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  const readyOutput = await waitForReady(child, () => stderr);
  const exitPromise = waitForExit(child);
  const terminationSignal = "SIGKILL";
  if (!child.kill(terminationSignal)) {
    throw new Error(`Crash child could not be terminated with ${terminationSignal}.`);
  }
  const exit = await exitPromise;
  assertCrashTermination(exit, terminationSignal);
  assert(!readyOutput.includes(secret) && !stderr.includes(secret), "process-crash drill exposed a Secret in child output");

  const { RunStore } = require(buildRunStore);
  const reopened = new RunStore(runsRoot);
  const recovered = reopened.recoverInterrupted("process-killed-drill");
  assert(recovered.length === 1, "process-killed Run was not recovered");
  assert(recovered[0].state === "failed" && recovered[0].terminalState === "failed", "process-killed Run is not terminal failed");
  assert(recovered[0].processPid === null && recovered[0].orphanPid === null, "dead child PID was not cleared safely");
  assert(String(recovered[0].error).includes("process-killed-drill"), "recovery reason was not persisted");
  assert(reopened.events(recovered[0].id).some((event) => event.reason === "process-killed-drill"), "recovery event was not persisted");
  assert(!readTree(root).includes(secret), "process-crash drill persisted a Secret");
  assert(reopened.recoverInterrupted("second-process-killed-drill").length === 0, "terminal Run was recovered twice");
  console.log("Process crash recovery drill passed: child forced termination, compiled RunStore restart recovery, terminal failure and Secret boundary.");
}

function assertCrashTermination(exit, terminationSignal) {
  if (process.platform === "win32") {
    // Node maps child.kill() to TerminateProcess on Windows and reports no
    // POSIX signal. A non-zero exit code is the observable forced-termination
    // contract; a clean exit would mean the drill did not simulate a crash.
    if ((exit.signal !== null && exit.signal !== terminationSignal) || exit.code === 0) {
      throw new Error(`Crash child did not terminate through Windows forced termination (${terminationSignal}): ${JSON.stringify(exit)}`);
    }
    return;
  }
  if (exit.signal !== "SIGKILL") {
    throw new Error(`Crash child did not terminate by SIGKILL: ${JSON.stringify(exit)}`);
  }
}

function waitForReady(child, getStderr) {
  return new Promise((resolve, reject) => {
    let stdout = "";
    let settled = false;
    const timer = setTimeout(() => finish(new Error(`Crash child did not become ready: ${getStderr() || stdout}`)), 15000);
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
      if (stdout.includes("READY")) finish();
    });
    child.once("error", (error) => finish(error));
    child.once("exit", (code, signal) => {
      if (!settled) finish(new Error(`Crash child exited before ready: code=${code} signal=${signal}; ${getStderr() || stdout}`));
    });

    function finish(error) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve(stdout);
    }
  });
}

function waitForExit(child) {
  return new Promise((resolve) => {
    child.once("exit", (code, signal) => resolve({ code, signal }));
  });
}

function readTree(directory) {
  const values = [];
  walk(directory);
  return values.join("\n");

  function walk(current) {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const target = path.join(current, entry.name);
      if (entry.isDirectory()) walk(target);
      else if (entry.isFile()) values.push(fs.readFileSync(target, "utf8"));
    }
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
