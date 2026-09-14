# Motion Audit（UI 动效审查）

- **日期：** 2026-09-14
- **范围：** Renderer 全部交互面——设计系统、AI 控制台、壳层导航、文件预览、Projects / Daily Brief / Creative / Settings / Skills / Runs / Automation
- **方法：** 通读样式体系与组件实现，逐项核对反馈（Feedback）、连续性（Continuity）、状态（State）三类问题；只审不改
- **基调：** 克制、现代、专业；目标是让界面"更自然"，而不是让用户注意到"这里有动画"

---

## 0. 现有动效体系评估

项目已有一套成熟的动效基础设施，本次审查的绝大部分"缺口"是**覆盖不全**，而不是**体系缺失**：

- Token（styles.css:106-114）：`--dur-instant 80ms / fast 140ms / normal 200ms / slow 240ms / exit 160ms`；`--ease-standard / emphasized / exit / spring`。
- 按压反馈体系完整（final-polish.css：`data-motion` 五类 variant + 语义 class 兜底）。
- 约 80 个 keyframes，覆盖 tooltip / dropdown / overlay / toast / skeleton / 路由进场 / composer / 审批详情等。
- `useExitPresence` + `data-leaving` 是标准的退场模式；`prefers-reduced-motion` 有全局兜底（新动效只要走 token 即自动被覆盖）。
- `final-polish.css` 中已有 MOTION-P0 编号的整改记录，说明动效曾做过一轮系统治理。

因此本报告的所有建议**只复用现有 token 与模式**，不引入新曲线、新时长体系。

### 已确认良好、明确不需要修改的位置

| 位置 | 现状 |
|---|---|
| Tooltip 进出 | 140ms emphasized in / 140ms exit out，完整 |
| Select / DropdownMenu 进出 + chevron | in/out 齐全 |
| ToggleSwitch thumb | translateX 140ms standard |
| AnimatedDisclosure | 高度+opacity 200ms，惰性卸载 |
| Toast 单条进出 | in/out 完整 |
| ui.confirm 确认框 | 160ms 退出，Esc 有淡出 |
| AI 文件分栏预览开合（AiFilePreviewPane） | useExitPresence 240ms + grid 列过渡 + 拖拽时禁过渡，教科书级 |
| 移动端抽屉本体 | 240ms transform + 200ms opacity |
| 审批详情展开 | approval-detail-in/out + chevron 旋转 |
| "跳到底部"按钮 | in/out 完整 |
| message-actions hover 渐显 | 140ms opacity |
| plan-card todo 状态点 | 颜色 + spring 缩放 |
| 各类拖拽 resize（ColumnSplitter / PDF 缩放） | 拖拽中禁用过渡是正确取舍 |
| 路由切换"旧页无退场、新页 200ms 进场" | 生产力工具惯例，保留硬切是合理的 |
| 侧栏折叠宽度离散切换 | 代码注释明确是性能取舍，保留 |
| 虚拟列表（VirtualList）行进出场 | **不建议加**：虚拟滚动加逐行动画有性能风险，闪现是取舍而非缺陷 |

---

## 1. P0 —— 缺少反馈，可能让用户误认为操作没有生效

### P0-1 停止生成：按钮无反馈，已流出的内容瞬间消失

- **位置：** Composer 停止按钮（`renderer/src/features/ai-console/composer.tsx:594`）；取消逻辑（`renderer/src/ai-context.tsx:864-874`）
- **当前行为：** 点击"停止"后按钮外观不变（无 busy 态）；`aiCancelRun` 成功后 `streamingStore.clearRun(runId)` 立即清空，屏幕上已流出的一半回复一帧内整体消失，不落定为任何可见状态；随后工具行/进程标签瞬变为灰色"已取消"。
- **问题：** 这是全应用最重的"操作了但像没操作/出了事"时刻。用户主动停止，看到的却是内容凭空蒸发。
- **为什么需要动效：** 停止是破坏性意图明确的操作，界面必须立刻确认"已接收"，并给内容一个体面的退场。
- **推荐动效：** ① 停止按钮点击即切入 spinner（LoaderCircle 替换方块图标），往返完成前保持；② 已流出内容不瞬删——保留并整体降为 55% opacity（200ms），尾部追加"已停止"标签；若产品层面决定不保留半截内容，则至少给内容区一个 160ms 的 opacity 淡出。（半截内容是否持久化属产品决策，超出动效范围，建议一并评估。）
- **duration：** 按钮 140ms；内容 160–200ms
- **easing：** `--ease-standard`；淡出用 `--ease-exit`
- **属性：** opacity；按钮 icon 替换
- **值得做：** 是，P0 首位

