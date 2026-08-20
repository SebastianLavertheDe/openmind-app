#!/usr/bin/env node
"use strict";

/**
 * Aggregate the local and external release gates without claiming GA. The
 * report is deliberately fail-closed: a missing or incomplete source report
 * remains manual-required, even when the local build itself is green.
 */

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const appRoot = path.resolve(__dirname, "..");
const buildRoot = path.resolve(process.env.OPENMIND_RELEASE_READINESS_BUILD_ROOT || path.join(appRoot, ".build"));
const reportOutput = path.resolve(process.env.OPENMIND_RELEASE_READINESS_OUTPUT || path.join(buildRoot, "release-readiness-report.json"));
const strict = process.env.OPENMIND_RELEASE_READINESS_STRICT === "1";

const auditEvidence = readJson("audit-evidence.json");
const releaseIndex = readJson(path.join("release-evidence", "index.json"));
const releaseSbom = readJson(path.join("release-evidence", "sbom.cdx.json"));
const licenses = readJson(path.join("release-evidence", "licenses.json"));
const provenance = readJson(path.join("release-evidence", "provenance.json"));
const visualSnapshot = readJson("visual-snapshot-report.json");
const windowsArtifactSafety = readFirstJson(["package-artifact-safety-win.json", "package-artifact-safety-win-local.json", "package-artifact-safety-report.json"]);
const macosArtifactSafety = readFirstJson(["package-artifact-safety-mac.json", "package-artifact-safety-mac-local.json", "package-artifact-safety-report.json"]);
// Local diagnostic evidence lives under .build/, while a target-host staged
// package script writes its final evidence under the checkout's dist/. Support
// both layouts; without the parent candidate the normal .build -> ../dist path
// is silently treated as missing.
const windowsArtifactEvidence = readFirstJson([
  "package-evidence-win-local.json",
  path.join("dist", "package-evidence-windows.json"),
  path.join("..", "dist", "package-evidence-windows.json")
]);
const macosArtifactEvidence = readFirstJson([
  "package-evidence-mac-local.json",
  path.join("dist", "package-evidence-macos.json"),
  path.join("..", "dist", "package-evidence-macos.json")
]);
const providerE2e = readJson("provider-e2e-report.json");
const securityReview = readJson("security-review-report.json");
const cleanMachine = readJson("clean-machine-report.json");
const releaseEvidenceReady = Boolean(
  releaseIndex?.kind === "openmind-release-evidence-index"
  && Array.isArray(releaseIndex.artifacts)
  && releaseIndex.artifacts.length >= 3
  && ["sbom.cdx.json", "licenses.json", "provenance.json"].every((name) => {
    const artifact = releaseIndex.artifacts.find((entry) => entry?.path === `release-evidence/${name}`);
    return Boolean(artifact && Number(artifact.bytes) > 0 && /^[a-f0-9]{64}$/.test(String(artifact.sha256 || "")));
  })
  && releaseEvidenceArtifactsMatchIndex(releaseIndex)
  && releaseIndex.sbom?.format === "CycloneDX"
  && releaseIndex.sbom?.path === "release-evidence/sbom.cdx.json"
  && Number(releaseIndex.sbom.componentCount) > 0
  && releaseSbom?.bomFormat === "CycloneDX"
  && Array.isArray(releaseSbom.components)
  && releaseSbom.components.length === Number(releaseIndex.sbom.componentCount)
  && licenses?.kind === "openmind-license-report"
  && Number(licenses.componentCount) === releaseSbom.components.length
  && Number(releaseIndex.licenses?.componentCount) === Number(licenses.componentCount)
  && Number(licenses.unknownLicenseCount) === 0
  && Number(releaseIndex.licenses?.unknownLicenseCount) === 0
  && provenance?.kind === "openmind-build-provenance"
  && releaseIndex.provenance?.path === "release-evidence/provenance.json"
  && /^[a-f0-9]{64}$/.test(String(provenance.artifact?.treeSha256 || ""))
  && releaseIndex.provenance?.treeSha256 === provenance.artifact.treeSha256
);
const providerE2eReady = Boolean(
  providerE2e?.status === "complete"
  && Number(providerE2e.rowCount) > 0
  && Number(providerE2e.cellCount) === Number(providerE2e.rowCount) * 2
  && Number(providerE2e.pendingCount) === 0
  && Number(providerE2e.incompleteCount) === 0
  && !(providerE2e.invalidRows || []).length
  && !(providerE2e.duplicateCases || []).length
  && !(providerE2e.invalidEvidenceRows || []).length
);
const securityReviewReady = Boolean(
  securityReview?.status === "complete"
  && securityReview.declaredStatus === "complete"
  && securityReview.reviewerComplete === true
  && Number(securityReview.findingCount) === 5
  && !(securityReview.openP0P1 || []).length
  && !(securityReview.missingRequiredFindings || []).length
  && !(securityReview.duplicateFindingIds || []).length
  && !(securityReview.unexpectedFindingIds || []).length
  && !(securityReview.missingRequiredExternalEvidence || []).length
  && !(securityReview.invalidRequiredPriorities || []).length
);
const cleanMachineReady = Boolean(
  cleanMachine?.status === "complete"
  && cleanMachine.declaredStatus === "complete"
  && Number(cleanMachine.matrixScenarioCount) > 0
  && Number(cleanMachine.passedCount) === Number(cleanMachine.matrixScenarioCount)
  && Number(cleanMachine.pendingCount) === 0
  && Number(cleanMachine.blockedCount) === 0
  && Array.isArray(cleanMachine.scenarios)
  && cleanMachine.scenarios.length === Number(cleanMachine.matrixScenarioCount)
  && cleanMachine.scenarios.every((scenario) => (
    scenario.status === "passed"
    && scenario.hasConcreteEvidence === true
    && !(scenario.missingEvidenceFields || []).length
  ))
);
const checks = [
  evaluate("audit-evidence", auditEvidence, Boolean(auditEvidence && Array.isArray(auditEvidence.checks) && auditEvidence.checks.length === 26 && Array.isArray(auditEvidence.failed) && auditEvidence.failed.length === 0), "All 26 architecture/security evidence checks must exist with no failures."),
  evaluate("release-evidence", releaseIndex && releaseSbom && licenses && provenance, releaseEvidenceReady, "The release index, CycloneDX SBOM, license report and provenance must agree on component counts, artifact hashes and the build tree digest; unknown licenses must be zero."),
  evaluate("built-recovery", readJson("recovery-drill-report.json"), statusIs("recovery-drill-report.json", "passed"), "Compiled relocation/Run/Runtime recovery drill must pass."),
  evaluate("process-crash-recovery", readJson("process-crash-recovery-report.json"), statusIs("process-crash-recovery-report.json", "passed"), "Compiled child forced-termination and RunStore restart recovery drill must pass."),
  evaluate("stability-soak", readJson("stability-soak-report.json"), statusIs("stability-soak-report.json", "passed"), "Local stability soak must pass."),
  evaluate("visual-snapshot", visualSnapshot, Boolean(
    visualSnapshot
    && Array.isArray(visualSnapshot.failures)
    && visualSnapshot.failures.length === 0
    && ((Array.isArray(visualSnapshot.snapshots) && visualSnapshot.snapshots.length > 0)
      || (Array.isArray(visualSnapshot.stateSnapshots) && visualSnapshot.stateSnapshots.length > 0))
  ), "Visual snapshot report must contain screenshots and no failures."),
  evaluate("package-safety", readJson("package-safety-report.json"), statusIs("package-safety-report.json", "passed"), "Built/package safety scan must pass."),
  evaluate("windows-artifact-safety", windowsArtifactSafety, Boolean(
    windowsArtifactSafety
    && windowsArtifactSafety.platform === "win"
    && windowsArtifactSafety.status === "passed"
    && !(windowsArtifactSafety.failedArtifacts || []).length
    && !(windowsArtifactSafety.missingKinds || []).length
  ), "All Windows distributable containers must be recursively scanned."),
  evaluate("macos-artifact-safety", macosArtifactSafety, Boolean(
    macosArtifactSafety
    && macosArtifactSafety.platform === "mac"
    && macosArtifactSafety.status === "passed"
    && !(macosArtifactSafety.failedArtifacts || []).length
    && !(macosArtifactSafety.missingKinds || []).length
  ), "All macOS distributable containers, including DMG, must be recursively scanned."),
  evaluate("windows-artifact-evidence", windowsArtifactEvidence, Boolean(
    windowsArtifactEvidence
    && windowsArtifactEvidence.platform === "win"
    && windowsArtifactEvidence.targetValidation === "passed"
    && windowsArtifactEvidence.artifactSafety?.validated === true
  ), "Windows package hashes and artifact safety must be bound to one evidence record."),
  evaluate("macos-artifact-evidence", macosArtifactEvidence, Boolean(
    macosArtifactEvidence
    && macosArtifactEvidence.platform === "mac"
    && macosArtifactEvidence.targetValidation === "passed"
    && macosArtifactEvidence.artifactSafety?.validated === true
  ), "macOS package hashes and artifact safety must be bound to one complete evidence record."),
  evaluate("packaged-recovery", { windowsArtifactEvidence, macosArtifactEvidence }, Boolean(
    windowsArtifactEvidence
    && macosArtifactEvidence
    && windowsArtifactEvidence.targetValidation === "passed"
    && macosArtifactEvidence.targetValidation === "passed"
    && windowsArtifactEvidence.packagedSmoke === "passed"
    && windowsArtifactEvidence.recoveryDrill === "passed"
    && windowsArtifactEvidence.packagedRecovery === "passed"
    && windowsArtifactEvidence.packagedRecoveryEvidence?.validated === true
    && macosArtifactEvidence.packagedSmoke === "passed"
    && macosArtifactEvidence.recoveryDrill === "passed"
    && macosArtifactEvidence.packagedRecovery === "passed"
    && macosArtifactEvidence.packagedRecoveryEvidence?.validated === true
  ), "Windows/macOS packaged smoke, force-quit and recovery evidence must be recorded in both package evidence files."),
  evaluate("provider-e2e", providerE2e, providerE2eReady, "All Provider E2E cells must pass with concrete evidence and internally consistent counts."),
  evaluate("security-review", securityReview, securityReviewReady, "Independent Security Review must close all five required P1 findings with a complete independent-review record."),
  evaluate("clean-machine", cleanMachine, cleanMachineReady, "All Windows/macOS Clean-machine scenarios must pass with concrete evidence and internally consistent counts.")
];

