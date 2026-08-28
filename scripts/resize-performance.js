const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const appRoot = path.resolve(__dirname, "..");
const runner = path.join(__dirname, "resize-performance-electron.js");
const electron = require("electron");

if (!fs.existsSync(path.join(appRoot, ".build", "renderer", "index.html"))) {
  throw new Error("Renderer build is missing. Run npm run build:renderer before npm run perf:resize.");
}

const command = process.platform === "linux" && !process.env.DISPLAY && commandExists("xvfb-run")
  ? "xvfb-run"
  : electron;
const args = command === "xvfb-run"
  ? ["-a", electron, "--no-sandbox", runner]
  : ["--no-sandbox", runner];
const childEnv = { ...process.env };
delete childEnv.ELECTRON_RUN_AS_NODE;

const result = spawnSync(command, args, {
  cwd: appRoot,
  stdio: "inherit",
  env: {
    ...childEnv,
    ELECTRON_DISABLE_SANDBOX: "1",
    ELECTRON_DISABLE_SECURITY_WARNINGS: "1",
    OPENMIND_RESIZE_PERF_EVENTS: process.env.OPENMIND_RESIZE_PERF_EVENTS || "1000"
  }
});

if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status || 1);

function commandExists(commandName) {
  const result = spawnSync("which", [commandName], { encoding: "utf8" });
  return result.status === 0;
}
