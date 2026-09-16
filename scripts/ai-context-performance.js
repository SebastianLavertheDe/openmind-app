const { spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const ts = require("typescript");

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
    // Instrument the real page owners in this fixture build only. Ordinary
    // production Profiler callbacks are disabled; a layout effect observes each
    // committed page update, including updates triggered by the page's hooks.
    plugins: [{
      name: "benchmark-page-commits", enforce: "pre",
      transform(code, id) {
        const normalized = id.replaceAll("\\", "/");
        const page = normalized.endsWith("/features/creative/CreativePage.tsx") ? "creative"
          : normalized.endsWith("/features/projects/ProjectsPage.tsx") ? "projects" : null;
        if (!page) return;
        const name = page === "creative" ? "CreativeWorkspacePage" : "ProjectsPage";
        const source = ts.createSourceFile(id, code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
        const declaration = source.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === name);
        if (!declaration?.body) throw new Error(`Missing benchmark page function: ${name}`);
        const offset = declaration.body.getStart(source) + 1;
        return `import { useLayoutEffect as __benchCommitEffect } from "react";\n${code.slice(0, offset)}\n` +
          `__benchCommitEffect(() => { (window as any).__recordBenchCommit(${JSON.stringify(page)}); });\n` + code.slice(offset);
      }
    }],
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
