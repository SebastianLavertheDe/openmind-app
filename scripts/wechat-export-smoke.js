// Isolated Electron UI smoke: no user repository, credentials or network calls.
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const root = path.resolve(__dirname, "..");
const output = path.join(root, ".build", "wechat-export-smoke");

if (!process.versions.electron) {
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const useXvfb = process.platform === "linux" && !env.DISPLAY;
  const electron = require("electron");
  const result = spawnSync(useXvfb ? "xvfb-run" : electron, useXvfb ? ["-a", electron, "--no-sandbox", __filename] : ["--no-sandbox", __filename], { cwd: root, env, stdio: "inherit" });
  if (result.error) throw result.error;
  process.exit(result.status ?? 1);
}

const { app, BrowserWindow } = require("electron");
const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "openmind-wechat-ui-"));
app.setPath("userData", fixtureRoot);
app.commandLine.appendSwitch("disable-gpu");

app.whenReady().then(async () => {
  fs.mkdirSync(output, { recursive: true });
  await require("esbuild").build({
    stdin: { contents: `
      import React from 'react';
      import { createRoot } from 'react-dom/client';
      import { WechatExportDialog } from './features/wechat/WechatExportDialog';
      import { applyTheme } from './theme';
      import './styles/index.css';
      const account = { appId: 'wx1234567890123456', author: 'OpenMind', configured: true };
      window.__copied = null;
      window.__setTheme = themeMode => applyTheme({ themeMode });
      window.__setTheme(new URLSearchParams(location.search).get('theme') || 'light');
      window.openmind = {
        getWechatAccount: async () => account,
        copyWechatArticle: async value => { window.__copied = value; },
        chooseWechatCover: async () => null,
        pushWechatDraft: async () => { throw new Error('Smoke fixture must not push'); },
        openExternal: async () => true
      };
      createRoot(document.getElementById('root')).render(<WechatExportDialog open
        projectName="测试项目" outputPath="outputs/report.md" title="AI 内容创作工作站 — 产品设计文档"
        markdown={'## 1. 产品概述\\n\\nAI 内容创作工作站面向独立创作者与小型内容团队，将信息采集、智能摘要、选题推荐和稿件创作整合在一个统一界面中。\\n\\n### 目标用户画像\\n\\n- 关注技术趋势的内容创作者\\n- 希望专注写作的小型团队\\n\\n> 从灵感到成品，让每一次创作更从容。\\n\\n## 2. 核心设计原则\\n\\n**本地优先** · 内容保存在自己的电脑中。\\n\\n**流畅创作** · 在同一个工作空间完成整理与写作。\\n\\n| 能力 | 状态 |\\n| --- | --- |\\n| 主题排版 | 已支持 |\\n| 草稿推送 | 待配置账号 |'}
        onClose={() => {}} />);
    `, resolveDir: path.join(root, "renderer", "src"), loader: "tsx" },
    bundle: true, outfile: path.join(output, "fixture.js"), platform: "browser", format: "iife",
    alias: { "@shared": path.join(root, "shared") }, loader: { ".woff2": "dataurl", ".woff": "dataurl", ".ttf": "dataurl" },
    define: { "process.env.NODE_ENV": '"production"' }, logLevel: "silent"
  });
  const csp = fs.readFileSync(path.join(root, "renderer", "index.html"), "utf8").match(/<meta http-equiv="Content-Security-Policy"[^>]*>/)[0];
  fs.writeFileSync(path.join(output, "index.html"), `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">${csp}<link rel="stylesheet" href="fixture.css"></head><body><div id="root"></div><script src="fixture.js"></script></body></html>`);
  const failures = [];
  const win = new BrowserWindow({ width: 1200, height: 850, show: true, webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true } });
  win.webContents.on("console-message", event => { if (event.level >= 3) failures.push(event.message); });
  win.webContents.session.webRequest.onBeforeRequest({ urls: ["http://*/*", "https://*/*"] }, (_details, callback) => callback({ cancel: true }));
  await win.loadFile(path.join(output, "index.html"));
  const waitFor = async expression => {
    for (let attempt = 0; attempt < 80; attempt++) {
      if (await win.webContents.executeJavaScript(expression)) return;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error(`Timed out: ${expression}`);
  };
  await waitFor(`Boolean(document.querySelector('.wechat-theme-card'))`);
  await new Promise(resolve => setTimeout(resolve, 250));
  // Inspect the DOM through Chromium; sandboxed article frames intentionally cannot execute scripts.
  win.webContents.debugger.attach("1.3");
  let snapshot = await win.webContents.debugger.sendCommand("DOMSnapshot.captureSnapshot", { computedStyles: [] });
  if (!snapshot.strings.includes("目标用户画像")) {
    const targets = await win.webContents.debugger.sendCommand("Target.getTargets");
    const target = targets.targetInfos.find(candidate => candidate.type === "iframe" && candidate.url === "about:srcdoc");
    if (target) {
      const { sessionId } = await win.webContents.debugger.sendCommand("Target.attachToTarget", { targetId: target.targetId, flatten: true });
      snapshot = await win.webContents.debugger.sendCommand("DOMSnapshot.captureSnapshot", { computedStyles: [] }, sessionId);
    }
  }
  if (!snapshot.strings.includes("目标用户画像")) throw new Error("Article preview did not load under the app CSP");
  win.webContents.debugger.detach();
  for (const [name, width, height, theme] of [["desktop", 1200, 850, "light"], ["compact", 720, 600, "light"], ["narrow", 420, 740, "light"], ["dark", 1200, 850, "dark"]]) {
    win.setSize(width, height);
    await win.loadFile(path.join(output, "index.html"), { query: { theme } });
    await waitFor(`Boolean(document.querySelector('.wechat-theme-card'))`);
    await new Promise(resolve => setTimeout(resolve, 500));
    const geometry = await win.webContents.executeJavaScript(`(() => {
      const modal = document.querySelector('.wechat-export-dialog').getBoundingClientRect();
      const footer = document.querySelector('.wechat-export-footer').getBoundingClientRect();
      const card = getComputedStyle(document.querySelector('.wechat-theme-card'));
      const root = getComputedStyle(document.documentElement);
      return { horizontalOverflow: document.documentElement.scrollWidth > innerWidth, modal: { left: modal.left, right: modal.right, bottom: modal.bottom }, footer: { top: footer.top, bottom: footer.bottom }, width: innerWidth, height: innerHeight, card: { background: card.backgroundColor, color: card.color, panel: card.getPropertyValue('--panel'), text: card.getPropertyValue('--text') }, root: { panel: root.getPropertyValue('--panel'), text: root.getPropertyValue('--text') } };
    })()`);
    if (geometry.horizontalOverflow || geometry.modal.left < 0 || geometry.modal.right > geometry.width || geometry.footer.bottom > geometry.height || geometry.footer.top < 0) throw new Error(`${name} clips controls: ${JSON.stringify(geometry)}`);
    fs.writeFileSync(path.join(output, `${name}.json`), JSON.stringify(geometry, null, 2));
    fs.writeFileSync(path.join(output, `${name}.png`), (await win.webContents.capturePage()).toPNG());
  }
  await win.webContents.executeJavaScript(`Array.from(document.querySelectorAll('button')).find(b => b.textContent === '复制排版').click()`);
  await waitFor(`Boolean(window.__copied?.html.includes('style=') && window.__copied?.text.includes('目标用户画像'))`);
  await win.webContents.executeJavaScript(`Array.from(document.querySelectorAll('button')).find(b => b.textContent === '发送到草稿箱').click()`);
  await waitFor(`Boolean(document.querySelector('.wechat-cover-picker'))`);
  fs.writeFileSync(path.join(output, "draft.png"), (await win.webContents.capturePage()).toPNG());
  win.destroy();
  if (failures.length) throw new Error(failures.join("\n"));
  console.log(`WeChat export Electron smoke passed: preview CSP, rich copy, draft form, 4 viewport/theme screenshots (${path.relative(root, output)}).`);
  app.quit();
}).catch(error => { console.error(error); app.exit(1); }).finally(() => { fs.rmSync(fixtureRoot, { recursive: true, force: true }); });
