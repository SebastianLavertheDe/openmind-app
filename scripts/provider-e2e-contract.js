#!/usr/bin/env node
"use strict";

/**
 * Black-box contract checks for the Provider E2E evidence gate. The fixture is
 * temporary and never changes the pending checklist in docs/.
 */

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const appRoot = path.resolve(__dirname, "..");
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "cctools-provider-e2e-"));
const today = new Date().toISOString().slice(0, 10);

try {
  const checklistPath = path.join(tempRoot, "PROVIDER_E2E_CHECKLIST.md");
  const passedOutput = path.join(tempRoot, "provider-passed.json");
  const rejectedOutput = path.join(tempRoot, "provider-rejected.json");
  const invalidDateOutput = path.join(tempRoot, "provider-invalid-date.json");
  const duplicateFieldOutput = path.join(tempRoot, "provider-duplicate-field.json");
  const source = fs.readFileSync(path.join(appRoot, "docs", "PROVIDER_E2E_CHECKLIST.md"), "utf8");
  const passedFixture = buildFixture(source);
  fs.writeFileSync(checklistPath, passedFixture, "utf8");

  const passed = run(checklistPath, passedOutput, true);
  assertSuccess(passed, "complete Provider E2E fixture");
  const passedReport = readJson(passedOutput);
  if (passedReport.status !== "complete" || passedReport.incompleteCount !== 0) {
    fail("complete Provider E2E fixture did not pass strict validation");
  }

  fs.writeFileSync(checklistPath, replaceFirstTableEvidence(passedFixture), "utf8");
  const rejected = run(checklistPath, rejectedOutput, true);
  if (rejected.status === 0) fail("placeholder Provider E2E evidence was accepted");
  const rejectedReport = readJson(rejectedOutput);
  if (!rejectedReport.invalidEvidenceRows.length) fail("Provider E2E did not report incomplete evidence fields");

  fs.writeFileSync(checklistPath, replaceFirstTableField(passedFixture, /date=20\d{2}-\d{2}-\d{2}/i, "date=2026-02-30"), "utf8");
  const invalidDate = run(checklistPath, invalidDateOutput, true);
  if (invalidDate.status === 0) fail("impossible Provider E2E evidence date was accepted");
  if (!readJson(invalidDateOutput).invalidEvidenceRows.length) fail("Provider E2E did not reject an impossible date");

  fs.writeFileSync(checklistPath, replaceFirstTableField(passedFixture, /evidence=https:\/\/evidence\.example\.test\/provider\/[^;|]+/i, `evidence=duplicate-reference; date=${today}`), "utf8");
  const duplicateField = run(checklistPath, duplicateFieldOutput, true);
  if (duplicateField.status === 0) fail("duplicate Provider E2E evidence fields were accepted");
  if (!readJson(duplicateFieldOutput).invalidEvidenceRows.length) fail("Provider E2E did not report duplicate evidence fields");

  console.log("Provider E2E contract passed: real dates, package/project/evidence fields and unique keys are required; placeholders fail closed.");
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}

function buildFixture(source) {
  return source.split(/\r?\n/).map((line) => {
    if (!/^\|/.test(line)) return line;
    const columns = line.split("|").slice(1, -1).map((column) => column.trim());
    if (columns.length !== 4 || columns[0].toLowerCase() === "case" || columns.every((column) => /^:?-{3,}:?$/.test(column))) return line;
    const slug = columns[0].toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    columns[1] = "passed";
    columns[2] = "passed";
    columns[3] = `date=${today}; package=CC-Tools-Portable-1.0.24-win-x64.exe; project=C:\\Users\\qa\\cctools-provider-fixture; evidence=https://evidence.example.test/provider/${slug}.zip`;
    return `| ${columns.join(" | ")} |`;
  }).join("\n");
}

function replaceFirstTableEvidence(source) {
  return replaceFirstTableField(source, /evidence=https:\/\/evidence\.example\.test\/provider\/[^;|]+/i, "evidence=done");
}

function replaceFirstTableField(source, pattern, replacement) {
  let replaced = false;
  return source.split(/\r?\n/).map((line) => {
    if (replaced || !/^\|/.test(line) || !/\|\s*passed\s*\|\s*passed\s*\|/.test(line)) return line;
    const next = line.replace(pattern, replacement);
    if (next !== line) replaced = true;
    return next;
  }).join("\n");
}

function run(checklistPath, outputPath, strict) {
  return spawnSync(process.execPath, [path.join(appRoot, "scripts", "provider-e2e-report.js")], {
    cwd: appRoot,
    env: {
      ...process.env,
      CCTOOLS_PROVIDER_E2E_CHECKLIST_FILE: checklistPath,
      CCTOOLS_PROVIDER_E2E_OUTPUT: outputPath,
      CCTOOLS_PROVIDER_E2E_STRICT: strict ? "1" : "0"
    },
    encoding: "utf8",
    maxBuffer: 4 * 1024 * 1024
  });
}

function assertSuccess(result, label) {
  if (result.error || result.status !== 0) fail(`${label} failed: ${result.error?.message || result.stderr || result.stdout || `exit ${result.status}`}`);
}

function readJson(filePath) {
  try { return JSON.parse(fs.readFileSync(filePath, "utf8")); }
  catch (error) { fail(`invalid Provider E2E report ${filePath}: ${error.message}`); }
}

function fail(message) {
  throw new Error(message);
}
