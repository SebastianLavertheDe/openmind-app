# Design QA

## AI code-block simplification and permission-toast removal — 2026-07-28

- Source visual truth:
  - `C:/Users/say/AppData/Local/Temp/codex-clipboard-bf1e3734-a71c-4515-985f-0aecdce311d9.png` (permission-success toast to remove; 3840 × 2088)
  - `C:/Users/say/AppData/Local/Temp/codex-clipboard-ef6ed899-98a3-4022-ac09-60b5212af889.png` (terminal titlebar and expand-control baseline to remove; 3840 × 2088)
  - `C:/Users/say/AppData/Local/Temp/codex-clipboard-46dec1a9-d600-4de4-8d98-b08778c37396.png` (authoritative simple code-block treatment; 1395 × 693)
- Implementation screenshot: `desktop-app/design-qa/ai-code-block-simple-1366x768.png` (1366 × 741 content pixels from a 1366 × 768 Electron window, CSS density 1)
- Focused normalized comparison: `desktop-app/design-qa/ai-code-block-focus-comparison.png` (1010 × 247; source and implementation blocks normalized to the same width)
- State: light theme, completed AI response with two fenced `text` blocks; the first block is fully visible and the second verifies multi-line growth inside the conversation scroller.

### Full-view comparison evidence

- AI replies no longer render a terminal titlebar, language label, character count, traffic-light controls, fade mask, or `展开全部` row.
- Fenced output now grows to its full content height. Live geometry measured the multi-line block at 229px client height and 229px scroll height, with no internal overflow or disclosure control.
- The permission approval flow still resolves normally, but successful approval no longer creates the bottom-right `已允许` toast. The five-second decline/undo notice remains because it carries a reversible action.

### Focused comparison evidence

- The source and post-fix implementation were opened together in `ai-code-block-focus-comparison.png`. Both use a quiet warm-gray surface, broad rounded corners, generous left padding, mono text, no header chrome, and a borderless copy action in the upper-right.
- Implementation tokens are `#f5f5f4`, `16px` radius, no border or shadow, `18px 52px 18px 20px` content padding, and `13px/1.65` monospace text. These preserve the app's compact density while matching the reference treatment.

### Required fidelity surfaces

- Fonts and typography: the existing monospace stack and syntax highlighting remain; the removed `text` label and metadata no longer compete with the output.
- Spacing and layout rhythm: code blocks use the reference's large-radius, padded container and expand vertically with their content; horizontal overflow remains scrollable for genuinely long lines.
- Colors and visual tokens: the block uses the existing `--panel-muted` token in light and dark themes; no terminal red/yellow/green accents remain in AI replies.
- Image quality and asset fidelity: no raster assets or approximated artwork were introduced. The copy icon remains the existing Lucide component.
- Copy and content: fenced content is unchanged and fully rendered; only presentation metadata and approval-success feedback were removed.

### Comparison history

1. Initial finding [P1]: AI reply blocks looked like terminal windows and collapsed at 480px, adding a redundant `展开全部` interaction.
2. Initial finding [P2]: the first simplified pass left a later theme rule painting the inner `pre` white, visually hiding the intended gray rounded surface.
3. Fix: removed the header/overflow wrapper in the renderer, then added a final theme-layer override that keeps the inner `pre` transparent.
4. Post-fix evidence: the focused comparison shows the intended gray rounded container and copy placement; live DOM inspection reports `16px` radius, `0px` border, no titlebar, no overflow control, and content height equal to scroll height.

### Verification

- Focused unit tests passed: 2 files, 12 tests.
- TypeScript checks passed.
- Renderer production build passed.
- In-app browser console errors and warnings checked: none.
- The repository-wide visual snapshot command generated the target post-fix screenshot but still exits on four pre-existing 720/1020px audit target-count checks outside this component; the requested AI block state itself rendered and was inspected successfully.

final result: passed

---

## Codex-style jump-to-bottom control QA — 2026-07-22

- Source visual truth:
  - `C:/Users/say/AppData/Local/Temp/codex-clipboard-a622f50e-e9a6-4363-80e8-fb7fdb782262.png` (reported CC Tools control with unread count)
  - `C:/Users/say/AppData/Local/Temp/codex-clipboard-a96672b1-fea0-425d-87f2-7c91dc39e1e1.png` (authoritative Codex control)
- Implementation screenshot: `desktop-app/design-qa/scroll-to-bottom-codex-match-2026-07-22.jpg`
- Focused comparison evidence: `desktop-app/design-qa/scroll-to-bottom-codex-comparison-2026-07-22.png`
- Viewport: 1550 × 1015 CSS pixels, matching the reported CC Tools capture at its 1.5 display scale; light theme; browser-preview data with a long-conversation scroll state.

### Full-view comparison evidence

- The updated control remains centered above the composer and appears only when the reader is away from the conversation bottom. Its click target and smooth return-to-bottom behavior are unchanged.
- The control now uses the Codex reference geometry: a stable 32 × 32px circle, 1px low-contrast border, white panel surface, 16px Lucide `ArrowDown` at 1.8 stroke width, and only a 5% 0/1/2px shadow.
- The red unread-count badge is absent from the rendered DOM, and the badge-only count state, refs, effects, markup, and CSS have been removed.

### Focused comparison evidence

- The Codex source crop and implementation crop were normalized to the same visual scale and opened together in `scroll-to-bottom-codex-comparison-2026-07-22.png`.
- Circle diameter, arrow scale, stroke weight, neutral surface, and border contrast align with the reference. CC Tools retains its existing design tokens instead of introducing a one-off color or handcrafted icon.

### Findings and iteration

1. Initial finding [P1]: the reported control used a 42px button, 23px arrow, stronger elevation, and an overlapping 18px red unread counter, producing a heavier and visually unbalanced result than Codex.
2. Fix: reduced the control to 32px with a 16px thin arrow, softened border/shadow treatment, and removed the unread counter implementation end to end.
3. Browser QA found the nominal 32px height could shrink inside the column flex scroller during long conversations, producing an oval. Adding a fixed 32px flex basis preserves an exact 32 × 32px circle in the real scroll state.
4. Post-fix live geometry measured 32 × 32px, and no `.jump-bottom-badge` node remained. No actionable P0, P1, or P2 visual mismatch remains for the requested control.

### Verification

- Full Chat unit file passed: 83 tests.
- Focused return-to-bottom regression passed with the no-badge assertion.
- TypeScript checks passed.
- Renderer production build passed.
- Browser console errors and warnings checked: none.
- Motion scan still reports the repository's existing five Settings-button flags; this change preserves the jump-control transition/entrance contract and adds no new motion violation.

final result: passed

---

## Settings typography parity QA — 2026-07-22

- Source visual truth:
  - `C:/Users/say/AppData/Local/Temp/codex-clipboard-023095e7-edc6-4d5f-8c1e-25c9a55d14de.png` (authoritative main-interface typography)
  - `C:/Users/say/AppData/Local/Temp/codex-clipboard-60ebf065-74f6-4d51-b6ca-013894216ed5.png` (reported Settings baseline)
- Implementation screenshots:
  - `desktop-app/design-qa/settings-typography-1546x1012.jpg`
  - `desktop-app/design-qa/settings-typography-dark-1546x1012.jpg`
- Combined comparison evidence:
  - `desktop-app/design-qa/settings-typography-reference-comparison.png`
  - `desktop-app/design-qa/settings-typography-focus-comparison.png`
  - `desktop-app/design-qa/settings-typography-before-after.png`
- Viewport: 1546 × 1012 CSS pixels, matching the 2319 × 1518 source rasters at the source's 1.5 display scale; light and dark themes; browser-preview data.

