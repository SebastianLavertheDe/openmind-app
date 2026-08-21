# 响应式/自适应布局审查报告

- 日期：2026-08-15（两轮全量审查）
- 范围：`renderer/src` 全部样式与组件 + `shared/responsive-policy.ts` + 快照脚本
- 基准：窗口最小宽度 720 CSS px（`shared/responsive-policy.ts` `narrowDensity`）；缩放 >100% 时实际 CSS 宽度可低至 ~480/360px
- 状态标记：🔴 高（当前可见溢出/遮挡）· 🟡 中（窄宽度布局挤压）· ⚪ 低/潜在/死代码
- 所有选择器均已对照 TSX 渲染验证存活；死代码单列，不计入线上问题

## 响应式架构现状（已做好的部分）

- JS 层状态机（`app/responsive-layout.tsx`）：shell `expanded/rail/drawer`、companion `docked/compact/overlay/canvas`、workspace `split/single`、density `comfortable/narrow`、actions 三档，断点集中在 `shared/responsive-policy.ts`。
- `styles/responsive.css`：主布局在 1380/1080/920/820/680px 折叠（注意：其中 dashboard/brief 部分覆盖的已是死类，见 #21）。
- projects / runs / skills / sources / automation 主布局：responsive.css + 容器查询（如 `.rule-detail` 用 `@container` 响应面板宽度而非视口）正确折叠。
- GlobalSearch（`min(720px, calc(100vw - 48px))`）、Modal（`min(420px, 92vw)`）、Tooltip（JS 钳制）、AiSidebar（JS 钳制）、ContentSelectionQuote（portal + JS 钳制）、composer 操作行（700/500 容器查询降级为图标）。
- onboarding、AppShell、MarkdownReader、WorkspaceFilePreview、FeedbackHost、OverflowBox、animated-disclosure、VirtualList（宽度）：全量复查无问题。

## 一、高优先级（当前可见的溢出/遮挡）

### 1. AI 控制台「历史会话」浮层 — 固定 320px 且无视口钳制 🔴
- `styles/features/ai-console.css:2525`：`.history-flyout { position: fixed; width: 320px; }`
- `features/ai-console/AiWorkbench.tsx:161`：`toggleHistory` 直接用按钮 `rect.left` 定位，无钳制；按钮在头部右侧，视口 < ~1040px 时浮层右缘被裁。
- 修法参考：同文件 `SessionOverflowMenu`（`AiWorkbench.tsx:543-558`）已有 `Math.min(maxLeft, ...)` 完整钳制。

### 2. 创作页漏斗条被固定导航按钮遮挡（≤840px 抽屉模式）— 死选择器 🔴
- `styles/workbuddy-refactor.css:3299`、`styles/features/creative.css:974`：抽屉补偿规则指向 `.funnel-bar`，但实际渲染类名是 `creative-funnel`（`features/creative/stream.tsx:35`）——规则完全失效。
- 其他页面均有 42-58px 左内边距补偿；720px 窗口下固定定位汉堡按钮直接压住第一个筛选 pill。

### 3. 上下文芯片弹窗 — 固定 280px 且被 overflow 容器裁剪 🔴
- `styles.css:1173`：`.context-chip > .ui-disclosure-content { width: 280px; bottom: 100%; }` 向上弹层。
- 位于 `.context-tray .context-chips`（`styles/features/ai-console.css:2320`，`overflow-x: auto; overflow-y: hidden`）内，弹层被裁剪到托盘高度，任何宽度下都读不全；托盘 < 280px 时还会横向溢出。
- 使用处：`features/ai-console/composer.tsx:692-708`。

## 二、中优先级（约 600-1000px 布局挤压）

### 4. 会话标题 `.conversation-header h2` 永不收缩 🟡
- `styles/workbuddy-refactor.css:1932`：`flex: 0 0 auto` 无省略号；行容器（`:1924`）无 wrap。721-1000px 区间长标题挤压整行；仅 ≤720px（narrow 密度，`:3032-3042`）有保护。

### 5. 文档库页 `.document-library-page` 无单列断点 🟡
- `styles/workbuddy-refactor.css:721`：`grid-template-columns: 272px minmax(0,1fr)`；900px 时仅缩到 220px（`:862`），从不折叠为单列。sources / daily-brief 页在用。
- 同类：`.document-detail-header`（`:797`）操作行 `flex: 0 0 auto` 溢出（< ~640px 详情宽度）。

