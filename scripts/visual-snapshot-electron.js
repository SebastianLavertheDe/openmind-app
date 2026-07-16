const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { app, BrowserWindow } = require("electron");

const appRoot = path.resolve(__dirname, "..");
const outputRoot = path.join(appRoot, ".build", "visual-snapshots");
const rendererIndex = path.join(appRoot, ".build", "renderer", "index.html");
const preload = path.join(__dirname, "visual-snapshot-preload.js");

const viewports = [
  { id: "720x720", width: 720, height: 720, zoom: 1 },
  { id: "840x720", width: 840, height: 720, zoom: 1 },
  { id: "900x720", width: 900, height: 720, zoom: 1 },
  { id: "1020x720", width: 1020, height: 720, zoom: 1 },
  { id: "1280x720", width: 1280, height: 720, zoom: 1 },
  { id: "1366x768", width: 1366, height: 768, zoom: 1 },
  { id: "1920x1080", width: 1920, height: 1080, zoom: 1 },
  { id: "2560x1440", width: 2560, height: 1440, zoom: 1 },
  { id: "1366x768-zoom125", width: 1366, height: 768, zoom: 1.25 },
  { id: "1366x768-zoom150", width: 1366, height: 768, zoom: 1.5 }
];

const pages = [
  { id: "ai", label: "新建任务", minTextLength: 90, requiredSelector: ".ai-workbench" },
  { id: "sources", label: "资料库", requiredSelector: ".sources-page" },
  { id: "brief", label: "每日简报", requiredSelector: ".document-library-page" },
  // Compact master/detail shows one meaningful pane at a time, so semantic
  // readiness is stronger here than an arbitrary desktop-sized text budget.
  { id: "creative", label: "创作", minTextLength: 100, requiredSelector: ".creative-workspace-page" },
  { id: "automation", label: "自动化", requiredSelector: ".automation-page" },
  { id: "settings", label: "设置", requiredSelector: ".settings-page" }
];

app.commandLine.appendSwitch("disable-gpu");
app.commandLine.appendSwitch("no-sandbox");

app.whenReady().then(run).catch((error) => {
  console.error(error);
  app.exit(1);
});

async function run() {
  if (!fs.existsSync(rendererIndex)) throw new Error("Renderer build is missing. Run npm run build first.");
  fs.rmSync(outputRoot, { recursive: true, force: true });
  fs.mkdirSync(outputRoot, { recursive: true });

  const report = {
    generatedAt: new Date().toISOString(),
    renderer: path.relative(appRoot, rendererIndex),
    preload: path.relative(appRoot, preload),
    snapshots: [],
    stateSnapshots: [],
    failures: []
  };

  const first = viewports[0];
  const win = new BrowserWindow({
    width: first.width,
    height: first.height,
    show: true,
    backgroundColor: "#f6f7f9",
    webPreferences: {
      preload,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      backgroundThrottling: false
    }
  });
  win.webContents.on("console-message", (event) => {
    if (event.level >= 2) console.error(`[renderer:${event.level}] ${event.message} (${event.sourceId}:${event.lineNumber})`);
  });
  win.webContents.on("render-process-gone", (_event, details) => {
    console.error(`Renderer process exited: ${JSON.stringify(details)}`);
  });
  win.webContents.setZoomFactor(first.zoom);
  await win.loadFile(rendererIndex);
  await waitForReady(win, "新建任务", { minTextLength: 90, allowActiveSession: true });

  for (const viewport of viewports) {
    win.setSize(viewport.width, viewport.height);
    win.webContents.setZoomFactor(viewport.zoom);
    await settle();
    await clickNav(win, "新建任务");
    await waitForReady(win, "新建任务", { minTextLength: 90 });

    for (const page of pages) {
      if (page.id !== "ai") await clickNav(win, page.label);
      await waitForReady(win, page.label, { minTextLength: page.minTextLength, requiredSelector: page.requiredSelector });
      await settle();
      const audit = await inspectPage(win, page.label, { minTextLength: page.minTextLength, requiredSelector: page.requiredSelector });
      const file = path.join(outputRoot, `${viewport.id}-${page.id}.png`);
      const image = await win.webContents.capturePage();
      fs.writeFileSync(file, image.toPNG());
      const item = {
        viewport: viewport.id,
        page: page.id,
        label: page.label,
        file: path.relative(appRoot, file),
        width: viewport.width,
        height: viewport.height,
        zoom: viewport.zoom,
        ...audit
      };
      report.snapshots.push(item);
      if (!audit.ok) report.failures.push(item);
    }
  }

  win.setSize(1366, 768);
  win.webContents.setZoomFactor(1);
  await captureEmptySources(win, report);
  await captureSourcesError(win, report);
  await captureDarkDailyBrief(win, report);
  await captureCompletedAiResponse(win, report);
  await captureComposerSuggestions(win, report);
  win.destroy();

  const reportPath = path.join(appRoot, ".build", "visual-snapshot-report.json");
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  if (report.failures.length) {
    throw new Error(`Visual snapshot audit failed:\n${report.failures.map((item) => `- ${item.viewport || "state"}/${item.page || item.id}: ${item.reason}`).join("\n")}`);
  }
  console.log(`Visual snapshots passed: ${report.snapshots.length} screenshots, report .build/visual-snapshot-report.json.`);
  app.quit();
}

