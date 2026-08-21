#!/usr/bin/env node
/**
 * audit-no-reporoot.js — ADR-001 §16.7 lint gate.
 *
 * Fails the build if new code introduces forbidden `repoRoot` path-joining
 * patterns. The refactor splits the overloaded `repoRoot` into disjoint
 * `openmindRoot` / `workspaceRoot` / userData-derived roots; new code must not
 * re-introduce the conflation.
 *
 * ALLOWED (back-compat shims that must keep working until removed):
 *   - electron/lib/settings.ts        — owns the legacy repoRoot API
 *   - electron/paths/*                — the new path layer (references are docs)
 *   - *.test.ts / *.test.tsx          — tests may exercise legacy behaviour
 *   - docs/**                         — documentation
 *   - shared/skill-compatibility-matrix.ts / malicious-skill-fixtures.ts
 *                                     — record audited legacy facts
 *
 * FORBIDDEN elsewhere (electron/, shared/, renderer/src/):
 *   - path.join(repoRoot, "openmind", ...)   → use OpenmindPathResolver / openmindRoot
 *   - path.join(repoRoot, ".claude", ...)  → installed skills live under the bound openmindRoot/.agent now
 *   - path.join(findRepoRoot(), "openmind")  → use resolveOpenmindRoot()
 *   - new hardcoded WSL/Windows dev paths  (\\\\wsl.localhost\\..., D:\\work\\...)
 *
 * The script is deliberately conservative: it greps for suspicious patterns
 * and reports each match with file:line. False positives are resolved by
 * adding the file to ALLOWED or refactoring.
 */

const fs = require("fs");
const path = require("path");

const appRoot = path.resolve(__dirname, "..");
const violations = [];

const ALLOWED_SUBSTRINGS = [
  "/lib/settings.ts",
  "/lib/settings.test.ts",
  "electron/paths/",
  ".test.ts",
  ".test.tsx",
  "docs/",
  "skill-compatibility-matrix.ts",
  "malicious-skill-fixtures.ts",
  "audit-no-reporoot.js"
];

// Patterns that indicate a forbidden repoRoot path join.
const FORBIDDEN_PATTERNS = [
  // joining openmind/.claude onto a repoRoot-derived variable
  /path\.join\([^)]*\brepoRoot\b[^)]*,\s*["']openmind["']/,
  /path\.join\([^)]*\brepoRoot\b[^)]*,\s*["']\.claude["']/,
  /path\.join\([^)]*findRepoRoot\(\)[^)]*,\s*["']openmind["']/,
  // hardcoded dev-machine WSL / Windows paths (ADR-001 §16.1 removed these)
  /\\\\wsl\.localhost\\[^\\]+\\home\\[^\\]+\\/i,
  /\\\\wsl\$\\[^\\]+\\home\\[^\\]+\\/i,
  /D:\\work\\openmind/i
];

function isAllowed(filePath) {
  const rel = path.relative(appRoot, filePath).replaceAll("\\", "/");
  return ALLOWED_SUBSTRINGS.some((s) => rel.includes(s));
}

function walk(dir, out) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
  catch { return; }
  for (const e of entries) {
    if (e.name === "node_modules" || e.name === ".build" || e.name === "dist" || e.name === ".git") continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, out);
    else if (/\.(ts|tsx|js)$/.test(e.name)) out.push(full);
  }
}

const files = [];
walk(path.join(appRoot, "electron"), files);
walk(path.join(appRoot, "shared"), files);
walk(path.join(appRoot, "renderer", "src"), files);

for (const file of files) {
  if (isAllowed(file)) continue;
  const src = fs.readFileSync(file, "utf8").split(/\r?\n/);
  for (let i = 0; i < src.length; i++) {
    const line = src[i];
    const prevLine = i > 0 ? src[i - 1] : "";
    // Allow explicitly-tagged legacy back-compat branches (tag may be on the
    // matched line or the immediately preceding line).
    const tagged = line.includes("audit-no-reporoot: legacy back-compat") ||
                   prevLine.includes("audit-no-reporoot: legacy back-compat");
    if (tagged) continue;
    for (const re of FORBIDDEN_PATTERNS) {
      if (re.test(line)) {
        violations.push({
          file: path.relative(appRoot, file).replaceAll("\\", "/"),
          line: i + 1,
          text: line.trim()
        });
      }
    }
  }
}

if (violations.length > 0) {
  console.error(`\n❌ audit-no-reporoot: ${violations.length} violation(s) of ADR-001 path boundaries:\n`);
  for (const v of violations) {
    console.error(`  ${v.file}:${v.line}`);
    console.error(`    ${v.text}\n`);
  }
  console.error("New code must not join paths onto repoRoot. Use OpenmindPathResolver");
  console.error("(electron/paths/openmind-path-resolver.ts) or resolveOpenmindRoot()");
  console.error("(electron/lib/settings.ts) instead. See ADR-001 §16.7.\n");
  process.exit(1);
}

console.log(`✓ audit-no-reporoot: no forbidden repoRoot path-joins (scanned ${files.length} files)`);
