const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const rendererRoot = path.join(root, ".build", "renderer");
const assetsRoot = path.join(rendererRoot, "assets");
const maxChunkBytes = Number(process.env.CCTOOLS_MAX_RENDERER_CHUNK_KB || 500) * 1024;

if (!fs.existsSync(assetsRoot)) {
  throw new Error("Renderer assets are missing. Run npm run build before npm run perf:check.");
}

const jsAssets = fs.readdirSync(assetsRoot)
  .filter((name) => name.endsWith(".js"))
  .map((name) => {
    const file = path.join(assetsRoot, name);
    return { name, bytes: fs.statSync(file).size };
  })
  .sort((a, b) => b.bytes - a.bytes);

const oversized = jsAssets.filter((asset) => asset.bytes > maxChunkBytes);
if (oversized.length) {
  const lines = oversized.map((asset) => `- ${asset.name}: ${formatBytes(asset.bytes)}`).join("\n");
  throw new Error(`Renderer JS chunk budget exceeded (${formatBytes(maxChunkBytes)}):\n${lines}`);
}

const indexPath = path.join(rendererRoot, "index.html");
const index = fs.readFileSync(indexPath, "utf8");
const entryScripts = [...index.matchAll(/<script[^>]+src="\.\/assets\/([^"]+\.js)"/g)].map((match) => match[1]);
const entryBytes = entryScripts.reduce((total, name) => {
  const match = jsAssets.find((asset) => asset.name === name);
  return total + (match?.bytes || 0);
}, 0);

const report = {
  generatedAt: new Date().toISOString(),
  maxChunkBytes,
  entryScripts,
  entryBytes,
  largestChunks: jsAssets.slice(0, 12)
};

fs.writeFileSync(path.join(root, ".build", "perf-report.json"), JSON.stringify(report, null, 2));
console.log(`Renderer perf budget passed: ${jsAssets.length} JS chunks, largest ${formatBytes(jsAssets[0]?.bytes || 0)}, entry ${formatBytes(entryBytes)}.`);

function formatBytes(bytes) {
  return `${(bytes / 1024).toFixed(1)} KiB`;
}