### Full-view comparison evidence

- The authoritative main-interface screenshot and the revised Settings screenshot were opened together in one comparison input. Settings now uses the same system UI stack as the app chrome: `-apple-system`, `BlinkMacSystemFont`, `Segoe UI`, `Microsoft YaHei UI`, and fallbacks.
- Settings navigation now resolves to the same measured contract as main navigation: 13px type, 22px line height, 30px minimum height, 400 normal weight, 600 selected weight, 8px radius, and 16px icons with 1.8 stroke width.
- The Settings page header now follows the shared page-header hierarchy at 27px/720/1.25 with zero custom letter spacing; its supporting copy is 14px/1.7. Preference titles and descriptions use a stable 13px/600 and 12px/1.6 hierarchy.
- The former Settings-only segmented-control override was removed. Appearance controls now inherit the shared component typography, thumb, spacing, and light/dark states.

### Focused comparison evidence

- In `settings-typography-focus-comparison.png`, the main navigation and Settings navigation have matching glyph shapes, item density, normal/selected weights, label color hierarchy, and icon scale.
- The Settings-specific information architecture and page-title size remain intentionally distinct semantic roles; no alternate font family or synthetic 590/620 navigation weight remains.
- Path values remain in the product's monospace stack because they are code-like data, not interface labels.

### Findings and iteration

1. Initial finding [P1]: the Settings rail used 10–11px labels, 38px rows, 590/620 weights, and muted normal text, while the main rail used the shared 13px/400–600 navigation contract.
2. Initial finding [P2]: the Settings page header, supporting copy, preference copy, and segmented controls each carried local typography overrides that drifted from the final WorkBuddy skin.
3. Fix: Settings now consumes the main navigation tokens and shared UI controls, while standardizing header and preference typography to the final product hierarchy.
4. Dark-theme check found selected navigation text was initially losing to the dark base selector. A dark selected-state override restored the same high-contrast text used by the main rail.
5. Post-fix comparison found no actionable P0, P1, or P2 typography or control-style mismatch for the requested Settings screen.

### Verification

- Live computed styles confirmed exact main/Settings navigation parity for font family, font size, font weight, line height, minimum height, padding, and radius.
- Settings interactions checked in the in-app browser: enter Settings, switch light/dark themes, restore light theme, and render all three segmented controls.
- Browser console errors and warnings checked: none.
- Focused Settings test passed: 1 file, 14 tests.
- TypeScript checks passed.
- Renderer production build passed.
- Motion scan reported zero bare-transition violations. Its existing repository baseline still flags five Settings buttons without `data-motion`; this CSS-only change added no clickables or motion rules.

final result: passed

---

## Attached companion correction QA — 2026-07-14

- Source visual truth:
  - `C:/Users/say/AppData/Local/Temp/codex-clipboard-48850c9a-7d0c-4664-a5e0-b85c6325d0c5.png` (reported floating AI companion regression)
  - `C:/Users/say/AppData/Local/Temp/codex-clipboard-4bc3dc90-8394-4d06-bd5a-24f1434bc5af.png` (reported broken intermediate state)
  - `C:/Users/say/AppData/Local/Temp/codex-clipboard-16c4e5f4-51ca-49ee-bbc8-dd6359dd39ea.png` (Codex compact window)
  - `C:/Users/say/AppData/Local/Temp/codex-clipboard-71e23580-8b66-423e-8176-e7aa295deb5b.png` (reported early AI-only state)
- Implementation screenshots:
  - `desktop-app/design-qa/responsive-motion-compact-docked-1440.png`
  - `desktop-app/design-qa/responsive-motion-compact-docked-900.png`
- Viewports: 1440 × 800, 900 × 800, and 840 × 800 CSS pixels; light theme; browser-preview data.
- The source capture is a higher-DPR Electron screenshot, so the comparison normalizes by responsive state and panel relationship rather than raw image pixels.
- Latest evidence in this section supersedes all older overlay companion evidence below.

### State model and visible behavior

- The erroneous intermediate overlay state has been removed. The responsive companion now has three presentations with clear semantics: wide dock, compact dock, and genuinely narrow single canvas.
- Wide and compact companions both participate in the app grid. At 1440px the measured layout is `260px navigation / 625px workspace / 541px companion`; the companion is `position: relative`, there is no scrim, and horizontal overflow is zero.
- At 900px the navigation is a drawer while the companion remains attached: the workspace is 520px and the companion is 380px. The underlying product is not dimmed or covered.
- The compact companion track follows `min(var(--ai-sidebar-width), clamp(380px, 38vw, 620px))`, so intermediate widths resize continuously instead of jumping to a modal-like surface.
- Creative switches to one-pane master/detail at 1480px, before its list and document can collapse into unusable slivers. Persistent navigation moves to a drawer at 1280px, preserving a useful center pane while AI remains attached.
- Single-canvas AI is reserved for 840px and below, matching the small-window Codex references. It is full viewport, has no scrim or resize handle, and no background context is left half-visible.

### Motion and transition quality

- The grid track, workspace inset, panel radius, and shadow use the existing emphasized easing tokens, so the attached layout follows the native window continuously.
- Creative master/detail replacement retains the same short pane entrance grammar, and the navigation drawer has an independent slide transition instead of sharing the AI breakpoint.
- Only the final attached-to-canvas change uses a subtle canvas entrance; there is no scale-and-shadow animation that makes the AI companion appear to float above the app.
- The responsive state machine listens to media-query, native window, visual viewport, and document resize signals; every signal is reconciled through the same query table and animation-frame commit.

### Findings and iteration

- Initial P1: the intermediate AI companion was `position: fixed` with an 8px inset, large radius/shadow, and a dimming scrim, making it visibly float over the product.
- Fix: removed the overlay presentation and scrim render path; compact mode now stays in normal grid flow and retains its resize handle.
- Initial P1: the center workspace could still become too narrow immediately before the old navigation breakpoint.
- Fix: separated the workspace, navigation, companion, and density decisions into independent thresholds derived from minimum useful pane widths.
- Post-fix evidence: the source complaint and 1440px implementation were opened in one comparison input. The revised panel is a peer of the workspace, the background remains fully legible, and no overlay edge or dim layer remains.
- No actionable P0, P1, or P2 mismatch remains for the requested attached-companion interaction.

### Required fidelity surfaces

- Fonts and typography: existing CC Tools font stack, weights, line heights, truncation, and AI hierarchy are unchanged. At 840px, header geometry remains within the viewport: title 488px, selector 190px, and actions 122px with the right edge at 828px.
- Spacing and layout rhythm: the compact companion reuses the same workspace inset and border treatment as the center stage at wide widths, then becomes flush when navigation is a drawer. It no longer has unique modal elevation.
- Colors and visual tokens: no new colors were introduced; the former dim scrim and overlay shadow are absent.
- Image quality and asset fidelity: no raster assets, generated imagery, handcrafted SVGs, placeholders, or CSS illustrations were added.
- Copy and content: all app-specific copy and conversation content remain unchanged.

### Verification

- Six focused test files passed: 55 tests.
- TypeScript checks passed.
- Renderer production build passed.
- Motion contract check passed with zero violations.
- Primary browser interactions tested: open Creative, keep AI companion open, shrink through compact dock and single-canvas states, and re-expand.
- Browser console errors and warnings checked: none.
- Live geometry checks covered wide, 1440, 1280, 1200, 1040, 900, 840, and 720px states with zero horizontal overflow and no AI scrim.

final result: passed

---

