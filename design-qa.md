# Design QA

## Skills 页面宽度与内置 Python 修复 — 2026-08-09

- Source visual truth: `C:/Users/say/AppData/Local/Temp/codex-clipboard-90a6ebd2-3228-484d-81e7-d7bbc77ddd9f.png`（用户指定的 MCP 设置页宽度参考）。
- Implementation screenshot: `design-qa/settings-skills-python-fix/reference-04-Skills.png`。
- Full-view comparison evidence: `design-qa/settings-skills-python-fix/compare-reference-mcp-to-skills.png`。
- Focused region comparison evidence: `design-qa/settings-skills-python-fix/compare-reference-mcp-to-skills-focus.png`；该裁切用于核对标题、说明和主体卡片的左右边界，重要小字与控件在此图中可读。
- Viewport and density: source raster is 2595 × 1877 physical pixels including the Windows title bar. The source comparison crop is 2595 × 1788; the implementation capture is 2595 × 1788 from a 1744 × 1255 Electron window at the host display density. No additional density scaling is used before the two equal-size panels are downsampled together for comparison.
- State: light theme. The source shows the live MCP state; the implementation uses the visual-snapshot preload's empty Skills state. Content differences are intentional—the comparison target is the shared settings axis and overall density.

### Findings

- No actionable P0/P1/P2 visual finding remains.
- Skills no longer breaks out to the former 1380px canvas. Its header and body both measure 980 CSS px, exactly matching MCP at the same viewport.
- The reference viewport, 2048 × 1152, 1280 × 800 and 900 × 720 captures all report zero page-level and document-level horizontal overflow.

### Required fidelity surfaces

- Fonts and typography: the existing application font stack, title weight, description size, line height and compact control text are preserved; no text wraps or truncates because of the narrower frame beyond the filter strip's deliberate internal scroller.
- Spacing and layout rhythm: Skills now uses the same centered 980px page axis as MCP and the other settings categories. The two-column catalog/detail split remains internal to that frame and collapses at the existing responsive breakpoint.
- Colors and visual tokens: existing panel, muted surface, border, text and selected-state tokens are unchanged.
- Image quality and assets: this settings surface contains no raster artwork. Existing Lucide icons remain sharp and no placeholder or custom SVG was introduced.
- Copy and content: all Skills titles, filter labels, empty-state guidance and MCP reference copy are unchanged.
- Accessibility and interaction: existing semantic search, tab filters and selectable Skill rows are preserved. The Electron capture run covered all ten settings tabs at four viewport sizes, found zero console errors and found no horizontal overflow.

### Comparison history

1. Initial [P1]: Skills alone applied `.settings-stack--wide`, expanding its body to 1380px while MCP and other settings categories stayed at 980px.
2. Fix: removed the Skills-only wide detail/stack classes and their breakout CSS, then added a regression assertion that the embedded Skills page never receives either wide class.
3. Post-fix evidence: reference-size geometry reports both Skills and MCP headers at left 505 / width 980 and both stacks at left 505 / width 980. The combined full view and focused crop show the shared axis directly.

### Functional verification

- Bundled Python manifest schema upgraded to v2 and now hashes only shipped file paths and bytes; empty directories pruned by electron-builder no longer cause a false corruption error.
- An electron-builder `afterSign` hook now finalizes that digest after packaged executables have passed through the Windows signing stage.
- Real bundled Python 3.12.8 and uv 0.5.27 assets were regenerated, then used to create a fresh isolated shared environment successfully (`phase: ready`).
- A real Windows `electron-builder --dir` package produced a schema-v2 manifest whose digest exactly matched the packaged payload, and `SharedPythonRuntimeService` initialized directly from that packaged resource tree with `phase: ready`.
- Focused tests: 3 files, 26 tests passed, including the empty-directory-pruning regression.
- Full production build passed, including TypeScript checks, repository-root audit and all 16 formal Skill manifest validations.

final result: passed

---

# Provider 全局保存条移除 QA — 2026-08-25

## 对照基准

- Source visual truth：`C:\Users\say\AppData\Local\Temp\codex-clipboard-f87ca934-8176-434f-9118-14d2dad094dc.png`。源图为 3840 × 2088 物理像素；截图未提供 CSS 尺寸或 device scale 元数据。
- Implementation full-view：`D:\work\openmind-app\design-qa\provider-dialog-no-save-20260825\2048x1152-02-AI-与模型.png`。Electron 在 2048 × 1152 逻辑窗口下捕获，生成 3051 × 1634 物理像素截图；同次运行的聚焦列表图为 `reference-provider-list-collapsed.png`（2345 × 1401，1577 × 997 逻辑窗口）。
- Focused implementation：`D:\work\openmind-app\design-qa\provider-dialog-no-save-20260825\reference-provider-dialog-focused.png`（680 × 474）及 `900x720-provider-dialog.png`（680 × 473）。
- Density normalization：将源图与 2048 × 1152 实现图在同一比较输入中按 2048 px 宽显示（分别为 2048 × 1114 与 2048 × 1097）；由于源截图没有可用 CSS/density 元数据，只评估应用内容区及用户标出的底部区域，不将窗口边框或设备缩放差异计为偏差。
- State：浅色主题、Provider 配置弹窗关闭。源图含 3 个 Provider 与被红框标出的全局“未保存修改 / 放弃修改 / 保存配置”条；实现用视觉 QA fixture 呈现 2 个 Provider，列表下方没有该条。Provider 数量是 fixture 差异，不影响本次目标区域判断。

## 完整与聚焦对照证据

源图与 `2048x1152-02-AI-与模型.png` 已在同一个视觉比较输入中打开；完整视图确认 Provider 列表卡片后的留白恢复为正常页面留白，没有残留背景、边框、提示文案或操作按钮。`reference-provider-dialog-focused.png` 与窄屏截图用于确认保存动作仍只存在于编辑弹窗的页脚，而不是回流到列表底部。

## Findings

- 迭代前 [P1]：Provider 列表下方存在一整条全局保存操作区，与用户标注的“不需要”元素一致；它会额外占用页面纵向空间，并让列表修改与弹窗修改的保存入口并存。
  - Fix：删除全局保存条及其样式；列表中的启用、设为默认、添加、删除改为立即保存，连接信息继续由 Provider 编辑弹窗内的“取消 / 保存配置”收口。
  - Post-fix evidence：`2048x1152-02-AI-与模型.png` 与 `reference-provider-list-collapsed.png` 均没有 `.settings-provider-save-row` 对应的可见区域；Electron 交互断言 `globalSaveRowRemoved: true`。
- 未发现遗留的 P0、P1 或 P2 偏差。
- 字体与层级：列表标题、数量徽标、Provider 名称、协议/模型元数据和 API Key 状态继续使用现有 Settings 字体、权重及层级；移除操作条后没有残留的弱提示或无归属按钮。
- 间距与布局节奏：列表卡片在最后一个 Provider 后自然结束，整体留白与 Settings 主内容轴保持一致；弹窗内仍保留双列字段、全宽 Base URL/API Key 与固定页脚。
- 色彩与 token：没有引入新颜色、阴影或边框；列表和弹窗继续复用现有 `Settings` 面板、正文、弱文本、焦点与主按钮 token。
- 图像、图标与文案：目标区域不含图像资产；箭头、更多和关闭图标仍来自既有 Lucide 图标体系。列表不再显示“尚无未保存修改 / 放弃修改 / 保存配置”；弹窗保留清晰的“取消 / 保存配置”文案。
- 可访问性与交互：Provider 编辑对话框仍具有 `role="dialog"`、`aria-modal`、已关联标题、焦点范围与 Escape/遮罩取消；取消会恢复编辑前的字段、API Key 草稿和 CLI 绑定。列表即时操作不会遗留无法保存的草稿状态。
- 响应式：900 × 720 截图中的弹窗宽 680 px、横向溢出为 0；底部仅为弹窗自身的取消/保存操作，不出现全局保存条。

## 验证与比较历史

1. 以用户的红框截图为首轮证据，记录全局保存条为 P1 目标偏差。
2. 移除该条及相关 CSS，并将保存语义收口为“列表立即保存 + 弹窗确认保存”；补充取消时还原 CLI 绑定的保护，避免弹窗取消留下隐性草稿。
3. 重新运行 Electron 视觉 QA：36 张截图、0 个 renderer console error，覆盖 reference、2048 × 1152、1280 × 800、900 × 720；Provider 交互验证了初始无弹窗、打开单个 Provider、取消恢复模型、再次打开及无全局保存条。
4. 本地预览打开 AI 与模型页时也没有全局保存条；预览控制台 error 日志为空。`SettingsPage` 聚焦测试 27/27 通过，生产构建通过（TypeScript、边界审计、manifest 校验、renderer 和 Electron preload）。

final result: passed

---

# Provider 折叠与扁平化配置 QA — 2026-08-23

## 对照基准

- Source visual truth: `C:\Users\say\.codex\generated_images\01a02d88-6997-7461-9f75-ec4bc99cd94f\exec-e880f256-6471-4a08-a697-79df27699e17.png`。
- Implementation expanded screenshot: `D:\work\openmind-app\design-qa\settings-unified\reference-provider-list-expanded.png`。
- Implementation default-collapsed screenshot: `D:\work\openmind-app\design-qa\settings-unified\reference-provider-list-collapsed.png`。
- Focused implementation evidence: `D:\work\openmind-app\design-qa\settings-unified\reference-provider-card-expanded.png` and `reference-provider-card-collapsed.png`。
- Full-view combined comparison: `D:\work\openmind-app\design-qa\settings-unified\provider-expanded-comparison-normalized.png`。
- Focused combined comparison: `D:\work\openmind-app\design-qa\settings-unified\provider-card-comparison.png`。
- Viewport and density: the source is 1577 × 997 physical pixels. The Electron BrowserWindow was set to 1577 × 997 CSS px; Windows display density produced a 2345 × 1401 full capture, which was bicubically normalized to 1577 × 997 before the full-view comparison. The focused Provider card was captured from its DOM rectangle and normalized to its 980 CSS px width.
- State: light theme, two configured Providers, first Provider expanded for visual comparison with one invisible trailing-space draft so the dirty/save state matches the source. The additional initial-state evidence has both Providers collapsed, per the final user requirement.

## Findings

