const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

const definitions = {
  Tabs: ["controls.tsx", "selection", ["ui-tabs", "ui-tab"]],
  SegmentedControl: ["controls.tsx", "selection", ["ui-segmented", "ui-segmented-option"]],
  ToggleSwitch: ["controls.tsx", "selection", ["ui-toggle-switch"]],
  PopoverSurface: ["Popover.tsx", "menus", ["ui-popover-surface"]],
  Popover: ["Popover.tsx", "menus", []],
  FileDropzone: ["FileDropzone.tsx", "uploads", ["ui-file-dropzone"]],
  ImageThumbnail: ["ImageThumbnail.tsx", "media", ["ui-image-thumbnail"]],
  ImageAttachment: ["ImageThumbnail.tsx", "media", ["ui-image-attachment"]],
  Button: ["Button.tsx", "buttons", ["ui-button", "ui-button-spinner"]],
  IconButton: ["IconButton.tsx", "buttons", ["ui-icon-button"]],
  CopyButton: ["CopyButton.tsx", "buttons", []],
  Input: ["inputs.tsx", "inputs", ["ui-input"]],
  Textarea: ["inputs.tsx", "inputs", ["ui-textarea"]],
  SearchInput: ["inputs.tsx", "inputs", ["ui-search-input", "ui-search-input-icon", "ui-search-clear"]],
  InputGroup: ["inputs.tsx", "inputs", ["ui-input-group"]],
  FormField: ["FormField.tsx", "forms", ["ui-form-field", "ui-form-field-label", "ui-form-field-hint", "ui-form-field-error"]],
  FormActions: ["FormField.tsx", "forms", ["ui-form-actions"]],
  Dialog: ["Dialog.tsx", "dialogs", ["ui-dialog", "ui-dialog-backdrop", "ui-dialog-form"]],
  FormDialog: ["FormDialog.tsx", "dialogs", []],
  ConfirmDialog: ["FormDialog.tsx", "dialogs", []],
  DialogHeader: ["dialog-parts.tsx", "dialogs", ["ui-dialog-header", "ui-dialog-heading"]],
  SearchDialogHeader: ["dialog-parts.tsx", "dialogs", ["ui-dialog-search-header", "ui-dialog-search-status"]],
  DialogBody: ["dialog-parts.tsx", "dialogs", ["ui-dialog-body"]],
  DialogFooter: ["dialog-parts.tsx", "dialogs", ["ui-dialog-footer"]],
  Select: ["Select.tsx", "select", ["ui-select", "ui-select-trigger", "ui-select-label", "ui-select-value", "ui-select-chevron", "ui-select-leading", "ui-select-menu", "ui-select-option", "ui-select-check", "ui-select-option-label", "ui-select-native-proxy"]],
  SelectTrigger: ["SelectTrigger.tsx", "select", []],
  SelectItem: ["SelectItem.tsx", "select", []],
  SelectMenuSurface: ["SelectMenuSurface.tsx", "select", ["ui-select-surface"]],
  DropdownMenu: ["controls.tsx", "menus", ["ui-dropdown", "ui-dropdown-menu", "ui-dropdown-trigger"]],
  MenuItem: ["MenuItem.tsx", "menus", ["ui-menu-item"]]
};
const stateClasses = new Set(["active", "selected", "available", "danger", "warning", "disabled", "open", "primary", "secondary", "has-status", "pinned"]);

function files(directory) {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? files(path.join(directory, entry.name)) : [path.join(directory, entry.name)]);
}

function attribute(node, name) {
  return node.attributes.properties.find(property => ts.isJsxAttribute(property) && property.name.getText() === name);
}