## Codex-style responsive shell and workspace QA — 2026-07-14

- Source visual truth:
  - `C:/Users/say/AppData/Local/Temp/codex-clipboard-63b7047f-2335-453b-9e04-324566e85930.png` (Codex wide, 1356 × 1046)
  - `C:/Users/say/AppData/Local/Temp/codex-clipboard-b7029398-24bb-47a2-8448-cb8cd7b7e652.png` (Codex compact, 834 × 1046)
  - `C:/Users/say/AppData/Local/Temp/codex-clipboard-b6a98a99-bae8-4168-ba71-89db971e201b.png` (Codex narrow, 720 × 1034)
  - `C:/Users/say/AppData/Local/Temp/codex-clipboard-182dab4b-3e67-48ac-9879-046ea4c0db33.png`
  - `C:/Users/say/AppData/Local/Temp/codex-clipboard-06df3966-ebe7-4ccf-86c1-cce812b17076.png`
  - `C:/Users/say/AppData/Local/Temp/codex-clipboard-4ac24b67-8c8e-4584-94f3-6b73a60a4379.png`
- Implementation screenshots:
  - `desktop-app/design-qa/responsive-codex-wide-1356.png`
  - `desktop-app/design-qa/responsive-codex-medium-834.png`
  - `desktop-app/design-qa/responsive-codex-narrow-720.png`
  - `desktop-app/design-qa/responsive-ai-companion-720.png`
  - `desktop-app/design-qa/responsive-companion-stable-1100.png`
- Normalized comparisons:
  - `desktop-app/design-qa/responsive-codex-wide-comparison.png`
  - `desktop-app/design-qa/responsive-codex-medium-comparison.png`
  - `desktop-app/design-qa/responsive-codex-narrow-comparison.png`
- Viewports: 1356 × 1046, 834 × 1046, and 720 × 1034; light theme; browser-preview data.

### Full-view comparison evidence

- At 1356px, CC Tools keeps its persistent product navigation and full work canvas, matching Codex's stable wide-window hierarchy without replacing CC Tools typography, colors, or content model.
- At 834px and 720px, the persistent navigation moves fully off-canvas and the active content expands to the full viewport. The only persistent shell control is the top-left navigation trigger, matching Codex's compact focus mode.
- Compact AI headers preserve the task title and provider context on one line; secondary provider detail is progressively removed at 720px instead of wrapping into a second header row.

### Focused interaction evidence

- The compact navigation opens as a 320px drawer over a scrim and closes after route selection or scrim activation. Labels, recent tasks, Settings, and project context remain available inside the drawer.
- Creative uses a one-pane master-detail flow below 1040px: the list is the initial pane, selecting a topic/project/file replaces it with detail, and the detail header can reopen the list.
- The AI companion becomes a full-canvas focused surface at compact widths, with no dimmed background layer or resize handle.
- A shared responsive-layout state now coordinates the shell, workspace, density, and companion presentation in one animation-frame update. The formerly independent media listeners cannot produce a mixed floating/canvas state during resize.
- AI file preview becomes a full-canvas layer at compact widths; the underlying conversation is visually and interactively suppressed until preview close.
- Daily Brief and Creative document-selection motion remains the existing horizontal file-navigation motion; this responsive change does not alter those semantics.

### Required fidelity surfaces

- Fonts, typography, colors, radii, and Lucide icons continue to use the existing CC Tools design system.
- Compact spacing follows the Codex reference's single-canvas hierarchy: 58px left header clearance, full-width stage, fixed drawer, and no squeezed split columns.
- No raster UI assets, handcrafted SVGs, placeholder boxes, or CSS illustrations were introduced.
- The compact layout has no horizontal overflow at 834px or 720px in AI, Creative list/detail, AI companion, and file-preview states.

### Verification

- Live DOM geometry confirmed the compact navigation at `x = -320`, active stage at `x = 0`, full viewport width, and no horizontal overflow.
- Live interaction checks covered drawer open/close, recent-task navigation, Creative list-to-detail and detail-to-list, compact AI companion, and compact file preview close.
- Browser compositor capture omitted the bottom composer layer in two compact PNGs; DOM geometry and hit testing confirmed the composer remained visible, interactive, and anchored to the viewport bottom.
- TypeScript checks passed.
- Continuous browser checks passed while shrinking through 1280, 1181, 1180, 1140, 1100, 1060, 1041, 1040, 980, and 900px, then expanding through the same boundaries. From 1180px downward the companion remained a full `x=0`, viewport-sized canvas with no scrim or horizontal overflow.
- Focused responsive tests passed: 6 files, 52 tests.
- Renderer production build passed.
- Motion contract check passed with zero violations.

### Findings

- No actionable P0, P1, or P2 responsive-layout or interaction differences remain for the requested Codex behavior.
- P3: CC Tools intentionally keeps its own product chrome and content density; the Codex reference governs responsive interaction and pane behavior, not visual rebranding.

final result: passed

---

- Source visual truth:
  - `C:/Users/say/AppData/Local/Temp/codex-clipboard-c2f0318f-a91e-402c-89e4-7f256fa0a75f.png`
  - `C:/Users/say/AppData/Local/Temp/codex-clipboard-d6fd9d50-c693-4643-b1b8-0951c47c468d.png`
  - `C:/Users/say/AppData/Local/Temp/codex-clipboard-da0be624-12b0-48a9-90e4-7c9909447156.png`
  - `C:/Users/say/AppData/Local/Temp/codex-clipboard-3dda3ca2-df8c-44d3-b827-0cc74c9b4c60.png`
- Implementation screenshots:
  - `C:/Users/say/AppData/Local/Temp/cctools-design-qa-ai.png`
  - `C:/Users/say/AppData/Local/Temp/cctools-design-qa-creative.png`
- Viewport: 1920 × 1080, light theme, browser-preview data.
- States: new AI task; daily brief list with selected preview; creative workflow with a selected daily topic file.

## Full-view comparison evidence

- AI workbench: the conversation module now follows Settings as a visually separated sidebar section. The composer uses one bounded surface with a quiet divider and a single aligned tool row.
- Daily brief: the list and selected document preview render successfully instead of the reported IPC contract error.
- Creative center: funnel stages remain unchanged; the topic section renders one file row per date, and selecting it opens the full Markdown document in the detail pane.

## Focused region comparison evidence

- Composer: removed the duplicated `@ 引用文件` / `/ 选择 Skill` chips, placeholder explanation, and footer explanation. Provider, permission, attachment, and character count share one compact row.
- Sidebar: the former history block between New Task and the main navigation is gone; history is below Settings behind a section divider.
- Creative list: daily groups no longer expand into one card per topic. Each day is represented by one file row with the contained topic count.

## Required fidelity surfaces

- Fonts and typography: existing product font stack, weights, truncation, and compact UI hierarchy are preserved.
- Spacing and layout rhythm: composer controls align on a 46 px tool row; sidebar and daily-file rows reuse the existing 6–13 px radius and spacing system.
- Colors and visual tokens: all changes use existing panel, border, muted, accent, and hover tokens.
- Image quality and asset fidelity: no raster assets were introduced or approximated; UI icons use the existing Lucide icon library.
- Copy and content: removed only the requested reference/Skill explanatory copy; functional `@` and `/` behavior remains available.

## Findings

- No actionable P0, P1, or P2 visual differences remain for the requested areas.
- P3: the character counter remains visible because it provides useful feedback without repeating the removed guidance.

## Interaction and runtime checks