- No actionable P0/P1/P2 visual finding remains.
- Fonts and typography: the existing settings font stack, 13px Provider names, mono protocol/model metadata, muted helper copy and compact status text remain consistent with adjacent Settings surfaces. Long model metadata truncates without colliding with switches or menus.
- Spacing and layout rhythm: the Provider list is a flat grouped surface. Only the divider between Provider rows remains; the expanded body uses a subtle filled plane, inputs use fill rather than strokes, Advanced Settings is borderless, and the save strip has no outline. The implementation is intentionally slightly more compact than the mock and preserves the product's established centered 980px Settings axis.
- Colors and visual tokens: existing panel, muted, surface, success, warning and focus tokens are reused. No new hard-coded palette or shadow treatment was introduced.
- Image quality and assets: this surface contains no raster product assets. Existing Lucide controls remain vector-sharp; no custom SVG, placeholder art or generated image is shipped in the application.
- Copy and content: Provider names, protocol/model metadata, API Key status, field labels, Advanced Settings copy, dirty count and save/discard actions match the approved direction. The default Provider switch remains disabled and therefore visually muted, preserving the existing rule that the active default cannot be turned off directly.
- Accessibility and interaction: Provider summaries expose `aria-expanded` and `aria-controls`; only one body is mounted at a time. Toggle labels include the Provider name, the overflow action exposes menu/menuitem semantics, Advanced Settings has its own disclosure state, and visible focus rings are retained.
- Responsive behavior: the 1744 × 1255, 2048 × 1152, 1280 × 800 and 900 × 720 settings matrix reported zero page-level or document-level horizontal overflow. At the compact breakpoint, form and advanced grids collapse to one column and save actions share the available width.

## Comparison history

1. The rejected visual direction used nested card, field, Advanced Settings and footer outlines, producing excessive line density.
2. The approved source removed those outlines in favor of whitespace and subtle filled surfaces. The implementation follows that source while retaining the existing Settings width and disabled-default-provider safety behavior.
3. The first coded comparison found no actionable P0/P1/P2 mismatch. The focused comparison confirms the same information hierarchy, single divider, filled input treatment, compact collapsed row and borderless save strip; no visual fix loop was required.

## Primary interactions verified

- Initial render contains two Provider rows, zero expanded cards and zero mounted configuration bodies.
- Expanding the first Provider mounts exactly one body; opening the second closes the first; clicking the open summary again returns to zero expanded cards.
- Adding a Provider opens the new draft, while discarding restores the persisted document and returns the list to the collapsed state.
- Dirty tracking enables Save and reports the number of modified Providers; removing a draft Provider keeps unrelated unsaved field and API Key edits.
- The Electron visual matrix captured all ten Settings categories at four viewport sizes, reported no renderer console errors and passed its overflow gate.
- `npm run build` passed, including TypeScript, repository-root audit, all 16 formal Skill manifests, renderer production build and Electron/preload build.
- `npx vitest run renderer/src/features/settings/SettingsPage.test.tsx`: 28/28 passed.

final result: passed

---

# Automation 紧凑控件与运行记录 QA — 2026-08-23

## 对照基准

- Source visual truth: `C:\Users\say\AppData\Local\Temp\codex-clipboard-c31c681d-2cd9-40ce-810d-5d91fd3affcc.png`
- Implementation screenshot: `D:\work\openmind-app\.build\automation-layout-after-desktop.png`
- Combined comparison evidence: `D:\work\openmind-app\.build\automation-layout-comparison-desktop.png`
- Focused implementation evidence: `D:\work\openmind-app\.build\automation-target-clip.png` and `D:\work\openmind-app\.build\automation-trigger-clip.png`
- Viewport and density normalization: 参考图是 2463 × 1553 px，其中顶部 32 px 是 Electron/Windows 窗口边框；对照时裁掉边框，并将 2463 × 1521 px 应用内容归一化为 1979 × 1225 px。浏览器使用 1979 × 1241 CSS px 视口、device scale 1.5，输出应用截图 1979 × 1225 px。
- State: 浅色主题，选中 `RSS 抓取与每日总结`，触发方式为“每小时”。参考图使用真实失败历史，浏览器 Preview 使用同一规则的空历史固定数据；因此历史行不做像素对位，按钮移除由失败状态组件测试和浏览器 DOM 计数共同验证。

## Full-view and focused evidence

参考图与实现截图在同一并排比较图中检查。完整视图显示两个原本被红框标记的控件已不再占满网格轨道；细节截图确认文字、图标、下拉箭头和控件内边距都未被裁切。浏览器几何测量为：执行目标文字约 142 px，控件约 188 px；触发方式文字约 71 px，控件 112 px。

## Findings

- No actionable P0/P1/P2 finding remains.
- Fonts and typography: 继续使用现有 system font stack、字重和小号字段标签；收紧宽度没有改变字号、行高或文字截断策略。
- Spacing and layout rhythm: 执行目标使用 `fit-content`，触发选择器使用 112 px 紧凑宽度；两者保留原来的 34 px 高度、6 px 字段间距和网格对齐。运行历史行从六列改为五列，错误文本获得原操作列的空间。
- Colors and visual tokens: 未改变颜色、边框、背景、圆角或阴影 token。
- Image quality and assets: 该区域无光栅图像；目标与调度图标仍使用项目已有 Lucide 图标，没有新增或近似替代资产。
- Copy and content: 现有“执行目标”、“触发方式”和运行错误文案保留；仅移除失败/阻塞历史行的“重试”按钮。
- Interaction and accessibility: 触发方式仍为共享 `Select` 语义控件，键盘和 ARIA 行为未变。实时 Preview DOM 中名为“重试”的按钮计数为 0；失败运行回归测试也确认不渲染该操作。
- Responsive behavior: 980、720 和 520 CSS px 宽度均无水平溢出。520 px 下两字段分行，控件保持内容宽度。

## Comparison history and verification

1. Initial source evidence identified two P2 density issues: the read-only target background and trigger selector retained large unused widths. It also identified the unwanted repeated retry action in failed history rows.
2. The target display was changed to content width with ellipsis protection, the trigger selector to a compact 112 px content-sized control, and the retry prop/button/helper path was removed from run history.
3. Post-fix browser evidence measured the compact geometry, found zero horizontal overflow at all tested widths, and reported no console warning/error entries. No post-fix P0/P1/P2 issue remains.
4. Automation page tests: 18/18 passed. TypeScript checks, production renderer build, and `git diff --check` passed.

final result: passed

---

# Skills 极简双栏重构设计 QA — 2026-08-22

## 对照基准

- 用户原始界面：`C:\Users\say\AppData\Local\Temp\codex-clipboard-0f27f095-f573-4a86-9582-2f6bb1a21c77.png`
- 其他设置 Tab 配色基准：`C:\Users\say\AppData\Local\Temp\codex-clipboard-d79b02fc-ef4e-4be2-9a53-46b74cfc3c70.png`
- 用户确认后的最终视觉目标：`C:\Users\say\.codex\generated_images\01a028e8-1319-7c53-8b8d-0a654ea370cc\exec-077e07a4-2748-4024-b534-71d9fa3183fb.png`
- 实现截图：`D:\work\openmind-app\design-qa\skills-redesign-20260822-pass3\reference-04-Skills.png`
- 响应式截图：同目录下 `2048x1152-04-Skills.png`、`1280x800-04-Skills.png`、`900x720-04-Skills.png`
- 视口与像素密度：主验收视口为 1744 × 1255 CSS px，Electron 内容截图为 2595 × 1788 px，device scale 约 1.5；目标图为 1536 × 1024 px。判断以设置内容区的 CSS 构图和组件关系归一化，不把应用侧栏与窗口 chrome 计为目标图偏差。
- 状态：浅色主题，cctools Git 来源展开，兴趣标记整理被选中，Skill 已启用，运行记录为空。

## 完整视图与对照证据

最终视觉目标与实现截图已在同一个比较输入中并排检查。完整视图可清楚辨认标题、添加来源按钮、双栏比例、选中行、详情元数据、可用性开关和运行记录空态，因此无需额外裁剪。实现使用 9 条隔离的视觉测试数据，目标图使用 16 条；数量差异不影响视觉结构判断。

## Findings

- 未发现可执行的 P0、P1 或 P2 问题。
- 字体与层级：Skills 页显式复用主界面的 `--font-sans-default` 系统字体栈；标题、正文、元数据与其他设置 Tab 的字号、字重和灰阶一致。
- 间距与布局：保留紧凑双栏，但移除多余卡片套层和阴影。左栏承担搜索、来源和 Skill 列表，右栏形成标题、元数据、来源路径、可用性与运行记录的顺序阅读流。
- 选中态与图标：选中 Skill 仅使用现有 `--list-selected-bg` 暖灰底和适度加粗，不再显示蓝色左轨；列表内重复方块图标已全部移除，只在详情标题保留一次语义图标。
- 配色与 token：背景、分隔线、选中态、开关和按钮全部复用其他设置 Tab 的中性色 token；绿色只用于“包体已验证”成功状态，焦点态复用产品已有薄荷品牌色，不引入新的蓝色体系。
- 文案与内容：现有产品文案、安装状态、运行记录语义和来源信息未改变；“添加其他来源”改用更直接的加号动作图标。
- 可访问性与响应式：键盘导航、搜索、开关状态和来源弹窗语义保持；1744、2048、1280、900 四个视口均无横向溢出，窄屏时双栏按既有断点纵向排列且内容可滚动。

## 比较历史与验证

1. 第一轮视觉方案减少线框和卡片层级；用户确认选择方案 1。
2. 按用户复核移除选中行蓝色左轨、左栏重复方块图标，并切回主界面字体。
3. 依据“权限与安全”Tab 把蓝色强调和偏冷表面替换为现有暖中性 token，保留成功绿和品牌焦点色。
4. Electron 首轮截图发现窄屏自动滚动导致验收画面偏移，并暴露视觉夹具缺少 Provider API 产生的错误提示；修正隔离夹具后重新生成 40 张截图。
5. 最终截图控制台 error 为 0，所有视口 horizontal overflow 为 0；目标图与实现图并排复核后无 P0/P1/P2 问题。
6. `npm run typecheck` 通过；Skills 单元测试 16/16 通过；renderer 与 Electron 生产构建通过；相关文件 `git diff --check` 通过。完整 `npm run build` 仍会被独立 Skill 仓库中 16 个既有 apiVersion manifest 校验错误阻断，与本次 UI 改动无关。

final result: passed

---

# Skills 来源摘要与交互动效修正 QA — 2026-08-22

## 对照基准