async function clickNav(win, label) {
  const clicked = await win.webContents.executeJavaScript(`
    (() => {
      const button = [...document.querySelectorAll('nav button')].find((item) => item.getAttribute('aria-label') === ${JSON.stringify(label)});
      if (!button) return false;
      button.click();
      return true;
    })()
  `);
  if (!clicked) throw new Error(`Navigation button not found: ${label}`);
}

async function waitForReady(win, label, options = {}) {
  const minTextLength = options.minTextLength ?? 200;
  const requiredSelector = options.requiredSelector || "body";
  let lastState = null;
  for (let attempt = 0; attempt < 100; attempt++) {
    const state = await win.webContents.executeJavaScript(`
      (() => {
        const active = document.querySelector('nav button[aria-current="page"]')?.getAttribute('aria-label') || "";
        const activeSession = Boolean(document.querySelector('.nav-recent-item[aria-current="true"]'));
        const aiPage = Boolean(document.querySelector('.app-shell.ai-page'));
        const loading = Boolean(document.querySelector('.splash,.route-loading'));
        const fatal = document.querySelector('.fatal')?.textContent || "";
        const textLength = (document.body?.innerText || "").trim().length;
        const semanticReady = Boolean(document.querySelector(${JSON.stringify(requiredSelector)}));
        return { active, activeSession, aiPage, loading, fatal, textLength, semanticReady };
      })()
    `);
    lastState = state;
    if (state.fatal) throw new Error(state.fatal);
    if ((state.active === label || (options.allowActiveSession && (state.activeSession || state.aiPage))) && !state.loading && state.semanticReady && state.textLength >= minTextLength) return;
    await delay(80);
  }
  throw new Error(`Timed out waiting for page: ${label}; last state=${JSON.stringify(lastState)}`);
}