### 6. 供应商表单 `.settings-grid-2` 直到 620px 才堆叠 🟡
- `styles/features/settings.css:2321`：两列网格，仅在 620px 块（`:2498`）堆叠；620-860px 区间 URL/API Key 输入框仅 ~190-270px 宽。使用处：`settings-sections.tsx:1094、1144`。
- 对比：结构相同但已死的 `.settings-config-grid`（`:772`）反而在 820px 有堆叠规则。

### 7. 供应商卡片头 `.settings-provider-config-header` 操作行挤压标题 🟡
- `styles/features/settings.css:2303-2317`：操作行约 310px 固定内容（2 徽章 + 开关 + 按钮，`settings-sections.tsx:1080-1092`）；620-700px 时标题列被挤到 60-180px，mono 协议名单词不换行溢出。仅 620px 块（`:2492`）有堆叠。

### 8. 选题工作区头 `.topic-workspace > header` 无堆叠断点 🟡
- 基础规则 `styles.css:1704` + 重申 `styles/features/creative.css:767`：flex space-between；操作行（`creative.css:493`）`flex: 0 0 auto` 无 wrap。与 `.creative-document-header`（responsive.css:72 在 920px 堆叠）不一致，此头部所有宽度下保持同行，< ~520px 内容宽度时 26px 标题被压成一条。
- 使用处：`features/creative/panels.tsx:20-22`。

### 9. 版本对比 `.history-compare` 固定两列 🟡
- `styles.css:1718`：`grid-template-columns: 1fr 1fr`，无断点；< ~640px 每列 <300px，Select 值（版本+时间戳）省略到不可读。使用处：`features/creative/history-release.tsx:65-80`。
- 同文件 `analytics-grid`/`analytics-metrics` 已正确用 `auto-fit, minmax(...)`。

### 10. 页头 `.ui-page-header` 721-900px 无换行 🟡
- `styles/components.css:701`：无 `flex-wrap`；components.css 的 6 个 @media 全是 reduced-motion/hover。仅 `workbuddy-refactor.css:2441`（≤720px）与 `responsive.css:104`（≤820px，部分页面）有处理。

### 11. 全屏 AI 侧栏头最小 ~530px 🟡
- `styles/final-polish.css:141`：`.ai-sidebar.mode-full > header` 三列 grid `minmax(180px,1fr) minmax(180px,260px) max-content`；全屏模式 = 视口，< ~530 CSS px（720px 窗口 + ≥1.35x 缩放）即破。

### 12. 行内 AI 结果头按钮被静默裁剪 🟡
- `styles/features/creative.css:902`（header 无 wrap）+ `:920`（`.inline-ai-actions` 无 wrap）+ `:895`（容器 `overflow: hidden`）：< ~340-360px 有效宽度时「重试/替换选中/放弃」右缘被裁。旁边的 `.inline-ai-selection`（`:857`）有 wrap，属漏改。使用处：`features/creative/InlineAiBar.tsx:131-140`。

### 13. 选题文件工作区固定边距 🟡
- `styles/workbuddy-refactor.css:1773`：`.creative-topic-file-content` 固定 42-54px 水平内边距；responsive.css:83 的 clamp 只覆盖 `.creative-editor textarea` / `.creative-preview`，未覆盖此选择器。< ~600px 时内边距占 15-30% 宽度。

### 14. cURL 面板头长路径溢出 🟡
- `styles/features/sources.css:687`：`.x-curl-panel > header` 标题无 `min-width: 0`，`X_CURL_PATH` 文件系统路径 10px mono 不换行，< ~560px 时把「重新读取」按钮挤出面板。

### 15. 审批批量条不换行 🟡
- `styles/features/ai-console.css:797`：`.approval-batch-bar` 无 wrap，容器 `overflow-x: hidden`（`:776`）；< ~360px 时按钮被裁。旁边的单条 `.approval-bar` 已用容器查询适配（`:983/:993`），这条漏了。

### 16. 下拉菜单 `.ui-select-menu` 无视口钳制（第二轮新增）🟡
- `styles/components.css:980-994`：`position: absolute; left: 0; min-width: 100%`，**无 max-width、无翻转/钳制**。触发器靠近视口右缘（settings 表单行、`history-release.tsx:66-73` 版本选择、`ProjectsPage.tsx:219-237` 筛选器）时长选项会把菜单推出右缘。
- 修法：`max-width: min(calc(100vw - 24px), ...)` 或参照 Tooltip/SessionOverflowMenu 的钳制策略。

