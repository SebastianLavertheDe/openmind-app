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

# Design QA — 项目菜单、编辑、图标与收藏分组

## Evidence

- Source visual truth:
  - Three-dot project menu: `C:\Users\say\AppData\Local\Temp\codex-clipboard-58e71c62-8362-49a3-9f7f-c796d751b863.png` (663 × 255)
  - Edit-project dialog: `C:\Users\say\AppData\Local\Temp\codex-clipboard-fdf35edf-9c63-470e-b9ca-93de306c7f55.png` (609 × 480)
  - Icon picker: `C:\Users\say\AppData\Local\Temp\codex-clipboard-e7a7f198-385a-4302-ba08-b01bf5bcdf4d.png` (817 × 813)
  - Favorites/recent grouping: `C:\Users\say\AppData\Local\Temp\codex-clipboard-5cd8b1e2-8355-47b9-8378-da5ec1a63bc9.png` (408 × 228)
- Browser-rendered implementation:
  - `D:\work\openmind-app\design-qa\project-management-menu-1990x1247.png`
  - `D:\work\openmind-app\design-qa\project-management-edit-1990x1247.png`
  - `D:\work\openmind-app\design-qa\project-management-icons-1990x1247.png`
  - `D:\work\openmind-app\design-qa\project-management-favorite-1990x1247.png`
- Normalized side-by-side comparisons:
  - `D:\work\openmind-app\design-qa\project-management-menu-comparison.png`
  - `D:\work\openmind-app\design-qa\project-management-edit-comparison.png`
  - `D:\work\openmind-app\design-qa\project-management-icons-comparison.png`
  - `D:\work\openmind-app\design-qa\project-management-favorite-comparison.png`
- Implementation viewport and pixels: 1990 × 1247 at device pixel ratio 1.
- State: light theme; project action menu open, edit dialog open, icon picker open, and a pink game-icon project shown in both Favorites and Recent.

## Full-view comparison

The implementation preserves the existing Project page structure while adding the requested controls in the left project pane. The project row, contextual action menu, centered edit dialog, anchored icon palette, and Favorites/Recent sections follow the visual hierarchy and interaction states shown in the four references.

## Focused-region comparison

- The project action menu is anchored below the three-dot trigger and contains exactly 编辑、收藏、归档 with matching icon-plus-label rows.
- The edit dialog matches the rounded white surface, dimmed backdrop, title/name field, bordered appearance card, two-row 12-color palette, and dark pill-shaped 更新 action.
- The icon picker is elevated above the edit dialog and presents a dense, evenly spaced grid using the product's installed Lucide icon set.
- Favorited projects are listed under 收藏 and remain duplicated under 近期项目, matching the reference relationship.

## Required fidelity surfaces

- Fonts and typography: uses the application's existing font stack and neutral heading/body hierarchy; labels and project names match the source copy.
- Spacing and layout rhythm: menu rows, dialog padding, appearance-card divisions, color spacing, and project-group spacing track the source proportions.
- Colors and visual tokens: the neutral menu/dialog surfaces, gray backdrop, dark update button, and 12-color palette match the reference states; selected color is indicated with a high-contrast ring.
- Imagery and icons: no raster asset was required. Existing Lucide icons provide consistent, crisp project/menu/picker glyphs; individual glyph silhouettes vary slightly from the filled reference set without changing meaning.
- Copy and content: 编辑、收藏、归档、编辑项目、图标、更新、收藏、近期项目 are implemented as shown.

## Findings

No actionable P0, P1, or P2 differences remain. The only acceptable P3 difference is that the repository's existing outline icon library is used where the reference contains some filled glyphs.

## Comparison history

1. First browser pass confirmed the menu and modal geometry, then found that the open icon picker intercepted color and update clicks.
2. Fix made: selecting an icon now commits the selection and closes the picker immediately.
3. Post-fix browser evidence confirms the picker closes, the pink color can be selected, the project can be renamed to Chaos, and the updated icon/color render in both project groups.

## Interaction and console checks

- Tested opening and outside-click dismissal of the project three-dot menu.
- Tested 编辑 → icon picker → icon selection → color selection → rename → 更新 end to end.
- Tested 收藏 and confirmed the project appears in both 收藏 and 近期项目.
- Tested 归档 through component/API coverage and confirmed archived projects are excluded from the active groups.
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

---

# Design QA — 编辑项目对话框紧凑化

## Evidence

- Source visual truth: 用户提供的参考截图（紧凑编辑对话框：小标题、小输入框、密排色板、小号黑色胶囊按钮、背景无遮罩）与当前实现截图（600px 宽、大间距、深色模糊遮罩）。

## Change