/** Resolve constants and conditionals instead of relying on the JSX spelling. */
function strings(node, checker, seen = new Set()) {
  if (!node) return [];
  if (ts.isStringLiteralLike(node)) return [node.text];
  if (ts.isJsxExpression(node) || ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isSatisfiesExpression(node)) return strings(node.expression, checker, seen);
  if (node.kind === ts.SyntaxKind.NullKeyword || node.kind === ts.SyntaxKind.FalseKeyword || ts.isIdentifier(node) && node.text === "undefined") return [""];
  if (ts.isConditionalExpression(node)) return [...strings(node.whenTrue, checker, seen), ...strings(node.whenFalse, checker, seen)];
  if (ts.isBinaryExpression(node)) {
    if (node.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken) return ["", ...strings(node.right, checker, seen)];
    const left = strings(node.left, checker, seen), right = strings(node.right, checker, seen);
    return node.operatorToken.kind === ts.SyntaxKind.PlusToken ? left.flatMap(a => right.map(b => a + b)) : [...left, ...right];
  }
  if (ts.isTemplateExpression(node)) {
    let result = [node.head.text];
    for (const span of node.templateSpans) {
      const choices = strings(span.expression, checker, seen);
      if (!choices.length) return [];
      result = result.flatMap(prefix => choices.map(choice => prefix + choice + span.literal.text));
      if (result.length > 128) return [];
    }
    return result;
  }
  if (ts.isArrayLiteralExpression(node)) return node.elements.flatMap(element => strings(element, checker, seen));
  if (ts.isIdentifier(node)) {
    let symbol = checker.getSymbolAtLocation(node);
    if (symbol?.flags & ts.SymbolFlags.Alias) symbol = checker.getAliasedSymbol(symbol);
    if (!symbol || seen.has(symbol)) return [];
    const next = new Set(seen).add(symbol);
    return (symbol.declarations || []).flatMap(declaration => ts.isVariableDeclaration(declaration) ? strings(declaration.initializer, checker, next) : []);
  }
  return [];
}

function createModel(rendererRoot) {
  const sourceFiles = files(rendererRoot).filter(file => /\.(ts|tsx)$/.test(file) && !/\.test\.(ts|tsx)$/.test(file));
  const program = ts.createProgram(sourceFiles, {
    target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler,
    jsx: ts.JsxEmit.ReactJSX, skipLibCheck: true, noEmit: true, allowSyntheticDefaultImports: true,
    baseUrl: path.resolve(rendererRoot, "../.."), paths: { "@shared/*": ["shared/*"] }
  });
  const checker = program.getTypeChecker();
  const designRoot = path.join(rendererRoot, "design-system");
  const classes = new Map(Object.values(definitions).flatMap(([, owner, names]) => names.map(name => [name, owner])));
  function component(node, seen = new Set()) {
    let symbol = checker.getSymbolAtLocation(node);
    while (symbol && !seen.has(symbol)) {
      seen.add(symbol);
      if (symbol.flags & ts.SymbolFlags.Alias) { symbol = checker.getAliasedSymbol(symbol); continue; }
      for (const declaration of symbol.declarations || []) {
        const name = declaration.name?.getText();
        const definition = definitions[name];
        if (definition && path.resolve(declaration.getSourceFile().fileName) === path.join(designRoot, definition[0])) return { name, owner: definition[1] };
        if (ts.isVariableDeclaration(declaration) && declaration.initializer && (ts.isIdentifier(declaration.initializer) || ts.isPropertyAccessExpression(declaration.initializer))) {
          const resolved = component(declaration.initializer, seen);
          if (resolved) return resolved;
        }
        if (ts.isBindingElement(declaration) && ts.isObjectBindingPattern(declaration.parent)) {
          const initializer = declaration.parent.parent.initializer;
          if (initializer) {
            const property = checker.getTypeAtLocation(initializer).getProperty(declaration.propertyName?.getText() || declaration.name.getText());
            const target = property && (property.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(property) : property);
            for (const candidate of target?.declarations || []) {
              const known = definitions[candidate.name?.getText()];
              if (known && path.resolve(candidate.getSourceFile().fileName) === path.join(designRoot, known[0])) return { name: candidate.name.getText(), owner: known[1] };
            }
          }
        }
      }
      break;
    }
    return null;
  }
  const sources = sourceFiles.map(file => program.getSourceFile(file)).filter(Boolean);
  for (const source of sources) {
    function collect(node) {
      if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
        const control = component(node.tagName);
        if (control) for (const key of ["className", "inputClassName", "menuClassName", "backdropClassName"]) {
          const owner = control.name === "Dialog" && strings(attribute(node, "surface")?.initializer, checker).includes("media") ? "image-viewer" : control.owner;
          for (const text of strings(attribute(node, key)?.initializer, checker)) for (const name of text.split(/\s+/)) {
            if (/^[a-zA-Z_][\w-]*$/.test(name) && !stateClasses.has(name)) classes.set(name, owner);
          }
        }
      }
      ts.forEachChild(node, collect);
    }
    collect(source);
  }
  return { sources, checker, classes, component, designRoot };
}

module.exports = { createModel, files, attribute, strings, definitions, ts };
