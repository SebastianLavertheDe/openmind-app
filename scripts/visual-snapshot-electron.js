const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const { app, BrowserWindow } = require("electron");

const appRoot = path.resolve(__dirname, "..");
const tailOnly = process.env.OPENMIND_VISUAL_TAIL_ONLY === "1";
const outputRoot = path.join(appRoot, ".build", tailOnly ? "visual-snapshots-tail" : "visual-snapshots");
const reportPath = path.join(appRoot, ".build", tailOnly ? "visual-snapshot-tail-report.json" : "visual-snapshot-report.json");
let activeReport;
const rendererIndex = path.join(appRoot, ".build", "renderer", "index.html");
const preload = path.join(__dirname, "visual-snapshot-preload.js");
// Visual fixtures must never share Chromium storage with the developer's app.
// Pin both paths before ready, regardless of OPENMIND_USER_DATA_DIR in the shell.
const userData = fs.mkdtempSync(path.join(os.tmpdir(), "openmind-visual-snapshot-"));
app.setPath("userData", userData);
app.setPath("sessionData", userData);

function cleanupUserData() {
  fs.rmSync(userData, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
}
app.once("will-quit", cleanupUserData);
process.once("exit", cleanupUserData);

const viewports = [
  { id: "720x600", width: 720, height: 600, zoom: 1 },
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
  { id: "brief", label: "每日简报", requiredSelector: ".document-library-page", expectedCompanionSelector: ".ai-sidebar" },
  // Compact master/detail shows one meaningful pane at a time, so semantic
  // readiness is stronger here than an arbitrary desktop-sized text budget.
  { id: "creative", label: "创作", minTextLength: 100, requiredSelector: ".creative-workspace-page", expectedCompanionSelector: ".ai-sidebar" },
  { id: "automation", label: "自动化", requiredSelector: ".automation-page", expectedCompanionSelector: ".ai-sidebar" },
  { id: "settings", label: "设置", minTextLength: 60, requiredSelector: ".settings-page", settingsMode: true }
];

app.commandLine.appendSwitch("disable-gpu");
app.commandLine.appendSwitch("no-sandbox");

app.whenReady().then(run).catch((error) => {
  console.error(error);
  if (activeReport) {
    activeReport.failures.push({ id: "visual-runner", reason: error.stack || String(error) });
    fs.writeFileSync(reportPath, `${JSON.stringify(activeReport, null, 2)}\n`, "utf8");
  }
  for (const window of BrowserWindow.getAllWindows()) window.destroy();
  cleanupUserData();
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
  activeReport = report;

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

  if (process.env.OPENMIND_VISUAL_RESPONSIVE_ONLY === "1") {
    await captureResponsiveGapContracts(win, report);
    win.destroy();
    fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    if (report.failures.length) {
      throw new Error(`Responsive visual audit failed:\n${report.failures.map((item) => `- ${item.id}: ${item.reason}`).join("\n")}`);
    }
    console.log(`Responsive visual snapshots passed: ${report.stateSnapshots.length} state screenshots.`);
    app.quit();
    return;
  }

  if (tailOnly) {
    await captureFinalStates(win, report);
    win.destroy();
    finishReport(report);
    app.quit();
    return;
  }

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
        expectedCompanionSelector: page.expectedCompanionSelector,
        settingsMode: page.settingsMode
      });
      await settle();
      const audit = await inspectPage(win, page.label, {
        minTextLength: page.minTextLength,
        requiredSelector: page.requiredSelector,
        expectedCompanionSelector: page.expectedCompanionSelector,
        settingsMode: page.settingsMode
      });
      if (page.id === "brief" && !audit.briefMasterDetailGeometry?.sideBySide) {
        throw new Error(`Daily brief file list must remain beside the document: ${JSON.stringify(audit.briefMasterDetailGeometry)}`);
      }
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
      if (audit.expectedCompanionReady && !audit.semanticTargetReady) {
        await captureControlledPageSnapshot(win, report, viewport, page);
      }
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
  await captureResponsiveGapContracts(win, report);

  await captureFinalStates(win, report);
  win.destroy();
  finishReport(report);
  app.quit();
}

async function captureFinalStates(win, report) {
  win.setSize(1366, 768);
  win.webContents.setZoomFactor(1);
  await captureDarkDailyBrief(win, report);
  await captureCompletedAiResponse(win, report);
  await captureComposerSuggestions(win, report);
  await captureOnboardingMinimumGate(report);
}

function finishReport(report) {
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  if (report.failures.length) {
    throw new Error(`Visual snapshot audit failed:\n${report.failures.map((item) => `- ${item.viewport || "state"}/${item.page || item.id}: ${item.reason}`).join("\n")}`);
  }
  console.log(`Visual snapshots passed: ${report.snapshots.length} page screenshots, ${report.stateSnapshots.length} state screenshots; report ${path.relative(appRoot, reportPath)}.`);
}

async function captureOnboardingMinimumGate(report) {
  const win = new BrowserWindow({
    width: 720,
    height: 600,
    show: true,
    backgroundColor: "#f6f7f9",
    webPreferences: {
      preload,
      additionalArguments: ["--openmind-visual-onboarding"],
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      backgroundThrottling: false
    }
  });
  try {
    win.webContents.setZoomFactor(1);
    await win.loadFile(rendererIndex);
    await waitForSelector(win, ".onboarding-page");
    await settle();
    const geometry = await win.webContents.executeJavaScript(`
      (() => {
        const page = document.querySelector('.onboarding-page');
        const track = document.querySelector('.onboarding-step-track');
        const action = [...document.querySelectorAll('.onboarding-page button')].find((button) => button.textContent.includes('选择文件夹'));
        const pageBox = page?.getBoundingClientRect();
        const actionBox = action?.getBoundingClientRect();
        if (action instanceof Element) action.scrollIntoView({ block: 'center' });
        const reachedBox = action?.getBoundingClientRect();
        return {
          viewport: { width: window.innerWidth, height: window.innerHeight },
          pageVisible: Boolean(pageBox && pageBox.width > 0 && pageBox.height > 0),
          currentStep: track?.getAttribute('data-current-step'),
          actionVisible: Boolean(actionBox && actionBox.width > 0 && actionBox.height > 0),
          actionReachable: Boolean(reachedBox && reachedBox.bottom > 0 && reachedBox.top < window.innerHeight),
          horizontalOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth
        };
      })()
    `);
    await recordContractState(win, report, "onboarding-720x600", "引导", "Onboarding remains visible and its primary setup action stays reachable at the minimum window", geometry, {
      pageVisible: geometry.pageVisible,
      firstStep: geometry.currentStep === "1",
      primaryActionVisible: geometry.actionVisible,
      primaryActionReachable: geometry.actionReachable,
      noHorizontalOverflow: geometry.horizontalOverflow <= 2
    });
  } finally {
    win.destroy();
  }
}

async function captureCreativeReaderLayout(win, report) {
  const creativePage = pages.find((page) => page.id === "creative");
  if (!creativePage) throw new Error("Creative page config is missing.");

  await win.webContents.executeJavaScript("window.openmind.__setVisualMode('normal')");
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
      const prose = preview?.querySelector('.document-block > :is(h1, h2, h3, h4, h5, h6, p, ul, ol, blockquote, hr)');
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
  await win.webContents.executeJavaScript("window.openmind.__setVisualMode('normal')");
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
      defaultCompanionPreference: Boolean(
        expandedGeometry.layoutWidth
        && expandedGeometry.layoutWidth === expandedGeometry.separatorValue
        && expandedGeometry.layoutRatio !== null
        && Math.abs(expandedGeometry.layoutRatio - 1 / 3) < .001
      )
    }
  );

  // Exercise the current pointer resize interaction at an ultrawide viewport.
  win.setSize(2560, 1440);
  await settle();
  await ensureDefaultCompanion(win);
  await resetCompanionWidth(win);
  await dragCompanionResizer(win, -500);
  const ultraWideGeometry = await inspectCompanionGeometry(win);
  await captureCompanionGeometryState(
    win,
    report,
    "companion-wide-2560",
    "docked",
    "Wide AI companion grows past the former fullscreen pixel ceiling without shrinking the workspace below its contract",
    {
      expandedShell: ultraWideGeometry.shellClass.includes("layout-shell-expanded"),
      resizedPreferencePreserved: ultraWideGeometry.layoutRatio !== null && ultraWideGeometry.layoutRatio > 1 / 3,
      exceedsLegacyPixelCeiling: Boolean(ultraWideGeometry.separatorValue && ultraWideGeometry.separatorValue > 960),
      workspacePreserved: ultraWideGeometry.stageTrackWidth >= 759.5
    }
  );
  await ensureDefaultCompanion(win);
  await resetCompanionWidth(win);

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
    "overlay",
    "Overlay AI companion expands to its available bound without shrinking the workspace below its contract",
    {
      widthExpanded: Boolean(afterResize.sidebar && beforeResize.sidebar && afterResize.sidebar.width > beforeResize.sidebar.width),
      workspacePreserved: afterResize.stageTrackWidth >= 759.5,
      beforeResize,
      afterResize
    }
  );
  await resetCompanionWidth(win);

  win.setSize(2048, 1100);
  win.webContents.setZoomFactor(1.5);
  await settle();
  await ensureDefaultCompanion(win);
  await resetCompanionWidth(win);
  const beforeHighDpiResize = await inspectCompanionGeometry(win);
  await dragCompanionResizer(win, -80);
  await settle();
  const highDpiWideGeometry = await inspectCompanionGeometry(win);
  await captureCompanionGeometryState(
    win,
    report,
    "companion-wide-2048-zoom150",
    "overlay",
    "A visually large 150% window keeps the workspace beside a proportional wide AI overlay",
    {
      overlayPresentation: highDpiWideGeometry.sidebarClass.includes("layout-companion-overlay"),
      effectiveViewportAboveCanvas: highDpiWideGeometry.viewport.width > 840,
      widthExpanded: Boolean(highDpiWideGeometry.sidebar && beforeHighDpiResize.sidebar && highDpiWideGeometry.sidebar.width > beforeHighDpiResize.sidebar.width),
      resizedPreferencePreserved: highDpiWideGeometry.layoutRatio !== null && highDpiWideGeometry.layoutRatio >= 1 / 3,
      wideWidthWithinViewport: Boolean(highDpiWideGeometry.sidebar && highDpiWideGeometry.sidebar.right <= highDpiWideGeometry.viewport.width + 2),
      workspacePreserved: highDpiWideGeometry.stageTrackWidth >= 759.5,
      requestedZoom: win.webContents.getZoomFactor(),
      beforeResize: beforeHighDpiResize,
      afterResize: highDpiWideGeometry
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
    "overlay",
    "The compact companion remains a bounded overlay above the 840 CSS pixel canvas boundary at 150% zoom",
    {
      overlayPresentation: zoomedCompactGeometry.sidebarClass.includes("layout-companion-overlay"),
      effectiveViewportAboveCanvas: zoomedCompactGeometry.viewport.width > 840,
      workspaceStillVisible: zoomedCompactGeometry.stageTrackWidth >= 399.5,
      requestedZoom: win.webContents.getZoomFactor()
    }
  );
  win.webContents.setZoomFactor(1);
  await settle();

  for (const scenario of [
    { width: 1100, height: 800, id: "companion-attached-1100", expected: "overlay" },
    { width: 900, height: 800, id: "companion-attached-900", expected: "overlay" },
    { width: 841, height: 800, id: "companion-attached-841", expected: "overlay" },
    { width: 840, height: 800, id: "companion-canvas-840", expected: "canvas" },
    { width: 839, height: 800, id: "companion-canvas-839", expected: "canvas" },
    { width: 841, height: 800, id: "companion-attached-return-841", expected: "overlay" },
    { width: 720, height: 720, id: "companion-canvas-720", expected: "canvas" }
  ]) {
    await setCssViewportWidth(win, scenario.width, scenario.height);
    await settle();
    await ensureDefaultCompanion(win);
    await captureCompanionGeometryState(
      win,
      report,
      scenario.id,
      scenario.expected,
      `AI companion is ${scenario.expected === "docked" ? "attached" : scenario.expected === "overlay" ? "an overlay" : "canvas"} at ${scenario.width}px`
    );
  }

  await win.webContents.executeJavaScript(`
    (() => {
      const collapse = document.querySelector('.ai-sidebar-close');
      if (collapse instanceof HTMLButtonElement) collapse.click();
    })()
  `);
  await settle();
}

