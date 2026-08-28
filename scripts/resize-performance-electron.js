const fs = require("fs");
const os = require("os");
const path = require("path");
const { app, BrowserWindow } = require("electron");

const appRoot = path.resolve(__dirname, "..");
const rendererIndex = path.join(appRoot, ".build", "renderer", "index.html");
const preload = path.join(__dirname, "visual-snapshot-preload.js");
const reportPath = path.join(appRoot, ".build", "resize-performance-report.json");
const eventCount = Math.max(30, Number(process.env.OPENMIND_RESIZE_PERF_EVENTS) || 1_000);
const startWidth = 2_040;
const endWidth = 1_800;
const resizeStep = 2;
const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const temporaryUserData = fs.mkdtempSync(path.join(os.tmpdir(), "openmind-resize-performance-"));

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
    width: startWidth,
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
    console.error(`Resize performance renderer exited: ${JSON.stringify(details)}`);
    app.exit(1);
  });
  await win.loadFile(rendererIndex);
  win.webContents.debugger.attach("1.3");
  await win.webContents.debugger.sendCommand("Performance.enable");
  win.setSize(startWidth, 1_000);
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
  await waitFor(win, ".completed-process");
  await waitFor(win, ".overflow-box");
  await delay(600);

  const before = metricMap(await win.webContents.debugger.sendCommand("Performance.getMetrics"));
  const fixture = await win.webContents.executeJavaScript(`
    (() => {
      const samples = window.__openmindResizePerf = {
        active: false,
        lastFrame: 0,
        frameIntervals: [],
        resizeEvents: 0,
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
      window.addEventListener('resize', () => {
        if (samples.active) samples.resizeEvents += 1;
      });
      requestAnimationFrame(frame);
      return {
        timelineItems: document.querySelectorAll('.timeline-presence-item').length,
        toolEvents: document.querySelectorAll('.tool-event').length,
        overflowBoxes: document.querySelectorAll('.overflow-box').length,
        nodes: document.getElementsByTagName('*').length
      };
    })()
  `);

  await win.webContents.executeJavaScript(`
    window.__openmindResizePerf.active = true;
    window.__openmindResizePerf.lastFrame = performance.now();
  `);
  for (let width = startWidth; width >= endWidth; width -= resizeStep) {
    win.setSize(width, 1_000);
    await delay(8);
  }
  await delay(250);
  const rendererSamples = await win.webContents.executeJavaScript(`
    (() => {
      const samples = window.__openmindResizePerf;
      samples.active = false;
      return {
        resizeEvents: samples.resizeEvents,
        frameIntervals: samples.frameIntervals,
        longTasks: samples.longTasks,
        finalWidth: window.innerWidth
      };
    })()
  `);
  const after = metricMap(await win.webContents.debugger.sendCommand("Performance.getMetrics"));
  const frameIntervals = rendererSamples.frameIntervals.filter((value) => value > 0 && value < 1_000);
  const report = {
    generatedAt: new Date().toISOString(),
    fixture: { eventCount, ...fixture },
    resize: {
      startWidth,
      endWidth,
      requestedSteps: Math.floor((startWidth - endWidth) / resizeStep) + 1,
      observedEvents: rendererSamples.resizeEvents,
      finalWidth: rendererSamples.finalWidth
    },
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

  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(report, null, 2));
  win.webContents.debugger.detach();
  win.destroy();
  app.quit();
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
