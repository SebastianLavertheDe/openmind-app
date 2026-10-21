const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");
const postcss = require("postcss");

const root = path.resolve(__dirname, "..");
const rendererRoot = process.argv[2] ? path.resolve(process.argv[2]) : path.join(root, "renderer", "src");
const stylesRoot = path.join(rendererRoot, "styles");
const inputOwner = path.join(rendererRoot, "design-system", "inputs.tsx");
const selectOwner = path.join(rendererRoot, "design-system", "Select.tsx");
const nativeInputTypes = new Set(["checkbox", "radio", "file", "hidden", "range", "color", "button", "submit", "reset", "image"]);
const failures = [];
const controlClasses = new Set(["ui-input", "ui-textarea", "ui-search-input", "ui-input-group"]);
const nativeInputScopes = [".settings-provider-default", ".skills-source-package", ".settings-cli-provider-option", ".settings-provider-image-models"];
let sourceCount = 0;

function files(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(directory, entry.name);
    return entry.isDirectory() ? files(file) : [file];
  });
}

function inStyles(file) {
  const relative = path.relative(stylesRoot, file);
  return relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

for (const file of files(rendererRoot)) {
  if (/\.(css|scss|sass|less|styl)$/.test(file) && !inStyles(file)) {
    failures.push(`${path.relative(root, file)}: app styles must live under renderer/src/styles/`);
  }
  if (!/\.(ts|tsx)$/.test(file) || /\.test\.(ts|tsx)$/.test(file)) continue;
  sourceCount++;
  const source = fs.readFileSync(file, "utf8");
  const parsed = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  function fail(node, message) {
    const line = parsed.getLineAndCharacterOfPosition(node.getStart(parsed)).line + 1;
    failures.push(`${path.relative(root, file)}:${line}: ${message}`);
  }
  function visit(node) {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      const specifier = node.moduleSpecifier.text;
      if (specifier.startsWith(".") && /\.(css|scss|sass|less|styl)$/.test(specifier) && !inStyles(path.resolve(path.dirname(file), specifier))) {
        fail(node, "import app styles from renderer/src/styles/");
      }
    }
    if (ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node)) {
      const tag = node.tagName.getText(parsed);
      if (["Input", "Textarea", "SearchInput", "InputGroup"].includes(tag)) {
        const className = node.attributes.properties.find((property) => ts.isJsxAttribute(property) && property.name.getText(parsed) === "className");
        if (className?.initializer && ts.isStringLiteral(className.initializer)) {
          for (const name of className.initializer.text.split(/\s+/).filter(Boolean)) controlClasses.add(name);
        }
      }
      if (tag === "textarea" && file !== inputOwner) fail(node, "use the shared Textarea component");
      if (tag === "select" && file !== selectOwner) fail(node, "use the shared Select component");
      if (tag === "input" && file !== inputOwner) {
        const type = node.attributes.properties.find((property) => ts.isJsxAttribute(property) && property.name.getText(parsed) === "type");
        const initializer = type?.initializer;
        const value = initializer && ts.isStringLiteral(initializer) ? initializer.text
          : initializer && ts.isJsxExpression(initializer) && initializer.expression && ts.isStringLiteral(initializer.expression) ? initializer.expression.text : null;
        if (!nativeInputTypes.has(value)) fail(node, "use the shared Input or SearchInput component for text controls");
      }
    }
    if (ts.isJsxAttribute(node) && node.name.getText(parsed) === "style" && node.initializer) {
      const inspectStyle = (styleNode) => {
        if (ts.isPropertyAssignment(styleNode)) {
          const name = ts.isStringLiteral(styleNode.name) ? styleNode.name.text : styleNode.name.getText(parsed);
          const value = styleNode.initializer;
          const fixed = ts.isStringLiteral(value) || ts.isNoSubstitutionTemplateLiteral(value) || ts.isNumericLiteral(value)
            || (ts.isPrefixUnaryExpression(value) && ts.isNumericLiteral(value.operand));
          if (!name.startsWith("--") && fixed) fail(styleNode, `move fixed inline style '${name}' to renderer/src/styles/; runtime values and CSS custom properties are supported`);
        }
        ts.forEachChild(styleNode, inspectStyle);
      };
      inspectStyle(node.initializer);
    }
    ts.forEachChild(node, visit);
  }
  visit(parsed);
}

// A field's legacy class must not become another place to override its paint.
const inputPaint = /^(?:border(?:-.+)?|outline(?:-.+)?|background(?:-.+)?|box-shadow|color|transition(?:-.+)?)$/;
for (const file of files(stylesRoot).filter(file => file.endsWith(".css"))) {
  if (file === path.join(stylesRoot, "components", "inputs.css")) continue;
  const css = postcss.parse(fs.readFileSync(file, "utf8"), { from: file });
  css.walkRules(rule => {
    const controls = rule.selectors.filter(selector => {
      // Vendor-owned editor widgets retain their library's focus treatment.
      if (selector.includes(".milkdown") && selector.includes(":is(button,input,")) return false;
      selector = selector.replace(/:has\([^)]*\)/g, "");
      if (selector.includes(":not(.ui-input)") || selector.includes(":not(.ui-textarea)")) return false;
      if (nativeInputScopes.some(scope => selector.startsWith(scope))) return false;
      if (/input\[type\s*=\s*["']?(?:checkbox|radio|file|hidden|range|color|button|submit|reset|image)/.test(selector)) return false;
      if (/(?:^|[ >+~,(])(?:input|textarea)(?=[:[.# >+~),]|$)/.test(selector)) return true;
      return [...selector.matchAll(/\.([a-zA-Z_][\w-]*)/g)].some(match => controlClasses.has(match[1]));
    });
    if (!controls.length) return;
    for (const declaration of rule.nodes.filter(node => node.type === "decl" && inputPaint.test(node.prop))) {
      failures.push(`${path.relative(root, file)}:${declaration.source.start.line}: maintain '${declaration.prop}' for ${controls.join(", ")} in styles/components/inputs.css`);
    }
  });
}

if (failures.length) {
  console.error(`Style ownership check failed (${failures.length}):\n${failures.join("\n")}`);
  process.exitCode = 1;
} else {
  console.log(`Style ownership check passed: ${sourceCount} renderer files; app CSS is centralized and text controls use shared components.`);
}
