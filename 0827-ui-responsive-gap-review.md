# UI 自适应布局缺口审查报告

- 日期：2026-08-27（增量审查）
- 原始报告作者：**Claude Code**（本文第一至第五节）
- 交叉审核作者：**Codex（OpenAI）**（本文第六节）
- 范围：`renderer/src` 全部特性页面、设计系统组件、样式文件；`shared/responsive-policy.ts`；`styles/responsive.css`
- 方法：断点体系对照 + 全量 CSS/TSX 固定尺寸扫描 + 弹窗/弹出层约束专项核查；所有选择器均已对照 TSX 渲染验证存活
- 基准：窗口最小宽度 **720 × 600** CSS px（`shared/responsive-policy.ts` → `DESKTOP_WINDOW_MIN_SIZE` = `narrowDensity: 720`）；断点体系：companionCompact 1760 / workspaceSingle 1480 / shellDrawer 840 / narrowDensity 720
- 全局放大器：`styles.css` 中 `.main-area { overflow: hidden }` 且 `body { overflow: hidden }` —— 溢出内容会被**静默裁切**而不是产生滚动条，因此下述溢出类问题的实际严重度高于一般 web 场景
- 严重程度：🔴 P1（最小窗口下功能真实受损）· 🟡 P2（特定窄窗场景明显破相）· ⚪ P3（轻微/整理项）

---

## 总体结论

响应式**骨架本身是健全的**，剩余缺口集中在四类模式：

1. **弹出层不做视口钳制/翻转**（flyout 固定坐标、select 菜单永不翻转）；
2. **弹窗只有宽度约束没有高度约束**（confirm 弹窗、cURL 编辑层）；
3. **部分兜底断点写在实际不可达的位置**（settings/skills 大量规则放在 ≤620/≤520，而窗口最小就是 720，中间带宽区间无降级）；
4. 少量 **hover-only 交互**与**失效的死规则**。

无 P0（完全不可用），有 **5 个 P1**。

---

## 响应式架构现状（已覆盖良好、无需处理）

| 能力 | 实现位置 | 结论 |
|---|---|---|
| Shell 导航三态 expanded/rail/drawer | `app/responsive-layout.tsx` JS 状态机 | ✅ |
| Companion 四态 docked/compact/overlay/canvas | 同上 | ✅ |
| Composer 操作行容器查询降级为图标 | `workbuddy-refactor.css:2761/2785`（@container chat-composer 700px/500px） | ✅ |
| Creative 主工作区 ≤1480 单栏互斥切换 | `CreativePage.tsx` 用 `workspace === "single"` 驱动 compact class | ✅ |
| approval-bar 五列 grid 容器查询三档降列 | `ai-console.css:983-1001` | ✅ |
| rule-detail 容器查询三档 | `automation.css:996-1064` | ✅ |
| GlobalSearch 弹窗尺寸约束 | `shell.css:207-275`：`width:min(720px, calc(100vw-48px))` + results 内滚 | ✅ |
| Tooltip 视口边缘翻转 + 钳制 + focus 即显 | `design-system/Tooltip.tsx:84-128` | ✅ |
| analytics 条形图（auto-fit 网格 + 百分比条宽） | 窄容器按比例缩短不失真 | ✅ |
| tool 输出/approval detail 日志区 | OverflowBox + 各自限高滚动 | ✅ |
| hover 可达性兜底（compact-actions / message-actions） | 均有 `:focus-within` 规则 | ✅ |

> 对照说明：`responsive-audit.md`（2026-08-15）中部分历史高优项已在近期提交中修复（如 AiSidebar JS 钳制、ContentSelectionQuote portal），本报告为当前 HEAD 的最新状态。

---

## 一、P1 🔴 最小窗口下功能真实受损

### 1. 全局确认弹窗没有高度约束，长内容把按钮顶出视口

