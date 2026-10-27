const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const output = path.join(root, '.tmp', 'tabs-motion');

if (!process.env.OPENMIND_UI_CATALOG_USER_DATA_DIR) {
  fs.mkdirSync(output, { recursive: true });
  require('esbuild').buildSync({
    entryPoints: [path.join(root, 'renderer/dev/ui-catalog.tsx')], outfile: path.join(output, 'catalog.js'),
    bundle: true, platform: 'browser', format: 'iife', target: 'chrome140', jsx: 'automatic', minify: true,
    loader: { '.ttf': 'file', '.woff': 'file', '.woff2': 'file', '.jpg': 'file' },
    define: { 'process.env.NODE_ENV': '"production"' }
  });
  fs.writeFileSync(path.join(output, 'index.html'), '<!doctype html><html><head><link rel="stylesheet" href="catalog.css"></head><body><div id="root"></div><script src="catalog.js"></script></body></html>');
  const environment = { ...process.env };
  delete environment.ELECTRON_RUN_AS_NODE;
  const { runWithTemporaryProfile } = require('./ui-contract/temporary-profile.cjs');
  const result = runWithTemporaryProfile(require('electron'), ['--no-sandbox', __filename], { cwd: root, env: environment, stdio: 'inherit', windowsHide: true });
  if (result.error) throw result.error;
  process.exit(result.status ?? 1);
}

const { app, BrowserWindow } = require('electron');
app.setPath('userData', process.env.OPENMIND_UI_CATALOG_USER_DATA_DIR);
app.commandLine.appendSwitch('disable-gpu');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.whenReady().then(async () => {
  let phase = 'creating window';
  const deadline = setTimeout(() => { console.error(`Tabs motion smoke timed out: ${phase}`); app.exit(1); }, 30000);
  deadline.unref();
  const win = new BrowserWindow({ width: 1000, height: 1000, show: true, webPreferences: { sandbox: true, contextIsolation: true, backgroundThrottling: false } });
  const js = code => win.webContents.executeJavaScript(code, true);
  const media = reduce => win.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: reduce ? 'reduce' : 'no-preference' }] });
  phase = 'loading catalog';
  await win.loadFile(path.join(output, 'index.html'), { query: { case: 'navigation-controls', theme: 'light' } });
  win.webContents.debugger.attach('1.3');
  phase = 'emulating motion preference';
  await media(false);
  phase = 'waiting for tab layout';
  await js(`new Promise((resolve, reject) => { const end = Date.now() + 10000; function check() { if (document.querySelector('.ui-tabs[data-variant="pill"][data-motion-ready]')) resolve(); else if (Date.now() > end) reject(new Error('Tabs did not initialize')); else requestAnimationFrame(check); } check(); })`);
  phase = 'waiting for fonts';
  await js('document.fonts.ready.then(() => true)');
  const frame = () => js('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
  await frame();
  phase = 'sampling sliding transition';
  const normal = await js(`(async () => {
    const root = document.querySelector('.ui-tabs[data-variant="pill"]');
    const read = () => { const style = getComputedStyle(root, '::before'); return { x: new DOMMatrix(style.transform).m41, width: parseFloat(style.width) }; };
    const initial = read();
    root.querySelector('[data-value="tasks"]').click();
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const transitions = root.getAnimations({ subtree: true }).filter(animation => animation.transitionProperty === 'transform' && animation.effect?.pseudoElement === '::before');
    const animation = transitions[0];
    if (!animation) throw new Error('Pill selection has no sliding transform transition');
    animation.pause();
    const duration = animation.effect.getTiming().duration;
    animation.currentTime = duration / 2;
    const middle = read();
    for (const item of root.getAnimations({ subtree: true })) item.finish();
    const final = read();
    return { initial, middle, final, duration, targetX: parseFloat(root.style.getPropertyValue('--tab-indicator-x')), selected: root.querySelector('[aria-selected="true"]').dataset.value };
  })()`);
  assert.ok(normal.initial.x > normal.final.x, 'The selected background must move to the clicked tab');
  assert.ok(normal.middle.x > normal.final.x && normal.middle.x < normal.initial.x, 'The midpoint must interpolate between tabs');
  assert.ok(Math.abs(normal.final.x - normal.targetX) < 1, 'The background must settle on the selected tab');
  assert.equal(normal.selected, 'tasks');
  assert.ok(normal.duration > 0 && normal.duration <= 300);
  const rapid = await js(`(async () => {
    const root = document.querySelector('.ui-tabs[data-variant="pill"]');
    const frame = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    root.querySelector('[data-value="materials"]').click(); await frame();
    root.querySelector('[data-value="tasks"]').click(); await frame();
    for (const animation of root.getAnimations({ subtree: true })) animation.finish();
    const active = root.querySelector('[aria-selected="true"]');
    return { selected: active.dataset.value, x: new DOMMatrix(getComputedStyle(root, '::before').transform).m41, target: active.offsetLeft };
  })()`);
  assert.equal(rapid.selected, 'tasks');
  assert.ok(Math.abs(rapid.x - rapid.target) < 1);
  await media(true);
  await frame();
  const reduced = await js(`(async () => {
    const root = document.querySelector('.ui-tabs[data-variant="pill"]');
    root.querySelector('[data-value="materials"]').click();
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const active = root.querySelector('[aria-selected="true"]');
    return { reduced: matchMedia('(prefers-reduced-motion: reduce)').matches, transition: getComputedStyle(root, '::before').transitionDuration, x: new DOMMatrix(getComputedStyle(root, '::before').transform).m41, target: active.offsetLeft };
  })()`);
  assert.equal(reduced.reduced, true);
  assert.equal(reduced.transition, '0s');
  assert.ok(Math.abs(reduced.x - reduced.target) < 1);
  const report = { normal, rapid, reduced };
  fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
  clearTimeout(deadline);
  win.destroy();
}).catch(error => { console.error(error); process.exitCode = 1; }).finally(() => { for (const win of BrowserWindow.getAllWindows()) win.destroy(); app.quit(); });
