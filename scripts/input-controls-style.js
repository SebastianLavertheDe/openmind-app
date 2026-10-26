const { skipUnsupportedVisualPlatform } = require("./ui-contract/visual-platform.cjs");
if (skipUnsupportedVisualPlatform("Input visual checks")) process.exit(0);

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const esbuild = require("esbuild");
const electron = require("electron");

const root = path.resolve(__dirname, "..");
const output = path.join(root, ".build", "input-controls-style");
fs.mkdirSync(output, { recursive: true });
esbuild.buildSync({
  entryPoints: [path.join(__dirname, "fixtures", "input-controls", "fixture.tsx")],
  outfile: path.join(output, "fixture.js"),
  bundle: true, platform: "browser", format: "iife", target: "chrome140",
  jsx: "automatic", minify: true, define: { "process.env.NODE_ENV": '"production"' }
});
fs.writeFileSync(path.join(output, "index.html"), `<!doctype html><html><head><meta charset="utf-8">
  <link rel="stylesheet" href="./fixture.css"><style>
  body { overflow: auto; }
  .input-probe-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(260px, 100%), 1fr)); gap: 16px; padding: 16px; }
  .input-probe-example { min-width: 0; display: grid; align-content: start; gap: 8px; }
  .input-probe-layout > :not(strong) { height: 320px; }
  .input-probe-layout > .creative-workspace { grid-template-columns: minmax(0, 1fr); }
  </style></head><body><div id="root"></div><script src="./fixture.js"></script></body></html>`);
const environment = { ...process.env };
delete environment.ELECTRON_RUN_AS_NODE;
const needsDisplay = process.platform === "linux" && !process.env.DISPLAY;
const command = needsDisplay ? "xvfb-run" : electron;
const args = [...(needsDisplay ? ["-a", electron] : []), "--no-sandbox", path.join(__dirname, "input-controls-style-electron.js")];
const result = spawnSync(command, args, { cwd: root, stdio: "inherit", env: environment });
if (result.error) throw result.error;
process.exitCode = result.status === null ? 1 : result.status;
