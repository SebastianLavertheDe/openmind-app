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
  { id: "settings", label: "设置", requiredSelector: ".settings-page", settingsMode: true }
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
      await waitForReady(win, page.label, {
        minTextLength: page.minTextLength,
        requiredSelector: page.requiredSelector,
        settingsMode: page.settingsMode
      });
      await settle();
      const audit = await inspectPage(win, page.label, {
        minTextLength: page.minTextLength,
        requiredSelector: page.requiredSelector,
        settingsMode: page.settingsMode
      });
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

    const settingsReturnPage = pages[pages.length - 2];
    await exitSettings(win);
    await waitForReady(win, settingsReturnPage.label, {
      minTextLength: settingsReturnPage.minTextLength,
      requiredSelector: settingsReturnPage.requiredSelector
    });
  }

  await captureCompanionLayoutContracts(win, report);
  await captureGlobalSearchLayerContract(win, report);
  await captureCreativeReaderLayout(win, report);

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

async function captureCreativeReaderLayout(win, report) {
  const creativePage = pages.find((page) => page.id === "creative");
  if (!creativePage) throw new Error("Creative page config is missing.");

  await win.webContents.executeJavaScript("window.cctools.__setVisualMode('normal')");
  win.webContents.setZoomFactor(1);
  win.setSize(2048, 1119);
  await settle();
  await clickNav(win, creativePage.label);
  await waitForReady(win, creativePage.label, {
    minTextLength: creativePage.minTextLength,
    requiredSelector: creativePage.requiredSelector
  });

  const opened = await win.webContents.executeJavaScript(`
    (() => {
      const file = document.querySelector('.stream-date-file:not([disabled])');
      if (!(file instanceof HTMLButtonElement)) return false;
      file.click();
      return true;
    })()
  `);
  if (!opened) throw new Error("Creative topic file preview target was not found.");

  await waitForReady(win, creativePage.label, {
    minTextLength: creativePage.minTextLength,
    requiredSelector: ".creative-topic-file-content .file-reader"
  });
  await settle();

  const geometry = await win.webContents.executeJavaScript(`
    (() => {
      const root = document.documentElement;
      const body = document.body;
      const container = document.querySelector('.creative-topic-file-content');
      const preview = container?.querySelector('.file-reader');
      const prose = preview?.querySelector(':scope > :is(h1, h2, h3, h4, h5, h6, p, ul, ol, blockquote, hr)');
      const rect = (element) => {
        if (!(element instanceof Element)) return null;
        const value = element.getBoundingClientRect();
        return Object.fromEntries(['left', 'top', 'right', 'bottom', 'width', 'height'].map(
          (key) => [key, Math.round(value[key] * 10) / 10]
        ));
      };
      return {
        viewport: { width: window.innerWidth, height: window.innerHeight },
        container: rect(container),
        preview: rect(preview),
        prose: rect(prose),
        previewMaxWidth: preview instanceof Element ? getComputedStyle(preview).maxWidth : null,
        proseMaxWidth: prose instanceof Element ? getComputedStyle(prose).maxWidth : null,
        horizontalOverflow: Math.max(root.scrollWidth - root.clientWidth, body.scrollWidth - body.clientWidth)
      };
    })()
  `);

  const expectedPreviewWidth = geometry.container ? Math.min(geometry.container.width, 1120) : 0;
  const checks = {
    previewVisible: Boolean(geometry.preview && geometry.preview.width > 0 && geometry.preview.height > 0),
    canvasWidth: Boolean(geometry.preview && Math.abs(geometry.preview.width - expectedPreviewWidth) <= 2),
    proseWidth: geometry.proseMaxWidth === "920px" && Boolean(geometry.prose && geometry.prose.width <= 920.5),
    previewInsideContainer: Boolean(
      geometry.preview
      && geometry.container
      && geometry.preview.left >= geometry.container.left - 1
      && geometry.preview.right <= geometry.container.right + 1
    ),
    noHorizontalOverflow: geometry.horizontalOverflow <= 2
  };
  const ok = Object.values(checks).every(Boolean);
  const image = await win.webContents.capturePage();
  const file = path.join(outputRoot, "state-creative-reader-2048.png");
  fs.writeFileSync(file, image.toPNG());
  const item = {
    id: "creative-reader-2048",
    page: "creative",
    label: creativePage.label,
    description: "Creative topic file preview uses the wide canvas and readable prose measure",
    file: path.relative(appRoot, file),
    width: geometry.viewport.width,
    height: geometry.viewport.height,
    zoom: 1,
    ok,
    reason: ok
      ? null
      : "creative reader checks failed: " + Object.entries(checks).filter(([, passed]) => !passed).map(([name]) => name).join(", "),
    checks,
    geometry
  };
  report.stateSnapshots.push(item);
  if (!ok) report.failures.push(item);
}

