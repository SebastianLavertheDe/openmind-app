const { skipUnsupportedVisualPlatform } = require("./ui-contract/visual-platform.cjs");
if (skipUnsupportedVisualPlatform("App visual snapshots")) process.exit(0);

const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const appRoot = path.resolve(__dirname, "..");
const runner = path.join(__dirname, "visual-snapshot-electron.js");
const electron = require("electron");

if (!fs.existsSync(path.join(appRoot, ".build", "renderer", "index.html"))) {
  throw new Error("Renderer build is missing. Run npm run build before npm run visual:snapshot.");
}

const command = process.platform === "linux" && !process.env.DISPLAY && commandExists("xvfb-run")
  ? "xvfb-run"
  : electron;
const args = command === "xvfb-run"
  ? ["-a", electron, "--no-sandbox", runner]
  : ["--no-sandbox", runner];
const childEnv = { ...process.env };
// An empty ELECTRON_RUN_AS_NODE is still truthy to Electron on Windows and
// makes it parse --no-sandbox as a Node option. Visual snapshots must launch
// the real Electron binary, so remove the flag entirely.
delete childEnv.ELECTRON_RUN_AS_NODE;

const result = spawnSync(command, args, {
  cwd: appRoot,
  stdio: "inherit",
  env: {
    ...childEnv,
    ELECTRON_DISABLE_SANDBOX: "1",
    ELECTRON_DISABLE_SECURITY_WARNINGS: "1"
  }
});

if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status || 1);

function commandExists(commandName) {
  const result = spawnSync("which", [commandName], { encoding: "utf8" });
  return result.status === 0;
}
