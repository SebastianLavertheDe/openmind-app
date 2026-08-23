const fs = require("fs");
const path = require("path");
const { app, BrowserWindow } = require("electron");

const appRoot = path.resolve(__dirname, "..");
const rendererIndex = path.join(appRoot, ".build", "renderer", "index.html");
const preload = path.join(__dirname, "visual-snapshot-preload.js");
const outputRoot = path.resolve(process.env.OPENMIND_SETTINGS_QA_OUTPUT || path.join(appRoot, "design-qa", "settings-unified"));
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
      let interaction = null;
      if (section === "Skills") {
        interaction = await inspectSkillsInteraction(win);
        await clickSkillByTitle(win, "兴趣标记整理");
        await resetSettingsDetailScroll(win);
      }
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
      if (section === "AI 与模型" && viewport.id === "reference") {
        interaction = await captureProviderEvidence(win, outputRoot, viewport);
        await resetSettingsDetailScroll(win);
      }
      report.push({ viewport: viewport.id, section, file: path.relative(appRoot, file), interaction, ...geometry });
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

async function clickSkillByTitle(win, title) {
  const clicked = await win.webContents.executeJavaScript(`(() => {
    const labels = [...document.querySelectorAll('.skills-list-copy strong')];
    const target = labels.find((node) => node.textContent?.trim() === ${JSON.stringify(title)})?.closest('button');
    if (!(target instanceof HTMLButtonElement)) return false;
    target.click();
    return true;
  })()`);
  if (!clicked) throw new Error(`Skill not found: ${title}`);
}

async function inspectSkillsInteraction(win) {
  return win.webContents.executeJavaScript(`new Promise((resolve) => {
    const before = document.querySelector('.skills-detail-content');
    const target = document.querySelector('.skills-list-item:not(.active)');
    if (!(target instanceof HTMLButtonElement)) {
      resolve({ selectionChanged: false, reason: 'No alternate Skill row found.' });
      return;
    }
    target.click();
    requestAnimationFrame(() => {
      const after = document.querySelector('.skills-detail-content');
      const sourceTrigger = document.querySelector('.skills-source-group-trigger');
      const sourceContent = document.querySelector('.skills-source-group-content');
      const sourceChildren = sourceTrigger ? [...sourceTrigger.children] : [];
      const childCenters = sourceChildren.map((node) => {
        const rect = node.getBoundingClientRect();
        return rect.top + rect.height / 2;
      });
      const triggerStyle = sourceTrigger ? getComputedStyle(sourceTrigger) : null;
      const contentStyle = sourceContent ? getComputedStyle(sourceContent) : null;
      const animations = after instanceof HTMLElement ? after.getAnimations().map((animation) => ({
        name: animation instanceof CSSAnimation ? animation.animationName : animation.constructor.name,
        duration: animation.effect?.getTiming().duration ?? null,
        playState: animation.playState
      })) : [];
      resolve({
        selectionChanged: before !== after,
        selectedId: after instanceof HTMLElement ? after.dataset.skillDetailId || null : null,
        detailAnimations: animations,
        sourceSummary: {
          display: triggerStyle?.display || null,
          gridTemplateColumns: triggerStyle?.gridTemplateColumns || null,
          childCenterSpread: childCenters.length ? Math.max(...childCenters) - Math.min(...childCenters) : null,
          disclosureTransitionDuration: contentStyle?.transitionDuration || null
        }
      });
    });
  })`);
}