- 位置：`styles.css:1426` `.modal-card`（组件渲染于 `components/FeedbackHost.tsx:87-112`）
- 问题：只有 `width: min(420px, 92vw)`，无 `max-height`、无内部滚动；`.modal-scrim` 是不可滚动的 grid 居中容器。body 为 `white-space: pre-wrap` 的任意文本——如 Onboarding 绑仓前的文件清单（`features/onboarding/OnboardingPage.tsx:62`）、Creative 删除确认等。
- 影响：600px 高窗口下长确认文本会把「取消/确认」按钮推出视口且无法滚动到，危险操作确认流程不可完成。这是影响面最大的单项。
- 修法参照：Provider 大弹窗的 `.settings-provider-dialog-scrim`（`settings.css:2539-2549`，scrim overflow-y:auto + body 内滚）已是正确范式。

### 2. Creative 详情区 ready/published 阶段整列不可滚动，编辑器被压没

- 位置：`styles/workbuddy-refactor.css:1495-1503`（`.creative-detail-transition { overflow: hidden }`）+ `features/creative/CreativeDetailPane.tsx:241-291` + `styles/features/creative.css:1045-1050`
- 问题：头部（min-height 112px）、document-tabs、发布表单（PublishForm 约 480–560px 高）、编辑器、writing-stats 全堆在同一个不滚动的 flex 列里，`.creative-editor` 是唯一弹性项。
- 影响：「进入待发布」是主流程操作，窗口一矮编辑器被压至接近 0 高，正文既看不见也无法编辑，页面不能滚。最小窗口下必然复现。

### 3. InlineAiBar 流式预览头按钮组溢出被裁

- 位置：`features/creative/InlineAiBar.tsx:130-145` + `styles/features/creative.css:895-908`
- 问题：`.inline-ai-preview > header` 无 flex-wrap，eyebrow + `margin-left:auto` 的按钮行（取消/重试/替换选中段/放弃，合计约 330–400px）不收缩；父级 `overflow: hidden`。
- 影响：最小窗宽下编辑列约 350px 时，「替换选中段/放弃」被剪掉甚至完全不可见（Tab 键仍可达）。

### 4. Settings 浏览器 Token 行存在 821–941px「死区」，内容静默裁切

- 位置：`styles/features/settings.css:1759-1766`（`.settings-browser-token { grid-template-columns: minmax(220px,1fr) minmax(300px,auto) }`，双列下限合计 **220+16+300=536px**）；单列化兜底却在 `settings.css:1908`（≤820 才生效）
- 计算：Settings 页全窗渲染（settings-mode 隐藏导航顶栏之外仍有侧栏），avail(vw) = vw − 导航列宽 − 12 − 2×clamp(28px,5vw,72px) − 40。窗口 821–941px 时可用宽度仅 ~435–536px < 536px 下限。
- 影响：祖先链（`.settings-card`、`.main-area`）全是 `overflow:hidden`，**Token 密码框和「保存/清除 Token」按钮被裁掉且没有任何滚动提示**——本报告中唯一「设置功能够不着」级别的问题。

### 5. AI 会话历史 flyout 用固定坐标不钳制视口

- 位置：`features/ai-console/AiWorkbench.tsx:161-172、327-338` + `styles/features/ai-console.css:2525-2539`
- 问题：直接取按钮几何值定位 `.history-flyout { position: fixed; width: 320px }`，无视口翻转/钳制逻辑（对比 Tooltip 已有完整实现）。会话头部按钮靠右时，720px 窗宽下 flyout 右半截落在视口外。
- 影响：受 `body{overflow:hidden}` 放大，出界即裁，**历史会话列表点不到**。

---

## 二、P2 🟡 特定窄窗场景明显破相

### A. 弹出层类

