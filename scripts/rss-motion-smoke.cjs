const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..'), output = path.join(root, '.tmp/rss-motion');
if (!process.env.OPENMIND_UI_CATALOG_USER_DATA_DIR) {
  fs.mkdirSync(output, { recursive: true });
  require('esbuild').buildSync({ entryPoints: [path.join(root, 'renderer/dev/ui-catalog.tsx')], outfile: path.join(output, 'catalog.js'), bundle: true, platform: 'browser', format: 'iife', target: 'chrome140', jsx: 'automatic', minify: true, loader: { '.ttf': 'file', '.woff': 'file', '.woff2': 'file', '.jpg': 'file' }, define: { 'process.env.NODE_ENV': '"production"' } });
  fs.writeFileSync(path.join(output, 'index.html'), '<!doctype html><html><head><link rel="stylesheet" href="catalog.css"></head><body><div id="root"></div><script src="catalog.js"></script></body></html>');
  const environment = { ...process.env }; delete environment.ELECTRON_RUN_AS_NODE;
  const electron = require('electron'), virtual = process.platform === 'linux' && !environment.DISPLAY;
  const { runWithTemporaryProfile } = require('./ui-contract/temporary-profile.cjs');
  const result = runWithTemporaryProfile(virtual ? 'xvfb-run' : electron, [...(virtual ? ['-a', electron] : []), '--no-sandbox', __filename], { cwd: root, env: environment, stdio: 'inherit' });
  if (result.error) throw result.error; process.exit(result.status ?? 1);
}
const { app, BrowserWindow } = require('electron');
app.setPath('userData', process.env.OPENMIND_UI_CATALOG_USER_DATA_DIR);
for (const flag of ['disable-gpu', 'disable-renderer-backgrounding', 'disable-backgrounding-occluded-windows', 'disable-background-timer-throttling']) app.commandLine.appendSwitch(flag);
app.whenReady().then(async () => {
  let phase = 'creating window';
  const deadline = setTimeout(() => { console.error(`RSS motion timed out: ${phase}`); app.exit(1); }, 60000); deadline.unref();
  const win = new BrowserWindow({ width: 1000, height: 1000, show: true, webPreferences: { sandbox: true, contextIsolation: true, backgroundThrottling: false } });
  const errors = []; win.webContents.on('console-message', event => { if (event.level >= 3) errors.push(event.message); });
  const js = code => win.webContents.executeJavaScript(code, true);
  const frame = () => js('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
  const wait = predicate => js(`new Promise((resolve, reject) => { const end = performance.now() + 10000; function tick() { if (${predicate}) resolve(); else if (performance.now() > end) reject(new Error('Timed out: ' + ${JSON.stringify(predicate)})); else requestAnimationFrame(tick); } tick(); })`);
  const capture = async name => fs.writeFileSync(path.join(output, `${name}.png`), (await win.webContents.capturePage()).toPNG());
  const media = reduced => win.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: reduced ? 'reduce' : 'no-preference' }] });
  const readStyle = `(() => { const node = document.querySelector('.ui-dialog'), mask = document.querySelector('[data-ui-dialog]'); if (!node) return null; const style = getComputedStyle(node), matrix = new DOMMatrix(style.transform); return { opacity: Number(style.opacity), y: matrix.m42, scale: matrix.a, mask: Number(getComputedStyle(mask).opacity), text: node.textContent.length, focused: node.contains(document.activeElement) }; })()`;
  const report = { platform: process.platform, dialogs: {}, tabs: {}, interruptions: null, reduced: null };
  for (const [name, scenario, selector] of [['skills', 'skill-library-explore', '.skill-library-card-select'], ['rss', 'rss-source-cards', '.rss-card-subject']]) {
    phase = `${name}: load`;
    await win.loadFile(path.join(output, 'index.html'), { query: { case: scenario, theme: 'light' } });
    if (!win.webContents.debugger.isAttached()) win.webContents.debugger.attach('1.3');
    await media(false);
    await wait(`document.querySelector(${JSON.stringify(selector)})`); await js('document.fonts.ready.then(() => true)'); await frame();
    const geometry = await js(`(() => { const node = document.querySelector(${JSON.stringify(selector)}); node.focus(); const box = node.getBoundingClientRect(); return { x: box.x, y: box.y, width: box.width, height: box.height, motion: node.dataset.motion, outline: getComputedStyle(node).outlineStyle }; })()`);
    assert.equal(geometry.motion, 'selection'); assert.notEqual(geometry.outline, 'none');
    await js(`document.querySelector(${JSON.stringify(selector)}).click()`); await wait("document.querySelector('.ui-dialog')");
    phase = `${name}: entrance frames`;
    const animations = await js(`(() => { window.rssAnimations = document.querySelector('[data-ui-dialog]').getAnimations({ subtree: true }).filter(animation => animation.animationName?.startsWith('ui-dialog')); const result = window.rssAnimations.map(animation => ({ name: animation.animationName, duration: animation.effect.getTiming().duration, easing: getComputedStyle(animation.effect.target).animationTimingFunction })); for (const animation of window.rssAnimations) { animation.pause(); animation.currentTime = 0; } return result; })()`);
    await frame(); const start = await js(readStyle); await capture(`${name}-enter-start`);
    await js('window.rssAnimations.forEach(animation => { animation.currentTime = 80; })'); await frame(); const middle = await js(readStyle); await capture(`${name}-enter-middle`);
    await js('window.rssAnimations.forEach(animation => animation.finish())'); await frame(); const end = await js(readStyle); await capture(`${name}-enter-end`);
    assert.ok(start.opacity < middle.opacity && middle.opacity < end.opacity);
    assert.ok(start.y > middle.y && middle.y > end.y && start.scale < middle.scale && middle.scale < end.scale);
    assert.equal(end.focused, true); assert.equal(end.opacity, 1);
    // A fresh, unmodified animation measures real exit time; paused entrance
    // samples above intentionally seek the CSS animation for reproducible PNGs.
    await js("document.querySelector('.ui-dialog-header button').click()"); await wait("!document.querySelector('.ui-dialog')");
    await js(`document.querySelector(${JSON.stringify(selector)}).focus(); document.querySelector(${JSON.stringify(selector)}).click()`);
    await wait("document.querySelector('.ui-dialog')"); await js('new Promise(resolve => setTimeout(resolve, 220))');
    phase = `${name}: exit frames`;
    await js(`(() => { window.rssExitFrames = []; const start = performance.now(); document.querySelector('.ui-dialog-header button').click(); function tick() { const value = ${readStyle}; window.rssExitFrames.push({ time: performance.now() - start, ...value, gone: !value }); if (value && performance.now() - start < 1000) requestAnimationFrame(tick); } requestAnimationFrame(tick); })()`);
    await js('new Promise(resolve => setTimeout(resolve, 45))'); await capture(`${name}-exit-middle`);
    await wait("!document.querySelector('.ui-dialog')"); await capture(`${name}-exit-end`);
    const exit = await js('window.rssExitFrames');
    assert.ok(exit.some(value => !value.gone && value.opacity > 0 && value.opacity < 1), JSON.stringify({ name, exit }));
    assert.ok(exit.filter(value => !value.gone).every(value => value.text > 0), 'Exit must retain the content snapshot');
    assert.ok(exit.at(-1).gone && exit.at(-1).time >= 120 && exit.at(-1).time < 500);
    assert.equal(await js(`document.activeElement === document.querySelector(${JSON.stringify(selector)})`), true);
    report.dialogs[name] = { animations, start, middle, end, exit, geometry };
    const tabs = await js(`(async () => {
      const root = document.querySelector('.ui-tabs[data-variant="pill"]'); const buttons = root.querySelectorAll('[role="tab"]');
      const read = () => ({ x: new DOMMatrix(getComputedStyle(root, '::before').transform).m41, width: parseFloat(getComputedStyle(root, '::before').width) });
      const initial = read(); buttons[1].click(); await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const animations = root.getAnimations({ subtree: true }); const slide = animations.find(animation => animation.transitionProperty === 'transform' && animation.effect?.pseudoElement === '::before');
      if (!slide) throw new Error('Missing shared pill slide'); const timing = slide.effect.getTiming(); animations.forEach(animation => { animation.pause(); animation.currentTime = timing.duration / 2; }); const middle = read(); animations.forEach(animation => animation.finish()); const end = read();
      buttons[0].click(); await new Promise(resolve => requestAnimationFrame(resolve)); buttons[1].click(); await new Promise(resolve => requestAnimationFrame(resolve)); buttons[0].click(); await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))); root.getAnimations({ subtree: true }).forEach(animation => animation.finish());
      return { initial, middle, end, duration: timing.duration, easing: timing.easing, selected: root.querySelector('[aria-selected="true"]').dataset.value, target: buttons[0].dataset.value, settled: read().x === buttons[0].offsetLeft };
    })()`);
    assert.ok(tabs.middle.x > tabs.initial.x && tabs.middle.x < tabs.end.x); assert.equal(tabs.selected, tabs.target); assert.ok(tabs.settled); report.tabs[name] = tabs;
  }
  assert.deepEqual(report.dialogs.rss.animations, report.dialogs.skills.animations);
  assert.equal(report.tabs.rss.duration, report.tabs.skills.duration); assert.equal(report.tabs.rss.easing, report.tabs.skills.easing);
  // Closing and reopening during the shared exit lifetime must keep the latest source.
  report.interruptions = await js(`(async () => {
    const frame = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const cards = document.querySelectorAll('.rss-card-subject'); cards[0].click(); await frame(); document.querySelector('.ui-dialog-header button').click(); await frame(); cards[1].click(); await new Promise(resolve => setTimeout(resolve, 220));
    const dialog = document.querySelector('.ui-dialog'), heading = dialog.querySelector('h2').textContent; const before = dialog;
    dialog.querySelectorAll('[role="tab"]')[1].click(); await frame(); dialog.querySelectorAll('[role="tab"]')[0].click(); await frame();
    const sameShell = before === document.querySelector('.ui-dialog'), animations = before.getAnimations().filter(animation => animation.playState === 'running').length;
    return { heading, expected: cards[1].querySelector('strong').textContent, sameShell, animations, focused: before.contains(document.activeElement) };
  })()`);
  assert.equal(report.interruptions.heading, report.interruptions.expected); assert.ok(report.interruptions.sameShell && report.interruptions.focused); assert.equal(report.interruptions.animations, 0);
  await js("document.querySelector('.ui-dialog-header button').click()"); await wait("!document.querySelector('.ui-dialog')");
  await js("document.querySelectorAll('.rss-source-card')[1].querySelector('button[aria-label^=\"Edit source:\"]').click()");
  await wait("document.querySelector('.rss-editor')"); await js('new Promise(resolve => setTimeout(resolve, 220))');
  assert.ok(await js("document.querySelector('.rss-editor').contains(document.activeElement)"), 'Opening the card editor must focus its input');
  await js("[...document.querySelectorAll('.ui-dialog button')].find(button => button.textContent === 'Cancel').click()"); await wait("!document.querySelector('.ui-dialog')");
  await js("document.querySelector('.rss-card-subject').click()"); await wait("document.querySelector('.ui-dialog')");
  await media(true); await frame();
  report.reduced = await js(`(async () => { const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches; document.querySelector('.ui-dialog-header button').click(); await new Promise(resolve => requestAnimationFrame(resolve)); const noExitWait = !document.querySelector('.ui-dialog'); document.querySelector('.rss-card-subject').click(); await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))); const style = getComputedStyle(document.querySelector('.ui-dialog')); return { reduced, noExitWait, animation: style.animationName, transform: style.transform, focused: document.querySelector('.ui-dialog').contains(document.activeElement) }; })()`);
  assert.deepEqual(report.reduced, { reduced: true, noExitWait: true, animation: 'none', transform: 'none', focused: true });
  assert.deepEqual(errors, []);
  fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report)); clearTimeout(deadline); win.destroy();
}).catch(error => { console.error(error); process.exitCode = 1; }).finally(() => { for (const win of BrowserWindow.getAllWindows()) win.destroy(); app.quit(); });
