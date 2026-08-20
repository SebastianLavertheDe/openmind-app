#!/usr/bin/env node
"use strict";

/**
 * Black-box contract checks for the two evidence gates that intentionally stay
 * non-blocking until external evidence arrives. The fixtures live in a temp
 * directory and are never written to the repository's pending evidence files.
 */

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const appRoot = path.resolve(__dirname, "..");
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "openmind-evidence-gate-"));
const today = new Date().toISOString().slice(0, 10);
const sha256 = "a".repeat(64);

try {
  const securityFixture = path.join(tempRoot, "SECURITY_REVIEW.md");
  const securityPassedOutput = path.join(tempRoot, "security-passed.json");
  const securityRejectedOutput = path.join(tempRoot, "security-rejected.json");
  const securityInvalidPathOutput = path.join(tempRoot, "security-invalid-path.json");
  const securityInvalidDateOutput = path.join(tempRoot, "security-invalid-date.json");
  const securityInvalidIndependenceOutput = path.join(tempRoot, "security-invalid-independence.json");
  fs.writeFileSync(securityFixture, buildSecurityFixture(), "utf8");

  const securityPassed = run("scripts/security-review-report.js", {
    OPENMIND_SECURITY_REVIEW_FILE: securityFixture,
    OPENMIND_SECURITY_REVIEW_OUTPUT: securityPassedOutput,
    OPENMIND_SECURITY_REVIEW_STRICT: "1"
  });
  assertSuccess(securityPassed, "complete Security Review fixture");
  assertJson(securityPassedOutput).status === "complete" || fail("complete Security Review fixture did not produce complete status");

  fs.writeFileSync(securityFixture, buildSecurityFixture({ invalidExternalAudit: true }), "utf8");
  const securityRejected = run("scripts/security-review-report.js", {
    OPENMIND_SECURITY_REVIEW_FILE: securityFixture,
    OPENMIND_SECURITY_REVIEW_OUTPUT: securityRejectedOutput,
    OPENMIND_SECURITY_REVIEW_STRICT: "1"
  });
  if (securityRejected.status === 0) fail("placeholder external audit was accepted by Security Review");
  const rejectedSecurityReport = assertJson(securityRejectedOutput);
  if (!rejectedSecurityReport.missingRequiredExternalEvidence.includes("SEC-001")
    || !rejectedSecurityReport.missingRequiredExternalEvidence.includes("SEC-005")) {
    fail("Security Review did not report missing external-audit evidence");
  }

  fs.writeFileSync(securityFixture, buildSecurityFixture({ invalidLocalEvidence: true }), "utf8");
  const securityInvalidPath = run("scripts/security-review-report.js", {
    OPENMIND_SECURITY_REVIEW_FILE: securityFixture,
    OPENMIND_SECURITY_REVIEW_OUTPUT: securityInvalidPathOutput,
    OPENMIND_SECURITY_REVIEW_STRICT: "1"
  });
  if (securityInvalidPath.status === 0) fail("nonexistent local Security Review evidence path was accepted");
  const invalidPathSecurityReport = assertJson(securityInvalidPathOutput);
  if (!invalidPathSecurityReport.missingEvidenceReference.includes("SEC-002")) {
    fail("Security Review did not reject a nonexistent local evidence path");
  }

  fs.writeFileSync(securityFixture, buildSecurityFixture({ invalidReviewDate: true }), "utf8");
  const securityInvalidDate = run("scripts/security-review-report.js", {
    OPENMIND_SECURITY_REVIEW_FILE: securityFixture,
    OPENMIND_SECURITY_REVIEW_OUTPUT: securityInvalidDateOutput,
    OPENMIND_SECURITY_REVIEW_STRICT: "1"
  });
  if (securityInvalidDate.status === 0) fail("invalid Security Review date was accepted");
  if (assertJson(securityInvalidDateOutput).reviewerComplete) fail("Security Review accepted an impossible review date");

  fs.writeFileSync(securityFixture, buildSecurityFixture({ invalidIndependence: true }), "utf8");
  const securityInvalidIndependence = run("scripts/security-review-report.js", {
    OPENMIND_SECURITY_REVIEW_FILE: securityFixture,
    OPENMIND_SECURITY_REVIEW_OUTPUT: securityInvalidIndependenceOutput,
    OPENMIND_SECURITY_REVIEW_STRICT: "1"
  });
  if (securityInvalidIndependence.status === 0) fail("unsupported Security Review independence value was accepted");
  if (assertJson(securityInvalidIndependenceOutput).reviewerComplete) fail("Security Review accepted an unsupported independence value");

  const matrixPath = path.join(appRoot, ".build", "electron", "electron", "paths", "clean-machine-smoke.js");
  const { CLEAN_MACHINE_MATRIX: matrix } = require(matrixPath);
  const cleanFixture = path.join(tempRoot, "CLEAN_MACHINE_EVIDENCE.md");
  const cleanPassedOutput = path.join(tempRoot, "clean-passed.json");
  const cleanRejectedOutput = path.join(tempRoot, "clean-rejected.json");
  const cleanInvalidPathOutput = path.join(tempRoot, "clean-invalid-path.json");
  const cleanInvalidPackageOutput = path.join(tempRoot, "clean-invalid-package.json");
  const cleanInvalidDateOutput = path.join(tempRoot, "clean-invalid-date.json");
  const cleanDuplicateFieldOutput = path.join(tempRoot, "clean-duplicate-field.json");
  fs.writeFileSync(cleanFixture, buildCleanMachineFixture(matrix), "utf8");

  const cleanPassed = run("scripts/clean-machine-report.js", {
    OPENMIND_CLEAN_MACHINE_EVIDENCE_FILE: cleanFixture,
    OPENMIND_CLEAN_MACHINE_MATRIX_FILE: matrixPath,
    OPENMIND_CLEAN_MACHINE_OUTPUT: cleanPassedOutput,
    OPENMIND_CLEAN_MACHINE_STRICT: "1"
  });
  assertSuccess(cleanPassed, "complete Clean-machine fixture");
  const cleanPassedReport = assertJson(cleanPassedOutput);
  if (cleanPassedReport.status !== "complete" || cleanPassedReport.passedCount !== matrix.length) {
    fail("complete Clean-machine fixture did not pass every scenario");
  }

  fs.writeFileSync(cleanFixture, buildCleanMachineFixture(matrix, { invalidArchitecture: true }), "utf8");
  const cleanRejected = run("scripts/clean-machine-report.js", {
    OPENMIND_CLEAN_MACHINE_EVIDENCE_FILE: cleanFixture,
    OPENMIND_CLEAN_MACHINE_MATRIX_FILE: matrixPath,
    OPENMIND_CLEAN_MACHINE_OUTPUT: cleanRejectedOutput,
    OPENMIND_CLEAN_MACHINE_STRICT: "1"
  });
  if (cleanRejected.status === 0) fail("wrong clean-machine architecture was accepted");
  const rejectedCleanReport = assertJson(cleanRejectedOutput);
  if (!rejectedCleanReport.scenarios.some((scenario) => scenario.missingEvidenceFields.includes("os(platform)"))) {
    fail("Clean-machine report did not identify the architecture mismatch");
  }

  fs.writeFileSync(cleanFixture, buildCleanMachineFixture(matrix, { invalidPackageArchitecture: true }), "utf8");
  const cleanInvalidPackage = run("scripts/clean-machine-report.js", {
    OPENMIND_CLEAN_MACHINE_EVIDENCE_FILE: cleanFixture,
    OPENMIND_CLEAN_MACHINE_MATRIX_FILE: matrixPath,
    OPENMIND_CLEAN_MACHINE_OUTPUT: cleanInvalidPackageOutput,
    OPENMIND_CLEAN_MACHINE_STRICT: "1"
  });
  if (cleanInvalidPackage.status === 0) fail("wrong clean-machine package architecture was accepted");
  if (!assertJson(cleanInvalidPackageOutput).scenarios.some((scenario) => scenario.missingEvidenceFields.includes("package(target artifact)"))) {
    fail("Clean-machine report did not identify the package architecture mismatch");
  }

  fs.writeFileSync(cleanFixture, buildCleanMachineFixture(matrix, { invalidDate: true }), "utf8");
  const cleanInvalidDate = run("scripts/clean-machine-report.js", {
    OPENMIND_CLEAN_MACHINE_EVIDENCE_FILE: cleanFixture,
    OPENMIND_CLEAN_MACHINE_MATRIX_FILE: matrixPath,
    OPENMIND_CLEAN_MACHINE_OUTPUT: cleanInvalidDateOutput,
    OPENMIND_CLEAN_MACHINE_STRICT: "1"
  });
  if (cleanInvalidDate.status === 0) fail("impossible clean-machine date was accepted");
  if (!assertJson(cleanInvalidDateOutput).scenarios.some((scenario) => scenario.missingEvidenceFields.includes("date(YYYY-MM-DD)"))) {
    fail("Clean-machine report did not reject an impossible date");
  }

  fs.writeFileSync(cleanFixture, buildCleanMachineFixture(matrix, { duplicateField: true }), "utf8");
  const cleanDuplicateField = run("scripts/clean-machine-report.js", {
    OPENMIND_CLEAN_MACHINE_EVIDENCE_FILE: cleanFixture,
    OPENMIND_CLEAN_MACHINE_MATRIX_FILE: matrixPath,
    OPENMIND_CLEAN_MACHINE_OUTPUT: cleanDuplicateFieldOutput,
    OPENMIND_CLEAN_MACHINE_STRICT: "1"
  });
  if (cleanDuplicateField.status === 0) fail("duplicate Clean-machine evidence fields were accepted");
  if (!assertJson(cleanDuplicateFieldOutput).scenarios.some((scenario) => scenario.missingEvidenceFields.includes("duplicate(date)"))) {
    fail("Clean-machine report did not identify duplicate evidence fields");
  }

  fs.writeFileSync(cleanFixture, buildCleanMachineFixture(matrix, { invalidEvidenceReference: true }), "utf8");
  const cleanInvalidPath = run("scripts/clean-machine-report.js", {
    OPENMIND_CLEAN_MACHINE_EVIDENCE_FILE: cleanFixture,
    OPENMIND_CLEAN_MACHINE_MATRIX_FILE: matrixPath,
    OPENMIND_CLEAN_MACHINE_OUTPUT: cleanInvalidPathOutput,
    OPENMIND_CLEAN_MACHINE_STRICT: "1"
  });
  if (cleanInvalidPath.status === 0) fail("nonexistent local Clean-machine evidence path was accepted");
  const invalidPathCleanReport = assertJson(cleanInvalidPathOutput);
  if (!invalidPathCleanReport.scenarios.some((scenario) => scenario.missingEvidenceFields.includes("evidence(concrete path or URL)"))) {
    fail("Clean-machine report did not reject a nonexistent local evidence path");
  }

  console.log("Evidence gate contract passed: Security Review external-audit and Clean-machine architecture checks are fail-closed.");
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}