| # | 位置 | 问题 |
|---|---|---|
| 6 | `design-system/Select.tsx:210-237` + `components.css:859-873` | `ui-select-menu` 永远向下展开、不检测剩余空间、无 portal；在 `overflow:auto/hidden` 祖先内贴近容器底部即被裁。creative 版本对比 Select（位于 diff 区下方）是重灾区。菜单可随长文案向右撑出触发器右缘 |
| 7 | `features/creative/MarkdownEditor.tsx:253-278` + `creative.css:1167-1180` | slash 菜单钉死编辑器 shell 左上角而非跟随光标，长文中输入 `/` 时菜单离输入行很远；定位用 vw 近似与正文缩进最多差 4px；编辑列过矮（≥InlineAiBar 同时出现）时菜单底部命令项被 `.creative-editor{overflow:hidden}` 裁掉 |
| 8 | `skills.css:607-633` | cURL 编辑弹层 scrim 无 `overflow-y:auto`、editor 无 `max-height`；textarea `resize:vertical; min-height:240px` 允许用户拉高超窗后，底部「覆盖保存」按钮永久消失。RSS 编辑器同理但更矮、风险低 |

### B. 布局降级缺失类

| # | 位置 | 问题 |
|---|---|---|
| 9 | `workbuddy-refactor.css:730-735、876` + `daily-brief.css:46-99` | daily-brief 双栏只会「压扁」（container query 58/54/34rem）不会降级：列表列最窄 clamp 到 ~160px 后常驻，没有像 creative 那样的列表/详情互斥单栏态；detail 编辑列可被挤到 ~360–420px。结构性缺口 |
| 10 | `styles.css:1597、1606-1609` + `history-release.tsx:65-91` | `.history-compare` 恒等宽两列无堆叠降级；`.version-row` 不换行，「打开/恢复为新版本」两个文字按钮在窄容器被压/裁 |
| 11 | `ai-console.css:352`、`styles.css:1703`、`workbuddy-refactor.css:1149` | chat 正文段落、行内 code、用户气泡缺 `overflow-wrap:anywhere/break-word`（同类 patch-line/approval-detail/toast 都有处理），超长 URL/路径/base64 撑出横向滚动或画出气泡边界 |
| 12 | `automation.css:2-7、374-381` | `.automation-layout{min-height:660px}`、rules 680px 高于 600 最小窗高，必然形成整页 + pane 双滚动面（可用性尚可，体验降级） |
| 13 | `workbuddy-refactor.css:1242-1250` | reader Markdown 表格 `min-width:640px`——已有 `.markdown-table-scroll` 内部横滚兜底（设计内降级），但 720px 窗内读宽表只能拖横条；候选改进：降低 min-width 或 sticky 首列 |

### C. 系统性问题：兜底断点低于窗口最小宽度

多个 settings/skills 兜底写在 **≤620/≤520**，而窗口最小 **720**，正常使用永不触发；导致 720–1000px 中间带宽区间处于无降级状态：

- Provider 配置卡操作区绝对定位 + 写死 `padding-right:142px`（`settings.css:2353-2367、2429-2437`），恢复静态布局的规则在 `settings.css:2704-2711`（≤620）→ 720–820 段 ToggleSwitch 与菜单钮拥挤；
- Provider 弹窗表单 `.settings-grid-2`/三列 advanced grid 到 ≤620 才降级（`settings.css:2489-2493、2532-2537、2713-2714`），窄窗每个输入只剩 ~200–290px（不溢出但明显破相）；
- preference-row 控制列 auto 可取走 360px 路径输入（`settings.css:346-353、1740-1751、1828-1832`），850–1000 段左侧描述文案被挤扁；
- skills 内嵌模式导入按钮绝对定位悬浮，761–1100 段遮挡页头（`skills.css:21-26`，≤760 才回归流式）；来源分组更新按钮组悬浮盖住触发器 count/chevron 区（`skills.css:162、187-195`）。

### D. 失效的死规则（掩盖真实缩窄行为）

- `ai-console.css:1404-1414`（≤1180 收 session rail）、`1426-1434`（≤780 单列）两段对 `.ai-workbench` 的 @media 收缩规则，被同特异性的无条件 `grid-template-columns … !important`（`ai-console.css:1502-1505`）按源顺序永久压制，**从不生效**。目前 981–1180 区间的真实行为只受 AiWorkbench.tsx:225 的预览列 `minmax(360px,…)` 硬下限影响。属维护陷阱，需与功能问题一并处理。
- 配套问题：composer 操作行 nowrap（`workbuddy-refactor.css:2526-2544`），容器 <340px 时 counter/workspace 固定项与发送键碰撞，现有 700/500 两档容器查询外还差一小档。