async function captureCompanionLayoutContracts(win, report) {
  await win.webContents.executeJavaScript("window.cctools.__setVisualMode('normal')");
  win.webContents.setZoomFactor(1);
  win.setSize(1600, 900);
  await settle();
  await clickNav(win, "创作");
  await waitForReady(win, "创作", { minTextLength: 100, requiredSelector: ".creative-workspace-page" });
  await ensureDefaultCompanion(win);
  await resetCompanionWidth(win);
  await ensureExpandedNavigation(win);

  const expandedGeometry = await inspectCompanionGeometry(win);

  await captureCompanionGeometryState(
    win,
    report,
    "companion-docked-1600",
    "docked",
    "Expanded navigation, usable workspace, and default AI companion",
    {
      expandedShell: expandedGeometry.shellClass.includes("layout-shell-expanded"),
      expandedNavigation: Boolean(expandedGeometry.nav && Math.abs(expandedGeometry.nav.width - 260) <= 2),
      defaultCompanionWidth: expandedGeometry.layoutWidth === 420 && expandedGeometry.separatorValue === 420
    }
  );

  await clickCompanionAction(win, "全屏");
  await settle();
  await captureCompanionGeometryState(
    win,
    report,
    "companion-fullscreen-1600",
    "fullscreen",
    "Fullscreen AI companion covers and isolates the complete application"
  );
  await clickCompanionAction(win, "退出全屏");
  await settle();

  win.setSize(1280, 800);
  await settle();
  await ensureDefaultCompanion(win);
  await resetCompanionWidth(win);
  const beforeResize = await inspectCompanionGeometry(win);
  await dragCompanionResizer(win, -80);
  const afterResize = await inspectCompanionGeometry(win);
  await captureCompanionGeometryState(
    win,
    report,
    "companion-resize-1280",
    "docked",
    "AI companion expands to the available bound without shrinking the workspace below its contract",
    {
      widthExpanded: Boolean(afterResize.sidebar && beforeResize.sidebar && afterResize.sidebar.width > beforeResize.sidebar.width),
      workspacePreserved: afterResize.stageTrackWidth >= 759.5,
      beforeResize,
      afterResize
    }
  );
  await resetCompanionWidth(win);

  await clickCompanionAction(win, "\u5207\u6362\u5bbd\u5c4f");
  await settle();
  const wideGeometry = await inspectCompanionGeometry(win);
  await captureCompanionGeometryState(
    win,
    report,
    "companion-wide-clamped-1280",
    "docked",
    "Wide AI preference shrinks before replacing the workspace",
    {
      compactPresentation: wideGeometry.sidebarClass.includes("layout-companion-compact"),
      widePreferencePreserved: wideGeometry.layoutWidth === 760,
      wideWidthClamped: Number(wideGeometry.separatorValue) >= 380 && Number(wideGeometry.separatorValue) < 760,
      workspacePreserved: wideGeometry.stageTrackWidth >= 759.5
    }
  );
  await ensureDefaultCompanion(win);
  await resetCompanionWidth(win);

  win.setSize(2048, 1100);
  win.webContents.setZoomFactor(1.5);
  await settle();
  await ensureDefaultCompanion(win);
  await resetCompanionWidth(win);
  await clickCompanionAction(win, "\u5207\u6362\u5bbd\u5c4f");
  await settle();
  const highDpiWideGeometry = await inspectCompanionGeometry(win);
  await captureCompanionGeometryState(
    win,
    report,
    "companion-wide-2048-zoom150",
    "docked",
    "A visually large 150% window keeps the workspace beside a clamped wide AI companion",
    {
      compactPresentation: highDpiWideGeometry.sidebarClass.includes("layout-companion-compact"),
      effectiveViewportAboveCanvas: highDpiWideGeometry.viewport.width > 840,
      widePreferencePreserved: highDpiWideGeometry.layoutWidth === 760,
      wideWidthClamped: Number(highDpiWideGeometry.separatorValue) >= 380 && Number(highDpiWideGeometry.separatorValue) < 760,
      workspacePreserved: highDpiWideGeometry.stageTrackWidth >= 759.5,
      requestedZoom: win.webContents.getZoomFactor()
    }
  );
  await ensureDefaultCompanion(win);
  await resetCompanionWidth(win);

  win.setSize(1366, 768);
  await settle();
  await ensureDefaultCompanion(win);
  const zoomedCompactGeometry = await inspectCompanionGeometry(win);
  await captureCompanionGeometryState(
    win,
    report,
    "companion-attached-1366-zoom150",
    "docked",
    "The compact companion remains attached above the 840 CSS pixel boundary at 150% zoom",
    {
      compactPresentation: zoomedCompactGeometry.sidebarClass.includes("layout-companion-compact"),
      effectiveViewportAboveCanvas: zoomedCompactGeometry.viewport.width > 840,
      workspaceStillVisible: zoomedCompactGeometry.stageTrackWidth >= 399.5,
      requestedZoom: win.webContents.getZoomFactor()
    }
  );
  win.webContents.setZoomFactor(1);
  await settle();

  for (const scenario of [
    { width: 1100, height: 800, id: "companion-attached-1100", expected: "docked" },
    { width: 900, height: 800, id: "companion-attached-900", expected: "docked" },
    { width: 841, height: 800, id: "companion-attached-841", expected: "docked" },
    { width: 840, height: 800, id: "companion-canvas-840", expected: "canvas" },
    { width: 841, height: 800, id: "companion-attached-return-841", expected: "docked" },
    { width: 720, height: 720, id: "companion-canvas-720", expected: "canvas" }
  ]) {
    win.setSize(scenario.width, scenario.height);
    await settle();
    await ensureDefaultCompanion(win);
    await captureCompanionGeometryState(
      win,
      report,
      scenario.id,
      scenario.expected,
      `AI companion is ${scenario.expected === "docked" ? "attached" : "canvas"} at ${scenario.width}px`
    );
  }

  await win.webContents.executeJavaScript(`
    (() => {
      const collapse = document.querySelector('.ai-sidebar button[aria-label="收起"]');
      if (collapse instanceof HTMLButtonElement) collapse.click();
    })()
  `);
  await settle();
}

