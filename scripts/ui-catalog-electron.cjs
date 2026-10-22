const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const assert = require("node:assert/strict");
const { app, BrowserWindow } = require("electron");
const { comparePng } = require("./ui-contract/visual-compare.cjs");
const scenarios = require("./fixtures/ui-catalog/scenarios.json");
const selectScenarios = new Set(["select-menu", "select-rect-open", "select-quiet-permission"]);
const modelScenarios = new Set(["composer-model-menu", "composer-model-submenu"]);

const root = path.resolve(__dirname, "..");
const output = path.join(root, ".tmp/ui-regression");
const baselines = path.join(root, "scripts/fixtures/ui-catalog/baselines", `${process.platform}-${process.arch}`);
const preview = process.argv.includes("--preview");
const update = process.argv.includes("--update");
const performanceOnly = process.argv.includes("--performance-only");
const reportPath = path.join(output, performanceOnly ? "performance.json" : "report.json");
const userData = process.env.OPENMIND_UI_CATALOG_USER_DATA_DIR;
if (!userData || !path.isAbsolute(userData)) throw new Error("Run the UI catalog through node scripts/ui-catalog.js to provide an isolated profile.");
app.setPath("userData", userData);
app.setPath("sessionData", userData);
app.commandLine.appendSwitch("force-device-scale-factor", "1");
app.commandLine.appendSwitch("disable-gpu");
app.commandLine.appendSwitch("lang", "en-US");
app.commandLine.appendSwitch("force-prefers-reduced-motion", "reduce");
let win;
const report = { environment: null, snapshots: [], geometry: [], failures: [], performance: null };
const errors = [];

