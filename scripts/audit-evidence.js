const fs = require("fs");
const path = require("path");

const appRoot = path.resolve(__dirname, "..");
const buildRoot = path.join(appRoot, ".build");
const checks = [];

check("app-owned design evidence is present", countFiles(path.join(appRoot, "design-qa")) >= 40, {
  count: countFiles(path.join(appRoot, "design-qa"))
});

check("renderer routes are lazy loaded", includes("renderer/src/app/route-registry.tsx", "const SourcesPage = lazy(") && includes("renderer/src/app/route-registry.tsx", "const AiWorkbench = lazy("));
check("renderer chunks are manually split", includes("vite.config.ts", "manualChunks(id)") && includes("vite.config.ts", "vendor-markdown"));
check("large collections remain virtualized or paginated", includes("renderer/src/features/ai-console/AiWorkbench.tsx", "<VirtualList") && includes("electron/product/content-index.ts", "query.cursor + query.limit"));
check("chat markdown cache is bounded and hash keyed", includes("renderer/src/features/ai-console/message.tsx", "MARKDOWN_CACHE_LIMIT") && includes("renderer/src/features/ai-console/message.tsx", "markdownCacheKey"));
check("focus and reduced motion styles are present", anyIncludes(["renderer/src/styles.css", "renderer/src/styles/base.css", "renderer/src/styles/tokens.css"], ":focus-visible") && anyIncludes(["renderer/src/styles.css", "renderer/src/styles/base.css"], "prefers-reduced-motion"));

