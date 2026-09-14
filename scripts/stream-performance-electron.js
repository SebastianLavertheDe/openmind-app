const fs = require("fs");
const os = require("os");
const path = require("path");
const { app, BrowserWindow } = require("electron");

const appRoot = path.resolve(__dirname, "..");
const rendererIndex = path.join(appRoot, ".build", "renderer", "index.html");
const preload = path.join(__dirname, "visual-snapshot-preload.js");
const reportPath = path.join(appRoot, ".build", "stream-performance-report.json");
const eventCount = Math.max(30, Number(process.env.OPENMIND_RESIZE_PERF_EVENTS) || 1_000);
const commentaryChars = Math.max(4_096, Number(process.env.OPENMIND_STREAM_PERF_CHARS) || 49_152);
const reasoningChars = Math.max(4_096, Number(process.env.OPENMIND_REASONING_PERF_CHARS) || 24_576);
// 长输出超过 8KiB 后渲染层走虚拟 DocumentReader，尾块不会挂载进 DOM，因此
// 尾部文本无法作为等待信号。改等 durable 完成事件：事件泵会把 durable
// assistant-message 排到 transient 缓冲完全排空之后，reasoning-summary 则
// 与最后一批 delta 同一帧提交。marker 出现 == 整段流式内容已被渲染层处理。
const commentaryDoneMarker = "COMMENTARY_STREAM_DRAIN_COMPLETE";
const reasoningDoneMarker = "REASONING_STREAM_DRAIN_COMPLETE";
const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const temporaryUserData = fs.mkdtempSync(path.join(os.tmpdir(), "openmind-stream-performance-"));

app.commandLine.appendSwitch("disable-gpu");
app.commandLine.appendSwitch("no-sandbox");
app.setPath("userData", temporaryUserData);
app.once("quit", () => {
  try { fs.rmSync(temporaryUserData, { recursive: true, force: true }); } catch { /* best effort */ }
});

app.whenReady().then(run).catch((error) => {
  console.error(error);
  app.exit(1);
});

