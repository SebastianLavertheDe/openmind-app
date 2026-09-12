const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const rendererRoot = path.join(root, ".build", "renderer");
const assetsRoot = path.join(rendererRoot, "assets");
const preloadPath = path.join(root, ".build", "electron", "electron", "preload.js");
const maxChunkBytes = Number(process.env.OPENMIND_MAX_RENDERER_CHUNK_KB || 500) * 1024;
// Worker bundles are monolithic by construction: inline workers must stay a
// single file to work under Electron's packaged file:// origin, and prebuilt
// vendor workers (pdf.js) ship as one minified blob that cannot be split.
// They load lazily off the startup path, so they get their own budget instead
// of inflating the startup-chunk budget.
const maxWorkerChunkBytes = Number(process.env.OPENMIND_MAX_WORKER_CHUNK_KB || 1024) * 1024;
const workerChunkPatterns = [/^document\.worker-.*\.js$/, /^pdf\.worker\.min-.*\.js$/];
// 启动体积预算：entry graph 按 HTML 里的首帧实际请求计（<script src> +
// <link rel="modulepreload">，此前只数 <script src>，少算了整条预取链），
// CSS 与 preload 各自单列。preload 因沙箱约束是整包 bundle，无法分包。
const maxEntryGraphBytes = Number(process.env.OPENMIND_MAX_ENTRY_GRAPH_KB || 1_400) * 1024;
const maxCssBytes = Number(process.env.OPENMIND_MAX_CSS_KB || 520) * 1024;
// 实测 ~15KiB：沙箱 preload 只应包含桥代码与通道常量。PROJECT_IPC 曾因引用
// project-contracts 的 Zod schema 表把 preload 抬到 602.7KiB——64KiB 的预算
// 足以拦截任何 schema 模块重新进入 preload 图。
const maxPreloadBytes = Number(process.env.OPENMIND_MAX_PRELOAD_KB || 64) * 1024;

if (!fs.existsSync(assetsRoot)) {
  throw new Error("Renderer assets are missing. Run npm run build before npm run perf:check.");
}
if (!fs.existsSync(preloadPath)) {
  throw new Error("Preload bundle is missing. Run npm run build before npm run perf:check.");
}

const jsAssets = fs.readdirSync(assetsRoot)
  .filter((name) => name.endsWith(".js"))
  .map((name) => {
    const file = path.join(assetsRoot, name);
    return { name, bytes: fs.statSync(file).size, isWorkerChunk: workerChunkPatterns.some((pattern) => pattern.test(name)) };
  })
  .sort((a, b) => b.bytes - a.bytes);
const cssAssets = fs.readdirSync(assetsRoot)
  .filter((name) => name.endsWith(".css"))
  .map((name) => ({ name, bytes: fs.statSync(path.join(assetsRoot, name)).size }))
  .sort((a, b) => b.bytes - a.bytes);

const index = fs.readFileSync(path.join(rendererRoot, "index.html"), "utf8");
const linkTags = index.match(/<link[^>]*>/g) || [];
const entryScripts = [...index.matchAll(/<script[^>]+src="\.\/assets\/([^"]+\.js)"/g)].map((match) => match[1]);
const modulePreloads = linkTags
  .filter((tag) => /rel="modulepreload"/.test(tag))
  .flatMap((tag) => [...tag.matchAll(/href="\.\/assets\/([^"]+\.js)"/g)].map((match) => match[1]));
const stylesheetNames = linkTags
  .filter((tag) => /rel="stylesheet"/.test(tag))
  .flatMap((tag) => [...tag.matchAll(/href="\.\/assets\/([^"]+\.css)"/g)].map((match) => match[1]));

// 同一个 chunk 可能同时出现在 script 与 modulepreload 里；按去重后的集合计。
const entryGraphNames = [...new Set([...entryScripts, ...modulePreloads])];
function graphBytes(names, assets) {
  return names.reduce((total, name) => {
    const asset = assets.find((candidate) => candidate.name === name);
    if (!asset) throw new Error(`index.html references missing asset: ${name}`);
    return total + asset.bytes;
  }, 0);
}
const entryGraphBytes = graphBytes(entryGraphNames, jsAssets);
const cssBytes = graphBytes(stylesheetNames, cssAssets);
const preloadBytes = fs.statSync(preloadPath).size;

const oversized = jsAssets.filter((asset) => asset.bytes > (asset.isWorkerChunk ? maxWorkerChunkBytes : maxChunkBytes));
const violations = [];
if (oversized.length) {
  const lines = oversized.map((asset) => `- ${asset.name}: ${formatBytes(asset.bytes)} (budget ${formatBytes(asset.isWorkerChunk ? maxWorkerChunkBytes : maxChunkBytes)})`).join("\n");
  violations.push(`Renderer JS chunk budget exceeded (${formatBytes(maxChunkBytes)}):\n${lines}`);
}
if (entryGraphBytes > maxEntryGraphBytes) {
  violations.push(`Startup entry graph (script + modulepreload) ${formatBytes(entryGraphBytes)} exceeds budget ${formatBytes(maxEntryGraphBytes)}:\n${entryGraphNames.map((name) => `- ${name}: ${formatBytes(jsAssets.find((asset) => asset.name === name).bytes)}`).join("\n")}`);
}
if (cssBytes > maxCssBytes) {
  violations.push(`Startup CSS ${formatBytes(cssBytes)} exceeds budget ${formatBytes(maxCssBytes)}:\n${stylesheetNames.map((name) => `- ${name}: ${formatBytes(cssAssets.find((asset) => asset.name === name).bytes)}`).join("\n")}`);
}
if (preloadBytes > maxPreloadBytes) {
  violations.push(`Preload bundle ${formatBytes(preloadBytes)} exceeds budget ${formatBytes(maxPreloadBytes)}.`);
}
if (violations.length) {
  throw new Error(`${violations.join("\n\n")}`);
}

const report = {
  generatedAt: new Date().toISOString(),
  budgets: {
    maxChunkBytes,
    maxWorkerChunkBytes,
    maxEntryGraphBytes,
    maxCssBytes,
    maxPreloadBytes
  },
  entryScripts,
  modulePreloads,
  entryGraphBytes,
  cssBytes,
  preloadBytes,
  largestChunks: jsAssets.slice(0, 12)
};

fs.writeFileSync(path.join(root, ".build", "perf-report.json"), JSON.stringify(report, null, 2));
console.log(
  `Renderer perf budget passed: ${jsAssets.length} JS chunks, largest ${formatBytes(jsAssets[0]?.bytes || 0)}; ` +
  `entry graph ${formatBytes(entryGraphBytes)} (${entryGraphNames.length} chunks); ` +
  `CSS ${formatBytes(cssBytes)}; preload ${formatBytes(preloadBytes)}.`
);

function formatBytes(bytes) {
  return `${(bytes / 1024).toFixed(1)} KiB`;
}