- 用户标注的问题截图：`C:\Users\say\AppData\Local\Temp\codex-clipboard-ed820c06-9615-429e-81f3-db727e3999f5.png`
- 修正后的实现截图：`D:\work\openmind-app\design-qa\skills-redesign-20260822-motion-pass4\reference-04-Skills.png`
- 响应式实现截图：同目录下 `2048x1152-04-Skills.png`、`1280x800-04-Skills.png` 与 `900x720-04-Skills.png`
- 视口与密度：主实现视口为 1744 × 1255 CSS px，Electron 内容截图为 2595 × 1788 px，device scale 约 1.5。用户截图为 3840 × 2088 px，包含窗口 chrome；比较时按 Skills 内容区与用户红框中的来源摘要做密度归一化，不把不同 Skill 数据和外围窗口尺寸列为偏差。
- 状态：浅色主题，Git 来源展开，列表有选中 Skill，详情可用性开关开启。

## 对照证据

用户标注截图与修正后的 Electron 实现截图已在同一个比较输入中打开。用户红框本身已经形成清楚的聚焦区域；实现截图的同一区域在完整分辨率下可读，并由 Electron DOM 几何补充确认，因此无需再生成二次裁剪。

## Findings

- 先前 P2 已消除：通用 `.ui-disclosure-trigger` 的后置 `display: block` 覆盖了 Skills 来源摘要网格，导致图标、名称、URL、计数和箭头向下堆叠。现在来源摘要计算样式为四列 `grid`，四个子元素的垂直中心差为 `0px`，全部处于同一条紧凑横向摘要中。
- 未发现新的 P0、P1 或 P2 问题。
- 字体与层级：继续使用主界面系统字体栈；来源标题、URL、计数和箭头保持清楚的主次关系，没有额外加粗或新字号体系。
- 间距与布局：来源摘要最小高度从 58px 收至 52px，使用 18px 图标列、弹性文本列、计数列和 16px 箭头列；1744、2048、1280、900 四个视口的横向溢出均为 0。
- 色彩与 token：沿用现有中性色、暖灰选中底和薄荷焦点色；没有恢复蓝色左轨，也没有新增独立色值。
- 动效：来源展开/收起为 200ms 高度与透明度过渡并带箭头旋转；选择不同 Skill 会重挂详情内容并触发 200ms `skills-detail-enter` 淡入/横移；列表按下时文字轻移 2px；动作与图标按钮复用现有 action/icon 按压反馈；开关保留滑块过渡并增加按压缩放。Electron 实际点击另一条 Skill 后检测到详情节点已替换，`skills-detail-enter` 处于 `running`，时长 200ms。
- 无障碍：键盘上下键选择、折叠按钮 `aria-expanded`、开关 `role=switch` 与反馈区 live region 均保留；`prefers-reduced-motion: reduce` 仍由全局规则将动画时长归零。
- 图像与素材：本轮不涉及光栅内容资产或新图标，继续使用项目现有 Lucide 图标。
- 文案与内容：未修改 Skill 标题、描述、来源、状态或运行记录文案。

## 比较历史与验证

1. 用户截图暴露 P2：来源摘要被错误拆成多行，计数和箭头落到左下角；同时 Skill 选择与按钮点击缺少可感知反馈。
2. 提高 Skills 来源触发器选择器的明确度，恢复紧凑网格；为详情切换、列表按压、来源折叠、来源弹窗按钮、开关和反馈消息补齐 120–200ms 的语义动效。
3. 修正后重新生成 40 张 Electron 设置页截图。所有 Skills 视口 horizontal overflow 与 document overflow 均为 0，控制台 error 为 0。
4. Electron 交互证据：四个视口均记录 `selectionChanged=true`；详情动画 `skills-detail-enter: 200ms` 正在运行；来源摘要 `display=grid`、子元素中心差 `0px`；折叠内容 transition duration 为 `0.2s`。
5. `npm run typecheck`、Skills 单元测试 16/16、renderer production build 与相关文件 `git diff --check` 均通过。

final result: passed

---

# 工作台顶部与左侧 Chrome 统一设计 QA（2026-08-22）

## 对照基准

- 视觉目标（图 2 设置页左侧）：`C:\Users\say\AppData\Local\Temp\codex-clipboard-d14d67fa-3c34-4cd6-a399-ad53650be01a.png`
- 问题证据（图 1 工作台）：`C:\Users\say\AppData\Local\Temp\codex-clipboard-fd7322ac-cbef-476c-a3b2-ff689c59b64a.png`
- 用户复核问题（设置页右侧浮层被压平）：`C:\Users\say\AppData\Local\Temp\codex-clipboard-b50305cd-7612-4296-98c5-bf0aa5159380.png`
- 更新后实现：`C:\Users\say\.codex\visualizations\2026\08\22\01a028b3-82a5-7b12-aca6-90278943789e\openmind-chrome-after-final.png`
- 浮层修正后实现：`C:\Users\say\.codex\visualizations\2026\08\22\01a028b3-82a5-7b12-aca6-90278943789e\settings-floating-panel-after.png`
- 视口：1992 × 1248 CSS px；浏览器 devicePixelRatio 1.5；实现截图为 1992 × 1248 px。目标截图为 2421 × 1517 px，与实现保持相同桌面宽高比后按区域比较。
- 状态：浅色主题；目标为设置页，实现在每日简报页。两者页面内容不同是有意的，本轮只以应用顶部和左侧 chrome 为视觉真值。

## 对照证据

目标截图与更新后的实现截图已在同一个比较输入中打开。完整视图用于检查外壳与白色内容画布的层次；顶部栏和左侧栏在全图中足够清楚，因此不需要额外裁剪。浏览器计算样式同时确认 `.global-toolbar` 使用 `--app-chrome-bg`，`.app-nav` 透出同一个 shell 背景，`.main-area` 保持独立的 `#fbfcfb` 内容底色。

## Findings

- 未发现可执行的 P0、P1 或 P2 问题。
- 字体与排版：未改动字体、字号、字重、行高、截断或导航密度；图 1 的信息层级保持不变。
- 间距与布局节奏：未改变导航宽度、48 px 顶栏、工作台 inset、圆角或内容列宽；不存在新增溢出或控件裁切。
- 色彩与 token：Windows 标题区、左侧导航和全局顶部栏统一使用图 2 已有的 `--app-chrome-bg` 浅青绿渐变；移除 Mica 引入的冷蓝灰偏色。顶部栏只保留一条低对比 hairline，与白色内容画布分层。
- 图像与资产：本轮没有新增或替换图像资产；现有 Lucide 图标和品牌文字保持原样。
- 文案与内容：未改动任何产品文案或数据内容。
- 交互：在同一预览中实际切换“每日简报”导航，页面正常加载；hover、active 和 focus 样式仍沿用现有设计系统。浏览器控制台 error 日志为空。
- 响应式与主题：确认 Windows 缩放可能令 CSS 视口进入 `max-width: 1280px` 断点。设置页右侧画布现在固定保留 6 px inset、13 px 圆角、细边框与双层轻阴影，不再被工作台的“零 inset / 零圆角”断点压平；深色主题仍沿用现有背景 token。

## 比较历史

1. 初始问题证据显示 Windows Mica 透明外壳把工作台左侧和顶边染成冷蓝灰，与设置页的浅青绿 chrome 不一致（P2）。
2. 将 Windows 外壳、导航和全局顶栏绑定到现有 `--app-chrome-bg`，并增加低对比顶栏分隔线；未引入新的独立色板。
3. 以 1992 × 1248 桌面视口重新截图。更新后的左侧栏与顶部栏共享浅青绿渐变，白色阅读画布仍清晰独立，先前 P2 已消除。
4. `npm run typecheck` 通过；每日简报导航交互通过；控制台无 error。
5. 用户复核指出设置页右侧白色画布在其系统缩放下失去悬浮层次（P2）。计算样式确认 `max-width: 1280px` 将全局 `--workspace-inset` 和 `--workspace-radius` 清零。
6. 设置页右侧画布改为独立保留 6 px 留白、13 px 圆角、细边框和两层轻阴影；左侧与顶部继续共享同一 `--app-chrome-bg`。在 2560 × 1392 桌面比例及 1142 px CSS 宽度断点状态分别验证，P2 均已消除。
7. 修正后 `npm run typecheck`、`npm run build:renderer`、`git diff --check` 全部通过；Skills 页浏览器控制台 error 日志为空。

final result: passed

---

## 设置中心统一视觉语言 — 2026-08-09

- Source visual truth:
  - `C:/Users/say/AppData/Local/Temp/codex-clipboard-cbdd4ee8-08c8-410c-b93e-ed240e76dd65.png`（AI 与模型）
  - `C:/Users/say/AppData/Local/Temp/codex-clipboard-951fdf3d-c772-435a-896e-b071f5dccc9d.png`（内置运行时）
  - `C:/Users/say/AppData/Local/Temp/codex-clipboard-cd7f96a3-00cb-4b7f-aade-a3b7a23cb0b0.png`（Skills）
  - `C:/Users/say/AppData/Local/Temp/codex-clipboard-b904947e-9dc0-4b00-b9aa-3f657912e5e2.png`（MCP 服务）
  - `C:/Users/say/AppData/Local/Temp/codex-clipboard-e3581c1c-b3ef-47d3-82af-a2781b03e861.png`（浏览器）
  - `C:/Users/say/AppData/Local/Temp/codex-clipboard-6a445ddd-ad2a-4ca4-9c1d-37bd5fec29f2.png`（权限与安全）
  - `C:/Users/say/AppData/Local/Temp/codex-clipboard-00e18f0c-aeba-4f1c-a36f-7225c62a4182.png`（内容工作流）
  - `C:/Users/say/AppData/Local/Temp/codex-clipboard-9e05cb87-439c-4acb-a471-9d962d762109.png`（数据与存储）
  - `C:/Users/say/AppData/Local/Temp/codex-clipboard-fa530a84-3177-41bf-b8fa-41a5ad5e9f5f.png`（会话归档）
- Implementation evidence:
  - `design-qa/settings-unified/2048x1152-01-常规.png` through `2048x1152-10-会话归档.png`
  - responsive captures at `1280x800-*` and `900x720-*`
  - geometry and console report: `design-qa/settings-unified/report.json`
- Combined comparison evidence:
  - `design-qa/settings-unified/comparison-overview.png`
  - nine focused pairs at `design-qa/settings-unified/compare-*.png`