- 编辑项目对话框宽度 600px → 340px，圆角 26px → 14px，阴影减轻；标题降为 14px/600，输入框 32px 高/8px 圆角/13px 字号，“图标”行 40px 高，色板色点 34px → 20px、间距收紧，“更新”按钮降为 30px 高小胶囊。
- 编辑对话框 backdrop 新增 `project-edit-backdrop`（透明、无模糊），不再压暗背景；点击背景仍可关闭。创建项目、添加资料等其余对话框保持原有遮罩。
- 图标选择弹层同步紧凑化：566px/8 列/42px 格子 → 320px/6 列/34px 格子，限高 340px 内部滚动。
- `ProjectDialog` 新增可选 `backdropClassName` prop，默认行为不变。

## Verification

- `npm run typecheck` 通过。
- `ProjectsPage.test.tsx`（12）与 `ProjectPanels.test.tsx`（15）全部通过。

final result: passed

---

# Design QA — 项目文件列表行内操作菜单

## Evidence

- Source visual truth: 用户提供的参考截图（文件列表行右侧三点菜单：重命名/移动到/下载/删除等）。

## Change

- Project 文件列表（资料 + 成品）每行右侧新增三点菜单，悬停/选中/聚焦行时显示，触屏设备常显。
- 菜单功能：1) 重命名（对话框改名，磁盘文件与索引同步重命名）；2) 移动到其他项目（对话框选择目标项目，跨项目移动文件与记录）；3) 下载（主进程弹出原生保存对话框导出副本；资料优先导出保留的原件；视频资料不显示下载项）；4) 删除（确认对话框后删除）。
- 主进程新增：material-service/output-service 的 rename 与 moveToProject（含唯一文件名分配、活动转换保护、跨项目移动的回滚顺序），ProjectService 编排与下载源解析，IPC 通道 project:material-rename/material-move/output-rename/output-move/file-download，注册表与 preload 桥同步扩展。
- 行布局沿用任务行样式（`.project-file-row` + `.project-file-more`），移动对话框的 select 样式并入 `.project-field`。

## Verification

- `npm run typecheck` 通过。
- 新增测试：project-service 重命名/移动/下载源解析 3 项；ProjectPanels 文件行菜单交互 1 项（视频隐藏下载、四个菜单项与三条 IPC 调用断言）。
- `npm run test:unit`：1784 通过；仅剩 4 项失败为既有的 Windows 环境问题（symlink EPERM / 大小写敏感 EEXIST），已在改动前的干净代码树上复现，与本次无关。

final result: passed

---

# Design QA — 视频资料仅保留逐行字幕视图

## Evidence

- Source visual truth: 用户提供的截图（视频详情右栏视图切换：摘录 / 逐行视图 / 章节视图 / 描述）。

## Change

- 视频资料详情移除“摘录 / 章节视图 / 描述”三个视图及其切换 tab 栏，仅保留逐行字幕视图（播放器 + 字幕列表），split / stacked 两种布局均直接展示字幕。
- 一并移除视频下方的摘录时间轴区块（自动摘录 / 你的摘录 图例、时间点圆点、摘录列表），以及章节列表、视频描述卡片的实现与 CSS。
- 字幕行的时间码跳转、播放中高亮当前行、字幕复选框选择能力保持不变。

## Verification

- `npm run typecheck` 通过。
- projects 全部 39 项测试通过；响应式布局测试改为断言 split/stacked 切换时字幕始终可见且不再出现已移除的 tab。

---

# Design QA — AI 侧栏对话宽度与错误卡片修复

## Evidence

- Source visual truth: 用户提供的截图（创作页 AI 侧栏：对话列被压成窄条、错误卡片标题与摘要挤压、同一错误重复渲染三处）。

## Change

- `.ai-sidebar` 补默认 `--ai-flow-width: 100%`（styles.css）：对话列默认占满侧栏可用宽度，不写死像素；需要封顶阅读列的页面仍可覆盖（项目页 960px、工作台 720px 行为不变）。此前的症状是侧栏未定义该变量导致 width/max-width 声明整体失效、列宽收缩为内容宽。
- `ErrorEvent` 去重（events.tsx）：卡片头部只保留「Error / 运行失败 / failed 徽标」，移除与正文重复的 firstLine 摘要；错误全文仅在展开区（OverflowBox）出现一次。
- 补齐 `.conversation-cell-header / -icon / -title / -kicker / -chevron / .conversation-status` 的布局样式（此前完全无样式，label、标题、摘要、徽标全部挤成一行）；`error-event` 触发器由旧的三列 grid 改为 flex，展开箭头增加打开旋转态。
- 登录类失败（not logged in / please run /login / 未登录等）新增「去终端登录」快捷按钮，按会话 provider 映射 openCliLogin(claude|codex)；messages 增加 openLogin 文案。

## Verification

- `npm run typecheck` 通过。
- ai-console + projects 全部 188 项测试通过；ErrorEvent 测试更新为断言全文仅在展开区出现一次，并新增登录快捷入口测试。
