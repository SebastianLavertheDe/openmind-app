#!/usr/bin/env node
"use strict";

/**
 * Black-box regression for package-safety-scan.js. The fixture proves that
 * third-party license prose is not treated as executable diagnostic behavior,
 * while an app-owned JavaScript diagnostic path still fails closed.
 */

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const appRoot = path.resolve(__dirname, "..");
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "openmind-package-safety-"));
const scanner = path.join(appRoot, "scripts", "package-safety-scan.js");

try {
  fs.writeFileSync(path.join(tempRoot, "LICENSES.chromium.html"), [
    "<html><body>heap/core dump, CRASH_REPORTER and SENTRY_DSN are mentioned",
    "as third-party license terminology only.</body></html>"
  ].join("\n"), "utf8");
  fs.writeFileSync(path.join(tempRoot, "app.js"), "console.log('safe app code');\n", "utf8");

  const safeOutput = path.join(tempRoot, "safe-report.json");
  const safe = run(tempRoot, safeOutput);
  if (safe.status !== 0) fail(`license prose fixture failed: ${safe.stderr || safe.stdout}`);
  const safeReport = readJson(safeOutput);
  if (safeReport.status !== "passed" || safeReport.findings.length !== 0) {
    fail("license prose fixture produced package safety findings");
  }

  fs.writeFileSync(path.join(tempRoot, "worker.js"), "process.report.writeReport();\n", "utf8");
  const unsafeOutput = path.join(tempRoot, "unsafe-report.json");
  const unsafe = run(tempRoot, unsafeOutput);
  if (unsafe.status === 0) fail("app-owned process.report fixture was accepted");
  const unsafeReport = readJson(unsafeOutput);
  if (!unsafeReport.findings.some((finding) => finding.includes("Node diagnostic report"))) {
    fail("app-owned process.report finding was not recorded");
  }

  console.log("Package safety contract passed: license prose is ignored; app-owned diagnostic code fails closed.");
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}

function run(target, output) {
  return spawnSync(process.execPath, [scanner, "--only-target", target, "--output", output], {
    cwd: appRoot,
    encoding: "utf8",
    maxBuffer: 4 * 1024 * 1024
  });
}

function readJson(filePath) {
  try { return JSON.parse(fs.readFileSync(filePath, "utf8")); }
  catch (error) { fail(`invalid package safety report: ${error.message}`); }
}

function fail(message) {
  throw new Error(message);
}
