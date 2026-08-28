const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");
const rendererRoot = path.join(root, "renderer", "src");
const excludedFiles = new Set([
  path.join(rendererRoot, "browser-api.ts")
]);

function sourceFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(target);
    if (!/\.(?:ts|tsx)$/.test(entry.name) || /\.test\.(?:ts|tsx)$/.test(entry.name) || excludedFiles.has(target)) return [];
    return [target];
  });
}

function literalText(node) {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isJsxText(node)) return node.text;
  if (ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) return node.text;
  return null;
}

const findings = [];
for (const file of sourceFiles(rendererRoot)) {
  const source = fs.readFileSync(file, "utf8");
  const parsed = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const visit = (node) => {
    const value = literalText(node);
    if (value && /\p{Script=Han}/u.test(value)) {
      const position = parsed.getLineAndCharacterOfPosition(node.getStart(parsed));
      findings.push({
        file: path.relative(root, file),
        line: position.line + 1,
        text: value.trim().replace(/\s+/g, " ").slice(0, 160)
      });
    }
    ts.forEachChild(node, visit);
  };
  visit(parsed);
}

console.log(`[ui-copy-audit] scanned ${sourceFiles(rendererRoot).length} production Renderer TS/TSX files`);
console.log(`[ui-copy-audit] direct Han UI literals: ${findings.length}`);
for (const finding of findings) console.log(`${finding.file}:${finding.line} ${finding.text}`);
console.log("[ui-copy-audit] browser-api.ts is excluded because it is the standalone browser-preview fixture dataset, not component copy.");
