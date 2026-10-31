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
  const wait = predicate => js(`new Promise((resolve, reject) => { const end = performance.now() + 10000; function tick() { if (${predicate}) resolve(); else if (performance.now() > end) reject(new Error(${JSON.stringify(phase + ': timed out: ' + predicate)})); else requestAnimationFrame(tick); } tick(); })`);
  const capture = async name => fs.writeFileSync(path.join(output, `${name}.png`), (await win.webContents.capturePage()).toPNG());
  const media = reduced => win.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: reduced ? 'reduce' : 'no-preference' }] });
  const readStyle = `(() => { const node = document.querySelector('.ui-dialog'), mask = document.querySelector('[data-ui-dialog]'); if (!node) return null; const style = getComputedStyle(node), matrix = new DOMMatrix(style.transform); return { opacity: Number(style.opacity), y: matrix.m42, scale: matrix.a, mask: Number(getComputedStyle(mask).opacity), text: node.textContent.length, height: node.offsetHeight, focused: node.contains(document.activeElement) }; })()`;
  const report = { platform: process.platform, dialogs: {}, tabs: {}, interruptions: null, reduced: null };
  for (const [name, scenario, selector] of [['skills', 'skill-library-explore', '.skill-library-card-select'], ['rss', 'rss-source-cards', '.rss-card-open']]) {
    phase = `${name}: load`;
    await win.loadFile(path.join(output, 'index.html'), { query: { case: scenario, theme: 'light' } });
    if (!win.webContents.debugger.isAttached()) win.webContents.debugger.attach('1.3');
    await media(false);
    await wait(`document.querySelector(${JSON.stringify(selector)})`); await js('document.fonts.ready.then(() => true)'); await frame();
    win.focus();
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Tab' });
    win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Tab' }); await frame();
    if (name === 'rss') {
      report.indicatorAlignment = await js(`(() => {
        const cards = [...document.querySelectorAll('.rss-source-card')].filter(card => card.querySelector('.rss-card-indicators'));
        const measure = () => cards.map(card => { const title = card.querySelector('.rss-card-title'), marker = card.querySelector('.rss-card-ready-dot, .rss-card-indicators button svg'), box = marker.getBoundingClientRect(); return { kind: marker.matches('svg') ? 'error' : 'ready', offset: Math.abs(box.top + box.height / 2 - title.getBoundingClientRect().top - parseFloat(getComputedStyle(title).lineHeight) / 2) }; });
        const original = cards.map(card => card.querySelector('.rss-card-title').textContent), single = measure();
        cards.forEach(card => { card.querySelector('.rss-card-title').textContent = 'A deliberately long source title that wraps across several words'; });
        const wrapped = measure(); cards.forEach((card, index) => { card.querySelector('.rss-card-title').textContent = original[index]; });
        return { single, wrapped };
      })()`);
      assert.deepEqual(report.indicatorAlignment.single.map(value => value.kind), ['error', 'ready']);
      assert.ok([...report.indicatorAlignment.single, ...report.indicatorAlignment.wrapped].every(value => value.offset < 0.5), 'Indicators align with the first title line');
      await capture('rss-title-indicator-alignment');
    }
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
    assert.ok(exit.filter(value => !value.gone).every(value => value.text > 0 && value.height === end.height), 'Exit must retain the content snapshot and dialog height');
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
  report.interruptions = await js(`(async () => {
    const frame = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const cards = document.querySelectorAll('.rss-card-open'); cards[0].click(); await frame(); document.querySelector('.ui-dialog-header button').click(); await frame(); cards[1].click(); await new Promise(resolve => setTimeout(resolve, 220));
    const dialog = document.querySelector('.ui-dialog'), value = dialog.querySelector('input').value;
    const removed = ![...dialog.querySelectorAll('button')].some(node => /^(Copy|View details)/.test(node.getAttribute('aria-label') || node.textContent)); await frame();
    const sameShell = dialog === document.querySelector('.ui-dialog');
    return { value, expected: cards[1].closest('article').querySelector('strong').textContent, sameShell, removed, focused: dialog.contains(document.activeElement) };
  })()`);
  assert.equal(report.interruptions.value, report.interruptions.expected); assert.ok(report.interruptions.sameShell && report.interruptions.removed && report.interruptions.focused);
  await js("document.querySelector('.ui-dialog-header button').click()"); await wait("!document.querySelector('.ui-dialog')");
  report.cards = {};
  for (const [name, scenario, cardSelector, openSelector] of [['rss', 'rss-source-cards', '.rss-source-card', '.rss-card-open'], ['reddit', 'collector-source-scale', '.collector-source-card', '.collector-card-open']]) {
    phase = name + ': card interaction';
    await media(false); await win.loadFile(path.join(output, 'index.html'), { query: { case: scenario, theme: 'light' } });
    await wait('document.querySelector(' + JSON.stringify(openSelector) + ')'); await js('document.fonts.ready.then(() => true)');
    win.webContents.sendInputEvent({ type: 'mouseMove', x: 0, y: 0 }); await frame();
    const readCard = '(() => { const card = document.querySelector(' + JSON.stringify(cardSelector) + '), style = getComputedStyle(card), box = card.getBoundingClientRect(); return { y: new DOMMatrix(style.transform).m42, height: box.height, shadow: style.boxShadow }; })()';
    await wait('new DOMMatrix(getComputedStyle(document.querySelector(' + JSON.stringify(cardSelector) + ')).transform).m42 === 0');
    const rest = await js(readCard);
    assert.equal(await js(`document.querySelector(${JSON.stringify(cardSelector)}).querySelectorAll('.rss-card-footer, .rss-card-hover-copy, .collector-source-copy, [aria-haspopup="menu"]').length`), 0);
    const point = await js('(() => { const box = document.querySelector(' + JSON.stringify(cardSelector) + ').getBoundingClientRect(); return { x: Math.round(box.left + box.width / 2), y: Math.round(box.bottom - 8) }; })()');
    win.webContents.sendInputEvent({ type: 'mouseMove', ...point }); await frame();
    const timings = await js('(() => { window.cardAnimations = document.querySelector(' + JSON.stringify(cardSelector) + ').getAnimations(); const result = window.cardAnimations.map(animation => ({ property: animation.transitionProperty, duration: animation.effect.getTiming().duration })); window.cardAnimations.forEach(animation => { animation.pause(); animation.currentTime = 80; }); return result; })()');
    assert.ok(timings.some(animation => animation.property === 'transform' && animation.duration >= 150 && animation.duration <= 300), JSON.stringify({ name, timings, point, state: await js(readCard), media: await js("({ hover: matchMedia('(hover: hover)').matches, fine: matchMedia('(pointer: fine)').matches, reduced: matchMedia('(prefers-reduced-motion: reduce)').matches })") }));
    await frame(); const middle = await js(readCard); assert.ok(middle.y < 0 && middle.y > -2);
    await js('window.cardAnimations.forEach(animation => animation.finish())'); await frame();
    const end = await js(readCard); assert.equal(end.y, -2); assert.equal(end.height, rest.height); assert.notEqual(end.shadow, rest.shadow);
    await capture(name + '-card-hover');
    const hit = await js(`document.elementFromPoint(${point.x}, ${point.y})?.className`);
    assert.ok(hit?.includes('source-card-open'), JSON.stringify({ name, point, hit }));
    phase = name + ': pointer opens editor';
    win.webContents.sendInputEvent({ type: 'mouseDown', button: 'left', clickCount: 1, ...point });
    win.webContents.sendInputEvent({ type: 'mouseUp', button: 'left', clickCount: 1, ...point });
    await wait("document.querySelector('.ui-dialog input')"); await frame();
    assert.ok(await js("document.querySelector('.ui-dialog').contains(document.activeElement)"));
    await capture(name + '-card-editor');
    await js("[...document.querySelectorAll('.ui-dialog button')].find(node => node.textContent === 'Cancel').click()"); await wait("!document.querySelector('.ui-dialog')"); await frame();
    assert.equal(await js('document.activeElement === document.querySelector(' + JSON.stringify(openSelector) + ')'), true);
    phase = name + ': keyboard opens editor';
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Enter' }); win.webContents.sendInputEvent({ type: 'char', keyCode: '\r' }); win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Enter' });
    await wait("document.querySelector('.ui-dialog input')");
    if (name === 'reddit') {
      await js("[...document.querySelectorAll('.ui-dialog button')].find(node => node.textContent === 'Delete').click()"); await wait("document.querySelector('[role=\"alertdialog\"]')"); await frame();
      assert.equal(await js('document.activeElement.textContent'), 'Cancel');
      await capture('reddit-delete-confirmation');
      await js("[...document.querySelectorAll('[role=\"alertdialog\"] button')].find(node => node.textContent === 'Cancel').click()"); await wait("!document.querySelector('[role=\"alertdialog\"]')");
      assert.equal(await js("document.querySelectorAll('.collector-source-card').length"), 30);
      await js("[...document.querySelectorAll('.ui-dialog button')].find(node => node.textContent === 'Delete').click()"); await wait("document.querySelector('[role=\"alertdialog\"]')");
      await js("[...document.querySelectorAll('[role=\"alertdialog\"] button')].find(node => node.textContent === 'Delete').click()");
      await wait("!document.querySelector('.ui-dialog') && document.querySelector('.collector-source-name').textContent === 'r/Community1'");
    } else {
      await js("[...document.querySelectorAll('.ui-dialog button')].find(node => node.textContent === 'Cancel').click()"); await wait("!document.querySelector('.ui-dialog')");
    }
    win.webContents.sendInputEvent({ type: 'mouseMove', x: 0, y: 0 }); await frame();
    await media(true); await frame();
    win.webContents.sendInputEvent({ type: 'mouseMove', ...point }); await frame();
    const reduced = await js(readCard); assert.equal(reduced.y, 0);
    assert.equal(await js('getComputedStyle(document.querySelector(' + JSON.stringify(cardSelector) + ')).transitionDuration'), '0s');
    report.cards[name] = { rest, timings, middle, end, reduced, clickEditor: true, keyboardEditor: true };
  }
  assert.deepEqual(errors, []);
  fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report)); clearTimeout(deadline); win.destroy();
}).catch(error => { console.error(error); process.exitCode = 1; }).finally(() => { for (const win of BrowserWindow.getAllWindows()) win.destroy(); app.exit(process.exitCode ?? 0); });
