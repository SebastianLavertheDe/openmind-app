const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { app, BrowserWindow } = require("electron");
const directory = process.env.OPENMIND_MOTION_PERF_DIR;
const baseline = process.env.OPENMIND_INCREMENTAL_MOTION_BASELINE === "1";
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "openmind-incremental-motion-profile-"));
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
const click = text => `[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(text)}).click()`;
async function measure(name, action, selector) {
  const events = [];
  const handler = (_event, method, params) => { if (method === "Tracing.dataCollected") events.push(...params.value); };
  win.webContents.debugger.on("message", handler);
  await cdp("Tracing.start", { categories: "devtools.timeline,cc", transferMode: "ReportEvents" });
  const metric = async () => Object.fromEntries((await cdp("Performance.getMetrics")).metrics.map(m => [m.name, m.value]));
  const before = await metric();
  await js(`window.incrementalMotion.probe.commits=[];window.sample={active:true,frames:[],last:performance.now(),transforms:[],leaving:false};
    window.sampleObserver=new MutationObserver(entries=>{for(const e of entries){
      if(e.attributeName==='data-leaving'&&e.target.hasAttribute('data-leaving'))sample.leaving=true;
      if(e.target.matches(${JSON.stringify(selector)})&&e.target.style.transform)sample.transforms.push(e.target.style.transform);
    }});sampleObserver.observe(document.body,{subtree:true,attributes:true,attributeFilter:['style','data-leaving']});
    (()=>{const tick=t=>{if(!sample.active)return;sample.frames.push(t-sample.last);sample.last=t;requestAnimationFrame(tick)};requestAnimationFrame(tick)})();
    ${action}`);
  await delay(550);
  const sample = await js("sample.active=false;sampleObserver.disconnect();({...sample,commits:incrementalMotion.probe.commits})");
  const after = await metric();
  const traced = new Promise(resolve => {
    const complete = (_event, method) => { if (method === "Tracing.tracingComplete") { win.webContents.debugger.removeListener("message", complete); resolve(); } };
    win.webContents.debugger.on("message", complete);
  });
  await cdp("Tracing.end"); await traced;
  win.webContents.debugger.removeListener("message", handler);
  const frames = sample.frames.sort((a,b)=>a-b);
  const phase = { name, p95: frames[Math.floor(frames.length*.95)], max: Math.max(...frames), commits: sample.commits.length,
    commitSamples: sample.commits,
    transformValues: new Set(sample.transforms).size, leaving: sample.leaving, renderer: {}, trace: {} };
  for (const key of ["LayoutCount","LayoutDuration","RecalcStyleDuration","ScriptDuration"]) phase.renderer[key] = (after[key]-before[key])*(key.endsWith("Duration")?1000:1);
  for (const type of ["Layout","Paint","PrePaint","Layerize","UpdateLayerTree","Commit","CompositeLayers"]) {
    const matching = events.filter(e=>e.name===type&&e.ph==="X");
    phase.trace[type] = { count: matching.length, ms: matching.reduce((sum,e)=>sum+(e.dur||0),0)/1000 };
  }
  phase.traceFile = `incremental-trace-${report.phases.length + 1}.json`;
  fs.writeFileSync(path.join(directory, phase.traceFile), JSON.stringify({ traceEvents: events }));
  report.phases.push(phase);
  console.log(JSON.stringify(phase));
  return phase;
}
async function favorite(name, label) {
  await js(`document.querySelector('[aria-label="项目操作：${name}"]').focus();document.querySelector('[aria-label="项目操作：${name}"]').click()`);
  await until(`Boolean([...document.querySelectorAll('[role="menuitem"]')].find(b=>b.textContent.trim()==='${label}'))`);
  const selector=baseline ? `.project-list-row:has([aria-label="项目操作：${name}"])` : `[data-project-motion="fixture-project-${Number(name.split(" ")[1])}"]`;
  assert(await js(`Boolean(document.querySelector(${JSON.stringify(selector)}))`),"measure the real project in both builds");
  return measure(`project-${name}-${label}`, click(label), selector);
}
app.whenReady().then(async () => {
  win = new BrowserWindow({ width: 1440, height: 1000, show: true, webPreferences: { contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } });
  win.webContents.on("console-message", e => { if(e.level>=3) console.error(e.message); });
  await win.loadFile(path.join(directory,"index.html"));
  win.webContents.debugger.attach("1.3"); await cdp("Performance.enable");
  await until("Boolean(window.incrementalMotion)");
  // Explicit typed-IPC shaped fixture; also allows rerunning an already-built baseline.
  await js(`(async()=>{const data=await openmind.listProjects();openmind.listProjects=async()=>[...data];openmind.updateProject=async({projectName,...patch})=>{const i=data.findIndex(p=>p.name===projectName);data[i]={...data[i],...patch};return data[i]}})()`);
  for (const rate of [1,4]) {
    await cdp("Emulation.setCPUThrottlingRate",{rate});
    await js("incrementalMotion.scene('contexts');incrementalMotion.contexts(6)"); await delay(600);
    const removed=await measure(`context-remove-cpu${rate}`,"incrementalMotion.remove('context-1')","[data-context-motion],.context-chip-drag");
    const reordered=await measure(`context-reorder-cpu${rate}`,"incrementalMotion.reorder('context-0','context-4')","[data-context-motion],.context-chip-drag");
    assert(await js("!document.querySelector('[aria-label=\"删除引用：引用 1\"]')"));
    if(!baseline){assert(removed.transformValues>2,"removal must move surviving chips");assert(reordered.transformValues>2,"reorder must animate positions");}
    await js("incrementalMotion.contexts(1)"); await delay(400);
    await measure(`context-last-cpu${rate}`,"incrementalMotion.remove('context-0')","[data-context-motion]");
    assert(await js("!document.querySelector('.context-tray')"),"last context must finish exiting");
    await js("incrementalMotion.scene('projects')"); await until("document.querySelectorAll('.project-list-row').length===12"); await delay(500);
    const moved=await favorite("项目 03",rate===1?"收藏":"取消收藏");
    if(!baseline) assert(moved.transformValues>2,"cross-group shared object must move");
  }
  await cdp("Emulation.setCPUThrottlingRate",{rate:1});
  // Bound the same simple operations in both builds. Scrolled dropdowns below
  // also commit their anchor/focus updates; their raw samples remain in the report.
  assert(report.phases.filter(p=>p.name.startsWith('context-reorder')||p.name.startsWith('project-')).every(p=>p.commits<=4),"simple position interpolation must not render React every frame");
  {
    const selector=baseline ? '.project-list-row:has([aria-label="项目操作：项目 03"])' : '[data-project-motion="fixture-project-3"]';
    const y = () => js(`document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect().top`);
    const before = await y();
    await js("document.querySelector('[aria-label=\"项目操作：项目 03\"]').focus();document.querySelector('[aria-label=\"项目操作：项目 03\"]').click()"); await delay(80);
    await js(click("收藏")); await delay(50); const middle=await y(); await delay(400); const after=await y();
    report.projectGeometry = { before, middle, after };
    if(baseline) {
      assert(Math.abs(middle-after)<Math.abs(before-after)/4,"baseline must detect the jump close to the destination");
      report.assertions.push("baseline detects the real project jumping to its destination");
    } else {
    assert(Math.abs(middle-before)>1&&Math.abs(middle-after)>1,"shared project must pass through a real intermediate position");
    assert(middle>=Math.min(before,after)-1&&middle<=Math.max(before,after)+1,"shared project must follow the source-to-target path");
    assert(await js("document.activeElement?.getAttribute('aria-label')==='项目操作：项目 03'"),"cross-group move must restore focus to the new trigger");
    report.assertions.push("shared project intermediate geometry", "cross-group focus restoration");
    fs.writeFileSync(path.join(directory,"projects.png"),(await win.webContents.capturePage()).toPNG());
    await favorite("项目 00","取消收藏"); await favorite("项目 03","取消收藏");
    assert(await js("!document.querySelector('[aria-label=\"收藏\"].project-list-group')"),"empty favorite group must disappear");
    await favorite("项目 03","收藏");
    report.assertions.push("first and last favorite group transitions");
    await js("document.querySelector('[aria-label=\"项目操作：项目 03\"]').click()");
    await until("Boolean([...document.querySelectorAll('[role=\"menuitem\"]')].find(b=>b.textContent.trim()==='取消收藏'))");
    await js(click("取消收藏")); await delay(40);
    await js("document.querySelector('[aria-label=\"项目操作：项目 03\"]').click()");
    await until("Boolean([...document.querySelectorAll('[role=\"menuitem\"]')].find(b=>b.textContent.trim()==='收藏'))");
    await js(click("收藏")); await delay(450);
    assert(await js("document.querySelector('[data-project-motion=\"fixture-project-3\"]').closest('section').getAttribute('aria-label')==='收藏'"));
    assert(await js("[...document.querySelectorAll('[data-project-motion]')].every(e=>getComputedStyle(e).transform==='none')"));
    report.assertions.push("rapid favorite reversal settles to latest group");
    await js("document.querySelector('.project-list-scroll').style.maxHeight='240px';document.querySelector('.project-list-scroll').scrollTop=80"); await delay(100);
    await favorite("项目 08","收藏");
    assert(await js("document.querySelector('.project-list-scroll').scrollTop>0"),"shared move must preserve project scroll");
    const projectReducedBefore=await js("document.querySelectorAll('.project-list-row').length");
    await cdp("Emulation.setEmulatedMedia",{features:[{name:"prefers-reduced-motion",value:"reduce"}]}); await delay(100);
    const noProjectMotion=await favorite("项目 08","取消收藏");
    assert.equal(noProjectMotion.transformValues,0,"reduced motion must skip shared layout");
    assert.equal(await js("document.querySelectorAll('.project-list-row').length"),projectReducedBefore);
    await cdp("Emulation.setEmulatedMedia",{features:[{name:"prefers-reduced-motion",value:"no-preference"}]}); await delay(100);
    await js("incrementalMotion.scene('contexts');(()=>{const data=Array.from({length:60},(_,i)=>({id:'large-'+i,name:'长列表 '+i,description:'',status:'active',favorite:false,materialCount:0,taskCount:0,outputCount:0,createdAt:'2026-09-17',updatedAt:'2026-09-17'}));openmind.listProjects=async()=>[...data];openmind.updateProject=async({projectName,...patch})=>{const i=data.findIndex(p=>p.name===projectName);data[i]={...data[i],...patch};return data[i]}})()"); await delay(100);
    await js("incrementalMotion.scene('projects')"); await until("document.querySelectorAll('.project-list-row').length===60"); await delay(400);
    await js("document.querySelector('[aria-label=\"项目操作：长列表 3\"]').click()"); await delay(80);
    const largeProject=await measure("project-budget",click("收藏"),"[data-project-motion]");
    assert.equal(largeProject.transformValues,0,"large project collections must skip shared layout");
    assert(await js("document.querySelectorAll('.project-list-row').length===60"));
    report.assertions.push("project scroll preserved", "project reduced motion", "60 project rows remain available");
    }
  }
  await js("incrementalMotion.scene('providers')"); await delay(400);
  await js("document.querySelector('[aria-label=\"添加 Provider\"]').focus();"+click("添加 Provider")); await until("Boolean(document.querySelector('.settings-provider-dialog'))"); await delay(300);
  const closed=await measure("provider-add-close","document.querySelector('[aria-label=\"关闭添加 Provider 弹窗\"]').click()",".settings-provider-dialog");
  if(!baseline) assert(closed.leaving,"provider must retain CSS exit");
  assert(await js("!document.querySelector('.settings-provider-dialog')"));
  if(!baseline) assert(await js("document.activeElement?.getAttribute('aria-label')==='添加 Provider'"),"provider focus must return to trigger");
  await js("[...document.querySelectorAll('button')].find(b=>b.getAttribute('aria-label')?.includes('编辑')&&b.textContent.includes('Fixture Provider')).click()");
  await until("Boolean(document.querySelector('.settings-provider-dialog'))"); await delay(300);
  const edited=await measure("provider-edit-close", "[...document.querySelectorAll('.settings-provider-dialog button')].find(b=>b.textContent.trim()==='取消').click()", ".settings-provider-dialog");
  if(!baseline) assert(edited.leaving,"edit provider must retain exit");
  if(!baseline) {
    await cdp("Emulation.setEmulatedMedia",{features:[{name:"prefers-reduced-motion",value:"reduce"}]}); await delay(100);
    await js(click("添加 Provider")); await until("Boolean(document.querySelector('.settings-provider-dialog'))");
    win.setSize(900,700); await delay(100);
    assert(await js("(()=>{const r=document.querySelector('.settings-provider-dialog').getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight})()"),"provider must fit a resized window");
    await js("document.querySelector('[aria-label=\"关闭添加 Provider 弹窗\"]').click()"); await delay(30);
    assert(await js("!document.querySelector('.settings-provider-dialog')"),"provider reduced motion must skip exit delay");
    win.setSize(1440,1000);
    await cdp("Emulation.setEmulatedMedia",{features:[{name:"prefers-reduced-motion",value:"no-preference"}]}); await delay(100);
    report.assertions.push("provider reduced motion and window resize");
  }
  await js("incrementalMotion.scene('contexts');incrementalMotion.contexts(6)"); await delay(400);
  if(!baseline) {
    await js("document.querySelector('[aria-label=\"fixture-0.md\"]').click()");
    await until("Boolean(document.querySelector('.context-chip-popover'))");
    await js("[...document.querySelectorAll('.context-chip-popover button')].find(b=>b.textContent.trim()==='后移').focus();[...document.querySelectorAll('.context-chip-popover button')].find(b=>b.textContent.trim()==='后移').click()");
    assert(await js("document.querySelector('.context-chip-popover')?.hasAttribute('inert')"));
    await delay(400);
    assert(await js("!document.querySelector('.context-chip-popover')"));
    assert(await js("document.activeElement?.getAttribute('aria-label')==='fixture-0.md'"));
    report.assertions.push("reorder dismisses stale detail anchor and restores chip focus");
    await js("incrementalMotion.contexts(1,true)"); await delay(400);
    const height=await js("document.querySelector('.context-tray').getBoundingClientRect().height");
    await js("incrementalMotion.remove('context-0')"); await delay(40);
    assert.equal(await js("document.querySelector('.context-tray')?.getBoundingClientRect().height"),height,"last image must retain tray height while exiting");
    await delay(300);
    assert(await js("!document.querySelector('.context-tray')"));
    report.assertions.push("last image exit retains tray height");
    await js("incrementalMotion.contexts(6)"); await delay(400);
  }
  await measure("context-rapid", "incrementalMotion.reorder('context-0','context-4');setTimeout(()=>incrementalMotion.reorder('context-0','context-2'),40);setTimeout(()=>incrementalMotion.remove('context-3'),70)", "[data-context-motion]");
  assert(await js("[...document.querySelectorAll('.context-chip-drag .ui-disclosure-trigger span')].map(e=>e.textContent).join(',')==='引用 1,引用 0,引用 2,引用 4,引用 5'"),"rapid actions must converge");
  await js("incrementalMotion.reorder('context-0','context-5')"); await delay(40);
  win.setSize(900,700); await delay(80); win.setSize(1440,1000); await delay(400);
  assert(await js("[...document.querySelectorAll('[data-context-motion]')].every(e=>getComputedStyle(e).transform==='none')"),"resize must settle transforms");
  await js("document.querySelector('.composer').style.position='fixed';document.querySelector('.composer').style.width='600px';incrementalMotion.contexts(6)"); await delay(400);
  const fixed=await measure("context-fixed-host", "incrementalMotion.reorder('context-0','context-4')", "[data-context-motion]");
  if(!baseline) assert(fixed.transformValues>2,"a fixed composer host must preserve position interpolation");
  assert(await js("[...document.querySelectorAll('[data-context-motion]')].every(e=>getComputedStyle(e).transform==='none')"));
  await js("document.querySelector('.composer').style.removeProperty('position');document.querySelector('.composer').style.removeProperty('width')");
  report.assertions.push("fixed composer host settles with document scroll locked");
  // Exercise the real native DnD event handlers; the OS drag ghost is not replaced.
  await js("incrementalMotion.contexts(6)"); await delay(400);
  await js("document.querySelector('#root').setAttribute('data-nav-transitioning','')"); await delay(50);
  const navBlocked=await measure("context-during-navigation", "incrementalMotion.reorder('context-0','context-4')", "[data-context-motion]");
  assert.equal(navBlocked.transformValues,0,"navigation must suppress collection measurements/interpolation");
  await js("document.querySelector('#root').removeAttribute('data-nav-transitioning');incrementalMotion.contexts(6)"); await delay(400);
  const held=await measure("context-native-drag", "document.querySelectorAll('.context-chip-drag')[0].dispatchEvent(new DragEvent('dragstart',{bubbles:true,dataTransfer:new DataTransfer()}))", "[data-context-motion]");
  assert.equal(held.transformValues,0,"native dragging must not trigger layout interpolation");
  const dropped=await measure("context-native-drop", "document.querySelectorAll('.context-chip-drag')[3].dispatchEvent(new DragEvent('drop',{bubbles:true,dataTransfer:new DataTransfer()}))", "[data-context-motion]");
  if(!baseline) assert(dropped.transformValues>2,"native drop must animate to the committed order");
  assert(await js("[...document.querySelectorAll('.context-chip-drag .ui-disclosure-trigger span')].map(e=>e.textContent).join(',')==='引用 1,引用 2,引用 3,引用 0,引用 4,引用 5'"));
  await js("incrementalMotion.contexts(20)"); await delay(400);
  await js("document.querySelector('.context-chips').scrollLeft=200"); await delay(100);
  await measure("context-scrolled", "incrementalMotion.reorder('context-8','context-4')", "[data-context-motion]");
  assert(await js("document.querySelector('.context-chips').scrollLeft>0"),"scroll offset must be preserved");
  await js("incrementalMotion.contexts(50)"); await delay(400);
  const large=await measure("context-budget", "incrementalMotion.reorder('context-0','context-4')", "[data-context-motion]");
  assert.equal(large.transformValues,0,"large collection must skip layout animation");
  assert(await js("document.querySelectorAll('.context-chip-drag').length===50"),"motion budget must not truncate data");
  await js("incrementalMotion.contexts(6)"); await delay(400);
  report.assertions.push("rapid reorder/delete latest intent", "window resize settles");
  await cdp("Emulation.setEmulatedMedia",{features:[{name:"prefers-reduced-motion",value:"reduce"}]}); await delay(100);
  const reduced=await measure("context-reduced", "incrementalMotion.reorder('context-0','context-5')", "[data-context-motion]");
  assert(reduced.transformValues<=1,"reduced motion must not interpolate");
  await js("incrementalMotion.contexts(1);incrementalMotion.remove('context-0')"); await delay(30);
  assert(await js("!document.querySelector('.context-tray')"),"reduced motion must skip last exit delay");
  await cdp("Emulation.setEmulatedMedia",{features:[{name:"prefers-reduced-motion",value:"no-preference"}]}); await delay(100);
  await js("incrementalMotion.contexts(6)"); await delay(400);
  await js("incrementalMotion.reorder('context-0','context-5')"); await delay(40);
  await cdp("Emulation.setEmulatedMedia",{features:[{name:"prefers-reduced-motion",value:"reduce"}]}); await delay(40);
  assert(await js("[...document.querySelectorAll('[data-context-motion]')].every(e=>getComputedStyle(e).transform==='none')"),"live preference change must settle painted layout");
  assert(report.phases.some(p=>p.commits>0),"profiling must actually collect commits");
  report.assertions.push("reduced motion has no interpolation or exit delay", "live preference change settles", "React Profiler positive control", "native DnD drop", "horizontal scroll", "large collection budget preserves all items");
  fs.writeFileSync(path.join(directory,"incremental-report.json"),JSON.stringify(report,null,2));
  fs.mkdirSync(path.resolve(__dirname,"../.build"),{recursive:true});
  fs.writeFileSync(path.resolve(__dirname,`../.build/incremental-motion-${baseline?"before":"after"}.json`),JSON.stringify(report,null,2));
  fs.writeFileSync(path.join(directory,"incremental.png"),(await win.webContents.capturePage()).toPNG());
  clearTimeout(watchdog); win.destroy(); app.quit();
}).catch(error=>{ console.error(error); fs.writeFileSync(path.join(directory,"incremental-failure.json"),JSON.stringify({ ...report, error: String(error) },null,2)); app.exit(1); });
