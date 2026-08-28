const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const appRoot = path.resolve(__dirname, "..");
const runner = path.join(__dirname, "stream-performance-electron.js");
const electron = require("electron");

if (!fs.existsSync(path.join(appRoot, ".build", "renderer", "index.html"))) {
  throw new Error("Renderer build is missing. Run npm run build:renderer before npm run perf:stream.");
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
    OPENMIND_STREAM_PERF: "1",
    OPENMIND_RESIZE_PERF_EVENTS: process.env.OPENMIND_STREAM_PERF_EVENTS || "1000",
    OPENMIND_STREAM_PERF_CHARS: process.env.OPENMIND_STREAM_PERF_CHARS || "49152",
    OPENMIND_REASONING_PERF_CHARS: process.env.OPENMIND_REASONING_PERF_CHARS || "24576"
  }
});

if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status || 1);

function commandExists(commandName) {
  const result = spawnSync("which", [commandName], { encoding: "utf8" });
  return result.status === 0;
}