function sha(file) { return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex"); }
function environment() {
  return { platform: process.platform, arch: process.arch, electron: process.versions.electron, chrome: process.versions.chrome, scale: 1, reducedMotion: true,
    fonts: ["pdfjs-dist/standard_fonts/LiberationSans-Regular.ttf", "pdfjs-dist/standard_fonts/LiberationSans-Bold.ttf", "@fontsource/jetbrains-mono/files/jetbrains-mono-latin-400-normal.woff2"].map(file => ({ file, sha256: sha(path.join(root, "node_modules", file)) })) };
}

app.whenReady().then(async () => {
  if (update && process.env.CI) throw new Error("CI cannot update visual baselines. Review baseline changes locally.");
  // A full comparison owns its evidence directory. Preview/performance runs must
  // preserve the last visual report and its actual/expected/difference images.
  if (!preview && !performanceOnly) fs.rmSync(output, { recursive: true, force: true });
  fs.mkdirSync(output, { recursive: true });
  report.environment = environment();
  const manifestPath = path.join(baselines, "manifest.json");
  if (!preview && !update && !performanceOnly) {
    if (!fs.existsSync(manifestPath)) throw new Error(`No reviewed UI baseline for ${process.platform}-${process.arch}. Create and inspect it with npm run visual:ui -- --update.`);
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    assert.deepEqual(report.environment, manifest.environment, "UI rendering environment changed; review fresh baselines with the pinned runtime/fonts.");
    const expectedNames = ["light", "dark"].flatMap(theme => [720, 1280].flatMap(width => scenarios.map(scenario => `${theme}-${width}-${scenario.id}.png`)));
    assert.ok(Array.isArray(manifest.snapshots), "Reviewed baseline manifest is missing its snapshot list.");
    assert.deepEqual(manifest.snapshots.map(item => item.name), expectedNames, "UI catalog scenarios changed; review the complete baseline set.");
    for (const item of manifest.snapshots) {
      const baselinePath = path.join(baselines, item.name);
      assert.ok(fs.existsSync(baselinePath), `${item.name}: missing reviewed baseline`);
      assert.equal(sha(baselinePath), item.sha256, `${item.name}: baseline PNG does not match the reviewed manifest; update and review them together.`);
    }
  } else if (update) fs.mkdirSync(baselines, { recursive: true });
  win = new BrowserWindow({ width: 1280, height: 1040, show: true, backgroundColor: "#ffffff",
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } });
  win.webContents.on("console-message", event => { if (event.level >= 3) errors.push(event.message); });
  win.webContents.on("render-process-gone", (_event, details) => errors.push(`Renderer exited: ${JSON.stringify(details)}`));
  if (preview) { await load("actions", "light"); win.on("closed", () => app.quit()); return; }
  for (const theme of performanceOnly ? [] : ["light", "dark"]) for (const width of [720, 1280]) for (const scenario of scenarios) {
    const name = `${theme}-${width}-${scenario.id}.png`;
    win.setSize(width, scenario.height);
    await load(scenario.id, theme);
    if (selectScenarios.has(scenario.id)) {
      await click('.ui-select-trigger');
      await waitForSelector('.ui-select-menu [role="option"]');
    }
    if (modelScenarios.has(scenario.id)) {
      await click('.composer-model-picker .ui-select-trigger');
      await waitForSelector('.composer-model-menu [data-provider="catalog-images"]');
      await settled();
      if (scenario.id === "composer-model-submenu") {
        await click('.composer-model-menu [data-provider="catalog-images"]');
        await waitForSelector('.composer-image-submenu [role="menuitemradio"]');
      }
    }
    if (scenario.id === "action-menu") await click('.ui-dropdown-trigger');
    if (scenario.id === "popover") await click('.project-icon-picker-trigger');
    // Remove transient hover from the trigger without changing keyboard focus.
    win.webContents.sendInputEvent({ type: "mouseMove", x: 0, y: 0 });
    await settled();
    const contract = await inspect(scenario.id);
    assert.ok(contract.overflow <= 1, `${name}: horizontal overflow ${contract.overflow}px`);
    assert.ok(contract.controlCount > 0, `${name}: no production UI controls rendered`);
    if (scenario.id === "form-dialog" || scenario.id === "confirm-dialog" || scenario.id === "search-dialog") assert.equal(contract.dialogs, 1, `${name}: modal shell is missing`);
    if (selectScenarios.has(scenario.id) || scenario.id === "action-menu") assert.equal(contract.menus, 1, `${name}: expected an open choice/action menu`);
    if (selectScenarios.has(scenario.id)) {
      assert.equal(contract.choice.expanded, true, `${name}: choice trigger did not open`);
      assert.equal(contract.choice.shape, scenario.id === "select-rect-open" ? "rect" : "pill", `${name}: choice shape is wrong`);
      assert.equal(contract.choice.variant, scenario.id === "select-quiet-permission" ? "quiet" : "default", `${name}: choice variant is wrong`);
      assert.equal(contract.choice.options, 3, `${name}: choice options are missing`);
      assert.equal(contract.choice.selectedOptions, 1, `${name}: current choice is not indicated`);
      assert.equal(contract.choice.disabledOptions, scenario.id === "select-quiet-permission" ? 0 : 1, `${name}: disabled choice is wrong`);
      if (scenario.id === "select-quiet-permission") {
        assert.equal(contract.choice.tone, "warning", `${name}: automatic permission lost its warning tone`);
        assert.equal(contract.choice.warningOptions, 1, `${name}: automatic permission option lost its warning tone`);
      }
    }
    if (modelScenarios.has(scenario.id)) {
      const nested = scenario.id === "composer-model-submenu";
      assert.equal(contract.menus, nested ? 2 : 1, `${name}: grouped model menu is missing`);
      assert.equal(contract.choice.expanded, true, `${name}: model trigger did not open`);
      assert.equal(contract.choice.shape, "rect", `${name}: model trigger shape is wrong`);
      assert.equal(contract.choice.variant, "quiet", `${name}: model trigger variant is wrong`);
      assert.equal(contract.models.agents, 2, `${name}: synthetic agent choices are missing`);
      assert.equal(contract.models.providers, 2, `${name}: synthetic image providers are missing`);
      assert.equal(contract.models.selectedAgents, 1, `${name}: selected agent is missing`);
      assert.equal(contract.models.groupedSurfaces, nested ? 2 : 1, `${name}: grouped surface variant is missing`);
      assert.equal(contract.models.expandedProviders, nested ? 1 : 0, `${name}: provider submenu state is wrong`);
      assert.equal(contract.models.detailOptions, nested ? 3 : 0, `${name}: image model choices are missing`);
      assert.equal(contract.models.selectedModels, nested ? 1 : 0, `${name}: selected image model is missing`);
    }
    if (selectScenarios.has(scenario.id) || modelScenarios.has(scenario.id)) {
      assert.equal(contract.choiceSurfacesContained, true, `${name}: choice surface is clipped or has horizontal overflow`);
    }
    if (scenario.id === "popover") assert.equal(contract.dialogs, 2, `${name}: nested icon chooser is missing`);
    const image = await win.webContents.capturePage();
    const actualPath = path.join(output, name), baselinePath = path.join(baselines, name);
    fs.writeFileSync(actualPath, image.toPNG());
    const item = { name, ...contract, differentPixels: 0, allowedPixels: 0 };
    if (update) fs.copyFileSync(actualPath, baselinePath);
    else if (!fs.existsSync(baselinePath)) report.failures.push(`${name}: missing reviewed baseline`);
    else {
      const comparison = await comparePng(fs.readFileSync(actualPath), fs.readFileSync(baselinePath));
      item.differentPixels = comparison.differentPixels;
      item.allowedPixels = comparison.allowedPixels;
      if (!comparison.matched) {
        fs.copyFileSync(baselinePath, path.join(output, name.replace('.png', '-expected.png')));
        if (comparison.difference) fs.writeFileSync(path.join(output, name.replace('.png', '-diff.png')), comparison.difference);
        report.failures.push(`${name}: ${comparison.reason}`);
      }
    }
    report.snapshots.push(item);
    process.stdout.write(`UI ${update ? "baseline" : "comparison"}: ${name}\n`);
  }
  for (const theme of performanceOnly ? [] : ["light", "dark"]) for (const width of [360, 720]) {
    win.setSize(width, 600);
    await load("long-confirmation", theme);
    const geometry = await win.webContents.executeJavaScript(`(() => {
      const dialog = document.querySelector('[role="alertdialog"]');
      const header = dialog.querySelector('.ui-dialog-header');
      const footer = dialog.querySelector('.ui-dialog-footer');
      const box = dialog.getBoundingClientRect(), actions = footer.getBoundingClientRect();
      return { contained: box.top >= 0 && box.bottom <= innerHeight && box.left >= 0 && box.right <= innerWidth,
        scrollable: header.scrollHeight > header.clientHeight,
        actionsVisible: actions.top >= box.top && actions.bottom <= box.bottom,
        cancelFocused: document.activeElement === footer.querySelector('button') };
    })()`);
    const name = `${theme}-${width}-long-confirmation.png`;
    fs.writeFileSync(path.join(output, name), (await win.webContents.capturePage()).toPNG());
    report.geometry.push({ name, ...geometry });
    for (const [contract, passed] of Object.entries(geometry)) assert.equal(passed, true, `${name}: ${contract}`);
  }
  await load("performance", "light");
  report.performance = await win.webContents.executeJavaScript("window.__uiCatalog.benchmark()");
  assert.equal(report.performance.inputPreserved, true, "Controlled update replaced the native search input");
  assert.equal(report.performance.actions, 500, "Action-list fixture did not render");
  assert.ok(report.performance.p95Ms < 16.7, `Controlled update P95 ${report.performance.p95Ms.toFixed(2)}ms exceeds the 16.7ms budget`);
  assert.deepEqual(errors, [], "UI catalog renderer errors");
  if (update) fs.writeFileSync(manifestPath, `${JSON.stringify({ environment: report.environment, snapshots: report.snapshots.map(item => ({ name: item.name, sha256: sha(path.join(baselines, item.name)) })) }, null, 2)}\n`);
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  assert.deepEqual(report.failures, [], "Visual regressions; inspect actual/expected/diff images in .tmp/ui-regression");
  console.log(`UI regression passed: ${report.snapshots.length} screenshots; controlled update P95 ${report.performance.p95Ms.toFixed(2)}ms with 500 actions.`);
  win.destroy(); app.quit();
}).catch(error => {
  report.failures.push(error.stack || String(error));
  fs.mkdirSync(output, { recursive: true });
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.error(error);
  for (const window of BrowserWindow.getAllWindows()) window.destroy();
  app.exit(1);
});