check("browser preview is explicitly marked", matches("renderer/src/browser-api.ts", /environment\s*:\s*\{[^}]*\bmode\s*:\s*[\"']preview[\"']/) && includes("renderer/src/app/AppShell.tsx", 'environment.mode === "preview"'));
check("Electron preload failure cannot silently use preview data", includes("renderer/src/App.tsx", "m.app.preloadMissing") && includes("renderer/src/browser-api.ts", "isElectronRenderer()"));
check("cross-module feedback has recovery guidance and local log", includes("renderer/src/ai-context.tsx", "FEEDBACK_LOG_KEY") && includes("renderer/src/ai-context.tsx", "recoveryHint") && includes("renderer/src/components/FeedbackHost.tsx", "toast.recovery"));
check("visual snapshot matrix is wired into release verification", exists("scripts/visual-snapshot.js") && exists("scripts/visual-snapshot-electron.js") && includes("package.json", "visual:snapshot") && includes("docs/VISUAL_AUDIT_CHECKLIST.md", ".build/visual-snapshot-report.json"));

const releaseEvidence = readJsonIfExists(path.join(buildRoot, "release-evidence", "index.json"));
const releaseSbom = readJsonIfExists(path.join(buildRoot, "release-evidence", "sbom.cdx.json"));
const releaseLicenses = readJsonIfExists(path.join(buildRoot, "release-evidence", "licenses.json"));
const releaseProvenance = readJsonIfExists(path.join(buildRoot, "release-evidence", "provenance.json"));
check("SBOM, license and provenance evidence is generated", Boolean(
  releaseEvidence?.kind === "openmind-release-evidence-index"
  && releaseSbom?.bomFormat === "CycloneDX"
  && Number(releaseSbom?.components?.length) > 0
  && releaseLicenses?.kind === "openmind-license-report"
  && Number(releaseLicenses?.componentCount) === Number(releaseSbom?.components?.length)
  && Number(releaseLicenses?.unknownLicenseCount) === 0
  && releaseProvenance?.kind === "openmind-build-provenance"
  && /^[a-f0-9]{64}$/.test(String(releaseProvenance?.artifact?.treeSha256 || ""))
), {
  sbomComponents: releaseSbom?.components?.length || 0,
  unknownLicenses: releaseLicenses?.unknownLicenseCount ?? null,
  artifactTreeSha256: releaseProvenance?.artifact?.treeSha256 || null
});

checkLineBudget("CreativePage is below the complex-page budget", "renderer/src/features/creative/CreativePage.tsx", 500);
check("CreativePage has independent panels and history/release modules", exists("renderer/src/features/creative/panels.tsx") && exists("renderer/src/features/creative/history-release.tsx"));
checkLineBudget("SourcesPage is below the complex-page budget", "renderer/src/features/sources/SourcesPage.tsx", 600);
check("source discovery and persistence stay outside the page", exists("electron/product/source-registry.ts") && exists("electron/ai/skill-discovery.ts") && exists("shared/skill-frontmatter.ts"));
checkLineBudget("ProductService remains a bounded domain facade", "electron/product/product-service.ts", 420);
check("Product domain is split into content state/index/source/brief/dashboard", [
  "electron/product/content-state.ts",
  "electron/product/content-index.ts",
  "electron/product/source-registry.ts",
  "electron/product/brief-service.ts",
  "electron/product/dashboard-service.ts"
].every(exists));
checkLineBudget("RunScheduler is below the scheduler budget", "electron/ai/scheduler.ts", 460);
check("RunScheduler delegates paths, skills and change application", [
  "electron/ai/scheduler-paths.ts",
  "electron/ai/manual-skill-controller.ts",
  "electron/ai/change-application.ts",
  "electron/ai/change-patches.ts",
  "electron/ai/scheduler-lifecycle.ts",
  "electron/ai/scheduler-prompts.ts",
  "electron/ai/scheduler-images.ts"
].every(exists));
check("legacy isolated worktree creation is absent", !includes("electron/ai/workspace-manager.ts", "git worktree add") && !includes("electron/ai/scheduler.ts", ".create(run)"));

check("project file selection/export paths are boundary checked", includes("electron/ipc-handlers.ts", "channel: C.selectFiles") && includes("electron/ipc-handlers.ts", "channel: C.exportText") && occurrences("electron/ipc-handlers.ts", "ensureInsideRepo") >= 4);
check("AI cwd and context paths are normalized inside project", includes("electron/ai/scheduler-paths.ts", "assertInsideProject") && includes("electron/ai/scheduler.ts", "normalizeContextReferences"));
check("dangerous approvals are not remembered for whole session", includes("electron/ai/approval-broker.ts", "canRememberForSession") && includes("electron/ai/approval-broker.ts", "outside-workspace"));
check("approval decisions are written to security report", includes("electron/ai/security-report.ts", "buildApprovalAudit") && includes("electron/ai/security-report.ts", "dangerousCategories"));

const crashSensitiveSourceFiles = [
  ...collectSourceFiles(path.join(appRoot, "electron")),
  ...collectSourceFiles(path.join(appRoot, "shared")),
  ...collectSourceFiles(path.join(appRoot, "renderer")),
  ...collectSourceFiles(path.join(buildRoot, "electron")),
  ...collectSourceFiles(path.join(buildRoot, "renderer"))
];
const crashSensitiveSources = crashSensitiveSourceFiles.map((filePath) => {
  try { return fs.readFileSync(filePath, "utf8"); } catch { return ""; }
}).join("\n");
const prohibitedCrashDumpPatterns = [
  { id: "electron-crash-reporter", pattern: /\bcrashReporter\b/i },
  { id: "node-diagnostic-report", pattern: /\bprocess\.(?:report|crash)\b/i },
  { id: "heap-or-core-dump", pattern: /\b(?:heapdump|heap[_ -]?dump|core[_ -]?dump|full[_ -]?memory[_ -]?dump)\b/i },
  { id: "node-diagnostic-report-flag", pattern: /--(?:report-on-fatalerror|report-uncaught-exception|report-on-signal|diagnostic-dir|heapsnapshot-signal|heapsnapshot-near-heap-limit|abort-on-uncaught-exception)\b/i },
  { id: "crash-upload-flag", pattern: /\b(?:uploadToServer\s*:\s*true|CRASH[_-]?REPORTER|DIAGNOSTIC[_-]?REPORT|HEAPDUMP|CORE[_-]?DUMP|FULL[_-]?MEMORY[_-]?DUMP)\b/i },
  { id: "third-party-crash-upload-credential", pattern: /\b(?:SENTRY|BUGSNAG|ROLLBAR)[A-Z_]*(?:DSN|TOKEN|KEY|URL)\b/i }
];
const prohibitedCrashDumpMatches = prohibitedCrashDumpPatterns
  .filter(({ pattern }) => pattern.test(crashSensitiveSources))
  .map(({ id }) => id);
const workerEnvironmentSource = read("electron/ai/worker-environment.ts");
const workerExplicitEnvironmentBlock = workerEnvironmentSource.match(
  /AI_WORKER_EXPLICIT_ENV_KEYS\s*=\s*\[([\s\S]*?)\]\s*as const/
)?.[1] || "";
const workerBaseEnvironmentBlock = workerEnvironmentSource.match(
  /AI_WORKER_BASE_ENV_KEYS\s*=\s*\[([\s\S]*?)\]\s*as const/
)?.[1] || "";
const forbiddenWorkerEnvironmentKeys = [
  "OPENAI_API_KEY",
  "ANTHROPIC_API_KEY",
  "GOOGLE_API_KEY",
  "NVIDIA_API_KEY",
  "AWS_SECRET_ACCESS_KEY",
  "SENTRY_DSN",
  "BUGSNAG_API_KEY",
  "ROLLBAR_ACCESS_TOKEN",
  "NODE_OPTIONS",
  "NODE_PATH",
  "PYTHONPATH",
  "PYTHONHOME",
  "LD_PRELOAD",
  "DYLD_INSERT_LIBRARIES",
  "ELECTRON_CRASH_REPORTER_UPLOAD_TO_SERVER",
  "DIAGNOSTIC_DIR",
  "HEAPDUMP_DIR"
];
const forbiddenWorkerEnvironmentMatches = forbiddenWorkerEnvironmentKeys.filter((key) =>
  new RegExp(`['\"]${key}['\"]`).test(workerExplicitEnvironmentBlock)
);
const forbiddenWorkerBaseEnvironmentMatches = forbiddenWorkerEnvironmentKeys.filter((key) =>
  workerBaseEnvironmentBlock.includes(`"${key}"`) || workerBaseEnvironmentBlock.includes(`'${key}'`)
);
check("secret-bearing Worker has no app-owned crash dump uploader", Boolean(
  prohibitedCrashDumpMatches.length === 0
  && includes("electron/ai/worker-environment.ts", "AI_WORKER_EXPLICIT_ENV_KEYS")
  && includes("electron/ai/worker-environment.ts", "不在宿主显式白名单")
  && forbiddenWorkerEnvironmentMatches.length === 0
  && forbiddenWorkerBaseEnvironmentMatches.length === 0
), {
  sourceFileCount: crashSensitiveSourceFiles.length,
  prohibitedMatches: prohibitedCrashDumpMatches,
  forbiddenWorkerEnvironmentMatches,
  forbiddenWorkerBaseEnvironmentMatches,
  deploymentAuditRequired: true
});

const perfReport = readJsonIfExists(path.join(buildRoot, "perf-report.json"));
if (perfReport) {
  const largest = Math.max(0, ...((perfReport.largestChunks || []).map((chunk) => Number(chunk.bytes) || 0)));
  check("renderer perf report stays inside chunk budget", largest <= Number(perfReport.maxChunkBytes || 0), {
    largest,
    maxChunkBytes: perfReport.maxChunkBytes
  });
}

fs.mkdirSync(buildRoot, { recursive: true });
const report = {
  generatedAt: new Date().toISOString(),
  checks,
  failed: checks.filter((item) => !item.ok)
};
fs.writeFileSync(path.join(buildRoot, "audit-evidence.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");

if (report.failed.length) {
  throw new Error(`Audit evidence failed:\n${report.failed.map((item) => `- ${item.name}`).join("\n")}`);
}

console.log(`Audit evidence passed: ${checks.length} checks, report .build/audit-evidence.json.`);

function check(name, ok, evidence = {}) {
  checks.push({ name, ok: Boolean(ok), evidence });
}

function checkLineBudget(name, relativePath, maxLines) {
  const lines = lineCount(relativePath);
  check(name, lines > 0 && lines <= maxLines, { file: relativePath, lines, maxLines });
}

function exists(relativePath) {
  return fs.existsSync(path.join(appRoot, relativePath));
}

function read(relativePath) {
  return fs.readFileSync(path.join(appRoot, relativePath), "utf8");
}

function readBuild(relativePath) {
  try { return fs.readFileSync(path.join(buildRoot, relativePath), "utf8"); } catch { return ""; }
}

function includes(relativePath, text) {
  try { return read(relativePath).includes(text); } catch { return false; }
}

function anyIncludes(relativePaths, text) {
  return relativePaths.some((relativePath) => includes(relativePath, text));
}

function matches(relativePath, pattern) {
  try { return pattern.test(read(relativePath)); } catch { return false; }
}

function occurrences(relativePath, text) {
  try { return read(relativePath).split(text).length - 1; } catch { return 0; }
}

function lineCount(relativePath) {
  try { return read(relativePath).split(/\r?\n/).length; } catch { return 0; }
}

function countFiles(directory) {
  try { return fs.readdirSync(directory, { withFileTypes: true }).filter((entry) => entry.isFile()).length; } catch { return 0; }
}

function collectSourceFiles(directory, output = []) {
  if (!fs.existsSync(directory)) return output;
  let entries;
  try { entries = fs.readdirSync(directory, { withFileTypes: true }); } catch { return output; }
  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (["node_modules", ".git", ".build", "dist"].includes(entry.name)) continue;
      collectSourceFiles(fullPath, output);
      continue;
    }
    if (!entry.isFile() || /\.test\.[cm]?[jt]sx?$/.test(entry.name)) continue;
    if (/\.(?:[cm]?js|[cm]?tsx?|jsx?)$/.test(entry.name)) output.push(fullPath);
  }
  return output;
}

function readJsonIfExists(filePath) {
  try { return JSON.parse(fs.readFileSync(filePath, "utf8")); } catch { return null; }
}
