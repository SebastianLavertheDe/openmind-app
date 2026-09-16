const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { app, BrowserWindow } = require("electron");
const { checkNavigationMotion, checkNavigationCompanion } = require("./navigation-motion-qa");

const directory = process.env.OPENMIND_MOTION_PERF_DIR;
const navigationOnly = process.env.OPENMIND_NAVIGATION_PERF === "1";
const appRoot = path.resolve(__dirname, "..");
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "openmind-motion-profile-"));
app.setPath("userData", profile);
app.commandLine.appendSwitch("disable-gpu");
app.commandLine.appendSwitch("no-sandbox");
app.once("quit", () => fs.rmSync(profile, { recursive: true, force: true }));
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const round = value => Math.round(value * 100) / 100;
const report = { environment: { gpuDisabled: true, syntheticData: true }, phases: [], checks: [] };
let win;
const js = code => win.webContents.executeJavaScript(code);
const cdp = (method, params = {}) => win.webContents.debugger.sendCommand(method, params);
const watchdog = setTimeout(() => { console.error("Motion performance timed out"); app.exit(1); }, 120_000);

function saveReport() {
  fs.writeFileSync(path.join(directory, "report.json"), JSON.stringify(report, null, 2));
  fs.mkdirSync(path.join(appRoot, ".build"), { recursive: true });
  fs.writeFileSync(path.join(appRoot, navigationOnly ? ".build/navigation-performance-report.json" : ".build/motion-performance-report.json"), JSON.stringify(report, null, 2));
}
function check(name, actual, maximum) {
  report.checks.push({ name, actual, maximum, passed: actual <= maximum });
}
function finish() {
  report.acceptance = report.checks.every(c => c.passed);
  saveReport();
  console.log(JSON.stringify({ acceptance: report.acceptance, checks: report.checks }, null, 2));
  win.destroy();
  clearTimeout(watchdog);
  if (report.acceptance) app.quit(); else app.exit(1);
}
async function until(code) {
  for (let i = 0; i < 300; i++) { if (await js(code)) return; await delay(50); }
  throw new Error(`Timed out waiting for ${code}`);
}
async function metrics() {
  return Object.fromEntries((await cdp("Performance.getMetrics")).metrics.map(m => [m.name, m.value]));
}
async function installSampler() {
  await js(`(() => {
    const s = window.motionSamples = {active:false,frames:[],tasks:[],last:0,paneAnimations:0,themeSeen:false,themeAnimated:false,navigationAnimated:false,navWidths:[],workspaceWidths:[]};
    const animate = Element.prototype.animate;
    Element.prototype.animate = function(...args) {
      if(s.active && this.classList.contains('conversation-pane')) s.paneAnimations++;
      return animate.apply(this,args);
    };
    const tick = now => {
      if(s.active) {
        if(s.last) s.frames.push(now-s.last);
        s.last=now;
        s.themeSeen ||= document.documentElement.classList.contains('theme-transitioning');
        if (s.themeSeen && !s.themeAnimated) s.themeAnimated = document.getAnimations().some(a =>
          a.playState === 'running' && a.animationName?.includes('view-transition'));
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    // Observe delivered sizes without forcing layout in the timing sampler.
    const sizes = new ResizeObserver(entries => {
      if(!s.active || !s.probeNavigation) return;
      for(const entry of entries) {
        const target=entry.target.classList.contains('app-nav') ? s.navWidths : s.workspaceWidths;
        target.push(Math.round(entry.borderBoxSize[0].inlineSize*100)/100);
      }
    });
    document.querySelectorAll('.app-nav,.app-stage').forEach(el=>sizes.observe(el));
    document.addEventListener('transitionrun',e=>{
      if(s.active && s.probeNavigation && e.target.classList.contains('app-shell') && e.propertyName==='grid-template-columns') s.navigationAnimated=true;
    });
    new PerformanceObserver(list => { if(s.active) s.tasks.push(...list.getEntries().map(e=>e.duration)); }).observe({type:'longtask'});
  })()`);
}
async function measure(name, action, duration = 650, trace = false) {
  const events = [];
  const handler = (_event, method, params) => { if (method === "Tracing.dataCollected") events.push(...params.value); };
  if (trace) {
    win.webContents.debugger.on("message", handler);
    await cdp("Tracing.start", { categories: "devtools.timeline,cc", transferMode: "ReportEvents" });
  }
  const before = await metrics();
  await js("Object.assign(window.motionSamples,{active:true,frames:[],tasks:[],last:performance.now(),paneAnimations:0,themeSeen:false,themeAnimated:false,navigationAnimated:false,navWidths:[],workspaceWidths:[]})");
  await js(action);
  await delay(duration);
  const samples = await js("window.motionSamples.active=false;({...window.motionSamples})");
  const after = await metrics();
  if (trace) {
    const done = new Promise(resolve => {
      const complete = (_event, method) => {
        if (method !== "Tracing.tracingComplete") return;
        win.webContents.debugger.removeListener("message", complete);
        resolve();
      };
      win.webContents.debugger.on("message", complete);
    });
    await cdp("Tracing.end");
    await done;
    win.webContents.debugger.removeListener("message", handler);
  }
  const frames = samples.frames.sort((a, b) => a - b);
  const phase = { name, p95Ms: round(frames[Math.floor(frames.length * .95)] || 0), maxMs: round(Math.max(0, ...frames)),
    longTasks: samples.tasks, paneAnimations: samples.paneAnimations, themeSeen: samples.themeSeen, themeAnimated: samples.themeAnimated, renderer: {} };
  for (const key of ["TaskDuration", "ScriptDuration", "LayoutDuration", "RecalcStyleDuration", "LayoutCount"]) {
    phase.renderer[key] = round((after[key] - before[key]) * (key.endsWith("Duration") ? 1000 : 1));
  }
  if (samples.probeNavigation) Object.assign(phase, {
    navigationAnimated: samples.navigationAnimated,
    liveNavWidths: [...new Set(samples.navWidths)],
    liveWorkspaceWidths: [...new Set(samples.workspaceWidths)]
  });
  if (trace) phase.paintEvents = events.filter(e => e.name === "Paint" && e.ph === "X").length;
  report.phases.push(phase);
  console.log(JSON.stringify(phase));
  saveReport();
  return phase;
}

