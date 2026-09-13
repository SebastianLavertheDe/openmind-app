const fs = require("node:fs");
const path = require("node:path");

const rendererRoot = path.join(process.cwd(), "renderer", "src");
const violations = [];

function visit(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) visit(file);
    else if (entry.isFile() && file.endsWith(".css")) inspectCss(file);
  }
}

function inspectCss(file) {
  const source = fs.readFileSync(file, "utf8");
  const pattern = /(?:\bfont(?:-size)?|--(?:fs|[a-z0-9-]*font[a-z0-9-]*))\s*:\s*(\d+(?:\.\d+)?)px/gi;
  for (const match of source.matchAll(pattern)) {
    const size = Number(match[1]);
    if (size >= 12 || size <= 0) continue;
    const line = source.slice(0, match.index).split(/\r?\n/).length;
    violations.push(`${path.relative(process.cwd(), file)}:${line} (${size}px)`);
  }
}

visit(rendererRoot);

const themeFile = path.join(rendererRoot, "theme.ts");
const themeSource = fs.readFileSync(themeFile, "utf8");
for (const match of themeSource.matchAll(/setProperty\("--fs-(?:body|caption)",\s*"(\d+(?:\.\d+)?)px"\)/g)) {
  const size = Number(match[1]);
  if (size >= 12) continue;
  const line = themeSource.slice(0, match.index).split(/\r?\n/).length;
  violations.push(`${path.relative(process.cwd(), themeFile)}:${line} (${size}px)`);
}

if (violations.length) {
  console.error(`Typography contract failed: ${violations.length} rendered font size(s) below 12px.`);
  for (const violation of violations) console.error(`- ${violation}`);
  process.exitCode = 1;
} else {
  console.log("Typography contract passed: no rendered font sizes below 12px.");
}