async function load(id, theme) {
  await win.loadFile(path.join(root, ".tmp/ui-catalog/index.html"), { query: { case: id, theme } });
  await win.webContents.executeJavaScript("new Promise((resolve, reject) => { const end = performance.now() + 10000; function ready() { if (window.__uiCatalog?.ready) resolve(); else if (performance.now() > end) reject(new Error('UI catalog did not mount')); else requestAnimationFrame(ready); } ready(); })");
  await win.webContents.executeJavaScript("document.fonts.ready");
  await settled();
  if (!preview) assert.equal(await win.webContents.executeJavaScript("matchMedia('(prefers-reduced-motion: reduce)').matches"), true, "Visual snapshots need deterministic reduced motion");
}
async function settled() { await win.webContents.executeJavaScript("new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(resolve, 260))))"); }
async function waitForSelector(selector) {
  await win.webContents.executeJavaScript(`new Promise((resolve, reject) => {
    const end = performance.now() + 5000;
    function ready() {
      const node = document.querySelector(${JSON.stringify(selector)});
      if (node && node.getBoundingClientRect().height > 0 && !node.closest('[inert]')) resolve();
      else if (performance.now() > end) reject(new Error('UI catalog control did not appear: ' + ${JSON.stringify(selector)}));
      else requestAnimationFrame(ready);
    }
    ready();
  })`);
}
async function click(selector) {
  const point = await win.webContents.executeJavaScript(`(() => { const node = document.querySelector(${JSON.stringify(selector)}); if (!node) throw new Error('UI trigger missing'); const r = node.getBoundingClientRect(); return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }; })()`);
  win.webContents.sendInputEvent({ type: "mouseMove", ...point });
  win.webContents.sendInputEvent({ type: "mouseDown", ...point, button: "left", clickCount: 1 });
  win.webContents.sendInputEvent({ type: "mouseUp", ...point, button: "left", clickCount: 1 });
}
async function inspect(id) {
  return win.webContents.executeJavaScript(`(() => {
    const controls = Array.from(document.querySelectorAll('[data-ui-control]'));
    const visible = controls.filter(node => node.getBoundingClientRect().height > 0 && !node.closest('[inert]'));
    const trigger = document.querySelector('.ui-select-trigger');
    const surfaces = Array.from(document.querySelectorAll('.ui-select-surface')).filter(node => !node.closest('[inert]'));
    const data = { overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth, controlCount: controls.length,
      dialogs: document.querySelectorAll('[role="dialog"], [role="alertdialog"]').length,
      menus: document.querySelectorAll('[role="menu"], [role="listbox"]').length,
      choice: trigger ? { expanded: trigger.getAttribute('aria-expanded') === 'true', shape: trigger.dataset.shape, variant: trigger.dataset.variant, tone: trigger.dataset.tone,
        options: document.querySelectorAll('.ui-select-menu [role="option"]').length,
        selectedOptions: document.querySelectorAll('.ui-select-menu [role="option"][aria-selected="true"]').length,
        disabledOptions: document.querySelectorAll('.ui-select-menu [role="option"]:disabled').length,
        warningOptions: document.querySelectorAll('.ui-select-menu [role="option"][data-tone="warning"]').length } : null,
      models: { agents: document.querySelectorAll('.composer-model-menu [data-agent]').length,
        providers: document.querySelectorAll('.composer-model-menu [data-provider]').length,
        selectedAgents: document.querySelectorAll('.composer-model-menu [data-agent][aria-checked="true"]').length,
        expandedProviders: document.querySelectorAll('.composer-model-menu [data-provider][aria-expanded="true"]').length,
        groupedSurfaces: document.querySelectorAll('.composer-model-surface[data-variant="grouped"]').length,
        detailOptions: document.querySelectorAll('.composer-image-submenu [role="menuitemradio"][data-variant="detail"]').length,
        selectedModels: document.querySelectorAll('.composer-image-submenu [role="menuitemradio"][aria-checked="true"]').length },
      choiceSurfacesContained: surfaces.every(node => {
        const box = node.getBoundingClientRect();
        return box.width > 0 && box.height > 0 && box.left >= -1 && box.top >= -1 && box.right <= innerWidth + 1 && box.bottom <= innerHeight + 1 && node.scrollWidth <= node.clientWidth + 1;
      }) };
    for (const node of visible) {
      const css = getComputedStyle(node);
      if (node.matches('.ui-button')) {
        const size = node.dataset.size, token = size === 'sm' ? '--control-height-sm' : size === 'lg' ? '--control-height-lg' : '--control-height';
        const base = parseFloat(getComputedStyle(document.documentElement).getPropertyValue(token));
        const expected = node.hasAttribute('data-responsive-target') && innerWidth <= 720
          ? Math.max(base, parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--control-touch-target'))) : base;
        if (Math.abs(parseFloat(css.height) - expected) > .5) throw new Error('Button size escaped its contract: ' + css.height + ' vs ' + expected);
      }
      if (node.matches('.ui-input:not([data-variant="inline"])')) {
        const token = node.dataset.size === 'sm' ? '--input-height-sm' : '--input-height';
        const expected = parseFloat(getComputedStyle(document.documentElement).getPropertyValue(token));
        if (Math.abs(parseFloat(css.height) - expected) > .5) throw new Error('Input size escaped its contract');
      }
    }
    return data;
  })()`);
}
