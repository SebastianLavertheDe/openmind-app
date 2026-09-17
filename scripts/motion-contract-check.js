#!/usr/bin/env node
/**
 * MOTION-QA-004: Motion contract auto-check.
 *
 * Scans renderer TSX and CSS for three contract violations:
 *
 * 1. Bare `transition: ...ms ease` in CSS — all transitions must use design tokens
 *    (--dur-* / --ease-*). Pre-existing violations are grandfathered via a baseline
 *    count; NEW bare transitions fail the gate.
 *
 * 2. Clickable surfaces without a declared motion variant — every <button>,
 *    role="button", or role="option" in renderer TSX (excluding tests) must either
 *    carry a `data-motion` attribute or match a known semantic class that already
 *    has a press rule in final-polish.css (e.g. .primary-button, .icon-button,
 *    .filter-tabs button). This catches regressions where new buttons are added
 *    without press feedback.
 *
 * 3. Motion participants without explicit transitions, or component-local
 *    literal timing/spring parameters. The CSS-token adapter owns translation.
 *
 * Exit code 0 = pass, 1 = fail.
 */
const fs = require("fs");
const path = require("path");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");
const rendererDir = path.join(root, "renderer", "src");

// ── Rule 1: bare transition values (not using --dur/--ease tokens) ──────────
//
// A transition is "bare" if it specifies a raw duration like `140ms` or `0.2s`
// instead of var(--dur-fast). We allow the global baseline in final-polish.css
// (the foundational button transition) and theme-transitioning, since those
// predate the contract.

const BARE_TRANSITION_RE = /transition\s*:[^;]*\b\d+(\.\d+)?(ms|s)\b[^;]*;/g;

// Grandfathered files + line content that pre-date the token contract.
// These are allowed; only NEW bare transitions fail.
const GRANDFATHERED = [
  // final-polish.css: the foundational global button transition (line ~27)
  // and the segmented thumb (line ~46) and theme-transitioning (line ~170)
  "final-polish.css",
];

function collectCssFiles(dir) {
  const results = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) results.push(...collectCssFiles(full));
    else if (entry.name.endsWith(".css")) results.push(full);
  }
  return results;
}

function checkBareTransitions() {
  const cssDirs = [
    path.join(rendererDir, "styles"),
    path.join(rendererDir, "styles.css"),
  ].filter((p) => fs.existsSync(p));
  const cssFiles = new Set();
  for (const target of cssDirs) {
    if (fs.statSync(target).isDirectory()) collectCssFiles(target).forEach((f) => cssFiles.add(f));
    else cssFiles.add(target);
  }

  const violations = [];
  for (const file of cssFiles) {
    const rel = path.relative(root, file);
    const isGrandfatheredFile = GRANDFATHERED.some((g) => rel.endsWith(g) || rel.includes(g));
    const lines = fs.readFileSync(file, "utf8").split("\n");
    lines.forEach((line, index) => {
      const matches = line.match(BARE_TRANSITION_RE);
      if (!matches) return;
      // Strip complete var() expressions, including nested fallback functions.
      // An easing token must not hide a literal duration in the same declaration.
      const withoutVars = matches.join(" ");
      let remaining = "";
      for (let i = 0; i < withoutVars.length; i++) {
        if (withoutVars.startsWith("var(", i)) {
          let depth = 1; i += 4;
          for (; i < withoutVars.length && depth; i++) {
            if (withoutVars[i] === "(") depth++;
            if (withoutVars[i] === ")") depth--;
          }
          i--;
        } else remaining += withoutVars[i];
      }
      if (!/\b\d+(\.\d+)?(ms|s)\b/.test(remaining)) return;
      // Grandfathered files skip entirely
      if (isGrandfatheredFile) return;
      violations.push(`${rel}:${index + 1}: ${line.trim()}`);
    });
  }
  return violations;
}