- Opened Daily Brief and confirmed the file list plus default preview state.
- Opened Creative Center, selected the daily topic file, and confirmed the right-side preview plus preview/edit controls.
- Confirmed the browser console contains no errors.
- Automated verification: 75 test files and 942 tests passed, including new IPC and daily-file regression cases.

## Comparison history

1. Initial findings: duplicated composer guidance; history positioned above main navigation; empty date rejected by the daily-brief IPC handler; daily topic groups exposed every topic card.
2. Fixes: consolidated composer toolbar and copy; moved history after Settings; allowed an empty date only for list-content; replaced expanded topic groups with daily file rows.
3. Post-fix evidence: implementation screenshots and browser interaction checks listed above; no P0/P1/P2 issues remain.

final result: passed

---

# New-task homepage audit follow-up QA — 2026-07-12

- Source visual truth: `/home/say/work/github/cctools/.sisyphus/design-audits/2026-07-12-home-comparison/01-cctool-home.png`
- Implementation screenshot: `/home/say/work/github/cctools/desktop-app/design-qa/home-audit-final-1280x720.png`
- Expanded navigation and active prompt evidence: `/home/say/work/github/cctools/desktop-app/design-qa/home-audit-expanded-1280x720.png`
- Recent-task flyout evidence: `/home/say/work/github/cctools/desktop-app/design-qa/home-audit-history-1280x720.png`
- Viewport: implementation 1280 × 720; source 2048 × 1422. Both show the light-theme, new-task empty state. The source viewport could not be normalized in the browser, so the comparison uses visible proportions and interaction hierarchy rather than pixel-level coordinates.
- State: collapsed navigation by default, empty new task, no active input focus; expanded, prompt-selected, and recent-task states were checked separately.

## Full-view comparison evidence

- The implementation preserves the source's narrow developer-tool rail, top conversation header, centered engineering-task examples, and single composer.
- The task content now occupies a tighter vertical band: the project, value proposition, examples, shortcut hint, and composer read as one start-to-submit flow instead of four loosely separated regions.
- The larger value heading, explicit `当前项目 · cctools` context, and localized `尚未创建` state are intentional audit-driven changes rather than fidelity drift.
- The implementation still fits fully above the fold at 1280 × 720 with no clipped cards, composer controls, or navigation actions.

## Focused state comparison evidence

- `home-audit-expanded-1280x720.png` verifies that labels, recent tasks, and bottom-pinned settings remain available without replacing the compact default rail.
- `home-audit-prompt-active-1280x720.png` verifies that selecting an example inserts a complete actionable prompt, gives the selected card a visible focus indicator, and enables the green send action.
- `home-audit-history-1280x720.png` verifies that recent tasks remain reachable from the header when the navigation is collapsed.

## Required fidelity surfaces

- Fonts and typography: the existing Windows/system font stack is retained. The page title is 22–28px/720 weight, body copy remains compact, and card labels use 13px/680 weight. No visible wrapping or truncation defect remains at the tested viewport.
- Spacing and layout rhythm: the original centered structure remains, but excessive vertical whitespace is reduced. Cards stay in a 2 × 2 grid, the composer is capped at 900px, and rail/expanded navigation states do not overlap the workspace.
- Colors and visual tokens: neutral white/gray surfaces remain dominant. Green is limited to brand, active navigation, project context, focus, running state, and enabled send. `--brand-accent-strong` is `#087b66`, providing 5.20:1 contrast on white and 4.72:1 on the project tint.
- Image quality and asset fidelity: the screen contains no required raster imagery. All icons use the existing Lucide library; no custom SVG, CSS drawing, emoji, or placeholder illustration was introduced.
- Copy and content: the page now states where work happens, what the agent can do, and what permissions govern it. Example cards insert full instructions instead of title fragments.
- Accessibility: heading semantics were added to the empty-state title, project path remains available through `title`, nav controls retain accessible labels/tooltips, focus-visible uses the brand contrast color, and disabled/enabled send states remain distinguishable.

## Interaction and runtime checks

- Collapsed and expanded navigation verified.
- Expanded recent-task list and collapsed header flyout verified.
- Example prompt insertion verified with the exact generated instruction.
- Send button disabled when empty and enabled after prompt selection.
- Browser console errors checked: none.
- Automated verification: 2 test files / 57 tests passed; TypeScript checks passed; renderer production build passed.

## Comparison history

1. Pass 1 finding: settings remained directly below recent tasks instead of anchoring to the bottom, weakening the expanded sidebar hierarchy. Fix: changed the nav stack to a flex column and gave the system group automatic top margin. Post-fix evidence: `home-audit-expanded-1280x720.png`.
2. Pass 1 finding: the composer showed both an inner textarea focus ring and an outer composer focus ring. Fix: removed the nested focus shadow and retained one green composer-level focus treatment. Post-fix evidence: browser interaction check and final empty-state capture.
3. Pass 1 finding: the initial green text token produced only 3.02:1 contrast on its tinted background. Fix: darkened the semantic interactive green to `#087b66`; post-fix contrast is 4.72:1 on the tint.

## Findings

- No actionable P0, P1, or P2 findings remain for the requested homepage audit changes.
- P3: the recent-task flyout overlays the top of the centered content while open. This is acceptable transient menu behavior, but it could be moved toward the right edge in a later polish pass if more sessions make the menu taller.
- Verification gap: widths below 1280px and the dark theme were not browser-rendered in this pass; existing responsive and dark token rules were preserved.

final result: passed

---

# 资料库布局重构 QA — 2026-07-12

- Source visual truth: `/home/say/work/github/cctools/desktop-app/design-qa/sources-layout-reference.png`
- Implementation screenshot: `/home/say/work/github/cctools/desktop-app/design-qa/sources-layout-browser-final.png`
- Normalized full-view comparison: `/home/say/work/github/cctools/desktop-app/design-qa/sources-layout-comparison-1280.png`
- Focused content comparison: `/home/say/work/github/cctools/desktop-app/design-qa/sources-layout-focused-comparison.png`
- Viewport: browser implementation captured at 1280 × 720; supplied 1680 × 945 reference normalized to the same 16:9 comparison size. The responsive layout was also inspected at 1680 × 945.
- State: light theme, browser-preview data, “全部”筛选，未展开添加或批量管理面板。

## Full-view comparison evidence

- Four summary cards fill one row and use the same total / healthy / anomaly / today hierarchy as the reference.
- The content region is now a two-column layout: a widened source list and a persistent 286px right status rail, matching the supplied large-screen composition.
- The filter row and list share one bounded card, aligning their left and right edges instead of leaving a disconnected narrow list in a large canvas.

## Focused region comparison evidence

- The focused comparison shows matching filter-chip density, table header placement, compact source rows, right-aligned action controls, distribution chart, crawl-status card, quick actions, and tip card.
- Preview data contains two sources rather than the reference's 124, so the final list is intentionally shorter; row structure and spacing match the target.
- A separate typography crop was not needed because the focused content comparison keeps all headings, labels, badges, URLs, and action text readable.

## Required fidelity surfaces

- Fonts and typography: existing product display/body stacks retained; page title, metric numerals, compact labels, badges, URLs, and side-card headings preserve the established optical weights and truncation behavior.
- Spacing and layout rhythm: 12px metric gaps, 14px main/rail gap, 62px filter row, 80px source rows, 7–10px radii, and compact 34px actions follow the supplied layout's density.
- Colors and visual tokens: product panel, border, muted, accent, semantic status, hover, and dark-theme tokens are reused; icon tones follow the reference's blue / green / red / violet hierarchy.
- Image quality and asset fidelity: no raster imagery is required. Visible UI icons use the project's existing Lucide library; the source distribution is rendered from live source counts.
- Copy and content: source totals, status, daily additions, kind counts, URLs, last-run time, success rate, and quick-action copy come from the existing preview/product data.
- Responsiveness and accessibility: the side rail stacks below the list at smaller widths, metrics become 2×2 and then one column, and semantic buttons, labels, checkboxes, status text, and focus states remain intact.