async function captureGlobalSearchLayerContract(win, report) {
  await win.webContents.executeJavaScript("window.cctools.__setVisualMode('normal')");
  win.webContents.setZoomFactor(1);
  win.setSize(1280, 800);
  await settle();
  await clickNav(win, "创作");
  await waitForReady(win, "创作", { minTextLength: 100, requiredSelector: ".creative-workspace-page" });
  await ensureDefaultCompanion(win);

  await win.webContents.executeJavaScript(`
    (() => {
      window.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'k',
        ctrlKey: true,
        bubbles: true,
        cancelable: true
      }));
    })()
  `);
  await waitForSelector(win, ".global-search-dialog");
  await settle();
  const compact = await inspectGlobalSearchLayer(win);

  // Keep search open while the companion crosses into canvas. The AI modal
  // scope registers after search here, reproducing the layering race.
  win.setSize(840, 800);
  await settle();
  const canvas = await inspectGlobalSearchLayer(win);
  const image = await win.webContents.capturePage();
  const file = path.join(outputRoot, "state-global-search-over-ai-canvas.png");
  fs.writeFileSync(file, image.toPNG());

  await win.webContents.executeJavaScript(`
    (() => {
      document.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'Escape',
        bubbles: true,
        cancelable: true
      }));
    })()
  `);
  await waitForSelectorToDisappear(win, ".global-search-scrim");
  await settle();
  const afterClose = await win.webContents.executeJavaScript(`
    (() => {
      const root = document.querySelector('#root');
      const sidebar = document.querySelector('.ai-sidebar');
      const stage = document.querySelector('.app-stage');
      const nav = document.querySelector('.app-nav');
      return {
        searchClosed: !document.querySelector('.global-search-scrim'),
        aiStillOpen: Boolean(sidebar),
        canvasStillModal: Boolean(
          sidebar?.classList.contains('layout-companion-canvas')
          && sidebar.getAttribute('role') === 'dialog'
          && sidebar.getAttribute('aria-modal') === 'true'
        ),
        focusInsideAi: Boolean(sidebar?.contains(document.activeElement)),
        aiBackgroundStillIsolated: Boolean(stage?.inert) && Boolean(nav?.inert),
        rootRestored: !root?.inert && root?.getAttribute('aria-hidden') !== 'true'
      };
    })()
  `);

  const checks = {
    compactPortalToBody: compact.portalToBody,
    compactFillsViewport: compact.fillsViewport,
    compactOwnsAiPoint: compact.searchOwnsAiPoint,
    compactOwnsFocus: compact.focusInsideSearch,
    compactBackgroundIsolated: compact.rootInert && compact.rootAriaHidden === "true",
    canvasMountedAfterSearch: canvas.sidebarClass.includes("layout-companion-canvas"),
    canvasPortalToBody: canvas.portalToBody,
    canvasFillsViewport: canvas.fillsViewport,
    canvasOwnsAiPoint: canvas.searchOwnsAiPoint,
    canvasOwnsFocus: canvas.focusInsideSearch,
    canvasBackgroundIsolated: canvas.rootInert && canvas.rootAriaHidden === "true",
    oneEscapeClosedSearch: afterClose.searchClosed,
    oneEscapeKeptAiOpen: afterClose.aiStillOpen && afterClose.canvasStillModal,
    aiIsolationRetained: afterClose.aiBackgroundStillIsolated,
    focusReturnedToAi: afterClose.focusInsideAi,
    rootIsolationRestored: afterClose.rootRestored
  };
  const ok = Object.values(checks).every(Boolean);
  const item = {
    id: "global-search-over-ai-responsive",
    label: "创作",
    description: "Global search stays above compact and late-mounted canvas AI companions",
    file: path.relative(appRoot, file),
    width: 840,
    height: 800,
    zoom: 1,
    ok,
    reason: ok
      ? null
      : "global search layer checks failed: " + Object.entries(checks).filter(([, passed]) => !passed).map(([name]) => name).join(", "),
    checks,
    details: { compact, canvas, afterClose }
  };
  report.stateSnapshots.push(item);
  if (!ok) report.failures.push(item);

  await win.webContents.executeJavaScript(`
    (() => {
      const collapse = document.querySelector('.ai-sidebar button[aria-label="收起"]');
      if (collapse instanceof HTMLButtonElement) collapse.click();
    })()
  `);
  await settle();
}

async function inspectGlobalSearchLayer(win) {
  return win.webContents.executeJavaScript(`
    (() => {
      const root = document.querySelector('#root');
      const scrim = document.querySelector('.global-search-scrim');
      const dialog = document.querySelector('.global-search-dialog');
      const sidebar = document.querySelector('.ai-sidebar');
      if (!(root instanceof HTMLElement)
        || !(scrim instanceof HTMLElement)
        || !(dialog instanceof HTMLElement)
        || !(sidebar instanceof HTMLElement)) {
        return {
          portalToBody: false,
          fillsViewport: false,
          searchOwnsAiPoint: false,
          focusInsideSearch: false,
          rootInert: false,
          rootAriaHidden: null,
          sidebarClass: ''
        };
      }
      const sidebarRect = sidebar.getBoundingClientRect();
      const x = Math.max(1, Math.min(window.innerWidth - 12, sidebarRect.right - 12));
      const y = Math.max(1, Math.min(window.innerHeight - 12, sidebarRect.bottom - 12));
      const stack = document.elementsFromPoint(x, y);
      const searchIndex = stack.findIndex((element) => element === scrim || scrim.contains(element));
      const aiIndex = stack.findIndex((element) => element === sidebar || sidebar.contains(element));
      const scrimRect = scrim.getBoundingClientRect();
      return {
        portalToBody: scrim.parentElement === document.body,
        fillsViewport: Math.abs(scrimRect.left) <= 1
          && Math.abs(scrimRect.top) <= 1
          && Math.abs(scrimRect.width - window.innerWidth) <= 1
          && Math.abs(scrimRect.height - window.innerHeight) <= 1,
        searchOwnsAiPoint: searchIndex === 0 && (aiIndex < 0 || searchIndex < aiIndex),
        focusInsideSearch: dialog.contains(document.activeElement),
        rootInert: Boolean(root.inert),
        rootAriaHidden: root.getAttribute('aria-hidden'),
        sidebarClass: sidebar.className,
        sidebarRole: sidebar.getAttribute('role'),
        point: { x, y },
        hitStack: stack.slice(0, 8).map((element) => element.tagName.toLowerCase()
          + (element.className ? '.' + String(element.className).trim().replace(/\\s+/g, '.') : '')),
        scrimZIndex: getComputedStyle(scrim).zIndex
      };
    })()
  `);
}

async function ensureExpandedNavigation(win) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const state = await win.webContents.executeJavaScript(`
      (() => {
        const shell = document.querySelector('.app-shell');
        const nav = document.querySelector('.app-nav');
        if (!shell?.classList.contains('layout-shell-expanded')) return 'waiting';
        if (!nav?.classList.contains('collapsed')) return 'ready';
        const expand = nav.querySelector('button[aria-label="展开导航"]');
        if (expand instanceof HTMLButtonElement) {
          expand.click();
          return 'expanding';
        }
        return 'missing-control';
      })()
    `);
    if (state === "ready") return;
    if (state === "missing-control") break;
    await settle();
  }
  throw new Error("Primary navigation could not reach the expanded 260px state for layout audit.");
}