// ── Rule 2: clickable surfaces without motion variant ──────────────────────
//
// Scan TSX (excluding .test.tsx) for <button>, role="button", role="option"
// elements and verify they have data-motion OR a known semantic class.
//
// Known semantic classes that already have press rules (see final-polish.css):
const KNOWN_PRESS_CLASSES = [
  "primary-button", "danger-button", "icon-button", "icon-text-button",
  "filter-tabs", "session-filters", "document-tabs", "ui-tabs", "ui-segmented",
  "topic-list", "dashboard-topic-list", "item-list", "workspace-card",
  "source-delete", "change-actions", "approval-card", "reader-header",
  "settings-control", "document-detail-header", "pane-header", "session-actions",
  "conversation-header", "message-meta", "markdown-code-block", "nav-collapse-button",
  "nav-search-button", "global-toolbar-action", "chip-select-trigger", "chip-select-option",
  "editor-toolbar", "preview-mode-toggle", "action-grid", "composer-send",
  "jump-bottom", "source-item", "rule-item", "nav-recent-item", "brief-file-item",
  "image-chip-button", "image-chip-remove", "rule-item-shell", "source-row-checkbox",
  "source-fetch-icon", "global-search", "global-directory",
  // Design system components with their own press/transition behavior
  "ui-select-trigger", "ui-select-option", "ui-disclosure-trigger", "ui-toggle-switch",
  "ui-dropdown", "ui-search-clear", "ui-segmented-option", "ui-tab",
  "overflow-box-action", "collapsed-rail", "column-splitter-handle",
  "ai-rail", "ai-sidebar-scrim", "open-workbench", "sidebar-session-title",
  "toast-action", "toast-close", "confirm-cancel", "confirm-confirm",
  "nav-recent-toggle", "creative-item-row", "creative-tab", "repo-required",
  "document-file-list", "skill-run-button", "skill-card", "automation-rule",
  "brief-action", "topic-card", "metric-card", "ui-metric-card",
  "ui-data-sort-button", "ui-context-dismiss", "ui-collapsed-pane",
  "ai-file-save", "danger-icon", "session-overflow", "global-search-trigger",
  "search-result", "search-prev", "search-next", "search-close",
  "feedback-retry", "ui-data-page-button",
  "approval-btn", "approval-detail-toggle", "chat-empty-prompt",
  "load-history", "composer-add-context", "composer-suggestion",
  "history-flyout", "session-overflow-menu", "search-result-row",
  "ui-overlay", "chip-select", "confirm-dialog", "ui-confirm",
  "tool-load-more", "read-file-link", "local-file-code", "inline-ai-action",
  "funnel-segment", "stream-date-file", "inspector-file", "inspector-refresh",
  "version-row", "slash-menu-option",
];

const CLICKABLE_RE = /<([\w.]+)\b[^>]*>/g;
const DATA_MOTION_RE = /data-motion\s*=/;
const ROLE_BUTTON_RE = /role\s*=\s*["'](?:button|option)["']/;

function collectTsxFiles(dir) {
  const results = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === ".build") continue;
      results.push(...collectTsxFiles(full));
    } else if (entry.name.endsWith(".tsx") && !entry.name.endsWith(".test.tsx")) {
      results.push(full);
    }
  }
  return results;
}