async function inspectPage(win, label, options = {}) {
  const minTextLength = options.minTextLength ?? 200;
  const requiredSelector = options.requiredSelector || "body";
  const expectError = options.expectError === true;
  return win.webContents.executeJavaScript(`
    (() => {
      const root = document.documentElement;
      const body = document.body;
      const text = (body.innerText || "").replace(/\\s+/g, " ").trim();
      const horizontalOverflow = Math.max(root.scrollWidth - root.clientWidth, body.scrollWidth - body.clientWidth);
      const navVisible = Boolean([...document.querySelectorAll('nav button')].find((item) => item.getAttribute('aria-label') === ${JSON.stringify(label)}));
      const activeVisible = document.querySelector('nav button[aria-current="page"]')?.getAttribute('aria-label') === ${JSON.stringify(label)}
        || (${JSON.stringify(label)} === "新建任务" && Boolean(document.querySelector('.app-shell.ai-page')));
      const semanticReady = Boolean(document.querySelector(${JSON.stringify(requiredSelector)}));
      const shell = document.querySelector('.app-shell');
      const shellState = shell?.classList.contains('layout-shell-drawer') ? 'drawer'
        : shell?.classList.contains('layout-shell-rail') ? 'rail'
          : shell?.classList.contains('layout-shell-expanded') ? 'expanded' : 'unknown';
      const visible = (element) => {
        if (!(element instanceof Element)) return false;
        const style = getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
      };
      const undersizedResponsiveTargets = root.clientWidth <= 720
        ? [...document.querySelectorAll('.ui-responsive-action, .ui-responsive-overflow-trigger, .responsive-nav-toggle')]
          .filter(visible)
          .map((element) => ({ element, rect: element.getBoundingClientRect() }))
          .filter(({ rect }) => rect.width < 44 || rect.height < 44)
          .map(({ element, rect }) => ({
            label: element.getAttribute('aria-label') || element.textContent?.trim() || element.className,
            width: Math.round(rect.width),
            height: Math.round(rect.height)
          }))
        : [];
      const drawerToggleVisible = root.clientWidth > 840 || visible(document.querySelector('.responsive-nav-toggle'));
      const unexpectedError = [...document.querySelectorAll('.ui-error-state')].find(visible)?.textContent?.replace(/\\s+/g, ' ').trim() || null;
      const errorStateMatches = ${expectError} ? Boolean(unexpectedError) : !unexpectedError;
      const criticalContextMissing = [];
      if (document.querySelector('.conversation-header .provider-segmented')) {
        [
          ['provider', '.conversation-header .provider-name'],
          ['permission', '.conversation-header .provider-perm'],
          ['project', '.conversation-header small'],
          ['session-status', '.conversation-header .ui-responsive-context']
        ].forEach(([name, selector]) => {
          if (!visible(document.querySelector(selector))) criticalContextMissing.push(name);
        });
      }
      if (document.querySelector('.composer-workspace strong') && !visible(document.querySelector('.composer-workspace strong'))) {
        criticalContextMissing.push('composer-project');
      }
      const offenders = [...document.querySelectorAll('button, .workspace-card, .content-card, .project-card, .chat-message, .inspector-section')]
        .filter((element) => element.clientWidth > 0 && element.scrollWidth - element.clientWidth > 8)
        .slice(0, 8)
        .map((element) => ({
          tag: element.tagName.toLowerCase(),
          className: String(element.className || ""),
          text: (element.textContent || "").replace(/\\s+/g, " ").trim().slice(0, 120),
          overflow: element.scrollWidth - element.clientWidth
        }));
      const internalOverflowOffenders = [...document.querySelectorAll('*')]
        .filter((element) => visible(element) && element.scrollWidth - element.clientWidth > 8)
        .slice(0, 12)
        .map((element) => ({
          tag: element.tagName.toLowerCase(),
          className: String(element.className || ''),
          clientWidth: element.clientWidth,
          scrollWidth: element.scrollWidth
        }));
      const conversationHeader = document.querySelector('.conversation-header');
      const conversationTitle = conversationHeader?.querySelector('h2');
      const rect = (element) => element ? Object.fromEntries(['top', 'right', 'bottom', 'left', 'width', 'height'].map((key) => [key, Math.round(element.getBoundingClientRect()[key])])) : null;
      const titleRect = conversationTitle?.getBoundingClientRect();
      const titleTopElement = titleRect
        ? document.elementFromPoint(titleRect.left + titleRect.width / 2, titleRect.top + titleRect.height / 2)
        : null;
      const conversationHeaderGeometry = conversationHeader ? {
        header: rect(conversationHeader),
        title: rect(conversationTitle),
        titleTopElement: titleTopElement ? titleTopElement.tagName.toLowerCase() + '.' + String(titleTopElement.className || '').replace(/\\s+/g, '.') : null,
        rows: getComputedStyle(conversationHeader.parentElement).gridTemplateRows,
        chat: rect(document.querySelector('.conversation-pane > .chat')),
        chatScroll: rect(document.querySelector('.conversation-pane > .chat > .chat-scroll')),
        approval: rect(document.querySelector('.conversation-pane .approval-banner')),
        approvalPosition: document.querySelector('.conversation-pane .approval-banner') ? getComputedStyle(document.querySelector('.conversation-pane .approval-banner')).position : null
      } : null;
      const conversationTitleOccluded = Boolean(titleTopElement && conversationHeader && !conversationHeader.contains(titleTopElement));
      const ok = text.length >= ${minTextLength}
        && semanticReady
        && navVisible
        && activeVisible
        && drawerToggleVisible
        && errorStateMatches
        && criticalContextMissing.length === 0
        && !conversationTitleOccluded
        && undersizedResponsiveTargets.length === 0
        && horizontalOverflow <= 2;
      return {
        ok,
        reason: ok ? null : \`text=\${text.length}, semantic=\${semanticReady}, nav=\${navVisible}, active=\${activeVisible}, drawerToggle=\${drawerToggleVisible}, error=\${unexpectedError || 'none'}, errorExpected=${expectError}, context=\${criticalContextMissing.join(',') || 'complete'}, titleOccluded=\${conversationTitleOccluded}, targets=\${undersizedResponsiveTargets.length}, overflow=\${horizontalOverflow}\`,
        textLength: text.length,
        semanticReady,
        shellState,
        unexpectedError,
        criticalContextMissing,
        undersizedResponsiveTargets,
        horizontalOverflow,
        overflowOffenders: offenders
        ,internalOverflowOffenders
        ,conversationHeaderGeometry
        ,conversationTitleOccluded
      };
    })()
  `);
}