async function run() {
  const win = new BrowserWindow({
    width: 1_440,
    height: 1_000,
    show: true,
    backgroundColor: "#f6f7f9",
    webPreferences: {
      preload,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      backgroundThrottling: false
    }
  });
  win.webContents.on("console-message", (event) => {
    if (event.level >= 2) console.error(`[renderer:${event.level}] ${event.message} (${event.sourceId}:${event.lineNumber})`);
  });
  win.webContents.on("render-process-gone", (_event, details) => {
    console.error(`Stream performance renderer exited: ${JSON.stringify(details)}`);
    app.exit(1);
  });
  await win.loadFile(rendererIndex);
  win.webContents.debugger.attach("1.3");
  await win.webContents.debugger.sendCommand("Performance.enable");
  await waitFor(win, ".app-shell");
  await clickButtonContaining(win, "新建任务");
  await waitFor(win, "button.history-toggle");
  await win.webContents.executeJavaScript("document.querySelector('button.history-toggle')?.click()");
  await waitFor(win, ".history-flyout");
  await win.webContents.executeJavaScript(`
    (() => {
      const session = [...document.querySelectorAll('article.nav-recent-item[role="option"]')]
        .find((item) => item.textContent?.includes('10000 events'));
      if (!session) throw new Error('Long-session performance fixture was not found');
      session.click();
    })()
  `);
  await waitFor(win, ".completed-process.processing");
  await revealLongHistory(win);
  await delay(600);

  const fixtureCollapsed = await domFixture(win);
  await openCompletedHistory(win);
  await waitFor(win, ".completed-process:not(.processing) .command-group");
  await openCompletedToolGroup(win);
  await waitFor(win, ".completed-process:not(.processing) .tool-event");
  await delay(300);
  const fixtureExpanded = await domFixture(win);
  await installRendererSampler(win);
  const commentaryText = markdownText(commentaryChars, "Commentary");
  const commentary = await measurePhase(win, "commentary", async () => {
    await emitEvent(win, "assistant-delta", commentaryText, 2);
    // durable marker：事件泵在 transient 缓冲排空后才追加 durable 消息，
    // 因此它在 DOM 出现即代表完整 commentary 已流过渲染层。
    await emitDurableEvent(win, "stream-perf-commentary-done", 3, "assistant-message", {
      text: commentaryDoneMarker,
      phase: "commentary"
    });
    await waitForText(win, commentaryDoneMarker, 60_000);
  });
  const reasoningText = markdownText(reasoningChars, "Reasoning");
  const reasoningChunkCount = Math.ceil(reasoningText.length / 512);
  const reasoning = await measurePhase(win, "reasoning", async () => {
    await emitReasoningChunks(win, reasoningText, 512, 24);
    await emitDurableEvent(win, "stream-perf-reasoning-done", 4 + reasoningChunkCount, "reasoning-summary", {
      text: reasoningDoneMarker
    });
    await waitForText(win, reasoningDoneMarker, 60_000);
  });
  const fixtureAfter = await domFixture(win);
  const checks = [
    budget("collapsed history tool DOM", fixtureCollapsed.toolEvents, 0),
    budget("collapsed history total DOM", fixtureCollapsed.nodes, 1_500),
    budget("commentary p95 frame interval", commentary.frames.p95Ms, 25),
    budget("commentary max frame interval", commentary.frames.maxMs, 100),
    budget("commentary long tasks", commentary.frames.longTasks, 3),
    budget("commentary renderer task time", commentary.renderer.taskMs, 1_500),
    budget("reasoning p95 frame interval", reasoning.frames.p95Ms, 25),
    budget("reasoning max frame interval", reasoning.frames.maxMs, 100),
    budget("reasoning long tasks", reasoning.frames.longTasks, 3),
    budget("reasoning renderer task time", reasoning.renderer.taskMs, 900)
  ];

  const report = {
    generatedAt: new Date().toISOString(),
    fixture: {
      eventCount,
      commentaryChars,
      reasoningChars,
      collapsed: fixtureCollapsed,
      expanded: fixtureExpanded,
      after: fixtureAfter
    },
    phases: { commentary, reasoning },
    acceptance: {
      passed: checks.every((check) => check.passed),
      checks
    }
  };
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(report, null, 2));
  win.webContents.debugger.detach();
  win.destroy();
  if (report.acceptance.passed) app.quit();
  else {
    console.error("Stream performance acceptance budget failed");
    app.exit(1);
  }
}

function budget(name, actual, maximum) {
  return { name, actual, maximum, passed: actual <= maximum };
}

async function revealLongHistory(win) {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const hasCompletedHistory = await win.webContents.executeJavaScript("Boolean(document.querySelector('.completed-process:not(.processing)'))");
    if (hasCompletedHistory) return;
    const clicked = await win.webContents.executeJavaScript(`
      (() => {
        const button = document.querySelector('button.load-history');
        button?.click();
        return Boolean(button);
      })()
    `);
    if (!clicked) break;
    await delay(100);
  }
  throw new Error("Long completed history could not be revealed");
}

async function openCompletedHistory(win) {
  const opened = await win.webContents.executeJavaScript(`
    (() => {
      const process = document.querySelector('.completed-process:not(.processing)');
      const trigger = process?.querySelector(':scope > .ui-disclosure-trigger');
      if (!trigger) return false;
      if (trigger.getAttribute('aria-expanded') !== 'true') trigger.click();
      return true;
    })()
  `);
  if (!opened) throw new Error("Completed history disclosure was not found");
}