- Viewport and density:
  - Source rasters are 2048 × 1152 pixels from the user-provided Windows captures.
  - Primary implementation window is 2048 × 1152 CSS px; Electron capture is 3051 × 1634 physical pixels under the host Windows display scale.
  - Responsive implementation windows are 1280 × 800 and 900 × 720 CSS px.
  - Pair comparisons independently normalize each full canvas to 1024 × 576 before horizontal composition. Because the source state and Electron capture density differ, the comparison is used for hierarchy, grouping and rhythm rather than false pixel-level typography claims.
- State: light theme; source contains live local data, implementation uses the visual-snapshot preload with representative Provider, Python and MCP states. Empty Skills and archived-session states are intentional verification states.

### Findings

- No actionable P0/P1/P2 finding remains.
- The former cross-tab title jump is removed: all ten headers measure 980 CSS px on the same horizontal axis; only the Skills body intentionally breaks out to 1380 CSS px.
- The standard setting pages now share one section surface, 58px section header, 70px preference-row rhythm, aligned controls and one semantic status treatment.
- The resource pages are intentionally differentiated without becoming a separate visual system: Python is one resource row, MCP is a collapsible resource summary, and Skills keeps the catalog/detail workspace.
- The browser page separates connection behavior from evidence and secret authorization. The workflow page separates stage rules, draft/version behavior, publishing gates and lifecycle settings.
- At 900px, Skills changes to a single-column catalog/detail flow and the remaining pages reflow without page-level horizontal overflow. The filter strip retains its deliberate internal horizontal scroller rather than clipping controls.

### Required fidelity surfaces

- Fonts and typography: retained the existing application font stack and page-title hierarchy. Section titles, preference titles, descriptions and scope chips now use the same weights and line-height rules across every tab; no new font was introduced.
- Spacing and layout rhythm: header axis, section gap, row height, control alignment and radii are shared. The 980px standard and 1380px catalog widths are explicit layout modes rather than per-page drift.
- Colors and tokens: all surfaces, dividers, text, warning, success and disabled states use existing semantic tokens. No one-off palette, gradient or shadow was introduced.
- Image quality and assets: the settings UI contains no raster illustration target. Existing Lucide icons were preserved and aligned through shared resource-icon geometry; no placeholder, CSS drawing or custom SVG was added.
- Copy and content: `Provider` was localized to `模型提供方`; resource/status copy remains concise. MCP details are still searchable and available on expansion. Empty archive copy now explains what appears there and what can be done later.
- Accessibility and interaction: existing labels and semantic switches/selects are preserved. MCP summary is a real button with `aria-expanded`; error/progress/status regions retain live-region semantics. Automated captures report no horizontal overflow, while unit tests cover switching, selecting, expansion, saving and error recovery. Keyboard focus appearance was not exhaustively screenshot in every tab and remains a P3 follow-up verification item.

### Comparison history

1. Source finding [P1]: section headers and bodies moved horizontally between standard pages and Skills. Fix: keep the page header in a fixed 980px frame and allow only `.settings-stack--wide` to break out. Post-fix geometry shows every header at the same axis and Skills alone at 1380px.
2. Source finding [P1]: runtime duplicated switches and nested a table inside a card; MCP exposed all transport/tool details by default. Fix: runtime became one resource row and MCP became an accessible collapsible summary. Post-fix focused pairs are `compare-02-runtime.png` and `compare-04-mcp.png`.
3. Source finding [P2]: browser and workflow mixed unrelated setting types inside one visual block. Fix: browser was divided into connection and authorization sections; workflow into four task-oriented groups. Post-fix focused pairs are `compare-05-browser.png` and `compare-07-workflow.png`.
4. Responsive check [P2]: wide catalog content needed a defined narrow behavior. Fix: the wide breakout resets below 1180px and existing Skills breakpoints switch to one column. The 1280 × 800 and 900 × 720 captures show no document overflow.

### Verification

- Settings and Skills focused unit tests: 2 files, 21 tests passed.
- TypeScript renderer and Electron checks passed.
- Production build, repository-root audit and 16 Skill manifest validations passed.
- Electron visual QA: 30 screenshots across 3 viewport sizes, zero console errors and zero page-level horizontal-overflow failures.
- Primary interactions checked by tests: navigation, MCP expansion/search, Python toggle, browser toggle/token workflow, selects, workflow reset/save and archive open/restore.

final result: passed

---

## Skill 信息架构整合 — 2026-08-08

- Source visual truth:
  - `C:/Users/say/AppData/Local/Temp/codex-clipboard-036795fa-9a6f-4cb4-882f-31f064f9c8f0.png`（原 Skills 与 MCP 设置页，2048 × 1152）
  - `C:/Users/say/AppData/Local/Temp/codex-clipboard-547e0812-8eb4-438a-bd1c-591290363429.png`（原资料来源页，2048 × 1152）
  - `C:/Users/say/AppData/Local/Temp/codex-clipboard-600816ba-8aa1-4427-941c-c0c22f6f4d22.png`（原运行记录页，2048 × 1152）
- Implementation screenshots:
  - `design-qa/skill-detail-context-after.png`
  - `design-qa/sources-settings-after.png`
  - `design-qa/runs-center-after.png`
- Normalized comparisons:
  - `design-qa/compare-skills.png`
  - `design-qa/compare-sources-skill-ia.png`
  - `design-qa/compare-runs.png`
- Viewport: 2048 × 1152 CSS px, device density 1. Source and implementation are both 2048 × 1152; comparison images scale each side to 1024 × 576 before horizontal stacking.
- State: light theme, browser preview data, Skill detail expanded and filtered-source context where available.

### Full-view comparison evidence

- The main navigation no longer duplicates Sources and Skills; it keeps task-oriented entry points and renames the global history surface to 运行中心.
- Settings now separates Skills, MCP 服务, and 资料来源. The visual language, spacing tokens, typography, radii, and pale green settings shell remain consistent with the source screens.
- Expanded Skill rows now show related sources and recent runs without leaving the capability context. The global run center remains available for cross-Skill filtering and diagnosis.

### Focused comparison evidence

- `compare-skills.png` confirms the former combined Skills/MCP page is split without changing the existing settings frame. The expanded RSS Skill includes two compact contextual cards and preserves existing technical/package controls.
- `compare-sources-skill-ia.png` confirms the source-management list is now embedded in Settings and scoped to `rss-article-saver`, while retaining the original metrics, distribution, source row, and quick actions.
- `compare-runs.png` confirms the original list/detail composition is retained and gains type, state, and Skill filters plus clearer user-facing copy. Preview data had no run rows, so failure-summary visual treatment could only be covered by unit tests.

### Required fidelity surfaces

- Fonts and typography: existing app font stacks, heading weights, mono IDs, truncation, and line heights are retained.
- Spacing and layout rhythm: settings content keeps the existing centered max-width; Skill context cards use the existing compact card rhythm. The source page intentionally becomes narrower inside Settings.
- Colors and tokens: only existing semantic surface, border, accent, success, danger, and muted tokens are used.
- Image quality and assets: no raster imagery was added or replaced; all UI icons continue to use the established Lucide dependency.
- Copy and content: duplicate labels were removed; internal `Root Generation` is presented as `数据快照`; `Artifacts` is presented as `运行产物`.

### Comparison history

1. Initial [P1]: moving 资料来源 into Settings hid the header's `立即全部抓取` and `添加源` actions.
2. Fix: added both actions to the embedded source-context bar for global and Skill-filtered views.
3. User validation [P1]: the first Skill context implementation was attached only to loaded capability definitions; when the page reported `0 Skills`, every visible local package still lacked source/run affordances.
4. Fix: every visible local Skill package now exposes `资料来源` and `运行记录` actions with live counts, and the latest run state when available. Both actions preserve the package Skill id as navigation context.
5. User validation [P1]: package-level shortcut buttons still did not express the intended hierarchy. The required model is Settings → Skills list → selected Skill detail.
6. Fix: Settings now embeds the full two-column Skill catalog/detail experience. Selecting a Skill exposes its run history and related sources in the detail pane. Skills with Manifest `secret-ref` bindings additionally expose a `查看 Key` control that reveals binding metadata and configuration status without returning secret values.
7. Post-fix limitation: targeted tests and the production renderer build pass, but the in-app browser blocked the final local-page refresh before a new post-fix screenshot and console check could be captured.

### Verification

- Focused UI tests: 5 files, 64 tests passed.
- TypeScript renderer and Electron checks passed.
- Renderer production build passed.
- At the time of this capture, the full unit suite still had unrelated
  environment/platform failures (`/tmp` unavailable and a Windows executable
  canonicalization assertion). Those cross-platform test fixtures were later
  corrected. The Internal Agent request failures mentioned in the original
  note are obsolete under ADR-010 because that runtime was removed.

final result: blocked

---

## AI code-block simplification and permission-toast removal — 2026-07-28

- Source visual truth:
  - `C:/Users/say/AppData/Local/Temp/codex-clipboard-bf1e3734-a71c-4515-985f-0aecdce311d9.png` (permission-success toast to remove; 3840 × 2088)
  - `C:/Users/say/AppData/Local/Temp/codex-clipboard-ef6ed899-98a3-4022-ac09-60b5212af889.png` (terminal titlebar and expand-control baseline to remove; 3840 × 2088)
  - `C:/Users/say/AppData/Local/Temp/codex-clipboard-46dec1a9-d600-4de4-8d98-b08778c37396.png` (authoritative simple code-block treatment; 1395 × 693)
- Implementation screenshot: `design-qa/ai-code-block-simple-1366x768.png` (1366 × 741 content pixels from a 1366 × 768 Electron window, CSS density 1)
- Focused normalized comparison: `design-qa/ai-code-block-focus-comparison.png` (1010 × 247; source and implementation blocks normalized to the same width)
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
  - `C:/Users/say/AppData/Local/Temp/codex-clipboard-a622f50e-e9a6-4363-80e8-fb7fdb782262.png` (reported OpenMind control with unread count)
  - `C:/Users/say/AppData/Local/Temp/codex-clipboard-a96672b1-fea0-425d-87f2-7c91dc39e1e1.png` (authoritative Codex control)
- Implementation screenshot: `design-qa/scroll-to-bottom-codex-match-2026-07-22.jpg`
- Focused comparison evidence: `design-qa/scroll-to-bottom-codex-comparison-2026-07-22.png`
- Viewport: 1550 × 1015 CSS pixels, matching the reported OpenMind capture at its 1.5 display scale; light theme; browser-preview data with a long-conversation scroll state.

