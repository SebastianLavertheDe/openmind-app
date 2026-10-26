// Run with the OpenMind Electron executable, using a disposable profile.
const { app, BrowserWindow } = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const scriptIndex = process.argv.findIndex(value => path.basename(value) === "render_frames.cjs");
const input = path.resolve(process.argv[scriptIndex + 1]);
const output = path.resolve(process.argv[scriptIndex + 2]);
fs.mkdirSync(path.join(output, "electron-profile"), { recursive: true });
app.setPath("userData", path.join(output, "electron-profile"));
app.setPath("sessionData", path.join(output, "electron-profile"));
app.commandLine.appendSwitch("disable-gpu");
const escape = value => String(value).replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
app.whenReady().then(async () => {
  const data = JSON.parse(fs.readFileSync(input, "utf8"));
  const win = new BrowserWindow({ width: data.width || 1280, height: data.height || 720, useContentSize: true, show: false, webPreferences: { sandbox: true, nodeIntegration: false, contextIsolation: true, backgroundThrottling: false, partition: `video-${Date.now()}` } });
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  for (let index = 0; index < data.slides.length; index++) {
    const slide = data.slides[index];
    let image = "";
    if (slide.image) {
      const file = path.resolve(slide.image);
      const extension = path.extname(file).toLowerCase();
      if (![".png", ".jpg", ".jpeg", ".webp"].includes(extension) || fs.statSync(file).size > 20 * 1024 * 1024) throw new Error("Unsupported frame image");
      image = `data:image/${extension === ".png" ? "png" : extension === ".webp" ? "webp" : "jpeg"};base64,${fs.readFileSync(file).toString("base64")}`;
    }
    const html = `<html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'"><style>html,body{margin:0;width:100%;height:100%;overflow:hidden}body{display:flex;align-items:center;justify-content:center;background:#${String(data.background || "0x172033").slice(2)};font-family:system-ui,sans-serif;color:white}img{position:absolute;width:100%;height:100%;object-fit:contain}p{position:relative;white-space:pre-wrap;text-align:center;max-width:85%;font-size:${Math.max(12, Math.min(200, data.fontSize || 48))}px;line-height:1.5;text-shadow:0 2px 8px #000}</style></head><body>${image ? `<img src="${image}">` : ""}<p>${escape(slide.text || "")}</p></body></html>`;
    await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
    await win.webContents.executeJavaScript("Promise.all([document.fonts.ready, ...Array.from(document.images).map(i => i.complete ? Promise.resolve() : new Promise(r => {i.onload=r;i.onerror=r}))])");
    const frame = await win.webContents.capturePage();
    fs.writeFileSync(path.join(output, `frame-${index}.png`), frame.toPNG());
  }
  win.destroy(); app.quit();
}).catch(error => { process.stderr.write(`${error.stack || error}\n`); app.exit(1); });