async function openCompletedToolGroup(win) {
  const opened = await win.webContents.executeJavaScript(`
    (() => {
      const process = document.querySelector('.completed-process:not(.processing)');
      const group = process?.querySelector('.command-group');
      const trigger = group?.querySelector(':scope > .ui-disclosure-trigger');
      if (!trigger) return false;
      if (trigger.getAttribute('aria-expanded') !== 'true') trigger.click();
      return true;
    })()
  `);
  if (!opened) throw new Error("Completed history tool-group disclosure was not found");
}

async function installRendererSampler(win) {
  await win.webContents.executeJavaScript(`
    (() => {
      const samples = window.__openmindStreamPerf = {
        active: false,
        lastFrame: 0,
        frameIntervals: [],
        longTasks: []
      };
      const frame = (now) => {
        if (samples.active && samples.lastFrame) samples.frameIntervals.push(now - samples.lastFrame);
        if (samples.active) samples.lastFrame = now;
        requestAnimationFrame(frame);
      };
      new PerformanceObserver((list) => {
        if (samples.active) samples.longTasks.push(...list.getEntries().map((entry) => entry.duration));
      }).observe({ type: 'longtask', buffered: false });
      requestAnimationFrame(frame);
    })()
  `);
}

async function measurePhase(win, name, exercise) {
  const before = metricMap(await win.webContents.debugger.sendCommand("Performance.getMetrics"));
  await win.webContents.executeJavaScript(`
    (() => {
      const samples = window.__openmindStreamPerf;
      samples.active = true;
      samples.lastFrame = performance.now();
      samples.frameIntervals = [];
      samples.longTasks = [];
    })()
  `);
  const startedAt = Date.now();
  await exercise();
  await delay(300);
  const wallMs = Date.now() - startedAt;
  const rendererSamples = await win.webContents.executeJavaScript(`
    (() => {
      const samples = window.__openmindStreamPerf;
      samples.active = false;
      return {
        frameIntervals: samples.frameIntervals.slice(),
        longTasks: samples.longTasks.slice()
      };
    })()
  `);
  const after = metricMap(await win.webContents.debugger.sendCommand("Performance.getMetrics"));
  const frameIntervals = rendererSamples.frameIntervals.filter((value) => value > 0 && value < 1_000);
  return {
    name,
    wallMs,
    frames: {
      samples: frameIntervals.length,
      p50Ms: percentile(frameIntervals, .5),
      p95Ms: percentile(frameIntervals, .95),
      maxMs: round(Math.max(0, ...frameIntervals)),
      over20Ms: frameIntervals.filter((value) => value > 20).length,
      longTasks: rendererSamples.longTasks.length,
      longTaskTotalMs: round(rendererSamples.longTasks.reduce((sum, value) => sum + value, 0))
    },
    renderer: metricDelta(before, after)
  };
}

async function emitEvent(win, kind, text, seq) {
  const message = {
    kind: "transient",
    event: streamEvent(`stream-perf-${kind}-${seq}`, seq, kind, text)
  };
  const emitted = await win.webContents.executeJavaScript(`window.openmind.__emitAiEvent(${JSON.stringify(message)})`);
  if (!emitted) throw new Error("Stream performance event bridge is unavailable");
}

/** durable 事件：进入会话时间线并渲染，作为流式阶段的完成信号。 */
async function emitDurableEvent(win, id, seq, kind, payload) {
  const message = {
    kind: "event",
    event: { ...streamEvent(id, seq, kind, ""), payload }
  };
  const emitted = await win.webContents.executeJavaScript(`window.openmind.__emitAiEvent(${JSON.stringify(message)})`);
  if (!emitted) throw new Error("Stream performance event bridge is unavailable");
}