async function captureProviderEvidence(win, outputRoot, restoreViewport) {
  win.setSize(1577, 997);
  await settle();
  const initial = await win.webContents.executeJavaScript(`(() => ({
    expandedCount: document.querySelectorAll('.settings-provider-config-card[data-expanded]').length,
    bodyCount: document.querySelectorAll('.settings-provider-config-body').length,
    providerCount: document.querySelectorAll('.settings-provider-config-card').length
  }))()`);
  if (initial.providerCount < 2 || initial.expandedCount !== 0 || initial.bodyCount !== 0) {
    throw new Error(`Provider list must start fully collapsed: ${JSON.stringify(initial)}`);
  }
  await scrollToProviderList(win);
  const collapsedFile = path.join(outputRoot, "reference-provider-list-collapsed.png");
  fs.writeFileSync(collapsedFile, (await win.webContents.capturePage()).toPNG());
  const collapsedCardFile = path.join(outputRoot, "reference-provider-card-collapsed.png");
  await captureProviderCard(win, collapsedCardFile);

  const firstExpanded = await win.webContents.executeJavaScript(`(() => {
    const trigger = document.querySelector('.settings-provider-config-summary');
    if (!(trigger instanceof HTMLButtonElement)) return false;
    trigger.click();
    return true;
  })()`);
  if (!firstExpanded) throw new Error("Could not expand the first Provider.");
  await settle();
  await scrollToProviderList(win);
  const expandedState = await win.webContents.executeJavaScript(`(() => ({
    expandedCount: document.querySelectorAll('.settings-provider-config-card[data-expanded]').length,
    bodyCount: document.querySelectorAll('.settings-provider-config-body').length,
    firstExpanded: document.querySelector('.settings-provider-config-summary')?.getAttribute('aria-expanded') === 'true'
  }))()`);
  if (expandedState.expandedCount !== 1 || expandedState.bodyCount !== 1 || !expandedState.firstExpanded) {
    throw new Error(`Provider accordion did not open exactly one row: ${JSON.stringify(expandedState)}`);
  }
  await markProviderDirty(win);
  const expandedFile = path.join(outputRoot, "reference-provider-list-expanded.png");
  fs.writeFileSync(expandedFile, (await win.webContents.capturePage()).toPNG());
  const expandedCardFile = path.join(outputRoot, "reference-provider-card-expanded.png");
  await captureProviderCard(win, expandedCardFile);

  const switched = await win.webContents.executeJavaScript(`new Promise((resolve) => {
    const triggers = [...document.querySelectorAll('.settings-provider-config-summary')];
    if (!(triggers[1] instanceof HTMLButtonElement)) {
      resolve(null);
      return;
    }
    triggers[1].click();
    requestAnimationFrame(() => requestAnimationFrame(() => resolve({
      expandedCount: document.querySelectorAll('.settings-provider-config-card[data-expanded]').length,
      firstExpanded: triggers[0]?.getAttribute('aria-expanded') === 'true',
      secondExpanded: triggers[1]?.getAttribute('aria-expanded') === 'true'
    })));
  })`);
  if (!switched || switched.expandedCount !== 1 || switched.firstExpanded || !switched.secondExpanded) {
    throw new Error(`Provider accordion did not switch cleanly: ${JSON.stringify(switched)}`);
  }

  win.setSize(restoreViewport.width, restoreViewport.height);
  await settle();
  return {
    defaultCollapsed: true,
    singleOpen: true,
    collapsedFile: path.relative(appRoot, collapsedFile),
    collapsedCardFile: path.relative(appRoot, collapsedCardFile),
    expandedFile: path.relative(appRoot, expandedFile),
    expandedCardFile: path.relative(appRoot, expandedCardFile)
  };
}

async function markProviderDirty(win) {
  const changed = await win.webContents.executeJavaScript(`(() => {
    const input = document.querySelector('.settings-provider-config-body input[aria-label="模型"], .settings-provider-config-body label:nth-child(2) input');
    if (!(input instanceof HTMLInputElement)) return false;
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    setValue?.call(input, input.value + ' ');
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  })()`);
  if (!changed) throw new Error("Could not create the Provider dirty-state evidence.");
  await settle();
  const saveEnabled = await win.webContents.executeJavaScript(`!document.querySelector('.settings-provider-save-row .primary-button')?.disabled`);
  if (!saveEnabled) throw new Error("Provider dirty-state did not enable save controls.");
}

async function captureProviderCard(win, file) {
  const rect = await win.webContents.executeJavaScript(`(() => {
    const heading = [...document.querySelectorAll('.settings-card h2')].find((node) => node.textContent?.trim() === 'Provider 列表');
    const card = heading?.closest('.settings-card');
    if (!(card instanceof HTMLElement)) return null;
    const box = card.getBoundingClientRect();
    return { x: Math.max(0, Math.floor(box.x)), y: Math.max(0, Math.floor(box.y)), width: Math.ceil(box.width), height: Math.ceil(box.height) };
  })()`);
  if (!rect) throw new Error("Provider card was not found for focused evidence.");
  const image = await win.webContents.capturePage(rect);
  fs.writeFileSync(file, image.resize({ width: rect.width, height: rect.height, quality: "best" }).toPNG());
}

async function scrollToProviderList(win) {
  await win.webContents.executeJavaScript(`new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const detail = document.querySelector('.settings-detail');
      const heading = [...document.querySelectorAll('.settings-card h2')].find((node) => node.textContent?.trim() === 'Provider 列表');
      const card = heading?.closest('.settings-card');
      if (!(detail instanceof HTMLElement) || !(card instanceof HTMLElement)) {
        resolve(false);
        return;
      }
      const detailRect = detail.getBoundingClientRect();
      const cardRect = card.getBoundingClientRect();
      detail.scrollTo({ top: detail.scrollTop + cardRect.top - detailRect.top - 18, behavior: 'auto' });
      resolve(true);
    }));
  })`);
  await settle();
}

async function resetSettingsDetailScroll(win) {
  await settle();
  await win.webContents.executeJavaScript(`new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const detail = document.querySelector('.settings-detail');
      if (detail instanceof HTMLElement) detail.scrollTo({ top: 0, behavior: 'auto' });
      resolve(true);
    }));
  })`);
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