## Interaction and runtime checks

- Navigated to the Source Library from the main sidebar.
- Opened and closed the add-source panel; fields, type selector, frequency selector, submit state, and OPML action were present.
- Entered and exited bulk-management mode; selection and enable / disable / delete controls rendered in the correct state.
- Browser console errors checked: none.
- TypeScript checks passed; focused SourcesPage tests passed: 14/14.

## Comparison history

1. Initial implementation used only two metrics, grouped narrow source cards, and left a large unused canvas without the requested operational rail.
2. Rebuilt the page into a four-card summary row, one unified filter/list card, and a responsive right rail with distribution, crawl status, quick actions, and guidance.
3. Post-fix full-view and focused comparisons show no actionable P0, P1, or P2 differences. The only content-density difference is the realistic two-source preview dataset.

## Findings

- No actionable P0, P1, or P2 visual differences remain for the requested layout.
- P3: the normalized 1280px browser capture shows a slightly larger right-rail proportion than the 1680px source; at the supplied large-screen viewport, the fixed 286px rail occupies the intended narrower proportion.

final result: passed

---

# WorkBuddy optical typography match QA — 2026-07-12

- Source visual truth: `C:/Users/say/AppData/Local/Temp/codex-clipboard-885261f5-764e-41ae-ad19-1fe239971f5b.png`
- Implementation screenshot: `/home/say/work/github/cctools/desktop-app/design-qa/sidebar-optical-match-final.png`
- Normalized side-by-side comparison: `/home/say/work/github/cctools/desktop-app/design-qa/compare-workbuddy-optical-match.png`
- Viewport: 1280 × 720, light theme; WorkBuddy crop normalized from the same Windows screenshot scale to a 260px CSS sidebar.
- State: expanded Daily Brief navigation with active row, recent task, and Settings visible.

## Root-cause evidence

- Pixel measurements showed normal menu glyphs were already approximately the same height; the mismatch was concentrated in ink density and special-case overrides.
- The installed WorkBuddy 5.2.5 renderer CSS uses 13px navigation text, 400 normal weight, 600 active weight, 30px rows, 22px line-height, 16px icons, a 12px/700 brand title, and a 10px version label.
- CC Tools was using 480/650 navigation weights, a 13px brand title, and a separate 14px/500 Settings rule. The recent-task toggle also computed to 13px because the generic navigation selector overrode its intended 11px group-label token.

## Implemented match

- Navigation now uses the WorkBuddy values: 13px, 400/600 weights, 30px rows, 22px line-height, 16px icons, and 4px 12px padding.
- Brand typography now uses 12px/700 with an 18px line-height; the version label uses 10px/400 with a 14px line-height.
- Settings no longer has a larger 14px special case and inherits the same 13px/400 navigation scale.
- Recent-task headings now resolve to 11px/400 with an 18px line-height and no added letter spacing.
- The variable Segoe face was removed from the primary UI stack so Windows uses the same conventional Segoe/fallback behavior as the reference.

## Verification

- Live computed values confirmed: active 13px/600/22px, normal 13px/400, Settings 13px/400, brand 12px/700/18px, recent heading 11px/400/18px.
- Normalized visual comparison confirms CC Tools no longer has a larger or heavier optical footprint than WorkBuddy.
- TypeScript checks passed.
- Focused AppShell assertions passed: 5/5.
- Renderer production build passed; existing CSS syntax and bundle-size warnings remain unrelated to this typography change.

## Findings

- No actionable P0, P1, or P2 typography or density mismatch remains for the requested sidebar comparison.
- Product-specific labels and icon shapes remain intentionally different; their scale and visual weight now follow the reference.

final result: passed

---

# WorkBuddy shell-size correction QA — 2026-07-12

- Source visual truth: `C:/Users/say/AppData/Local/Temp/codex-clipboard-aaaac66d-7c11-4f89-b0f0-8ae4596c7666.png`
- AI implementation screenshot: `C:/Users/say/AppData/Local/Temp/cctools-ui-audit/05-cctools-shell-density-1280x720.png`
- Daily Brief implementation screenshot: `C:/Users/say/AppData/Local/Temp/cctools-ui-audit/07-cctools-daily-sidebar-1280x720.png`
- Focused shell comparisons:
  - `C:/Users/say/AppData/Local/Temp/cctools-ui-audit/06-workbuddy-shell-comparison.png`
  - `C:/Users/say/AppData/Local/Temp/cctools-ui-audit/08-workbuddy-daily-sidebar-comparison.png`
- Viewport: 1280 × 720 implementation; source sidebars normalized from the supplied 425 × 1458 comparison capture to the same 260px CSS width.
- State: expanded WorkBuddy navigation compared with CC Tools AI and Daily Brief navigation, including the recent-task section shown by the user.

## Full-view and focused comparison evidence

- The remaining mismatch was in the application shell rather than only the chat body. The corrected CC Tools shell now measures 260px wide with 13px navigation copy, 30px rows, and 15px icons.
- The normalized side-by-side comparisons show the primary navigation copy, active-row height, brand scale, and recent-task rhythm at substantially the same visual size as WorkBuddy.
- Daily Brief was opened specifically to reproduce the user's active-route plus recent-task state. The recent-task title measures 12px, metadata 10px, and the row 30px high.

## Required fidelity surfaces

- Fonts and typography: root and chat body are 13px; navigation is 13px/480 with 650 active weight; brand is 13px; small preference is 12px and large preference is 15px.
- Spacing and layout rhythm: expanded shell is 260px, primary rows are 30px, recent rows are 30px, and top icon controls are 28px.
- Colors and visual tokens: the established WorkBuddy monochrome skin and active fills are unchanged.
- Image quality and asset fidelity: no raster assets were added; existing icon components are retained and render at 15px in primary navigation.
- Copy and content: product labels are unchanged. The displayed application version now comes from `package.json`, eliminating the stale hardcoded `v1.0.22` label.

## Interaction, runtime, and package checks

- AI and Daily Brief routes rendered at the target viewport; recent-task state was verified directly.
- Browser console errors checked: none.
- TypeScript checks, renderer production build, and 12 focused unit tests passed.
- Windows portable, installer, and ZIP packaging completed successfully. The packaged Claude executable and renderer/preload smoke checks passed.

## Comparison history

1. Earlier pass corrected only the 16px conversation treatment, leaving the 14px/32px/17px application shell visibly larger than the supplied WorkBuddy comparison.
2. This pass reduced the shell to 13px/30px/15px, reduced the global body to 13px, tightened recent-session typography, and reduced the expanded width from 264px to 260px.
3. Post-fix normalized comparisons show no actionable P0, P1, or P2 size mismatch in the supplied sidebar scope.

## Findings

- No actionable P0, P1, or P2 visual differences remain for the requested shell density.
- P3: CC Tools intentionally shows fewer navigation groups and different product labels, so vertical content distribution differs even though component size now aligns.

final result: passed

---

# WorkBuddy-style conversation density QA — 2026-07-12