### E. 交互模式类

| # | 位置 | 问题 |
|---|---|---|
| 14 | `workbuddy-refactor.css:486-503、315-318` | 导航「最近会话」重命名/删除按钮默认 `opacity:0; pointer-events:none`，hover/focus 才显形——键盘 focus 兜底存在但仍是典型 hover-only 盲操作模式 |
| 15 | `ai-console.css:2320-2336` + `styles.css:1171-1184` | context chips 附件条隐藏横向滚动条又去掉渐变遮罩（超出只能盲滚，无「还有更多」提示）；chip 悬浮详情 `width:280px` 锚定 chip 左缘，靠右 chip 在 sidebar（overflow-x:hidden）内被裁 |

---

## 三、P3 ⚪ 低优先级 / 整理项

| # | 位置 | 问题 |
|---|---|---|
| 16 | 断点双轨制残留 | creative splitter 隐藏逻辑三种定义并存：JS ≤1480（compact class）/ media 1380 带 ！important（`workbuddy-refactor.css:2297-2301`）/ media 920（`responsive.css:18-21`），靠 specificity 侥幸成立；`responsive.css` 多数内容已被 feature 私有查询取代。另 onboarding 自建 800/700 断点未接 shared 令牌，720×600 最小窗恰落两条规则的空隙（`onboarding.css:310-339`） |
| 17 | lightbox 翻页钮 | `ai-console.css:2223-2224` 绝对定位 prev/next 在窄窗叠在图片上（键盘方向键可换张，仅视觉问题） |
| 18 | toast-stack | `styles.css:1402` fixed 右下角 max-width:360 无 max-height，大量 toast 同时在场会堆到顶（自动消失机制兜底） |
| 19 | runs 详情头 | `RunsPage.tsx:168-176` 首个 div 缺 `min-width:0`，无空格 UUID 极端情况下挤压操作区（父轨道 minmax(0,1fr)，不会撑破布局） |
| 20 | ai-sidebar 头部 | 380px 最小宽度下标题格 `minmax(120px,190px)+auto` 图标组后剩 ~60px，ellipsis 兜底不溢出，局促但不破相 |
| 21 | history-release 分析图标签列 | `84px` 定值无 ellipsis，自定义平台长名会换行顶开行高 |

---

## 四、死代码选择器清单（验证 tsx 零引用，随清理删除）

以下均为 grep 全仓验证无组件引用的死样式（其中不少携带已失效的旧响应式兜底）：

- `styles.css:1232-1258`：双栏 diff 旧实现整套（`.diff-toolbar/.diff-view/.diff-line/.split-header{min-width:800px}/.split-row{min-width:800px; minmax(340px,1fr)×2}/.hunk-actions`）——现行 diff 已是 PatchView→patch-table。若将来复用其 800px 硬下限会在 720 窗直接溢出，建议删除防复发
- `settings.css`：`.settings-config-*`（748-861）、`.settings-runtime-card/-main/-meta/-actions/-download-*`（432-567）、`.settings-skill-context-grid`（1089-1162 及 @720 兜底 1914）、`.settings-skill-packages*`（1213-1384）、`.settings-workflow-desc`（1691）、`.settings-provider-manual-steps`（2729-2731）、`.settings-shared-runtime-*` 大部分（13-47，shield/progress/error 仍在用，勿全删）
- `creative.css:974-977` `.funnel-bar` 与 `workbuddy-refactor.css:3167` 引用同类不存在（实际 markup 是 `.creative-funnel`，`stream.tsx:35`——drawer 让位 padding 因此从未生效）；`.creative-warn`（TopicFileWorkspace.tsx:20 使用中）全仓库无 CSS 定义
- settings.css 中部分 `@media ≤620/≤520` 兜底块因挂在上述死类上而整体失效

