const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { app, BrowserWindow } = require("electron");
const directory = process.env.OPENMIND_MOTION_PERF_DIR;
const baseline = process.env.OPENMIND_FEEDBACK_MOTION_BASELINE === "1";
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "openmind-feedback-motion-profile-"));
app.setPath("userData", profile);
app.commandLine.appendSwitch("disable-gpu");
app.commandLine.appendSwitch("no-sandbox");
app.once("quit", () => fs.rmSync(profile, { recursive: true, force: true }));
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
let win;
const js = code => win.webContents.executeJavaScript(code);
const cdp = (method, params = {}) => win.webContents.debugger.sendCommand(method, params);
const report = { baseline, environment: { platform: process.platform, arch: process.arch, electron: process.versions.electron,
  window: [1440, 1000], cpuRates: [1, 4], gpuDisabled: true, syntheticData: true, profilingBuild: true }, phases: [], assertions: [] };
const watchdog = setTimeout(() => app.exit(1), 120000);
async function until(code) {
  for (let i = 0; i < 150; i++) { if (await js(code)) return; await delay(30); }
  throw new Error(`Timed out: ${code}`);
}
async function measure(name, action) {
  const events = [];
  const handler = (_event, method, params) => { if (method === "Tracing.dataCollected") events.push(...params.value); };
  win.webContents.debugger.on("message", handler);
  await cdp("Tracing.start", { categories: "devtools.timeline,cc", transferMode: "ReportEvents" });
  const metric = async () => Object.fromEntries((await cdp("Performance.getMetrics")).metrics.map(m => [m.name, m.value]));
  const before = await metric();
  await js(`feedbackMotion.probe.commits=[];window.sample={active:true,frames:[],last:performance.now(),transforms:[],heights:[]};
    window.sampleObserver=new MutationObserver(entries=>{for(const e of entries){
      if(e.target.matches('[data-toast-motion],.toast')&&e.target.style.transform)sample.transforms.push(e.target.style.transform);
    }});sampleObserver.observe(document.body,{subtree:true,attributes:true,attributeFilter:['style']});
    window.sizeObserver=new ResizeObserver(entries=>entries.forEach(e=>sample.heights.push(e.contentRect.height)));
    sizeObserver.observe(document.querySelector('.nav-recent'));
    (()=>{const tick=t=>{if(!sample.active)return;sample.frames.push(t-sample.last);sample.last=t;requestAnimationFrame(tick)};requestAnimationFrame(tick)})();
    ${action}`);
  await delay(550);
  const sample = await js("sample.active=false;sampleObserver.disconnect();sizeObserver.disconnect();({...sample,commits:feedbackMotion.probe.commits})");
  const after = await metric();
  const traced = new Promise(resolve => {
    const complete = (_event, method) => { if (method === "Tracing.tracingComplete") { win.webContents.debugger.removeListener("message", complete); resolve(); } };
    win.webContents.debugger.on("message", complete);
  });
  await cdp("Tracing.end"); await traced;
  win.webContents.debugger.removeListener("message", handler);
  const frames = sample.frames.sort((a,b)=>a-b);
  const phase = { name, p95: frames[Math.floor(frames.length*.95)], max: Math.max(...frames), commits: sample.commits.length,
    commitSamples: sample.commits, transformValues: new Set(sample.transforms).size,
    heightValues: new Set(sample.heights).size, renderer: {}, trace: {} };
  for (const key of ["LayoutCount","LayoutDuration","RecalcStyleDuration","ScriptDuration"]) phase.renderer[key] = (after[key]-before[key])*(key.endsWith("Duration")?1000:1);
  for (const type of ["Layout","Paint","PrePaint","Layerize","UpdateLayerTree","Commit","CompositeLayers"]) {
    const matching = events.filter(e=>e.name===type&&e.ph==="X");
    phase.trace[type] = { count: matching.length, ms: matching.reduce((sum,e)=>sum+(e.dur||0),0)/1000 };
  }
  phase.traceFile = `feedback-trace-${report.phases.length + 1}.json`;
  fs.writeFileSync(path.join(directory, phase.traceFile), JSON.stringify({ traceEvents: events }));
  report.phases.push(phase);
  console.log(JSON.stringify(phase));
  return phase;
}
const toggle = "document.querySelector('.nav-recent-toggle').click()";
async function assertRecentRows() {
  const state = await js("({mounted:document.querySelectorAll('.nav-recent-row').length,total:document.querySelector('[data-recent-index]')?.getAttribute('aria-setsize'),virtual:!!document.querySelector('.nav-recent-list.is-virtual')})");
  if (state.virtual) {
    assert.equal(state.total, "40", "virtual history retains its full accessible size");
    assert(state.mounted > 0 && state.mounted < 25, "visible history mounting stays bounded");
  } else assert.equal(state.mounted, 40);
}
async function reset(count) {
  await js("feedbackMotion.clear()"); await delay(450);
  await js(`feedbackMotion.add(${count})`); await delay(450);
}
app.whenReady().then(async () => {
  win = new BrowserWindow({ width: 1440, height: 1000, show: true, webPreferences: { contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } });
  win.webContents.on("console-message", e => { if(e.level>=3) console.error(e.message); });
  await win.loadFile(path.join(directory,"index.html"));
  win.webContents.debugger.attach("1.3"); await cdp("Performance.enable");
  await until("Boolean(window.feedbackMotion)");
  for (const rate of [1,4]) {
    await cdp("Emulation.setCPUThrottlingRate",{rate});
    await reset(4);
    const removed = await measure(`toast-remove-cpu${rate}`,"feedbackMotion.dismiss(1)");
    assert.equal(await js("document.querySelectorAll('.toast').length"),3);
    const collapsed = await measure(`recent-collapse-cpu${rate}`,toggle);
    assert(await js("!document.querySelector('.nav-recent-list')"));
    const expanded = await measure(`recent-expand-cpu${rate}`,toggle);
    await assertRecentRows();
    if (!baseline) {
      assert(removed.transformValues>2,"surviving toasts must interpolate after exit completion");
      assert(collapsed.heightValues>2&&expanded.heightValues>2,"disclosure must interpolate height in both directions");
    }
  }
  await cdp("Emulation.setCPUThrottlingRate",{rate:1});
  assert(report.phases.every(p=>p.commits>0&&p.commits<=4),"profiler positive control and no per-frame React renders");
  // Deliberately separate forced geometry reads from the performance samples.
  await reset(4);
  report.toastGeometry = await js(`new Promise(resolve=>{
    const node=document.querySelector('.toast');const points=[];const start=performance.now();
    const tick=t=>{points.push({ms:t-start,y:node.getBoundingClientRect().top});
      if(t-start<450)requestAnimationFrame(tick);else resolve(points)};
    requestAnimationFrame(tick);feedbackMotion.dismiss(1);
  })`);
  const ys=report.toastGeometry.map(p=>p.y), start=ys[0], end=ys.at(-1);
  assert(Math.abs(end-start)>20,"geometry control: surviving toast really changes position");
  const intermediate=ys.some(y=>y>Math.min(start,end)+3&&y<Math.max(start,end)-3);
  assert.equal(intermediate,!baseline,"geometry must distinguish a jump from continuous movement");
  if (await js("!!document.querySelector('.nav-recent-list.is-virtual')")) {
    await js("document.querySelector('.nav-recent-list').focus()");
    win.webContents.sendInputEvent({ type: "keyDown", keyCode: "End" });
    win.webContents.sendInputEvent({ type: "keyUp", keyCode: "End" });
    await until("document.activeElement.closest('[data-recent-index]')?.dataset.recentIndex==='39'");
    win.webContents.sendInputEvent({ type: "keyDown", keyCode: "Home" });
    win.webContents.sendInputEvent({ type: "keyUp", keyCode: "Home" });
    await until("document.activeElement.closest('[data-recent-index]')?.dataset.recentIndex==='0'");
  }
  report.assertions.push("real toast geometry negative/positive control", "React commit positive control", "40 recent tasks preserved and last task reachable");
  await reset(6);
  await js("document.querySelector('.toast-stack').style.maxHeight='160px';document.querySelector('.toast-stack').scrollTop=50");
  await delay(100);
  const scrolled = await measure("toast-scrolled","feedbackMotion.dismiss(3)");
  assert(await js("document.querySelector('.toast-stack').scrollTop>0"),"scroll container remains scrolled");
  if(!baseline) assert(scrolled.transformValues>2,"scrolled fixed stack still animates");
  await js("document.querySelector('.toast-stack').style.maxHeight=''");
  await reset(12);
  const large=await measure("toast-budget","feedbackMotion.dismiss(4)");
  assert.equal(large.transformValues,0,"large toast stack skips position animation");
  assert.equal(await js("document.querySelectorAll('.toast').length"),11,"budget must not drop notifications");
  await reset(4);
  await js("feedbackMotion.dismiss(1)"); await delay(60);
  if(!baseline) assert(await js("Boolean(document.querySelector('.toast[data-leaving][inert][aria-hidden=true]'))"),"exiting toast cannot retain action controls");
  await js("feedbackMotion.add(1);feedbackMotion.dismiss(0)");
  win.setSize(920,760); await delay(500);
  assert.equal(await js("document.querySelectorAll('.toast').length"),3);
  assert(await js("[...document.querySelectorAll('[data-toast-motion]')].every(e=>!e.style.transform||e.style.transform==='none')"));
  await js(`document.querySelector('.nav-recent-toggle').focus();${toggle}`); await delay(50);
  if(!baseline) assert(await js("Boolean(document.querySelector('.nav-recent .ui-disclosure-content[aria-hidden=true] [inert] .nav-recent-list'))"));
  win.webContents.sendInputEvent({ type: "keyDown", keyCode: "Tab" });
  win.webContents.sendInputEvent({ type: "keyUp", keyCode: "Tab" });
  await delay(30);
  assert(await js("document.activeElement.matches('[data-fixture-neighbour]')"),"real keyboard Tab skips closing task actions");
  await js(toggle); await delay(60); await js(toggle); await delay(50); await js(toggle); await delay(450);
  await assertRecentRows(); // rapid reversals keep the latest open intent
  assert.equal(await js("localStorage.getItem('openmind.nav.recentCollapsed.v2')"),"false");
  report.assertions.push("fixed scrolled container", "budget preserves notifications", "rapid add/dismiss and resize settle", "disclosure rapid reversal and persistence");
  await js(toggle); await delay(300); await js(toggle); await delay(50);
  win.setSize(1100,840); await delay(400);
  assert(await js("document.querySelector('.nav-recent-list').getBoundingClientRect().height>100"),"resize during disclosure settles open");
  await reset(4);
  await js("feedbackMotion.dismiss(1)"); await delay(220);
  await js("document.querySelector('[data-fixture-shell]').setAttribute('data-nav-transitioning','true')"); await delay(50);
  assert(await js("[...document.querySelectorAll('[data-toast-motion]')].every(e=>getComputedStyle(e).transform==='none')"),"navigation overlap settles painted toast positions");
  await js("document.querySelector('[data-fixture-shell]').removeAttribute('data-nav-transitioning')"); await delay(300);
  report.assertions.push("real keyboard focus skips exiting rows", "resize during disclosure", "navigation overlap");
  await cdp("Emulation.setEmulatedMedia",{features:[{name:"prefers-reduced-motion",value:"reduce"}]}); await delay(100);
  await measure("toast-reduced","feedbackMotion.dismiss(0)");
  await js(toggle); await delay(30);
  assert(await js("!document.querySelector('.nav-recent-list')"));
  if(!baseline) {
    await js("feedbackMotion.dismiss(0)"); await delay(30);
    assert(await js("!document.querySelector('.toast[data-leaving]')"),"reduced motion skips exit delay");
  }
  await cdp("Emulation.setEmulatedMedia",{features:[{name:"prefers-reduced-motion",value:"no-preference"}]}); await delay(100);
  await reset(4);
  await js(toggle); await delay(300); await js(`${toggle};feedbackMotion.dismiss(1)`); await delay(50);
  await cdp("Emulation.setEmulatedMedia",{features:[{name:"prefers-reduced-motion",value:"reduce"}]}); await delay(40);
  if(!baseline) assert(await js("!document.querySelector('.toast[data-leaving]')&&!document.querySelector('.nav-recent-list')"),"live preference change flushes exiting content");
  await cdp("Emulation.setEmulatedMedia",{features:[{name:"prefers-reduced-motion",value:"no-preference"}]}); await delay(100);
  await reset(4);
  await js("feedbackMotion.dismiss(1)"); await delay(230);
  await cdp("Emulation.setEmulatedMedia",{features:[{name:"prefers-reduced-motion",value:"reduce"}]}); await delay(40);
  assert(await js("[...document.querySelectorAll('[data-toast-motion]')].every(e=>getComputedStyle(e).transform==='none')"),"live reduced preference settles an active layout animation");
  report.assertions.push("reduced and live preference checks");
  fs.writeFileSync(path.join(directory,"feedback-report.json"),JSON.stringify(report,null,2));
  fs.mkdirSync(path.resolve(__dirname,"../.build"),{recursive:true});
  fs.writeFileSync(path.resolve(__dirname,`../.build/feedback-motion-${baseline?"before":"after"}.json`),JSON.stringify(report,null,2));
  fs.writeFileSync(path.join(directory,"feedback.png"),(await win.webContents.capturePage()).toPNG());
  clearTimeout(watchdog); win.destroy(); app.quit();
}).catch(error=>{ console.error(error); fs.writeFileSync(path.join(directory,"feedback-failure.json"),JSON.stringify({ ...report, error: String(error) },null,2)); app.exit(1); });