### P0-2 流式新内容固定延迟 240ms 才出现

- **位置：** 消息流 stagger 计算（`renderer/src/features/ai-console/Chat.tsx:367-368`）
- **当前行为：** `staggerDelay = Math.min(index * 30, 240)`，`index` 是条目在**整个列表**中的绝对位置。流式追加在底部的新块 index 恒为大值，因此每条新消息/新工具卡都先空白等待 240ms，再播放 200ms 进场。
- **问题：** AI 生成是核心路径，每条新内容都固定迟到约 1/4 秒，长会话中尤为明显——这是"连续性"被系统性破坏的最大单点。
- **为什么需要动效：** stagger 的本意是"一批内容按序入场"，对流式逐条追加的场景应延迟为 0。
- **推荐动效：** stagger 只对"同一批首次进场"的条目生效（如会话加载/历史展开的首批），流式追加的条目 delay 固定为 0，保留 200ms 进场动画本身。
- **duration：** 进场 200ms 不变；追加条目 delay 0
- **easing：** 不变（`--ease-emphasized`）
- **属性：** animation-delay（计算逻辑修改）
- **值得做：** 是，改动最小、收益最大

### P0-3 审批"允许"后无就地确认

- **位置：** 审批卡（`renderer/src/features/ai-console/approval.tsx:65-71`、`approval-banner.tsx`）
- **当前行为：** 点击"允许"→ `commitResolution` 完成后卡片直接随 banner 淡出移除，按钮上无任何成功反馈；对比"拒绝"路径反而有 5 秒延迟 + 撤销 toast。
- **问题：** 批准是高安全敏感操作，点击后没有任何"已批准"的就地确认，用户只能去时间线里翻 ApprovalDecisionEvent（且该事件也是瞬现文本）。
- **为什么需要动效：** 用户执行了关键授权，界面必须立即宣告结果。
- **推荐动效：** 被点按钮切入 140ms 成功态（Check 图标 + 成功色），卡片保持约 300ms 后再随 banner 现有的 200ms 退场移除；不加 toast（避免打扰）。
- **duration：** 成功态 140ms；延迟驻留 300ms；退场沿用现有 200ms
- **easing：** `--ease-standard`
- **属性：** color / icon 替换
- **值得做：** 是

### P0-4 保存/自动保存状态徽章三处瞬变，用户无法确认"已保存"

- **位置：** ① ProjectOutputsPanel 保存徽章（`ProjectOutputsPanel.tsx:260`，StatusBadge）；② Creative 文章草稿自动保存状态（`CreativeDetailPane.tsx:234`，纯文本，无 tone）；③ SettingsPage 保存反馈（`SettingsPage.tsx:350`，`<small role="status">`）
- **当前行为：** "待保存→保存中→已保存"的文字与颜色一帧内互换；`.ui-status-badge` 本体没有任何 transition（components.css:699-716；final-polish.css:14 覆盖的是另一个 `.status-badge` class，未覆盖 `ui-status-badge`）。Creative 的 autoSaveStatus 连颜色 tone 都没有，失败仅靠 toast。三处呈现方式互不一致。
- **问题：** "已保存"是最需要被感知的异步结果。瞬变 + 无颜色语义意味着用户（尤其停止打字后扫一眼的用户）无法确认保存是否发生。
- **为什么需要动效：** 状态切换的可感知性本身就是反馈。
- **推荐动效：** ① 给 `.ui-status-badge` 加 `transition: color / border-color / background-color 140ms var(--ease-standard)`；② 三处统一为 StatusBadge + tone 方案；③ "保存中→已保存"切换时给徽章一次 140ms opacity 淡入（暗示状态跃迁）；④ Creative 失败态补 danger tone。
- **duration：** 140ms
- **easing：** `--ease-standard`
- **属性：** color / border-color / background-color / opacity
- **值得做：** 是，一处 CSS + 一处组件统一，全局受益

