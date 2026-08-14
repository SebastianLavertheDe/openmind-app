const fs = require("fs");
const Module = require("module");
const path = require("path");

const repoRoot = path.resolve(__dirname, "..", "..");
process.env.CCTOOLS_REPO_ROOT = repoRoot;

const originalLoad = Module._load;
Module._load = function loadWithElectronStub(request, parent, isMain) {
  if (request === "electron") {
    return { app: { getPath: () => path.join(repoRoot, ".desktop-app-test") } };
  }
  return originalLoad.call(this, request, parent, isMain);
};

const settings = require("../.build/electron/electron/lib/settings.js");
const content = require("../.build/electron/electron/lib/content.js");
const creative = require("../.build/electron/electron/lib/creative.js");
const processUtils = require("../.build/electron/electron/ai/process-utils.js");
const codexProvider = require("../.build/electron/electron/ai/providers/codex-app-server.js");
Module._load = originalLoad;

const date = "20260610";
const overview = content.getOverview(date);
assert(settings.findRepoRoot() === repoRoot, "Repo root detection failed");
assert(overview.metrics.articles > 0, "Expected article metrics for smoke-test date");
assert(overview.metrics.posts > 0, "Expected X post metrics for smoke-test date");
assert(overview.metrics.summaries > 0, "Flat daily-summary files were not detected");

const articles = content.getContent("articles", date);
assert(articles.length > 0, "Article content listing is empty");
assert(articles.every((file) => !file.name.startsWith("x_")), "X posts leaked into the article listing");
const posts = content.getContent("posts", date);
assert(posts.some((file) => file.name.startsWith("x_")), "X markdown posts were not included in the post listing");
const preview = content.readContent(articles[0].path);
assert(preview.content.length > 0, "Content preview could not be read");

const creativeProjects = creative.listCreativeProjects();
assert(creativeProjects.length > 0, "Creative project listing is empty");
assert(creativeProjects.every((project) => project.completion >= 0 && project.completion <= 100), "Creative completion is invalid");
const creativeTopics = creative.getCreativeTopics("20260611");
assert(creativeTopics.date === "20260611" && creativeTopics.topics.length > 0, "Creative topics do not follow the selected date");

const wslPath = processUtils.parseWslPath("\\\\wsl.localhost\\Ubuntu\\home\\say\\work\\github\\cctools");
assert(wslPath?.distro === "Ubuntu", "WSL distro parsing failed");
assert(wslPath?.linuxPath === "/home/say/work/github/cctools", "WSL Linux path parsing failed");

const providerSources = [
  "electron/ai/providers/codex-app-server.ts",
  "electron/ai/providers/claude-agent-sdk.ts"
].map((file) => fs.readFileSync(path.join(__dirname, "..", file), "utf8")).join("\n");
assert(!providerSources.includes("dangerously-bypass"), "Dangerous Codex bypass flag is forbidden");
assert(!providerSources.includes("dangerously-skip"), "Dangerous Claude bypass flag is forbidden");
const codexArgs = codexProvider.buildCodexAppServerArgs("gpt-5-codex");
assert(Array.isArray(codexArgs) && codexArgs[0] === "app-server", "Codex app-server integration is missing");
assert(codexArgs.includes("model=\"gpt-5-codex\""), "Codex app-server model wiring is missing");
assert(providerSources.includes("@anthropic-ai/claude-agent-sdk"), "Claude Agent SDK integration is missing");

const schedulerSource = ["scheduler.ts", "scheduler-execution.ts"]
  .map((file) => fs.readFileSync(path.join(__dirname, "..", "electron", "ai", file), "utf8"))
  .join("\n");
const legacyChangeSource = fs.readFileSync(path.join(__dirname, "..", "electron", "ai", "workspace-manager.ts"), "utf8");
assert(schedulerSource.includes("const directCwd = resolveCwd"), "AI runs are not routed to the configured project directory");
assert(!schedulerSource.includes(".create(run)"), "AI runs must not create isolated workspaces");
assert(!schedulerSource.includes(".collect(this.store.getRun"), "AI runs must not collect isolated workspace changes");
assert(!legacyChangeSource.includes("git worktree add"), "Desktop app must not create Git worktrees");

// 扫描 .claude/skills/*/SKILL.md,验证 frontmatter 执行配置完整
const skillsDir = path.join(repoRoot, ".claude", "skills");
let structuredSkillCount = 0;
if (fs.existsSync(skillsDir)) {
  for (const entry of fs.readdirSync(skillsDir, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith("_")) continue;
    const mdPath = path.join(skillsDir, entry.name, "SKILL.md");
    if (!fs.existsSync(mdPath)) continue;
    const raw = fs.readFileSync(mdPath, "utf8");
    // 轻量 frontmatter 提取:检查是否有 runner/permission/timeoutMs/outputArtifacts
    const fmMatch = raw.match(/^---\n([\s\S]*?)\n---/);
    if (!fmMatch) continue;
    const fm = fmMatch[1];
    const hasRunner = /^runner:/m.test(fm);
    if (!hasRunner) continue; // 纯 prompt 型 skill,跳过执行配置校验
    structuredSkillCount++;
    assert(/^permission:/m.test(fm), `Skill ${entry.name} frontmatter missing permission`);
    assert(/^timeoutMs:/m.test(fm), `Skill ${entry.name} frontmatter missing timeoutMs`);
    assert(/^outputArtifacts:/m.test(fm), `Skill ${entry.name} frontmatter missing outputArtifacts`);
    // 校验 cwd 存在
    const cwdMatch = fm.match(/^cwd:\s*(.+)$/m);
    if (cwdMatch) {
      const cwd = cwdMatch[1].trim();
      assert(fs.existsSync(path.join(repoRoot, cwd)), `Skill cwd does not exist: ${entry.name} (${cwd})`);
    }
  }
}

console.log(`Desktop integration smoke passed: ${overview.metrics.articles} articles, ${overview.metrics.posts} posts, ${overview.metrics.summaries} summary, ${structuredSkillCount} structured skills.`);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
