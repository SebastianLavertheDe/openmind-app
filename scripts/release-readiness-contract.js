#!/usr/bin/env node
"use strict";

/** Black-box contract checks for the aggregate release-readiness gate. */

const fs = require("node:fs");
const crypto = require("node:crypto");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const appRoot = path.resolve(__dirname, "..");
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "openmind-release-readiness-"));
const targetCheckoutRoot = fs.mkdtempSync(path.join(os.tmpdir(), "openmind-release-readiness-checkout-"));
const targetBuildRoot = path.join(targetCheckoutRoot, ".build");

try {
  writeFixture(false);
  const passedOutput = path.join(tempRoot, "ready.json");
  const passed = run(passedOutput, true);
  if (passed.status !== 0) fail(`complete readiness fixture failed: ${passed.stderr || passed.stdout}`);
  const passedReport = readJson(passedOutput);
  if (passedReport.status !== "ready" || passedReport.failedChecks.length) fail("complete readiness fixture did not pass");

  for (const test of [
    { file: "provider-e2e-report.json", id: "provider-e2e", mutate: (value) => { value.incompleteCount = 1; } },
    { file: "security-review-report.json", id: "security-review", mutate: (value) => { value.reviewerComplete = false; } },
    { file: "clean-machine-report.json", id: "clean-machine", mutate: (value) => { value.passedCount = 0; } },
    { file: "package-evidence-win-local.json", id: "packaged-recovery", mutate: (value) => { delete value.packagedRecovery; } },
    { file: "package-evidence-win-local.json", id: "packaged-recovery", mutate: (value) => { delete value.packagedRecoveryEvidence; } }
  ]) {
    writeFixture(false);
    const forgedPath = path.join(tempRoot, test.file);
    const forgedReport = readJson(forgedPath);
    test.mutate(forgedReport);
    fs.writeFileSync(forgedPath, `${JSON.stringify(forgedReport)}\n`, "utf8");
    const forgedOutput = path.join(tempRoot, `${test.id}-forged.json`);
    const forged = run(forgedOutput, true);
    if (forged.status === 0) fail(`forged ${test.id} report was accepted by strict readiness`);
    if (!readJson(forgedOutput).failedChecks.includes(test.id)) fail(`readiness did not report forged ${test.id} report`);
  }

  writeFixture(false, true);
  const tamperedOutput = path.join(tempRoot, "tampered.json");
  const tampered = run(tamperedOutput, true);
  if (tampered.status === 0) fail("tampered release evidence was accepted by strict readiness");
  const tamperedReport = readJson(tamperedOutput);
  if (!tamperedReport.failedChecks.includes("release-evidence")) fail("readiness did not report tampered release evidence");

  writeFixture(true);
  const rejectedOutput = path.join(tempRoot, "rejected.json");
  const rejected = run(rejectedOutput, true);
  if (rejected.status === 0) fail("missing macOS artifact evidence was accepted by strict readiness");
  const rejectedReport = readJson(rejectedOutput);
  if (!rejectedReport.failedChecks.includes("macos-artifact-evidence")) fail("readiness did not report the missing macOS gate");

  writeFixture(false);
  fs.mkdirSync(path.join(tempRoot, "dist"), { recursive: true });
  fs.writeFileSync(path.join(tempRoot, "package-artifact-safety-mac.json"), `${JSON.stringify({ platform: "mac", status: "passed", failedArtifacts: [], missingKinds: [] })}\n`, "utf8");
  const targetMacEvidence = path.join(tempRoot, "dist", "package-evidence-macos.json");
  fs.renameSync(path.join(tempRoot, "package-evidence-win-local.json"), path.join(tempRoot, "dist", "package-evidence-windows.json"));
  fs.renameSync(path.join(tempRoot, "package-evidence-mac-local.json"), targetMacEvidence);
  fs.rmSync(path.join(tempRoot, "package-artifact-safety-mac-local.json"));
  const targetStyleOutput = path.join(tempRoot, "target-style.json");
  const targetStyle = run(targetStyleOutput, true);
  if (targetStyle.status !== 0) fail(`target-style staged evidence paths failed: ${targetStyle.stderr || targetStyle.stdout}`);
  if (readJson(targetStyleOutput).status !== "ready") fail("target-style staged evidence paths did not produce ready status");

  // Mirror the real checkout layout: release-readiness reports live in
  // checkout/.build while staged package evidence lives in checkout/dist.
  writeFixture(false, false, targetBuildRoot);
  fs.mkdirSync(path.join(targetCheckoutRoot, "dist"), { recursive: true });
  fs.renameSync(path.join(targetBuildRoot, "package-evidence-win-local.json"), path.join(targetCheckoutRoot, "dist", "package-evidence-windows.json"));
  fs.renameSync(path.join(targetBuildRoot, "package-evidence-mac-local.json"), path.join(targetCheckoutRoot, "dist", "package-evidence-macos.json"));
  const parentStyleOutput = path.join(targetCheckoutRoot, "parent-style.json");
  const parentStyle = run(parentStyleOutput, true, targetBuildRoot);
  if (parentStyle.status !== 0) fail(`checkout/.build -> checkout/dist evidence paths failed: ${parentStyle.stderr || parentStyle.stdout}`);
  if (readJson(parentStyleOutput).status !== "ready") fail("checkout/.build -> checkout/dist evidence paths did not produce ready status");

  console.log("Release readiness contract passed: complete and target-style fixtures pass, tampered evidence fails, and missing in-scope gates fail closed.");
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
  fs.rmSync(targetCheckoutRoot, { recursive: true, force: true });
}

