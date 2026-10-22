const fs = require("node:fs");
const path = require("node:path");
const postcss = require("postcss");
const { createModel, files, attribute, strings, definitions, ts } = require("./model.cjs");
const { appearance, reservedTokens, ownerFile, selectorOwners } = require("./style-ownership.cjs");

const nativeInputTypes = new Set(["checkbox", "radio", "file", "hidden", "range", "color", "button", "submit", "reset", "image"]);
const layoutProperties = new Set(["width", "minWidth", "maxWidth", "margin", "marginTop", "marginRight", "marginBottom", "marginLeft", "marginInline", "marginInlineStart", "marginInlineEnd", "marginBlock", "marginBlockStart", "marginBlockEnd", "flex", "flexGrow", "flexShrink", "flexBasis", "alignSelf", "justifySelf", "order", "gridArea", "gridColumn", "gridRow", "top", "right", "bottom", "left", "inset", "position"]);

function audit(rendererRoot) {
  const model = createModel(rendererRoot);
  const stylesRoot = path.join(rendererRoot, "styles");
  const failures = [];
  const fail = (source, node, message) => failures.push({ file: source.fileName, line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1, message });
  const inside = (file, root) => { const relative = path.relative(root, file); return relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative); };

  for (const file of files(rendererRoot)) if (/\.(css|scss|sass|less|styl)$/.test(file) && !inside(file, stylesRoot)) {
    failures.push({ file, line: 1, message: "Application CSS must live under renderer/src/styles/." });
  }

  for (const source of model.sources) {
    const shared = inside(source.fileName, model.designRoot);
    function inspectStyle(node, control, seen = new Set()) {
      if (!node) return;
      if (ts.isJsxExpression(node) || ts.isAsExpression(node) || ts.isSatisfiesExpression(node) || ts.isParenthesizedExpression(node)) { inspectStyle(node.expression, control, seen); return; }
      if (ts.isConditionalExpression(node)) { inspectStyle(node.whenTrue, control, seen); inspectStyle(node.whenFalse, control, seen); return; }
      if (ts.isIdentifier(node)) {
        const symbol = model.checker.getSymbolAtLocation(node);
        if (symbol && !seen.has(symbol)) {
          const next = new Set(seen).add(symbol);
          for (const declaration of symbol.declarations || []) if (ts.isVariableDeclaration(declaration)) inspectStyle(declaration.initializer, control, next);
        }
      }
      if (ts.isPropertyAssignment(node)) {
        const name = node.name.getText(source).replace(/^["']|["']$/g, "");
        const value = node.initializer;
        const fixed = ts.isStringLiteralLike(value) || ts.isNumericLiteral(value) || ts.isPrefixUnaryExpression(value) && ts.isNumericLiteral(value.operand);
        if (reservedTokens.test(name) || control && !name.startsWith("--") && !layoutProperties.has(name)) fail(source, node, `Maintain shared control appearance '${name}' in its component CSS; choose a supported variant.`);
        else if (!name.startsWith("--") && fixed) fail(source, node, `Move fixed inline style '${name}' to renderer/src/styles/.`);
        return;
      }
      if (ts.isObjectLiteralExpression(node)) for (const property of node.properties) inspectStyle(property, control, seen);
      if (ts.isSpreadAssignment(node)) inspectStyle(node.expression, control, seen);
    }
    function visit(node) {
      if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier) && node.moduleSpecifier.text.startsWith(".") && /\.(?:css|scss|sass|less|styl)$/.test(node.moduleSpecifier.text)
        && !inside(path.resolve(path.dirname(source.fileName), node.moduleSpecifier.text), stylesRoot)) fail(source, node, "Import application styles from renderer/src/styles/. Vendor styles use their package import.");
      if (!shared && ts.isCallExpression(node) && /(?:^|\.)createElement$/.test(node.expression.getText(source)) && node.arguments[0] && ts.isStringLiteral(node.arguments[0]) && ["button", "input", "textarea", "select", "style"].includes(node.arguments[0].text)) fail(source, node, "Use the shared JSX control; createElement must not bypass UI ownership.");
      if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
        const tag = node.tagName.getText(source);
        const control = model.component(node.tagName);
        const values = key => strings(attribute(node, key)?.initializer, model.checker);
        const has = key => Boolean(attribute(node, key));
        if (!shared && tag === "style") fail(source, node, "Keep application styles in their CSS owner, not a feature style element.");
        if (!shared && tag === "label" && ts.isJsxOpeningElement(node)) {
          if (node.parent.children.some(child => (ts.isJsxElement(child) || ts.isJsxSelfClosingElement(child)) && ["Input", "Textarea", "Select", "InputGroup"].includes(model.component(ts.isJsxElement(child) ? child.openingElement.tagName : child.tagName)?.name))) fail(source, node, "Use FormField for a labeled text/choice field so spacing, labels and messages share one contract.");
        }
        if (!shared && definitions[tag] && !control) fail(source, node, `Import ${tag} from the shared design system; a same-named local component is not the public control.`);
        if (!shared && (tag === "textarea" || tag === "select" || tag === "input" && (!values("type").length || values("type").some(value => !nativeInputTypes.has(value))))) fail(source, node, `Use the shared ${tag === "textarea" ? "Textarea" : tag === "select" ? "Select" : "Input/SearchInput"} component.`);
        if (!shared && has("data-ui-control")) fail(source, node, "data-ui-control is owned by the design system, not a feature escape hatch.");
        if (!shared && (tag === "button" || /^[a-z]/.test(tag) && values("role").includes("button"))) {
          const role = values("role");
          const selected = values("data-motion").some(value => ["selection", "disclosure"].includes(value)) && ["aria-pressed", "aria-current", "aria-selected", "aria-expanded"].some(has);
          const option = role.length && role.every(value => value === "option") && has("aria-selected");
          const backdrop = has("data-focus-scope-backdrop") && values("aria-hidden").includes("true") && has("tabIndex");
          if (!selected && !option && !backdrop) fail(source, node, "Use Button, IconButton, MenuItem or a shared media/upload control for actions. Native buttons are reserved for semantic selection/navigation surfaces.");
        }
        if (!shared && /^[a-z]/.test(tag) && values("role").some(role => ["dialog", "alertdialog", "menu"].includes(role))) fail(source, node, "Use Dialog/FormDialog, Popover or DropdownMenu for an overlay; do not rebuild its shell.");
        if (!shared && control && attribute(node, "style")?.initializer) inspectStyle(attribute(node, "style").initializer, true);
        if (!shared && control && has("className") && !values("className").length) {
          const expression = attribute(node, "className").initializer?.getText(source);
          if (expression && !/^\{(?:undefined|null|false)\}$/.test(expression)) fail(source, node, "Shared control layout classes must be statically declared so style ownership can be checked.");
        }
        if (!shared && control?.name === "Dialog") {
          const element = ts.isJsxOpeningElement(node) ? node.parent : null;
          let header = false;
          function chrome(child) {
            if (ts.isJsxElement(child) && child.parent === element && ["header", "footer"].includes(child.openingElement.tagName.getText(source))) fail(source, child, "Use DialogHeader/DialogFooter for dialog chrome.");
            if (ts.isJsxSelfClosingElement(child) && ["DialogHeader", "SearchDialogHeader"].includes(model.component(child.tagName)?.name)) header = true;
            ts.forEachChild(child, chrome);
          }
          if (element) for (const child of element.children) chrome(child);
          if (!header) fail(source, node, "A panel Dialog needs DialogHeader; use FormDialog for a standard form.");
        }
      }
      if (ts.isJsxAttribute(node) && node.name.getText(source) === "style" && node.initializer) {
        const parent = node.parent.parent;
        if (!model.component(parent.tagName) || shared) inspectStyle(node.initializer, false);
      }
      ts.forEachChild(node, visit);
    }
    visit(source);
  }

  for (const file of files(stylesRoot).filter(file => file.endsWith(".css"))) {
    const css = postcss.parse(fs.readFileSync(file, "utf8"), { from: file });
    css.walkDecls(declaration => {
      if (reservedTokens.test(declaration.prop) && file !== path.join(stylesRoot, "tokens.css")) failures.push({ file, line: declaration.source.start.line, message: `Define '${declaration.prop}' only in tokens.css.` });
    });
    css.walkRules(rule => {
      for (const selector of rule.selectors) {
        for (const owner of selectorOwners(selector, model.classes)) {
          if (file === ownerFile(stylesRoot, owner)) continue;
          for (const declaration of rule.nodes.filter(node => node.type === "decl" && appearance.test(node.prop))) failures.push({ file, line: declaration.source.start.line, message: `Maintain '${declaration.prop}' for ${selector} in styles/${path.relative(stylesRoot, ownerFile(stylesRoot, owner))}.` });
        }
      }
    });
  }
  return { failures, sourceCount: model.sources.length };
}

module.exports = { audit };
