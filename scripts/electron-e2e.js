const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn, spawnSync } = require("child_process");

const appRoot = path.resolve(__dirname, "..");
const electron = require("electron");
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "openmind-desktop-e2e-"));
const userData = path.join(tempRoot, "user-data");
const openmindRoot = path.join(tempRoot, "openmind");
const date = localDate();

fs.mkdirSync(path.join(openmindRoot, "article", date), { recursive: true });
fs.writeFileSync(
  path.join(openmindRoot, "article", date, "desktop-e2e.md"),
  "# Desktop E2E fixture\n\nThis article verifies the real Electron preload and IPC bridge.\n",
  "utf8"
);
// Flat content-root layout: config/ and .agent/ live directly under the root.
fs.mkdirSync(path.join(openmindRoot, "config"), { recursive: true });
fs.mkdirSync(path.join(openmindRoot, ".agent", "skills"), { recursive: true });

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
env.OPENMIND_E2E_USER_DATA_DIR = userData;
env.OPENMIND_ROOT = openmindRoot;

const useXvfb = process.platform === "linux" && !process.env.DISPLAY && commandExists("xvfb-run");
const command = useXvfb ? "xvfb-run" : electron;
const args = useXvfb
  ? ["-a", electron, "--no-sandbox", appRoot, "--e2e-test"]
  : ["--no-sandbox", appRoot, "--e2e-test"];

const child = spawn(command, args, {
  cwd: appRoot,
  env,
  stdio: "inherit",
  windowsHide: true
});
let finished = false;

child.once("error", (error) => {
  console.error("Unable to launch Electron E2E:", error);
  cleanup(1);
});
child.once("exit", (code, signal) => {
  if (signal) {
    console.error(`Electron E2E exited via ${signal}.`);
    cleanup(1);
    return;
  }
  cleanup(code || 0);
});

function commandExists(name) {
  return spawnSync("which", [name], { stdio: "ignore" }).status === 0;
}

function localDate() {
  const now = new Date();
  return `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}`;
}

function cleanup(code) {
  if (finished) return;
  finished = true;
  fs.rmSync(tempRoot, { recursive: true, force: true });
  process.exitCode = code;
}
