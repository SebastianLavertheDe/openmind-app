/**
 * Clean-machine one-click CLI install smoke.
 *
 * Runs the real CliInstallerService (official Claude and Codex standalone
 * install scripts) against the live network on the current machine. Intended for
 * the windows-latest / macos-latest jobs of the multi-OS CI matrix — those
 * runners are clean Windows/macOS machines without a pre-installed Claude or
 * Codex CLI. Linux exits SKIP because one-click install is a Windows/macOS
 * product capability only.
 *
 * Usage (requires `npm run build` first):
 *   node scripts/cli-install-smoke.js [claude|codex|all]
 */
const { spawnSync } = require("child_process");
const fs = require("fs");
const Module = require("module");
const os = require("os");
const path = require("path");

const userData = fs.mkdtempSync(path.join(os.tmpdir(), "openmind-cli-install-"));
process.on("exit", () => fs.rmSync(userData, { recursive: true, force: true }));
const originalLoad = Module._load;
Module._load = function loadWithElectronStub(request, parent, isMain) {
  if (request === "electron") {
    return { app: { getPath: () => userData } };
  }
  return originalLoad.call(this, request, parent, isMain);
};

const { CliInstallerService } = require("../.build/electron/electron/install/cli-installer-service.js");
const { buildAppPaths, ensureAppPaths } = require("../.build/electron/electron/paths/app-paths-service.js");
Module._load = originalLoad;

function fail(message) {
  console.error(`cli-install-smoke: ${message}`);
  process.exit(1);
}

if (process.platform === "linux") {
  console.log("cli-install-smoke: SKIP — 一键安装仅面向 Windows/macOS 产品目标。");
  process.exit(0);
}

const requested = process.argv[2] || "all";
const targets = requested === "all"
  ? ["claude", "codex"]
  : [requested];
if (targets.some((target) => target !== "claude" && target !== "codex")) {
  fail(`未知目标：${requested}（可选 claude | codex | all）`);
}

const paths = buildAppPaths(userData);
ensureAppPaths(paths);
const service = new CliInstallerService(paths);

(async () => {
  for (const cli of targets) {
    const before = service.status(cli);
    if (before.installed) {
      console.log(`cli-install-smoke[${cli}]: SKIP — 已安装 ${before.version || ""}（使用 --force 场景请先清理 ${paths.toolBin}）。`);
      continue;
    }
    const phases = [];
    const status = await service.install(cli, (progress) => {
      if (progress.phase !== phases[phases.length - 1]) phases.push(progress.phase);
    });
    if (!status.installed) fail(`${cli} 安装后 status.installed=false`);
    console.log(`cli-install-smoke[${cli}]: installed version=${status.version || "unknown"} method=${status.digest ? "digest-recorded" : "no-digest"}`);
    console.log(`cli-install-smoke[${cli}]: phases=${phases.join(">")}`);
    const launcher = service.executablePath(cli);
    if (!fs.existsSync(launcher)) fail(`${cli} launcher 不存在：${launcher}`);
    const probe = process.platform === "win32"
      ? spawnSync("cmd.exe", ["/d", "/s", "/c", `"${launcher.replaceAll('"', '""')}" --version`], { encoding: "utf8", timeout: 60_000 })
      : spawnSync(launcher, ["--version"], { encoding: "utf8", timeout: 60_000 });
    if (probe.status !== 0) fail(`${cli} --version 退出码 ${probe.status}：${(probe.stderr || probe.stdout || "").slice(0, 400)}`);
    console.log(`cli-install-smoke[${cli}]: --version → ${(probe.stdout || "").trim().slice(0, 80)}`);
  }
  console.log("cli-install-smoke: PASS");
})().catch((error) => {
  fail(error && error.stack ? error.stack : String(error));
});
