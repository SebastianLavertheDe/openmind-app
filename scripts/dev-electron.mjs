// 一条命令启动"vite 热更新 + Electron"开发环境：
//   npm run dev:electron
// 脚本自动拉起 vite（自动挑空闲端口），把实际地址传给 Electron，Electron 退出时联动关闭 vite。
// 改 renderer 源码（CSS/TSX）即时热更新，无需重新构建或打包。
// main/preload 无法热更新：每次启动前自动执行 build:electron，保证 dist 里的主进程与
// preload 桥和源码一致（否则 renderer 新增的 IPC 调用会打不到旧桥上）。
// 可选环境变量 OPENMIND_DEVTOOLS_PORT：给 Electron 开 CDP 调试端口。
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);
const electronBinary = require("electron");
// vite 未在 exports 中暴露 bin 入口，经 package.json 的 bin 字段定位 CLI 文件。
const vitePkgDir = path.dirname(require.resolve("vite/package.json"));
const viteJs = path.join(vitePkgDir, require(path.join(vitePkgDir, "package.json")).bin.vite);

const stripAnsi = (value) => value.replace(/\x1B\[[0-9;]*m/g, "");

function runStep(command, args, label) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: "inherit", windowsHide: true, shell: process.platform === "win32" });
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${label} 失败（code ${code}）。`));
    });
    child.on("error", reject);
  });
}

// 主进程与 preload 是编译产物，启动前先重建，避免渲染层新代码调到旧桥。
await runStep("npm", ["run", "build:electron"], "[dev-electron] build:electron");
console.log("[dev-electron] main/preload 已重新构建。");

const vite = spawn(process.execPath, [viteJs, "--host", "127.0.0.1"], { stdio: ["ignore", "pipe", "pipe"] });
const forwardViteOutput = (chunk) => process.stdout.write(chunk);
vite.stdout.on("data", forwardViteOutput);
vite.stderr.on("data", forwardViteOutput);

const shutdown = (code) => {
  vite.removeAllListeners("exit");
  try { vite.kill(); } catch { /* already gone */ }
  process.exitCode = code ?? 0;
};
vite.on("exit", (code) => {
  console.error(`[dev-electron] vite 意外退出（code ${code}），Electron 未启动。`);
  process.exitCode = 1;
});

const devServerUrl = await new Promise((resolve, reject) => {
  let buffer = "";
  const timer = setTimeout(() => reject(new Error("等待 vite 启动超时（30s）。")), 30_000);
  const onData = (chunk) => {
    buffer += stripAnsi(chunk.toString());
    const match = buffer.match(/Local:\s*(https?:\/\/[^\s]+)/);
    if (match) {
      clearTimeout(timer);
      vite.stdout.off("data", forwardViteOutput);
      resolve(match[1]);
    }
  };
  vite.stdout.on("data", onData);
});

console.log(`[dev-electron] dev server: ${devServerUrl}`);
const electronArgs = ["."];
// Linux 下未正确配置 SUID sandbox helper 时 Electron 会拒绝启动（FATAL:setuid_sandbox_host），
// 与 scripts/electron-e2e.js 的做法一致：开发模式直接禁用沙箱。
if (process.platform === "linux") electronArgs.push("--no-sandbox");
if (process.env.OPENMIND_DEVTOOLS_PORT) {
  electronArgs.push(`--remote-debugging-port=${process.env.OPENMIND_DEVTOOLS_PORT}`);
}
const electron = spawn(electronBinary, electronArgs, {
  stdio: "inherit",
  windowsHide: false,
  env: { ...process.env, OPENMIND_DEV_SERVER_URL: devServerUrl }
});
electron.on("exit", (code) => shutdown(code));
