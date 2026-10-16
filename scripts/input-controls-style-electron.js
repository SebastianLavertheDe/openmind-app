const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { app, BrowserWindow } = require("electron");

const output = path.resolve(__dirname, "..", ".build", "input-controls-style");
const userData = fs.mkdtempSync(path.join(os.tmpdir(), "openmind-input-controls-"));
app.setPath("userData", userData);
app.commandLine.appendSwitch("disable-gpu");
app.commandLine.appendSwitch("force-device-scale-factor", "1");
const report = [];
const errors = [];

app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 1280, height: 800, show: true,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } });
  win.webContents.on("console-message", event => { if (event.level >= 3) errors.push(event.message); });
  await win.loadFile(path.join(output, "index.html"));
  win.focus();
  await win.webContents.executeJavaScript(`new Promise(resolve => {
    function ready() { if (document.querySelector('[data-probe="default"]')) resolve(); else requestAnimationFrame(ready); }
    ready();
  })`);
  for (const theme of ["light", "dark"]) {
    await win.webContents.executeJavaScript(`document.documentElement.dataset.theme = ${JSON.stringify(theme)}`);
    for (const [width, height] of [[720, 600], [900, 720], [1280, 800]]) {
      win.setSize(width, height);
      await settle(win);
      const ids = await win.webContents.executeJavaScript(`Array.from(document.querySelectorAll('[data-probe]'), node => node.dataset.probe)`);
      for (const id of ids) {
        const before = await inspect(win, id);
        const context = `${theme} ${width} ${id}`;
        assert.equal(before.outline, "none", `${context}: outer outline`);
        if (!before.disabled) {
          win.webContents.sendInputEvent({ type: "mouseDown", x: before.x, y: before.y, button: "left", clickCount: 1 });
          win.webContents.sendInputEvent({ type: "mouseUp", x: before.x, y: before.y, button: "left", clickCount: 1 });
          await settle(win);
        }
        const focused = await inspect(win, id);
        assert.equal(focused.focused, !focused.disabled, `${context}: native focus`);
        assert.equal(focused.outline, "none", `${context}: focus outline`);
        assert.ok(Math.abs(before.height - focused.height) < .5, `${context}: focus changes height`);
        if (id === "inline-editor") {
          assert.equal(focused.shadow, "none", `${context}: composer must not draw an inner focus line`);
          assert.ok(focused.height >= 146, `${context}: composer minimum height`);
          assert.ok(focused.paddingTop >= 20 && focused.paddingLeft >= 20 && focused.paddingBottom >= 66,
            `${context}: composer needs text insets and space for its toolbar`);
        }
        if (focused.surface) {
          assert.ok(focused.surface.height <= 60, `${context}: search surface stretches vertically`);
          assert.ok(focused.surface.overflow <= 1, `${context}: control surface overflows its parent`);
          assert.equal(focused.borderWidth, "0px", `${context}: inner border`);
          assert.equal(focused.shadow, "none", `${context}: inner shadow`);
          assert.equal(focused.surface.shadow, "none", `${context}: surface glow`);
          if (focused.invalid) assert.equal(focused.surface.borderColor, focused.danger, `${context}: error survives focus`);
        } else if (!id.startsWith("inline")) {
          assert.equal(focused.borderWidth, "1px", `${context}: form border`);
          assert.equal(focused.shadow, "none", `${context}: form glow`);
          if (focused.invalid) assert.equal(focused.borderColor, focused.danger, `${context}: error survives focus`);
        }
        report.push({ theme, width, height, id, before, focused });
        await win.webContents.executeJavaScript(`document.activeElement?.blur()`);
        await settle(win);
      }
      // Exercise actual keyboard traversal and confirm the default field gets visible focus feedback.
      await win.webContents.executeJavaScript(`window.scrollTo(0, 0); document.querySelector('[data-probe="default"]').focus()`);
      win.webContents.sendInputEvent({ type: "keyDown", keyCode: "Tab" });
      win.webContents.sendInputEvent({ type: "keyUp", keyCode: "Tab" });
      await settle(win);
      const keyboard = await inspect(win, "project");
      assert.ok(keyboard.focused && keyboard.focusVisible, `${theme} ${width}: keyboard focus`);
      assert.equal(keyboard.outline, "none");
      assert.notEqual(keyboard.borderColor, report.find(row => row.theme === theme && row.width === width && row.id === "project").before.borderColor);
      await win.webContents.executeJavaScript(`document.activeElement?.blur(); window.scrollTo(0, 0)`);
      fs.writeFileSync(path.join(output, `${theme}-${width}.png`), (await win.webContents.capturePage()).toPNG());
      const overflow = await win.webContents.executeJavaScript(`document.documentElement.scrollWidth - document.documentElement.clientWidth`);
      assert.ok(overflow <= 1, `${theme} ${width}: horizontal overflow`);
    }
  }
  assert.deepEqual(errors, []);
  fs.writeFileSync(path.join(output, "report.json"), JSON.stringify({ checks: report.length, results: report }, null, 2));
  console.log(`Input style checks passed: ${report.length} control/theme/viewport cases, native mouse and keyboard focus, error states, and six screenshots.`);
  win.destroy();
  app.quit();
}).catch(error => { console.error(error); app.exit(1); }).finally(() => {
  fs.rmSync(userData, { recursive: true, force: true });
});

async function settle(win) {
  await win.webContents.executeJavaScript(`new Promise(resolve => setTimeout(resolve, 170))`);
}

async function inspect(win, id) {
  return win.webContents.executeJavaScript(`(() => {
    const node = document.querySelector('[data-probe=' + ${JSON.stringify(JSON.stringify(id))} + ']');
    node.scrollIntoView({ block: 'center', inline: 'nearest' });
    const css = getComputedStyle(node);
    const surface = node.closest('.ui-search-input, .ui-input-group');
    const surfaceCss = surface && getComputedStyle(surface);
    const surfaceRect = surface?.getBoundingClientRect();
    const parentRect = surface?.parentElement.getBoundingClientRect();
    const rect = node.getBoundingClientRect();
    const color = document.createElement('span'); color.style.color = 'var(--danger-500)'; document.body.append(color);
    const danger = getComputedStyle(color).color; color.remove();
    return { focused: document.activeElement === node, focusVisible: node.matches(':focus-visible'), disabled: node.disabled,
      readOnly: node.readOnly, invalid: node.getAttribute('aria-invalid') === 'true', height: rect.height,
      x: Math.round(rect.left + Math.min(30, rect.width / 2)), y: Math.round(rect.top + rect.height / 2),
      borderWidth: css.borderTopWidth, borderColor: css.borderTopColor, outline: css.outlineStyle, shadow: css.boxShadow, danger,
      paddingTop: parseFloat(css.paddingTop), paddingLeft: parseFloat(css.paddingLeft), paddingBottom: parseFloat(css.paddingBottom),
      surface: surfaceCss && { borderColor: surfaceCss.borderTopColor, shadow: surfaceCss.boxShadow,
        height: surfaceRect.height, overflow: Math.max(0, surfaceRect.right - parentRect.right, parentRect.left - surfaceRect.left) } };
  })()`);
}