---

## 五、建议修复顺序

1. **先修功能够不着的两项**：#1 confirm 弹窗加 max-height+内部滚动、#4 Settings Token 行消除 821–941 死区（双列阈值提前或改用容器查询）；
2. **统一做一轮弹出层基建**：popup/flyout 视口翻转+钳制（以 `Tooltip.tsx` 现成方案为准绳，portal 化），一次解决 #5、#6、#7 定位三个问题；
3. **Creative 高度流**：#2 详情列改可滚、#3 InlineAiBar 头部允许 wrap，顺带 #10 version-row；
4. **窄带降级**：按第五节 C 组系统性梳理 settings/skills 的 620/520 兜底上移（或容器查询化），同时决定 daily-brief 是否补单栏互斥态（#9）；
5. **清理批次**：删除第四节死代码、解决 ai-console.css 的 ！important 死规则（D 组）、收敛 responsive.css 与 feature 私有断点的双轨制（#16）、hover-only 改常显或 focus 提示（#14）。

---

## 六、Codex（OpenAI）交叉审核

- 审核日期：2026-08-27
- 审核者：**Codex（OpenAI）**
- 审核对象：Claude Code 编写的本文第一至第五节
- 审核方式：当前 HEAD 静态调用链/CSS 层叠核对，并通过项目现有 Electron visual preload 对关键尺寸进行运行态几何测量
- 修改边界：本节仅审核和修订结论，不修改应用源码

### 6.1 总结结论

Claude Code 的报告包含多项有效发现，但**不能原样作为最终问题清单**：

- 原报告 5 个 P1 中，只有 #4 可以基本原样保留；
- #2、#5 的问题方向正确，但影响状态或复现区间写错；
- #1 是结构性健壮性风险，但当前调用方不足以支持 P1 严重度；
- #3 基于错误的按钮组合和错误的窄列假设，当前 P1 结论不成立；
- 原报告把 Automation 列为 P2，但运行态表明它会真实裁掉规则列表和日志控制台，应升级为 P1；
- Daily Brief 常驻双栏、Markdown 表格横向滚动、Lightbox 按钮覆盖图片等属于当前设计选择，不应直接列为响应式缺陷；
- 已确认的产品约束继续有效：进入每日简报时 AI 必须打开，窄屏单画布优先显示 AI；该动态切换行为不属于问题。

修正后，本轮确认的 P1 为 4 项：

1. Settings Browser Token 在中间宽度下溢出；
2. Creative `ready` 阶段在低高度下编辑器被压至 0；
3. AI 历史浮层在约 841–1019px 的 rail 状态下越出右边界；
4. Automation 在 720×600 下规则列表和日志控制台被固定高度容器裁切。

### 6.2 原报告 P1 逐项复核

| 原编号 | Codex 结论 | 复核说明 | 修正严重度 |
|---|---|---|---|
| #1 Confirm 弹窗 | **部分正确** | `.modal-card` 确实没有 `max-height` 和内部滚动，结构上存在长内容风险。但当前实际调用大多是短文案；报告所举的 Onboarding“文件清单”不准确，`openmindRootPreviewBody()` 只生成 4–5 行摘要，且不可绑定时不会进入确认弹窗。缺少当前业务流程下按钮被推出视口的运行态证据。 | P2 健壮性风险 |
| #2 Creative ready/published | **部分正确，ready 已确认** | 720×600 下，`ready` 项目的 `.publish-form` 实测约 615px 高，`.creative-editor` 高度为 0，外层 `.creative-detail-transition` 又是 `overflow:hidden`，正文确实不可编辑。`published` 只渲染较矮的 PublishedSummary，原报告没有证明它也会归零，因此不应把两个阶段合并下结论。 | `ready` 为 P1；`published` 待验证 |
| #3 InlineAiBar | **P1 不成立** | 按钮不是“取消/重试/替换/放弃”同时出现：busy 状态只有“取消”，成功状态是“重试/替换选中/放弃”。同时 Creative 在 ≤1480px 已通过 `compact-detail-open` 切成全宽单表面，不存在报告假设的最小窗口下约 350px 编辑列。可保留允许 wrap 的防御性建议，但不能作为当前 P1。 | 删除 P1；最多 P3 防御性改进 |
| #4 Settings Token | **正确** | 运行态复现：720px 已单列且正常；840px Token 卡片横向溢出约 84px；900px 仍溢出约 30px；1020px 恢复正常。双列下限与 ≤820px 单列断点造成非单调退化，输入及操作按钮可能不可达。 | P1 |
| #5 AI 历史浮层 | **问题成立，复现区间错误** | 固定取按钮 `left/top`、固定 320px 宽且不钳制/翻转/监听 resize 的判断正确。但 720/840px drawer 状态下 `.history-toggle` 被隐藏，并不会按报告描述从 720px 右侧展开。真正可复现区间约为 841–1019px：900px 下浮层向右越界约 255px，几乎不可操作。 | P1，修正区间为约 841–1019px |

