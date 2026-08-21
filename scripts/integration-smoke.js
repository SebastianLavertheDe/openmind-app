const fs = require("fs");
const Module = require("module");
const os = require("os");
const path = require("path");

const appRoot = path.resolve(__dirname, "..");
const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "openmind-desktop-integration-"));
const openmindRoot = path.join(fixtureRoot, "openmind");
const userData = path.join(fixtureRoot, "user-data");
const previousOpenmindRoot = process.env.OPENMIND_ROOT;
const previousUserDataDir = process.env.OPENMIND_USER_DATA_DIR;
const originalLoad = Module._load;

writeFixture("openmind/article/20260610/article.md", "# Integration article\n\nFixture body.\n");
writeFixture("openmind/article/20260610/x_fixture.md", "# Integration X post\n\nFixture post.\n");
writeFixture("openmind/post/20260610/posts.json", `${JSON.stringify([{ id: "fixture-post" }], null, 2)}\n`);
writeFixture("openmind/reddit/20260610/reddit.md", "# Integration Reddit item\n");
writeFixture("openmind/daily-summary/20260610_daily_summary.md", "# Integration summary\n");
writeFixture(
  "openmind/creative/01-内容生产/选题管理/ai_topic_2026-06-11.md",
  "## 1. 今日最推荐\n\n**Integration topic**\n\nFixture topic body.\n\n## 2. 小红书\n"
);
writeFixture(
  "openmind/creative/01-内容生产/文稿库/02-制作中/20260610-fixture/manifest.json",
  `${JSON.stringify({
    topic: "Integration project",
    date: "20260610",
    status: "drafting",
    platforms: { wechat: "draft" },
    tags: []
  }, null, 2)}\n`
);
writeFixture(
  "openmind/creative/01-内容生产/文稿库/02-制作中/20260610-fixture/topic-brief.md",
  "# Integration project\n"
);

process.env.OPENMIND_ROOT = openmindRoot;
process.env.OPENMIND_USER_DATA_DIR = userData;

try {
  Module._load = function loadWithElectronStub(request, parent, isMain) {
    if (request === "electron") {
      return { app: { getPath: () => userData } };
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
  assert(settings.findRepoRoot() === fixtureRoot, "Data repository root detection failed");
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

  const wslPath = processUtils.parseWslPath("\\\\wsl.localhost\\Ubuntu\\home\\example\\openmind");
  assert(wslPath?.distro === "Ubuntu", "WSL distro parsing failed");
  assert(wslPath?.linuxPath === "/home/example/openmind", "WSL Linux path parsing failed");

  const providerSources = [
    "electron/ai/providers/codex-app-server.ts",
    "electron/ai/providers/claude-agent-sdk.ts"
  ].map((file) => fs.readFileSync(path.join(appRoot, file), "utf8")).join("\n");
  assert(!providerSources.includes("dangerously-bypass"), "Dangerous Codex bypass flag is forbidden");
  assert(!providerSources.includes("dangerously-skip"), "Dangerous Claude bypass flag is forbidden");
  const codexArgs = codexProvider.buildCodexAppServerArgs("gpt-5-codex");
  assert(Array.isArray(codexArgs) && codexArgs[0] === "app-server", "Codex app-server integration is missing");
  assert(codexArgs.includes("model=\"gpt-5-codex\""), "Codex app-server model wiring is missing");
  assert(providerSources.includes("@anthropic-ai/claude-agent-sdk"), "Claude Agent SDK integration is missing");

  const schedulerSource = ["scheduler.ts", "scheduler-execution.ts"]
    .map((file) => fs.readFileSync(path.join(appRoot, "electron", "ai", file), "utf8"))
    .join("\n");
  const legacyChangeSource = fs.readFileSync(path.join(appRoot, "electron", "ai", "workspace-manager.ts"), "utf8");
  assert(schedulerSource.includes("const directCwd = resolveCwd"), "AI runs are not routed to the configured project directory");
  assert(!schedulerSource.includes(".create(run)"), "AI runs must not create isolated workspaces");
  assert(!schedulerSource.includes(".collect(this.store.getRun"), "AI runs must not collect isolated workspace changes");
  assert(!legacyChangeSource.includes("git worktree add"), "Desktop app must not create Git worktrees");

  console.log(
    `Desktop integration smoke passed with isolated fixture: ${overview.metrics.articles} articles, ${overview.metrics.posts} posts, ${overview.metrics.summaries} summary.`
  );
} finally {
  Module._load = originalLoad;
  restoreEnv("OPENMIND_ROOT", previousOpenmindRoot);
  restoreEnv("OPENMIND_USER_DATA_DIR", previousUserDataDir);
  fs.rmSync(fixtureRoot, { recursive: true, force: true });
}

function writeFixture(relativePath, content) {
  const target = path.join(fixtureRoot, relativePath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content, "utf8");
}

function restoreEnv(name, value) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
