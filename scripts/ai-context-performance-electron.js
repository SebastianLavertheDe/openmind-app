const fs = require("fs");
const os = require("os");
const path = require("path");
const { app, BrowserWindow } = require("electron");

const appRoot = path.resolve(__dirname, "..");
const fixtureDir = process.env.OPENMIND_AI_CONTEXT_PERF_DIR;
const preload = path.join(__dirname, "visual-snapshot-preload.js");
const reportPath = path.join(appRoot, ".build", "ai-context-performance-report.json");
if (!fixtureDir) throw new Error("OPENMIND_AI_CONTEXT_PERF_DIR is required");

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const percentile = (values, q) => values.slice().sort((a, b) => a - b)[Math.floor((values.length - 1) * q)] || 0;
const temporaryUserData = fs.mkdtempSync(path.join(os.tmpdir(), "openmind-ai-context-performance-"));

app.commandLine.appendSwitch("disable-gpu");
app.commandLine.appendSwitch("no-sandbox");
app.setPath("userData", temporaryUserData);
// 多窗口分阶段运行：销毁上一个窗口不应触发默认的全部窗口关闭即退出。
app.on("window-all-closed", () => {});
app.once("quit", () => {
  try { fs.rmSync(temporaryUserData, { recursive: true, force: true }); } catch { /* best effort */ }
});

// 流式负载：真实 chat 挂载在 AI 侧栏里伴随页面渲染。transient delta 走逐帧
// 泵，durable 事件与 snapshot 推送各自改变对应 context 分片。
const STREAM_CHUNKS = 90;
const STREAM_INTERVAL_MS = 16;
const completionMarker = "AI_CONTEXT_BENCH_COMPLETE";

app.whenReady().then(run).catch((error) => {
  console.error(error);
  app.exit(1);
});

async function run() {
  const phases = [];
  for (const page of ["projects", "creative"]) {
    if (phases.length) await delay(500);
    // 每个阶段独立窗口（与 document-performance 相同的模式）：debugger 在
    // loadFile 之后再 attach，避免跨导航的调试目标语义差异。
    const win = new BrowserWindow({
      width: 1_600,
      height: 1_000,
      show: true,
      backgroundColor: "#f6f7f9",
      webPreferences: { preload, contextIsolation: true, nodeIntegration: false, sandbox: false, backgroundThrottling: false }
    });
    win.webContents.on("console-message", (event) => {
      if (event.level >= 3) console.error(`[renderer:${event.level}] ${event.message} (${event.sourceId}:${event.lineNumber})`);
    });
    win.webContents.on("render-process-gone", (_event, details) => {
      console.error(`AI context performance renderer exited: ${JSON.stringify(details)}`);
      app.exit(1);
    });
    try {
      console.log(`[phase:${page}] loading`);
      await win.loadFile(path.join(fixtureDir, "index.html"), { query: { page } });
      win.webContents.debugger.attach("1.3");
      await win.webContents.debugger.sendCommand("Performance.enable");
      await waitFor(win, "[data-bench-page]");
      console.log(`[phase:${page}] page mounted`);
      await waitForCondition(win, "Boolean(window.benchReady)");
      // 会话历史（29 events）挂载完成后再开始测量。
      await waitFor(win, ".ai-sidebar .completed-process");
      await delay(400);
      console.log(`[phase:${page}] chat history ready`);

      // A broken/no-op counter must fail before testing the zero-render budget.
      const mountedPageCommits = await execute(win, `window.pageRenders[${JSON.stringify(page)}]`);
      if (!(mountedPageCommits > 0)) throw new Error(`${page}: page counter did not observe mounting`);
      await execute(win, "window.controlRenders = 0; window.exerciseRenderCounter()");
      await waitForCondition(win, "window.controlRenders > 0");

      const before = metrics(await win.webContents.debugger.sendCommand("Performance.getMetrics"));
      await installSampler(win);
      await execute(win, `window.pageRenders[${JSON.stringify(page)}] = 0; window.controlRenders = 0`);

      const completed = await measurePhase(win, () => streamBurst(win));
      console.log(`[phase:${page}] stream complete`);
      await delay(300);
      const after = metrics(await win.webContents.debugger.sendCommand("Performance.getMetrics"));
      const sample = await stopSampler(win);
      const pageRenders = await execute(win, `window.pageRenders[${JSON.stringify(page)}]`);
      const controlRenders = await execute(win, "window.controlRenders");
      const phase = {
        page,
        pageRenders,
        controlRenders,
        controlState: await execute(win, "window.controlState"),
        mountedPageCommits,
        longTasks: sample.longTasks.length,
        longTaskTotalMs: round(sample.longTasks.reduce((sum, value) => sum + value, 0)),
        frames: { samples: sample.frames.length, p95Ms: percentile(sample.frames, .95), maxMs: round(Math.max(0, ...sample.frames)) },
        scriptMs: round((after.ScriptDuration - before.ScriptDuration) * 1_000),
        completed
      };
      phases.push(phase);
      console.log(JSON.stringify(phase));
    } finally {
      try { win.webContents.debugger.detach(); } catch { /* not attached */ }
      win.destroy();
    }
  }

  const checks = [
    ...phases.map((phase) => ({ name: `${phase.page} positive control commits`, actual: phase.controlRenders, minimum: 1, passed: phase.controlRenders > 0 })),
    ...phases.map((phase) => ({ name: `${phase.page} durable events delivered`, passed: phase.controlState.eventIds.filter((id) => id.startsWith("ai-context-bench-")).length === 10 })),
    ...phases.map((phase) => ({ name: `${phase.page} page commits during streaming`, actual: phase.pageRenders, maximum: 0, passed: phase.pageRenders === 0 })),
    ...phases.map((phase) => ({ name: `${phase.page} long tasks`, actual: phase.longTasks, maximum: 8, passed: phase.longTasks <= 8 })),
    ...phases.map((phase) => ({ name: `${phase.page} p95 frame interval`, actual: phase.frames.p95Ms, maximum: 50, passed: phase.frames.p95Ms <= 50 }))
  ];
  const report = { generatedAt: new Date().toISOString(), phases, acceptance: { passed: checks.every((check) => check.passed), checks } };
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(report, null, 2));
  if (report.acceptance.passed) app.quit();
  else {
    console.error("AI context performance acceptance budget failed");
    app.exit(1);
  }
}