async function ensureDefaultCompanion(win) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const state = await win.webContents.executeJavaScript(`
      (() => {
        const sidebar = document.querySelector('.ai-sidebar');
        if (!sidebar) {
          const expand = document.querySelector('.ai-rail, button[aria-label="展开 AI 侧栏"]');
          if (expand instanceof HTMLButtonElement) expand.click();
          return 'expanding';
        }
        if (sidebar.classList.contains('mode-full')) {
          const exit = sidebar.querySelector('button[aria-label="退出全屏"]');
          if (exit instanceof HTMLButtonElement) exit.click();
          return 'exiting-full';
        }
        if (sidebar.classList.contains('mode-wide')) {
          const wide = sidebar.querySelector('button[aria-label="切换宽屏"]');
          if (wide instanceof HTMLButtonElement) wide.click();
          return 'exiting-wide';
        }
        return sidebar.classList.contains('mode-default') ? 'ready' : 'waiting';
      })()
    `);
    if (state === "ready") return;
    await settle();
  }
  throw new Error("AI companion could not reach default mode for layout audit.");
}

async function resetCompanionWidth(win) {
  const reset = await win.webContents.executeJavaScript(`
    (() => {
      const splitter = document.querySelector('.ai-sidebar-resizer');
      if (!(splitter instanceof HTMLElement)) return false;
      splitter.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }));
      return true;
    })()
  `);
  if (!reset) throw new Error("Docked AI companion splitter was not available for reset.");
  await settle();
  const widths = await win.webContents.executeJavaScript(`
    (() => {
      const sidebar = document.querySelector('.ai-sidebar');
      const splitter = sidebar?.querySelector('.ai-sidebar-resizer');
      return {
        layout: Number(sidebar?.getAttribute('data-layout-width')),
        separator: Number(splitter?.getAttribute('aria-valuenow'))
      };
    })()
  `);
  if (widths.layout !== 420 || widths.separator !== 420) {
    throw new Error(`AI companion reset did not restore the 420px default width: ${JSON.stringify(widths)}.`);
  }
}

async function clickCompanionAction(win, label) {
  const clicked = await win.webContents.executeJavaScript(`
    (() => {
      const button = document.querySelector('.ai-sidebar button[aria-label=${JSON.stringify(label)}]');
      if (!(button instanceof HTMLButtonElement)) return false;
      button.click();
      return true;
    })()
  `);
  if (!clicked) throw new Error(`AI companion action was not found: ${label}`);
}

async function dragCompanionResizer(win, deltaX) {
  win.focus();
  await delay(60);
  const point = await win.webContents.executeJavaScript(`
    (() => {
      const splitter = document.querySelector('.ai-sidebar-resizer');
      if (!(splitter instanceof Element)) return null;
      const rect = splitter.getBoundingClientRect();
      return { x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2) };
    })()
  `);
  if (!point) throw new Error("Docked AI companion splitter was not available for pointer resize.");
  win.webContents.sendInputEvent({ type: "mouseMove", x: point.x, y: point.y });
  await delay(30);
  win.webContents.sendInputEvent({ type: "mouseDown", x: point.x, y: point.y, button: "left", clickCount: 1 });
  await delay(30);
  win.webContents.sendInputEvent({ type: "mouseMove", x: point.x + deltaX, y: point.y, movementX: deltaX, movementY: 0 });
  await delay(30);
  win.webContents.sendInputEvent({ type: "mouseUp", x: point.x + deltaX, y: point.y, button: "left", clickCount: 1 });
  await settle();
}

async function inspectCompanionGeometry(win) {
  return win.webContents.executeJavaScript(`
    (() => {
      const root = document.documentElement;
      const body = document.body;
      const shell = document.querySelector('.app-shell');
      const nav = document.querySelector('.app-nav');
      const stage = document.querySelector('.app-stage');
      const sidebar = document.querySelector('.ai-sidebar');
      const splitter = sidebar?.querySelector('.ai-sidebar-resizer');
      const numberAttribute = (element, name) => {
        const value = Number(element?.getAttribute(name));
        return Number.isFinite(value) ? value : null;
      };
      const rect = (element) => {
        if (!(element instanceof Element)) return null;
        const value = element.getBoundingClientRect();
        return Object.fromEntries(['left', 'top', 'right', 'bottom', 'width', 'height'].map((key) => [key, Math.round(value[key] * 10) / 10]));
      };
      const visible = (element) => {
        if (!(element instanceof Element)) return false;
        const style = getComputedStyle(element);
        const value = element.getBoundingClientRect();
        return style.display !== 'none' && style.visibility !== 'hidden' && value.width > 0 && value.height > 0;
      };
      const marginBoxWidth = (element) => {
        if (!(element instanceof Element)) return 0;
        const value = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return Math.round((
          value.width
          + (Number.parseFloat(style.marginLeft) || 0)
          + (Number.parseFloat(style.marginRight) || 0)
        ) * 10) / 10;
      };
      return {
        viewport: {
          width: window.innerWidth,
          height: window.innerHeight,
          visualWidth: window.visualViewport?.width || null,
          devicePixelRatio: window.devicePixelRatio
        },
        shellClass: shell?.className || '',
        sidebarClass: sidebar?.className || '',
        nav: rect(nav),
        stage: rect(stage),
        stageTrackWidth: marginBoxWidth(stage),
        sidebar: rect(sidebar),
        workspaceInset: Number.parseFloat(getComputedStyle(root).getPropertyValue('--workspace-inset')) || 0,
        layoutWidth: numberAttribute(sidebar, 'data-layout-width'),
        separatorValue: numberAttribute(splitter, 'aria-valuenow'),
        splitterVisible: visible(splitter),
        sidebarPosition: sidebar instanceof Element ? getComputedStyle(sidebar).position : null,
        role: sidebar?.getAttribute('role') || null,
        ariaModal: sidebar?.getAttribute('aria-modal') || null,
        stageInert: Boolean(stage?.inert),
        navInert: Boolean(nav?.inert),
        wideControlVisible: visible(sidebar?.querySelector('button[aria-label="切换宽屏"]')),
        fullscreenControlVisible: visible(sidebar?.querySelector('button[aria-label="全屏"]')),
        exitFullscreenControlVisible: visible(sidebar?.querySelector('button[aria-label="退出全屏"]')),
        horizontalOverflow: Math.max(root.scrollWidth - root.clientWidth, body.scrollWidth - body.clientWidth)
      };
    })()
  `);
}

