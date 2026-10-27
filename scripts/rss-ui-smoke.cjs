const { app, BrowserWindow } = require('electron');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'openmind-rss-ui-'));
const output = process.env.OPENMIND_RSS_UI_OUTPUT || path.join(root, '.tmp', 'rss-ui'); fs.mkdirSync(output, { recursive: true });
app.setPath('userData', profile); app.commandLine.appendSwitch('no-sandbox'); app.commandLine.appendSwitch('disable-gpu'); app.commandLine.appendSwitch('force-prefers-reduced-motion');
app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 1280, height: 900, show: true, webPreferences: { preload: path.join(__dirname, 'visual-snapshot-preload.js'), contextIsolation: true, sandbox: false, backgroundThrottling: false } });
  win.webContents.on('console-message', (_event, _level, message) => { if (message.includes('Error') || message.includes('Missing')) console.error(message); });
  const js = code => win.webContents.executeJavaScript(code, true);
  const ready = selector => js(`new Promise((resolve, reject) => { const until = Date.now() + 10000; const check = () => { if (document.querySelector(${JSON.stringify(selector)})) return resolve(); if (Date.now() > until) return reject(new Error('Missing ${selector}')); setTimeout(check, 30); }; check(); })`);
  const click = text => js(`(() => { const button = [...document.querySelectorAll('button')].find(button => button.textContent.trim() === ${JSON.stringify(text)} || button.getAttribute('aria-label') === ${JSON.stringify(text)}); if (!button) throw new Error('Missing button: ' + ${JSON.stringify(text)}); button.click(); })()`);
  const capture = async name => { await js('new Promise(resolve => setTimeout(resolve, 650))'); fs.writeFileSync(path.join(output, name + '.png'), (await win.webContents.capturePage()).toPNG()); };
  await win.loadFile(path.join(root, '.build/renderer/index.html')); await ready('.app-nav');
  await click('RSS 源'); await ready('.rss-source-row');
  assert.ok(await js("document.querySelector('.app-nav').getBoundingClientRect().width > 0"), 'RSS navigation remains visible');
  const captures = [];
  for (const theme of ['light', 'dark']) for (const width of [720, 1280]) {
    win.setContentSize(width, 900);
    await js(`document.documentElement.dataset.theme = ${JSON.stringify(theme)}`);
    const name = `sources-${theme}-${width}`; await capture(name); captures.push(name);
    const overflow = await js(`(() => { const node = document.querySelector('.rss-sources'); return node.scrollWidth - node.clientWidth; })()`);
    assert.ok(overflow <= 2, 'RSS page must not overflow horizontally');
  }
  win.setContentSize(1000, 900);
  await click('添加源'); await ready('[role="dialog"] input[type="url"]');
  const input = async (selector, value) => js(`(() => { const input = document.querySelector(${JSON.stringify(selector)}); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, ${JSON.stringify(value)}); input.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await input('[role="dialog"] input:not([type="url"])', 'New research feed');
  await input('[role="dialog"] input[type="url"]', 'https://invalid.example/feed');
  await click('检测链接'); await js('new Promise(resolve => setTimeout(resolve, 100))');
  assert.ok(await js(`document.body.innerText.includes('[invalid-feed]')`)); await capture('source-error');
  await input('[role="dialog"] input[type="url"]', 'https://new.example/feed'); await click('检测链接');
  await js('new Promise(resolve => setTimeout(resolve, 100))'); await click('保存'); await ready('.rss-source-row');
  assert.ok(await js(`document.body.innerText.includes('New research feed')`));
  await click('总结与选题偏好'); await ready('[role="dialog"] textarea'); await capture('preferences');
  const textarea = await js(`document.querySelector('[role="dialog"] textarea').value`); assert.match(textarea, /产品设计/);
  // Keyboard Escape closes without losing saved preferences and restores focus.
  win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' }); win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' });
  await js('new Promise(resolve => setTimeout(resolve, 650))'); assert.equal(await js(`!!document.querySelector('[role="dialog"]')`), false);
  const report = { platform: process.platform, captures, addErrorRetry: true, preferences: true, keyboard: true, overflow: false };
  fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report)); win.destroy();
}).catch(error => { console.error(error); process.exitCode = 1; }).finally(() => { for (const win of BrowserWindow.getAllWindows()) win.destroy(); fs.rmSync(profile, { recursive: true, force: true }); app.quit(); });