### Full-view comparison evidence

- The updated control remains centered above the composer and appears only when the reader is away from the conversation bottom. Its click target and smooth return-to-bottom behavior are unchanged.
- The control now uses the Codex reference geometry: a stable 32 × 32px circle, 1px low-contrast border, white panel surface, 16px Lucide `ArrowDown` at 1.8 stroke width, and only a 5% 0/1/2px shadow.
- The red unread-count badge is absent from the rendered DOM, and the badge-only count state, refs, effects, markup, and CSS have been removed.

### Focused comparison evidence

- The Codex source crop and implementation crop were normalized to the same visual scale and opened together in `scroll-to-bottom-codex-comparison-2026-07-22.png`.
- Circle diameter, arrow scale, stroke weight, neutral surface, and border contrast align with the reference. OpenMind retains its existing design tokens instead of introducing a one-off color or handcrafted icon.

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
  - `design-qa/settings-typography-1546x1012.jpg`
  - `design-qa/settings-typography-dark-1546x1012.jpg`
- Combined comparison evidence:
  - `design-qa/settings-typography-reference-comparison.png`
  - `design-qa/settings-typography-focus-comparison.png`
  - `design-qa/settings-typography-before-after.png`
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
  - `design-qa/responsive-motion-compact-docked-1440.png`
  - `design-qa/responsive-motion-compact-docked-900.png`
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

- Fonts and typography: existing OpenMind font stack, weights, line heights, truncation, and AI hierarchy are unchanged. At 840px, header geometry remains within the viewport: title 488px, selector 190px, and actions 122px with the right edge at 828px.
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
  - `design-qa/responsive-codex-wide-1356.png`
  - `design-qa/responsive-codex-medium-834.png`
  - `design-qa/responsive-codex-narrow-720.png`
  - `design-qa/responsive-ai-companion-720.png`
  - `design-qa/responsive-companion-stable-1100.png`
- Normalized comparisons:
  - `design-qa/responsive-codex-wide-comparison.png`
  - `design-qa/responsive-codex-medium-comparison.png`
  - `design-qa/responsive-codex-narrow-comparison.png`
- Viewports: 1356 × 1046, 834 × 1046, and 720 × 1034; light theme; browser-preview data.

### Full-view comparison evidence

- At 1356px, OpenMind keeps its persistent product navigation and full work canvas, matching Codex's stable wide-window hierarchy without replacing OpenMind typography, colors, or content model.
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

- Fonts, typography, colors, radii, and Lucide icons continue to use the existing OpenMind design system.
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
- P3: OpenMind intentionally keeps its own product chrome and content density; the Codex reference governs responsive interaction and pane behavior, not visual rebranding.

final result: passed

---

- Source visual truth:
  - `C:/Users/say/AppData/Local/Temp/codex-clipboard-c2f0318f-a91e-402c-89e4-7f256fa0a75f.png`
  - `C:/Users/say/AppData/Local/Temp/codex-clipboard-d6fd9d50-c693-4643-b1b8-0951c47c468d.png`
  - `C:/Users/say/AppData/Local/Temp/codex-clipboard-da0be624-12b0-48a9-90e4-7c9909447156.png`
  - `C:/Users/say/AppData/Local/Temp/codex-clipboard-3dda3ca2-df8c-44d3-b827-0cc74c9b4c60.png`
- Implementation screenshots:
  - `C:/Users/say/AppData/Local/Temp/openmind-design-qa-ai.png`
  - `C:/Users/say/AppData/Local/Temp/openmind-design-qa-creative.png`
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

- Source visual truth: historical comparison image retained outside this source repository
- Implementation screenshot: `design-qa/home-audit-final-1280x720.png`
- Expanded navigation and active prompt evidence: `design-qa/home-audit-expanded-1280x720.png`
- Recent-task flyout evidence: `design-qa/home-audit-history-1280x720.png`
- Viewport: implementation 1280 × 720; source 2048 × 1422. Both show the light-theme, new-task empty state. The source viewport could not be normalized in the browser, so the comparison uses visible proportions and interaction hierarchy rather than pixel-level coordinates.
- State: collapsed navigation by default, empty new task, no active input focus; expanded, prompt-selected, and recent-task states were checked separately.

## Full-view comparison evidence

- The implementation preserves the source's narrow developer-tool rail, top conversation header, centered engineering-task examples, and single composer.
- The task content now occupies a tighter vertical band: the project, value proposition, examples, shortcut hint, and composer read as one start-to-submit flow instead of four loosely separated regions.
- The larger value heading, explicit `当前项目 · openmind` context, and localized `尚未创建` state are intentional audit-driven changes rather than fidelity drift.
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

- Source visual truth: `design-qa/sources-layout-reference.png`
- Implementation screenshot: `design-qa/sources-layout-browser-final.png`
- Normalized full-view comparison: `design-qa/sources-layout-comparison-1280.png`
- Focused content comparison: `design-qa/sources-layout-focused-comparison.png`
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
- Implementation screenshot: `design-qa/sidebar-optical-match-final.png`
- Normalized side-by-side comparison: `design-qa/compare-workbuddy-optical-match.png`
- Viewport: 1280 × 720, light theme; WorkBuddy crop normalized from the same Windows screenshot scale to a 260px CSS sidebar.
- State: expanded Daily Brief navigation with active row, recent task, and Settings visible.

## Root-cause evidence

- Pixel measurements showed normal menu glyphs were already approximately the same height; the mismatch was concentrated in ink density and special-case overrides.
- The installed WorkBuddy 5.2.5 renderer CSS uses 13px navigation text, 400 normal weight, 600 active weight, 30px rows, 22px line-height, 16px icons, a 12px/700 brand title, and a 10px version label.
- OpenMind was using 480/650 navigation weights, a 13px brand title, and a separate 14px/500 Settings rule. The recent-task toggle also computed to 13px because the generic navigation selector overrode its intended 11px group-label token.

## Implemented match

- Navigation now uses the WorkBuddy values: 13px, 400/600 weights, 30px rows, 22px line-height, 16px icons, and 4px 12px padding.
- Brand typography now uses 12px/700 with an 18px line-height; the version label uses 10px/400 with a 14px line-height.
- Settings no longer has a larger 14px special case and inherits the same 13px/400 navigation scale.
- Recent-task headings now resolve to 11px/400 with an 18px line-height and no added letter spacing.
- The variable Segoe face was removed from the primary UI stack so Windows uses the same conventional Segoe/fallback behavior as the reference.

## Verification

- Live computed values confirmed: active 13px/600/22px, normal 13px/400, Settings 13px/400, brand 12px/700/18px, recent heading 11px/400/18px.
- Normalized visual comparison confirms OpenMind no longer has a larger or heavier optical footprint than WorkBuddy.
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
- AI implementation screenshot: `C:/Users/say/AppData/Local/Temp/openmind-ui-audit/05-openmind-shell-density-1280x720.png`
- Daily Brief implementation screenshot: `C:/Users/say/AppData/Local/Temp/openmind-ui-audit/07-openmind-daily-sidebar-1280x720.png`
- Focused shell comparisons:
  - `C:/Users/say/AppData/Local/Temp/openmind-ui-audit/06-workbuddy-shell-comparison.png`
  - `C:/Users/say/AppData/Local/Temp/openmind-ui-audit/08-workbuddy-daily-sidebar-comparison.png`
- Viewport: 1280 × 720 implementation; source sidebars normalized from the supplied 425 × 1458 comparison capture to the same 260px CSS width.
- State: expanded WorkBuddy navigation compared with OpenMind AI and Daily Brief navigation, including the recent-task section shown by the user.

## Full-view and focused comparison evidence

- The remaining mismatch was in the application shell rather than only the chat body. The corrected OpenMind shell now measures 260px wide with 13px navigation copy, 30px rows, and 15px icons.
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
- P3: OpenMind intentionally shows fewer navigation groups and different product labels, so vertical content distribution differs even though component size now aligns.

final result: passed

---

# WorkBuddy-style conversation density QA — 2026-07-12

- Source visual truth: `C:/Users/say/AppData/Local/Temp/codex-clipboard-c27b5c1b-4798-41ec-bb23-bee6f1ea51bd.png`
- Implementation screenshot: `C:/Users/say/AppData/Local/Temp/openmind-ui-audit/02-openmind-workbuddy-density-1280x720.png`
- Full comparison evidence: `C:/Users/say/AppData/Local/Temp/openmind-ui-audit/03-workbuddy-implementation-full.png`
- Focused comparison evidence: `C:/Users/say/AppData/Local/Temp/openmind-ui-audit/04-workbuddy-implementation-sidebar.png`
- Viewport: 1280 × 720, light theme, browser-preview conversation state.
- State: WorkBuddy landing screen compared with the OpenMind AI conversation. Because the product states differ, the full comparison is used for shell density and hierarchy only; the focused comparison normalizes the two sidebars to the same width.

## Full-view comparison evidence

- OpenMind now uses a compact 14px conversation body with a measured 22.68px line height, matching the quiet desktop density of the WorkBuddy shell instead of the previous 16px reading-mode treatment.
- The conversation column is 800px wide, leaving a calmer right margin and avoiding the visually oversized long lines in the source OpenMind capture.
- The title remains visually distinct while the conversation body, metadata, navigation, and composer controls form a restrained supporting layer.

## Focused region comparison evidence

- The normalized sidebar comparison shows closely aligned navigation type size, row height, icon scale, active-row weight, muted metadata, and whitespace rhythm.
- OpenMind intentionally keeps its product-specific routes and provider metadata; no fake WorkBuddy rows or labels were introduced.
- A separate focused chat crop was not needed because the WorkBuddy reference does not show a chat state. Browser-computed typography values and the full implementation capture provide the relevant evidence for the requested conversation-density change.

## Required fidelity surfaces

- Fonts and typography: Segoe UI Variable stack retained; conversation body is 14px/1.62, headings scale from the same token, paragraph margins are 8px, and list-item margins are 3px.
- Spacing and layout rhythm: assistant-message gap reduced to 14px and the centered flow column reduced from 880px to 800px.
- Colors and visual tokens: existing WorkBuddy monochrome tokens are unchanged.
- Image quality and asset fidelity: no image assets were required or introduced; existing icon components remain unchanged.
- Copy and content: existing OpenMind labels and realistic preview conversation content are unchanged.

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
- Implementation full screenshot: `C:/Users/say/AppData/Local/Temp/openmind-full-pass3.png`
- Implementation focused crop: `C:/Users/say/AppData/Local/Temp/openmind-sidebar-fullcrop-pass3.png`
- Viewport: 1280 × 720, light theme, default system scale; focused comparison normalized to 264 × 516.
- State: expanded AI-page navigation with one active session.