- Source visual truth: `C:/Users/say/AppData/Local/Temp/codex-clipboard-c27b5c1b-4798-41ec-bb23-bee6f1ea51bd.png`
- Implementation screenshot: `C:/Users/say/AppData/Local/Temp/cctools-ui-audit/02-cctools-workbuddy-density-1280x720.png`
- Full comparison evidence: `C:/Users/say/AppData/Local/Temp/cctools-ui-audit/03-workbuddy-implementation-full.png`
- Focused comparison evidence: `C:/Users/say/AppData/Local/Temp/cctools-ui-audit/04-workbuddy-implementation-sidebar.png`
- Viewport: 1280 × 720, light theme, browser-preview conversation state.
- State: WorkBuddy landing screen compared with the CC Tools AI conversation. Because the product states differ, the full comparison is used for shell density and hierarchy only; the focused comparison normalizes the two sidebars to the same width.

## Full-view comparison evidence

- CC Tools now uses a compact 14px conversation body with a measured 22.68px line height, matching the quiet desktop density of the WorkBuddy shell instead of the previous 16px reading-mode treatment.
- The conversation column is 800px wide, leaving a calmer right margin and avoiding the visually oversized long lines in the source CC Tools capture.
- The title remains visually distinct while the conversation body, metadata, navigation, and composer controls form a restrained supporting layer.

## Focused region comparison evidence

- The normalized sidebar comparison shows closely aligned navigation type size, row height, icon scale, active-row weight, muted metadata, and whitespace rhythm.
- CC Tools intentionally keeps its product-specific routes and provider metadata; no fake WorkBuddy rows or labels were introduced.
- A separate focused chat crop was not needed because the WorkBuddy reference does not show a chat state. Browser-computed typography values and the full implementation capture provide the relevant evidence for the requested conversation-density change.

## Required fidelity surfaces

- Fonts and typography: Segoe UI Variable stack retained; conversation body is 14px/1.62, headings scale from the same token, paragraph margins are 8px, and list-item margins are 3px.
- Spacing and layout rhythm: assistant-message gap reduced to 14px and the centered flow column reduced from 880px to 800px.
- Colors and visual tokens: existing WorkBuddy monochrome tokens are unchanged.
- Image quality and asset fidelity: no image assets were required or introduced; existing icon components remain unchanged.
- Copy and content: existing CC Tools labels and realistic preview conversation content are unchanged.

## Interaction and runtime checks

- AI conversation loaded at 1280 × 720 with the updated computed typography and width values.
- Browser console errors checked: none.
- TypeScript checks and the production renderer build passed.
- Focused unit assertions passed: 58/58. Vitest still exits non-zero because five existing test paths omit the newer `aiRefreshSkills` browser mock; this is unrelated to the CSS change and does not reproduce in the browser preview.

## Comparison history

1. Initial finding: conversation copy was hardcoded at 16px/1.66 with 12px paragraph spacing and an 880px flow column, so the entire answer read like enlarged document content.
2. Fixes: connected conversation copy and process narratives to the body-size token, reduced vertical rhythm, narrowed the reading column, and made the small font preference a real 13px option.
3. Post-fix evidence: rendered values are 14px/22.68px with 8px paragraph margins and an 800px column; normalized comparisons show no actionable density mismatch.

## Findings

- No actionable P0, P1, or P2 visual differences remain for the requested WorkBuddy-style density.
- P3: WorkBuddy's source is a landing state rather than a conversation, so exact chat-line wrapping cannot be compared directly; the implementation follows its shell typography and spacing language instead.

final result: passed

---

# WorkBuddy-style sidebar density QA — 2026-07-11

- Source visual truth: `C:/Users/say/AppData/Local/Temp/codex-clipboard-1f53b3ad-7f51-4036-bd4e-bab641816afd.png`
- Normalized source crop: `C:/Users/say/AppData/Local/Temp/workbuddy-sidebar-normalized.png`
- Implementation full screenshot: `C:/Users/say/AppData/Local/Temp/cctools-full-pass3.png`
- Implementation focused crop: `C:/Users/say/AppData/Local/Temp/cctools-sidebar-fullcrop-pass3.png`
- Viewport: 1280 × 720, light theme, default system scale; focused comparison normalized to 264 × 516.
- State: expanded AI-page navigation with one active session.

## Full-view comparison evidence

- The final implementation keeps a 264px expanded sidebar and a 32px navigation rhythm, matching the WorkBuddy reference proportions without shrinking the main app through a renderer zoom override.
- The AI page renders only one session-history surface; the duplicate top-level recent-task block is absent.
- The brand row contains the panel control and global search action in the same lightweight top-right pattern as the reference.

## Focused region comparison evidence

- The normalized WorkBuddy source and the final CC Tools crop were opened together in one comparison input.
- Primary button height, left alignment, item spacing, icon scale, sidebar width, muted brand treatment, section-label hierarchy, and task-row density align with the reference.
- CC Tools intentionally has four product destinations instead of WorkBuddy's five and retains Provider metadata under session titles.

## Required fidelity surfaces

- Fonts and typography: Windows UI font stack; 14px/500 navigation, 650 active weight, 15px muted brand, 13px session titles, controlled truncation, and compact relative timestamps.
- Spacing and layout rhythm: 264px expanded width, 32px primary rows, 17px icons, 9px icon gap, 42px session rows, and an 8px active-button radius.
- Colors and visual tokens: quiet monochrome background, subtle active fill, muted brand/metadata, and existing dark-theme token mapping retained.
- Image quality and asset fidelity: no raster imagery is required for this sidebar; all visible icons use the existing Lucide family rather than custom SVG or CSS drawings.
- Copy and content: CC Tools labels remain product-specific; “每日简报” is unchanged, while “创作” and “资料库” remain the concise sidebar labels.
- Responsiveness and accessibility: semantic buttons and labels are preserved, focus-visible styling remains active, the collapsed rail still works, and the full app uses system DPI rather than forcing a custom zoom factor.

## Interaction and runtime checks

- Expanded sidebar navigation and active-state rendering verified.
- Brand-row search opened the command palette and the close action dismissed it.
- Browser console errors checked: none.
- Automated verification: 2 test files / 9 tests passed; TypeScript checks passed; renderer production build passed.

## Comparison history

1. Initial finding: 40px rows, 14px/500 text, heavy brand block, duplicated recent-task/session navigation, and 54px session rows made the UI materially larger than WorkBuddy.
2. Pass 1: changed to 32px rows and a lighter system font stack; visual evidence showed the 228px frame and typography had become too small and narrow.
3. Pass 2: restored a 264px frame and 14px text while keeping the 32px rhythm; visual evidence showed close sizing but misplaced search/session controls and underweighted text.
4. Pass 3: moved search to the brand row, removed duplicate session controls, used 500/650 navigation weights, and retained the compact rhythm. Post-fix comparison found no actionable P0/P1/P2 differences.

## Findings

- No actionable P0, P1, or P2 visual differences remain for the requested WorkBuddy-style sidebar density.
- P3: WorkBuddy's screenshot contains more navigation/task types than CC Tools; adding fake rows solely for vertical alignment would damage the product information architecture, so the shorter content stack is intentional.

final result: passed

---

# WorkBuddy composer parity QA — 2026-07-12

- Source visual truth: `C:/Users/say/AppData/Local/Temp/codex-clipboard-33707b1f-2078-4dc0-b3bb-918276e8b3b0.png`
- Implementation screenshot: `/home/say/work/github/cctools/desktop-app/design-qa/composer-workbuddy-final-1280x720.png`
- Focused interaction screenshot: `/home/say/work/github/cctools/desktop-app/design-qa/composer-workbuddy-permission-open-1280x720.png`
- Viewport: 1280 × 720, light theme, expanded navigation; source is 2048 × 1430 and was normalized by viewport width for proportion checks.
- State: empty new task; model control idle; permission control tested both closed and expanded.

