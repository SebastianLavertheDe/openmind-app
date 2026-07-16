const fs = require("fs");
const path = require("path");

const appRoot = path.resolve(__dirname, "..");
const repoRoot = path.resolve(appRoot, "..");
const buildRoot = path.join(appRoot, ".build");
const checks = [];

check("uiuxopt references are present", countFiles(path.join(repoRoot, "uiuxopt")) >= 40, {
  count: countFiles(path.join(repoRoot, "uiuxopt"))
});

check("renderer routes are lazy loaded", includes("renderer/src/app/route-registry.tsx", "const SourcesPage = lazy(") && includes("renderer/src/app/route-registry.tsx", "const AiWorkbench = lazy("));
check("renderer chunks are manually split", includes("vite.config.ts", "manualChunks(id)") && includes("vite.config.ts", "vendor-markdown"));
check("large collections remain virtualized or paginated", includes("renderer/src/features/ai-console/AiWorkbench.tsx", "<VirtualList") && includes("electron/product/content-index.ts", "query.cursor + query.limit"));
check("chat markdown cache is bounded and hash keyed", includes("renderer/src/features/ai-console/message.tsx", "MARKDOWN_CACHE_LIMIT") && includes("renderer/src/features/ai-console/message.tsx", "markdownCacheKey"));
check("focus and reduced motion styles are present", anyIncludes(["renderer/src/styles.css", "renderer/src/styles/base.css", "renderer/src/styles/tokens.css"], ":focus-visible") && anyIncludes(["renderer/src/styles.css", "renderer/src/styles/base.css"], "prefers-reduced-motion"));

check("browser preview is explicitly marked", includes("renderer/src/browser-api.ts", 'environment: { mode: "preview" }') && includes("renderer/src/app/AppShell.tsx", 'environment.mode === "preview"'));
check("Electron preload failure cannot silently use preview data", includes("renderer/src/App.tsx", "m.app.preloadMissing") && includes("renderer/src/browser-api.ts", "isElectronRenderer()"));
check("cross-module feedback has recovery guidance and local log", includes("renderer/src/ai-context.tsx", "FEEDBACK_LOG_KEY") && includes("renderer/src/ai-context.tsx", "recoveryHint") && includes("renderer/src/components/FeedbackHost.tsx", "toast.recovery"));
check("visual snapshot matrix is wired into release verification", exists("scripts/visual-snapshot.js") && exists("scripts/visual-snapshot-electron.js") && includes("package.json", "visual:snapshot") && includes("docs/VISUAL_AUDIT_CHECKLIST.md", ".build/visual-snapshot-report.json"));

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

function includes(relativePath, text) {
  try { return read(relativePath).includes(text); } catch { return false; }
}

function anyIncludes(relativePaths, text) {
  return relativePaths.some((relativePath) => includes(relativePath, text));
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

function readJsonIfExists(filePath) {
  try { return JSON.parse(fs.readFileSync(filePath, "utf8")); } catch { return null; }
}