async function captureEmptySources(win, report) {
  await win.webContents.executeJavaScript("window.cctools.__setVisualMode('empty')");
  await clickNav(win, "资料库");
  await waitForText(win, "还没有添加数据源");
  await captureState(win, report, "empty-sources", "资料库", "Empty source registry");
}

async function captureSourcesError(win, report) {
  await win.webContents.executeJavaScript("window.cctools.__setVisualMode('error')");
  await clickNav(win, "新建任务");
  await clickNav(win, "资料库");
  await waitForText(win, "视觉验收模拟错误");
  await captureState(win, report, "error-sources", "资料库", "Source registry recoverable error", { minTextLength: 40, expectError: true });
  await win.webContents.executeJavaScript("window.cctools.__setVisualMode('normal')");
}

async function captureDarkDailyBrief(win, report) {
  await win.webContents.executeJavaScript("window.cctools.__setVisualMode('normal')");
  await win.webContents.executeJavaScript("document.documentElement.setAttribute('data-theme', 'dark')");
  try {
    await clickNav(win, "每日简报");
    await waitForReady(win, "每日简报", { requiredSelector: ".document-library-page" });
    await waitForSelector(win, ".brief-file-item.active");
    const colors = await win.webContents.executeJavaScript(`
      (() => {
        const list = getComputedStyle(document.querySelector('.document-library-list')).backgroundColor;
        const detail = getComputedStyle(document.querySelector('.document-library-detail')).backgroundColor;
        const channels = (list.match(/\\d+(?:\\.\\d+)?/g) || []).slice(0, 3).map(Number);
        return {
          list,
          detail,
          matchesDetail: list === detail,
          isDark: channels.length === 3 && channels.reduce((sum, value) => sum + value, 0) / 3 < 128
        };
      })()
    `);
    if (!colors.matchesDetail || !colors.isDark) {
      throw new Error(`Daily brief list did not inherit the dark workspace surface: ${JSON.stringify(colors)}`);
    }
    await captureState(win, report, "daily-brief-dark", "每日简报", "Daily brief file list in dark theme", {
      requiredSelector: ".document-library-page"
    });
  } finally {
    await win.webContents.executeJavaScript("document.documentElement.setAttribute('data-theme', 'light')");
  }
}

async function captureComposerSuggestions(win, report) {
  await win.webContents.executeJavaScript("window.cctools.__setVisualMode('normal')");
  await clickNav(win, "新建任务");
  await waitForReady(win, "新建任务");

  await waitForSelector(win, ".approval-banner .approval-card");
  await waitForSelector(win, 'textarea[aria-label="AI 消息"]');
  await assertPendingApprovalGeometry(win);
  await captureState(win, report, "ai-pending-approval", "新建任务", "Long WSL/UNC approval remains fully actionable above the composer", {
    requiredSelector: ".approval-banner .approval-card"
  });

  const resolvedApproval = await win.webContents.executeJavaScript(`
    (() => {
      const allow = document.querySelector('.approval-banner .approval-btn-primary');
      if (!allow) return false;
      allow.click();
      return true;
    })()
  `);
  if (!resolvedApproval) throw new Error("Pending approval allow button was not reachable.");
  await waitForSelectorToDisappear(win, ".approval-banner");
  await waitForSelector(win, 'textarea[aria-label="AI 消息"]');

  await setComposerValue(win, "/");
  await waitForText(win, "选择要运行的真实工作流");
  await captureState(win, report, "ai-skill-menu", "新建任务", "Registered skill suggestion menu");

  await setComposerValue(win, "@composer");
  await waitForText(win, "composer-workflow.md");
  await captureState(win, report, "ai-file-mention", "新建任务", "Project file mention search");

  await win.webContents.executeJavaScript("document.documentElement.setAttribute('data-theme', 'dark')");
  await captureState(win, report, "ai-file-mention-dark", "新建任务", "Project file mention search in dark theme");
  await win.webContents.executeJavaScript("document.documentElement.setAttribute('data-theme', 'light')");
}