## Full-view comparison evidence

- The final implementation keeps a 264px expanded sidebar and a 32px navigation rhythm, matching the WorkBuddy reference proportions without shrinking the main app through a renderer zoom override.
- The AI page renders only one session-history surface; the duplicate top-level recent-task block is absent.
- The brand row contains the panel control and global search action in the same lightweight top-right pattern as the reference.

## Focused region comparison evidence

- The normalized WorkBuddy source and the final OpenMind crop were opened together in one comparison input.
- Primary button height, left alignment, item spacing, icon scale, sidebar width, muted brand treatment, section-label hierarchy, and task-row density align with the reference.
- OpenMind intentionally has four product destinations instead of WorkBuddy's five and retains Provider metadata under session titles.

## Required fidelity surfaces

- Fonts and typography: Windows UI font stack; 14px/500 navigation, 650 active weight, 15px muted brand, 13px session titles, controlled truncation, and compact relative timestamps.
- Spacing and layout rhythm: 264px expanded width, 32px primary rows, 17px icons, 9px icon gap, 42px session rows, and an 8px active-button radius.
- Colors and visual tokens: quiet monochrome background, subtle active fill, muted brand/metadata, and existing dark-theme token mapping retained.
- Image quality and asset fidelity: no raster imagery is required for this sidebar; all visible icons use the existing Lucide family rather than custom SVG or CSS drawings.
- Copy and content: OpenMind labels remain product-specific; “每日简报” is unchanged, while “创作” and “资料库” remain the concise sidebar labels.
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
- P3: WorkBuddy's screenshot contains more navigation/task types than OpenMind; adding fake rows solely for vertical alignment would damage the product information architecture, so the shorter content stack is intentional.

final result: passed

---

# WorkBuddy composer parity QA — 2026-07-12

- Source visual truth: `C:/Users/say/AppData/Local/Temp/codex-clipboard-33707b1f-2078-4dc0-b3bb-918276e8b3b0.png`
- Implementation screenshot: `design-qa/composer-workbuddy-final-1280x720.png`
- Focused interaction screenshot: `design-qa/composer-workbuddy-permission-open-1280x720.png`
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
- Fonts and typography: existing OpenMind font stack is preserved; title and path hierarchy match the reference at current application density.
- Spacing and layout rhythm: the card is capped at the same 720 px conversation width, with a 52 px header and 34 px file rows; the left preview/right conversation split remains resizable. Its visible divider is 1 px in idle, hover, focus, and active resize states while the 4 px track plus the existing extended hit area remain draggable.
- Colors and visual tokens: existing panel, border, hover, focus, and muted-text tokens are reused without introducing a separate visual language.
- Image quality and asset fidelity: no raster assets are required; the existing Lucide icon system is retained.
- Copy and content: the title now uses `已编辑 N 个文件`; additions, deletions, undo, and review copy are absent from the durable edited-files card.
- Accessibility: each file is a real button, the extra-files control exposes `aria-expanded`, the separator exposes value semantics, and reduced-motion users skip the split transitions.
- P3 follow-up: the exact document glyph differs slightly from the Codex source because OpenMind keeps its existing icon family. This is intentional and non-blocking.

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

---

# Setup 向导设计 QA

## 对照基准

- 视觉基准：`C:\Users\say\AppData\Local\Temp\codex-clipboard-3276d47f-480d-4699-be32-99d3b860a6be.png`
- 基准尺寸：2774 × 1996 px，对应 1387 × 998 CSS px（2× 截图）。
- 实现视口：1387 × 998 CSS px；以下桌面截图均为 1387 × 998 px，因此按相同 CSS 尺寸比较。
- 对照状态：首次启动、尚未选择 openmind 根目录的第 1 步。

## 实现截图

- 第 1 步：`C:\Users\say\.codex\visualizations\2026\08\20\01a01f50-b13c-7261-a5a0-b0598cfa3a43\setup-step-1.png`
- 第 2 步：`C:\Users\say\.codex\visualizations\2026\08\20\01a01f50-b13c-7261-a5a0-b0598cfa3a43\setup-step-2.png`
- 第 3 步：`C:\Users\say\.codex\visualizations\2026\08\20\01a01f50-b13c-7261-a5a0-b0598cfa3a43\setup-step-3.png`
- 第 4 步：`C:\Users\say\.codex\visualizations\2026\08\20\01a01f50-b13c-7261-a5a0-b0598cfa3a43\setup-step-4.png`
- 窄屏 720 × 900：`C:\Users\say\.codex\visualizations\2026\08\20\01a01f50-b13c-7261-a5a0-b0598cfa3a43\setup-step-1-narrow.png`

## 检查结果

| 项目 | 结果 | 证据 |
| --- | --- | --- |
| 整页构图 | 通过 | 在同一视觉检查输入中并排查看原始截图与第 1 步实现；保留浅色渐变背景、白色主画布、标题区、安全提示区和卡片语言。按需求将三列卡片改为居中的单卡向导。 |
| 字体与层级 | 通过 | 标题、眉题、正文、卡片标题和状态标签沿用现有设计系统；四步截图中层级一致且无截断。 |
| 间距与对齐 | 通过 | 进度条、卡片及操作区在桌面与 720 px 窄屏均对齐；窄屏隐藏进度文字、保留编号/完成态，未出现横向溢出。 |
| 色彩与图标 | 通过 | 沿用现有中性色、绿色成功态和 Lucide 图标，不引入新的光栅素材或替代图标体系。 |
| 文案 | 通过 | 第 1 至第 4 步编号、说明、必选/可跳过动作与用户需求一致；第 1、2 步没有跳过入口，第 3 步保留“稍后配置”。 |
| 动效 | 通过 | 每次推进使用设计 token 驱动的向左滑动；轨道在第 2/3/4 步的矩阵位移分别为 -1004、-2008、-3012 px；同时提供 `prefers-reduced-motion` 回退。 |
| 可访问性 | 通过 | 非活动面板设置 `inert` 与 `aria-hidden`；每个状态仅有一个可访问标题和一个活动面板。进度条提供中文 aria-label。 |
| 完整流程 | 通过 | 实机浏览器依次完成：选择并确认根目录 → 安装官方 Skill → 跳过 Provider → 进入工作台。控制台 error 日志为空。 |

## 迭代记录

1. 代码审查阶段发现进度连接线可能穿过标签、且 Skill 安装触发 Provider 重挂载时可能丢失滑动感；在首轮浏览器截图前调整连接线层级，并为活动卡片增加同方向入场动画。
2. 桌面 1387 × 998 首轮视觉对照：未发现 P0、P1 或 P2 偏差。
3. 窄屏 720 × 900 检查：未发现溢出、遮挡或不可读内容；无需继续修正。

## 最终结论

passed

---

# 极简 Setup 向导设计 QA

## 对照基准

- 最终视觉目标：`C:\Users\say\.codex\generated_images\01a01f50-b13c-7261-a5a0-b0598cfa3a43\exec-a27aa6f1-0a12-4d6a-b200-7da484c1815e.png`
- 实现截图：`C:\Users\say\.codex\visualizations\2026\08\20\01a01f50-b13c-7261-a5a0-b0598cfa3a43\setup-minimal-step-1-v2.png`
- 对照视口：1487 × 1058 CSS px；目标图与实现图均为 1487 × 1058 px，device scale 为 1，无需做像素密度归一化。
- 对照状态：浅色主题、首次启动、尚未选择 openmind 根目录的第 1 步。

## 完整视图对照证据

最终视觉目标和浏览器实现截图在同一个比较输入中并排检查。两张图均为完整视图且表单区域清晰可读，因此不需要额外裁剪；关键几何位置同时用浏览器 DOM 测量确认。

## 检查结果

- 未发现可执行的 P0、P1 或 P2 偏差。
- 字体与层级：沿用应用现有 display/system 字体；主标题为 42 px、粗体，正文 16 px，顶部步骤与安全说明使用较弱层级。超大步骤号是实时文字，不是位图素材。
- 间距与构图：内容舞台宽 1040 px；实现中的步骤区域为 `x=223.67, y=338.34, w=1040`，标题为 `x=621.67, y=368.34, w=620, h=48.72`，路径框为 `x=621.67, y=545.46, w=630, h=66`，首段进度线为 `x=585.67, y=979, w=70, h=4`，与目标图的视觉坐标一致。
- 色彩与设计 token：页面使用 `--app-chrome-bg`，标题/按钮使用 `--text` 与 `--accent`，正文与辅助信息使用 `--text-dim`、`--muted`，路径框使用现有 control/border token；整体即方案 1 与主 UI 一致的冷白、浅薄荷配色。
- 图标与素材：只使用项目现有 Lucide 图标，不含新增光栅内容资产，也没有用近似图标替代既有体系。
- 文案：保留简洁的应用语气；第 1、2 步为硬门禁，第 3 步明确可稍后配置，第 4 步是非阻塞的完成/进入页，不伪装成第四个配置项。
- 交互与动效：四个面板一次只暴露一个；第 2/3/4 步轨道位移依次为 -1487.33、-2974.67、-4462 px；transform 使用 240 ms emphasized easing，并提供 reduced-motion 回退。切步后标题获得焦点，非活动面板设为 `inert` 与 `aria-hidden`。
- 流程门禁：浏览器完整走通“选择并确认根目录 → 安装官方 Skill → 跳过 Provider → 进入工作台”；在显式进入前主工作台和全局快捷键均不可绕过。浏览器控制台 error 日志为空。
- 响应式：720 × 900 窄屏截图为 `C:\Users\say\.codex\visualizations\2026\08\20\01a01f50-b13c-7261-a5a0-b0598cfa3a43\setup-minimal-narrow.png`，无横向溢出；1024 × 650 矮窗截图为 `C:\Users\say\.codex\visualizations\2026\08\20\01a01f50-b13c-7261-a5a0-b0598cfa3a43\setup-minimal-short.png`，面板可滚动且底部安全说明未被裁切。

## 迭代记录

