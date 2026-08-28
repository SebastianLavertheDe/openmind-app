const fs = require("fs");
const path = require("path");

const appRoot = path.resolve(__dirname, "..");
const rendererRoot = path.join(appRoot, "renderer", "src");
const files = walk(rendererRoot).filter((file) => !/\.(?:test|spec)\.[cm]?[jt]sx?$/.test(file));
const findings = [];
const queries = [];

for (const file of files) {
  const source = fs.readFileSync(file, "utf8");
  const relative = path.relative(appRoot, file).replaceAll(path.sep, "/");
  const lines = source.split(/\r?\n/);
  lines.forEach((line, index) => {
    if (/renderer\/src\/features\//.test(relative) && /window\.(?:innerWidth|outerWidth)/.test(line)) {
      findings.push({ kind: "feature viewport width", file: relative, line: index + 1, text: line.trim() });
    }
    if (/renderer\/src\/features\//.test(relative) && /matchMedia\([^)]*max-width/i.test(line)) {
      findings.push({ kind: "feature max-width matchMedia", file: relative, line: index + 1, text: line.trim() });
    }
    if (/!important/.test(line) && /(?:grid-template|flex(?:-basis|-grow|-shrink)?|position|display)\s*:/.test(line)) {
      findings.push({ kind: "layout !important", file: relative, line: index + 1, text: line.trim() });
    }
    if (relative.endsWith(".css") && /\.(?:app|nav)(?:[\s:.,\[]|$)|nav-collapsed/.test(line) && !/\.app-(?:shell|nav|stage|brand)/.test(line)) {
      findings.push({ kind: "legacy selector candidate", file: relative, line: index + 1, text: line.trim() });
    }
    for (const match of line.matchAll(/@(media|container)\s*([^\{]+)/g)) {
      queries.push({ kind: match[1], condition: match[2].trim(), file: relative, line: index + 1 });
    }
  });
}

console.log("Responsive hardcode audit (report mode)");
console.log(`Scanned ${files.length} production renderer files.`);
if (findings.length) {
  console.log(`\nCandidates (${findings.length}):`);
  for (const finding of findings) console.log(`- ${finding.kind}: ${finding.file}:${finding.line} ${finding.text}`);
} else {
  console.log("\nCandidates: none");
}

const queryCounts = new Map();
for (const query of queries) {
  const key = `@${query.kind} ${query.condition}`;
  queryCounts.set(key, (queryCounts.get(key) || 0) + 1);
}
console.log(`\nCSS query inventory (${queries.length} declarations, ${queryCounts.size} unique):`);
for (const [query, count] of [...queryCounts].sort(([left], [right]) => left.localeCompare(right))) {
  console.log(`- ${query} (${count})`);
}

function walk(root) {
  const output = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const target = path.join(root, entry.name);
    if (entry.isDirectory()) output.push(...walk(target));
    else if (/\.(?:css|[cm]?[jt]sx?)$/.test(entry.name)) output.push(target);
  }
  return output;
}