async function captureGlobalSearchLayerContract(win, report) {
  await win.webContents.executeJavaScript("window.openmind.__setVisualMode('normal')");
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
  await waitForSelectorToDisappear(win, ".global-search-dialog");
  await settle();
  const afterClose = await win.webContents.executeJavaScript(`
    (() => {
      const root = document.querySelector('#root');
      const sidebar = document.querySelector('.ai-sidebar');
      const stage = document.querySelector('.app-stage');
      const nav = document.querySelector('.app-nav');
      return {
        searchClosed: !document.querySelector('.global-search-dialog'),
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
    compactSearchFillsHeader: compact.headerGeometry?.checks.searchFillsRemainingWidth === true,
    compactInputFillsSearch: compact.headerGeometry?.checks.inputFillsSearch === true,
    compactCloseAtRight: compact.headerGeometry?.checks.closeAtRight === true,
    compactHeaderNoOverflow: compact.headerGeometry?.checks.noOverflow === true,
    canvasMountedAfterSearch: canvas.sidebarClass.includes("layout-companion-canvas"),
    canvasPortalToBody: canvas.portalToBody,
    canvasFillsViewport: canvas.fillsViewport,
    canvasOwnsAiPoint: canvas.searchOwnsAiPoint,
    canvasOwnsFocus: canvas.focusInsideSearch,
    canvasBackgroundIsolated: canvas.rootInert && canvas.rootAriaHidden === "true",
    canvasSearchFillsHeader: canvas.headerGeometry?.checks.searchFillsRemainingWidth === true,
    canvasInputFillsSearch: canvas.headerGeometry?.checks.inputFillsSearch === true,
    canvasCloseAtRight: canvas.headerGeometry?.checks.closeAtRight === true,
    canvasHeaderNoOverflow: canvas.headerGeometry?.checks.noOverflow === true,
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
      const collapse = document.querySelector('.ai-sidebar-close');
      if (collapse instanceof HTMLButtonElement) collapse.click();
    })()
  `);
  await settle();
}