function writeFixture(missingMac, tamperReleaseEvidence = false, fixtureRoot = tempRoot) {
  const write = (relative, value) => {
    const target = path.join(fixtureRoot, relative);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, `${JSON.stringify(value)}\n`, "utf8");
  };
  write("audit-evidence.json", { checks: Array.from({ length: 26 }, (_, index) => ({ id: index + 1 })), failed: [] });
  write("release-evidence/sbom.cdx.json", { bomFormat: "CycloneDX", components: [{ name: "fixture" }] });
  write("release-evidence/licenses.json", { kind: "openmind-license-report", componentCount: 1, unknownLicenseCount: 0 });
  write("release-evidence/provenance.json", { kind: "openmind-build-provenance", artifact: { treeSha256: "d".repeat(64) } });
  const artifactFiles = ["sbom.cdx.json", "licenses.json", "provenance.json"].map((name) => {
    const filePath = path.join(fixtureRoot, "release-evidence", name);
    const content = fs.readFileSync(filePath);
    return { path: `release-evidence/${name}`, bytes: content.length, sha256: crypto.createHash("sha256").update(content).digest("hex") };
  });
  write("release-evidence/index.json", {
    kind: "openmind-release-evidence-index",
    artifacts: artifactFiles,
    sbom: { format: "CycloneDX", path: "release-evidence/sbom.cdx.json", componentCount: 1 },
    licenses: { path: "release-evidence/licenses.json", componentCount: 1, unknownLicenseCount: 0 },
    provenance: { path: "release-evidence/provenance.json", treeSha256: "d".repeat(64) }
  });
  if (tamperReleaseEvidence) fs.appendFileSync(path.join(fixtureRoot, "release-evidence", "sbom.cdx.json"), "tampered\n", "utf8");
  for (const name of ["recovery-drill-report.json", "process-crash-recovery-report.json", "stability-soak-report.json"]) write(name, { status: "passed" });
  write("visual-snapshot-report.json", { snapshots: [{ id: "visual-1" }], stateSnapshots: [{ id: "state-1" }], failures: [] });
  write("package-safety-report.json", { status: "passed" });
  write("package-artifact-safety-report.json", { platform: "win", status: "passed", failedArtifacts: [], missingKinds: [] });
  write("package-artifact-safety-mac-local.json", { platform: "mac", status: missingMac ? "manual-required" : "passed", failedArtifacts: [], missingKinds: missingMac ? ["dmg"] : [] });
  const packagedRecoveryEvidence = { status: "passed", kind: "openmind-packaged-recovery-smoke", validated: true, scenarioCount: 2, forcedTerminationCount: 2, restoredPreviousState: true, transactionRemoved: true };
  write("package-evidence-win-local.json", { platform: "win", targetValidation: "passed", artifactSafety: { validated: true }, packagedSmoke: "passed", recoveryDrill: "passed", packagedRecovery: "passed", packagedRecoveryEvidence });
  write("package-evidence-mac-local.json", { platform: "mac", targetValidation: missingMac ? "manual-required" : "passed", artifactSafety: { validated: true }, packagedSmoke: "passed", recoveryDrill: "passed", packagedRecovery: "passed", packagedRecoveryEvidence });
  write("provider-e2e-report.json", {
    status: "complete", rowCount: 1, cellCount: 2, pendingCount: 0, incompleteCount: 0,
    invalidRows: [], duplicateCases: [], invalidEvidenceRows: []
  });
  write("security-review-report.json", {
    status: "complete", declaredStatus: "complete", reviewerComplete: true, findingCount: 5,
    openP0P1: [], missingRequiredFindings: [], duplicateFindingIds: [], unexpectedFindingIds: [],
    missingRequiredExternalEvidence: [], invalidRequiredPriorities: []
  });
  write("clean-machine-report.json", {
    status: "complete", declaredStatus: "complete", matrixScenarioCount: 1, passedCount: 1,
    pendingCount: 0, blockedCount: 0,
    scenarios: [{ status: "passed", hasConcreteEvidence: true, missingEvidenceFields: [] }]
  });
}

function run(outputPath, strict, buildRoot = tempRoot) {
  return spawnSync(process.execPath, [path.join(appRoot, "scripts", "release-readiness-report.js")], {
    cwd: appRoot,
    env: {
      ...process.env,
      OPENMIND_RELEASE_READINESS_BUILD_ROOT: buildRoot,
      OPENMIND_RELEASE_READINESS_OUTPUT: outputPath,
      OPENMIND_RELEASE_READINESS_STRICT: strict ? "1" : "0"
    },
    encoding: "utf8",
    maxBuffer: 4 * 1024 * 1024
  });
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function fail(message) {
  throw new Error(message);
}