### 6.3 原报告 P2/P3 复核

#### 可以保留的问题或风险

| 原编号/分组 | 结论 | 说明 |
|---|---|---|
| #6 Select | 保留为 P2 风险 | 当前菜单渲染在组件本地、固定向下展开，没有 portal、视口翻转或边界钳制。在 `overflow:hidden/auto` 祖先内存在裁切风险；但报告没有运行态证明 Creative 版本选择器已经成为“重灾区”。 |
| #7 Slash 菜单 | 部分保留 | 菜单固定在编辑器左上角、不跟随光标是代码事实；是否必须跟随光标属于产品交互定义。低高度时被裁仍需组合态复现，暂不作为已发生故障。 |
| #8 cURL 编辑弹层 | 保留为 P2 风险 | textarea 可纵向 resize，scrim/editor 没有高度约束；用户手动拉高后，底部按钮可能离开视口。 |
| #11 长字符串换行 | 保留为 P2 | chat Markdown、行内 code 和用户消息缺少统一的长单词/URL 断行处理，超长无空格文本可能突破气泡边界。 |
| #14 Hover-only | 降为交互/触屏可发现性问题 | 键盘 `focus-visible` 兜底存在；触屏仍缺少显式展示方式。实际按钮是“置顶/取消置顶、归档”，不是报告所写的“重命名/删除”。 |
| #15 Context chips | 保留为 P2 风险 | 隐藏横向滚动条会降低“还有更多附件”的可发现性；固定 280px 的本地悬浮详情也缺少视口碰撞处理。 |
| #18 Toast stack | 保留为 P3 | 没有最大高度属实，但 toast 默认约 2.8 秒自动消失，属于低概率堆叠风险。 |
| 死代码清单 | 大部分可保留为清理项 | 旧 diff/settings/funnel 选择器多为无生产 TSX 引用样式；`.creative-warn` 则相反，是有 TSX 引用但缺 CSS 定义。清理前仍应逐个选择器复核，不能把该清单当成功能问题。 |

#### 需要删除、降级或改写的结论

