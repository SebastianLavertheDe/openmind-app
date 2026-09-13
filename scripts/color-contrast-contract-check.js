const fs = require("node:fs");
const path = require("node:path");

const file = path.join(process.cwd(), "renderer", "src", "styles", "workbuddy-refactor.css");
const source = fs.readFileSync(file, "utf8");
const light = source.match(/:root\s*\{([\s\S]*?)\n\}/)?.[1] || "";
const dark = source.match(/:root\[data-theme="dark"\]\s*\{([\s\S]*?)\n\}/)?.[1] || "";
const surfaceNames = ["app-bg", "page-bg", "panel-bg", "panel-muted", "control-bg", "control-hover"];
const failures = [];

for (const [theme, block] of [["light", light], ["dark", dark]]) {
  const foreground = readHex(block, "muted-2");
  if (!foreground) {
    failures.push(`${theme}: missing --muted-2`);
    continue;
  }
  for (const name of surfaceNames) {
    const background = readHex(block, name);
    if (!background) continue;
    const ratio = contrast(foreground, background);
    if (ratio < 4.5) failures.push(`${theme}: --muted-2 ${foreground} on --${name} ${background} = ${ratio.toFixed(2)}:1`);
  }
}

if (failures.length) {
  console.error("Color contrast contract failed for secondary text:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
} else {
  console.log("Color contrast contract passed: --muted-2 is at least 4.5:1 on product surfaces in both themes.");
}

function readHex(block, name) {
  return block.match(new RegExp(`--${name}:\\s*(#[0-9a-f]{6})`, "i"))?.[1] || null;
}

function contrast(foreground, background) {
  const first = luminance(foreground);
  const second = luminance(background);
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
}

function luminance(hex) {
  const channels = hex.slice(1).match(/.{2}/g).map((part) => Number.parseInt(part, 16) / 255);
  const linear = channels.map((value) => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}