function buildSecurityFixture(options = {}) {
  const reviewerNotes = {
    "SEC-001": `evidence=https://evidence.example.test/security/sec-001-review-20260807.json; deployment-audit=${options.invalidExternalAudit ? "pending" : "https://evidence.example.test/deployment/crash-policy-20260807.json"}`,
    "SEC-002": `evidence=${options.invalidLocalEvidence ? "artifacts/security/missing-sec-002-review-20260807.json" : "https://evidence.example.test/security/sec-002-review-20260807.json"}`,
    "SEC-003": "evidence=https://evidence.example.test/security/sec-003-review-20260807.json",
    "SEC-004": "evidence=https://evidence.example.test/security/sec-004-review-20260807.json; packaged-evidence=https://evidence.example.test/package/win-mac-acceptance-20260807.zip",
    "SEC-005": `evidence=https://evidence.example.test/security/sec-005-review-20260807.json; diagnostic-audit=${options.invalidExternalAudit ? "pending" : "https://evidence.example.test/deployment/diagnostic-policy-20260807.json"}`
  };
  const source = fs.readFileSync(path.join(appRoot, "docs", "SECURITY_REVIEW.md"), "utf8")
    .replace(/<!--\s*openmind-security-review-status:[^>]*-->/i, "<!-- openmind-security-review-status: complete -->")
    .replace(/<!--\s*openmind-security-reviewer:[^>]*-->/i, "<!-- openmind-security-reviewer: External Review Fixture -->")
    .replace(/<!--\s*openmind-security-reviewed-at:[^>]*-->/i, `<!-- openmind-security-reviewed-at: ${options.invalidReviewDate ? "2026-02-30" : today} -->`)
    .replace(/<!--\s*openmind-security-review-independence:[^>]*-->/i, `<!-- openmind-security-review-independence: ${options.invalidIndependence ? "true" : "external"} -->`);
  return source.split(/\r?\n/).map((line) => {
    const match = line.match(/^\|\s*(SEC-\d+)\s*\|/i);
    if (!match || !reviewerNotes[match[1]]) return line;
    const cells = line.split("|").slice(1, -1).map((cell) => cell.trim());
    cells[3] = "closed";
    cells[4] = reviewerNotes[match[1]];
    return `| ${cells.join(" | ")} |`;
  }).join("\n");
}

