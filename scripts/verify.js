const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const requiredFiles = [
  "package.json",
  ".build/electron/electron/main.js",
  ".build/electron/electron/preload.js",
  ".build/electron/electron/ai/worker.js",
  ".build/electron/electron/ai/browser-evidence-mcp.js",
  ".build/renderer/index.html",
  "shared/contracts.ts",
  "electron/ai/session-store.ts",
  "electron/ai/workspace-manager.ts",
  "renderer/src/App.tsx",
  "renderer/src/components/AiWorkbench.tsx"
];

for (const file of requiredFiles) {
  const target = path.join(root, file);
  if (!fs.existsSync(target) || fs.statSync(target).size === 0) {
    throw new Error(`Missing required desktop app file: ${file}`);
  }
}

const pkg = require(path.join(root, "package.json"));
if (pkg.main !== ".build/electron/electron/main.js") throw new Error("Desktop entry does not target the TypeScript build.");
if (!pkg.scripts.typecheck) throw new Error("Type checking is not part of the desktop build.");
const preloadOutput = fs.readFileSync(path.join(root, ".build/electron/electron/preload.js"), "utf8");
if (/require\((["'])\.\.?[\\/]/.test(preloadOutput)) {
  throw new Error("Sandboxed preload must be bundled without local require() calls.");
}
for (const legacy of ["electron/main.js", "electron/preload.js", "electron/lib/ai-manager.js", "electron/lib/skills-runner.js", "src/app.js", "src/index.html", "src/styles.css"]) {
  if (fs.existsSync(path.join(root, legacy))) throw new Error(`Legacy desktop implementation must not ship: ${legacy}`);
}
const forbidden = ["dangerously-bypass-approvals-and-sandbox", "dangerously-skip-permissions"];
const providerText = [
  "electron/ai/providers/codex-app-server.ts",
  "electron/ai/providers/claude-agent-sdk.ts"
].map((file) => fs.readFileSync(path.join(root, file), "utf8")).join("\n");
for (const flag of forbidden) if (providerText.includes(flag)) throw new Error(`Forbidden provider flag found: ${flag}`);
console.log("Engineering AI workspace build structure verified.");