### P0-5 会话列表状态点瞬变且 running 无脉冲（与顶栏不一致）

- **位置：** 会话历史列表项（`renderer/src/features/ai-console/AiWorkbench.tsx:273`；`workbuddy-refactor.css:544-557` `.nav-recent-dot`）
- **当前行为：** 状态点条件渲染出现/消失，行内布局跳动；running 态是静态色块。顶栏 `.status-dot[data-status=running]` 却有 `status-pulse` 呼吸动画——同一语义两种语言。
- **问题：** "哪个会话在跑/在等审批"是用户扫列表时最关心的状态，静态瞬变让 running 与 idle 难以区分。
- **为什么需要动效：** 脉冲是"进行中"的通用语义，仓库已有现成 keyframe。
- **推荐动效：** dot 复用 `status-pulse`（仅 running 态）；颜色变化加 140ms 过渡；出现/消失用 140ms opacity 替代条件渲染跳动。
- **duration：** 140ms
- **easing：** `--ease-standard`
- **属性：** opacity / background-color
- **值得做：** 是

---

## 2. P1 —— 明显改善交互连续性和产品质感

| # | 位置 | 当前行为 / 问题 | 推荐动效 | duration / easing | 属性 | 值得做 |
|---|---|---|---|---|---|---|
| P1-1 | 会话切换整屏硬切：`Chat.tsx:294-295`（`key={sessionId}` 重挂载）、`:354`（committedKeys 预填充）、`ai-context.tsx:578-596` | 旧会话一帧消失（退场动画完全不播）；新会话无进场（首批条目被标记为已提交）；长会话异步加载期间短暂空白后整屏瞬现；头部 provider/标题瞬换 | 切换时容器 160ms opacity 淡出旧内容（或直接接受旧内容瞬删，但为新内容补一次整体 200ms 淡入）；加载期间显示 3 行 skeleton，加载完 200ms 淡入；头部文字 140ms 交叉淡入。**逐条 stagger 不要用于切换场景** | 160 / 200 / 140ms；standard / exit | opacity（容器级） | 是，AI 主路径最高频的空间跳变 |
| P1-2 | WorkspaceFilePreview / Daily Brief 嵌入预览关闭：`WorkspaceFilePreview.tsx`、`App.tsx:243`、`DailyBriefPage.tsx:166` | 有 `workspace-file-preview-in` 140ms 入场，**无 out**；关闭瞬间消失，与"它从哪来"完全断裂 | 补 160ms 退场：opacity + scale(.985)，用仓库现成的 `useExitPresence` + `data-leaving` 模式 | 160ms；`--ease-exit` | opacity / transform | 是 |
| P1-3 | AiSidebar 折叠↔展开：`AiSidebar.tsx:235`（aside 卸载 ↔ rail 直换） | 两个元素硬切换，面板/导轨瞬间互换 | 收起：aside 160ms opacity 淡出后换 rail；展开：rail 切 aside 后 200ms opacity + 4px 位移进场。宽度动画不做（性能取舍） | 160 / 200ms；exit / standard | opacity / transform(4px) | 是 |
| P1-4 | AiSidebar 浮层/全屏退出：`workbuddy-refactor.css:2987-3041` | companion-overlay / companion-canvas 只有 in 无 out，退出浮层瞬间消失 | 补对称 out keyframe | 160ms；`--ease-exit` | opacity / transform | 是 |
| P1-5 | ProjectListDetail 列表↔详情：`ProjectListDetail.tsx:27-28,52`、`projects.css:543` | 单栏模式 back 后详情瞬失、列表瞬现（无 responsive-pane-in，对比 creative 有）；split 模式列折叠无宽度过渡（`.project-workspace` 有 240ms） | 单栏：退场侧 160ms opacity，进场侧 200ms opacity + translateX(±16px)；split 列折叠补 `grid-template-columns 240ms var(--ease-emphasized)`，拖拽中禁用（加 `is-resizing` 判断，模式照抄 project-workspace） | 160 / 200 / 240ms | opacity / transform / grid-template-columns | 是 |
| P1-6 | EmptyState / ErrorState / Skeleton→内容：`components.css:718-765`，全仓库使用点 | 三个状态组件均无进场动画；skeleton 卸载→内容硬切。Projects/Materials/Runs/Settings 等所有页面全部受影响 | 给 `.ui-empty-state` / `.ui-error-state` / `.ui-loading-state` 加一次 160ms opacity + 4px rise 进场；skeleton 所在容器→内容替换时 160ms 淡入。**改一处组件 CSS，全应用受益** | 160ms；`--ease-standard` | opacity / transform | 是，杠杆率最高 |
| P1-7 | 资料转换中→就绪/失败：`ProjectMaterialsPanel.tsx:313-317` | processing / error / 就绪渲染三块互斥硬切换；列表项状态文字瞬变；重试按钮图标文案硬替换 | 状态块切换 180ms 交叉淡入（旧块 fade out 新块 fade in）；状态标签文字容器 140ms color 过渡；重试按钮图标替换 140ms | 140 / 180ms；standard | opacity / color | 是 |
| P1-8 | 运行失败/取消的进程头：`Chat.tsx:626-633,688-695`、`styles.css:446-453` | "处理中"→"失败/已取消"文字与颜色瞬换，无强调 | 标题颜色 200ms 过渡；失败时进程块 border-color 同步 200ms 过渡到 danger（一次，不闪烁） | 200ms；standard | color / border-color | 是 |
| P1-9 | 发送↔停止按钮：`ai-console.css:1818-1836` | `.composer-send` 只过渡 transform/opacity，背景色（gradient→红）瞬跳 | background-color / color 补 140ms 过渡 | 140ms；standard | background-color / color | 是 |
| P1-10 | Composer 上下文 chips：`composer.tsx:433`、`styles.css:1101` | Tray 随数量条件挂载，chip 增删均瞬变 | chip 进场 140ms opacity+scale(.96)，退场 120ms fade（列表短，无需 FLIP）；Tray 本体出现 160ms | 120–160ms；standard / exit | opacity / transform | 是 |
| P1-11 | ProjectDialog：`ProjectDialog.tsx:34` | `if (!open) return null` 立即卸载，只有进场无退场 | 接 `useExitPresence`（仓库现成模式），补 out keyframe | 160ms；`--ease-exit` | opacity / transform(scale .97) | 是（低频但每次可见） |
| P1-12 | 列表 skeleton→内容（projects 三处自绘）：`ProjectTasksPanel.tsx:289`、`ProjectOutputsPanel.tsx:248`、`ProjectMaterialsPanel.tsx:265` | 自绘 `.project-item-skeleton` 与 design-system Skeleton 并存，行为不统一；materials/outputs 行无入场动画（任务/文件行有 project-list-item-in） | materials/outputs/runs 行补齐 `project-list-item-in` 200ms stagger；skeleton 卸载由 P1-6 的容器淡入兜底 | 200ms；emphasized | opacity / transform | 是 |