async function assertPendingApprovalGeometry(win) {
  const geometry = await win.webContents.executeJavaScript(`
    (() => {
      const banner = document.querySelector('.approval-banner');
      const card = banner?.querySelector('.approval-card');
      const allow = banner?.querySelector('.approval-btn-primary');
      const decline = banner?.querySelector('.approval-btn-danger');
      const composer = document.querySelector('textarea[aria-label="AI 消息"]');
      const viewport = { left: 0, top: 0, right: window.innerWidth, bottom: window.innerHeight };
      const rect = (element) => {
        if (!(element instanceof Element)) return null;
        const value = element.getBoundingClientRect();
        return Object.fromEntries(['left', 'top', 'right', 'bottom', 'width', 'height'].map((key) => [key, Math.round(value[key] * 10) / 10]));
      };
      const visible = (element) => {
        if (!(element instanceof Element)) return false;
        const style = getComputedStyle(element);
        const value = element.getBoundingClientRect();
        return style.display !== 'none'
          && style.visibility !== 'hidden'
          && Number(style.opacity || 1) > 0
          && value.width > 0
          && value.height > 0
          && value.right > 0
          && value.bottom > 0
          && value.left < window.innerWidth
          && value.top < window.innerHeight;
      };
      const inside = (inner, outer, tolerance = 1) => {
        if (!inner || !outer) return false;
        return inner.left >= outer.left - tolerance
          && inner.top >= outer.top - tolerance
          && inner.right <= outer.right + tolerance
          && inner.bottom <= outer.bottom + tolerance;
      };
      const hitTest = (button) => {
        if (!(button instanceof Element)) return { ok: false, target: null };
        const value = button.getBoundingClientRect();
        const target = document.elementFromPoint(value.left + value.width / 2, value.top + value.height / 2);
        return {
          ok: Boolean(target && (target === button || button.contains(target))),
          target: target ? target.tagName.toLowerCase() + (target.className ? '.' + String(target.className).trim().replace(/\\s+/g, '.') : '') : null
        };
      };
      const overlaps = (first, second, tolerance = 1) => Boolean(first && second
        && Math.min(first.right, second.right) - Math.max(first.left, second.left) > tolerance
        && Math.min(first.bottom, second.bottom) - Math.max(first.top, second.top) > tolerance);
      const bannerRect = rect(banner);
      const cardRect = rect(card);
      const allowRect = rect(allow);
      const declineRect = rect(decline);
      const composerRect = rect(composer);
      const allowHit = hitTest(allow);
      const declineHit = hitTest(decline);
      const horizontalOverflow = {
        banner: banner instanceof Element ? Math.max(0, banner.scrollWidth - banner.clientWidth) : null,
        card: card instanceof Element ? Math.max(0, card.scrollWidth - card.clientWidth) : null
      };
      const checks = {
        bannerVisible: visible(banner),
        cardVisible: visible(card),
        allowVisible: visible(allow),
        declineVisible: visible(decline),
        composerVisible: visible(composer),
        allowInsideViewport: inside(allowRect, viewport),
        declineInsideViewport: inside(declineRect, viewport),
        allowInsideCard: inside(allowRect, cardRect),
        declineInsideCard: inside(declineRect, cardRect),
        allowHit: allowHit.ok,
        declineHit: declineHit.ok,
        bannerNoHorizontalOverflow: horizontalOverflow.banner !== null && horizontalOverflow.banner <= 2,
        cardNoHorizontalOverflow: horizontalOverflow.card !== null && horizontalOverflow.card <= 2,
        bannerComposerSeparated: !overlaps(bannerRect, composerRect)
      };
      return {
        ok: Object.values(checks).every(Boolean),
        checks,
        rects: { viewport, banner: bannerRect, card: cardRect, allow: allowRect, decline: declineRect, composer: composerRect },
        hitTargets: { allow: allowHit.target, decline: declineHit.target },
        horizontalOverflow
      };
    })()
  `);
  if (!geometry.ok) {
    const failed = Object.entries(geometry.checks).filter(([, passed]) => !passed).map(([name]) => name);
    throw new Error(`Pending approval geometry failed (${failed.join(", ")}): ${JSON.stringify(geometry)}`);
  }
  return geometry;
}