| 原编号/分组 | Codex 结论 | 说明 |
|---|---|---|
| #9 Daily Brief | 从缺陷清单删除 | 当前容器查询和视觉回归测试明确要求文件列表始终位于正文旁边；这是现有 master/detail 设计契约，不是遗漏的响应式状态。窄屏 AI 优先显示同样是已确认的产品行为。 |
| #10 History compare | 降为 P3/待夹具验证 | 恒定双列和 version-row 不换行属实，但当前单表面详情宽度通常足够，且现有版本 note 主要为受控短文案；没有证明按钮已经被裁。 |
| #12 Automation | **由 P2 升为 P1** | 720×600 运行态下 `.automation-rules-layout` 仍为 680px 高、内部 `scrollHeight` 约 1066px且 `overflow:hidden`；规则列表高度为 0，日志控制台完全位于布局裁切边界之外。外页滚动到底也无法看到被容器裁掉的控制台，并非只是“双滚动体验降级”。 |
| #13 Markdown 表格 | 从缺陷清单删除 | `min-width:640px` 外已有 `.markdown-table-scroll { overflow-x:auto }`，属于明确的窄屏降级方案。是否使用 sticky 首列是体验增强，不是布局失效。 |
| C：≤620/≤520 永远不可达 | 改写 | zoom=1、原生最小窗宽下确实不会触发，但浏览器 zoom/显示缩放可让 CSS 视口进入这些断点，因此“永远不可达”不准确。真正问题是这些规则无法保护 zoom=1 下 840–1000px 的中间宽度。报告声称 Skills 导入按钮在 761–1100px 遮挡页头，运行态未复现；Provider/preference 等应按具体状态逐项验证，不能整体判故障。 |
| D：AI 旧媒体规则 | 仅保留为维护债务 | `ai-console.css:1404/1426` 的 `.ai-workbench` 规则确实被后面的同特异性 `!important` 覆盖。但旧 `.session-pane` 已不在当前 AiWorkbench 组件树中，现有文件预览在 ≤980px 另有生效的单表面规则，因此不能据此推导当前 AI 页面功能失效。 |
| #16 Onboarding 空隙 | 结论错误 | 720×600 明确命中 `@media (max-width:800px)`，并没有落入两组规则空隙。Creative 多轨断点可作为技术债务整理，但当前 React compact class 是有意覆盖，不是“靠 specificity 侥幸成立”。 |
| #17 Lightbox | 从缺陷清单删除 | 翻页按钮覆盖在图片边缘是常见 lightbox 交互，并有键盘/滑动支持；没有证据表明关键内容或操作不可达。 |
| #19 Runs | 不计入当前可见 UI | `runs` 仅在 route registry 注册，全仓没有生产导航调用方；当前用户无法进入该页面。 |
| #20 AI sidebar 头部 | 从问题清单删除 | 原报告自己已确认有 ellipsis 且不溢出，“局促但不破相”不是响应式故障。 |
| #21 Analytics 标签 | 保留为低风险候选 | 标签轨道固定 84px 且未 ellipsis 属实；内置平台名较短，但导入或历史数据仍可能带任意字符串，需长名称夹具才能定级。 |

### 6.4 修正后的处理顺序

1. **P1 功能可达性**：Settings Token、Creative `ready` 高度流、AI history flyout、Automation 720×600 裁切；
2. **P2 浮层基建**：统一 Select/history/context detail 的翻转、钳制、resize/scroll 重定位；为 confirm/cURL 弹层补高度边界和内部滚动；
3. **长文本与触屏兜底**：chat 长字符串换行、最近会话操作的触屏可发现性、context chips 溢出提示；
4. **P3 与维护清理**：旧 AI media 规则、死选择器、断点命名和 ownership 收敛；清理不与 P1 修复混为同一批验收。

### 6.5 运行态验证记录

本次交叉审核使用当前构建产物和项目自带 visual preload，重点结果如下：

| 场景 | 结果 |
|---|---|
| Settings Token 720 / 840 / 900 / 1020px | 720 正常；840 溢出约 84px；900 溢出约 30px；1020 正常 |
| AI history 720 / 840px | history toggle 隐藏，没有按原报告描述展开浮层 |
| AI history 841 / 850 / 900 / 940 / 1000 / 1019px | 浮层均向右越界约 255px |
| AI history 约 1020px | 进入 expanded navigation，history toggle 隐藏 |
| Creative ready 720×600 | PublishForm 约 615px；creative editor 高度 0；详情列 scrollHeight 明显大于 clientHeight 且 overflow hidden |
| Automation 720×600 | layout 高 680px、内部 scrollHeight 约 1066px；规则列表高 0；控制台位于裁切边界之外，外层滚动无法恢复 |

交叉审核过程中未修改应用源码；本节结论以当前 HEAD 和上述运行态数据为准。