---

## 3. P2 —— 锦上添花，可以不做

| # | 位置 | 问题 | 建议 | duration | 值得做 |
|---|---|---|---|---|---|
| P2-1 | toast 堆叠补位（`styles.css:1294`） | 某条退出/插入时其余 toast 瞬间跳动 | stack 容器加 height/transform 过渡或 FLIP | 160ms | 可做可不做 |
| P2-2 | Select 退出时长不匹配（`Select.tsx:58` 140ms vs CSS 160ms） | 退出动画最后 20ms 被截断 | hook 定时对齐 160ms，1 行修复 | — | 值得（属 bug） |
| P2-3 | SegmentedControl 首帧 thumb 从 width:0 展开（`controls.tsx:20-26`） | 挂载首帧无指示器→160ms"长出" | 首次定位禁用过渡（`data-ready` 门控） | — | 值得（同属 bug 性质） |
| P2-4 | Tabs 无滑动指示器（`controls.tsx:35-54`） | active 只有颜色瞬变，与 SegmentedControl 的滑动 thumb 不一致 | 若追求统一可复用 seg-thumb 模式；否则维持现状亦可接受 | 160ms | 可选 |
| P2-5 | `.modal-scrim`/`toast-in` 字面量时长曲线（`styles.css:1295,1317`） | 未接 token，与体系不一致 | 替换为 `--dur-*`/`--ease-*` | — | 值得（一致性清理） |
| P2-6 | DropdownMenu transform-origin 固定 top right（`components.css:200-205`） | `align="start"` 向左下展开时缩放锚点与触发器脱节 | 按 align 切 transform-origin，1 行 CSS | — | 值得 |
| P2-7 | 全局搜索面板原地淡入（`shell.css:220-238`） | 与其他浮层形态不一致（无位移/缩放） | 加 translateY(-8px)+scale(.98) 进场 | 200ms | 可选 |
| P2-8 | PDF findbar 瞬现瞬失（`PdfViewer.tsx:197-206`） | 查找条无动画 | 140ms translateY(-4px)+fade | 140ms | 可选 |
| P2-9 | Composer 字数统计瞬现（`composer.tsx:584`） | 出现/消失硬切 | 120ms opacity | 120ms | 可选 |
| P2-10 | queued 状态无等待指示（`Chat.tsx:626`） | 排队期只有秒数文字 | 补 thinking shimmer 的简化版 | — | 可选 |
| P2-11 | 列表行删除无退场（任务/资料/文档/runs 全部） | 行删除瞬间消失、下方行瞬移 | 只对"删除任务"这类低频显性操作补 `useExitingList` 退场；高频列表不做 | 160ms | 谨慎，宁缺毋滥 |
| P2-12 | 流式→落定代码高亮硬切（`message.tsx:159-174`） | 落定瞬间代码块突然上色 | 代码块背景色 200ms 过渡（完整交叉淡入方案复杂，不值得） | 200ms | 可选 |
| P2-13 | 设置覆盖层关闭后重放 route-enter（`workbuddy-refactor.css:652-661`） | 已看过的页面再次完整播入场动画 | is-covered 恢复时抑制一次性动画 | — | 可选 |
| P2-14 | 死样式/死属性清理：`data-detail-open`（DailyBriefPage:146）、`project-section-in`（projects.css:520）、`.ai-sidebar-scrim`（styles.css:1240） | 无消费者 | 删除或接线 | — | 顺手清理 |