### 17. 侧栏会话选择菜单 240px 硬底宽（第二轮新增）🟡
- `styles/workbuddy-refactor.css:1815-1836`：`.ai-sidebar .sidebar-session-select .ui-select-menu { right: 0; width: max(100%, 240px); min-width: 240px }` 且选项 `white-space: nowrap`。companion 为 compact/overlay 窄形态时菜单溢出侧栏边缘。

## 三、低优先级 / 潜在陷阱 / 死代码

### 18. LogViewer 头部不换行（第二轮新增）⚪
- `styles/components.css:546-562`：`.ui-log-viewer > header` 无 `flex-wrap`，内部 label/status 无 `min-width: 0`，容器 `overflow: hidden`。当前用法（`AutomationPage.tsx:185`）内容短，未实际破；新调用方传长内容即被裁。

### 19. 次要按钮/元信息行无 wrap（第二轮新增）⚪
- `.error-event footer`（`styles.css:628`，3 按钮，`features/ai-console/events.tsx:169-177`）
- `.version-row`（`styles.css:1727`，strong/small 无省略号，`history-release.tsx:86`、`panels.tsx:220`）
- `.review-actions`（`styles.css:1688`）、`.publish-actions`（`styles.css:1701`，`panels.tsx:75/125`、`CreativeDetailPane.tsx:260`）
- 均 ~480px 时勉强放下，无余量；文案变长即裁剪。

### 20. 未启用的固定布局原语 ⚪
- `.ui-data-row`（`styles/components.css:221`）：`min-width: 720px` 等于窗口最小宽度，加侧栏+边距后表格永远横向滚动。`DataTable`（`design-system/controls.tsx:139`）目前仅测试使用，启用即触发。
- `.ui-master-detail`/`.with-inspector`（`components.css:165`）三栏合计最小 500px 无折叠；`MasterDetailLayout`（`design-system/layout.tsx:35`）同样未使用。
- ResponsiveActionBar 溢出菜单右锚定向左展开（`components.css:290-307`）：当前 4 处用法都在右对齐头部，安全；若放到距左缘 <180px 处会向左裁掉（结构性注意）。

### 21. 死代码清单（大，建议单独清理 PR）⚪
**`styles.css`（约 700+ 行死代码，含危险固定布局）**：
- 固定布局类：`.settings-section`（`:280`，1fr+380px）、`.tool-event-controls`（`:579`）、`.new-session-controls`（`:1158`，130px 列）、`.source-workspace`（`:1516`，360px 侧栏）、`.reader-document-layout` + `.article-toc`（`:1264-1270`，190px 目录轨）、`.action-grid`（`:224`）、`.brief-metrics`/`.brief-grid`/`.span-*`（`:1532-1536`）、`.session-detail dl`（`:334`）、`.approval-card dl/footer`（`:614/:621`）、`.tool-insight`（`:588`）、`.watch-picker`/`.contribution-list`/`.brief-topic-main`（`:1563-1566/:1542`）、`.run-activity`/`.run-boundary`（`:525-548/:454`）、`.execution-trace`/`.trace-*`（`:459-513、:1326`，`.trace-step` 存活但标记被 `ai-console.css:384` 隐藏）、`.change-*`/`.diff-view`/`.diff-toolbar`/`.hunk-actions`（`:1226-1262`）、`.reasoning-peek`（`:1991-2036`，复活即 <520px 溢出）、`.inbox-*`/`.rss-inline-*`/`.content-insights`（`:1456-1511`）、`.creative-filters`/`.creative-sort`/`.creative-view-tabs`（`:1596-1621`）、`.session-advanced-filters`（`:303`）、`.provider-list`/`.provider-settings`（`:1271-1277`）。
- 旧壳/旧会话/旧检查器/旧 composer 系列：`.brand`/`.nav`/`.app`（`:187-210、:1358`）、`.session-pane` 家族（`:293-339、:2340`，且 `ai-console.css:196/1409`、`final-polish.css:133/202` 有跨文件死引用）、`.inspector-*`（`:1194-1220`）、`.composer-footer`/`.composer-actions`（`:1161`）、`.tool-payload`（`:586`）、`.terminal-lights`（`:900`）等。