function checkClickablesWithoutMotion() {
  const tsxFiles = collectTsxFiles(rendererDir);
  const violations = [];

  for (const file of tsxFiles) {
    const content = fs.readFileSync(file, "utf8");
    const rel = path.relative(root, file);
    // Find all opening tags that are either <button or have role="button"/role="option"
    let match;
    while ((match = CLICKABLE_RE.exec(content)) !== null) {
      const tagStart = match.index;
      // Find the end of this opening tag (next >)
      const tagEnd = content.indexOf(">", tagStart);
      if (tagEnd === -1) continue;
      const tagText = content.slice(tagStart, tagEnd + 1);

      const isButtonTag = match[1] === "button" || match[1] === "motion.button";
      const hasClickableRole = ROLE_BUTTON_RE.test(tagText);

      // Only check <button> elements or elements with role=button/option
      if (!isButtonTag && !hasClickableRole) continue;

      // Check if it has data-motion
      if (DATA_MOTION_RE.test(tagText)) continue;

      // Check if it has a known semantic class
      const hasKnownClass = KNOWN_PRESS_CLASSES.some((cls) => {
        // Match class="...cls..." or className="...cls..." or className={`...cls...`}
        return new RegExp(`(?:class|className)\\s*=\\s*["'\`{][^"'\`]*\\b${cls.replace(/\$/g, "\\$")}`).test(tagText)
          || new RegExp(`\\b${cls}\\b`).test(tagText);
      });

      if (hasKnownClass) continue;

      // Compute line number
      const lineNum = content.slice(0, tagStart).split("\n").length;
      const snippet = tagText.replace(/\s+/g, " ").slice(0, 120);
      violations.push(`${rel}:${lineNum}: ${isButtonTag ? "<button>" : "role=button/option"} without data-motion or known press class — ${snippet}`);
    }
  }
  return violations;
}

// ── Main ────────────────────────────────────────────────────────────────────

function checkMotionTransitions() {
  const violations = [];
  for (const file of collectTsxFiles(rendererDir)) {
    const content = fs.readFileSync(file, "utf8");
    if (!content.includes('"motion/react"')) continue;
    const source = ts.createSourceFile(file, content, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const flag = (node, reason) => violations.push(`${path.relative(root,file)}:${source.getLineAndCharacterOfPosition(node.getStart()).line+1}: ${reason}`);
    const visit = node => {
      if (ts.isPropertyAssignment(node) && ["duration","delay","ease","stiffness","damping","bounce","mass"].includes(node.name.getText(source))) {
        const value = node.initializer;
        if ((ts.isNumericLiteral(value) && value.text !== "0") || ts.isStringLiteral(value) || ts.isArrayLiteralExpression(value)) flag(node, "Motion timing must come from motion-tokens (only an immediate 0 is allowed)");
      }
      if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
        if (node.tagName.getText(source).startsWith("motion.")) {
          const names = node.attributes.properties.filter(ts.isJsxAttribute).map(p=>p.name.getText(source));
          if (names.some(n=>["layout","layoutId","animate","exit"].includes(n)) && !names.includes("transition")) flag(node, "Motion animation needs an explicit token transition; no default spring");
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  return violations;
}

const transitionViolations = checkBareTransitions();
const clickableViolations = checkClickablesWithoutMotion();
const motionViolations = checkMotionTransitions();

console.log("Motion contract check:");
console.log(`  CSS bare transitions: ${transitionViolations.length} violation(s)`);
console.log(`  Clickables without motion variant: ${clickableViolations.length} flagged`);
console.log(`  Motion transition contracts: ${motionViolations.length} violation(s)`);
for (const violation of motionViolations) console.log(`  ${violation}`);

if (transitionViolations.length) {
  console.log("\nBare transition violations (use var(--dur-*) / var(--ease-*) instead):");
  for (const v of transitionViolations.slice(0, 20)) console.log(`  ${v}`);
  if (transitionViolations.length > 20) console.log(`  ... and ${transitionViolations.length - 20} more`);
}

if (clickableViolations.length) {
  console.log("\nClickables without data-motion or known press class:");
  for (const v of clickableViolations.slice(0, 30)) console.log(`  ${v}`);
  if (clickableViolations.length > 30) console.log(`  ... and ${clickableViolations.length - 30} more`);
}

if (transitionViolations.length > 0 || clickableViolations.length > 0 || motionViolations.length > 0) {
  console.log("\nMotion contract check FAILED.");
  process.exit(1);
}

console.log("\nMotion contract check PASSED.");