async function inspectGlobalSearchLayer(win) {
  return win.webContents.executeJavaScript(`
    (() => {
      const root = document.querySelector('#root');
      const scrim = document.querySelector('.global-search-dialog')?.closest('[data-ui-dialog]');
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
      // Measure the real feature composition: a shared header alone cannot
      // expose higher-specificity feature selectors overriding its layout.
      const header = dialog.querySelector(':scope > .ui-dialog-search-header');
      const search = header?.querySelector(':scope > [data-ui-control="search"]');
      const input = search?.querySelector('input');
      const close = header?.querySelector(':scope > .ui-icon-button');
      let headerGeometry = null;
      if (header instanceof HTMLElement && search instanceof HTMLElement
        && input instanceof HTMLInputElement && close instanceof HTMLButtonElement) {
        const box = element => {
          const rect = element.getBoundingClientRect();
          return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, width: rect.width, height: rect.height };
        };
        const content = element => {
          const rect = box(element);
          const style = getComputedStyle(element);
          const left = rect.left + (parseFloat(style.borderLeftWidth) || 0) + (parseFloat(style.paddingLeft) || 0);
          const right = rect.right - (parseFloat(style.borderRightWidth) || 0) - (parseFloat(style.paddingRight) || 0);
          return { left, right, width: right - left, gap: parseFloat(style.columnGap) || 0 };
        };
        const remainingWidth = (container, target) => {
          const children = [...container.children].filter(child => child instanceof HTMLElement && child.getBoundingClientRect().width > 0);
          const bounds = content(container);
          return bounds.width - children.filter(child => child !== target).reduce((total, child) => total + child.getBoundingClientRect().width, 0)
            - bounds.gap * Math.max(0, children.length - 1);
        };
        const headerContent = content(header);
        const searchBox = box(search);
        const inputBox = box(input);
        const closeBox = box(close);
        const availableSearchWidth = remainingWidth(header, search);
        const availableInputWidth = remainingWidth(search, input);
        headerGeometry = {
          checks: {
            searchFillsRemainingWidth: Math.abs(searchBox.left - headerContent.left) <= 2
              && Math.abs(searchBox.width - availableSearchWidth) <= 2,
            inputFillsSearch: inputBox.width > 0 && Math.abs(inputBox.width - availableInputWidth) <= 2,
            closeAtRight: Math.abs(closeBox.right - headerContent.right) <= 2,
            noOverflow: [header, search].every(element => element.scrollWidth <= element.clientWidth + 1)
              && searchBox.right <= closeBox.left + 1
              && Math.abs((searchBox.top + searchBox.bottom) / 2 - (closeBox.top + closeBox.bottom) / 2) <= 2
          },
          header: box(header), search: searchBox, input: inputBox, close: closeBox,
          availableSearchWidth, availableInputWidth
        };
      }
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
        headerGeometry,
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
  const resetActiveMode = async () => win.webContents.executeJavaScript(`
    (() => {
      const splitter = document.querySelector('.ai-sidebar-resizer');
      if (!(splitter instanceof HTMLElement)) return false;
      splitter.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }));
      return true;
    })()
  `);
  if (!await resetActiveMode()) throw new Error("Docked AI companion splitter was not available for reset.");
  await settle();
  await waitForVisualStability(win);

  const widths = await win.webContents.executeJavaScript(`
    (() => {
      const sidebar = document.querySelector('.ai-sidebar');
      const splitter = sidebar?.querySelector('.ai-sidebar-resizer');
      return {
        layout: Number(sidebar?.getAttribute('data-layout-width')),
        ratio: Number(sidebar?.getAttribute('data-layout-ratio')),
        separator: Number(splitter?.getAttribute('aria-valuenow'))
      };
    })()
  `);
  if (!Number.isFinite(widths.layout) || widths.layout <= 0 || widths.layout !== widths.separator || Math.abs(widths.ratio - 1 / 3) >= .001) {
    throw new Error(`AI companion reset did not restore its adaptive default width: ${JSON.stringify(widths)}.`);
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
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    })()
  `);
  if (!point) throw new Error("Docked AI companion splitter was not available for pointer resize.");
  // DOM rectangles are CSS pixels; Electron input coordinates use the window's
  // device-independent pixels. Page zoom scales both the target and drag delta.
  const zoom = win.webContents.getZoomFactor();
  const start = { x: Math.round(point.x * zoom), y: Math.round(point.y * zoom) };
  const end = { x: Math.round((point.x + deltaX) * zoom), y: start.y };
  win.webContents.sendInputEvent({ type: "mouseMove", ...start });
  await delay(30);
  win.webContents.sendInputEvent({ type: "mouseDown", ...start, button: "left", clickCount: 1 });
  await delay(30);
  const resizing = await win.webContents.executeJavaScript("Boolean(document.querySelector('.app-shell.ai-sidebar-resizing'))");
  if (!resizing) throw new Error(`Pointer resize did not start at zoom ${zoom}: ${JSON.stringify({ css: point, start })}`);
  win.webContents.sendInputEvent({ type: "mouseMove", ...end, movementX: end.x - start.x, movementY: 0, modifiers: ["leftButtonDown"] });
  await delay(30);
  win.webContents.sendInputEvent({ type: "mouseUp", ...end, button: "left", clickCount: 1 });
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
        layoutRatio: numberAttribute(sidebar, 'data-layout-ratio'),
        separatorValue: numberAttribute(splitter, 'aria-valuenow'),
        splitterVisible: visible(splitter),
        sidebarPosition: sidebar instanceof Element ? getComputedStyle(sidebar).position : null,
        role: sidebar?.getAttribute('role') || null,
        ariaModal: sidebar?.getAttribute('aria-modal') || null,
        stageInert: Boolean(stage?.inert),
        navInert: Boolean(nav?.inert),
        closeControlVisible: visible(sidebar?.querySelector('.ai-sidebar-close')),
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
    closeControlVisible: geometry.closeControlVisible,
    noHorizontalOverflow: geometry.horizontalOverflow <= 2,
    ...Object.fromEntries(Object.entries(additionalChecks).filter(([, value]) => typeof value === "boolean"))
  } : expected === "overlay" ? {
    sidebarPresent: Boolean(geometry.sidebar),
    overlayPresentation: geometry.shellClass.includes("layout-companion-overlay")
      && geometry.sidebarClass.includes("layout-companion-overlay"),
    splitterVisible: geometry.splitterVisible,
    workspaceVisible: geometry.stageTrackWidth >= 399.5,
    sidebarIsOverlay: geometry.sidebarPosition === "fixed",
    sidebarAtRightEdge: Boolean(
      geometry.sidebar
      && geometry.sidebar.right <= geometry.viewport.width + 2
      && geometry.sidebar.right >= geometry.viewport.width - 32
    ),
    backgroundInteractive: !geometry.stageInert && !geometry.navInert,
    notModal: geometry.role !== "dialog" && geometry.ariaModal !== "true",
    closeControlVisible: geometry.closeControlVisible,
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

async function captureControlledPageSnapshot(win, report, viewport, page) {
  const collapsed = await win.webContents.executeJavaScript(`
    (() => {
      const button = document.querySelector('.ai-sidebar-close');
      if (!(button instanceof HTMLButtonElement)) return false;
      button.click();
      return true;
    })()
  `);
  if (!collapsed) throw new Error(`Unable to reveal the controlled ${page.label} page snapshot.`);
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
  const file = path.join(outputRoot, `${viewport.id}-${page.id}-controlled-page.png`);
  const image = await win.webContents.capturePage();
  fs.writeFileSync(file, image.toPNG());
  const item = {
    id: `${viewport.id}-${page.id}-controlled-page`,
    label: page.label,
    description: "Page layout with the AI companion explicitly collapsed; paired with the product-state canvas snapshot.",
    file: path.relative(appRoot, file),
    width: viewport.width,
    height: viewport.height,
    zoom: viewport.zoom,
    ...audit
  };
  report.stateSnapshots.push(item);
  if (!audit.ok) report.failures.push(item);
}

async function captureResponsiveGapContracts(win, report) {
  win.webContents.setZoomFactor(1);
  await setCssViewportWidth(win, 720, 720);
  await clickNav(win, "设置");
  await waitForReady(win, "设置", { requiredSelector: ".settings-page", settingsMode: true });
  await clickSettingsSection(win, "浏览器");
  await waitForText(win, "浏览器连接");
  await win.webContents.executeJavaScript("document.querySelector('.settings-browser-actions')?.scrollIntoView({ block: 'center' })");
  await waitForSelector(win, ".settings-browser-actions");

  const inspectBrowserSetup = () => win.webContents.executeJavaScript(`
    (() => {
      const backend = document.querySelector('.settings-browser-backend');
      const card = backend?.closest('.settings-card');
      const detail = document.querySelector('.settings-detail');
      const controls = card?.querySelector('.settings-browser-actions');
      const rect = (element) => element instanceof Element ? Object.fromEntries(['left','top','right','bottom','width','height'].map((key) => [key, Math.round(element.getBoundingClientRect()[key] * 10) / 10])) : null;
      const inside = (inner, outer) => Boolean(inner && outer && inner.left >= outer.left - 1 && inner.right <= outer.right + 1);
      const buttons = controls ? [...controls.children].filter((element) => getComputedStyle(element).display !== 'none').map(rect) : [];
      return {
        viewport: { width: window.innerWidth, height: window.innerHeight },
        backend: rect(backend), card: rect(card), controls: rect(controls),
        buttonCount: buttons.length,
        backendInsideCard: inside(rect(backend), rect(card)),
        controlsInsideCard: inside(rect(controls), rect(card)) && buttons.every((item) => inside(item, rect(controls))),
        noDocumentOverflow: document.documentElement.scrollWidth <= document.documentElement.clientWidth + 2,
        noDetailOverflow: detail instanceof HTMLElement && detail.scrollWidth <= detail.clientWidth + 2,
        noControlsOverflow: controls instanceof HTMLElement && controls.scrollWidth <= controls.clientWidth + 2
      };
    })()
  `);
  const browserSetupChecks = (geometry) => ({
    backendVisible: Boolean(geometry.backend && geometry.backend.width > 0 && geometry.backend.height > 0),
    allSetupActionsPresent: geometry.buttonCount === 3,
    backendInsideCard: geometry.backendInsideCard,
    controlsInsideCard: geometry.controlsInsideCard,
    noDocumentOverflow: geometry.noDocumentOverflow,
    noDetailOverflow: geometry.noDetailOverflow,
    noControlsOverflow: geometry.noControlsOverflow
  });
  for (const width of [720, 840, 900, 1020]) {
    await setCssViewportWidth(win, width, 720);
    const geometry = await inspectBrowserSetup();
    await recordContractState(win, report, `settings-browser-skill-${width}`, "设置", `BrowserSkill setup actions stay inside their component at ${width}px`, geometry, browserSetupChecks(geometry));
  }
  const settingsResizeSamples = [];
  for (const width of Array.from({ length: 16 }, (_, index) => 1020 - index * 20)) {
    await setCssViewportWidth(win, width, 720);
    settingsResizeSamples.push(await inspectBrowserSetup());
  }
  await recordContractState(win, report, "settings-browser-skill-continuous-resize", "设置", "BrowserSkill setup remains usable while resizing continuously from 1020px to 720px", {
    viewport: settingsResizeSamples.at(-1)?.viewport,
    samples: settingsResizeSamples
  }, {
    allSamplesMeasured: settingsResizeSamples.length === 16,
    allActionsVisibleAndContained: settingsResizeSamples.every((sample) => Object.values(browserSetupChecks(sample)).every(Boolean))
  });

  await exitSettings(win);
  await setCssViewportWidth(win, 720, 600);
  await clickNav(win, "创作");
  await waitForReady(win, "创作", { minTextLength: 100, requiredSelector: ".creative-workspace-page" });
  const compactListReopened = await win.webContents.executeJavaScript(`
    (() => {
      const button = document.querySelector('button[aria-label="展开内容列表"]');
      if (!(button instanceof HTMLButtonElement)) return false;
      button.click();
      return true;
    })()
  `);
  if (compactListReopened) await settle();
  const projectOpened = await win.webContents.executeJavaScript(`
    (() => {
      const button = [...document.querySelectorAll('.creative-item-row')].find((item) => item.textContent.includes('Windows/WSL'));
      if (!(button instanceof HTMLButtonElement)) return false;
      button.click();
      return true;
    })()
  `);
  if (!projectOpened) throw new Error("Creative ready visual fixture was not found.");
  await waitForSelectorExists(win, ".creative-detail-transition.stage-ready .creative-editor");

  for (const width of [720, 900, 1280]) {
    await setCssViewportWidth(win, width, 600);
    await settle();
    const geometry = await win.webContents.executeJavaScript(`
      (() => {
        const flow = document.querySelector('.creative-detail-transition.stage-ready');
        const publish = flow?.querySelector('.publish-form');
        const exportButton = [...(flow?.querySelectorAll('button') || [])].find((button) => button.textContent.includes('立即导出'));
        const editor = flow?.querySelector('.creative-editor');
        const editorInput = flow?.querySelector('[aria-label="Markdown 草稿编辑器"]');
        const stats = flow?.querySelector('.writing-stats');
        const focusable = flow ? [...flow.querySelectorAll('button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]')].filter((element) => element.tabIndex >= 0 && getComputedStyle(element).display !== 'none' && getComputedStyle(element).visibility !== 'hidden') : [];
        const intersects = (element) => {
          if (!(element instanceof Element) || !(flow instanceof Element)) return false;
          const box = element.getBoundingClientRect();
          const owner = flow.getBoundingClientRect();
          return box.bottom > owner.top + 1 && box.top < owner.bottom - 1;
        };
        const reach = (element) => {
          if (!(element instanceof Element)) return false;
          element.scrollIntoView({ block: 'center' });
          return intersects(element);
        };
        const publishReachable = reach(publish);
        const exportReachable = reach(exportButton);
        const editorReachable = reach(editorInput || editor);
        const statsReachable = reach(stats);
        const nestedScrollOwners = flow ? [...flow.querySelectorAll('*')].filter((element) => {
          if (!(element instanceof HTMLElement) || element instanceof HTMLTextAreaElement) return false;
          const style = getComputedStyle(element);
          return ['auto', 'scroll'].includes(style.overflowY) && element.scrollHeight > element.clientHeight + 2;
        }).map((element) => element.className || element.tagName) : [];
        const rect = (element) => element instanceof Element ? Object.fromEntries(['top','right','bottom','left','width','height'].map((key) => [key, Math.round(element.getBoundingClientRect()[key] * 10) / 10])) : null;
        return {
          viewport: { width: window.innerWidth, height: window.innerHeight },
          flow: rect(flow),
          publish: rect(publish),
          editor: rect(editor),
          stats: rect(stats),
          flowClientHeight: flow instanceof HTMLElement ? flow.clientHeight : 0,
          flowScrollHeight: flow instanceof HTMLElement ? flow.scrollHeight : 0,
          flowOverflowY: flow instanceof Element ? getComputedStyle(flow).overflowY : null,
          nestedScrollOwners,
          focusableCount: focusable.length,
          publishReachable,
          exportReachable,
          editorReachable,
          statsReachable
        };
      })()
    `);
    const tabFocusAudit = await auditTabFocusReachability(win, ".creative-detail-transition.stage-ready");
    geometry.tabFocusAudit = tabFocusAudit;
    await recordContractState(win, report, `creative-ready-${width}x600`, "创作", `Ready-stage publish form, editor, and stats share one reachable flow at ${width}x600`, geometry, {
      editorHasHeight: Boolean(geometry.editor && geometry.editor.height > 0),
      explicitScrollOwner: ["auto", "scroll"].includes(geometry.flowOverflowY),
      noNestedScrollTrap: geometry.nestedScrollOwners.length === 0,
      focusTargetsPresent: geometry.focusableCount > 0,
      tabFocusReachable: tabFocusAudit.allReachable && tabFocusAudit.exitedOwner && tabFocusAudit.visited >= Math.min(8, geometry.focusableCount),
      publishReachable: geometry.publishReachable,
      exportReachable: geometry.exportReachable,
      editorReachable: geometry.editorReachable,
      statsReachable: geometry.statsReachable
    });
  }

  for (const [width, expectedMode] of [[1479, "single"], [1480, "single"], [1481, "split"]]) {
    await setCssViewportWidth(win, width, 720);
    await settle();
    const breakpointGeometry = await win.webContents.executeJavaScript(`
      (() => {
        const workspace = document.querySelector('.creative-workspace');
        const list = workspace?.querySelector(':scope > .creative-list-pane');
        const splitter = workspace?.querySelector(':scope > .column-splitter');
        const detail = workspace?.querySelector(':scope > .creative-main-pane');
        const visible = (element) => element instanceof Element && getComputedStyle(element).display !== 'none' && element.getBoundingClientRect().width > 0 && element.getBoundingClientRect().height > 0;
        return {
          viewport: { width: window.innerWidth, height: window.innerHeight },
          classes: workspace?.className || '',
          columns: workspace instanceof Element ? getComputedStyle(workspace).gridTemplateColumns : null,
          listVisible: visible(list),
          splitterVisible: visible(splitter),
          detailVisible: visible(detail)
        };
      })()
    `);
    await recordContractState(win, report, `creative-workspace-boundary-${width}`, "创作", `Creative workspace follows the shared ${expectedMode} state at ${width}px`, breakpointGeometry, expectedMode === "single" ? {
      compactClassOwnedByReact: breakpointGeometry.classes.includes("compact-detail-open"),
      listReplaced: !breakpointGeometry.listVisible,
      splitterRemoved: !breakpointGeometry.splitterVisible,
      detailVisible: breakpointGeometry.detailVisible
    } : {
      noCompactClass: !breakpointGeometry.classes.includes("compact-"),
      listVisible: breakpointGeometry.listVisible,
      splitterVisible: breakpointGeometry.splitterVisible,
      detailVisible: breakpointGeometry.detailVisible
    });
  }

  await setCssViewportWidth(win, 841, 720);
  await clickNav(win, "新建任务");
  await waitForReady(win, "新建任务", { minTextLength: 90, requiredSelector: ".ai-workbench" });
  const historyOpened = await win.webContents.executeJavaScript(`
    (() => {
      const button = document.querySelector('.history-toggle');
      if (!(button instanceof HTMLButtonElement)) return false;
      button.click();
      return true;
    })()
  `);
  if (!historyOpened) throw new Error("AI history toggle was not reachable at 841px.");
  await waitForSelector(win, ".history-flyout");

  for (const width of [841, 850, 900, 940, 1000, 1019]) {
    await setCssViewportWidth(win, width, 720);
    await settle();
    const geometry = await win.webContents.executeJavaScript(`
      (() => {
        const flyout = document.querySelector('.history-flyout');
        const button = document.querySelector('.history-toggle');
        const list = flyout?.querySelector('.session-list');
        const items = list ? [...list.querySelectorAll('button')] : [];
        const rect = (element) => element instanceof Element ? Object.fromEntries(['top','right','bottom','left','width','height'].map((key) => [key, Math.round(element.getBoundingClientRect()[key] * 10) / 10])) : null;
        const box = rect(flyout);
        if (items[0] instanceof Element) items[0].scrollIntoView({ block: 'start' });
        if (items.at(-1) instanceof Element) items.at(-1).scrollIntoView({ block: 'end' });
        return {
          viewport: { width: window.innerWidth, height: window.innerHeight },
          flyout: box,
          button: rect(button),
          side: flyout?.getAttribute('data-side'),
          visibility: flyout instanceof Element ? getComputedStyle(flyout).visibility : null,
          listClientHeight: list instanceof HTMLElement ? list.clientHeight : 0,
          listScrollHeight: list instanceof HTMLElement ? list.scrollHeight : 0,
          listOverflowY: list instanceof HTMLElement ? getComputedStyle(list).overflowY : null,
          insideViewport: Boolean(box && box.left >= 8 - 1 && box.top >= 8 - 1 && box.right <= window.innerWidth - 8 + 1 && box.bottom <= window.innerHeight - 8 + 1)
        };
      })()
    `);
    await recordContractState(win, report, `ai-history-${width}`, "新建任务", `History flyout remains anchored after resizing to ${width}px`, geometry, {
      visible: geometry.visibility === "visible" && Boolean(geometry.flyout?.width && geometry.flyout?.height),
      insideViewport: geometry.insideViewport,
      listScrollsWhenNeeded: geometry.listScrollHeight > geometry.listClientHeight
        || ["auto", "scroll"].includes(geometry.listOverflowY)
    });
  }

  await setCssViewportWidth(win, 840, 720);
  await waitForSelectorToDisappear(win, ".history-flyout");
  const historyClosedAtDrawer = await win.webContents.executeJavaScript(`
    (() => {
      const button = document.querySelector('.history-toggle');
      return {
        viewport: { width: window.innerWidth, height: window.innerHeight },
        buttonDisplay: button instanceof Element ? getComputedStyle(button).display : null,
        expanded: button?.getAttribute('aria-expanded'),
        flyoutPresent: Boolean(document.querySelector('.history-flyout'))
      };
    })()
  `);
  await recordContractState(win, report, "ai-history-cross-840", "新建任务", "History closes when the 840px drawer state hides its anchor", historyClosedAtDrawer, {
    anchorHidden: historyClosedAtDrawer.buttonDisplay === "none",
    stateClosed: historyClosedAtDrawer.expanded === "false",
    flyoutRemoved: !historyClosedAtDrawer.flyoutPresent
  });

  await setCssViewportWidth(win, 841, 720);
  await settle();
  const historyClosedAfterDrawer = await win.webContents.executeJavaScript(`
    (() => {
      const button = document.querySelector('.history-toggle');
      return {
        viewport: { width: window.innerWidth, height: window.innerHeight },
        buttonVisible: button instanceof Element && getComputedStyle(button).display !== 'none' && button.getBoundingClientRect().width > 0,
        expanded: button?.getAttribute('aria-expanded'),
        flyoutPresent: Boolean(document.querySelector('.history-flyout'))
      };
    })()
  `);
  await recordContractState(win, report, "ai-history-cross-back-841", "新建任务", "History stays closed after returning from drawer to rail navigation", historyClosedAfterDrawer, {
    anchorVisible: historyClosedAfterDrawer.buttonVisible,
    stateClosed: historyClosedAfterDrawer.expanded === "false",
    flyoutRemoved: !historyClosedAfterDrawer.flyoutPresent
  });
  const historyReopened = await win.webContents.executeJavaScript(`
    (() => {
      const button = document.querySelector('.history-toggle');
      if (!(button instanceof HTMLButtonElement)) return false;
      button.click();
      return true;
    })()
  `);
  if (!historyReopened) throw new Error("AI history could not be reopened before the 1020px crossing check.");
  await waitForSelector(win, ".history-flyout");
  await setCssViewportWidth(win, 1020, 720);
  await waitForSelectorToDisappear(win, ".history-flyout");
  const historyClosedAtExpandedNav = await win.webContents.executeJavaScript(`
    (() => {
      const button = document.querySelector('.history-toggle');
      return {
        viewport: { width: window.innerWidth, height: window.innerHeight },
        buttonDisplay: button instanceof Element ? getComputedStyle(button).display : null,
        expanded: button?.getAttribute('aria-expanded'),
        flyoutPresent: Boolean(document.querySelector('.history-flyout'))
      };
    })()
  `);
  await recordContractState(win, report, "ai-history-cross-1020", "新建任务", "History closes when expanded navigation hides its anchor at 1020px", historyClosedAtExpandedNav, {
    anchorHidden: historyClosedAtExpandedNav.buttonDisplay === "none",
    stateClosed: historyClosedAtExpandedNav.expanded === "false",
    flyoutRemoved: !historyClosedAtExpandedNav.flyoutPresent
  });
  await win.webContents.executeJavaScript("window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))");
  await waitForSelectorToDisappear(win, ".history-flyout");

  await setCssViewportWidth(win, 720, 600);
  const openedCompletedSession = await win.webContents.executeJavaScript(`
    (() => {
      const button = [...document.querySelectorAll('.nav-recent-item')].find((item) => item.textContent.includes('长会话性能验证'));
      if (!(button instanceof HTMLButtonElement)) return false;
      button.click();
      return true;
    })()
  `);
  if (!openedCompletedSession) throw new Error("Long-message session fixture was not found.");
  await waitForText(win, "长 URL");
  const longMessageGeometry = await win.webContents.executeJavaScript(`
    (() => {
      const markdown = [...document.querySelectorAll('.assistant-message .chat-markdown')].at(-1);
      const userText = [...document.querySelectorAll('.user-message p')].at(-1);
      const pre = markdown?.querySelector('pre');
      const inlineCode = markdown ? [...markdown.querySelectorAll('code')].find((element) => !element.closest('pre')) : null;
      const markdownBox = markdown?.getBoundingClientRect();
      const inlineCodeRects = inlineCode ? [...inlineCode.getClientRects()].map((box) => ({ left: box.left, right: box.right, top: box.top, bottom: box.bottom, width: box.width, height: box.height })) : [];
      const chat = document.querySelector('.chat-scroll');
      const reachable = (element) => {
        if (!(element instanceof Element) || !(chat instanceof Element)) return false;
        element.scrollIntoView({ block: 'center' });
        const box = element.getBoundingClientRect();
        const owner = chat.getBoundingClientRect();
        return box.bottom > owner.top + 1 && box.top < owner.bottom - 1;
      };
      const userReachable = reachable(userText);
      const assistantReachable = reachable(markdown);
      return {
        viewport: { width: window.innerWidth, height: window.innerHeight },
        markdownClientWidth: markdown instanceof HTMLElement ? markdown.clientWidth : 0,
        markdownScrollWidth: markdown instanceof HTMLElement ? markdown.scrollWidth : 0,
        userClientWidth: userText instanceof HTMLElement ? userText.clientWidth : 0,
        userScrollWidth: userText instanceof HTMLElement ? userText.scrollWidth : 0,
        inlineCodeClientWidth: inlineCode instanceof HTMLElement ? inlineCode.clientWidth : 0,
        inlineCodeScrollWidth: inlineCode instanceof HTMLElement ? inlineCode.scrollWidth : 0,
        inlineCodeRects,
        inlineCodeContained: Boolean(markdownBox && inlineCodeRects.length && inlineCodeRects.every((box) => box.width > 0 && box.height > 0 && box.left >= markdownBox.left - 1 && box.right <= markdownBox.right + 1)),
        codeBlockExists: pre instanceof HTMLElement,
        codeBlockOverflowPreserved: pre instanceof HTMLElement && getComputedStyle(pre).overflowX === 'auto',
        userReachable,
        assistantReachable
      };
    })()
  `);
  await recordContractState(win, report, "ai-long-unbroken-content-720x600", "新建任务", "Long user/assistant URL, UNC path, hash, inline base64, and code block stay inside the chat flow", longMessageGeometry, {
    assistantRendered: longMessageGeometry.markdownClientWidth > 0,
    markdownContained: longMessageGeometry.markdownScrollWidth <= longMessageGeometry.markdownClientWidth + 2,
    userRendered: longMessageGeometry.userClientWidth > 0,
    userContained: longMessageGeometry.userScrollWidth <= longMessageGeometry.userClientWidth + 2,
    inlineCodeRendered: longMessageGeometry.inlineCodeRects.length > 0 && longMessageGeometry.inlineCodeRects.every((box) => box.width > 0 && box.height > 0),
    inlineCodeContained: longMessageGeometry.inlineCodeContained,
    codeBlockRendered: longMessageGeometry.codeBlockExists,
    codeBlockOverflowPreserved: longMessageGeometry.codeBlockOverflowPreserved,
    userReachable: longMessageGeometry.userReachable,
    assistantReachable: longMessageGeometry.assistantReachable
  });

  await captureCoarsePointerRecentActions(win, report);

  await clickNav(win, "自动化");
  await waitForReady(win, "自动化", { requiredSelector: ".automation-page" });
  for (const width of [720, 840, 900]) {
    await setCssViewportWidth(win, width, 600);
    await settle();
    const automationGeometry = await win.webContents.executeJavaScript(`
      (() => {
        const page = document.querySelector('.automation-page');
        const layout = document.querySelector('.automation-rules-layout');
        const list = document.querySelector('.automation-rule-list');
        const firstRule = list?.querySelector('.rule-item');
        const detail = document.querySelector('.automation-detail-pane');
        const runButton = detail?.querySelector('[data-ui-control="button"][data-variant="primary"]');
        const consoleBox = document.querySelector('.automation-console-box');
        const intersects = (element) => {
          if (!(element instanceof Element)) return false;
          const box = element.getBoundingClientRect();
          return box.bottom > 0 && box.top < window.innerHeight;
        };
        const reach = (element) => {
          if (!(element instanceof Element)) return false;
          element.scrollIntoView({ block: 'center' });
          return intersects(element);
        };
        const listReachable = reach(firstRule);
        const detailReachable = reach(runButton);
        const consoleReachable = reach(consoleBox);
        const rect = (element) => element instanceof Element ? Object.fromEntries(['top','right','bottom','left','width','height'].map((key) => [key, Math.round(element.getBoundingClientRect()[key] * 10) / 10])) : null;
        return {
          viewport: { width: window.innerWidth, height: window.innerHeight },
          page: rect(page),
          layout: rect(layout),
          list: rect(list),
          detail: rect(detail),
          console: rect(consoleBox),
          pageClientHeight: page instanceof HTMLElement ? page.clientHeight : 0,
          pageScrollHeight: page instanceof HTMLElement ? page.scrollHeight : 0,
          layoutOverflow: layout instanceof Element ? getComputedStyle(layout).overflow : null,
          listReachable,
          detailReachable,
          consoleReachable
        };
      })()
    `);
    await recordContractState(win, report, `automation-${width}x600`, "自动化", `Rule list, detail actions, run history, and console remain reachable at ${width}x600`, automationGeometry, {
      listHasHeight: Boolean(automationGeometry.list && automationGeometry.list.height > 0),
      layoutDoesNotClip: automationGeometry.layoutOverflow !== "hidden",
      pageOwnsScroll: automationGeometry.pageScrollHeight > automationGeometry.pageClientHeight,
      listReachable: automationGeometry.listReachable,
      detailReachable: automationGeometry.detailReachable,
      consoleReachable: automationGeometry.consoleReachable
    });
  }

  await setCssViewportWidth(win, 720, 600);

  const selectOpened = await win.webContents.executeJavaScript(`
    (() => {
      const root = document.querySelector('.automation-trigger-select');
      const trigger = root?.querySelector('.ui-select-trigger');
      if (!(root instanceof HTMLElement) || !(trigger instanceof HTMLButtonElement)) return false;
      root.dataset.visualEdgeFixture = 'true';
      Object.assign(root.style, { position: 'fixed', right: '8px', bottom: '8px', zIndex: '999' });
      trigger.click();
      return true;
    })()
  `);
  if (!selectOpened) throw new Error("Automation Select fixture was not reachable.");
  await waitForSelector(win, ".automation-trigger-select-menu");
  const selectGeometry = await win.webContents.executeJavaScript(`
    (() => {
      const menu = document.querySelector('.automation-trigger-select-menu');
      const box = menu?.getBoundingClientRect();
      return {
        viewport: { width: window.innerWidth, height: window.innerHeight },
        menu: box ? { left: box.left, top: box.top, right: box.right, bottom: box.bottom, width: box.width, height: box.height } : null,
        side: menu?.getAttribute('data-side'),
        portaled: menu?.parentElement === document.body,
        insideViewport: Boolean(box && box.left >= 7 && box.top >= 7 && box.right <= window.innerWidth - 7 && box.bottom <= window.innerHeight - 7)
      };
    })()
  `);
  await recordContractState(win, report, "select-bottom-edge-720x600", "自动化", "Shared Select portals, flips, and clamps near the bottom-right viewport edge", selectGeometry, {
    portaled: selectGeometry.portaled,
    flippedAbove: selectGeometry.side === "top",
    insideViewport: selectGeometry.insideViewport
  });
  await win.webContents.executeJavaScript(`
    (() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
      const root = document.querySelector('[data-visual-edge-fixture]');
      if (root instanceof HTMLElement) { root.removeAttribute('data-visual-edge-fixture'); root.removeAttribute('style'); }
    })()
  `);

  await clickNav(win, "设置");
  await waitForReady(win, "设置", { requiredSelector: ".settings-page", settingsMode: true });
  await clickSettingsSection(win, "工作流");
  const confirmOpened = await win.webContents.executeJavaScript(`
    (() => {
      const button = [...document.querySelectorAll('.settings-card button')].find((item) => item.textContent.includes('恢复默认值'));
      if (!(button instanceof HTMLButtonElement)) return false;
      button.click();
      return true;
    })()
  `);
  if (!confirmOpened) throw new Error("Workflow confirmation fixture was not reachable.");
  await waitForSelector(win, '[data-ui-control="dialog"][role="alertdialog"]');
  const confirmGeometry = await win.webContents.executeJavaScript(`
    (() => {
      const card = document.querySelector('[data-ui-control="dialog"][role="alertdialog"]');
      const title = card?.querySelector('.ui-dialog-heading h2');
      const description = card?.querySelector('.ui-dialog-heading p');
      const body = card?.querySelector('.ui-dialog-header');
      if (title) title.textContent = '长标题' + '标题内容'.repeat(100);
      if (description) description.textContent = Array.from({ length: 100 }, (_, index) => '第 ' + (index + 1) + ' 行确认内容').join('\\n');
      const actions = card?.querySelector('.ui-dialog-footer');
      const box = card?.getBoundingClientRect();
      const actionBox = actions?.getBoundingClientRect();
      return {
        viewport: { width: window.innerWidth, height: window.innerHeight },
        card: box ? { top: box.top, right: box.right, bottom: box.bottom, left: box.left, width: box.width, height: box.height } : null,
        bodyClientHeight: body instanceof HTMLElement ? body.clientHeight : 0,
        bodyScrollHeight: body instanceof HTMLElement ? body.scrollHeight : 0,
        actionsVisible: Boolean(actionBox && actionBox.top >= box.top && actionBox.bottom <= box.bottom && actionBox.bottom <= window.innerHeight),
        cardInsideViewport: Boolean(box && box.top >= 0 && box.bottom <= window.innerHeight)
      };
    })()
  `);
  await recordContractState(win, report, "confirm-long-content-720x600", "设置", "Long confirmation title/body scroll while actions remain visible", confirmGeometry, {
    cardInsideViewport: confirmGeometry.cardInsideViewport,
    bodyScrollable: confirmGeometry.bodyScrollHeight > confirmGeometry.bodyClientHeight,
    actionsVisible: confirmGeometry.actionsVisible
  });
  await win.webContents.executeJavaScript(`document.querySelector('[role="alertdialog"] .ui-dialog-footer button')?.click()`);
  await waitForSelectorToDisappear(win, '[data-ui-control="dialog"][role="alertdialog"]');

  await clickSettingsSection(win, "AI 与模型");
  await waitForText(win, "Provider 列表");
  const providerMenuOpened = await win.webContents.executeJavaScript(`
    (() => {
      const trigger = document.querySelector('.settings-provider-menu .ui-dropdown-trigger');
      if (!(trigger instanceof HTMLButtonElement)) return false;
      trigger.scrollIntoView({ block: 'center' });
      trigger.click();
      return true;
    })()
  `);
  if (!providerMenuOpened) throw new Error("Provider action menu fixture was not reachable.");
  await waitForSelector(win, ".ui-dropdown-menu");
  await settle();
  const providerGeometry = await win.webContents.executeJavaScript(`
    (() => {
      const card = document.querySelector('.settings-provider-config-card');
      const menu = document.querySelector('.ui-dropdown-menu');
      const cardBox = card?.getBoundingClientRect();
      const menuBox = menu?.getBoundingClientRect();
      return {
        viewport: { width: window.innerWidth, height: window.innerHeight },
        menuPortaled: menu?.parentElement === document.body,
        menuInsideViewport: Boolean(menuBox && menuBox.left >= 7 && menuBox.top >= 7 && menuBox.right <= window.innerWidth - 7 && menuBox.bottom <= window.innerHeight - 7),
        menuItems: menu?.querySelectorAll('[role="menuitem"]').length || 0,
        menuFocusInside: Boolean(menu && menu.contains(document.activeElement)),
        cardContained: card instanceof HTMLElement && card.scrollWidth <= card.clientWidth + 2,
        cardVisible: Boolean(cardBox && cardBox.width > 0 && cardBox.height > 0)
      };
    })()
  `);
  await recordContractState(win, report, "settings-provider-menu-720x600", "设置", "Provider cards and their shared anchored action menu remain contained at 720x600", providerGeometry, {
    cardVisible: providerGeometry.cardVisible,
    cardContained: providerGeometry.cardContained,
    menuPortaled: providerGeometry.menuPortaled,
    menuInsideViewport: providerGeometry.menuInsideViewport,
    menuFocusInside: providerGeometry.menuFocusInside,
    actionsReachable: providerGeometry.menuItems >= 2
  });
  await win.webContents.executeJavaScript(`document.querySelector('.settings-provider-menu .ui-dropdown-trigger')?.click()`);
  await waitForSelectorToDisappear(win, ".ui-dropdown-menu");

  await clickSettingsSection(win, "Skills");
  await waitForSelector(win, ".skills-page");
  const curlSkillSelected = await win.webContents.executeJavaScript(`
    (() => {
      const skill = [...document.querySelectorAll('button')].find((item) => item.textContent.includes('X Following'));
      if (!(skill instanceof HTMLButtonElement)) return false;
      skill.click();
      return true;
    })()
  `);
  if (!curlSkillSelected) throw new Error("X Following Skill visual fixture was not found.");
  await settle();
  const curlConfigTabSelected = await win.webContents.executeJavaScript(`
    (() => {
      const tab = [...document.querySelectorAll('[role="tab"]')].find((item) => item.textContent.includes('请求配置'));
      if (!(tab instanceof HTMLButtonElement)) return false;
      tab.click();
      return true;
    })()
  `);
  if (!curlConfigTabSelected) throw new Error("X Following request configuration tab was not found.");
  await settle();
  const curlOpened = await win.webContents.executeJavaScript(`
    (() => {
      const edit = [...document.querySelectorAll('button')].find((item) => /填写 cURL|编辑 cURL/.test(item.textContent || ''));
      if (!(edit instanceof HTMLButtonElement)) return false;
      edit.click();
      return true;
    })()
  `);
  if (curlOpened) {
    await waitForSelector(win, ".skills-x-curl-editor");
    const curlGeometry = await win.webContents.executeJavaScript(`
      (() => {
        const dialog = document.querySelector('.skills-x-curl-editor');
        const textarea = dialog?.querySelector('textarea');
        if (textarea instanceof HTMLTextAreaElement) {
          textarea.value = 'curl https://example.com ' + '-H header '.repeat(180);
          textarea.style.height = '520px';
        }
        const footer = dialog?.querySelector('footer');
        footer?.scrollIntoView({ block: 'end' });
        const box = dialog?.getBoundingClientRect();
        const footerBox = footer?.getBoundingClientRect();
        return {
          viewport: { width: window.innerWidth, height: window.innerHeight },
          dialog: box ? { top: box.top, right: box.right, bottom: box.bottom, left: box.left, width: box.width, height: box.height } : null,
          textareaHeight: textarea?.getBoundingClientRect().height || 0,
          footerVisible: Boolean(box && footerBox && footerBox.top >= box.top && footerBox.bottom <= box.bottom && footerBox.bottom <= window.innerHeight),
          dialogInsideViewport: Boolean(box && box.top >= 0 && box.bottom <= window.innerHeight)
        };
      })()
    `);
    await recordContractState(win, report, "skills-curl-long-editor-720x600", "设置", "Resized cURL input keeps cancel/save actions reachable", curlGeometry, {
      dialogInsideViewport: curlGeometry.dialogInsideViewport,
      textareaClamped: curlGeometry.textareaHeight <= 360.5,
      footerVisible: curlGeometry.footerVisible
    });
    await win.webContents.executeJavaScript(`document.querySelector('.skills-x-curl-editor button[aria-label="关闭"]')?.click()`);
  } else {
    throw new Error("Skills cURL visual fixture was not reachable.");
  }

  await setCssViewportWidth(win, 1280, 720);
  for (const [inlineSize, expectedMode] of [[859, "stacked"], [860, "split"], [861, "split"]]) {
    await win.webContents.executeJavaScript(`
      (() => {
        const host = document.querySelector('.settings-detail-inner');
        if (!(host instanceof HTMLElement)) return false;
        host.style.width = '${inlineSize}px';
        host.style.maxWidth = 'none';
        // The boundary harness changes only an internal host style, whereas
        // production changes arrive through a native window/layout signal.
        // Notify the shared coalesced measurement path after the synthetic edit.
        window.dispatchEvent(new Event('resize'));
        return true;
      })()
    `);
    await settle();
    const geometry = await win.webContents.executeJavaScript(`
      (() => {
        const layout = document.querySelector('.skills-layout');
        const catalog = layout?.querySelector('.skills-catalog');
        const detail = layout?.querySelector('.skills-detail');
        const visible = (element) => element instanceof Element && getComputedStyle(element).display !== 'none' && element.getBoundingClientRect().width > 0 && element.getBoundingClientRect().height > 0;
        return {
          viewport: { width: window.innerWidth, height: window.innerHeight },
          inlineSize: layout?.getBoundingClientRect().width || 0,
          mode: layout?.getAttribute('data-layout'),
          columns: layout instanceof Element ? getComputedStyle(layout).gridTemplateColumns : null,
          catalogVisible: visible(catalog),
          detailVisible: visible(detail),
          overflow: layout instanceof HTMLElement ? layout.scrollWidth - layout.clientWidth : null
        };
      })()
    `);
    await recordContractState(win, report, `skills-layout-boundary-${inlineSize}`, "设置", `Skills owns its ${expectedMode} layout at ${inlineSize}px of container space`, geometry, {
      measuredBoundary: Math.abs(geometry.inlineSize - inlineSize) <= 1,
      semanticMode: geometry.mode === expectedMode,
      panesVisible: geometry.catalogVisible && geometry.detailVisible,
      noHorizontalOverflow: geometry.overflow <= 2
    });
  }
  await win.webContents.executeJavaScript(`
    (() => {
      const host = document.querySelector('.settings-detail-inner');
      if (host instanceof HTMLElement) { host.style.removeProperty('width'); host.style.removeProperty('max-width'); }
    })()
  `);
  await exitSettings(win);

  await setCssViewportWidth(win, 1280, 720);
  await clickNav(win, "新建任务");
  await waitForReady(win, "新建任务", { minTextLength: 90, requiredSelector: ".ai-workbench" });
  const openedCompletedSessionForPreview = await win.webContents.executeJavaScript(`
    (() => {
      const button = [...document.querySelectorAll('.nav-recent-item')].find((item) => item.textContent.includes('长会话性能验证'));
      if (!(button instanceof HTMLButtonElement)) return false;
      button.click();
      return true;
    })()
  `);
  if (!openedCompletedSessionForPreview) throw new Error("AI preview session fixture was not found.");
  await waitForText(win, "打开验收报告");
  const openedFilePreview = await win.webContents.executeJavaScript(`
    (() => {
      const link = [...document.querySelectorAll('.local-file-link')].find((item) => item.textContent.includes('打开验收报告'));
      if (!(link instanceof HTMLElement)) return false;
      link.focus();
      link.click();
      return true;
    })()
  `);
  if (!openedFilePreview) throw new Error("AI local-file preview trigger was not found.");
  await waitForSelector(win, ".ai-file-preview");

  for (const [inlineSize, expectedMode] of [[979, "preview-only"], [980, "split"], [981, "split"]]) {
    await win.webContents.executeJavaScript(`
      (() => {
        const workbench = document.querySelector('.ai-workbench');
        if (!(workbench instanceof HTMLElement)) return false;
        workbench.style.width = '${inlineSize}px';
        return true;
      })()
    `);
    await settle();
    const geometry = await win.webContents.executeJavaScript(`
      (() => {
        const workbench = document.querySelector('.ai-workbench');
        const conversation = workbench?.querySelector(':scope > .conversation-pane');
        const splitter = workbench?.querySelector(':scope > .column-splitter');
        const preview = workbench?.querySelector(':scope > .ai-file-preview');
        return {
          viewport: { width: window.innerWidth, height: window.innerHeight },
          inlineSize: workbench?.getBoundingClientRect().width || 0,
          mode: workbench?.getAttribute('data-preview-layout'),
          conversationRendered: Boolean(conversation),
          splitterRendered: Boolean(splitter),
          previewRendered: Boolean(preview),
          closeFocused: document.activeElement?.getAttribute('data-action-id') === 'close',
          overflow: workbench instanceof HTMLElement ? workbench.scrollWidth - workbench.clientWidth : null
        };
      })()
    `);
    await recordContractState(win, report, `ai-file-preview-boundary-${inlineSize}`, "新建任务", `AI file preview owns its ${expectedMode} layout at ${inlineSize}px of container space`, geometry, {
      measuredBoundary: Math.abs(geometry.inlineSize - inlineSize) <= 1,
      semanticMode: geometry.mode === expectedMode,
      previewRendered: geometry.previewRendered,
      structureMatchesMode: expectedMode === "preview-only"
        ? !geometry.conversationRendered && !geometry.splitterRendered && geometry.closeFocused
        : geometry.conversationRendered && geometry.splitterRendered,
      noHorizontalOverflow: geometry.overflow <= 2
    });
  }

  await win.webContents.executeJavaScript(`document.querySelector('.ai-file-preview [data-action-id="close"]')?.click()`);
  await waitForSelectorRemoved(win, ".ai-file-preview");
  const previewCloseFocus = await win.webContents.executeJavaScript(`
    (() => ({
      previewRemoved: !document.querySelector('.ai-file-preview'),
      conversationFocused: document.activeElement?.classList.contains('conversation-pane') || false
    }))()
  `);
  await recordContractState(win, report, "ai-file-preview-focus-restore", "新建任务", "Closing preview-only mode restores focus to the conversation when its original trigger was replaced", previewCloseFocus, {
    previewRemoved: previewCloseFocus.previewRemoved,
    conversationFocused: previewCloseFocus.conversationFocused
  });
}

async function captureCoarsePointerRecentActions(win, report) {
  const debuggerApi = win.webContents.debugger;
  let attachedHere = false;
  try {
    if (!debuggerApi.isAttached()) {
      debuggerApi.attach("1.3");
      attachedHere = true;
    }
    await debuggerApi.sendCommand("Emulation.setEmulatedMedia", {
      media: "screen",
      features: [
        { name: "hover", value: "none" },
        { name: "pointer", value: "coarse" }
      ]
    });
    await debuggerApi.sendCommand("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
    await setCssViewportWidth(win, 1280, 720);
    await clickNav(win, "新建任务");
    await waitForReady(win, "新建任务", { minTextLength: 90, requiredSelector: ".ai-workbench" });
    await settle();
    const geometry = await win.webContents.executeJavaScript(`
      (() => {
        const row = document.querySelector('.app-nav .nav-recent-row');
        const actions = row?.querySelector('.nav-recent-actions');
        const buttons = actions ? [...actions.querySelectorAll('button')] : [];
        const actionStyle = actions instanceof Element ? getComputedStyle(actions) : null;
        const title = row?.querySelector('.nav-recent-item-title');
        const metadata = row?.querySelector('.nav-recent-item-meta');
        const titleBox = title?.getBoundingClientRect();
        const actionBox = actions?.getBoundingClientRect();
        const buttonRects = buttons.map((button) => {
          const box = button.getBoundingClientRect();
          return { width: box.width, height: box.height, label: button.getAttribute('aria-label') };
        });
        return {
          viewport: { width: window.innerWidth, height: window.innerHeight },
          coarsePointer: matchMedia('(pointer: coarse)').matches,
          noHover: matchMedia('(hover: none)').matches,
          rowVisible: row instanceof Element && row.getBoundingClientRect().height > 0,
          opacity: actionStyle?.opacity,
          pointerEvents: actionStyle?.pointerEvents,
          metadataHidden: metadata instanceof Element && getComputedStyle(metadata).visibility === 'hidden',
          titleBeforeActions: Boolean(titleBox && actionBox && titleBox.right <= actionBox.left),
          buttonRects
        };
      })()
    `);
    await recordContractState(win, report, "recent-actions-coarse-pointer", "新建任务", "Recent-session actions stay visible with named 44px targets for coarse pointers", geometry, {
      coarsePointerEmulated: geometry.coarsePointer && geometry.noHover,
      recentRowVisible: geometry.rowVisible,
      actionsVisible: geometry.opacity === "1" && geometry.pointerEvents === "auto",
      actionsPresent: geometry.buttonRects.length > 0,
      metadataHidden: geometry.metadataHidden,
      titleBeforeActions: geometry.titleBeforeActions,
      namedTargets: geometry.buttonRects.every((button) => Boolean(button.label)),
      targetSize: geometry.buttonRects.every((button) => button.width >= 44 && button.height >= 44)
    });
  } finally {
    if (debuggerApi.isAttached()) {
      await debuggerApi.sendCommand("Emulation.setTouchEmulationEnabled", { enabled: false, maxTouchPoints: 1 }).catch(() => {});
      await debuggerApi.sendCommand("Emulation.setEmulatedMedia", { media: "", features: [] }).catch(() => {});
      if (attachedHere) debuggerApi.detach();
    }
  }
}

async function clickSettingsSection(win, label) {
  const clicked = await win.webContents.executeJavaScript(`
    (() => {
      const button = [...document.querySelectorAll('.settings-nav-button')].find((item) => item.textContent.includes(${JSON.stringify(label)}));
      if (!(button instanceof HTMLButtonElement)) return false;
      button.click();
      return true;
    })()
  `);
  if (!clicked) throw new Error(`Settings section not found: ${label}`);
  await settle();
}

async function recordContractState(win, report, id, label, description, geometry, checks) {
  const ok = Object.values(checks).every(Boolean);
  const file = path.join(outputRoot, `state-${id}.png`);
  const image = await win.webContents.capturePage();
  fs.writeFileSync(file, image.toPNG());
  const item = {
    id,
    label,
    description,
    file: path.relative(appRoot, file),
    width: geometry.viewport?.width,
    height: geometry.viewport?.height,
    zoom: win.webContents.getZoomFactor(),
    ok,
    reason: ok ? null : `responsive contract failed: ${Object.entries(checks).filter(([, passed]) => !passed).map(([name]) => name).join(', ')}`,
    checks,
    geometry
  };
  report.stateSnapshots.push(item);
  if (!ok) report.failures.push(item);
  return item;
}

async function auditTabFocusReachability(win, ownerSelector) {
  const initialized = await win.webContents.executeJavaScript(`
    (() => {
      const owner = document.querySelector(${JSON.stringify(ownerSelector)});
      const focusable = owner ? [...owner.querySelectorAll('button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]')].filter((element) => element.tabIndex >= 0 && getComputedStyle(element).display !== 'none' && getComputedStyle(element).visibility !== 'hidden') : [];
      focusable[0]?.focus();
      return focusable.length;
    })()
  `);
  const states = [];
  let exitedOwner = false;
  for (let index = 0; index <= initialized; index++) {
    const state = await win.webContents.executeJavaScript(`
      (() => {
        const owner = document.querySelector(${JSON.stringify(ownerSelector)});
        const active = document.activeElement;
        if (!(owner instanceof Element) || !(active instanceof HTMLElement) || !owner.contains(active)) return { inside: false, reachable: false, label: active?.getAttribute?.('aria-label') || active?.textContent?.trim()?.slice(0, 40) || '' };
        const box = active.getBoundingClientRect();
        const ownerBox = owner.getBoundingClientRect();
        return {
          inside: true,
          reachable: box.width > 0 && box.height > 0 && box.bottom > ownerBox.top + 1 && box.top < ownerBox.bottom - 1,
          label: active.getAttribute('aria-label') || active.textContent?.trim()?.slice(0, 40) || active.tagName
        };
      })()
    `);
    if (!state.inside) {
      exitedOwner = true;
      break;
    }
    states.push(state);
    win.webContents.sendInputEvent({ type: "keyDown", keyCode: "Tab" });
    win.webContents.sendInputEvent({ type: "keyUp", keyCode: "Tab" });
    await delay(40);
  }
  return {
    expected: initialized,
    visited: states.length,
    exitedOwner,
    allReachable: states.length > 0 && states.every((state) => state.reachable),
    states
  };
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
  const expectedSettingsMode = options.settingsMode === true;
  const minTextLength = options.minTextLength ?? (expectedSettingsMode ? 60 : 200);
  const requiredSelector = options.requiredSelector || "body";
  const expectedCompanionSelector = options.expectedCompanionSelector || null;
  let lastState = null;
  for (let attempt = 0; attempt < 100; attempt++) {
    const state = await win.webContents.executeJavaScript(`
      (() => {
        const visible = (element) => {
          if (!(element instanceof Element)) return false;
          const rect = element.getBoundingClientRect();
          if (rect.width <= 0 || rect.height <= 0 || rect.right <= 0 || rect.bottom <= 0 || rect.left >= window.innerWidth || rect.top >= window.innerHeight) return false;
          for (let current = element; current instanceof Element; current = current.parentElement) {
            const style = getComputedStyle(current);
            if (style.display === 'none' || style.visibility === 'hidden' || current.hasAttribute('inert') || current.getAttribute('aria-hidden') === 'true') return false;
          }
          return true;
        };
        const unobscured = (element) => {
          if (!(element instanceof Element)) return false;
          const rect = element.getBoundingClientRect();
          const x = Math.min(window.innerWidth - 1, Math.max(0, rect.left + rect.width / 2));
          const y = Math.min(window.innerHeight - 1, Math.max(0, rect.top + rect.height / 2));
          const hit = document.elementFromPoint(x, y);
          return Boolean(hit && element.contains(hit));
        };
        const active = document.querySelector('nav button[aria-current="page"]')?.getAttribute('aria-label') || "";
        const activeSession = Boolean(document.querySelector('.nav-recent-item[aria-current="true"]'));
        const aiPage = Boolean(document.querySelector('.app-shell.ai-page'));
        const loading = Boolean(document.querySelector('.splash,.route-loading,.settings-page .settings-load-state[role="status"]'));
        const fatal = document.querySelector('.fatal')?.textContent || "";
        const textLength = (document.body?.innerText || "").trim().length;
        const semanticTarget = document.querySelector(${JSON.stringify(requiredSelector)});
        const expectedCompanion = ${JSON.stringify(expectedCompanionSelector)} ? document.querySelector(${JSON.stringify(expectedCompanionSelector)}) : null;
        const semanticTargetReady = visible(semanticTarget) && unobscured(semanticTarget);
        const expectedCompanionReady = visible(expectedCompanion) && unobscured(expectedCompanion);
        const semanticReady = semanticTargetReady || expectedCompanionReady;
        const semanticRect = semanticTarget instanceof Element ? semanticTarget.getBoundingClientRect() : null;
        const semanticHit = semanticRect ? document.elementFromPoint(
          Math.min(window.innerWidth - 1, Math.max(0, semanticRect.left + semanticRect.width / 2)),
          Math.min(window.innerHeight - 1, Math.max(0, semanticRect.top + semanticRect.height / 2))
        ) : null;
        const semanticDebug = semanticTarget instanceof Element ? {
          rect: semanticRect ? { left: semanticRect.left, top: semanticRect.top, right: semanticRect.right, bottom: semanticRect.bottom, width: semanticRect.width, height: semanticRect.height } : null,
          hit: semanticHit ? semanticHit.tagName + '.' + String(semanticHit.className || '').replace(/\s+/g, '.') : null,
          hitInside: Boolean(semanticHit && semanticTarget.contains(semanticHit)),
          blockedAncestor: [...function* () { for (let current = semanticTarget; current instanceof Element; current = current.parentElement) { const style = getComputedStyle(current); if (style.display === 'none' || style.visibility === 'hidden' || current.hasAttribute('inert') || current.getAttribute('aria-hidden') === 'true') yield current.tagName + '.' + String(current.className || '').replace(/\s+/g, '.'); } }()]
        } : null;
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
          semanticTargetReady,
          expectedCompanionReady,
          semanticDebug,
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
  const expectedSettingsMode = options.settingsMode === true;
  const minTextLength = options.minTextLength ?? (expectedSettingsMode ? 60 : 200);
  const requiredSelector = options.requiredSelector || "body";
  const expectedCompanionSelector = options.expectedCompanionSelector || null;
  const expectError = options.expectError === true;
  return win.webContents.executeJavaScript(`
    (() => {
      const root = document.documentElement;
      const body = document.body;
      const text = (body.innerText || "").replace(/\\s+/g, " ").trim();
      const horizontalOverflow = Math.max(root.scrollWidth - root.clientWidth, body.scrollWidth - body.clientWidth);
      const visible = (element) => {
        if (!(element instanceof Element)) return false;
        const rect = element.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0 || rect.right <= 0 || rect.bottom <= 0 || rect.left >= window.innerWidth || rect.top >= window.innerHeight) return false;
        for (let current = element; current instanceof Element; current = current.parentElement) {
          const style = getComputedStyle(current);
          if (style.display === 'none' || style.visibility === 'hidden' || current.hasAttribute('inert') || current.getAttribute('aria-hidden') === 'true') return false;
        }
        return true;
      };
      const unobscured = (element) => {
        if (!(element instanceof Element)) return false;
        const rect = element.getBoundingClientRect();
        const x = Math.min(window.innerWidth - 1, Math.max(0, rect.left + rect.width / 2));
        const y = Math.min(window.innerHeight - 1, Math.max(0, rect.top + rect.height / 2));
        const hit = document.elementFromPoint(x, y);
        return Boolean(hit && element.contains(hit));
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
      const semanticTarget = document.querySelector(${JSON.stringify(requiredSelector)});
      const expectedCompanion = ${JSON.stringify(expectedCompanionSelector)} ? document.querySelector(${JSON.stringify(expectedCompanionSelector)}) : null;
      const semanticTargetReady = visible(semanticTarget) && unobscured(semanticTarget);
      const expectedCompanionReady = visible(expectedCompanion) && unobscured(expectedCompanion);
      const semanticReady = semanticTargetReady || expectedCompanionReady;
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
        : expectedCompanionReady || root.clientWidth > 840 || visible(document.querySelector('.responsive-nav-toggle'));
      const unexpectedError = [...document.querySelectorAll('.ui-error-state')].find(visible)?.textContent?.replace(/\\s+/g, ' ').trim() || null;
      const errorStateMatches = ${expectError} ? Boolean(unexpectedError) : !unexpectedError;
      const criticalContextMissing = [];
      if (document.querySelector('.conversation-header .provider-segmented')) {
        [
          ['provider', '.conversation-header .provider-name'],
          ['permission', '.conversation-header .provider-perm'],
          ['project', '.conversation-header small']
        ].forEach(([name, selector]) => {
          if (!visible(document.querySelector(selector))) criticalContextMissing.push(name);
        });
        const statusBadge = document.querySelector('.conversation-header .ui-responsive-context');
        if (${options.expectIdleSession === true} ? Boolean(statusBadge) : !visible(statusBadge)) {
          criticalContextMissing.push(${options.expectIdleSession === true} ? 'idle-session-status-should-be-absent' : 'session-status');
        }
      }
      // Compact composer toolbars intentionally hide the text label while
      // keeping the project control visible and titled. Audit the control
      // itself so responsive label compression is not treated as lost context.
      const composerWorkspace = document.querySelector('.composer-workspace');
      if (composerWorkspace && !visible(composerWorkspace)) {
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
      const briefPage = document.querySelector('.brief-library-page');
      const briefListRect = briefPage?.querySelector('.document-library-list')?.getBoundingClientRect();
      const briefDetailRect = briefPage?.querySelector('.document-library-detail')?.getBoundingClientRect();
      const briefMasterDetailGeometry = briefPage ? {
        list: rect(briefPage.querySelector('.document-library-list')),
        detail: rect(briefPage.querySelector('.document-library-detail')),
        sideBySide: Boolean(
          briefListRect
          && briefDetailRect
          && briefListRect.width > 0
          && briefDetailRect.width > 0
          && Math.abs(briefListRect.top - briefDetailRect.top) <= 2
          && briefListRect.right <= briefDetailRect.left + 2
        )
      } : null;
      const briefMasterDetailValid = !briefMasterDetailGeometry || briefMasterDetailGeometry.sideBySide;
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
        && briefMasterDetailValid
        && undersizedResponsiveTargets.length === 0
        && horizontalOverflow <= 2;
      return {
        ok,
        reason: ok ? null : \`text=\${text.length}, semantic=\${semanticReady}, settingsMode=\${settingsMode}/expected:${expectedSettingsMode}, settingsNav=\${settingsNavigationVisible}, settingsActive=\${settingsActiveVisible}, settingsScrollTop=\${settingsDetail instanceof HTMLElement ? settingsDetail.scrollTop : 'missing'}, settingsSelectFocused=\${settingsSelectFocused}, settingsChromeIsolated=\${settingsChromeIsolated}, nav=\${navVisible}, active=\${activeVisible}, drawerToggle=\${drawerToggleVisible}, error=\${unexpectedError || 'none'}, errorExpected=${expectError}, context=\${criticalContextMissing.join(',') || 'complete'}, titleOccluded=\${conversationTitleOccluded}, briefSideBySide=\${briefMasterDetailValid}, targets=\${undersizedResponsiveTargets.length}, overflow=\${horizontalOverflow}\`,
        textLength: text.length,
        semanticReady,
        semanticTargetReady,
        expectedCompanionReady,
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
        ,briefMasterDetailGeometry
      };
    })()
  `);
}

async function captureDarkDailyBrief(win, report) {
  await win.webContents.executeJavaScript("window.openmind.__setVisualMode('normal')");
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
  await win.webContents.executeJavaScript("window.openmind.__setVisualMode('normal')");
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
      const allow = document.querySelector('.approval-banner .approval-bar-actions [data-ui-control="button"][data-tone="neutral"]');
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

  await setComposerValue(win, Array.from({ length: 30 }, (_, index) => `${index + 1}\n00:00:21,500 --> 00:00:23,500\n这是一段用于验证滚动边界的字幕文本。`).join("\n\n"));
  await settle();
  const draftGeometry = await win.webContents.executeJavaScript(`(() => {
    const textarea = document.querySelector('.composer-editor textarea');
    const actions = document.querySelector('.composer-editor-actions');
    const send = actions?.querySelector('.composer-send');
    textarea.scrollTop = textarea.scrollHeight;
    const textBox = textarea.getBoundingClientRect();
    const actionBox = actions.getBoundingClientRect();
    const sendBox = send.getBoundingClientRect();
    const hit = document.elementFromPoint(sendBox.left + sendBox.width / 2, sendBox.top + sendBox.height / 2);
    return {
      scrollable: textarea.scrollHeight > textarea.clientHeight,
      textBottom: textBox.bottom,
      toolbarTop: actionBox.top,
      toolbarVisible: actionBox.top >= 0 && actionBox.bottom <= innerHeight,
      sendHitTestable: hit === send || send.contains(hit)
    };
  })()`);
  await recordContractState(win, report, "ai-long-draft-toolbar", "新建任务", "Long drafts scroll above the toolbar without covering its controls", draftGeometry, {
    draftScrollable: draftGeometry.scrollable,
    textBeforeToolbar: draftGeometry.textBottom <= draftGeometry.toolbarTop + 1,
    toolbarVisible: draftGeometry.toolbarVisible,
    sendHitTestable: draftGeometry.sendHitTestable
  });
  await setComposerValue(win, "");

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
  const contextPopoverOpened = await win.webContents.executeJavaScript(`
    (() => {
      const chips = document.querySelector('.context-tray .context-chips');
      if (!(chips instanceof HTMLElement)) return false;
      chips.scrollLeft = chips.scrollWidth;
      chips.dispatchEvent(new Event('scroll'));
      const triggers = [...chips.querySelectorAll('.context-chip > .ui-disclosure-trigger')];
      const trigger = triggers.at(-1);
      if (!(trigger instanceof HTMLButtonElement)) return false;
      trigger.click();
      return true;
    })()
  `);
  if (!contextPopoverOpened) throw new Error("Right-edge context detail fixture was not reachable.");
  await waitForSelector(win, ".context-chip-popover");
  const contextPopoverGeometry = await win.webContents.executeJavaScript(`
    (() => {
      const popover = document.querySelector('.context-chip-popover');
      const box = popover?.getBoundingClientRect();
      return {
        viewport: { width: window.innerWidth, height: window.innerHeight },
        popover: box ? { top: box.top, right: box.right, bottom: box.bottom, left: box.left, width: box.width, height: box.height } : null,
        portaled: popover?.parentElement === document.body,
        insideViewport: Boolean(box && box.left >= 7 && box.top >= 7 && box.right <= window.innerWidth - 7 && box.bottom <= window.innerHeight - 7)
      };
    })()
  `);
  await recordContractState(win, report, "ai-context-detail-right-edge", pages[0].label, "Right-most context detail is portaled and clamped inside the viewport", contextPopoverGeometry, {
    portaled: contextPopoverGeometry.portaled,
    insideViewport: contextPopoverGeometry.insideViewport
  });
  await win.webContents.executeJavaScript("window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))");
  await waitForSelectorToDisappear(win, ".context-chip-popover");
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

  await setComposerValue(win, " \n \n/");
  await waitForText(win, "选择要运行的真实工作流");
  await waitForSelector(win, ".composer-suggestion-popover");
  const caretMenuGeometry = await win.webContents.executeJavaScript(`
    (() => {
      const textarea = document.querySelector('textarea[aria-label="AI 消息"]');
      const anchor = document.querySelector('.composer-suggestion-caret-anchor');
      const popover = document.querySelector('.composer-suggestion-popover');
      const menu = popover?.querySelector('.composer-suggestion-menu');
      const rect = (element) => element instanceof Element ? Object.fromEntries(['top','right','bottom','left','width','height'].map((key) => [key, Math.round(element.getBoundingClientRect()[key] * 10) / 10])) : null;
      const textareaBox = rect(textarea);
      const anchorBox = rect(anchor);
      const popoverBox = rect(popover);
      return {
        viewport: { width: window.innerWidth, height: window.innerHeight },
        textarea: textareaBox,
        anchor: anchorBox,
        popover: popoverBox,
        side: popover?.getAttribute('data-side'),
        portaled: popover?.parentElement === document.body,
        menuWidth: menu?.getBoundingClientRect().width || 0,
        insideViewport: Boolean(popoverBox && popoverBox.left >= 7 && popoverBox.top >= 7 && popoverBox.right <= window.innerWidth - 7 && popoverBox.bottom <= window.innerHeight - 7)
      };
    })()
  `);
  await recordContractState(win, report, "ai-skill-menu-caret", "新建任务", "Slash suggestions follow the caret on a later textarea line and remain portaled inside the viewport", caretMenuGeometry, {
    anchorInsideTextarea: Boolean(caretMenuGeometry.anchor && caretMenuGeometry.textarea && caretMenuGeometry.anchor.left >= caretMenuGeometry.textarea.left && caretMenuGeometry.anchor.right <= caretMenuGeometry.textarea.right && caretMenuGeometry.anchor.top > caretMenuGeometry.textarea.top + 20 && caretMenuGeometry.anchor.bottom <= caretMenuGeometry.textarea.bottom + 1),
    menuAboveCaret: caretMenuGeometry.side === "top" && Boolean(caretMenuGeometry.popover && caretMenuGeometry.anchor && caretMenuGeometry.popover.bottom <= caretMenuGeometry.anchor.top),
    widthTracksEditor: Boolean(caretMenuGeometry.textarea && Math.abs(caretMenuGeometry.menuWidth - caretMenuGeometry.textarea.width) <= 2),
    portaled: caretMenuGeometry.portaled,
    insideViewport: caretMenuGeometry.insideViewport
  });
  await captureState(win, report, "ai-skill-menu", "新建任务", "Registered skill suggestion menu follows the active textarea caret");

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
      const drag = chips?.querySelector(':scope > [data-context-motion] > .context-chip-drag');
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
        overflowAffordance: overflow(chips) <= 2
          ? (!css.chips.maskImage || css.chips.maskImage === 'none')
          : Boolean((css.chips.maskImage && css.chips.maskImage !== 'none') || (css.chips.webkitMaskImage && css.chips.webkitMaskImage !== 'none')),
        noNestedDoubleFrame: borderLayers <= 1 && !bordered(trigger),
        noPageOverflow: document.documentElement.scrollWidth - window.innerWidth <= 2,
        noFlowOverflow: overflow(flow) <= 2,
        noTrayOverflow: overflow(tray) <= 2,
        chipsScrollableWhenNeeded: overflow(chips) <= 2 || ['auto', 'scroll'].includes(css.chips.overflowX),
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
      const allow = banner?.querySelector('.approval-bar-actions [data-ui-control="button"][data-tone="neutral"]');
      const decline = banner?.querySelector('.approval-bar-actions [data-ui-control="button"][data-tone="danger"]');
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
  await win.webContents.executeJavaScript("window.openmind.__setVisualMode('normal')");
  await clickNav(win, "新建任务");
  await waitForReady(win, "新建任务");
  await ensureExpandedNavigation(win);
  await win.webContents.executeJavaScript(`
    (() => {
      const recent = document.querySelector('.app-nav .nav-recent-toggle');
      if (recent?.getAttribute('aria-expanded') === 'false') recent.click();
      const list = document.querySelector('.app-nav .nav-recent-list');
      if (list) list.scrollTop = 0;
    })()
  `);
  await waitForSelector(win, '.app-nav button.nav-recent-item');
  const clicked = await win.webContents.executeJavaScript(`
    (() => {
      const session = [...document.querySelectorAll('.app-nav button.nav-recent-item')]
        .find(item => item.textContent.includes('10000 events'));
      if (!(session instanceof HTMLButtonElement)) return false;
      session.scrollIntoView({ block: 'nearest' });
      const rect = session.getBoundingClientRect();
      const target = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
      if (!target || !session.contains(target)) return false;
      session.click();
      return true;
    })()
  `);
  if (!clicked) throw new Error('Completed AI response fixture was not reachable in the visible recent-task list.');
  await waitForSelectorExists(win, '.completed-process');
  await waitForText(win, '规模验证通过：1000 sessions');
  await waitForVisualStability(win);
  await scrollDisclosureTriggerIntoView(win, '.completed-process');
  await waitForDisclosureState(win, '.completed-process', false);
  await waitForSelectorRemoved(win, '.completed-process-body');
  const completedSnapshot = await captureState(win, report, 'ai-completed-response', '新建任务', 'Completed response with its process body unmounted', { expectIdleSession: true });

  // Completed traces expose flat tool summaries directly. Opening the process
  // must not add another group disclosure or expand individual result bodies.
  await expandDisclosure(win, '.completed-process');
  const compactToolGeometry = await win.webContents.executeJavaScript(`
    (() => {
      const process = document.querySelector('.completed-process-body');
      const groups = [...(process?.querySelectorAll('.command-group.flat') || [])];
      const lists = groups.map(group => group.querySelector('.command-group-list'));
      const rows = [...(process?.querySelectorAll('.tool-event') || [])];
      const heights = rows.map(row => row.querySelector(':scope > .ui-disclosure-trigger')?.getBoundingClientRect().height || 0);
      const checks = {
        flatHistory: groups.length === 2 && groups.every(group => !group.querySelector(':scope > .ui-disclosure-trigger')),
        completeHistory: rows.length === 12 && lists[0]?.querySelectorAll('.tool-event').length === 10,
        collapsedResults: rows.every(row => !row.hasAttribute('data-open') && !row.querySelector('.tool-event-body')),
        compactRows: heights.every(height => height >= 24 && height <= 40),
        namedLongList: lists[0]?.getAttribute('role') === 'region' && lists[0]?.tabIndex === 0 && Boolean(lists[0]?.getAttribute('aria-label')),
        rowIcons: rows.every(row => { const icon = row.querySelector('.tool-event-icon'); return icon && getComputedStyle(icon).display !== 'none'; }),
        flowLayout: lists.every(list => list && getComputedStyle(list).maxHeight === 'none' && getComputedStyle(list).overflowY === 'visible'),
        noHorizontalOverflow: Boolean(process) && [process, ...lists].every(element => element && element.scrollWidth <= element.clientWidth + 1)
      };
      return { ok: Object.values(checks).every(Boolean), checks, rowHeights: heights, rowCount: rows.length };
    })()
  `);
  if (!compactToolGeometry.ok) throw new Error('Flat process geometry failed: ' + JSON.stringify(compactToolGeometry));
  const processSnapshot = await captureState(win, report, 'ai-process-expanded', '新建任务', 'Expanded process exposes compact flat tool summaries', { expectIdleSession: true });
  processSnapshot.toolGeometry = compactToolGeometry;

  const toolSelector = '.completed-process .command-group.flat .tool-event';
  await expandDisclosure(win, toolSelector, 1);
  const terminalSelector = '.completed-process .tool-event[data-open] .command-terminal';
  await scrollSelectorIntoView(win, terminalSelector);
  await waitForSelector(win, terminalSelector);
  const expandedToolGeometry = await win.webContents.executeJavaScript(`
    (() => {
      const process = document.querySelector('.completed-process-body');
      const rows = [...(process?.querySelectorAll('.tool-event') || [])];
      const opened = rows.filter(row => row.hasAttribute('data-open'));
      const terminal = opened[0]?.querySelector('.command-terminal');
      const rowBox = opened[0]?.getBoundingClientRect();
      const terminalBox = terminal?.getBoundingClientRect();
      const checks = {
        oneResultOpen: opened.length === 1 && rows.length === 12,
        otherResultsUnmounted: rows.filter(row => !row.hasAttribute('data-open')).every(row => !row.querySelector('.tool-event-body')),
        terminalInRow: Boolean(rowBox && terminalBox && terminalBox.width > 0 && terminalBox.height > 0 && terminalBox.left >= rowBox.left - 1 && terminalBox.right <= rowBox.right + 1),
        noHorizontalOverflow: Boolean(process && terminal) && process.scrollWidth <= process.clientWidth + 1 && terminal.scrollWidth <= terminal.clientWidth + 1,
        pageNoHorizontalOverflow: document.documentElement.scrollWidth <= window.innerWidth + 2
      };
      return { ok: Object.values(checks).every(Boolean), checks, rowCount: rows.length, openedCount: opened.length, terminalHeight: terminalBox?.height };
    })()
  `);
  if (!expandedToolGeometry.ok) throw new Error('Expanded tool result geometry failed: ' + JSON.stringify(expandedToolGeometry));
  const expandedToolSnapshot = await captureState(win, report, 'ai-tool-result-expanded', '新建任务', 'A single tool result expands in place while sibling results remain unmounted', { expectIdleSession: true });
  expandedToolSnapshot.toolGeometry = expandedToolGeometry;
  assertDistinctPixelSnapshots([completedSnapshot, processSnapshot, expandedToolSnapshot]);
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
  const viewport = await win.webContents.executeJavaScript("({ width: window.innerWidth, height: window.innerHeight })");
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
    width: viewport.width,
    height: viewport.height,
    zoom: win.webContents.getZoomFactor(),
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
    if (found) {
      await waitForVisualStability(win);
      return;
    }
    await delay(80);
  }
  throw new Error(`Timed out waiting for visible selector: ${selector}`);
}

async function waitForVisualStability(win) {
  await win.webContents.executeJavaScript(`(async () => {
    const frame = () => new Promise(resolve => requestAnimationFrame(resolve));
    await frame(); await frame();
    await Promise.allSettled(document.getAnimations()
      .filter(animation => animation.playState === 'running' && animation.effect?.getComputedTiming().iterations !== Infinity)
      .map(animation => animation.finished));
    await frame(); await frame();
  })()`);
}

async function waitForSelectorExists(win, selector) {
  for (let attempt = 0; attempt < 80; attempt++) {
    const found = await win.webContents.executeJavaScript(`Boolean(document.querySelector(${JSON.stringify(selector)}))`);
    if (found) return;
    await delay(80);
  }
  throw new Error(`Timed out waiting for selector: ${selector}`);
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

async function waitForSelectorRemoved(win, selector) {
  for (let attempt = 0; attempt < 80; attempt++) {
    const present = await win.webContents.executeJavaScript(`Boolean(document.querySelector(${JSON.stringify(selector)}))`);
    if (!present) return;
    await delay(80);
  }
  throw new Error(`Timed out waiting for selector removal: ${selector}`);
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
  // Opening a tall disclosure can trigger scroll anchoring and move the
  // trigger above the viewport while the height transition is running. Let
  // the shared motion budget settle, then re-center it before checking the
  // post-click interactive state.
  await delay(420);
  await scrollDisclosureTriggerIntoView(win, rootSelector, index);
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

async function setCssViewportWidth(win, desiredWidth, height) {
  const currentInnerWidth = Number(await win.webContents.executeJavaScript("window.innerWidth"));
  const [currentNativeWidth] = win.getSize();
  // Account for the platform's window frame before resizing. Starting from the
  // raw CSS target can briefly cross a responsive breakpoint and dismiss open
  // popovers even though the final width keeps their anchor visible.
  let nativeWidth = currentNativeWidth + desiredWidth - currentInnerWidth;
  for (let attempt = 0; attempt < 4; attempt++) {
    win.setSize(nativeWidth, height);
    await settle();
    const actualWidth = await win.webContents.executeJavaScript("window.innerWidth");
    const delta = desiredWidth - Number(actualWidth);
    // One CSS pixel changes the 840/841 and 1480/1481 semantic states, so
    // boundary contracts need a tighter tolerance than ordinary geometry.
    if (Math.abs(delta) <= 0.25) return;
    nativeWidth += delta;
  }
  throw new Error(`Unable to reach CSS viewport width ${desiredWidth}.`);
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