async function streamBurst(win) {
  let seq = 1_000;
  for (let index = 0; index < STREAM_CHUNKS; index += 1) {
    seq += 1;
    await emitValidatedEvent(win, {
      kind: "transient",
      event: {
        schemaVersion: 1,
        id: `ai-context-bench-delta-${seq}`,
        seq,
        timestamp: new Date().toISOString(),
        projectId: "visual",
        sessionId: "session-2",
        runId: "run-ai-stream",
        provider: "codex",
        kind: "assistant-delta",
        payload: { text: `## Bench update ${index}\n\n- ${"流式伴随渲染 ".repeat(8)}\n\n` },
        risks: []
      }
    });
    if (index % 10 === 9) await emitDurable(win, `ai-context-bench-msg-${index}`, ++seq, "assistant-message", { text: `阶段小结 ${index}：页面伴随流式输出应保持静默。`, phase: "commentary" });
    if (index % 30 === 29) await emitSnapshotPush(win, index);
    await delay(STREAM_INTERVAL_MS);
  }
  await emitDurable(win, "ai-context-bench-complete", ++seq, "assistant-message", {
    text: completionMarker,
    phase: "commentary"
  });
}

async function emitDurable(win, id, seq, kind, payload) {
  await emitValidatedEvent(win, {
    kind: "event",
    event: {
      schemaVersion: 1,
      id,
      seq,
      timestamp: new Date().toISOString(),
      projectId: "visual",
      sessionId: "session-2",
      runId: "run-ai-stream",
      provider: "codex",
      kind,
      payload,
      risks: []
    }
  });
}

async function emitValidatedEvent(win, message) {
  const emitted = await execute(win, `(() => {
    const message = ${JSON.stringify(message)};
    window.validateBenchEvent(message.event);
    return window.openmind.__emitAiEvent(message);
  })()`);
  if (!emitted) throw new Error("AI context performance event bridge is unavailable");
}

async function emitSnapshotPush(win, index) {
  const snapshot = await execute(win, `window.openmind.aiRefresh().then((snapshot) => { snapshot.sessions = snapshot.sessions.map((session) => ({ ...session, updatedAt: new Date(Date.now() + ${index}).toISOString() })); return snapshot; })`);
  const emitted = await execute(win, `window.openmind.__emitAiEvent(${JSON.stringify({ kind: "snapshot", snapshot })})`);
  if (!emitted) throw new Error("AI context performance event bridge is unavailable");
}

async function measurePhase(win, exercise) {
  const startedAt = Date.now();
  await exercise();
  await waitForText(win, completionMarker, 60_000);
  return Date.now() - startedAt;
}

async function installSampler(win) {
  await execute(win, `
    (() => {
      const samples = window.__aiContextPerf = { active: false, lastFrame: 0, frames: [], longTasks: [] };
      const frame = (now) => {
        if (samples.active && samples.lastFrame) samples.frames.push(now - samples.lastFrame);
        if (samples.active) samples.lastFrame = now;
        requestAnimationFrame(frame);
      };
      new PerformanceObserver((list) => {
        if (samples.active) samples.longTasks.push(...list.getEntries().map((entry) => entry.duration));
      }).observe({ type: 'longtask', buffered: false });
      requestAnimationFrame(frame);
    })()
  `);
  await execute(win, `
    (() => {
      const samples = window.__aiContextPerf;
      samples.active = true;
      samples.lastFrame = performance.now();
      samples.frames = [];
      samples.longTasks = [];
    })()
  `);
}

async function stopSampler(win) {
  return execute(win, `
    (() => {
      const samples = window.__aiContextPerf;
      samples.active = false;
      return { frames: samples.frames.filter((value) => value > 0 && value < 1_000), longTasks: samples.longTasks.slice() };
    })()
  `);
}

async function waitForText(win, text, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const found = await execute(win, `document.querySelector('.ai-sidebar')?.textContent?.includes(${JSON.stringify(text)}) || false`);
    if (found) return;
    await delay(50);
  }
  throw new Error(`Timed out waiting for streamed marker: ${text}`);
}

async function execute(win, source) {
  return win.webContents.executeJavaScript(source);
}

async function waitFor(win, selector) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (await execute(win, `Boolean(document.querySelector(${JSON.stringify(selector)}))`)) return;
    await delay(50);
  }
  throw new Error(`Timed out waiting for ${selector}`);
}

async function waitForCondition(win, source) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (await execute(win, source)) return;
    await delay(50);
  }
  throw new Error(`Timed out waiting for condition: ${source}`);
}

function metrics(result) {
  return Object.fromEntries(result.metrics.map((metric) => [metric.name, metric.value]));
}

function round(value) {
  return Math.round(value * 100) / 100;
}