async function captureCompletedAiResponse(win, report) {
  await win.webContents.executeJavaScript("window.cctools.__setVisualMode('normal')");
  await clickNav(win, "新建任务");
  await waitForReady(win, "新建任务");
  await win.webContents.executeJavaScript("document.querySelector('button.history-toggle')?.click()");
  await waitForSelector(win, ".history-flyout");
  const clicked = await win.webContents.executeJavaScript(`
    (() => {
      const session = [...document.querySelectorAll('article.nav-recent-item[role="option"]')]
        .find((item) => item.textContent.includes("10000 events"));
      if (!session) return false;
      session.click();
      return true;
    })()
  `);
  if (!clicked) throw new Error("Completed AI response fixture was not found.");
  await win.webContents.executeJavaScript("document.querySelector('button.history-toggle')?.click()");
  await scrollDisclosureTriggerIntoView(win, ".completed-process");
  await waitForDisclosureState(win, ".completed-process", false);
  const completedSnapshot = await captureState(win, report, "ai-completed-response", "新建任务", "Completed response with process status above the first assistant message");

  // AnimatedDisclosure uses a button trigger and keeps its closed content
  // mounted. A bare querySelector therefore cannot prove that a click happened
  // or that the content reached a visible, interactive open state.
  await expandDisclosure(win, ".completed-process");
  await waitForDisclosureState(win, ".completed-process .command-group", false);
  const expandedToolCount = await win.webContents.executeJavaScript(
    "document.querySelectorAll('.completed-process .tool-event[data-open]').length"
  );
  if (expandedToolCount !== 0) {
    throw new Error(`Completed process opened with ${expandedToolCount} expanded tool rows.`);
  }
  const expandedGroupCount = await win.webContents.executeJavaScript(
    "document.querySelectorAll('.completed-process .command-group[data-open]').length"
  );
  if (expandedGroupCount !== 0) {
    throw new Error(`Completed process opened with ${expandedGroupCount} expanded command groups.`);
  }
  const commandGroupSnapshot = await captureState(win, report, "ai-command-group", "新建任务", "Expanded process with compact grouped command history");

  await expandDisclosure(win, ".completed-process .command-group");
  await waitForDisclosureState(win, ".completed-process .command-group .tool-event", false, 1);
  await expandDisclosure(win, ".completed-process .command-group .tool-event", 1);
  const terminalSelector = ".completed-process .command-group .tool-event[data-open] .command-terminal";
  await scrollSelectorIntoView(win, terminalSelector);
  await waitForSelector(win, terminalSelector);
  const expandedCommandSnapshot = await captureState(win, report, "ai-command-group-expanded", "新建任务", "A single command expanded in place while preserving command context");

  assertDistinctPixelSnapshots([completedSnapshot, commandGroupSnapshot, expandedCommandSnapshot]);
}

async function setComposerValue(win, value) {
  const changed = await win.webContents.executeJavaScript(`
    (() => {
      const input = document.querySelector('textarea[aria-label="AI 消息"]');
      if (!input) return false;
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set;
      setter.call(input, ${JSON.stringify(value)});
      input.focus();
      input.setSelectionRange(${value.length}, ${value.length});
      input.dispatchEvent(new Event("input", { bubbles: true }));
      return true;
    })()
  `);
  if (!changed) throw new Error("AI composer textarea was not found.");
}

async function captureState(win, report, id, label, description, options = {}) {
  await settle();
  const audit = await inspectPage(win, label, options);
  const file = path.join(outputRoot, `state-${id}.png`);
  const image = await win.webContents.capturePage();
  const png = image.toPNG();
  const pixelHash = crypto.createHash("sha256").update(image.toBitmap()).digest("hex");
  fs.writeFileSync(file, png);
  const item = {
    id,
    label,
    description,
    file: path.relative(appRoot, file),
    width: 1366,
    height: 768,
    zoom: 1,
    pixelHash,
    ...audit
  };
  report.stateSnapshots.push(item);
  if (!audit.ok) report.failures.push(item);
  return item;
}

async function waitForText(win, text) {
  for (let attempt = 0; attempt < 80; attempt++) {
    const found = await win.webContents.executeJavaScript(`document.body.innerText.includes(${JSON.stringify(text)})`);
    if (found) return;
    await delay(80);
  }
  throw new Error(`Timed out waiting for text: ${text}`);
}

