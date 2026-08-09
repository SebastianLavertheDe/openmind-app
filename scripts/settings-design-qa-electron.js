const fs = require("fs");
const path = require("path");
const { app, BrowserWindow } = require("electron");

const appRoot = path.resolve(__dirname, "..");
const rendererIndex = path.join(appRoot, ".build", "renderer", "index.html");
const preload = path.join(__dirname, "visual-snapshot-preload.js");
const outputRoot = path.resolve(process.env.CCTOOLS_SETTINGS_QA_OUTPUT || path.join(appRoot, "design-qa", "settings-unified"));
const sections = ["常规", "AI 与模型", "内置运行时", "Skills", "MCP 服务", "浏览器", "权限与安全", "内容工作流", "数据与存储", "会话归档"];
const viewports = [
  { id: "reference", width: 1744, height: 1255 },
  { id: "2048x1152", width: 2048, height: 1152 },
  { id: "1280x800", width: 1280, height: 800 },
  { id: "900x720", width: 900, height: 720 }
];

app.commandLine.appendSwitch("disable-gpu");

app.whenReady().then(async () => {
  if (!fs.existsSync(rendererIndex)) throw new Error("Renderer build is missing. Run npm run build first.");
  fs.rmSync(outputRoot, { recursive: true, force: true });
  fs.mkdirSync(outputRoot, { recursive: true });

  const win = new BrowserWindow({
    width: 2048,
    height: 1152,
    show: true,
    backgroundColor: "#f6f7f9",
    webPreferences: { preload, contextIsolation: true, nodeIntegration: false, sandbox: false, backgroundThrottling: false }
  });
  const consoleErrors = [];
  win.webContents.on("console-message", (event) => {
    if (event.level >= 2) consoleErrors.push(`${event.message} (${event.sourceId}:${event.lineNumber})`);
  });
  await win.loadFile(rendererIndex);
  await waitFor(win, ".app-shell");
  await clickByLabel(win, "设置", "nav button, button");
  await waitFor(win, ".settings-page");

  const report = [];
  for (const viewport of viewports) {
    win.setSize(viewport.width, viewport.height);
    await settle();
    for (const [index, section] of sections.entries()) {
      await clickByLabel(win, section, ".settings-nav-button");
      await waitForHeading(win, section);
      await settle();
      const geometry = await win.webContents.executeJavaScript(`(() => {
      const detail = document.querySelector('.settings-detail');
      const header = document.querySelector('.settings-detail-header');
      const stack = document.querySelector('.settings-stack');
      const rect = (node) => node ? ({ left: node.getBoundingClientRect().left, right: node.getBoundingClientRect().right, width: node.getBoundingClientRect().width, top: node.getBoundingClientRect().top }) : null;
      return {
        heading: document.querySelector('.settings-detail-header h1')?.textContent?.trim() || null,
        detail: rect(detail),
        header: rect(header),
        stack: rect(stack),
        overflow: detail instanceof HTMLElement ? detail.scrollWidth - detail.clientWidth : null,
        documentOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth
      };
      })()`);
      const slug = String(index + 1).padStart(2, "0");
      const file = path.join(outputRoot, `${viewport.id}-${slug}-${section.replaceAll(" ", "-")}.png`);
      fs.writeFileSync(file, (await win.webContents.capturePage()).toPNG());
      report.push({ viewport: viewport.id, section, file: path.relative(appRoot, file), ...geometry });
    }
  }

  fs.writeFileSync(path.join(outputRoot, "report.json"), `${JSON.stringify({ generatedAt: new Date().toISOString(), consoleErrors, sections: report }, null, 2)}\n`);
  win.destroy();
  if (consoleErrors.length) throw new Error(`Renderer console errors:\n${consoleErrors.join("\n")}`);
  if (report.some((item) => item.overflow > 2 || item.documentOverflow > 2)) throw new Error("Settings visual QA found horizontal overflow.");
  console.log(`Settings visual QA passed: ${report.length} screenshots written to ${path.relative(appRoot, outputRoot)}.`);
  app.quit();
}).catch((error) => {
  console.error(error);
  app.exit(1);
});

async function clickByLabel(win, label, selector) {
  const clicked = await win.webContents.executeJavaScript(`(() => {
    const nodes = [...document.querySelectorAll(${JSON.stringify(selector)})];
    const target = nodes.find((node) => node.getAttribute('aria-label') === ${JSON.stringify(label)} || node.textContent?.trim() === ${JSON.stringify(label)});
    if (!(target instanceof HTMLButtonElement)) return false;
    target.click();
    return true;
  })()`);
  if (!clicked) throw new Error(`Button not found: ${label}`);
}

async function waitFor(win, selector) {
  const timeoutAt = Date.now() + 12_000;
  while (Date.now() < timeoutAt) {
    if (await win.webContents.executeJavaScript(`Boolean(document.querySelector(${JSON.stringify(selector)}))`)) return;
    await delay(80);
  }
  throw new Error(`Timed out waiting for ${selector}`);
}

async function waitForHeading(win, label) {
  const timeoutAt = Date.now() + 12_000;
  while (Date.now() < timeoutAt) {
    const heading = await win.webContents.executeJavaScript("document.querySelector('.settings-detail-header h1')?.textContent?.trim() || ''");
    const loading = await win.webContents.executeJavaScript("Boolean(document.querySelector('.settings-load-state'))");
    if (heading === label && !loading) return;
    await delay(80);
  }
  throw new Error(`Timed out waiting for settings section ${label}`);
}

async function settle() {
  await delay(260);
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
