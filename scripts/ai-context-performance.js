const { spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

// AI Context 分片基准：真实 Projects/Creative 页面 + 真实 AI 侧栏伴随流式输出。
// 构建产物在 checkout 之外的临时目录（与 document-performance 同款流程），
// 通过 visual fixture 预载 API 驱动，绝不触碰真实用户数据。
(async () => {
  process.env.NODE_ENV = "production";
  const { build } = await import("vite");
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "openmind-ai-context-performance-"));
  await build({
    configFile: false, root: path.join(__dirname, "fixtures/ai-context-performance"), base: "./",
    resolve: { alias: { "@shared": path.resolve(__dirname, "../shared") } },
    define: { "process.env.NODE_ENV": '"production"' },
    esbuild: { jsx: "automatic", jsxDev: false },
    worker: { format: "es", plugins: () => [{ name: "dom-free-document-parsing", enforce: "pre", resolveId: id =>
      id === "decode-named-character-reference" || id === "hast-util-from-html-isomorphic" ? require.resolve(id) : undefined
    }] }, logLevel: "warn",
    build: { outDir: temporary, emptyOutDir: false, chunkSizeWarningLimit: 5000 }
  });
  const env = { ...process.env, OPENMIND_AI_CONTEXT_PERF_DIR: temporary, OPENMIND_STREAM_PERF: "1", ELECTRON_DISABLE_SECURITY_WARNINGS: "1" };
  delete env.ELECTRON_RUN_AS_NODE;
  const electron = require("electron");
  const useXvfb = process.platform === "linux" && !process.env.DISPLAY;
  const args = ["--no-sandbox", path.join(__dirname, "ai-context-performance-electron.js")];
  const child = spawn(useXvfb ? "xvfb-run" : electron, useXvfb ? ["-a", electron, ...args] : args, { stdio: "inherit", env });
  child.on("error", error => { console.error(error); process.exitCode = 1; });
  child.on("exit", code => { process.exitCode = code || 0; console.log(`Performance artifacts: ${temporary}`); });
})().catch(error => { console.error(error); process.exitCode = 1; });