async function waitForSelector(win, selector) {
  for (let attempt = 0; attempt < 80; attempt++) {
    const found = await win.webContents.executeJavaScript(`
      (() => {
        const visible = (element) => {
          if (!(element instanceof Element)) return false;
          const style = getComputedStyle(element);
          const rect = element.getBoundingClientRect();
          const left = Math.max(0, rect.left);
          const right = Math.min(window.innerWidth, rect.right);
          const top = Math.max(0, rect.top);
          const bottom = Math.min(window.innerHeight, rect.bottom);
          if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity || 1) <= 0) return false;
          if (right <= left || bottom <= top || rect.width <= 0 || rect.height <= 0) return false;
          const target = document.elementFromPoint((left + right) / 2, (top + bottom) / 2);
          return Boolean(target && (target === element || element.contains(target)));
        };
        return [...document.querySelectorAll(${JSON.stringify(selector)})].some(visible);
      })()
    `);
    if (found) return;
    await delay(80);
  }
  throw new Error(`Timed out waiting for visible selector: ${selector}`);
}

async function waitForSelectorToDisappear(win, selector) {
  for (let attempt = 0; attempt < 80; attempt++) {
    const visible = await win.webContents.executeJavaScript(`
      (() => {
        const element = document.querySelector(${JSON.stringify(selector)});
        if (!(element instanceof Element)) return false;
        const style = getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return style.display !== 'none'
          && style.visibility !== 'hidden'
          && Number(style.opacity || 1) > 0
          && rect.width > 0
          && rect.height > 0
          && rect.right > 0
          && rect.bottom > 0
          && rect.left < window.innerWidth
          && rect.top < window.innerHeight;
      })()
    `);
    if (!visible) return;
    await delay(80);
  }
  throw new Error(`Timed out waiting for visible selector to disappear: ${selector}`);
}

async function waitForDisclosureState(win, rootSelector, expanded, index = 0) {
  let lastState = null;
  for (let attempt = 0; attempt < 80; attempt++) {
    const state = await win.webContents.executeJavaScript(`
      (() => {
        const roots = [...document.querySelectorAll(${JSON.stringify(rootSelector)})];
        const root = roots[${index}] || null;
        const trigger = root ? [...root.children].find((element) => element.classList.contains('ui-disclosure-trigger')) : null;
        const content = root ? [...root.children].find((element) => element.classList.contains('ui-disclosure-content')) : null;
        const inner = content?.querySelector(':scope > .ui-disclosure-content-inner') || null;
        const visibleAndHit = (element) => {
          if (!(element instanceof Element)) return { visible: false, hit: false, rect: null, target: null };
          const style = getComputedStyle(element);
          const rect = element.getBoundingClientRect();
          const left = Math.max(0, rect.left);
          const right = Math.min(window.innerWidth, rect.right);
          const top = Math.max(0, rect.top);
          const bottom = Math.min(window.innerHeight, rect.bottom);
          const visible = style.display !== 'none'
            && style.visibility !== 'hidden'
            && Number(style.opacity || 1) > 0
            && rect.width > 0
            && rect.height > 0
            && right > left
            && bottom > top;
          const target = visible ? document.elementFromPoint((left + right) / 2, (top + bottom) / 2) : null;
          return {
            visible,
            hit: Boolean(target && (target === element || element.contains(target))),
            rect: { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height },
            target: target ? target.tagName.toLowerCase() + (target.className ? '.' + String(target.className).trim().replace(/\\s+/g, '.') : '') : null
          };
        };
        const triggerState = visibleAndHit(trigger);
        const rootState = visibleAndHit(root);
        const contentRect = content?.getBoundingClientRect() || null;
        const ariaExpanded = trigger?.getAttribute('aria-expanded') || null;
        const rootOpen = Boolean(root?.hasAttribute('data-open'));
        const contentOpen = Boolean(content?.hasAttribute('data-open'));
        const contentAriaHidden = content?.getAttribute('aria-hidden') || null;
        const innerInert = Boolean(inner?.hasAttribute('inert'));
        const disabled = Boolean(trigger?.disabled || trigger?.getAttribute('aria-disabled') === 'true');
        const inert = Boolean(trigger?.closest('[inert]'));
        const pointerEvents = trigger ? getComputedStyle(trigger).pointerEvents : 'none';
        const interactive = triggerState.visible && triggerState.hit && !disabled && !inert && pointerEvents !== 'none';
        const semanticOpen = ariaExpanded === 'true' && rootOpen && contentOpen && contentAriaHidden === 'false' && !innerInert;
        const semanticClosed = ariaExpanded === 'false' && !rootOpen && !contentOpen && contentAriaHidden === 'true' && innerInert;
        const contentSettledOpen = Boolean(contentRect && contentRect.width > 0 && contentRect.height > 0);
        const ok = rootState.visible
          && interactive
          && (${expanded} ? semanticOpen && contentSettledOpen : semanticClosed);
        return {
          ok,
          count: roots.length,
          ariaExpanded,
          rootOpen,
          contentOpen,
          contentAriaHidden,
          innerInert,
          interactive,
          disabled,
          inert,
          pointerEvents,
          root: rootState,
          trigger: triggerState,
          contentHeight: contentRect?.height || 0
        };
      })()
    `);
    lastState = state;
    if (state.ok) return state;
    await delay(80);
  }
  throw new Error(`Timed out waiting for disclosure ${rootSelector}[${index}] expanded=${expanded}; last state=${JSON.stringify(lastState)}`);
}