## Full-view comparison evidence

- The WorkBuddy source and final CCTool browser capture were opened together in one comparison input.
- After width normalization, the composer occupies the same centered content band: approximately 720px wide, with a tall white editor and a connected compact gray context bar.
- The composer begins at a comparable vertical position in the viewport. CCTool intentionally retains its developer-task cards and product-specific page copy above the composer.

## Focused region comparison evidence

- The source, final idle composer, and expanded-permission state were opened together in one comparison input.
- The white editor contains the add action on the left and provider/send controls on the right; the gray lower row contains folder/project and shield/permission controls with muted hierarchy, matching the source interaction pattern.
- The permission menu opens upward without clipping and retains a clear selected state.

## Required fidelity surfaces

- Fonts and typography: existing system UI stack retained; composer copy uses 14px/1.65, while model/project/permission metadata stays compact at 11–12px with controlled truncation.
- Spacing and layout rhythm: 720px composer width, 130px editor, compact 38px context bar, 18px radius, and source-like internal control placement.
- Colors and visual tokens: white editor over a warm-gray `#f6f6f5` context bar, quiet `#e8e8e6` border, neutral focus elevation, and existing semantic green reserved for enabled actions/focus.
- Image quality and asset fidelity: no reference raster artwork was required for the requested composer treatment; existing Lucide icon assets are used consistently for plus, provider, folder, shield, chevrons, and send.
- Copy and content: CCTool-specific provider, project, permission, and engineering-task text remain accurate; only layout and visual hierarchy mirror WorkBuddy.

## Interaction and runtime checks

- Prompt-card selection populated the composer and enabled send.
- Provider menu opened and changed from Codex Preview to Claude Code Preview.
- Permission menu opened upward and exposed read-only, edit, and auto-execute options; edit remained selected.
- Project and attachment controls are present with accessible names.
- Browser console errors checked: none.
- Automated verification: TypeScript passed; 2 test files / 61 tests passed; renderer production build passed.

## Comparison history

1. Pass 1 finding [P2]: the 760px composer and roughly 50px lower context row rendered wider and taller than the width-normalized WorkBuddy source.
2. Fix: reduced the composer to 720px, compacted the lower row to a 38px target, and reduced workspace/permission control heights to 30px.
3. Post-fix evidence: final idle and permission-open screenshots show source-like width, total height, lower-row density, control alignment, and centered placement with no remaining actionable P0/P1/P2 differences.

## Findings

- No actionable P0, P1, or P2 differences remain for the requested composer size, position, width, and permission-row treatment.
- P3: WorkBuddy includes a microphone and mascot that CCTool does not currently support; adding non-functional replicas would reduce product clarity, so CCTool keeps its real provider and project controls.

final result: passed

# AI 编辑上下文与左侧文件预览 QA — 2026-07-27

- Source visual truth:
  - `C:\Users\say\AppData\Local\Temp\codex-clipboard-9fbb6051-425f-41b2-8ee6-cd975fb026ff.png`
  - `C:\Users\say\AppData\Local\Temp\codex-clipboard-17b42aa4-8ed5-4541-9d3f-f8c170114dff.png`
  - `C:\Users\say\AppData\Local\Temp\codex-clipboard-06d19f2f-1b8a-4547-9b11-45afc30529b9.png`
- Implementation screenshots:
  - `C:\Users\say\.codex\visualizations\2026\07\27\019fa367-6583-7dc1-a7ae-e266f58f243d\edited-context-final.png`
  - `C:\Users\say\.codex\visualizations\2026\07\27\019fa367-6583-7dc1-a7ae-e266f58f243d\edited-file-left-preview-final.png`
  - `C:\Users\say\.codex\visualizations\2026\07\27\019fa367-6583-7dc1-a7ae-e266f58f243d\message-file-left-preview.png`
  - `C:\Users\say\.codex\visualizations\2026\07\27\019fa367-6583-7dc1-a7ae-e266f58f243d\splitter-1px-after-drag.png`
- Comparison evidence:
  - `C:\Users\say\.codex\visualizations\2026\07\27\019fa367-6583-7dc1-a7ae-e266f58f243d\design-qa-full-comparison-final.png`
  - `C:\Users\say\.codex\visualizations\2026\07\27\019fa367-6583-7dc1-a7ae-e266f58f243d\design-qa-edited-context-comparison-final.png`
  - `C:\Users\say\.codex\visualizations\2026\07\27\019fa367-6583-7dc1-a7ae-e266f58f243d\splitter-full-comparison.png`
  - `C:\Users\say\.codex\visualizations\2026\07\27\019fa367-6583-7dc1-a7ae-e266f58f243d\splitter-focused-comparison.png`
- Viewport: 2048 × 1123 CSS px target; earlier feature capture 2047 × 1123 px and latest splitter capture 1739 × 1123 px, both from the same desktop CSS viewport.
- Density normalization: the original edited-context source (3840 × 2090) and the splitter source (3792 × 2070) were downsampled to their matching desktop comparison heights; focused card and splitter regions were cropped and placed in side-by-side images. The splitter implementation capture is 1739 × 1123 px while the browser's CSS viewport remained 2048 × 1123.
- State: completed AI reply with five edited files; collapsed file list; file opened from an edited-file row; file opened from an inline AI-message path; file-preview separator after a 64 px pointer drag.

## Full-view comparison evidence

The full comparison confirms that the edited-files artifact remains in the conversation flow, uses the same quiet bordered surface and density as the Codex reference, and intentionally removes line-count and action chrome. The open state was also captured: file content occupies the left track and the conversation occupies the right track.

## Focused region comparison evidence

The focused comparisons place the Codex card and the implementation card in one image, and the reported thick splitter beside the revised splitter in another. Header hierarchy, border treatment, row rhythm, and the three-row-plus-more structure align. The revised splitter keeps a 4 px interaction track but renders only a centered 1 px visible line, removing the heavy filled drag state.

## Findings

- No actionable P0, P1, or P2 mismatch remains.
- Fonts and typography: existing CC Tools font stack is preserved; title and path hierarchy match the reference at current application density.
- Spacing and layout rhythm: the card is capped at the same 720 px conversation width, with a 52 px header and 34 px file rows; the left preview/right conversation split remains resizable. Its visible divider is 1 px in idle, hover, focus, and active resize states while the 4 px track plus the existing extended hit area remain draggable.
- Colors and visual tokens: existing panel, border, hover, focus, and muted-text tokens are reused without introducing a separate visual language.
- Image quality and asset fidelity: no raster assets are required; the existing Lucide icon system is retained.
- Copy and content: the title now uses `已编辑 N 个文件`; additions, deletions, undo, and review copy are absent from the durable edited-files card.
- Accessibility: each file is a real button, the extra-files control exposes `aria-expanded`, the separator exposes value semantics, and reduced-motion users skip the split transitions.
- P3 follow-up: the exact document glyph differs slightly from the Codex source because CC Tools keeps its existing icon family. This is intentional and non-blocking.

## Comparison history

1. Initial implementation pass matched the structure but used `编辑了 N 个文件`, which drifted from the source copy.
2. Updated the label to `已编辑 N 个文件`, reloaded the browser preview, and captured the final comparison evidence.
3. Post-fix inspection found no remaining P0/P1/P2 issues.
4. The drag state filled the entire 4 px separator track with the accent color, reproducing the user's thick-line report. Replaced the filled track with a transparent interaction area and a 1 px accent pseudo-element; the focused post fix comparison shows the visible divider reduced without shrinking its hit target.

## Primary interactions verified