async function emitReasoningChunks(win, text, chunkSize, intervalMs) {
  const chunks = [];
  for (let index = 0; index < text.length; index += chunkSize) chunks.push(text.slice(index, index + chunkSize));
  await win.webContents.executeJavaScript(`
    new Promise((resolve, reject) => {
      const chunks = ${JSON.stringify(chunks)};
      let index = 0;
      const emit = () => {
        if (index >= chunks.length) { resolve(true); return; }
        const seq = index + 4;
        const emitted = window.openmind.__emitAiEvent({
          kind: 'transient',
          event: {
            schemaVersion: 1,
            id: 'stream-perf-reasoning-' + seq,
            seq,
            timestamp: ${JSON.stringify(new Date().toISOString())},
            projectId: 'visual',
            sessionId: 'session-2',
            runId: 'run-ai-stream',
            provider: 'codex',
            kind: 'reasoning-delta',
            payload: { text: chunks[index] },
            risks: []
          }
        });
        if (!emitted) { reject(new Error('Stream performance event bridge is unavailable')); return; }
        index += 1;
        setTimeout(emit, ${intervalMs});
      };
      emit();
    })
  `);
}

function streamEvent(id, seq, kind, text) {
  return {
    schemaVersion: 1,
    id,
    seq,
    timestamp: new Date().toISOString(),
    projectId: "visual",
    sessionId: "session-2",
    runId: "run-ai-stream",
    provider: "codex",
    kind,
    payload: { text },
    risks: []
  };
}

function markdownText(characters, title) {
  const unit = `## ${title} update\n\n- parsed Markdown content\n- **live text** remains readable\n\n`;
  return unit.repeat(Math.ceil(characters / unit.length)).slice(0, characters);
}

async function domFixture(win) {
  return win.webContents.executeJavaScript(`({
    timelineItems: document.querySelectorAll('.timeline-presence-item').length,
    toolEvents: document.querySelectorAll('.tool-event').length,
    overflowBoxes: document.querySelectorAll('.overflow-box').length,
    nodes: document.getElementsByTagName('*').length
  })`);
}

async function waitFor(win, selector) {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    const found = await win.webContents.executeJavaScript(`Boolean(document.querySelector(${JSON.stringify(selector)}))`);
    if (found) return;
    await delay(50);
  }
  throw new Error(`Timed out waiting for ${selector}`);
}

/** 等待 durable 完成事件的 marker 出现在进行中 process 块的已挂载 DOM 里。 */
async function waitForText(win, text, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const found = await win.webContents.executeJavaScript(`document.querySelector('.completed-process.processing')?.textContent?.includes(${JSON.stringify(text)}) || false`);
    if (found) return;
    await delay(50);
  }
  throw new Error(`Timed out waiting for streamed text: ${text}`);
}

async function clickButtonContaining(win, label) {
  const clicked = await win.webContents.executeJavaScript(`
    (() => {
      const button = [...document.querySelectorAll('button')]
        .find((item) => item.textContent?.trim().includes(${JSON.stringify(label)}));
      button?.click();
      return Boolean(button);
    })()
  `);
  if (!clicked) throw new Error(`Button was not found: ${label}`);
}

function metricMap(result) {
  return Object.fromEntries(result.metrics.map((metric) => [metric.name, metric.value]));
}

function metricDelta(before, after) {
  const duration = (name) => round(((after[name] || 0) - (before[name] || 0)) * 1_000);
  const count = (name) => Math.round((after[name] || 0) - (before[name] || 0));
  return {
    taskMs: duration("TaskDuration"),
    scriptMs: duration("ScriptDuration"),
    layoutMs: duration("LayoutDuration"),
    styleMs: duration("RecalcStyleDuration"),
    layoutCount: count("LayoutCount"),
    styleCount: count("RecalcStyleCount"),
    heapDeltaBytes: Math.round((after.JSHeapUsedSize || 0) - (before.JSHeapUsedSize || 0))
  };
}

function percentile(values, quantile) {
  if (!values.length) return 0;
  const ordered = values.slice().sort((a, b) => a - b);
  return round(ordered[Math.floor((ordered.length - 1) * quantile)]);
}

function round(value) {
  return Math.round(value * 100) / 100;
}
