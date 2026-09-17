const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { app, BrowserWindow } = require("electron");
const directory = process.env.OPENMIND_MOTION_PERF_DIR;
const baseline = process.env.OPENMIND_FOLLOWUP_MOTION_BASELINE === "1";
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "openmind-followup-motion-profile-"));
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
  await js(`followupMotion.probe.commits=[];window.sample={active:true,frames:[],start:performance.now(),last:performance.now(),transforms:[],heights:[]};
    window.sampleObserver=new MutationObserver(entries=>{for(const e of entries){
      if(e.target.matches('[data-project-motion],.project-list-group')&&e.target.style.transform)sample.transforms.push(e.target.style.transform);
    }});sampleObserver.observe(document.body,{subtree:true,attributes:true,attributeFilter:['style']});
    window.sizeObserver=new ResizeObserver(entries=>entries.forEach(e=>sample.heights.push(e.contentRect.height)));
    sizeObserver.observe(document.querySelector('[data-followup-observe]') || document.getElementById('root'));
    (()=>{const tick=t=>{if(!sample.active)return;sample.frames.push(t-sample.last);sample.last=t;requestAnimationFrame(tick)};requestAnimationFrame(tick)})();
    ${action}`);
  await delay(550);
  const sample = await js("sample.active=false;sampleObserver.disconnect();sizeObserver.disconnect();({...sample,lastFrameGap:performance.now()-sample.last,elapsed:performance.now()-sample.start,commits:followupMotion.probe.commits})");
  const after = await metric();
  const traced = new Promise(resolve => {
    const complete = (_event, method) => { if (method === "Tracing.tracingComplete") { win.webContents.debugger.removeListener("message", complete); resolve(); } };
    win.webContents.debugger.on("message", complete);
  });
  await cdp("Tracing.end"); await traced;
  win.webContents.debugger.removeListener("message", handler);
  const frames = sample.frames.sort((a,b)=>a-b);
  const phase = { name, frameCount: frames.length, p95: frames.length ? frames[Math.floor(frames.length*.95)] : null, max: Math.max(...frames,sample.lastFrameGap),
    lastFrameGap: sample.lastFrameGap, sampleElapsedMs: sample.elapsed, commits: sample.commits.length,
    commitSamples: sample.commits, transformValues: new Set(sample.transforms).size,
    heightValues: new Set(sample.heights).size, renderer: {}, trace: {} };
  for (const key of ["LayoutCount","LayoutDuration","RecalcStyleDuration","ScriptDuration"]) phase.renderer[key] = (after[key]-before[key])*(key.endsWith("Duration")?1000:1);
  for (const type of ["Layout","Paint","PrePaint","Layerize","UpdateLayerTree","Commit","CompositeLayers"]) {
    const matching = events.filter(e=>e.name===type&&e.ph==="X");
    phase.trace[type] = { count: matching.length, ms: matching.reduce((sum,e)=>sum+(e.dur||0),0)/1000 };
  }
  phase.traceFile = `followup-trace-${report.phases.length + 1}.json`;
  fs.writeFileSync(path.join(directory, phase.traceFile), JSON.stringify({ traceEvents: events }));
  report.phases.push(phase);
  console.log(JSON.stringify(phase));
  return phase;
}
const click = selector => `document.querySelector(${JSON.stringify(selector)}).click()`;
async function scene(name, selector) {
  await js(`followupMotion.scene(${JSON.stringify(name)})`);await until(`document.querySelector(${JSON.stringify(selector)})`);
  // Standalone sections use the production detail canvas width. Also normalize
  // saved fixtures from before this wrapper correction for identical A/B geometry.
  await js("(()=>{const page=document.querySelector('.settings-page');if(page)Object.assign(page.style,{display:'block',padding:'0',width:'min(980px, calc(100% - 48px))',margin:'24px auto'})})()");
  await delay(350);
}
async function key(keyCode, modifiers = []) {
  win.webContents.sendInputEvent({type:'keyDown',keyCode,modifiers});
  // Electron's keyDown alone does not synthesize the keypress that activates
  // a native button. Send the same character event as a real Enter key.
  if (keyCode === 'Enter') win.webContents.sendInputEvent({type:'char',keyCode:'\r',modifiers});
  win.webContents.sendInputEvent({type:'keyUp',keyCode,modifiers});await delay(50);
}
async function assertRecentLayout(label) {
  const { rows, staticHeight } = await js("({rows:[...document.querySelectorAll('[data-recent-index]')].map(element=>{const box=element.getBoundingClientRect();return {index:Number(element.dataset.recentIndex),top:box.top,bottom:box.bottom}}),staticHeight:document.querySelector('.nav-recent-static-content')?.getBoundingClientRect().height})");
  assert(rows.length > 1, `${label}: geometry needs multiple mounted rows`);
  assert(rows.every((row, index) => row.bottom > row.top && (!index || row.top >= rows[index - 1].bottom - 0.5)),
    `${label}: task rows must retain distinct, non-overlapping positions`);
  if (staticHeight !== undefined) assert(Math.abs(staticHeight - (rows.at(-1).bottom - rows[0].top)) < 1,
    `${label}: static content must not retain the virtual container height`);
}
app.whenReady().then(async()=>{
  win=new BrowserWindow({width:1440,height:1000,show:true,webPreferences:{contextIsolation:true,nodeIntegration:false,backgroundThrottling:false}});
  win.webContents.on('console-message',e=>{if(e.level>=3)console.error(e.message)});
  await win.loadFile(path.join(directory,'index.html'));win.webContents.debugger.attach('1.3');await cdp('Performance.enable');await until('Boolean(window.followupMotion)');
  for(const rate of [1,4]) {
    await cdp('Emulation.setCPUThrottlingRate',{rate});
    for(const count of [40,400]){
      await scene(`recent${count}`,'.nav-recent-toggle');
      await js("document.querySelector('.nav-recent-toggle[aria-expanded=true]')?.click()");await until("!document.querySelector('.nav-recent-list')");
      await js("document.querySelector('.nav-recent').setAttribute('data-followup-observe','')");
      const phase=await measure(`recent-${count}-expand-cpu${rate}`,click('.nav-recent-toggle'));
      phase.mountedRows=await js("document.querySelectorAll('.nav-recent-row').length");
      assert(baseline?phase.mountedRows===count:phase.mountedRows>0&&phase.mountedRows<25,'long histories must mount a bounded visible range');
      assert(phase.commits>0&&phase.commits<=8,'bounded React commits, not per-frame disclosure renders');
    }
    for(const [name,trigger,body] of [['skills','.settings-skill-summary','.settings-skill-details'],['mcp','.settings-mcp-server-header','.settings-mcp-details']]){
      await scene(name,trigger);await js(`document.querySelector(${JSON.stringify(trigger)}).closest('article').setAttribute('data-followup-observe','')`);
      await measure(`${name}-expand-cpu${rate}`,click(trigger));await until(`document.querySelector(${JSON.stringify(body)})`);
      await measure(`${name}-collapse-cpu${rate}`,click(trigger));await until(`!document.querySelector(${JSON.stringify(body)})`);
    }
    await scene('icon','.project-icon-picker-trigger');await js(click('.project-icon-picker-trigger'));await until("document.querySelector('.project-icon-picker')");await delay(300);
    await measure(`icon-exit-cpu${rate}`,click('.project-icon-picker [aria-label="书籍"]'));await until("!document.querySelector('.project-icon-picker')");
    win.setSize(760,1000);await scene('drawer','.responsive-nav-toggle');await js(click('.responsive-nav-toggle'));await until("document.querySelector('.app-nav-scrim')");await delay(300);
    await measure(`drawer-exit-cpu${rate}`,click('.app-nav-scrim'));await until("!document.querySelector('.app-nav-scrim')");win.setSize(1440,1000);await delay(300);
  }
  await cdp('Emulation.setCPUThrottlingRate',{rate:1});
  // Geometry reads do not contaminate timing windows.
  await scene('skills','.settings-skill-summary');
  assert(await js("document.querySelector('.settings-card').getBoundingClientRect().width>900"),'settings fixture must occupy the detail canvas, not the 260px navigation column');
  report.disclosureGeometry=await js(`new Promise(resolve=>{const item=document.querySelector('.settings-skill-item'),samples=[];const start=performance.now();${click('.settings-skill-summary')};const tick=()=>{samples.push(item.getBoundingClientRect().height);if(performance.now()-start<350)requestAnimationFrame(tick);else resolve(samples)};requestAnimationFrame(tick)})`);
  assert.equal(new Set(report.disclosureGeometry.map(Math.round)).size>2,!baseline,'old conditional rendering must distinguish height interpolation');
  fs.writeFileSync(path.join(directory,'followup-settings.png'),(await win.webContents.capturePage()).toPNG());
  await js(click('.settings-skill-summary'));await delay(40);
  assert.equal(await js("!!document.querySelector('.settings-skill-details')"),!baseline,'retain the closing detail');
  if(!baseline) assert(await js("!!document.querySelector('.settings-skill-details').closest('[inert]')"));
  await js(click('.settings-skill-summary'));await delay(300);assert(await js("!!document.querySelector('.settings-skill-details')"),'rapid reversal cancels removal');
  if(!baseline){
    await scene('recent400','.nav-recent-toggle');await js("document.querySelector('.nav-recent-toggle[aria-expanded=false]')?.click()");await until("document.querySelector('.nav-recent-list.is-virtual')");
    await js("document.querySelector('.nav-recent-list').focus()");await key('End');await until("document.activeElement.closest('[data-recent-index]')?.dataset.recentIndex==='399'");await key('Enter');assert.equal(await js('followupMotion.probe.opened'),'session-399');
    fs.writeFileSync(path.join(directory,'followup-recent.png'),(await win.webContents.capturePage()).toPNG());
    await js("document.querySelector('.nav-recent-list').scrollTop=0");await delay(150);assert.equal(await js("document.activeElement.closest('[data-recent-index]')?.dataset.recentIndex"),'399','offscreen focused row stays mounted');
    await key('Home');await until("document.activeElement.closest('[data-recent-index]')?.dataset.recentIndex==='0'");
    await key('Tab');await key('Tab');await key('Tab');assert.equal(await js("document.activeElement.closest('[data-recent-index]')?.dataset.recentIndex"),'1','Tab reaches next row');
    await key('Tab',['shift']);assert(await js("document.activeElement.classList.contains('nav-recent-action')&&document.activeElement.closest('[data-recent-index]').dataset.recentIndex==='0'"),'Shift+Tab returns to previous last action');
    await js("window.focusedTaskButton=document.activeElement;followupMotion.historySize(20)");await until("!document.querySelector('.nav-recent-list.is-virtual')");assert(await js("document.activeElement===focusedTaskButton"),'shrinking below the virtualization threshold preserves focus and row identity');
    await assertRecentLayout('static history after shrinking');
    await js("followupMotion.historySize(400)");await until("document.querySelector('.nav-recent-list.is-virtual')");assert(await js("document.activeElement===focusedTaskButton"),'growing above the threshold preserves the focused row');
    await assertRecentLayout('virtual history after growing');
    // Exercise the actual optimistic mutation and rollback across 21 -> 20 -> 21.
    await js("followupMotion.historySize(21)");await until("document.querySelector('[data-recent-index]')?.getAttribute('aria-setsize')==='21'");
    await js("openmind.aiUpdateSession=()=>new Promise((_,reject)=>{window.rejectArchive=reject});document.querySelector('[data-recent-index=\"0\"] .nav-recent-actions').querySelectorAll('button')[1].click()");
    await until("!document.querySelector('.nav-recent-list.is-virtual')");
    await assertRecentLayout('optimistic archive');
    await js("rejectArchive(new Error('synthetic persistence failure'))");await until("document.querySelector('.nav-recent-list.is-virtual')");
    await assertRecentLayout('archive rollback');
    await js("followupMotion.historySize(400)");await until("document.querySelector('[data-recent-index]')?.getAttribute('aria-setsize')==='400'");
    report.assertions.push('threshold round trip preserves row geometry', 'archive rollback preserves row geometry');
    for(const width of [900,1440]){win.setSize(width,800);await delay(250);}assert(await js("document.querySelectorAll('.nav-recent-row').length<25"));
    await scene('icon','.project-icon-picker-trigger');await js(click('.project-icon-picker-trigger'));await until("document.querySelector('.project-icon-picker').contains(document.activeElement)");await key('Escape');await until("!document.querySelector('.project-icon-picker')");assert(await js("document.querySelector('.project-dialog')&&document.activeElement.matches('.project-icon-picker-trigger')"),'Escape only closes the picker and restores focus');
    await js(click('.project-icon-picker-trigger'));await delay(200);await js(click('.project-icon-picker [aria-label="书籍"]'));await delay(40);assert(await js("document.querySelector('.project-icon-picker')?.inert"));await js(click('.project-icon-picker-trigger'));await delay(220);assert(await js("document.querySelector('.project-icon-picker [aria-label=书籍]').getAttribute('aria-pressed')==='true'"));
    fs.writeFileSync(path.join(directory,'followup-icon.png'),(await win.webContents.capturePage()).toPNG());
    await cdp('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});await delay(30);await key('Escape');await until("!document.querySelector('.project-icon-picker')");
    await scene('skills','.settings-skill-summary');await js(click('.settings-skill-summary'));await js(click('.settings-skill-summary'));assert(await js("!document.querySelector('.settings-skill-details')"),'reduced motion removes disclosure without retention');
    await cdp('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'no-preference'}]});
    await scene('mcp','.settings-mcp-server-header');await js("(()=>{const input=document.querySelector('input[type=search]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'合成');input.dispatchEvent(new Event('input',{bubbles:true}))})()");await until("document.querySelectorAll('.settings-mcp-details').length===3");assert(await js("[...document.querySelectorAll('.settings-disclosure')].every(e=>e.hasAttribute('data-instant'))"),'search expands all matching MCP details instantly');
    await scene('provider','.settings-provider-config-card');await js("document.querySelector('button[aria-label^=编辑]').click()");await until("document.querySelector('.settings-provider-advanced-trigger')");await js(click('.settings-provider-advanced-trigger'));await until("document.querySelector('.settings-provider-advanced-grid')");
    await js("(()=>{const input=document.querySelector('.settings-provider-advanced-grid select');input.value='openai-responses';input.dispatchEvent(new Event('change',{bubbles:true}))})()");await js(click('.settings-provider-advanced-trigger'));await delay(250);await js(click('.settings-provider-advanced-trigger'));assert.equal(await js("document.querySelector('.settings-provider-advanced-grid select').value"),'openai-responses','advanced edits survive collapse');
    await scene('drawer','.app-shell');win.setSize(760,800);await until("document.querySelector('.responsive-nav-toggle')");await js(click('.responsive-nav-toggle'));await until("document.querySelector('.app-nav-scrim')");await delay(220);await js(click('.app-nav-scrim'));await delay(30);assert(await js("document.querySelector('.app-nav-scrim')?.inert"));await js(click('.responsive-nav-toggle'));await delay(220);assert(await js("document.querySelector('.app-nav-scrim')&&!document.querySelector('.app-nav-scrim').inert"),'drawer reversal retains current scrim');
    await js(click('.app-nav-scrim'));await cdp('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});await until("!document.querySelector('.app-nav-scrim')");win.setSize(1440,1000);await delay(250);assert(await js("!document.querySelector('.app-nav-scrim')"));
    report.assertions.push('400 tasks reachable without full mounting','focus pinned while scrolling','Tab and Shift+Tab across virtual rows','resize','picker topmost Escape and reopen','advanced form values retained','MCP search instant','live reduced motion scrim removal');
  }
  assert(report.phases.every(p=>p.commits>0),'profiling positive control');
  report.assertions.push('real height negative/positive control','presence retention control','rapid disclosure reversal');
  fs.writeFileSync(path.join(directory,'followup.png'),(await win.webContents.capturePage()).toPNG());
  fs.writeFileSync(path.join(directory,'followup-report.json'),JSON.stringify(report,null,2));console.log('Followup motion checks passed');clearTimeout(watchdog);app.quit();
}).catch(error=>{console.error(error);fs.writeFileSync(path.join(directory,'followup-failure.json'),JSON.stringify({...report,error:String(error)},null,2));clearTimeout(watchdog);app.exit(1)});