- Clicking an edited-file row opens that exact path in the left preview.
- Clicking an inline file path in an AI message opens that exact path in the left preview.
- The preview precedes the conversation visually (`preview.right <= conversation.left`).
- The workbench transitions `grid-template-columns` over 240 ms; the preview has matching enter/exit motion.
- Closing the preview restores the single conversation column.
- Pointer drag moved the separator from x=1258.24 to x=1321.98 while the loaded active-resize rule retained `width: 1px` for the visible line.
- Browser console warnings/errors: none.

## Verification

- Full Vitest suite: 92 files, 1164 tests passed.
- TypeScript renderer and Electron checks passed.
- Renderer production build passed.

# Markdown 编辑宽度与表格预览 QA — 2026-07-27

- Source visual truth:
  - `C:\Users\say\AppData\Local\Temp\codex-clipboard-9c200193-864f-4b0f-a6d6-fa42ab2daa60.png`
  - `C:\Users\say\AppData\Local\Temp\codex-clipboard-9d1a9887-61cb-483a-b4d5-b6e4725a54bf.png`
- Implementation screenshots:
  - `C:\Users\say\.codex\visualizations\2026\07\27\019fa367-6583-7dc1-a7ae-e266f58f243d\markdown-editor-full-width-fixed.png`
  - `C:\Users\say\.codex\visualizations\2026\07\27\019fa367-6583-7dc1-a7ae-e266f58f243d\markdown-table-preview-fixed.png`
- Comparison evidence:
  - `C:\Users\say\.codex\visualizations\2026\07\27\019fa367-6583-7dc1-a7ae-e266f58f243d\markdown-editor-width-comparison.png`
  - `C:\Users\say\.codex\visualizations\2026\07\27\019fa367-6583-7dc1-a7ae-e266f58f243d\markdown-table-preview-comparison.png`
- Viewport: 2048 × 1123 CSS px; implementation captures are 2047 × 1123 px.
- Density normalization: both 3840 × 2088 source screenshots were resized to 2047 × 1123 before being placed beside the implementation captures.
- State: Markdown file opened from an inline AI-message path, first in preview mode and then in edit mode.

## Full-view and focused evidence

The editor comparison shows the previous centered `92ch` cap and the revised editor occupying the complete padded width of the left file pane. Browser geometry confirms a 943.31 px editor inside the 1055.31 px preview body; the 112 px difference is exactly the intended 56 px gutter on each side.

The table comparison shows the malformed pipe text in the source state and a semantic eight-column table in the revised preview. Browser inspection found exactly one table with a 941.98 px rendered width inside a 943.31 px horizontally scrollable wrapper.

## Findings

- No actionable P0, P1, or P2 mismatch remains.
- Fonts and typography: the existing reader and monospace editor stacks are preserved; table headers use the current 650 weight and body cells use the existing 13 px reading scale.
- Spacing and layout rhythm: edit mode now consumes the full available content width without removing the preview pane gutter; table cells use consistent 9 × 11 px padding.
- Colors and visual tokens: table borders, header surface, text, and panel background reuse existing theme tokens.
- Image quality and asset fidelity: no image assets are involved in this change.
- Copy and content: the original Markdown remains editable as plain text, while preview mode repairs only unambiguous malformed delimiter rows outside fenced code blocks.
- Accessibility: the preview renders a real semantic `table`; horizontal overflow remains keyboard/trackpad scrollable instead of clipping columns.

## Comparison history

1. Initial source state constrained edit mode to `92ch`, leaving unused horizontal space in a wide file pane.
2. Removed the editor cap and verified that the shell and textarea now occupy the full 943.31 px content width.
3. The source table delimiter contained `---:---:`, which GFM correctly rejected and displayed as paragraph text.
4. Corrected the current Markdown file, added guarded preview normalization for the same AI-generated typo, and added a styled horizontal table wrapper. Post-fix inspection shows a semantic table with no remaining P0/P1/P2 issue.

## Primary interactions verified

- Clicking the inline Markdown file path opens it in the left preview.
- The malformed preview fixture renders as a semantic table rather than pipe-delimited paragraph text.
- Switching to edit mode preserves the raw Markdown and expands the editor to the full content width.
- Browser console warnings/errors: none.
- Full Vitest suite: 92 files, 1164 tests passed.
- TypeScript checks, renderer build, Electron build, and desktop integration smoke passed.

final result: passed

# 对话流与输入框统一宽度 QA — 2026-07-27

- Source visual truth:
  - `C:\Users\say\AppData\Local\Temp\codex-clipboard-d903c288-0d4c-4ada-8586-83f4ed348895.png`（desktop-app 问题状态）
  - `C:\Users\say\AppData\Local\Temp\codex-clipboard-48dce310-03c8-4dd8-9e95-7fe8246d02fd.png`（Codex 对齐目标）
- Implementation screenshot:
  - `C:\Users\say\.codex\visualizations\2026\07\27\019fa367-6583-7dc1-a7ae-e266f58f243d\conversation-flow-width-fixed.png`
- Viewport: 2048 × 1123 CSS px; implementation capture is 2047 × 1123 px.
- Pixel dimensions and density: source screenshots are 3840 × 2088 and 3840 × 2090; implementation is 2047 × 1123. The comparison targeted the same desktop split-pane state and normalized the judgment to CSS geometry rather than source-pixel density.
- State: completed AI reply, durable edited-files card, composer visible, and Markdown file open in the left preview.

## Full-view and focused comparison evidence

The Codex reference and browser-rendered desktop-app capture were opened in the same comparison input. The implementation now follows the Codex relationship: the assistant reading frame, durable file card, and composer share one centered column. A separate crop was not needed because all relevant left and right edges are clearly visible at full-view scale, and browser geometry provides sub-pixel confirmation.

## Findings

- No actionable P0, P1, or P2 mismatch remains.
- Fonts and typography: the existing desktop-app type scale, weight, wrapping, and muted metadata hierarchy are unchanged; the narrower reading measure improves line length without introducing truncation.
- Spacing and layout rhythm: one `--ai-flow-width` value controls the message thread, process artifacts, approval banner, edited-files card, and composer. In the tested split pane, all measured `left` values are `1398px` and all measured `right` values are `1959.3px`.
- Colors and visual tokens: no color, border, radius, elevation, or semantic-state token changed.
- Image quality and asset fidelity: no image assets are involved in this layout adjustment; existing icons remain unchanged.
- Copy and content: no app text changed.
- Accessibility and responsiveness: the user-message bubble remains right-aligned inside the shared frame; responsive gutters now update through the same custom property. The composer reserves the same 10 px thin-scrollbar gutter as the message scroller, preventing a narrow split pane from drifting by one scrollbar width.

## Comparison history

1. Source state used competing limits: message flow reached 1000/1040 px, a second chat cap used 800 px, while the final composer rule used 720 px.
2. Consolidated those overrides onto `--ai-flow-width: 720px` and removed the duplicate `--chat-flow-width` path.
3. First browser measurement exposed a residual 10 px right-edge difference caused by the scroll container's stable thin-scrollbar gutter.
4. Reserved the same scrollbar width on the composer and repeated the browser comparison. Post-fix measurements show exact shared left and right edges for the thread, assistant message, edited-files card, and composer.

## Primary interactions and verification

- Clicking the inline Markdown path opened the left preview before measurement.
- Split-pane motion completed before geometry capture.
- Browser console warnings/errors: none.
- Full Vitest suite: 92 files, 1164 tests passed.
- TypeScript checks, renderer build, Electron build, and desktop integration smoke passed; the final CSS-only scrollbar alignment pass was followed by a successful renderer production build.

final result: passed