**`styles/features/dashboard-brief.css`（~95% 死代码）**：dashboard 页面已不存在，`.dashboard-metrics(-3)`、`.brief-metrics(-4)`、`.dashboard-grid`、`.brief-grid`、`.mini-trend`、`.quick-actions`、`.stage-summary`、`.topic-list` 等全部无 TSX 引用（仅 opendesign 静态稿和 motion-contract-check.js 引用）；文件内 3 个 @media（`:485/:698/:712`）全部只覆盖死类。存活仅 `.workspace-card`（被多页共用）与被 sources.css 完全覆盖的 `.source-metrics`。连带：`browser-api.ts:292` 的 `getDashboard` 无 UI 调用。**第一轮标记的 `repeat(5)`/`repeat(4)`/`repeat(7)` 固定网格均在死代码内，非线上问题。**

**`styles/features/inbox.css`**：~98% 死（仅 `.search-field`、`.reader-body` 经共享组件存活）。

**`styles/features/daily-brief.css`**：约 100 行死（`.brief-topic-main` 等，`:20-122`）。

**`styles/features/creative.css`**：`.inline-review-panel`（含 `:587、:643` 固定两列网格）、`.publish-checklist`、`.notes-panel*`、`.creative-list-pane > header`（`:59、:983`）无引用；`.creative-editor textarea`（`:541、:1096`）已被 CodeMirror 取代，responsive.css:83 的钳制一半失效。

**`styles/features/settings.css`**：`.settings-config-grid`（`:772`）、`.settings-skill-context-grid`（`:1082`）无引用，但 820px 块里有它们的堆叠规则（误导维护者，而存活的 `.settings-grid-2` 反而没覆盖）。

**`styles/features/automation.css`**：`.automation-catalog`、`.automation-groups`、`.automation-list`、`.automation-params-*`、`.automation-console` 无引用。

**`styles/features/ai-console.css`**：`:1404-1424` 的 1180px 媒体查询是 no-op——被 `:1502` 同特异度 `!important` 覆盖，且 `.session-pane` 标记已不存在；`:1-247` 的 session-pane 系列均为死代码。

**`styles/responsive.css` 部分规则已死**：`:2-55` 中针对 `.dashboard-grid`、`.brief-grid`、`.dashboard-metrics`、`.quick-actions`、`.source-metrics`/`.brief-metrics` 的覆盖指向死类或被 sources.css 取代（`.projects-layout`、`.automation-*`、creative/feature-page 部分仍有效）。

**附带功能 bug**：`.creative-main-pane .document-tabs { display:none }`（`creative.css:1023`）把 `HistoryView` 头部内的文件切换 nav 也藏掉了（`history-release.tsx:61`）。

## 四、测试覆盖缺口（第二轮新增）

- `scripts/visual-snapshot-electron.js:11-21`：视口矩阵为 720/840/900/1020/1280/1366/1920/2560 @1x + 1366@1.25/1.5x。**最窄 CSS 宽度只有 720px@1x；没有 720px+1.5x 缩放组合（≈480px）**，而缩放正是触达 <720px 有效宽度的唯一路径（窗口最小 720px）。建议补 `720x720@1.5x` 与 `720x720@2x` 两档。

## 五、修复顺序建议

1. 高优先级三件：#1 浮层加钳制（照搬 SessionOverflowMenu）→ #2 改正 `creative-funnel` 死选择器 → #3 context-chip 弹层 portal 化或去固定宽。
2. 影响面最大的两处：#5 `document-library-page` 加单列断点、#6 `settings-grid-2` 提前到 820px 堆叠。
3. #16 `.ui-select-menu` 加 max-width/钳制（一处修复覆盖多页面）。
4. 其余中优先级按页面顺手修；#21 死代码建议单独清理 PR；#18-#20 随新用法落地时处理。

## 六、文件级覆盖表（两轮审查合计，每文件结论）

### 干净 / 与布局无关

