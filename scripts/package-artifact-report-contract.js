#!/usr/bin/env node
"use strict";

/** Black-box contract checks for package evidence binding. */

const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const appRoot = path.resolve(__dirname, "..");
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "cctools-package-artifact-report-"));
const reportScript = path.join(appRoot, "scripts", "package-artifact-report.js");

try {
  const fixture = createFixture();
  const validOutput = path.join(tempRoot, "valid-evidence.json");
  const valid = run(fixture, validOutput);
  if (valid.status !== 0) fail(`complete package evidence fixture failed: ${valid.stderr || valid.stdout}`);
  const validEvidence = readJson(validOutput);
  if (validEvidence.packagedRecovery !== "passed") fail("complete package evidence did not record packagedRecovery=passed");
  if (validEvidence.packagedRecoveryEvidence?.validated !== true) fail("complete package evidence did not bind the recovery report");
  if (validEvidence.packagedRecoveryEvidence?.forcedTerminationCount !== 2) fail("complete package evidence did not record both forced terminations");

  writeJson(fixture.recoveryReport, {
    ...readJson(fixture.recoveryReport),
    host: { platform: "linux", arch: "arm64" }
  });
  const invalidOutput = path.join(tempRoot, "invalid-evidence.json");
  const invalid = run(fixture, invalidOutput);
  if (invalid.status === 0) fail("package evidence accepted a recovery report from the wrong host platform");

  console.log("Package artifact evidence contract passed: packaged recovery is bound to a valid target-host report and forged host data fails closed.");
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}

function createFixture() {
  const dist = path.join(tempRoot, "dist");
  fs.mkdirSync(dist, { recursive: true });
  const files = [
    ["CC-Tools-Portable-test.exe", "portable-fixture"],
    ["CC-Tools-Setup-test.exe", "nsis-fixture"],
    ["CC-Tools-test-win.zip", "zip-fixture"]
  ].map(([name, content]) => {
    const file = path.join(dist, name);
    fs.writeFileSync(file, content, "utf8");
    const bytes = fs.statSync(file).size;
    return { file, name, bytes, sha256: sha256File(file), kind: artifactKind(name) };
  });

  const safetyReport = path.join(tempRoot, "package-safety-report.json");
  writeJson(safetyReport, { status: "passed", scannedFiles: 3, findings: [] });
  const artifactSafetyReport = path.join(tempRoot, "package-artifact-safety-report.json");
  writeJson(artifactSafetyReport, {
    schemaVersion: 1,
    kind: "cctools-package-artifact-safety",
    platform: "win",
    status: "passed",
    artifacts: files.map((artifact) => ({ ...artifact, status: "passed", containsAsar: true })),
    passedArtifacts: files.length,
    failedArtifacts: [],
    missingKinds: []
  });
  const recoveryReport = path.join(tempRoot, "packaged-recovery-report.json");
  writeJson(recoveryReport, {
    schemaVersion: 1,
    kind: "cctools-packaged-recovery-smoke",
    status: "passed",
    host: { platform: "win32", arch: "x64" },
    scenarios: [
      { id: "initial-startup", status: "passed", forcedTermination: true },
      { id: "startup-recovery", status: "passed", forcedTermination: true, restoredPreviousState: true, transactionRemoved: true }
    ]
  });
  return { dist, safetyReport, artifactSafetyReport, recoveryReport };
}

function run(fixture, output) {
  return spawnSync(process.execPath, [
    reportScript,
    "--platform", "win",
    "--dist", fixture.dist,
    "--safety-report", fixture.safetyReport,
    "--artifact-safety-report", fixture.artifactSafetyReport,
    "--packaged-recovery-report", fixture.recoveryReport,
    "--require-safety=true",
    "--require-artifact-safety=true",
    "--require-packaged-recovery=true",
    "--packaged-smoke=passed",
    "--recovery-drill=passed",
    "--packaged-recovery=passed",
    "--output", output
  ], { cwd: appRoot, encoding: "utf8", maxBuffer: 4 * 1024 * 1024 });
}

function artifactKind(name) {
  const lower = name.toLowerCase();
  if (lower.includes("portable")) return "portable";
  if (lower.includes("setup")) return "nsis";
  return "zip";
}

function sha256File(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function writeJson(file, value) {
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function fail(message) {
  throw new Error(message);
}
