const { app, BrowserWindow } = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const directory = process.env.OPENMIND_DOCUMENT_PERF_DIR;
const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
const percentile = (values, q) => values.slice().sort((a, b) => a - b)[Math.floor((values.length - 1) * q)] || 0;
const metrics = result => Object.fromEntries(result.metrics.map(metric => [metric.name, metric.value]));
app.commandLine.appendSwitch("disable-gpu");
app.setPath("userData", path.join(directory, "user-data"));
app.on("window-all-closed", () => {});
const reports = [];
const violations = [];
const watchdog = setTimeout(() => { console.error("Document performance timed out"); app.exit(2); }, 180000);

app.whenReady().then(async () => {
  for (const mode of ["markdown", "pdf"]) for (const pages of [10, 200, 500]) {
    const win = new BrowserWindow({ width: 1600, height: 1000, show: true, webPreferences: { backgroundThrottling: false } });
    const errors = [];
    win.webContents.on("console-message", event => { if (event.level >= 3) errors.push(event.message); });
    const js = source => win.webContents.executeJavaScript(source);
    await win.loadFile(path.join(directory, "index.html"), { query: { mode, pages: String(pages) } });
    win.webContents.debugger.attach("1.3");
    await win.webContents.debugger.sendCommand("Performance.enable");
    for (let i = 0; i < 200; i++) {
      if (await js(mode === "pdf" ? "Boolean(document.querySelector('.pdfViewer canvas'))" : "Boolean(document.querySelector('[data-document-block]'))")) break;
      if (await js("Boolean(window.error || document.querySelector('[role=alert]'))")) throw new Error(await js("window.error || document.querySelector('[role=alert]').textContent"));
      await delay(50);
    }
    assert(await js(mode === "pdf" ? "Boolean(document.querySelector('.pdfViewer canvas'))" : "Boolean(document.querySelector('[data-document-block]'))"), `${mode} failed to load: ${errors.join("\n")}`);
    await delay(800);
    const initial = metrics(await win.webContents.debugger.sendCommand("Performance.getMetrics"));
    await delay(500);
    const idle = metrics(await win.webContents.debugger.sendCommand("Performance.getMetrics"));
    await js(`window.sample={frames:[],longTasks:[],active:true,last:0};function tick(t){const s=window.sample;if(!s.active)return;if(s.last)s.frames.push(t-s.last);s.last=t;requestAnimationFrame(tick)}requestAnimationFrame(tick);new PerformanceObserver(l=>{if(window.sample.active)window.sample.longTasks.push(...l.getEntries().map(e=>e.duration))}).observe({type:'longtask'});window.stats.renders=0;`);
    if (process.env.OPENMIND_DOCUMENT_PROFILE) { await win.webContents.debugger.sendCommand("Profiler.enable"); await win.webContents.debugger.sendCommand("Profiler.start"); }
    const before = metrics(await win.webContents.debugger.sendCommand("Performance.getMetrics"));
    const position = await js("(()=>{const r=document.querySelector('.column-splitter').getBoundingClientRect();return{x:Math.round(r.x+r.width/2),y:400}})()");
    const widths = [];
    const contentSizes = [];
    win.webContents.sendInputEvent({ type: "mouseMove", ...position });
    win.webContents.sendInputEvent({ type: "mouseDown", button: "left", clickCount: 1, ...position });
    await delay(50);
    for (let i = 1; i <= 24; i++) {
      win.webContents.sendInputEvent({ type: "mouseMove", x: position.x - i * 6, y: position.y, movementX: -6, movementY: 0, modifiers: ["leftButtonDown"] });
      await js("new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))");
      widths.push(await js("document.querySelector('.ai-file-preview').getBoundingClientRect().width"));
      contentSizes.push(await js(mode === "pdf" ? "document.querySelector('.pdfViewer .page').getBoundingClientRect().width" : "document.querySelector('[data-document-block] p').getBoundingClientRect().height"));
    }
    win.webContents.sendInputEvent({ type: "mouseUp", button: "left", clickCount: 1, x: position.x - 144, y: position.y });
    await delay(200);
    const after = metrics(await win.webContents.debugger.sendCommand("Performance.getMetrics"));
    if (process.env.OPENMIND_DOCUMENT_PROFILE) fs.writeFileSync(path.join(directory, `${mode}-${pages}.cpuprofile`), JSON.stringify((await win.webContents.debugger.sendCommand("Profiler.stop")).profile));
    const result = await js("window.sample.active=false;({fixture:window.fixture,stats:window.stats,sample:window.sample,nodes:document.querySelectorAll('*').length,blocks:document.querySelectorAll('[data-document-block]').length,canvases:document.querySelectorAll('canvas').length,error:window.error})");
    const report = { ...result, errors, widths, contentSizes, idleScriptMs: (idle.ScriptDuration - initial.ScriptDuration) * 1000, layoutMs: (after.LayoutDuration - before.LayoutDuration) * 1000,
      scriptMs: (after.ScriptDuration - before.ScriptDuration) * 1000, p95FrameMs: percentile(result.sample.frames, .95), maxFrameMs: Math.max(...result.sample.frames) };
    reports.push(report);
    console.log(JSON.stringify({ ...report, sample: undefined, widths: [widths[0], widths.at(-1)], contentSizes: [contentSizes[0], contentSizes.at(-1)] }));
    assert(!report.error, report.error);
    assert.equal(errors.length, 0, errors.join("\n"));
    assert(Math.abs(widths.at(-1) - widths[0]) > 100, "Panel must resize before pointerup");
    assert(Math.abs(contentSizes.at(-1) - contentSizes[0]) > 5, "Text must rewrap / PDF must rescale during the drag, not on release");
    assert(report.stats.renders <= 2, "Dragging must not rerender the parent per movement");
    assert(mode !== "markdown" || report.blocks < 50, "Markdown DOM must be viewport bounded");
    assert(mode !== "pdf" || report.canvases <= 10, "PDF canvases must be cache bounded");
    assert(report.idleScriptMs < 20, "An idle document must not keep scheduling rendering work");
    if (report.p95FrameMs >= 50) violations.push(`${mode} ${pages}: drag P95 ${report.p95FrameMs.toFixed(1)}ms exceeds 50ms`);
    if (mode === "markdown") {
      await js("document.querySelector('[aria-label=搜索文档]').click()");
      await js(`(()=>{const input=document.querySelector('[aria-label=搜索文档内容]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'END-OF-DOCUMENT-SEARCH-TARGET');input.dispatchEvent(new Event('input',{bubbles:true}))})()`);
      await delay(400);
      assert.equal(await js("window.selectionText()"), "END-OF-DOCUMENT-SEARCH-TARGET", "Search must find unmounted content");
      assert.equal(await js("document.activeElement?.getAttribute('aria-label')"), "搜索文档内容", "Find must retain keyboard focus");
      await js("document.querySelector('.document-reader').dispatchEvent(new KeyboardEvent('keydown',{key:'a',ctrlKey:true,bubbles:true}))");
      await delay(100);
      assert((await js("window.selectionText()?.length || 0")) > result.fixture.chars * .85, "Select all must include unmounted blocks");
      await js(`window.getSelection().removeAllRanges();document.querySelector('[aria-label=关闭搜索]').click();document.querySelector('.ai-file-preview-body').scrollTop=document.querySelector('.ai-file-preview-body').scrollHeight/2;window.readAnchor=()=>{const y=document.querySelector('.ai-file-preview-body').getBoundingClientRect().top+1;const b=Array.from(document.querySelectorAll('[data-document-block]')).find(e=>{const r=e.getBoundingClientRect();return r.top<=y&&r.bottom>y});return b?{index:Number(b.dataset.documentBlock),offset:y-b.getBoundingClientRect().top}:null};void 0`);
      await delay(300);
      const anchor = await js("window.readAnchor()");
      assert(anchor, "Middle of document must contain a mounted reading block");
      const middle = await js("(()=>{const r=document.querySelector('.column-splitter').getBoundingClientRect();return{x:Math.round(r.x+r.width/2),y:400}})()");
      win.webContents.sendInputEvent({ type: "mouseMove", ...middle });
      win.webContents.sendInputEvent({ type: "mouseDown", button: "left", clickCount: 1, ...middle });
      for (let i = 1; i <= 12; i++) {
        win.webContents.sendInputEvent({ type: "mouseMove", x: middle.x + i * 8, y: middle.y, modifiers: ["leftButtonDown"] });
        await js("new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))");
      }
      win.webContents.sendInputEvent({ type: "mouseUp", button: "left", clickCount: 1, x: middle.x + 96, y: middle.y });
      await delay(300);
      report.anchor = { before: anchor, after: await js("window.readAnchor()") };
      assert.equal(report.anchor.after?.index, anchor.index, "Resize must preserve the reading paragraph");
      assert(await js(`(()=>{const rows=Array.from(document.querySelectorAll('[data-document-block]'));return rows.every((row,i)=>!rows[i+1]||Number(rows[i+1].dataset.documentBlock)!==Number(row.dataset.documentBlock)+1||row.getBoundingClientRect().bottom<=rows[i+1].getBoundingClientRect().top+1)})()`), "Measured blocks must not overlap after resize");
    } else {
      await js(`(()=>{const input=document.querySelector('[aria-label=当前页码]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'${pages}');input.dispatchEvent(new Event('input',{bubbles:true}));input.focus()})()`);
      await delay(30);
      await js("document.querySelector('[aria-label=当前页码]').blur()");
      await delay(300);
      assert.equal(await js("document.querySelector('[aria-label=当前页码]').value"), String(pages), "PDF must navigate to an offscreen page");
      await js(`document.querySelector('button[aria-label="搜索 PDF"]').click()`);
      await js(`(()=>{const input=document.querySelector('input[aria-label="搜索 PDF"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'Synthetic PDF page ${pages}, line 1.');input.dispatchEvent(new Event('input',{bubbles:true}))})()`);
      for (let i = 0; i < 100; i++) { if (await js("Boolean(document.querySelector('.textLayer .highlight'))")) break; await delay(50); }
      assert(await js("Boolean(document.querySelector('.textLayer .highlight'))"), "PDF search must find the offscreen final page");
    }
    if (pages === 200) fs.writeFileSync(path.join(directory, `${mode}.png`), (await win.webContents.capturePage()).toPNG());
    await js("window.reopen()");
    await delay(800);
    const reopenError = await js("window.error || document.querySelector('[role=alert]')?.textContent || ''");
    assert(!reopenError, `Reopening must clean up the old document: ${reopenError}`);
    fs.writeFileSync(path.join(directory, "report.json"), JSON.stringify(reports, null, 2));
    win.destroy();
  }
  assert.equal(violations.length, 0, violations.join("\n"));
  clearTimeout(watchdog); app.quit();
}).catch(error => { fs.writeFileSync(path.join(directory, "report.json"), JSON.stringify(reports, null, 2)); console.error(error); app.exit(1); });