| 文件 | 说明 |
|---|---|
| `app/AppShell.tsx` | 仅 `--nav-width` 变量，shell.css @820 有 64px rail 兜底 |
| `app/GlobalSearch.tsx` | `min(720px, calc(100vw - 48px))` |
| `app/SidebarRecent.tsx` | 行网格 `minmax(0,1fr)` + 省略号 |
| `app/responsive-layout.tsx` / `shared/responsive-policy.ts` | 响应式系统本体 |
| `app/route-registry.tsx` / `routes.ts` / `App.tsx` / `main.tsx` / `theme.ts` / `ai-context.tsx` / `ai-utils.ts` / `browser-api.ts` / `openmind-root-selection.ts` | 路由/逻辑，无自有布局 |
| `components/AiSidebar.tsx` | JS 钳制 `maximumRenderedWidth` |
| `components/ColumnSplitter.tsx` | 3px 分隔条，配合 compact 状态隐藏 |
| `components/ContentPreview.tsx` | 三分支均无固定宽（全量复查） |
| `components/ContentSelectionQuote.tsx` | portal + JS 钳制（zoom 感知） |
| `components/FeedbackHost.tsx` | toast `max-width: 360px`、modal `min(420px, 92vw)` |
| `components/MarkdownReader.tsx` | 表格滚动容器 + pre overflow |
| `components/WorkspaceFilePreview.tsx` | ResponsiveActionBar + ≤1280/≤720 降级链 |
| `components/useListDetailLayout.ts` | 160-280px 弹性列 |
| `design-system/OverflowBox.tsx` / `Tooltip.tsx` / `animated-disclosure.tsx` / `ResponsiveActionBar.tsx` | 干净（见 #20 结构性注意） |
| `design-system/VirtualList.tsx` | 宽度全流式；注：行高固定，超高内容会重叠相邻行（高度问题） |
| `features/onboarding/*`（TSX + css） | 760/980 断点齐全，路径 `overflow-wrap: anywhere` |
| `features/projects/*` | 网格全部 auto-fit |
| `features/runs/*` | 820px 折叠齐全 |
| `features/skills/*` | 1360/1100/620 断点齐全 |
| `features/daily-brief/*`（存活部分） | 容器查询 58/54/34rem 重排 |
| `styles/product.css` | 仅 @import |
| `styles/shell.css` | nav @820 折叠为 64px rail，topbar 8px 间距降级 |
| `styles/features/projects.css` / `runs.css` / `skills.css` / `onboarding.css` | 见上 |

### 存在问题

| 文件 | 问题编号 |
|---|---|
| `styles.css` | #3、#8（基础规则）、#9、#19 + 大量死代码（#21） |
| `styles/components.css` | #10、#16、#18、#20 |
| `styles/features/ai-console.css` | #1、#15、#21（no-op 媒体查询 + 死代码） |
| `styles/features/creative.css` | #2（死选择器）、#8、#12、#13、#21 |
| `styles/features/settings.css` | #6、#7、#21 |
| `styles/features/sources.css` | #14（主布局断点链完整） |
| `styles/final-polish.css` | #11 |
| `styles/workbuddy-refactor.css` | #4、#5、#13、#17、#2（死选择器）；其余覆盖良好 |
| `styles/features/dashboard-brief.css` | #21（~95% 死代码） |
| `styles/features/inbox.css` | #21（~98% 死代码） |
| `styles/features/daily-brief.css` | #21（~100 行死代码） |
| `styles/features/automation.css` | #21（死块；主布局良好） |
| `styles/responsive.css` | #21（部分覆盖指向死类） |
| `features/ai-console/AiWorkbench.tsx` | #1（定位无钳制） |
| `features/ai-console/composer.tsx` / `events.tsx` | #3 / #19 |
| `features/creative/stream.tsx` | #2（类名与 CSS 不匹配） |
| `features/creative/panels.tsx` / `history-release.tsx` / `InlineAiBar.tsx` / `CreativeDetailPane.tsx` | #8、#9、#19 / #9、#19 / #12 / #19 |
| `features/settings/settings-sections.tsx` | #6、#7 |
| `features/sources/SourcesPage.tsx` | #14 |
| `design-system/Select.tsx` | #16、#17 |
| `design-system/LogViewer.tsx` | #18 |
| `design-system/controls.tsx` / `layout.tsx` | #20（未启用的固定布局原语） |
| `scripts/visual-snapshot-electron.js` | #IV 测试缺口（无 <720px 有效宽度档） |

### 审查方法备注

- 级联顺序（load-bearing）：`main.tsx` 先载 `styles.css`，再经 `product.css` 依序 import shell → components → features/* → responsive → final-polish → workbuddy-refactor；后文件同特异度胜出。所有「已覆盖」结论均核对了该顺序。
- 每个可疑选择器都 grep 了 TSX 实际渲染（含模板字符串拼接类名与运行时生成类名如 `toast-${tone}`、`mode-${panelMode}`、`hljs-*`）。