---

## 4. 建议实施清单

原则：先修"反馈缺失"与"逻辑性 bug"，再做"连续性"，最后做一致性清理。全部复用现有 token，预计不引入任何新依赖。

**第一批（P0 + bug 性质的 P2，约 1 天）**
1. P0-2 stagger 延迟修复（`Chat.tsx` 一处计算）
2. P0-1 停止按钮 busy + 内容退场
3. P0-3 审批允许成功态
4. P2-2 Select 退出时长对齐、P2-3 SegmentedControl 首帧、P2-6 dropdown origin
5. P0-4 `.ui-status-badge` transition + 三处保存状态统一

**第二批（全局杠杆，约 1 天）**
6. P1-6 EmptyState/ErrorState/Skeleton 容器过渡（一处 CSS）
7. P1-12 行入场补齐（materials/outputs/runs）
8. P0-5 会话列表状态点脉冲
9. P1-8 失败/取消状态过渡、P1-9 发送按钮、P1-10 chips

**第三批（连续性，约 1.5 天）**
10. P1-1 会话切换（容器淡入 + skeleton 占位 + 头部交叉淡入）
11. P1-2 WorkspaceFilePreview 退场、P1-3/P1-4 AiSidebar 三态过渡
12. P1-5 ProjectListDetail 单栏/分栏过渡
13. P1-7 资料状态块交叉淡入、P1-11 ProjectDialog 退场

**第四批（可选清理，随缘）**
14. P2-1 toast 堆叠、P2-4 Tabs 指示器、P2-7 全局搜索形态、P2-5/P2-14 token 与死代码清理

**明确不做：** 虚拟列表逐行动画、路由退场、侧栏折叠宽度动画、PDF 缩放动画、大面积 FLIP 列表重排。

---

## 5. 验收口径

- 所有新动效仅使用 `--dur-*` / `--ease-*` token（reduced-motion 由全局兜底自动覆盖）；
- 微交互 ≤ 200ms，面板/布局 ≤ 240ms，退出统一 160ms；
- 迁移一个场景跑一次对应 surface 测试（现有 AiSidebar / Chat / Projects 测试已覆盖大部分 DOM 断言，动效以 `data-leaving`/`data-entering` 属性断言为宜，不断言具体时长）。