function buildCleanMachineFixture(matrix, options = {}) {
  const rows = matrix.map((scenario) => {
    const isWindows = scenario.platform.startsWith("windows");
    const isAppleSilicon = scenario.platform.startsWith("macos-applesilicon");
    const osValue = isWindows
      ? (options.invalidArchitecture ? "Windows 11 24H2 arm64" : "Windows 11 24H2 x64")
      : isAppleSilicon ? "macOS 15 Apple Silicon arm64" : "macOS 15 Intel x64";
    const packageName = isWindows
      ? `OpenMind-Portable-1.0.24-win-${options.invalidPackageArchitecture ? "arm64" : "x64"}.exe`
      : "OpenMind-1.0.24-arm64-mac.zip";
    const date = options.invalidDate ? "2026-02-30" : today;
    const preconditions = scenario.environment === "no-python-uv-node-git-ffmpeg"
      ? "no-python-uv-node-git-ffmpeg,online"
      : scenario.environment;
    const evidenceReference = options.invalidEvidenceReference && scenario.id === matrix[0].id
      ? "artifacts/clean-machine/missing-evidence.zip"
      : `https://evidence.example.test/clean-machine/${scenario.id}/evidence.zip`;
    const duplicateField = options.duplicateField ? `; date=${date}` : "";
    return `| ${scenario.id} | passed | date=${date}; os=${osValue}; build=1.0.24+evidence-contract; package=${packageName}; sha256=${sha256}; preconditions=${preconditions}; outcome=passed; evidence=${evidenceReference}${duplicateField} |`;
  });
  return [
    "# Evidence gate fixture",
    "",
    "<!-- openmind-clean-machine-status: complete -->",
    "",
    "| Scenario ID | Status | Package / OS / evidence |",
    "| --- | --- | --- |",
    ...rows,
    ""
  ].join("\n");
}

function run(script, extraEnvironment) {
  return spawnSync(process.execPath, [path.join(appRoot, script)], {
    cwd: appRoot,
    env: { ...process.env, ...extraEnvironment },
    encoding: "utf8",
    maxBuffer: 4 * 1024 * 1024
  });
}

function assertSuccess(result, label) {
  if (result.error || result.status !== 0) {
    fail(`${label} failed: ${result.error?.message || result.stderr || result.stdout || `exit ${result.status}`}`);
  }
}

function assertJson(filePath) {
  try { return JSON.parse(fs.readFileSync(filePath, "utf8")); }
  catch (error) { fail(`invalid evidence report ${filePath}: ${error.message}`); }
}

function fail(message) {
  throw new Error(message);
}