async function captureCompanionGeometryState(win, report, id, expected, description, additionalChecks = {}) {
  await settle();
  const geometry = await inspectCompanionGeometry(win);
  const fillsViewport = geometry.sidebar
    && Math.abs(geometry.sidebar.left) <= 1
    && Math.abs(geometry.sidebar.top) <= 1
    && Math.abs(geometry.sidebar.right - geometry.viewport.width) <= 2
    && Math.abs(geometry.sidebar.bottom - geometry.viewport.height) <= 2;
  const checks = expected === "docked" ? {
    sidebarPresent: Boolean(geometry.sidebar),
    attachedPresentation: !geometry.shellClass.includes("layout-companion-canvas")
      && !geometry.sidebarClass.includes("layout-companion-canvas"),
    splitterVisible: geometry.splitterVisible,
    workspaceVisible: geometry.stageTrackWidth >= 399.5,
    panesDoNotOverlap: Boolean(
      geometry.stage
      && geometry.sidebar
      && geometry.stage.right <= geometry.sidebar.left + 2
    ),
    sidebarInFlow: geometry.sidebarPosition !== "fixed",
    sidebarAtRightEdge: Boolean(
      geometry.sidebar
      && Math.abs(geometry.sidebar.right - (geometry.viewport.width - geometry.workspaceInset)) <= 2
    ),
    backgroundInteractive: !geometry.stageInert && !geometry.navInert,
    notModal: geometry.role !== "dialog" && geometry.ariaModal !== "true",
    widthControlsVisible: geometry.wideControlVisible && geometry.fullscreenControlVisible,
    noHorizontalOverflow: geometry.horizontalOverflow <= 2,
    ...Object.fromEntries(Object.entries(additionalChecks).filter(([, value]) => typeof value === "boolean"))
  } : expected === "canvas" ? {
    fillsViewport: Boolean(fillsViewport),
    modalSemantics: geometry.role === "dialog" && geometry.ariaModal === "true",
    backgroundIsolated: geometry.stageInert && geometry.navInert,
    splitterHidden: !geometry.splitterVisible,
    noNoopWidthControls: !geometry.wideControlVisible && !geometry.fullscreenControlVisible,
    noHorizontalOverflow: geometry.horizontalOverflow <= 2,
    ...Object.fromEntries(Object.entries(additionalChecks).filter(([, value]) => typeof value === "boolean"))
  } : {
    fillsViewport: Boolean(fillsViewport),
    modalSemantics: geometry.role === "dialog" && geometry.ariaModal === "true",
    backgroundIsolated: geometry.stageInert && geometry.navInert,
    splitterHidden: !geometry.splitterVisible,
    exitControlVisible: geometry.exitFullscreenControlVisible,
    noHorizontalOverflow: geometry.horizontalOverflow <= 2,
    ...Object.fromEntries(Object.entries(additionalChecks).filter(([, value]) => typeof value === "boolean"))
  };
  const ok = Object.values(checks).every(Boolean);
  const image = await win.webContents.capturePage();
  const file = path.join(outputRoot, `state-${id}.png`);
  fs.writeFileSync(file, image.toPNG());
  const item = {
    id,
    label: "创作",
    description,
    file: path.relative(appRoot, file),
    width: geometry.viewport.width,
    height: geometry.viewport.height,
    zoom: win.webContents.getZoomFactor(),
    ok,
    reason: ok ? null : `companion checks failed: ${Object.entries(checks).filter(([, passed]) => !passed).map(([name]) => name).join(', ')}`,
    checks,
    geometry,
    details: Object.fromEntries(Object.entries(additionalChecks).filter(([, value]) => typeof value !== "boolean"))
  };
  report.stateSnapshots.push(item);
  if (!ok) report.failures.push(item);
  return item;
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

async function exitSettings(win) {
  const clicked = await win.webContents.executeJavaScript(`
    (() => {
      if (!document.querySelector('.settings-page')) return false;
      const button = document.querySelector('.settings-back-button');
      if (!(button instanceof HTMLButtonElement)) return false;
      button.click();
      return true;
    })()
  `);
  if (!clicked) throw new Error("Settings return button was not found.");
}

async function waitForReady(win, label, options = {}) {
  const minTextLength = options.minTextLength ?? 200;
  const requiredSelector = options.requiredSelector || "body";
  const expectedSettingsMode = options.settingsMode === true;
  let lastState = null;
  for (let attempt = 0; attempt < 100; attempt++) {
    const state = await win.webContents.executeJavaScript(`
      (() => {
        const visible = (element) => {
          if (!(element instanceof Element)) return false;
          const style = getComputedStyle(element);
          const rect = element.getBoundingClientRect();
          return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
        };
        const active = document.querySelector('nav button[aria-current="page"]')?.getAttribute('aria-label') || "";
        const activeSession = Boolean(document.querySelector('.nav-recent-item[aria-current="true"]'));
        const aiPage = Boolean(document.querySelector('.app-shell.ai-page'));
        const loading = Boolean(document.querySelector('.splash,.route-loading,.settings-page .settings-load-state[role="status"]'));
        const fatal = document.querySelector('.fatal')?.textContent || "";
        const textLength = (document.body?.innerText || "").trim().length;
        const semanticReady = Boolean(document.querySelector(${JSON.stringify(requiredSelector)}));
        const settingsMode = Boolean(document.querySelector('.settings-page'));
        const settingsNavigation = document.querySelector('.settings-navigation');
        const settingsActive = document.querySelector('.settings-nav-button[aria-current="page"]');
        const settingsHeading = document.querySelector('.settings-detail-header h1');
        const settingsDetail = document.querySelector('.settings-detail');
        const settingsNavigationVisible = visible(settingsNavigation);
        const settingsActiveVisible = visible(settingsActive)
          && settingsActive.textContent?.trim() === settingsHeading?.textContent?.trim();
        const settingsDetailAtStart = settingsDetail instanceof HTMLElement && settingsDetail.scrollTop <= 2;
        const settingsSelectFocused = document.activeElement instanceof Element
          && document.activeElement.matches('.ui-select-trigger');
        const settingsChromeIsolated = !document.querySelector('.app-nav') && !document.querySelector('.global-toolbar');
        return {
          active,
          activeSession,
          aiPage,
          loading,
          fatal,
          textLength,
          semanticReady,
          settingsMode,
          settingsNavigationVisible,
          settingsActiveVisible,
          settingsDetailAtStart,
          settingsSelectFocused,
          settingsChromeIsolated
        };
      })()
    `);
    lastState = state;
    if (state.fatal) throw new Error(state.fatal);
    const routeReady = expectedSettingsMode
      ? state.settingsMode
        && state.settingsNavigationVisible
        && state.settingsActiveVisible
        && state.settingsDetailAtStart
        && !state.settingsSelectFocused
        && state.settingsChromeIsolated
      : !state.settingsMode
        && (state.active === label || (options.allowActiveSession && (state.activeSession || state.aiPage)));
    if (routeReady && !state.loading && state.semanticReady && state.textLength >= minTextLength) return;
    await delay(80);
  }
  throw new Error(`Timed out waiting for page: ${label}; last state=${JSON.stringify(lastState)}`);
}

async function inspectPage(win, label, options = {}) {
  const minTextLength = options.minTextLength ?? 200;
  const requiredSelector = options.requiredSelector || "body";
  const expectError = options.expectError === true;
  const expectedSettingsMode = options.settingsMode === true;
  return win.webContents.executeJavaScript(`
    (() => {
      const root = document.documentElement;
      const body = document.body;
      const text = (body.innerText || "").replace(/\\s+/g, " ").trim();
      const horizontalOverflow = Math.max(root.scrollWidth - root.clientWidth, body.scrollWidth - body.clientWidth);
      const visible = (element) => {
        if (!(element instanceof Element)) return false;
        const style = getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
      };
      const settingsMode = Boolean(document.querySelector('.settings-page'));
      const settingsNavigation = document.querySelector('.settings-navigation');
      const settingsActive = document.querySelector('.settings-nav-button[aria-current="page"]');
      const settingsHeading = document.querySelector('.settings-detail-header h1');
      const settingsDetail = document.querySelector('.settings-detail');
      const settingsNavigationVisible = visible(settingsNavigation);
      const settingsActiveVisible = visible(settingsActive)
        && settingsActive.textContent?.trim() === settingsHeading?.textContent?.trim();
      const settingsDetailAtStart = !${expectedSettingsMode}
        || (settingsDetail instanceof HTMLElement && settingsDetail.scrollTop <= 2);
      const settingsSelectFocused = document.activeElement instanceof Element
        && document.activeElement.matches('.ui-select-trigger');
      const settingsChromeIsolated = !${expectedSettingsMode}
        || (!document.querySelector('.app-nav') && !document.querySelector('.global-toolbar'));
      const settingsModeMatches = settingsMode === ${expectedSettingsMode};
      const navVisible = ${expectedSettingsMode}
        ? settingsNavigationVisible
        : Boolean([...document.querySelectorAll('nav button')].find((item) => item.getAttribute('aria-label') === ${JSON.stringify(label)}));
      const activeVisible = ${expectedSettingsMode}
        ? settingsActiveVisible
        : document.querySelector('nav button[aria-current="page"]')?.getAttribute('aria-label') === ${JSON.stringify(label)}
          || (${JSON.stringify(label)} === "新建任务" && Boolean(document.querySelector('.app-shell.ai-page')));
      const semanticReady = Boolean(document.querySelector(${JSON.stringify(requiredSelector)}));
      const shell = document.querySelector('.app-shell');
      const shellState = settingsMode ? 'settings'
        : shell?.classList.contains('layout-shell-drawer') ? 'drawer'
          : shell?.classList.contains('layout-shell-rail') ? 'rail'
            : shell?.classList.contains('layout-shell-expanded') ? 'expanded' : 'unknown';
      const undersizedResponsiveTargets = root.clientWidth <= 720
        ? [...document.querySelectorAll('.ui-responsive-action, .ui-responsive-overflow-trigger, .responsive-nav-toggle, .settings-back-button, .settings-nav-button')]
          .filter(visible)
          .map((element) => ({ element, rect: element.getBoundingClientRect() }))
          .filter(({ rect }) => rect.width < 44 || rect.height < 44)
          .map(({ element, rect }) => ({
            label: element.getAttribute('aria-label') || element.textContent?.trim() || element.className,
            width: Math.round(rect.width),
            height: Math.round(rect.height)
          }))
        : [];
      const drawerToggleVisible = ${expectedSettingsMode}
        ? settingsChromeIsolated
        : root.clientWidth > 840 || visible(document.querySelector('.responsive-nav-toggle'));
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
        && settingsModeMatches
        && navVisible
        && activeVisible
        && settingsDetailAtStart
        && (!${expectedSettingsMode} || !settingsSelectFocused)
        && settingsChromeIsolated
        && drawerToggleVisible
        && errorStateMatches
        && criticalContextMissing.length === 0
        && !conversationTitleOccluded
        && undersizedResponsiveTargets.length === 0
        && horizontalOverflow <= 2;
      return {
        ok,
        reason: ok ? null : \`text=\${text.length}, semantic=\${semanticReady}, settingsMode=\${settingsMode}/expected:${expectedSettingsMode}, settingsNav=\${settingsNavigationVisible}, settingsActive=\${settingsActiveVisible}, settingsScrollTop=\${settingsDetail instanceof HTMLElement ? settingsDetail.scrollTop : 'missing'}, settingsSelectFocused=\${settingsSelectFocused}, settingsChromeIsolated=\${settingsChromeIsolated}, nav=\${navVisible}, active=\${activeVisible}, drawerToggle=\${drawerToggleVisible}, error=\${unexpectedError || 'none'}, errorExpected=${expectError}, context=\${criticalContextMissing.join(',') || 'complete'}, titleOccluded=\${conversationTitleOccluded}, targets=\${undersizedResponsiveTargets.length}, overflow=\${horizontalOverflow}\`,
        textLength: text.length,
        semanticReady,
        shellState,
        settingsMode,
        settingsNavigationVisible,
        settingsActiveVisible,
        settingsDetailScrollTop: settingsDetail instanceof HTMLElement ? settingsDetail.scrollTop : null,
        settingsSelectFocused,
        settingsChromeIsolated,
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

  await win.webContents.executeJavaScript(`
    (() => {
      const buttons = [...document.querySelectorAll('.toast-stack .toast > button:last-child')];
      buttons.forEach((button) => button.click());
      return buttons.length;
    })()
  `);
  await waitForSelectorToDisappear(win, ".toast-stack .toast");

  const selectedContext = await win.webContents.executeJavaScript(`
    (() => {
      const button = document.querySelector('.composer-add-context');
      if (!(button instanceof HTMLButtonElement)) return false;
      button.click();
      return true;
    })()
  `);
  if (!selectedContext) throw new Error("Composer add-context button was not reachable.");
  await waitForSelector(win, ".context-tray .context-chip > .ui-disclosure-trigger");
  await settle();
  await assertComposerContextGeometry(win);
  await captureState(win, report, "ai-composer-file-context", pages[0].label, "Selected long file remains compact and readable in the composer", {
    requiredSelector: ".context-tray"
  });
  const clearedContext = await win.webContents.executeJavaScript(`
    (() => {
      const button = document.querySelector('.context-tray-clear');
      if (!(button instanceof HTMLButtonElement)) return false;
      button.click();
      return true;
    })()
  `);
  if (!clearedContext) throw new Error("Composer clear-context button was not reachable.");
  await waitForSelectorToDisappear(win, ".context-tray");

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

async function assertComposerContextGeometry(win) {
  const geometry = await win.webContents.executeJavaScript(`
    (() => {
      const flow = document.querySelector('.composer-flow');
      const tray = document.querySelector('.context-tray');
      const count = tray?.querySelector(':scope > .context-tray-count');
      const chips = tray?.querySelector(':scope > .context-chips');
      const drag = chips?.querySelector(':scope > .context-chip-drag');
      const chip = drag?.querySelector(':scope > .context-chip');
      const trigger = chip?.querySelector(':scope > .ui-disclosure-trigger');
      const label = trigger?.querySelector(':scope > span');
      const clear = tray?.querySelector(':scope > .context-tray-clear');
      const editor = flow?.querySelector(':scope > .composer-editor');
      const elements = { flow, tray, count, chips, drag, chip, trigger, label, clear, editor };
      const allPresent = Object.values(elements).every((element) => element instanceof Element);
      if (!allPresent) return { ok: false, checks: { allPresent }, elements: Object.keys(elements).filter((key) => !(elements[key] instanceof Element)) };

      const rect = (element) => {
        const value = element.getBoundingClientRect();
        return Object.fromEntries(['left', 'top', 'right', 'bottom', 'width', 'height'].map((key) => [key, Math.round(value[key] * 10) / 10]));
      };
      const style = (element) => getComputedStyle(element);
      const visible = (element) => {
        const css = style(element);
        const box = rect(element);
        return css.display !== 'none' && css.visibility !== 'hidden' && Number(css.opacity || 1) > 0 && box.width > 0 && box.height > 0;
      };
      const inside = (inner, outer, tolerance = 1) => inner.left >= outer.left - tolerance
        && inner.top >= outer.top - tolerance && inner.right <= outer.right + tolerance && inner.bottom <= outer.bottom + tolerance;
      const overlap = (a, b, tolerance = 1) => Math.min(a.right, b.right) - Math.max(a.left, b.left) > tolerance
        && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > tolerance;
      const bordered = (element) => {
        const css = style(element);
        return ['Top', 'Right', 'Bottom', 'Left'].some((side) =>
          css['border' + side + 'Style'] !== 'none' && parseFloat(css['border' + side + 'Width']) > 0);
      };
      const overflow = (element) => Math.max(0, element.scrollWidth - element.clientWidth);
      const boxes = Object.fromEntries(Object.entries(elements).map(([key, element]) => [key, rect(element)]));
      const css = {
        count: style(count),
        chips: style(chips),
        label: style(label)
      };
      const directChildren = [...tray.children];
      const centers = [boxes.count, boxes.trigger, boxes.clear].map((box) => (box.top + box.bottom) / 2);
      const borderLayers = [tray, chip, trigger].filter(bordered).length;
      const hitDetails = (element) => {
        const box = rect(element);
        const target = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
        return {
          passed: Boolean(target && (target === element || element.contains(target))),
          target: target ? {
            tag: target.tagName,
            className: String(target.className || ''),
            ariaLabel: target.getAttribute('aria-label'),
            outerHTML: target.outerHTML.slice(0, 220),
            ancestry: [target, target.parentElement, target.parentElement?.parentElement, target.parentElement?.parentElement?.parentElement]
              .filter(Boolean)
              .map((node) => node.tagName + (node.id ? '#' + node.id : '') + (node.className ? '.' + String(node.className).trim().replace(/\\s+/g, '.') : ''))
          } : null
        };
      };
      const triggerHit = hitDetails(trigger);
      const clearHit = hitDetails(clear);
      const checks = {
        allPresent,
        allVisible: [tray, count, chips, chip, trigger, label, clear, editor].every(visible),
        domOrder: directChildren[0] === count && directChildren[1] === chips && directChildren[2] === clear,
        visualOrder: boxes.count.right <= boxes.trigger.left + 1 && boxes.trigger.right <= boxes.clear.left + 1,
        controlsDoNotOverlap: !overlap(boxes.count, boxes.trigger) && !overlap(boxes.trigger, boxes.clear),
        childrenInsideTray: [boxes.count, boxes.chips, boxes.trigger, boxes.clear].every((box) => inside(box, boxes.tray)),
        compactSingleRow: boxes.tray.height >= 30 && boxes.tray.height <= 44 && Math.max(...centers) - Math.min(...centers) <= 3,
        chipsNoWrap: css.chips.flexWrap === 'nowrap',
        countNoWrap: css.count.whiteSpace === 'nowrap',
        maskRemoved: (!css.chips.maskImage || css.chips.maskImage === 'none')
          && (!css.chips.webkitMaskImage || css.chips.webkitMaskImage === 'none'),
        noNestedDoubleFrame: borderLayers <= 1 && !bordered(trigger),
        noPageOverflow: document.documentElement.scrollWidth - window.innerWidth <= 2,
        noFlowOverflow: overflow(flow) <= 2,
        noTrayOverflow: overflow(tray) <= 2,
        noChipsOverflow: overflow(chips) <= 2,
        chipBounded: boxes.chip.width <= 260.5 && boxes.chip.width <= boxes.chips.width + 1,
        longLabelEllipsized: css.label.whiteSpace === 'nowrap'
          && ['hidden', 'clip'].includes(css.label.overflowX)
          && css.label.textOverflow === 'ellipsis'
          && label.scrollWidth > label.clientWidth + 1,
        fullPathPreserved: label.title.includes('very-long-title-with-English')
          && trigger.getAttribute('aria-label') === label.title,
        controlsHitTestable: triggerHit.passed && clearHit.passed,
        editorBelowTray: boxes.tray.bottom <= boxes.editor.top + 1
      };
      return {
        ok: Object.values(checks).every(Boolean),
        checks,
        boxes,
        hitTargets: { trigger: triggerHit, clear: clearHit },
        overflow: {
          page: document.documentElement.scrollWidth - window.innerWidth,
          flow: overflow(flow),
          tray: overflow(tray),
          chips: overflow(chips),
          label: overflow(label)
        },
        style: {
          trayHeight: boxes.tray.height,
          flexWrap: css.chips.flexWrap,
          maskImage: css.chips.maskImage,
          webkitMaskImage: css.chips.webkitMaskImage,
          borderLayers,
          labelWhiteSpace: css.label.whiteSpace,
          labelOverflowX: css.label.overflowX,
          labelTextOverflow: css.label.textOverflow
        }
      };
    })()
  `);
  if (!geometry.ok) {
    const failed = Object.entries(geometry.checks || {}).filter(([, passed]) => !passed).map(([name]) => name);
    throw new Error("Composer context geometry failed (" + failed.join(", ") + "): " + JSON.stringify(geometry));
  }
  return geometry;
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
  await waitForDisclosureState(win, ".completed-process .command-group", true);
  const expandedToolCount = await win.webContents.executeJavaScript(
    "document.querySelectorAll('.completed-process .tool-event[data-open]').length"
  );
  if (expandedToolCount !== 0) {
    throw new Error(`Completed process opened with ${expandedToolCount} expanded tool rows.`);
  }
  const expandedGroupCount = await win.webContents.executeJavaScript(
    "document.querySelectorAll('.completed-process .command-group[data-open]').length"
  );
  if (expandedGroupCount !== 2) {
    throw new Error(`Completed process expected 2 expanded tool groups, found ${expandedGroupCount}.`);
  }
  await settle();
  const compactToolGeometry = await win.webContents.executeJavaScript(`
    (() => {
      const group = document.querySelector('.completed-process .command-group.tools');
      const list = group?.querySelector('.command-group-list');
      const rows = list ? [...list.querySelectorAll('.tool-event')] : [];
      if (!group || !list) return { ok: false, checks: { groupFound: false } };
      const rowHeights = rows.map((row) => row.querySelector(':scope > .ui-disclosure-trigger')?.getBoundingClientRect().height || 0);
      const checks = {
        groupFound: true,
        groupedTools: rows.length === 10 && group.classList.contains('tools'),
        compactRows: rowHeights.every((height) => height >= 30 && height <= 40),
        boundedScroll: getComputedStyle(list).maxHeight === '304px' && list.scrollHeight > list.clientHeight,
        scrollSemantics: list.getAttribute('role') === 'region' && list.tabIndex === 0,
        rowIcons: rows.every((row) => {
          const icon = row.querySelector('.tool-event-icon');
          return icon && getComputedStyle(icon).display !== 'none';
        }),
        noHorizontalOverflow: list.scrollWidth <= list.clientWidth + 1
      };
      return {
        ok: Object.values(checks).every(Boolean),
        checks,
        rowHeights,
        clientHeight: list.clientHeight,
        scrollHeight: list.scrollHeight,
        maxHeight: getComputedStyle(list).maxHeight
      };
    })()
  `);
  if (!compactToolGeometry.ok) {
    throw new Error(`Compact tool group geometry failed: ${JSON.stringify(compactToolGeometry)}`);
  }
  const commandGroupSnapshot = await captureState(win, report, "ai-command-group", "新建任务", "Expanded process with compact grouped tool history");

  await waitForDisclosureState(win, ".completed-process .command-group .tool-event", false, 1);
  await expandDisclosure(win, ".completed-process .command-group .tool-event", 1);
  const terminalSelector = ".completed-process .command-group .tool-event[data-open] .command-terminal";
  await scrollSelectorIntoView(win, terminalSelector);
  await waitForSelector(win, terminalSelector);
  const expandedToolGeometry = await win.webContents.executeJavaScript(`
    (() => {
      const list = document.querySelector('.completed-process .command-group.tools .command-group-list');
      const opened = list?.querySelector('.tool-event[data-open]');
      if (!list || !opened) return { ok: false };
      const style = getComputedStyle(list);
      return {
        ok: style.maxHeight === '304px'
          && style.overflowY === 'auto'
          && list.getBoundingClientRect().height <= 305
          && list.scrollHeight > list.clientHeight,
        maxHeight: style.maxHeight,
        overflowY: style.overflowY,
        height: list.getBoundingClientRect().height,
        clientHeight: list.clientHeight,
        scrollHeight: list.scrollHeight
      };
    })()
  `);
  if (!expandedToolGeometry.ok) throw new Error(`Expanded tool group escaped its scroll viewport: ${JSON.stringify(expandedToolGeometry)}`);
  const expandedCommandSnapshot = await captureState(win, report, "ai-command-group-expanded", "新建任务", "A single tool expanded in place while preserving group context");

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
