# Design QA — Focus states

## Evidence

- Source visual truth:
  - `C:\Users\say\AppData\Local\Temp\codex-clipboard-860795be-9e0f-42db-8241-0d18f094dd1b.png`
  - `C:\Users\say\AppData\Local\Temp\codex-clipboard-9f24b5ea-cce5-4d27-97dc-b66f6959ecd0.png`
  - `C:\Users\say\AppData\Local\Temp\codex-clipboard-814e4fc4-ae0e-4504-9fcb-ad4d386f5698.png`
- Browser-rendered implementation:
  - `D:\work\openmind-app\design-qa-project-focus.png`
  - `D:\work\openmind-app\design-qa-nav-focus.png`
  - `D:\work\openmind-app\design-qa-creative-focus.png`
- Source pixels: 2559 × 1599 for each reference image.
- Implementation pixels and CSS viewport: 1996 × 1248 at device pixel ratio 1.
- Density normalization: the source and implementation share the same 1.6:1 aspect ratio; full views and the corresponding focused controls were compared together at a common display scale.
- State: light theme; focused project search input, restored keyboard focus on the navigation search button, and focused creative search input.

## Full-view comparison

The three implementation captures preserve the existing page composition, typography, spacing, icons, copy, and selected navigation backgrounds. The only intended visual change is the interaction-state treatment: the teal focus outlines and glow shown in the source captures have been replaced by the product's neutral gray border/background language.

## Focused-region comparison

- Project search: input outline and box shadow are both absent; the wrapper uses the existing strong neutral border.
- Navigation search: restored keyboard focus uses a neutral gray background and graphite ring. The keyboard affordance remains visible without introducing a brand-green selected state.
- Creative search: the teal border and three-pixel glow are absent; focus uses the existing neutral border and white panel background.

## Required fidelity surfaces

- Fonts and typography: unchanged; hierarchy, wrapping, and weights match the existing application.
- Spacing and layout rhythm: unchanged; focus styling does not add visual size or move adjacent controls.
- Colors and visual tokens: focus now derives from `--text`, `--border-strong`, and `--control-hover`; no brand-green focus token is used in these states.
- Image quality and asset fidelity: no image or icon assets were changed.
- Copy and content: unchanged.

## Findings

No actionable P0, P1, or P2 differences remain for the requested focus-state correction.

## Comparison history

1. Earlier evidence: project and creative inputs showed teal outlines/glow, and the navigation search button showed a teal ring.
2. Fixes made: introduced a neutral focus-ring token, removed search-input glow, moved input focus to neutral wrapper borders, and aligned the project-sidebar search state with the same tokens.
3. Post-fix evidence: all three browser captures show neutral states; computed input shadows are `none`, project and creative input outlines are absent, and the navigation keyboard ring is neutral gray.

## Interaction and console checks

- Tested project navigation expansion and project management entry.
- Tested project search focus.
- Tested global search open/close and focus restoration to its trigger.
- Tested creative route navigation and creative search focus.
- Browser console warnings/errors: none.

## Follow-up polish

None required for this scope.

final result: passed

---

# Design QA — Project 新建任务复用 AI 对话框

## Evidence

- Source visual truth:
  - Project context: `C:\Users\say\AppData\Local\Temp\codex-clipboard-39a509c2-76f2-40ed-87bd-df107ac1f69f.png`
  - Reused AI workbench: `C:\Users\say\AppData\Local\Temp\codex-clipboard-f0f74f95-ef3c-472c-83ff-ea9ba722c20d.png`
- Browser-rendered implementation: `D:\work\openmind-app\design-qa\project-new-task-workbench-implementation.png`
- Source pixels: 2601 × 1641 at device pixel ratio 1.
- Implementation pixels and CSS viewport: 1978 × 1248 at device pixel ratio 1.
- Density normalization: the 2601 × 1641 source was displayed at 1978 × 1248 for the full-view comparison, matching the implementation viewport and aspect ratio.
- State: light theme; Project “AI 安全” open; Task tab selected; no concrete task selected; “新建项目内容 → 新建任务” activated.

## Full-view comparison

The implementation keeps the Project navigation and task list from the Project-context reference, while the right pane uses the same new-conversation header, empty-state prompts, and full composer as the reusable AI-workbench reference. The Project pane intentionally reduces the available horizontal width; the workbench remains centered inside that available right pane.

## Focused-region comparison

A separate crop was not required for acceptance because the 1978-pixel full-view capture keeps the header, hero copy, all four prompt cards, composer controls, and task-list state legible. DOM geometry was checked after the layout fix: the draft wrapper and `AiWorkbench` both occupy the full 1182.67px detail-pane height.

## Required fidelity surfaces

- Fonts and typography: the implementation renders the existing shared `AiWorkbench`, so font family, heading weight, line height, and supporting-copy hierarchy match the source component.
- Spacing and layout rhythm: the Project list remains in place and the reused workbench now occupies one full-height grid row; hero and composer remain centered in the available detail pane.
- Colors and visual tokens: background, borders, teal workspace badge, neutral cards, and composer elevation all use the existing AI-workbench tokens.
- Image quality and asset fidelity: this state contains no raster imagery; existing product icons are reused unchanged.
- Copy and content: “新会话”, “从资料到创作，让 AI 帮你推进”, all four prompt cards, shortcut hint, and composer placeholder match the shared component. The browser fixture’s workspace label differs from the screenshot only because it uses preview data.

## Findings

No actionable P0, P1, or P2 differences remain for the requested Project new-task state.

## Comparison history

1. Earlier browser evidence: the shared AI workbench rendered inside a two-row Project task-session grid intended for an existing task header, leaving the new-task workbench at roughly half height.
2. Fix made: added the `is-draft` Project task-session state and changed it to a single `minmax(0, 1fr)` row.
3. Post-fix evidence: `project-new-task-workbench-implementation.png` shows the complete full-height workbench, and browser geometry reports identical 1182.67px heights for the draft wrapper and `AiWorkbench`.

## Interaction and console checks

- Tested Project navigation, opening “AI 安全”, expanding its pane, opening the plus menu, and selecting “新建任务”.
- Tested entering a prompt in the reused composer; the send action became enabled.
- Automated tests exercise the Project-owned submit path, task creation, task-list selection, and failed-run recovery.
- Browser console warnings/errors: none.

## Follow-up polish

None required for this scope.

final result: passed