app.whenReady().then(async () => {
  win = new BrowserWindow({ width: 1440, height: 1000, show: true, webPreferences: {
    preload: path.join(__dirname, "visual-snapshot-preload.js"), contextIsolation: true, nodeIntegration: false,
    sandbox: false, backgroundThrottling: false
  } });
  win.webContents.on("console-message", e => { if (e.level >= 3) console.error(e.message); });
  await win.loadFile(path.join(directory, "index.html"));
  win.webContents.debugger.attach("1.3");
  await cdp("Performance.enable");
  await until("Boolean(document.querySelector('.app-shell') && window.motionPerf)");
  await js("[...document.querySelectorAll('button')].find(b=>b.textContent.includes('新建任务')).click()");
  await until("Boolean(document.querySelector('button.history-toggle'))");
  await js("document.querySelector('button.history-toggle').click()");
  await until("Boolean(document.querySelector('.history-flyout'))");
  await js(`[...document.querySelectorAll('article.nav-recent-item[role="option"]')].find(b=>b.textContent.includes('10000 events')).click()`);
  await until("Boolean(document.querySelector('.chat-thread'))");
  for (let i = 0; i < 8 && !await js("Boolean(document.querySelector('.local-file-link'))"); i++) {
    await js("document.querySelector('button.load-history')?.click()");
    await delay(150);
  }
  await until("Boolean(document.querySelector('.local-file-link'))");
  await delay(600);
  await installSampler();
  report.environment.nodes = await js("document.querySelectorAll('*').length");
  report.environment.viewport = await js("({width:innerWidth,height:innerHeight})");
  report.environment.reducedMotion = await js("matchMedia('(prefers-reduced-motion: reduce)').matches");
  assert.equal(report.environment.reducedMotion, false, "Performance must be measured with animations enabled");

  for (let i = 0; i < 3; i++) {
    const opened = await measure(`preview-open-${i}`, "[...document.querySelectorAll('.local-file-link')].find(a=>a.textContent.includes('motion-review')).click()");
    await until("Boolean(document.querySelector('.ai-file-preview .document-reader'))");
    assert(opened.paneAnimations > 0, "Opening must retain the conversation glide");
    check(`preview open ${i} layouts`, opened.renderer.LayoutCount, 30);
    if (i === 0) fs.writeFileSync(path.join(directory, "preview.png"), (await win.webContents.capturePage()).toPNG());
    if (i === 0 && navigationOnly) {
      await delay(400);
      await checkNavigationMotion({ win, directory, js, cdp, measure, until, check, delay });
      await checkNavigationCompanion({ win, directory, js, measure, until, check, delay });
      finish();
      return;
    }
    const closed = await measure(`preview-close-${i}`, `document.querySelector('.ai-file-preview header button[aria-label="关闭文件预览"]').click()`);
    assert(closed.paneAnimations > 0, "Closing must retain the conversation glide");
    check(`preview close ${i} layouts`, closed.renderer.LayoutCount, 15);
    check(`preview close ${i} max frame`, closed.maxMs, 100);
  }
  // Inspect real intermediate animation frames outside the timed samples.
  for (const opening of [true, false]) {
    await js(opening
      ? "[...document.querySelectorAll('.local-file-link')].find(a=>a.textContent.includes('motion-review')).click()"
      : `document.querySelector('.ai-file-preview header button[aria-label="关闭文件预览"]').click()`);
    await until("document.querySelector('.conversation-pane').getAnimations().some(a=>a.playState==='running')");
    await until("document.querySelector('.ai-file-preview').getAnimations().some(a=>a.playState==='running')");
    await js(`document.querySelectorAll('.conversation-pane, .ai-file-preview, .ai-workbench > .column-splitter').forEach(el =>
      el.getAnimations().forEach(a => { a.pause(); a.currentTime = 80; }))`);
    await js("new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))");
    fs.writeFileSync(path.join(directory, `preview-${opening ? "opening" : "closing"}.png`), (await win.webContents.capturePage()).toPNG());
    await js(`document.querySelectorAll('.conversation-pane, .ai-file-preview, .ai-workbench > .column-splitter').forEach(el =>
      el.getAnimations().forEach(a => a.play()))`);
    await delay(400);
  }
  for (const theme of ["dark", "light", "dark"]) {
    const phase = await measure(`theme-${theme}`, `window.motionPerf.theme('${theme}')`, 650);
    assert(phase.themeAnimated, "Theme changes must retain a running snapshot crossfade");
    assert.equal(await js("document.documentElement.dataset.theme"), theme);
    check(`theme ${theme} style ms`, phase.renderer.RecalcStyleDuration, 200);
    check(`theme ${theme} max frame`, phase.maxMs, 150);
  }
  fs.writeFileSync(path.join(directory, "theme.png"), (await win.webContents.capturePage()).toPNG());

  await measure("completed-process-open", "[...document.querySelectorAll('.completed-process:not(.processing) > button')].at(-1).click()", 800);
  const largest = `[...document.querySelectorAll('.command-group > button')].sort((a,b)=>Math.max(0,...(b.textContent.match(/\\d+/g)||[]).map(Number))-Math.max(0,...(a.textContent.match(/\\d+/g)||[]).map(Number)))[0]`;
  await js(`${largest}.scrollIntoView({block:'center'})`);
  await delay(200);
  const opened = await measure("large-group-open", `${largest}.click()`, 900);
  const mounted = await js("document.querySelectorAll('.tool-event').length");
  check("large group mounted cards", mounted, 35);
  check("large group open max frame", opened.maxMs, 100);
  await js(`document.querySelector('.command-group-list.is-virtual').dispatchEvent(new KeyboardEvent('keydown',{key:'End',bubbles:true}))`);
  await until("document.activeElement?.closest('[data-command-index]')?.getAttribute('data-command-index') === '484'");
  assert(await js("document.querySelector('.command-group-list.is-virtual').scrollTop > 0"), "The final command must be reachable");
  await js("document.activeElement.click()");
  await delay(250);
  assert(await js("Boolean(document.querySelector('[data-command-index=\"484\"] .tool-event-body'))"), "Offscreen command output must expand");
  await js(`document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'Home',bubbles:true}))`);
  await until("document.activeElement?.closest('[data-command-index]')?.getAttribute('data-command-index') === '0'");
  assert(await js("Boolean(document.querySelector('[data-command-index=\"484\"] .tool-event-body'))"), "Expanded output must survive scrolling");
  const closed = await measure("large-group-close", `${largest}.click()`, 900);
  check("large group close max frame", closed.maxMs, 100);
  assert.equal(await js("document.querySelectorAll('.command-group-list.is-virtual').length"), 0);

  const css = fs.readdirSync(path.join(directory, "assets")).filter(f => f.endsWith(".css"))
    .map(f => fs.readFileSync(path.join(directory, "assets", f), "utf8")).join("\n");
  await win.loadURL("about:blank");
  await js(`document.head.innerHTML='<style></style>';document.querySelector('style').textContent=${JSON.stringify(css)};
    document.body.innerHTML='<main style="width:640px">'+['','ui-skeleton-row','ui-skeleton-card','ui-skeleton-metric','','ui-skeleton-row','ui-skeleton-card'].map(variant=>
      '<div class="ui-skeleton '+variant+'"><span></span><span></span><span></span></div>').join('')+'</main>'`);
  await installSampler();
  await delay(500);
  const skeleton = await measure("skeleton-21-lines", "void 0", 2000, true);
  const animations = await js("document.getAnimations().filter(a=>a.playState==='running').length");
  assert.equal(animations, 21, "All skeleton waves must still animate");
  assert(await js("[...document.querySelectorAll('.ui-skeleton span')].every(s=>getComputedStyle(s,'::after').transform !== 'none')"), "Every skeleton variant must have a moving gradient");
  check("steady skeleton paints", skeleton.paintEvents, 4);
  fs.writeFileSync(path.join(directory, "skeleton.png"), (await win.webContents.capturePage()).toPNG());
  finish();
}).catch(error => { saveReport(); console.error(error); app.exit(1); });
