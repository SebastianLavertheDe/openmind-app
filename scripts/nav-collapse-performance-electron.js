const fs = require("fs");
const os = require("os");
const path = require("path");
const { app, BrowserWindow } = require("electron");

const appRoot = path.resolve(__dirname, "..");
const rendererIndex = path.join(appRoot, ".build", "renderer", "index.html");
const preload = path.join(__dirname, "visual-snapshot-preload.js");
const reportPath = path.join(appRoot, ".build", "nav-collapse-performance-report.json");
const eventCount = Math.max(30, Number(process.env.OPENMIND_RESIZE_PERF_EVENTS) || 10_000);
const interactionCount = 12;
const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const temporaryUserData = fs.mkdtempSync(path.join(os.tmpdir(), "openmind-nav-collapse-performance-"));

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
    width: 2_040,
    height: 1_000,
    show: true,
    backgroundColor: "#f6f7f9",
    webPreferences: {
      preload,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      backgroundThrottling: false,
      additionalArguments: ["--openmind-nav-collapse-perf"]
    }
  });
  win.webContents.on("console-message", (event) => {
    if (event.level >= 2) console.error(`[renderer:${event.level}] ${event.message} (${event.sourceId}:${event.lineNumber})`);
  });
  win.webContents.on("render-process-gone", (_event, details) => {
    console.error(`Navigation performance renderer exited: ${JSON.stringify(details)}`);
    app.exit(1);
  });

  await win.loadFile(rendererIndex);
  win.webContents.debugger.attach("1.3");
  await win.webContents.debugger.sendCommand("Performance.enable");
  await waitFor(win, ".app-shell");
  await prepareHeavyThreePaneFixture(win);

  const fixture = await win.webContents.executeJavaScript(`
    (() => ({
      nodes: document.getElementsByTagName('*').length,
      timelineItems: document.querySelectorAll('.timeline-presence-item').length,
      toolEvents: document.querySelectorAll('.tool-event').length,
      markdownBlocks: document.querySelectorAll('.markdown-body, .document-content-view').length,
      documentHeadings: document.querySelectorAll('.document-content-view h2').length,
      documentCharacters: document.querySelector('.document-content-view')?.textContent?.length || 0,
      initialNavWidth: Math.round(document.querySelector('.app-nav').getBoundingClientRect().width),
      shellClasses: document.querySelector('.app-shell').className
    }))()
  `);

  // Warm both directions so lazy styles, icons, and layout branches do not
  // contaminate the recorded interactions.
  await toggleAndMeasure(win);
  await toggleAndMeasure(win);
  await delay(250);

  await win.webContents.executeJavaScript(`
    (() => {
      const samples = window.__openmindNavPerf = {
        active: false,
        lastFrame: 0,
        frameIntervals: [],
        longTasks: [],
        lastViewTransition: null
      };
      if (typeof document.startViewTransition === 'function') {
        const startViewTransition = document.startViewTransition.bind(document);
        document.startViewTransition = (update) => {
          const transition = startViewTransition(update);
          samples.lastViewTransition = transition;
          return transition;
        };
      }
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

  const before = metricMap(await win.webContents.debugger.sendCommand("Performance.getMetrics"));
  await win.webContents.executeJavaScript(`
    window.__openmindNavPerf.active = true;
    window.__openmindNavPerf.lastFrame = performance.now();
  `);
  const interactions = [];
  for (let index = 0; index < interactionCount; index += 1) {
    interactions.push(await toggleAndMeasure(win));
    await delay(80);
  }
  const rendererSamples = await win.webContents.executeJavaScript(`
    (() => {
      const samples = window.__openmindNavPerf;
      samples.active = false;
      return { frameIntervals: samples.frameIntervals, longTasks: samples.longTasks };
    })()
  `);
  const after = metricMap(await win.webContents.debugger.sendCommand("Performance.getMetrics"));

  const frameIntervals = rendererSamples.frameIntervals.filter((value) => value > 0 && value < 1_000);
  const durations = interactions.map((item) => item.durationMs);
  const report = {
    generatedAt: new Date().toISOString(),
    fixture: { eventCount, ...fixture },
    interactions: {
      count: interactionCount,
      p50DurationMs: percentile(durations, .5),
      p95DurationMs: percentile(durations, .95),
      minIntermediateWidths: Math.min(...interactions.map((item) => item.intermediateWidths)),
      maxIntermediateWidths: Math.max(...interactions.map((item) => item.intermediateWidths)),
      samples: interactions
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

async function prepareHeavyThreePaneFixture(win) {
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
  await clickButtonContaining(win, "每日简报");
  await waitFor(win, ".brief-library-page");
  await waitFor(win, ".document-detail-body");
  await waitFor(win, ".ai-sidebar");
  await delay(600);
}

async function toggleAndMeasure(win) {
  return win.webContents.executeJavaScript(`
    (() => new Promise((resolve, reject) => {
      const nav = document.querySelector('.app-nav');
      const button = document.querySelector('.nav-collapse-button');
      if (!nav || !button) return reject(new Error('Navigation collapse controls are unavailable'));
      const startWidth = nav.getBoundingClientRect().width;
      const targetWidth = startWidth > 100 ? 60 : 260;
      const startedAt = performance.now();
      const widths = [];
      let motionFrames = 0;
      let stableFrames = 0;
      let previousWidth = startWidth;
      if (window.__openmindNavPerf) window.__openmindNavPerf.lastViewTransition = null;
      button.click();
      const sample = () => {
        const width = nav.getBoundingClientRect().width;
        widths.push(width);
        const transition = window.__openmindNavPerf?.lastViewTransition;
        const transitionRunning = Boolean(transition)
          && document.getAnimations().some((animation) => animation.playState === 'running');
        if (transitionRunning) motionFrames += 1;
        if (Math.abs(width - targetWidth) < .5 && Math.abs(width - previousWidth) < .1) stableFrames += 1;
        else stableFrames = 0;
        previousWidth = width;
        const transitionFinished = !transition || !transitionRunning;
        if ((stableFrames >= 3 && transitionFinished) || performance.now() - startedAt > 800) {
          const unique = new Set(widths.map((value) => Math.round(value * 10) / 10));
          unique.delete(Math.round(startWidth * 10) / 10);
          unique.delete(targetWidth);
          resolve({
            from: Math.round(startWidth),
            to: Math.round(width),
            durationMs: Math.round((performance.now() - startedAt) * 100) / 100,
            sampledFrames: widths.length,
            intermediateWidths: unique.size,
            compositorMotionFrames: motionFrames
          });
          return;
        }
        requestAnimationFrame(sample);
      };
      requestAnimationFrame(sample);
    }))()
  `);
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
