const { skipUnsupportedVisualPlatform } = require("./ui-contract/visual-platform.cjs");
const diagnostic = process.argv.some(argument => ["--preview", "--capture-only", "--performance-only"].includes(argument));
if (!diagnostic && skipUnsupportedVisualPlatform("UI visual comparisons")) process.exit(0);

const fs = require("node:fs");
const path = require("node:path");
const { runWithTemporaryProfile } = require("./ui-contract/temporary-profile.cjs");
const esbuild = require("esbuild");
const electron = require("electron");

const root = path.resolve(__dirname, "..");
const output = path.join(root, ".tmp/ui-catalog");
fs.mkdirSync(output, { recursive: true });
esbuild.buildSync({
  entryPoints: [path.join(root, "renderer/dev/ui-catalog.tsx")], outfile: path.join(output, "catalog.js"),
  bundle: true, platform: "browser", format: "iife", target: "chrome140", jsx: "automatic",
  minify: true, loader: { ".ttf": "file", ".woff": "file", ".woff2": "file", ".jpg": "file" },
  define: { "process.env.NODE_ENV": '"production"' }
});
fs.writeFileSync(path.join(output, "index.html"), '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>OpenMind UI catalog</title><link rel="stylesheet" href="./catalog.css"></head><body><div id="root"></div><script src="./catalog.js"></script></body></html>');
const environment = { ...process.env };
delete environment.ELECTRON_RUN_AS_NODE;
const virtualDisplay = process.platform === "linux" && !environment.DISPLAY;
const command = virtualDisplay ? "xvfb-run" : electron;
const args = [...(virtualDisplay ? ["-a", electron] : []), "--no-sandbox", path.join(__dirname, "ui-catalog-electron.cjs"), ...process.argv.slice(2)];
const result = runWithTemporaryProfile(command, args, { cwd: root, stdio: "inherit", env: environment });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