const failedChecks = checks.filter((check) => !check.passed);
const report = {
  schemaVersion: 1,
  kind: "openmind-release-readiness",
  generatedAt: new Date().toISOString(),
  strict,
  status: failedChecks.length ? "manual-required" : "ready",
  gaClaim: "not-established",
  scope: {
    signedRelease: "out-of-scope",
    formalLinux: "out-of-scope",
    signedCatalog: "out-of-scope",
    note: "Ready means every in-scope local and external gate has evidence; it does not authorize a signed release, formal Linux support, Signed Catalog or a claim beyond the configured host-direct scope."
  },
  checks,
  failedChecks: failedChecks.map((check) => check.id)
};

fs.mkdirSync(path.dirname(reportOutput), { recursive: true });
fs.writeFileSync(reportOutput, `${JSON.stringify(report, null, 2)}\n`, "utf8");

if (strict && failedChecks.length) {
  throw new Error(`Release readiness is not complete: ${failedChecks.map((check) => `${check.id} (${check.reason})`).join("; ")}`);
}

console.log(`Release readiness report written: ${report.status}${failedChecks.length ? ` (${failedChecks.length} gate(s) pending)` : ""}.`);

function readJson(relativePath) {
  try { return JSON.parse(fs.readFileSync(path.join(buildRoot, relativePath), "utf8")); }
  catch { return null; }
}

function readFirstJson(relativePaths) {
  for (const relativePath of relativePaths) {
    const value = readJson(relativePath);
    if (value !== null) return value;
  }
  return null;
}

function statusIs(relativePath, expected) {
  const value = readJson(relativePath);
  return Boolean(value && value.status === expected);
}

function evaluate(id, value, passed, reason) {
  return { id, passed, sourcePresent: value !== null, reason };
}

function releaseEvidenceArtifactsMatchIndex(index) {
  return ["sbom.cdx.json", "licenses.json", "provenance.json"].every((name) => {
    const expected = index.artifacts.find((entry) => entry?.path === `release-evidence/${name}`);
    const filePath = path.join(buildRoot, "release-evidence", name);
    try {
      const bytes = fs.statSync(filePath).size;
      const sha256 = crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
      return bytes === Number(expected.bytes) && sha256 === expected.sha256;
    } catch {
      return false;
    }
  });
}
