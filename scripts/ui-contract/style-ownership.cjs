const path = require("node:path");
const selectorParser = require("postcss-selector-parser");

const appearance = /^(?:background(?:-.+)?|border(?:-.+)?|outline(?:-.+)?|box-shadow|color|font(?:-.+)?|line-height|letter-spacing|text-(?:align|decoration(?:-.+)?|transform|shadow)|white-space|padding(?:-.+)?|height|min-height|max-height|opacity|filter|cursor|transition(?:-.+)?|animation(?:-.+)?|transform(?:-.+)?)$/;
const reservedTokens = /^--(?:input-|control-|dialog-|menu-|select-(?:menu-|option-|warning-))/;

function ownerFile(stylesRoot, owner) { return owner === "select" ? path.join(stylesRoot, "components.css") : path.join(stylesRoot, "components", `${owner}.css`); }

/** Inspect selector compounds, excluding :has() arguments and negative matches. */
function selectorOwner(selector, classes) {
  let result = null;
  selectorParser(selectors => {
    selectors.each(selection => {
      let native = null;
      let closest = null;
      let ancestorOwner = null;
      let compoundExcluded = false;
      selection.each(node => {
        if (node.type === "combinator") { native = null; closest = null; compoundExcluded = false; return; }
        if (node.type === "pseudo" && node.value === ":not" && node.toString().includes("[data-ui-control]")) compoundExcluded = true;
        if (node.type === "tag" && ["input", "textarea", "button", "select"].includes(node.value)) native = node.value;
        if (node.type === "class" && classes.has(node.value)) { closest = classes.get(node.value); ancestorOwner = closest; }
        if (node.type === "pseudo" && [":is", ":where"].includes(node.value)) {
          node.walkClasses(token => { if (classes.has(token.value)) { closest = classes.get(token.value); ancestorOwner = closest; } });
          node.walkTags(token => { if (["input", "textarea", "button", "select"].includes(token.value)) native = token.value; });
        }
      });
      if (closest) { result = closest; return; }
      if (ancestorOwner && !["dialogs", "forms"].includes(ancestorOwner) && !compoundExcluded && !native) { result = ancestorOwner; return; }
      if (native && !compoundExcluded) {
        const text = selection.toString();
        if (native === "input" && /\[type\s*=\s*["']?(?:checkbox|radio|file|hidden|range|color|button|submit|reset|image)/.test(text)) return;
        result = native === "button" ? "buttons" : native === "select" ? "select" : "inputs";
      }
    });
  }).processSync(selector);
  return result;
}

/** All branches of :is/:where must respect ownership, not just their last match. */
function selectorOwners(selector, classes) {
  const owners = new Set();
  const primary = selectorOwner(selector, classes);
  if (primary) owners.add(primary);
  selectorParser(selectors => selectors.each(selection => {
    let compound = [];
    selection.each(node => { if (node.type === "combinator") compound = []; else compound.push(node); });
    const positives = new Set();
    let native = null;
    let excluded = false;
    function inspect(node) {
      if (node.type === "pseudo" && [":has", ":not"].includes(node.value)) {
        if (node.value === ":not" && node.toString().includes("[data-ui-control]")) excluded = true;
        return;
      }
      if (node.type === "class" && classes.has(node.value)) positives.add(classes.get(node.value));
      if (node.type === "tag") native = node.value;
      if (node.type === "attribute" && node.attribute === "data-ui-control") {
        const marker = { button: "buttons", input: "inputs", textarea: "inputs", search: "inputs", "input-group": "inputs", "select-trigger": "select", "select-option": "select", "menu-item": "menus", dialog: "dialogs", popover: "menus", dropzone: "uploads", "image-thumbnail": "media" };
        if (marker[node.value]) positives.add(marker[node.value]);
        else for (const owner of Object.values(marker)) positives.add(owner);
      }
      if (node.nodes) for (const child of node.nodes) inspect(child);
    }
    for (const node of compound) inspect(node);
    for (const owner of positives) owners.add(owner);
    if (native === "button" && !excluded && !positives.size) for (const owner of ["buttons", "menus", "select", "uploads", "media"]) owners.add(owner);
  })).processSync(selector);
  return owners;
}

module.exports = { appearance, reservedTokens, ownerFile, selectorOwner, selectorOwners };