1. 首轮浏览器截图 `setup-minimal-step-1.png` 暴露 P2：超大 `01` 偏低且偏窄、正文与路径区域约高 30 px、底部进度线约低 45 px、主按钮偏宽。
2. 调整步骤号缩放与位置、表单纵向节奏、路径/操作间距和底部进度位置，并缩短主按钮文案。
3. 修正后将目标图与 `setup-minimal-step-1-v2.png` 再次并排对照；关键坐标已对齐，未留下 P0、P1 或 P2。步骤号受系统字体影响比目标窄约 32 px，属于非交互装饰的 P3 可接受差异。

## 验证

- TypeScript 检查通过。
- Onboarding、App 与浏览器预览相关单元测试共 36 项通过。
- renderer production build 通过。
- `git diff --check` 通过。

final result: passed

---

# Setup RSS 文案与连续滑动设计 QA

## 对照基准

- 用户反馈截图：`C:\Users\say\AppData\Local\Temp\codex-clipboard-aa8017a2-64ff-472f-8df6-15523ff0d8c7.png`
- 更新后的第二步：`C:\Users\say\.codex\visualizations\2026\08\20\01a01f50-b13c-7261-a5a0-b0598cfa3a43\setup-rss-step-2-2143x1949-v2.jpg`
- 更新后的第一步：`C:\Users\say\.codex\visualizations\2026\08\20\01a01f50-b13c-7261-a5a0-b0598cfa3a43\setup-openmind-step-1-final.jpg`
- 用户截图为 2143 × 2006 px，其中顶部 57 px 是 Electron 窗口边框；实现截图使用相同宽度和 2143 × 1949 CSS px 的 app-owned 区域，device scale 为 1。视觉判断忽略窗口边框，只比较应用内容。
- 状态：浅色主题，必填数据目录已完成、RSS 安装尚未完成的第 2 步。

## 对照证据

用户截图与更新后的第 2 步在同一个比较输入中打开。完整视图已经清楚显示标题、说明、来源框、主按钮、安全提示和底部进度，不需要额外裁剪；浏览器 DOM 测量同时确认第二步标题位于 `y=827.60`，内容舞台宽 1040 px，未发生布局漂移。

## Findings

- 未发现可执行的 P0、P1 或 P2 问题。
- 字体与排版：保持原有 display/system 字体、42 px 主标题、16 px 说明和既有字重；“安装 RSS 源”与“选择 OpenMind 数据目录”均未截断或破坏层级。
- 间距与布局节奏：继续沿用参考图的 300 px 装饰数字 + 630 px 表单两列结构；移除次要导入动作后，主按钮独占操作行，留白更干净，没有改变路径框、说明或底部进度位置。
- 色彩与 token：仍使用 `--app-chrome-bg`、`--text`、`--muted`、`--border-subtle` 和现有主按钮 token；未引入新色值。
- 图像与图标：没有新增光栅内容资产；继续使用项目现有图标库，装饰数字仍是实时文字。
- 文案与内容：第一步改为“选择 OpenMind 数据目录”；第二步标题和按钮改为“安装 RSS 源”，正文明确说明实际安装的是 RSS 采集所需官方组件，避免把 Git 仓库误称为单个 feed；未完成时不再呈现“打开导入入口”。
- 动效与状态：Setup 期间 `WorkspaceHost` 与 `AiProvider` 保持稳定，同一个 `.onboarding-step-track` 节点从第 1 步推进到第 2、3 步；计算样式为 `transform 0.24s cubic-bezier(0.3, 0, 0, 1)`，轨道因此真实向左滑动，不再靠重挂后的入场假动画。离开 Setup 后才按最终 root scope 重挂 AI 状态。
- 可访问性：每个状态仍只有一个可访问标题；非活动面板保留 `inert` 与 `aria-hidden`，推进后标题获得焦点。

## 验证与比较历史

1. 用户截图暴露三个明确问题：第 1→2 步因外层 key 重挂而没有真实轨道滑动；第二步仍使用 Skill 仓库技术文案；未安装时显示了“打开导入入口”。
2. 将 Setup 路由和临时 AI Provider 稳定在同一棵组件树中，并用回归测试确认第 1→2→3 步的 track DOM identity 不变；同时更新 OpenMind/RSS 文案并移除 onboarding 导入入口。
3. 浏览器重新完成“选择文件夹 → 确认绑定 → 安装 RSS 源 → Provider”流程：第 2 步和第 3 步标题均正确获得焦点，“打开导入入口”按钮计数始终为 0，控制台 error 日志为空。
4. TypeScript 检查通过；Onboarding、App 与浏览器预览相关测试共 37 项通过；生产构建在本轮最终代码上通过。

final result: passed

---

# Skill 内嵌来源配置交互 QA — 2026-08-22

## 对照基准

- Source visual truth: `C:\Users\say\.codex\generated_images\01a028e8-1319-7c53-8b8d-0a654ea370cc\exec-3b80d2cb-2797-43ba-8603-1d514ee59816.png`
- Implementation screenshot: `D:\work\openmind-app\artifacts\design-qa\skills-source-implementation-final.png`
- Combined comparison evidence: `D:\work\openmind-app\artifacts\design-qa\skills-source-comparison-final.png`
- Earlier implementation evidence: `D:\work\openmind-app\artifacts\design-qa\skills-source-implementation-pass1.png` and `skills-source-implementation-pass2.png`
- Viewport and density: source and implementation are both 1487 × 1058 physical pixels at a 1487 × 1058 CSS viewport and device scale 1. They were placed side by side without resampling, so no density normalization was required.
- State: light theme, cctools Git group expanded, RSS 文章采集 selected, 订阅源 tab active, three representative subscriptions visible.

## Full-view and focused evidence

The source and final browser capture were opened in one side-by-side comparison input. The full view keeps the settings shell, catalog, detail header, tabs, toolbar, source rows, switches, and default rule strip readable. A separate crop was not needed because the implementation intentionally preserves the established Settings header and centered 980 px content axis; browser DOM inspection supplemented the compact row and interaction checks.

## Findings

- No actionable P0/P1/P2 finding remains.
- Fonts and typography: the implementation keeps the same system font stack, weights, muted metadata scale, and title hierarchy as the other Settings tabs. Source names and URLs truncate predictably and the source-owned heading remains one line at the tested detail width.
- Spacing and layout rhythm: the Skill details remain inside the existing centered Settings frame rather than adopting the mock's edge-to-edge workspace. This is an intentional product constraint. Within that frame, the metadata, tabs, source heading, toolbar, list, and rules strip keep a compact sequential rhythm. A 720 px detail-container query prevents the actions and search field from squeezing the source heading.
- Colors and tokens: neutral panel, selected-row, border, hover, focus, and text tokens are reused from the current Settings UI. Only semantic success/warning/failure indicators use color; no new blue selection rail was introduced.
- Image quality and assets: the target contains no raster artwork. The repeated package cube was removed from the detail heading, and the remaining action icons use the existing Lucide icon family.
- Copy and content: ownership is explicit in `RSS 文章采集的订阅源` and the helper states that the configuration belongs only to the current Skill and is not overwritten by repository updates. Reddit and X use corresponding `社区配置` and `请求配置` ownership labels.
- Accessibility and behavior: the three tabs expose tablist/tab/tabpanel semantics and keyboard arrow navigation. Search, add, edit, OPML import, source toggles, close-on-Escape, and Skill availability controls are real semantic controls. Panel entry, selection, press, hover, switch, and modal transitions use existing duration/easing tokens and respect the global reduced-motion rule.
- Responsive behavior: the detail container query stacks the ownership heading above the action/search toolbar before text can wrap into a narrow column; existing Settings breakpoints still collapse the catalog/detail layout for smaller windows.

## Comparison history

1. Pass 1 exposed a P1 visual defect: the generic `muted` class enlarged the disabled source status dot from 7 px to 30 px. The source tone class was renamed to the isolated `idle` state; the final capture shows the correct 7 px marker.
2. Pass 2 exposed a P2 layout defect: placing two actions plus search beside the ownership heading squeezed the title and helper into several lines in the current 540 px detail width. A detail-container query now moves the toolbar to its own row below 720 px while retaining the mock's single toolbar grouping at wider widths.
3. The final combined comparison shows the corrected status marker, readable heading, neutral palette, compact table-like rows, and source-owned tab hierarchy. The remaining full-frame proportion difference is expected because the implementation preserves the already approved Settings header and centered content axis.

## Primary interactions verified

- Search filtered three RSS subscriptions down to one matching row.
- Disabled-source switch changed state successfully.
- Edit dialog opened and closed; add dialog accepted a name and valid RSS URL and increased the source count from 3 to 4.
- Reddit and X catalog selections exposed `Reddit 内容抓取的社区配置` and `X Following 抓取的请求配置` under their own tabs.
- Browser console warnings/errors: none.
- TypeScript checks passed. Skills and browser preview focused tests: 34/34 passed.

final result: passed

---

# Provider 配置弹窗 QA — 2026-08-25

## 对照与状态

- Source visual truth: `C:\Users\say\AppData\Local\Temp\codex-clipboard-671e2386-db37-4458-8dc8-fae10fa2ddd8.png`（2088 × 1185；用户标注的 Provider 配置字段）。
- Implementation full-view: `D:\work\openmind-app\design-qa\provider-dialog-20260825\reference-provider-dialog.png`（2345 × 1401；1577 × 997 CSS 窗口、Electron 默认缩放）。
- Focused implementation: `D:\work\openmind-app\design-qa\provider-dialog-20260825\reference-provider-dialog-focused.png`（680 × 474）。Narrow-width evidence: `D:\work\openmind-app\design-qa\provider-dialog-20260825\900x720-provider-dialog.png`。
- State: 点击列表中已有 Provider 后的配置弹窗；字段、API Key 占位提示和高级设置收起。原图呈现的是内联配置，用户已明确更正为弹窗，因此布局变化是预期交互变化，而不是视觉偏差。

## Full-view and focused evidence

The source image and final full-view capture were opened together for comparison; the focused capture verifies the modal surface itself. The Provider list stays in its existing Settings card, while the configuration is moved into the app's existing modal pattern: dimmed backdrop, centered neutral panel, 14 px radius, existing shadow token, header separator, scrollable form body, and footer actions.

## Findings

