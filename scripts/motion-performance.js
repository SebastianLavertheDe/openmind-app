const { spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

(async () => {
  process.env.NODE_ENV = "production";
  const { build } = await import("vite");
  const incremental = process.argv.includes("--incremental");
  const feedback = process.argv.includes("--feedback");
  const briefEditor = process.argv.includes("--brief-editor");
  const workspace = process.argv.includes("--workspace") || briefEditor;
  const followup = process.argv.includes("--followup");
  // Reuse a saved, pre-change production fixture for an identical runner A/B.
  const reuse = process.env.OPENMIND_MOTION_PERF_REUSE_DIR;
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "openmind-motion-performance-"));
  if (reuse) {
    fs.copyFileSync(path.join(reuse, "index.html"), path.join(directory, "index.html"));
    fs.cpSync(path.join(reuse, "assets"), path.join(directory, "assets"), { recursive: true });
  } else await build({
    configFile: path.join(__dirname, "../vite.config.ts"),
    root: path.join(__dirname, followup ? "fixtures/followup-motion" : workspace ? "fixtures/workspace-motion" : feedback ? "fixtures/feedback-motion" : incremental ? "fixtures/incremental-motion" : "fixtures/motion-performance"),
    ...(incremental || feedback || workspace || followup ? { resolve: { alias: { "react-dom/client": "react-dom/profiling" } } } : {}),
    logLevel: "warn",
    build: { outDir: directory, emptyOutDir: false, chunkSizeWarningLimit: 5000 }
  });
  const env = { ...process.env, OPENMIND_MOTION_PERF_DIR: directory, OPENMIND_MOTION_PERF: "1",
    OPENMIND_BRIEF_EDITOR_ONLY: briefEditor ? "1" : "0",
    OPENMIND_NAVIGATION_PERF: process.argv.includes("--navigation-only") ? "1" : "0",
    OPENMIND_STREAM_PERF: "1", OPENMIND_RESIZE_PERF_EVENTS: "1000", ELECTRON_DISABLE_SECURITY_WARNINGS: "1" };
  delete env.ELECTRON_RUN_AS_NODE;
  const electron = require("electron");
  const useXvfb = process.platform === "linux" && !process.env.DISPLAY;
  const args = ["--no-sandbox", path.join(__dirname, followup ? "followup-motion-electron.js" : workspace ? "workspace-motion-electron.js" : feedback ? "feedback-motion-electron.js" : incremental ? "incremental-motion-electron.js" : "motion-performance-electron.js")];
  const child = spawn(useXvfb ? "xvfb-run" : electron, useXvfb ? ["-a", "-s", "-screen 0 1920x1080x24", electron, ...args] : args, { stdio: "inherit", env });
  child.on("error", error => { console.error(error); process.exitCode = 1; });
  child.on("exit", code => { process.exitCode = code ?? 1; console.log(`Motion artifacts: ${directory}`); });
})().catch(error => { console.error(error); process.exitCode = 1; });
