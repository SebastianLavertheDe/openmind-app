const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { app, BrowserWindow } = require("electron");
const directory = process.env.OPENMIND_MOTION_PERF_DIR;
const baseline = process.env.OPENMIND_WORKSPACE_MOTION_BASELINE === "1";
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "openmind-workspace-motion-profile-"));
app.setPath("userData", profile);
app.commandLine.appendSwitch("disable-gpu");
app.commandLine.appendSwitch("no-sandbox");
app.once("quit", () => fs.rmSync(profile, { recursive: true, force: true }));
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
let win;
const js = code => win.webContents.executeJavaScript(code).catch(error => { throw new Error(`${error.message}\nFixture step: ${code.slice(0, 240)}`); });
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
  await js(`workspaceMotion.probe.commits=[];window.sample={active:true,frames:[],start:performance.now(),last:performance.now(),transforms:[],heights:[]};
    window.sampleObserver=new MutationObserver(entries=>{for(const e of entries){
      if(e.target.matches('[data-project-motion],.project-list-group')&&e.target.style.transform)sample.transforms.push(e.target.style.transform);
    }});sampleObserver.observe(document.body,{subtree:true,attributes:true,attributeFilter:['style']});
    window.sizeObserver=new ResizeObserver(entries=>entries.forEach(e=>sample.heights.push(e.contentRect.height)));
    sizeObserver.observe(document.querySelector('.project-workspace,.brief-library-page'));
    (()=>{const tick=t=>{if(!sample.active)return;sample.frames.push(t-sample.last);sample.last=t;requestAnimationFrame(tick)};requestAnimationFrame(tick)})();
    ${action}`);
  await delay(550);
  const sample = await js("sample.active=false;sampleObserver.disconnect();sizeObserver.disconnect();({...sample,lastFrameGap:performance.now()-sample.last,elapsed:performance.now()-sample.start,commits:workspaceMotion.probe.commits})");
  const after = await metric();
  const traced = new Promise(resolve => {
    const complete = (_event, method) => { if (method === "Tracing.tracingComplete") { win.webContents.debugger.removeListener("message", complete); resolve(); } };
    win.webContents.debugger.on("message", complete);
  });
  await cdp("Tracing.end"); await traced;
  win.webContents.debugger.removeListener("message", handler);
  const frames = sample.frames.sort((a,b)=>a-b);
  const phase = { name, p95: frames[Math.floor(frames.length*.95)], max: Math.max(...frames,sample.lastFrameGap),
    lastFrameGap: sample.lastFrameGap, sampleElapsedMs: sample.elapsed, commits: sample.commits.length,
    commitSamples: sample.commits, transformValues: new Set(sample.transforms).size,
    heightValues: new Set(sample.heights).size, renderer: {}, trace: {} };
  for (const key of ["LayoutCount","LayoutDuration","RecalcStyleDuration","ScriptDuration"]) phase.renderer[key] = (after[key]-before[key])*(key.endsWith("Duration")?1000:1);
  for (const type of ["Layout","Paint","PrePaint","Layerize","UpdateLayerTree","Commit","CompositeLayers"]) {
    const matching = events.filter(e=>e.name===type&&e.ph==="X");
    phase.trace[type] = { count: matching.length, ms: matching.reduce((sum,e)=>sum+(e.dur||0),0)/1000 };
  }
  phase.traceFile = `workspace-trace-${report.phases.length + 1}.json`;
  fs.writeFileSync(path.join(directory, phase.traceFile), JSON.stringify({ traceEvents: events }));
  report.phases.push(phase);
  console.log(JSON.stringify(phase));
  return phase;
}
const clickText = text => `[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(text)}&&!b.closest('[inert],[data-leaving]')).click()`;
const clickLabel = label => `document.querySelector('[aria-label=${JSON.stringify(label)}]').click()`;
async function scene(name) {
  await js(`workspaceMotion.probe.slow=false;workspaceMotion.scene(${JSON.stringify(name)})`);
  await until(name === "brief" ? "document.querySelector('.document-detail-body')" : name === "files" ? "document.querySelectorAll('.project-file-row').length===21" : "document.querySelector('[aria-label=\"文档标题\"]')");
  await delay(500);
}
async function archive(name, phase) {
  await js(`${clickLabel(`项目操作：${name}`)};window.removing=document.querySelector('[aria-label="项目操作：${name}"]').closest('.project-list-row')`);
  await until("document.querySelector('[role=menu]')");
  return measure(phase, clickText("归档"));
}
async function resetProjects(count) {
  await js(`workspaceMotion.probe.slow=false;workspaceMotion.projects(${count})`);
  await until(`document.querySelectorAll('.project-list-row').length===${count}`); await delay(450);
}
async function renameSetup() {
  await js(`${clickLabel("文件操作：资料 0")}`);
  await until("document.querySelector('[role=menu]')");
  await js(clickText("重命名"));
  await until("document.querySelector('[role=dialog] input')");
  // Retain its path, so this is a background list refresh with surviving keys.
  await js("workspaceMotion.probe.slow=true");
}
app.whenReady().then(async () => {
  win = new BrowserWindow({ width: 1440, height: 1000, show: true, webPreferences: { contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } });
  win.webContents.on("console-message", e => { if(e.level>=3) console.error(e.message); });
  await win.loadFile(path.join(directory,"index.html"));
  win.webContents.debugger.attach("1.3"); await cdp("Performance.enable");
  await until("Boolean(window.workspaceMotion)");
  for(const rate of [1,4]) {
    await cdp("Emulation.setCPUThrottlingRate",{rate});
    await resetProjects(8);
    const lastGroup=await archive("项目 0",`archive-last-group-cpu${rate}`);
    assert(await js("!document.querySelector('[aria-label=收藏]')"));
    const middle=await archive("项目 3",`archive-middle-cpu${rate}`);
    if(!baseline) assert(lastGroup.transformValues>2&&middle.transformValues>2,"archive exits must move surviving project rows");
    await scene("files");
    await renameSetup();
    await js("window.survivor=document.querySelector('.project-file-row');window.fileList=document.querySelector('.project-file-list')");
    await measure(`file-refresh-cpu${rate}`,clickText("确认"));
    assert.equal(await js("survivor.isConnected"),!baseline,"file refresh must preserve actual row DOM");
    await scene("brief");
    await js("workspaceMotion.probe.slow=true");
    await measure(`brief-refresh-cpu${rate}`,clickLabel("刷新简报"));
    await scene("compact");
    await js("window.editor=document.querySelector('[aria-label=\"文档标题\"]');window.host=document.querySelector('.project-detail-fill')");
    await measure(`compact-list-cpu${rate}`,clickLabel("展开项目列表"));
    assert(await js("editor.isConnected&&host===document.querySelector('.project-detail-fill')"),"compact switching must retain portal hosts and editor DOM");
  }
  await cdp("Emulation.setCPUThrottlingRate",{rate:1});
  assert(report.phases.every(p=>p.commits>0),"React profiling positive control");
  assert(report.phases.filter(p=>p.name.startsWith('compact')||p.name.startsWith('archive')).every(p=>p.commits<=6),"transitions must not render React each animation frame");
  // Geometry/computed style reads are separate from all timing windows above.
  await resetProjects(8);
  await js(clickLabel("项目操作：项目 0")); await until("document.querySelector('[role=menu]')");
  report.archiveGeometry = await js(`new Promise(resolve=>{
    const row=document.querySelector('[data-project-motion="project-1"]');
    const points=[{ms:0,y:row.getBoundingClientRect().top,retained:true}];const start=performance.now();
    ${clickText("归档")};
    const tick=()=>{points.push({ms:performance.now()-start,y:row.getBoundingClientRect().top,
      retained:!!document.querySelector('[data-project-motion="project-0"]')});
      if(performance.now()-start<600)requestAnimationFrame(tick);else resolve(points)};requestAnimationFrame(tick);
  })`);
  const firstY=report.archiveGeometry[0].y,lastY=report.archiveGeometry.at(-1).y;
  assert(Math.abs(firstY-lastY)>10,"archiving the final favorite must move a real survivor");
  if(!baseline) assert(report.archiveGeometry.some(p=>Math.abs(p.y-firstY)>2&&Math.abs(p.y-lastY)>2),"group projection must carry the actual survivor through intermediate positions");
  await scene("brief");
  await js("workspaceMotion.probe.slow=true;window.row=document.querySelector('.brief-file-item');window.rowY=row.getBoundingClientRect().top");
  await js(clickLabel("刷新简报")); await delay(80);
  report.briefGeometry = await js("({before:rowY,during:row.getBoundingClientRect().top,skeletons:document.querySelectorAll('.document-file-list .ui-skeleton').length})");
  assert.equal(report.briefGeometry.skeletons,baseline?7:0);
  assert.equal(Math.abs(report.briefGeometry.during-report.briefGeometry.before)<1,!baseline,"baseline detects skeleton pushing existing rows");
  await scene("compact");
  report.compactOpacity=await js(`new Promise(resolve=>{
    const pane=document.querySelector('.project-list-pane');const points=[];const start=performance.now();
    ${clickLabel("展开项目列表")};
    const tick=()=>{points.push({ms:performance.now()-start,opacity:Number(getComputedStyle(pane).opacity)});
      if(performance.now()-start<300)requestAnimationFrame(tick);else resolve(points)};requestAnimationFrame(tick);
  })`);
  assert.equal(report.compactOpacity.some(p=>p.opacity>.05&&p.opacity<.95),!baseline,"compact switch needs real intermediate opacity");
  fs.writeFileSync(path.join(directory,"workspace-compact.png"),(await win.webContents.capturePage()).toPNG());
  await js("window.editor=document.querySelector('[aria-label=\"文档标题\"]');window.reads=workspaceMotion.probe.outputReads;document.querySelector('.project-item-list > button.active').click()");
  await delay(250);
  assert.equal(await js("document.querySelector('.project-workspace').classList.contains('compact-detail-open')"),!baseline,"reselecting the current output must reopen detail");
  if(!baseline) {
    assert(await js("editor===document.querySelector('[aria-label=\"文档标题\"]')&&reads===workspaceMotion.probe.outputReads"));
    const detailInset = await js("getComputedStyle(document.querySelector('.project-detail-fill')).paddingLeft");
    await js(`${clickLabel("展开项目列表")}`); await delay(50);
    assert(await js("document.querySelector('.project-main-pane').inert"));
    assert.equal(await js("getComputedStyle(document.querySelector('.project-detail-fill')).paddingLeft"),detailInset,"the outgoing editor must retain its horizontal inset during compact exit");
    win.webContents.sendInputEvent({ type: "keyDown", keyCode: "Tab" });
    win.webContents.sendInputEvent({ type: "keyUp", keyCode: "Tab" });
    assert(await js("!document.querySelector('.project-main-pane').contains(document.activeElement)"),"Tab must skip the exiting detail pane");
    await js("document.querySelector('.project-item-list > button.active').click()"); await delay(50);
    await js(clickLabel("展开项目列表")); await delay(50);
    await js("document.querySelector('.project-item-list > button.active').click()");
    win.setSize(1600,1000);
    await until("!document.querySelector('.project-main-pane').inert&&!document.querySelector('.project-list-pane').inert");
    assert(await js("!document.querySelector('.project-main-pane').inert&&!document.querySelector('.project-list-pane').inert"),"resize to split makes both panes interactive");
    win.setSize(1100,850);
    await until("document.querySelector('.project-workspace').classList.contains('compact-detail-open')&&document.querySelector('.project-list-pane').inert");
    await until("getComputedStyle(document.querySelector('.project-list-pane')).display==='none'");
    assert(await js("document.querySelector('.project-list-pane').inert"));
    assert(await js("getComputedStyle(document.querySelector('.project-list-pane')).display==='none'"),"hidden pane must leave layout after the transition");
    await cdp("Emulation.setEmulatedMedia",{features:[{name:"prefers-reduced-motion",value:"reduce"}]});
    await js(clickLabel("展开项目列表")); await delay(30);
    assert(await js("getComputedStyle(document.querySelector('.project-main-pane')).display==='none'&&getComputedStyle(document.querySelector('.project-list-pane')).opacity==='1'"),"compact reduced motion must settle immediately");
    await cdp("Emulation.setEmulatedMedia",{features:[{name:"prefers-reduced-motion",value:"no-preference"}]});
  }
  await resetProjects(8);
  await js(`${clickLabel("项目操作：项目 0")}`); await delay(50);
  await js(clickText("归档")); await delay(50);
  assert.equal(await js("Boolean(document.querySelector('.project-list-row[data-leaving][inert]'))"),!baseline,"archive retention must be inert");
  await cdp("Emulation.setEmulatedMedia",{features:[{name:"prefers-reduced-motion",value:"reduce"}]}); await delay(30);
  assert(await js("!document.querySelector('.project-list-row[data-leaving]')"),"live reduced preference flushes archive exit");
  await resetProjects(1);
  await archive("项目 0","archive-reduced");
  assert(await js("Boolean(document.querySelector('.project-list-empty'))"));
  await cdp("Emulation.setEmulatedMedia",{features:[{name:"prefers-reduced-motion",value:"no-preference"}]}); await delay(80);
  await resetProjects(42);
  const large=await archive("项目 3","archive-budget");
  assert.equal(large.transformValues,0);
  assert.equal(await js("document.querySelectorAll('.project-list-row').length"),41);
  if(!baseline) {
    await resetProjects(8);
    await js(clickLabel("项目操作：项目 2")); await until("document.querySelector('[role=menu]:not([inert]):not([data-leaving])')");
    await js(clickText("归档")); await delay(40);
    await js(clickLabel("项目操作：项目 4")); await until("document.querySelector('[role=menu]:not([inert]):not([data-leaving])')");
    await js(clickText("归档"));
    await until("document.querySelectorAll('.project-list-row').length===6&&!document.querySelector('.project-list-row[data-leaving]')");
    await until("[...document.querySelectorAll('[data-project-motion],.project-list-group')].every(e=>getComputedStyle(e).transform==='none')");
    assert(await js("document.querySelectorAll('.project-list-row').length===6&&!document.querySelector('.project-list-row[data-leaving]')"),"successive archives settle to the latest collection");
    assert(await js("[...document.querySelectorAll('[data-project-motion],.project-list-group')].every(e=>getComputedStyle(e).transform==='none')"));
    report.assertions.push("rapid archives and compact switches", "real Tab skips exiting pane", "editor inset preserved through exit", "resize and hidden display", "compact reduced motion", "live archive reduced motion");
  }
  report.assertions.push("survivor DOM control", "skeleton geometry control", "last group archive geometry", "compact opacity control", "editor and portal identity", "same output selection control", "42 projects preserved with bounded layout");
  fs.writeFileSync(path.join(directory,"workspace-report.json"),JSON.stringify(report,null,2));
  fs.mkdirSync(path.resolve(__dirname,"../.build"),{recursive:true});
  fs.writeFileSync(path.resolve(__dirname,`../.build/workspace-motion-${baseline?"before":"after"}.json`),JSON.stringify(report,null,2));
  fs.writeFileSync(path.join(directory,"workspace.png"),(await win.webContents.capturePage()).toPNG());
  clearTimeout(watchdog); win.destroy(); app.quit();
}).catch(error=>{ console.error(error); fs.writeFileSync(path.join(directory,"workspace-failure.json"),JSON.stringify({ ...report, error: String(error) },null,2)); app.exit(1); });
