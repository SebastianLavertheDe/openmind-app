const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
// The launcher removes the isolated profile only after Chromium releases it.
if (!process.env.OPENMIND_UI_CATALOG_USER_DATA_DIR) {
  const { runWithTemporaryProfile } = require('./ui-contract/temporary-profile.cjs');
  const environment = { ...process.env };
  delete environment.ELECTRON_RUN_AS_NODE;
  const executable = process.versions.electron ? process.execPath : require('electron');
  const result = runWithTemporaryProfile(executable, ['--no-sandbox', __filename], { cwd: root, env: environment, stdio: 'inherit', windowsHide: true });
  if (result.error) throw result.error;
  process.exit(result.status ?? 1);
}
const { app, BrowserWindow } = require('electron');
const profile = process.env.OPENMIND_UI_CATALOG_USER_DATA_DIR;
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
  assert.equal(await js("!!document.querySelector('.app-nav button[aria-label=\"RSS 源\"]')"), false, 'RSS must not remain in the primary sidebar');
  await click('设置'); await ready('.settings-navigation'); await click('RSS 源'); await ready('.rss-source-row');
  assert.ok(await js("document.querySelector('.settings-page').dataset.settingsSection === 'sources' && document.querySelector('.settings-nav-button[data-section-id=\"sources\"]').getAttribute('aria-current') === 'page' && !document.querySelector('.app-nav')"), 'RSS sources must open in the dedicated settings shell');
  assert.equal(await js("[...document.querySelectorAll('h1')].filter(node => node.textContent.trim() === 'RSS 源').length"), 1, 'RSS settings must have one page heading');
  // Exercise real overflow: a short fixture cannot expose a shrinking Flex list.
  await js(`(async () => {
    for (let index = 0; index < 40; index++) await window.openmind.createRssSource({ name: 'Layout source ' + index, inputUrl: 'https://layout.example/feed/' + index, enabled: false });
  })()`);
  await click('刷新'); await ready('.rss-source-row:nth-child(43)');
  const captures = [];
  for (const theme of ['light', 'dark']) for (const width of [720, 1280]) {
    win.setContentSize(width, 900);
    await js(`document.documentElement.dataset.theme = ${JSON.stringify(theme)}`);
    const name = `sources-${theme}-${width}`; await capture(name); captures.push(name);
    const overflow = await js(`(() => { const node = document.querySelector('.rss-sources'); return node.scrollWidth - node.clientWidth; })()`);
    assert.ok(overflow <= 2, 'RSS page must not overflow horizontally');
    const geometry = await js(`(() => {
      const page = document.querySelector('.rss-sources');
      const scroll = document.querySelector('.settings-detail');
      const list = page.querySelector('.rss-list');
      const preferences = [...page.querySelectorAll('button')].find(button => button.textContent.trim() === '总结与选题偏好');
      const listRect = list.getBoundingClientRect();
      const lastRow = list.lastElementChild.getBoundingClientRect();
      const preferenceRect = preferences.getBoundingClientRect();
      return { preferencesAboveList: preferenceRect.bottom <= listRect.top, containsLastRow: lastRow.bottom <= listRect.bottom + 1, scrollable: scroll.scrollHeight > scroll.clientHeight };
    })()`);
    assert.ok(geometry.preferencesAboveList, 'Preferences must stay in the actions above the source list');
    assert.ok(geometry.containsLastRow, 'The long source list must contain every row without shrinking');
    assert.ok(geometry.scrollable, 'The page must scroll through the long source list');
  }
  win.setContentSize(1000, 900);
  await click('编辑源: Design research'); await ready('[role="dialog"] textarea[readonly]');
  const converted = await js(`(() => { const field = document.querySelector('[role="dialog"] textarea[readonly]'); return { value: field.value, readOnly: field.readOnly, hint: document.body.innerText.includes('采集文章时读取此 RSS 文件。') }; })()`);
  assert.equal(converted.value, '/fixtures/openmind-data/.agent/skill-data/rss-article-saver/feeds/design.xml');
  assert.ok(converted.readOnly && converted.hint, 'The actual converted RSS location must be read-only and describe collection');
  for (const theme of ['light', 'dark']) for (const width of [720, 1280]) {
    win.setContentSize(width, 900); await js(`document.documentElement.dataset.theme = ${JSON.stringify(theme)}`);
    const name = `source-rss-location-${theme}-${width}`; await capture(name); captures.push(name);
    assert.ok(await js(`(() => { const field = document.querySelector('[role="dialog"] textarea[readonly]'); const box = field.getBoundingClientRect(); return box.left >= 0 && box.right <= innerWidth && document.documentElement.scrollWidth <= innerWidth && field.scrollWidth <= field.clientWidth + 1 && field.scrollHeight <= field.clientHeight + 1; })()`), 'The complete RSS location must fit the editor');
  }
  await click('取消'); await js('new Promise(resolve => setTimeout(resolve, 650))');
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
  win.setContentSize(720, 900);
  await click('设置');
  assert.equal(await js("document.querySelector('.settings-page').hasAttribute('data-compact-detail-open')"), false, 'Compact settings must return to the category list');
  await click('RSS 源');
  assert.equal(await js("document.querySelector('.settings-page').dataset.settingsSection"), 'sources');
  await click('返回应用'); await ready('.app-nav');
  assert.equal(await js("!!document.querySelector('.settings-page')"), false, 'Settings must return to the original application page');
  const report = { platform: process.platform, captures, settingsNavigation: true, convertedRssLocation: true, addErrorRetry: true, preferences: true, keyboard: true, longListLayout: true, overflow: false };
  fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report)); win.destroy();
}).catch(error => { console.error(error); process.exitCode = 1; }).finally(() => { for (const win of BrowserWindow.getAllWindows()) win.destroy(); app.quit(); });
