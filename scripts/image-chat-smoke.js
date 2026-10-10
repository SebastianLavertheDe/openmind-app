// Isolated Electron smoke: real image IPC/decoding, fixture chat, no provider calls.
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const root = path.resolve(__dirname, "..");
const output = path.join(root, ".build", "image-chat-smoke");
if (!process.versions.electron) {
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const electron = require("electron");
  const xvfb = process.platform === "linux" && !env.DISPLAY;
  const result = spawnSync(xvfb ? "xvfb-run" : electron, xvfb ? ["-a", electron, "--no-sandbox", __filename] : ["--no-sandbox", __filename], { cwd: root, env, stdio: "inherit" });
  if (result.error) throw result.error;
  process.exit(result.status ?? 1);
}
const { app, BrowserWindow, ipcMain, nativeImage } = require("electron");
const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "openmind-image-ui-"));
app.setPath("userData", path.join(fixtureRoot, "user-data"));
app.commandLine.appendSwitch("disable-gpu");
app.whenReady().then(async () => {
  fs.mkdirSync(output, { recursive: true });
  for (let index = 0; index < 3; index++) {
    const pixels = Buffer.alloc(1024 * 1024 * 4);
    for (let y = 0; y < 1024; y++) for (let x = 0; x < 1024; x++) {
      const offset = (y * 1024 + x) * 4;
      pixels[offset] = 110 + Math.round(x / 10) - index * 20;
      pixels[offset + 1] = 150 + Math.round(y / 14);
      pixels[offset + 2] = 180 + Math.round((x + y) / 32);
      pixels[offset + 3] = 255;
    }
    fs.writeFileSync(path.join(fixtureRoot, `fixture-${index}.png`), nativeImage.createFromBitmap(pixels, { width: 1024, height: 1024 }).toPNG());
  }
  if (process.env.OPENMIND_IMAGE_SMOKE_FILE) fs.copyFileSync(process.env.OPENMIND_IMAGE_SMOKE_FILE, path.join(fixtureRoot, "fixture-0.png"));
  const { readChatImage } = require(path.join(root, ".build/electron/electron/images/chat-image.js"));
  ipcMain.handle("image-smoke-read", (_event, input) => readChatImage(input, source => {
    if (!/^fixture-[0-2]\.png$/.test(source)) throw new Error("Unknown smoke fixture");
    return path.join(fixtureRoot, source);
  }));
  fs.writeFileSync(path.join(output, "preload.cjs"), `const { contextBridge, ipcRenderer } = require('electron'); contextBridge.exposeInMainWorld('imageSmoke', { read: input => ipcRenderer.invoke('image-smoke-read', input) });`);
  await require("esbuild").build({
    stdin: { contents: `
      import React, { useState } from 'react';
      import { createRoot } from 'react-dom/client';
      import { installBrowserPreviewApi } from './browser-api';
      import { AiProvider } from './ai-context';
      import { Chat } from './features/ai-console/Chat';
      import { AiProvidersSettingsSection } from './features/settings/settings-sections';
      import { IMAGE_PROVIDERS } from '@shared/image-generation';
      import { applyTheme } from './theme';
      import './styles.css';
      import './styles/product.css';
      async function main() {
        // Browser preview has its own user-agent guard; keep this fixture explicit.
        Object.defineProperty(navigator, 'userAgent', { value: 'OpenMind image smoke fixture', configurable: true });
        installBrowserPreviewApi();
        const bootstrap = await window.openmind.getBootstrap();
        const snapshot = bootstrap.ai;
        snapshot.runs[0].changeSet = null;
        const selection = { providerId: 'volcengine', provider: 'volcengine', model: IMAGE_PROVIDERS[0].models[0].id };
        snapshot.sessions[0].imageGeneration = selection;
        const originalEvents = await window.openmind.aiGetEvents('preview-session');
        const base = originalEvents[0];
        const events = [
          { ...base, payload: { text: '生成两张适合自然主题文章的配图，画面简洁，色调柔和。' } },
          ...[0,1].map(index => ({ ...base, id: 'image-' + index, seq: index + 2, kind: 'image-artifact', payload: { image: { id: '00000000-0000-4000-8000-00000000000' + index, source: 'fixture-' + index + '.png', title: '自然主题配图 ' + (index + 1), provider: 'volcengine', model: selection.model, mediaType: 'image/png', createdAt: base.timestamp, batchId: 'fixture-batch', index } } })),
          { ...base, id: 'final', seq: 4, kind: 'assistant-message', payload: { phase: 'final', text: '两张配图已生成，点击图片可查看原图。\\n\\n下面是 Markdown 图片预览：\\n\\n![Markdown 示例](fixture-2.png)' } }
        ];
        const config = { defaultSelection: selection, providers: IMAGE_PROVIDERS.map(p => ({ id: p.id, name: p.name, provider: p.id, models: p.models.map(model => model.id), baseUrl: p.baseUrl, configured: true, enabled: true })) };
        window.__reads = [];
        window.openmind.readChatImage = input => { window.__reads.push(input); return window.imageSmoke.read(input); };
        window.openmind.getImageConfiguration = async () => config;
        window.openmind.selectImageModel = async selection => { window.__selected = selection; config.defaultSelection = selection; return config; };
        window.openmind.aiGetEvents = async () => events;
        window.openmind.aiRefresh = async () => snapshot;
        window.__setTheme = themeMode => applyTheme({ themeMode });
        window.__setTheme(new URLSearchParams(location.search).get('theme') || 'light');
        const rootView = createRoot(document.getElementById('root'));
        window.__showProviderSettings = () => {
          window.openmind.getProviderApiKey = async () => 'fixture-key';
          function SettingsFixture() {
            const [view, setView] = useState({ schemaVersion: 1, default: 'volcengine', cli: { claude: null, codex: null }, providers: IMAGE_PROVIDERS.map(p => ({ id: p.id, name: p.name, enabled: true, protocol: 'openai-chat', authMode: 'bearer', apiKeySet: true, baseUrl: p.baseUrl, model: 'text-model', proxyUrl: '', proxyPolicy: 'system', tlsPolicy: 'verify', imageGeneration: { provider: p.id, models: p.models.map(m => m.id) } })) });
            return <main style={{ maxWidth: 960, margin: '0 auto', padding: 16 }}><AiProvidersSettingsSection view={view} busy={false} initialCategory="image" notify={message => { throw new Error(message); }} onSave={async input => {
              window.__savedProviders = input;
              setView({ ...input, providers: input.providers.map(({ apiKey, ...entry }) => ({ ...entry, apiKeySet: true })) });
            }} /></main>;
          }
          rootView.render(<SettingsFixture />);
        };
        rootView.render(<AiProvider initial={snapshot}><main className="conversation-pane" style={{ height: '100vh', gridTemplateRows: 'auto minmax(0, 1fr)' }}><header className="conversation-header"><strong>图片创作</strong></header><Chat /></main></AiProvider>);
      }
      main().catch(error => console.error(error));
    `, resolveDir: path.join(root, "renderer/src"), loader: "tsx" },
    bundle: true, outfile: path.join(output, "fixture.js"), platform: "browser", format: "iife",
    alias: { "@shared": path.join(root, "shared") }, loader: { ".woff2": "dataurl", ".woff": "dataurl", ".ttf": "dataurl" },
    define: { "process.env.NODE_ENV": '"production"' }, logLevel: "silent"
  });
  const csp = fs.readFileSync(path.join(root, "renderer/index.html"), "utf8").match(/<meta http-equiv="Content-Security-Policy"[^>]*>/)[0];
  fs.writeFileSync(path.join(output, "index.html"), `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">${csp}<link rel="stylesheet" href="fixture.css"></head><body><div id="root"></div><script src="fixture.js"></script></body></html>`);
  const win = new BrowserWindow({ width: 1100, height: 900, show: true, webPreferences: { preload: path.join(output, "preload.cjs"), contextIsolation: true, nodeIntegration: false, sandbox: true } });
  const failures = [];
  win.webContents.on("console-message", event => { if (event.level >= 3) failures.push(event.message); });
  win.webContents.session.webRequest.onBeforeRequest({ urls: ["http://*/*", "https://*/*"] }, (_details, callback) => callback({ cancel: true }));
  const evaluate = expression => win.webContents.executeJavaScript(expression);
  const waitFor = async expression => {
    for (let attempt = 0; attempt < 80; attempt++) { if (await evaluate(expression)) return; await new Promise(resolve => setTimeout(resolve, 100)); }
    throw new Error(`Timed out: ${expression}`);
  };
  for (const [name, width, height, theme] of [["desktop", 1100, 900, "light"], ["compact", 720, 700, "light"], ["narrow", 420, 740, "light"], ["dark", 1100, 900, "dark"]]) {
    win.setSize(width, height);
    await win.loadFile(path.join(output, "index.html"), { query: { theme } });
    await waitFor(`document.querySelectorAll('.chat-image-thumbnail img').length === 3`);
    if (await evaluate(`window.__reads.some(r => r.variant === 'original')`)) throw new Error("Loaded an original before opening the viewer");
    await new Promise(resolve => setTimeout(resolve, 200));
    fs.writeFileSync(path.join(output, `${name}-chat.png`), (await win.webContents.capturePage()).toPNG());
    await evaluate(`document.querySelector('.image-model-picker button').click()`);
    await waitFor(`Boolean(document.querySelector('.image-model-menu'))`);
    await new Promise(resolve => setTimeout(resolve, 300));
    const geometry = await evaluate(`(() => {
      const menu = document.querySelector('.image-model-menu').getBoundingClientRect();
      const composer = document.querySelector('.composer-send').getBoundingClientRect();
      const picker = document.querySelector('.image-model-picker').getBoundingClientRect();
      const provider = document.querySelector('.provider-select .chip-select-trigger').getBoundingClientRect();
      return { overlap: (picker.top < composer.bottom && picker.bottom > composer.top && picker.left < composer.right && picker.right > composer.left) || provider.right > composer.left, overflow: document.documentElement.scrollWidth > innerWidth, left: menu.left, right: menu.right, top: menu.top, bottom: menu.bottom, sendRight: composer.right, width: innerWidth, height: innerHeight, thumbnails: [...document.querySelectorAll('.chat-image-thumbnail img')].map(i => ({width: i.clientWidth, height: i.clientHeight, naturalWidth: i.naturalWidth})) };
    })()`);
    if (geometry.overlap || geometry.overflow || geometry.left < 0 || geometry.right > geometry.width || geometry.top < 0 || geometry.bottom > geometry.height || geometry.sendRight > geometry.width || geometry.thumbnails.some(image => image.width > 321 || image.height > 241)) throw new Error(`${name} layout overflow: ${JSON.stringify(geometry)}`);
    fs.writeFileSync(path.join(output, `${name}.json`), JSON.stringify(geometry, null, 2));
    fs.writeFileSync(path.join(output, `${name}.png`), (await win.webContents.capturePage()).toPNG());
    await evaluate(`document.querySelector('[data-provider="google"]').click()`);
    await waitFor(`document.querySelectorAll('.image-model-list [role="option"]').length === 3`);
    await evaluate(`document.querySelector('.image-model-list [role="option"]').click()`);
    await waitFor(`window.__selected?.model === 'gemini-nano-banana-2.1'`);
    await evaluate(`document.querySelectorAll('.chat-image-thumbnail')[1].click()`);
    await waitFor(`Boolean(document.querySelector('.chat-image-full'))`);
    if (!(await evaluate(`document.querySelector('.chat-image-stage').classList.contains('is-original') && document.querySelector('.chat-image-full').clientWidth === document.querySelector('.chat-image-full').naturalWidth`))) throw new Error("Viewer did not render original dimensions");
    await evaluate(`document.querySelector('.chat-image-nav.is-next').click()`);
    await waitFor(`document.querySelector('.chat-image-full')?.alt === 'Markdown 示例'`);
    await evaluate(`document.querySelector('.chat-image-dialog').dispatchEvent(new KeyboardEvent('keydown', {key:'ArrowLeft',bubbles:true}))`);
    await waitFor(`document.querySelector('.chat-image-full')?.alt === '自然主题配图 2'`);
    await evaluate(`document.querySelector('[aria-label="适应窗口"]').click()`);
    await new Promise(resolve => setTimeout(resolve, 250));
    if (name === "dark") fs.writeFileSync(path.join(output, "viewer.png"), (await win.webContents.capturePage()).toPNG());
    await evaluate(`document.querySelector('.chat-image-dialog').dispatchEvent(new KeyboardEvent('keydown', {key:'Escape',bubbles:true}))`);
    await waitFor(`!document.querySelector('.chat-image-lightbox')`);
  }
  for (const [name, width, height, theme] of [["desktop", 1100, 900, "light"], ["narrow", 420, 740, "light"], ["dark", 1100, 900, "dark"]]) {
    win.setSize(width, height);
    await win.loadFile(path.join(output, "index.html"), { query: { theme } });
    await waitFor(`Boolean(window.__showProviderSettings)`);
    await evaluate(`window.__showProviderSettings()`);
    await waitFor(`document.querySelectorAll('.settings-provider-config-card').length === 3`);
    await new Promise(resolve => setTimeout(resolve, 250));
    fs.writeFileSync(path.join(output, `${name}-providers.png`), (await win.webContents.capturePage()).toPNG());
    await evaluate(`document.querySelector('.settings-provider-config-summary').click()`);
    await waitFor(`Boolean(document.querySelector('[role="switch"][aria-label="支持图片生成"]'))`);
    await evaluate(`document.querySelector('.settings-provider-image-capability').scrollIntoView({block:'center'})`);
    await new Promise(resolve => setTimeout(resolve, 250));
    const bounds = await evaluate(`(() => { const d = document.querySelector('.settings-provider-dialog').getBoundingClientRect(); const body = document.querySelector('.settings-provider-dialog-body'); return { left: d.left, right: d.right, top: d.top, bottom: d.bottom, width: innerWidth, height: innerHeight, bodyWidth: body.clientWidth, bodyScroll: body.scrollWidth, overflow: document.documentElement.scrollWidth > innerWidth || body.scrollWidth > body.clientWidth + 1, offenders: [...body.querySelectorAll("*")].filter(e => e.getBoundingClientRect().right > body.getBoundingClientRect().right - 15).map(e => ({tag:e.tagName, cls:e.className, width:e.clientWidth, right:e.getBoundingClientRect().right})).slice(0,12) }; })()`);
    if (bounds.left < 0 || bounds.right > bounds.width || bounds.top < 0 || bounds.bottom > bounds.height || bounds.overflow) throw new Error(`Provider settings overflow: ${JSON.stringify(bounds)}`);
    fs.writeFileSync(path.join(output, `${name}-provider-edit.png`), (await win.webContents.capturePage()).toPNG());
    await evaluate(`document.querySelectorAll('.settings-provider-image-models input')[1].click()`);
    await evaluate(`document.querySelector('.settings-provider-dialog button[type="submit"]').click()`);
    await waitFor(`Boolean(window.__savedProviders)`);
    if (!(await evaluate(`window.__savedProviders.providers.length === 3 && window.__savedProviders.providers[0].imageGeneration.models.length === 1 && window.__savedProviders.providers[0].model === 'text-model'`))) throw new Error("Image capability duplicated or replaced the text Provider");
    await evaluate(`document.querySelector('[role="tab"][data-value="text"]').click()`);
    await waitFor(`document.querySelectorAll('.settings-provider-config-card').length === 3`);
  }
  win.destroy();
  if (failures.length) throw new Error(failures.join("\n"));
  console.log(`Image chat Electron smoke passed: thumbnail/original IPC, gallery navigation, shared Provider categories/settings, model selection, light/dark and 4 viewport checks (${path.relative(root, output)}).`);
  app.quit();
}).catch(error => { console.error(error); app.exit(1); }).finally(() => fs.rmSync(fixtureRoot, { recursive: true, force: true }));