async function expandDisclosure(win, rootSelector, index = 0) {
  await scrollDisclosureTriggerIntoView(win, rootSelector, index);
  await waitForDisclosureState(win, rootSelector, false, index);
  const clicked = await win.webContents.executeJavaScript(`
    (() => {
      const root = [...document.querySelectorAll(${JSON.stringify(rootSelector)})][${index}] || null;
      const trigger = root ? [...root.children].find((element) => element.classList.contains('ui-disclosure-trigger')) : null;
      if (!(trigger instanceof HTMLButtonElement) || trigger.disabled || trigger.getAttribute('aria-expanded') !== 'false') return false;
      trigger.click();
      return true;
    })()
  `);
  if (!clicked) throw new Error(`Disclosure trigger was not clickable: ${rootSelector}[${index}]`);
  return waitForDisclosureState(win, rootSelector, true, index);
}

async function scrollDisclosureTriggerIntoView(win, rootSelector, index = 0) {
  const found = await win.webContents.executeJavaScript(`
    (() => {
      const root = [...document.querySelectorAll(${JSON.stringify(rootSelector)})][${index}] || null;
      const trigger = root ? [...root.children].find((element) => element.classList.contains('ui-disclosure-trigger')) : null;
      if (!(trigger instanceof Element)) return false;
      trigger.scrollIntoView({ block: 'center', inline: 'nearest' });
      return true;
    })()
  `);
  if (!found) throw new Error(`Disclosure trigger not found: ${rootSelector}[${index}]`);
  await delay(120);
}

async function scrollSelectorIntoView(win, selector, index = 0) {
  const found = await win.webContents.executeJavaScript(`
    (() => {
      const element = [...document.querySelectorAll(${JSON.stringify(selector)})][${index}] || null;
      if (!(element instanceof Element)) return false;
      element.scrollIntoView({ block: 'center', inline: 'nearest' });
      return true;
    })()
  `);
  if (!found) throw new Error(`Selector not found for scrolling: ${selector}[${index}]`);
  await delay(120);
}

function assertDistinctPixelSnapshots(items) {
  const duplicateGroups = [...items.reduce((groups, item) => {
    const matches = groups.get(item.pixelHash) || [];
    matches.push(item.id);
    groups.set(item.pixelHash, matches);
    return groups;
  }, new Map()).entries()].filter(([, ids]) => ids.length > 1);
  if (duplicateGroups.length) {
    throw new Error(`Visual disclosure states produced identical pixels: ${duplicateGroups.map(([hash, ids]) => `${ids.join(" = ")} (${hash.slice(0, 12)})`).join(", ")}`);
  }
}

async function waitForEmptyState(win) {
  for (let attempt = 0; attempt < 80; attempt++) {
    const state = await win.webContents.executeJavaScript(`
      (() => {
        const text = document.body.innerText;
        const options = document.querySelectorAll('[role="option"]').length;
        return { text, options };
      })()
    `);
    if (state.options === 0 && /没有|暂无|空/.test(state.text)) return;
    await delay(80);
  }
  throw new Error("Timed out waiting for empty inbox state.");
}

function settle() {
  // Shared entrance stagger caps at 175ms delay + 200ms duration.
  return delay(420);
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