- No actionable P0/P1/P2 finding remains.
- Fonts and typography: the dialog reuses the Settings system stack, compact eyebrow, 18 px heading, muted explanatory text, field labels, and monospace URL/model inputs without introducing a new type scale.
- Spacing and layout rhythm: name/model retain the two-column desktop arrangement; Base URL and API Key span the modal; advanced settings and footer preserve the existing vertical rhythm. The focused 680 px dialog has no cropped controls.
- Colors and visual tokens: backdrop, panel, borders, shadow, focus ring, muted copy, and primary/secondary actions reuse existing Settings tokens. The visible focus treatment is the project's standard keyboard-focus state.
- Image quality and assets: the source contains no raster assets. The close/disclosure icons remain from the existing Lucide family.
- Copy and content: all original configuration fields are preserved, with the explicit "关闭" and "保存配置" actions. API Key remains masked and uses the established "已设置（留空保留）" behavior.
- Accessibility and behavior: the modal uses `role="dialog"`, `aria-modal`, labelled headings, Escape/backdrop dismissal, focus containment/restoration, and a semantic form. Clicking another Provider closes the prior dialog before opening the next one.
- Responsive behavior: the 900 × 720 capture shows a 680 px-wide dialog with zero horizontal overflow; fields remain readable and the form body can scroll if needed.

## Comparison history

1. The initial interpretation implemented connection probing, which did not match the user's clarified requirement. That flow and its IPC/backend surface were removed.
2. The final pass moves the same configuration fields into the established Provider dialog style and captures the corrected open state at desktop and narrow window sizes.

## Functional verification

- In-app preview: added a synthetic preview Provider, clicked its list row, and confirmed that `编辑 DeepSeek` opens a labelled configuration dialog with all fields and advanced settings. No real credential was used.
- Settings focused tests: 27/27 passed, including dialog opening, per-Provider draft preservation, discard, advanced settings, save, and removal behavior.
- Production build passed, including type checks, repository-boundary audit, manifest validation, renderer build, and Electron preload build.
- Electron visual QA passed with 36 screenshots, zero renderer console errors, and zero horizontal overflow across reference, 2048 × 1152, 1280 × 800, and 900 × 720 viewports.

final result: passed

---

# Skill 来源弹窗统一样式 QA — 2026-08-25

## 对照基准

- Source visual truth: `C:\Users\say\AppData\Local\Temp\codex-clipboard-5d20f689-b41e-45c4-a2b0-509141006a2a.png`（3840 × 2088；改造前的“添加 Skill 来源”弹窗）。
- Project-style target: `D:\work\openmind-app\design-qa\skill-source-dialog-provider-style-20260825\reference-provider-dialog-focused.png`（680 × 474；项目现有“添加 Provider”弹窗）。用户明确要求向此弹窗样式收敛。
- Implementation full-view: `D:\work\openmind-app\design-qa\skill-source-dialog-provider-style-20260825\reference-skill-source-dialog.png`（2345 × 1401；Electron 1577 × 997 CSS 参考窗口）。
- Focused implementation: `D:\work\openmind-app\design-qa\skill-source-dialog-provider-style-20260825\reference-skill-source-dialog-focused.png`（680 × 426）。Narrow-width evidence: `D:\work\openmind-app\design-qa\skill-source-dialog-provider-style-20260825\900x720-skill-source-dialog.png`（1329 × 986；900 × 720 CSS 窗口）。
- Density normalization: 源图是带应用外框的 3840 × 2088 截图，最终目标是复用项目中的 Provider 弹窗而非保持原弹窗尺寸；因此未对整屏图做像素缩放。源图、新 Skill 弹窗聚焦图、Provider 聚焦图及窄窗口图在同一视觉输入中并列检查，判断集中在弹窗表面、控件和交互状态。
- State: 浅色主题；Skill Center 的“添加 Skill 来源”打开，Git 地址与分支为空，本地来源可选；Provider 图仅作为同项目视觉基准。

## Full-view and focused evidence

全视图确认背景设置页、居中位置、遮罩密度与弹窗层级；聚焦图逐项确认标题区、关闭按钮、字段、按钮和 footer。新 Skill 弹窗与 Provider 弹窗均使用 680 px 宽的相同 dialog shell；900 × 720 状态未出现水平溢出。

## Findings

- No actionable P0/P1/P2 finding remains.
- Fonts and typography: 复用 Settings 系统字体、紧凑 eyebrow、标题层级、字段标签和辅助说明；本地来源说明与 Git 标签的字号/权重符合 Provider 弹窗，未出现截断或拥挤换行。
- Spacing and layout rhythm: 标题、分隔线、20 px 内容区节奏、字段间距、14 px 圆角和底部操作栏均复用 Provider 弹窗。原先紧凑的一行来源/输入布局已改为可扫读的本地来源区域和两列 Git 字段。
- Colors and visual tokens: 遮罩、面板、描边、阴影、输入焦点、次要动作和主按钮均使用现有 Settings token；没有保留旧弹窗的独立蓝色按钮或自定义弹层外观。
- Image quality and assets: 目标区域没有栅格资产；文件夹、关闭等图标继续使用项目已有的 Lucide 图标族，没有新增替代性绘制资产。
- Copy and content: 保留“添加 Skill 来源”、本地目录/ZIP、Git HTTPS 地址、分支或 tag、检查与安装等既有任务文案；将操作明确归入 footer 的“取消 / 检查 Git 来源 / 安装”流程。
- Accessibility and behavior: 弹窗具备 `role="dialog"`、`aria-modal`、标题关联、关闭 aria-label、Escape/遮罩关闭及焦点约束/恢复；本地选择、Git 检查、取消检查和安装仍使用原有真实业务逻辑。
- Responsive behavior: 900 × 720 CSS 窗口下表面完整、footer 可用，自动化断言的水平 overflow 为 0。

## Comparison history

1. 初始对比发现 P1：旧“添加 Skill 来源”使用独立的紧凑弹窗壳和单行输入布局，缺少与 Provider 一致的标题层级、内容区节奏和底部操作栏，和用户指定的项目样式不一致。
2. 修复：组件改为复用 `settings-provider-dialog`、标准 body/footer、次要动作和字段样式；本地来源改为与表单节奏匹配的说明区域，原有检查/安装逻辑不变。
3. 修复后证据：上述全视图、聚焦图和 900 × 720 窄窗口图与 Provider 基准图在同一视觉输入中比较；未发现剩余可操作的 P0/P1/P2 差异。

## Implementation checklist

- [x] 统一弹窗外壳、header、body 和 footer。
- [x] 保留本地来源、Git 检查、取消检查和安装交互。
- [x] 覆盖聚焦、Escape、遮罩关闭及窄窗口溢出状态。
- [x] 通过 Skills focused tests（22/22）、生产构建和 Electron visual QA（36 张截图、renderer console errors 为 0）。

final result: passed

---

# Provider API Key 回显与焦点 QA — 2026-08-25

## 对照基准

- Source visual truth: `C:\Users\say\AppData\Local\Temp\codex-clipboard-94fb6283-2521-4cdb-9127-772bafc59030.png`（2499 × 1589；原 API Key 占位文案与绿色焦点环）。
- Implementation full-view: `D:\work\openmind-app\design-qa\provider-key-plain-neutral-20260825\reference-provider-dialog.png`（2345 × 1401；Electron 1577 × 997 CSS 参考窗口）。
- Focused implementation: `D:\work\openmind-app\design-qa\provider-key-plain-neutral-20260825\reference-provider-api-key-focused.png`（680 × 474；API Key 真实聚焦状态）。Narrow-width evidence: `D:\work\openmind-app\design-qa\provider-key-plain-neutral-20260825\900x720-provider-dialog.png`（680 × 474；900 × 720 CSS 窗口）。
- Density normalization: 源图是带应用外框和红色标注的 2499 × 1589 问题截图；实现图由 Electron 夹具以 1:1 dialog crop 输出。没有按整屏像素尺寸进行缩放；源图、聚焦实现图和窄窗口实现图在同一视觉输入中比较，判断集中在 API Key 字段的可见值、焦点状态和周边布局。
- State: 浅色主题、编辑既有 Provider。实现使用非生产测试 Key，未读取、记录或截图任何真实 API Key。

## Full-view and focused evidence

全视图确认 Provider 弹窗的位置、标题、字段节奏和 footer 不变；聚焦图确认 API Key 以普通文本显示且没有绿色外环。自动化同时断言输入为 `type="text"`、回显夹具原值、`box-shadow: none`、`outline: none`。900 × 720 CSS 状态下 dialog 宽 680 px、水平 overflow 为 0。

## Findings

- No actionable P0/P1/P2 finding remains.
- Fonts and typography: API Key 继续使用项目的等宽输入字体与 12 px 字段文本，原有 Provider 标题、标签和说明层级没有改变。
- Spacing and layout rhythm: 字段尺寸、边距、圆角、两列布局和 footer 保持 Provider 弹窗既有节奏；回显后的长 Key 在单行输入内正常横向编辑，不挤压相邻字段。
- Colors and visual tokens: 移除了高饱和绿色 border/ring，焦点保留中性 `border-strong` 与输入光标，不再呈现突兀的状态色。
- Image quality and assets: 该区域没有图像资产；原有 Lucide 图标和弹窗表面未被替换。
- Copy and content: 帮助文案改为如实说明“API Key 会回显原有值”，与用户指定的本地受信任界面行为一致。
- Accessibility and behavior: API Key 仍是有标签的可编辑文本框；点击具体 Provider 后才经专用 typed IPC 读取该 Provider 的 Key，列表获取接口仍不返回任何 Key。取消会恢复编辑前值，保存会提交当前字段值。
- Responsive behavior: 900 × 720 CSS 窗口下表单和操作栏完整可用，未发现裁切或水平溢出。

## Comparison history

1. 初始对比发现 P1：编辑弹窗只显示“已设置（留空保留）”，并为 API Key 焦点添加绿色双层外框；这与用户要求的原 Key 回显和中性选中状态不一致。
2. 修复：增加只在明确打开该 Provider 编辑弹窗时读取单个 Key 的 typed IPC；输入改为普通文本回显，并以中性 border 替换绿色 focus ring。
3. 修复后证据：聚焦图显示夹具 Key 为可见文本且无绿色外环；窄窗口图无溢出，视觉与字段周边节奏一致。

## Implementation checklist

- [x] 在编辑弹窗中回显当前 Provider 的原 Key，不把所有 Key 放入 Provider 列表视图。
- [x] 移除 API Key 的绿色焦点外环，保留中性输入边界。
- [x] 覆盖保存、取消与真实聚焦状态的自动化断言。
- [x] 通过 97 项相关测试、生产构建与 Electron visual QA（36 张截图、0 console errors、0 horizontal overflow）。

final result: passed
