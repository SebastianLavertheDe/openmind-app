# CC Tools Desktop — UI/UX Pro Max Skill 模块化审查报告

> 审查工具:`ui-ux-pro-max` skill(已安装于 `desktop-app/.claude/skills/`)
> 审查日期:2026-07-09
> 范围:按 8 个模块逐一深入 review(全局 contrast/focus/z-index/reduced-motion 问题已在首轮修复,本轮只报模块特有问题)
> 验证方法:每条均附 `file:line` 证据,agent 实读源码确认

---

## 严重度分布总览

| 模块 | 🔴 Critical | 🟠 High | 🟡 Medium | 🔵 Low |
|------|:---:|:---:|:---:|:---:|
| 1. Dashboard / Daily Brief | 0 | 1 | 4 | 4 |
| 2. Inbox | **1** | 3 | 4 | 5 |
| 3. AI Console | 0 | **4** | 5 | 5 |
| 4. Creative | **3** | 3 | 4 | 3 |
| 5. Projects | 0 | 2 | 2 | 1 |
| 6. Automation | **1** | 2 | 3 | 1 |
| 7. Settings + Sources | 0 | 2 | 4 | 2 |
| 8. App Shell / 全局 | 0 | 2 | 5 | 6 |
| **合计** | **5** | **19** | **31** | **27** |

> ⚠️ **最值得警惕的发现**:多个模块存在**完整组件 + CSS 已编写但从未被渲染**(死代码),说明功能开发到一半未接线——Creative 模块尤甚。

---

## 模块 1 · Dashboard / Daily Brief

### 🟠 High
- **主 CTA 被特征样式覆盖,看起来和次要按钮一样** — `DashboardPage.tsx:40` + `dashboard-brief.css:302` — "继续创作"用 `className="primary-button"`,但 `.dashboard-head-actions button`(特异性 0,1,1)覆盖了它的 accent 填充。无 `.dashboard-head-actions .primary-button` 恢复规则。→ 加恢复规则。

### 🟡 Medium
- **选题分数仅靠颜色区分** — `DashboardPage.tsx:69` — `{score} 分` 与 `{n} 条资料` 字号相同,仅 accent 色不同(纯颜色)。→ 加 weight/badge 非颜色强调。
- **指标数字无 tabular-nums** — `components.css:546` — 自动刷新时数字横向抖动。→ 加 `font-variant-numeric: tabular-nums`。
- **neutral 色调指标卡无视觉区分** — `DashboardPage.tsx:49` — neutral 无 inset 阴影/stripe,与 info 卡视觉无差别。
- **Daily Brief 内容是单段 Markdown,无分类分组** — `DailyBriefPage.tsx:101` — `.brief-topic-list`/`.watch-list` 等分组 CSS 全是死代码,实际渲染一个不透明的 Markdown 块,可扫描性差。

### 🔵 Low
- 推荐选题空状态用 `:has()` CSS trick,无可操作 CTA(`DashboardPage.tsx:62`)。
- "重要内容"指标用 neutral tone,语义应为 warning(`DailyBriefPage.tsx:60`)。
- 日期切换按钮在重新加载时未 disable,可连点刷爆请求(`DailyBriefPage.tsx:77`)。
- head-action 按钮无显式 `:hover`(`dashboard-brief.css:302`)。

---

## 模块 2 · Inbox ⚠️ 核心功能缺失

### 🔴 Critical
- **已读/未读状态从未渲染或设置——颠覆 inbox 的核心用途** — `row.tsx:50` 只渲染 starred;`InboxPage.tsx:67` 无 read 过滤。`ContentState.read`(contracts.ts:433)、查询/patch 都支持 read,测试也构造了 `read:false`,但 UI 完全没有:无未读指示(粗体标题/圆点)、无"未读/全部"过滤 tab、打开时不标记 read。**一个看不出未读的 inbox。** → 渲染未读 affordance + 加过滤 tab + 打开时标记 read。

### 🟠 High
- **响应式 media query 被内联样式静默击败——三栏在窄窗永不降级** — `InboxPage.tsx:349` 用 `style={{ gridTemplateColumns: renderedColumns }}` 内联覆盖,而 responsive.css 的断点改的是 `--three-pane-columns` 变量。内联优先级高于 media query,所以 820px 窗口 filter pane 仍 224px、item pane 390px,reader 被饿死。→ 改为 `style={{ '--three-pane-columns': renderedColumns }}`。
- **虚拟列表(>80 条)键盘导航不滚动激活行入视** — `InboxPage.tsx:405` 未传 `selectedKey` 给 `VirtualList`(组件内置了 scroll-into-view 逻辑)。虚拟化后离屏行不在 DOM,`getElementById` 返回 null,焦点丢失。→ 传 `selectedKey={selected?.id}`。
- **HTML 预览 iframe 完全无样式——可能零高度** — `content-preview.tsx:10` 的 `.html-preview` 在 inbox.css 里无规则(只有 ai-console.css 有同名规则,作用域不匹配)。iframe 无显式高度在 grid 里会塌缩。→ 加 `.inbox-reader .html-preview { width:100%; height:100%; min-height:60vh; }`。

### 🟡 Medium
- Reader pane 无目录(TOC),长文无导航(`reader-pane.tsx:45`)。
- 批量操作有限:无删除、无标记已读;"清除状态"一键抹掉 starred+tags 无确认(`batch-bar.tsx:33`)。
- 选中(checked)行的 CSS 规则缺失——`.inbox-row.checked` 无样式,批量选中行无可视区分(`inbox.css`)。
- `.inbox-list > button` 选择器是死代码(实际结构是 `.inbox-row > button`)。

### 🔵 Low
- 搜索框无清除(X)按钮,搜索词未在 filter summary 里显示。
- Space 键标星的是"已打开项"而非"焦点行",心智模型冲突(`InboxPage.tsx:190`)。
- ColumnSplitter 按钮标签硬编码中文,未走 messages i18n(`ColumnSplitter.tsx:66`)。
- Reader header 直接显示原始文件系统 path(`reader-pane.tsx:56`)。
- `formatTime` 用运行时时区,跨午夜可能显示错误日期(`helpers.ts:21`)。

---

## 模块 3 · AI Console(最复杂模块)

### 🟠 High
- **`ReasoningPanel` 是完整死代码——生产环境思考内容用纯 `<pre>` 渲染,丢失 markdown/数学结构** — `reasoning-panel.tsx:34` 从未被任何组件 import/渲染(230 行组件 + 专属 CSS)。实际用的是 `thought.tsx:90` 的 `<pre>`,而 ReasoningPanel 正是为修复"思考常含列表/代码/公式"而建(用 ReactMarkdown + katex)。→ 接线 ReasoningPanel 或删除。
- **会话列表无 running/waiting/failed 状态指示** — `AiWorkbench.tsx:387` 的 session-compact-meta 只渲染 provider + time。CSS `.session-status.running/.waiting-approval/.failed`(styles.css:330)和 `.session-compact-meta em.approval/.running/.failed`(ai-console.css:97)都已写好但从未 emit。`session.status` 字段可用。→ 渲染状态点/badge。
- **无全局/nav 的待审批指示** — 审批 banner 只在当前活跃会话的 chat-scroll 内(`approval-banner.tsx:17`)。看别的会话或后台时,待审批完全不可见。CSS `.session-status.waiting-approval` 已就绪。→ 给待审批会话加 badge。
- **PatchView 无接受/拒绝 hunk 操作——diff 只读** — `patch-view.tsx:68` 只渲染表格化 diff,无逐 hunk/逐文件 accept/reject 按钮。`ChangeTraceCard` 只有 Open/Reveal/Copy。→ 若需要内联操作则加按钮。

### 🟡 Medium
- **破坏性审批(delete/elevation/risks)一键不可逆批准,无确认** — `approval.tsx:31` accept 立即提交无确认,decline 反而有 5s undo。`DangerousCommandText` 标红 `rm -rf`/`sudo` 但不门控 allow 按钮。→ 对高风险类别加二次确认/hold-to-allow。
- 工具输出未虚拟化——长输出展开后渲染上千 span,且无 Copy 按钮(`tool.tsx:180`)。
- 排队运行状态产生空白线程——发送后 run 排队(非 streaming)时无 "排队中" 占位(`Chat.tsx:96`)。
- 自动滚动依赖数组含 `nearBottom` 本身,快速 streaming 时可能重触发跳底(`Chat.tsx:111`)。
- 长输出 `OUTPUT_CHUNK_SIZE=8000` 截断,但超 50000 只显示提示文字。

### 🔵 Low
- 用户消息无头像(注释 `{/* P0-AI-1: 用户头像 */}` 暗示应有)(`message.tsx:26`)。
- assistant 消息的 label/timestamp 被 `display:none` 强制隐藏,长会话失去时间定位(`styles.css:405`)。
- user-message max-width 在两处声明不同值(styles.css:359 vs ai-console.css:311)。
- slash 命令/@ 提及的可发现性靠 `aria-hidden` 的占位 chip,placeholder 未提示(`/` `@` 触发)。
- ChipSelect(provider/权限)下拉无键盘导航,与 suggestion menu 不一致(`composer.tsx:684`)。

---

## 模块 4 · Creative ⚠️ 多个 Critical(死代码/未接线)

### 🔴 Critical
- **整个 FunnelBar 无样式——类名不匹配** — `stream.tsx:34` 渲染 `creative-funnel`,但 CSS 只有 `.funnel-bar`(creative.css:901)。结果:主要的阶段漏斗导航(选题→起草→待发布→已发布 + 计数)渲染为无样式纯文本,pulse 注意指示失效。→ 改类名或补 CSS。
- **PublishForm 完全无 CSS** — `panels.tsx:96` 的 `publish-form`/`publish-note`/`publish-field`/`publish-checklist-inline`/`publish-block`/`publish-actions` 在任何样式表中均无规则。"ready" 阶段的发布就绪门控(测试点名"blocks ready export until checks pass")渲染为无样式表单,checklist 的 `.passed` 无绿勾样式,`.publish-block` 无警告样式。→ 补 CSS。
- **四个工作区视图中有三个不可达** — `CreativePage.tsx:65` 的 `view` 类型含 `history`/`release`/`analytics`,渲染分支都在,但**没有任何 UI 控件调用 `setView`**(唯一调用是创建项目后 `setView("workflow")`)。History(版本 diff/还原)、Release Log、Analytics 视图及其 CSS 对用户而言是死代码。→ 加视图切换器。

### 🟠 High
- **Inspector 面板及其全部子面板是死代码** — `CreativePage.tsx:87` 初始化了 `useThreePaneLayout`,但自建 3 段 columns 字符串,从不渲染 `.creative-inspector`、右侧 ColumnSplitter、或 `MaterialsPanel`/`NotesPanel`/`AiPanel`/`VersionsPanel`/`ReviewPanel`。CSS(creative.css:698-733)和组件全部未用。→ 接线或删除。
- **无实时预览——编辑/预览互斥 tab** — `CreativePage.tsx:411` 的 editor-mode-bar 只能切 edit 或 preview,无并排分屏,无滚动同步。→ 加 split 模式。
- **"review" 阶段无审核 UI** — `CreativePage.tsx:392` 的 review 阶段只显示编辑器,`ReviewPanel`(panels.tsx:40,含质量检查 + AI 审核报告 + approve/request-changes)从未挂载。header 的"进入待发布"直接 `advance()` 跳过审核门控。→ review 阶段渲染 ReviewPanel 并门控 advance。

### 🟡 Medium
- 打开项目时主面板闪现"请从左侧选择"空状态(无 opening skeleton)(`CreativePage.tsx:132`)。
- 文档标题只读,无法重命名(`CreativePage.tsx:382`)。
- slash 菜单无可发现性提示(`MarkdownEditor.tsx:188`)。
- stream rail 未按 bucket 着色,非激活卡片的状态指示不可见(`stream.tsx:197`)。

### 🔵 Low
- "已自动保存" 状态永不清除(`CreativePage.tsx:81`)。
- `topic-existing`/`topic-platform-grid` 等 CSS 缺失。
- `published-summary`/`creative-warn` 无样式。

> ✅ **亮点**:CodeMirror 6 编辑器(行号/折叠/括号匹配/markdown 高亮/搜索)、slash 菜单键盘可达、autosave 5 状态、CreativeStreamSkeleton 覆盖列表加载。

---

## 模块 5 · Projects

### 🟠 High
- **审核问题 severity 渲染为原始 enum 字符串,无 tone 区分** — `ProjectsPage.tsx:307` 的 `{issue.severity}` 直接显示 `"info"/"warning"/"error"`,全部共用红色样式,且是未本地化的英文值。→ 加 severityLabel 映射 + 按严重度分色(参照 run-history.tsx 的 STATUS_TONES)。
- **审核状态(pending/changes-requested/approved)是纯文本非 StatusBadge** — `ProjectsPage.tsx:305`。顶层状态用了 StatusBadge,但审核结论(最决策相关的)是裸 span。→ 用 StatusBadge。

### 🟡 Medium
- 审核分数无刻度/单位/aria-label——`<strong>82</strong>` 不知满分多少(`ProjectsPage.tsx:305`)。
- table 视图无表头、无 `role="table"`,本质是更密的卡片列表(`projects.css:80`)。

### 🔵 Low
- 卡片/表格视图差异仅一行平台信息,切换意义不大(`ProjectsPage.tsx:254`)。

---

## 模块 6 · Automation ⚠️ 死代码

### 🔴 Critical
- **RunHistoryTable 及全部运行历史 CSS 是死代码——UI 里根本没渲染运行历史** — `run-history.tsx:32` 的 RunHistoryTable 只被测试 import,AutomationPage 从不渲染它。`listSourceRuns()` 加载了 history,但只用于取最新一条和拼 consoleText。无历史表格/列表,用户无法回顾过往运行结果/时长/退出码。整个 `.automation-history-list/.row` CSS(360-424)未用。→ 在详情面板渲染 RunHistoryTable(已有测试和 CSS)。

### 🟠 High
- 无虚拟化:日志硬截断 800 行且无截断提示(`AutomationPage.tsx:108`);RunHistoryTable 一旦接线,定时规则会累积上百行无分页。
- AutomationPage 无 loading/empty 状态——`loadHistory` 异步,首屏假性显示"从未运行"(`AutomationPage.tsx:74`)。

### 🟡 Medium
- step `failed` 状态无 CSS 规则——失败步骤回退到 muted,看起来和正常一样(`automation.css:713`)。
- 规则硬编码(3 条),无"无规则"空状态;详情只读,无编辑表单(`AutomationPage.tsx:25`)。
- 规则列表状态在 `<small>` 里无颜色区分,"需要关注"和"就绪"看起来一样(`AutomationPage.tsx:171`)。

### 🔵 Low
- cron 表达式原始显示,且 event trigger(`after:capture.success`)被当 cron 渲染,概念混淆(`AutomationPage.tsx:209`)。

---

## 模块 7 · Settings + Sources

### 🟠 High
- **风险设置与普通开关视觉无别** — `SettingsPage.tsx:195` 的 destructiveOps/riskScan 开关走普通 PreferenceRow,`.risk-setting` 类(有橙色样式)从未被使用。破坏性操作开关看起来和主题切换一样。→ 给风险行加 warning 变体。
- **添加数据源 URL 无校验** — `SourcesPage.tsx:166` 只检查非空,"asdf" 也被接受,无内联错误/helper text,后端报错才知。→ 按类型校验 + 字段级错误。

### 🟡 Medium
- Settings 无保存成功反馈(失败才 toast)(`SettingsPage.tsx:64`)。
- "添加 Provider" 按钮是假 CTA——只弹"下一轮接入"info toast(`SettingsPage.tsx:134`)。
- 源类型 tab(x/reddit/manual)在 Add 表单里不可创建,可见但不可建(`SourcesPage.tsx:23`)。
- 频率 Select 把本地化标签当 value 持久化,换 locale 会断匹配(`SourcesPage.tsx:33`)。
- ~40 行 Sources 旧表格 CSS 是死代码(`.source-row` 等,styles.css:1533)。

### 🔵 Low
- 搜索 input 无 accessible name(仅 placeholder)(`SourcesPage.tsx:232`)。
- 主题选择器无"跟随系统"选项(SettingsPage.tsx:13)。

---

## 模块 8 · App Shell / 全局

### 🟠 High
- **错误 toast 用 polite 而非 assertive 播报** — `FeedbackHost.tsx:64` 所有 toast 都 `role="status"`(隐式 polite),错误应 `role="alert"` 立即播报。→ `role={toast.tone === "error" ? "alert" : "status"}`。
- **全局搜索 listbox 选项无 id,容器无 aria-activedescendant** — `GlobalSearch.tsx:204` 箭头键移动 activeIndex 但读屏无法播报高亮项(视觉 .active 对 AT 不可见)。且激活项不 scrollIntoView,超出视口的高亮看不见。→ 加 option id + aria-activedescendant + scrollIntoView。

### 🟡 Medium
- toast 容器 aria-live + 子项 role="status" 双重声明,部分读屏重复播报(`FeedbackHost.tsx:64`)。
- 错误 toast 与 info/success 同为 2800ms 自动消失,带 action 的错误可能来不及点(`ai-context.tsx:486`)。
- 状态指示点无 aria-hidden,容器无 role="status"(`AppShell.tsx:93`)。
- Cmd+K 无 `aria-keyshortcuts`,kbd 只显示 "Ctrl K"(mac 应 ⌘K)(`AppShell.tsx:87`)。
- 820px 以下折叠按钮无效(media query 强制 64px,但按钮仍切 --nav-width)(`App.tsx:49`)。

### 🔵 Low
- nav 无箭头键导航(可接受,Tab 可达)(`AppShell.tsx:62`)。
- 折叠 nav 的 badge 因 `margin-left:auto` 在居中布局里脱离图标(`shell.css:119`)。
- Bell 按钮标签"通知"但跳 AI 页(实为待审批),语义不符(`AppShell.tsx:97`)。
- ColumnSplitter 折叠按钮硬编码中文(`ColumnSplitter.tsx:66`)。
- AI 侧栏 resizer 箭头方向与 ColumnSplitter 约定相反(`AiSidebar.tsx:65`)。
- 折叠 rail 靠 `title` 原生 tooltip(延迟 1-2s,键盘 focus 不显示)。

---

## 修复优先级建议

### 第一批:Critical(功能缺失/死代码,影响产品可用性)
1. **Inbox read/unread 状态**(模块2-C)——核心功能完全没实现
2. **Creative FunnelBar / PublishForm 无样式**(模块4-C)——类名不匹配/CSS 缺失
3. **Creative 三视图不可达**(模块4-C)——history/release/analytics 死代码
4. **Automation 运行历史未渲染**(模块6-C)——RunHistoryTable 死代码

### 第二批:High(体验/安全)
5. Inbox 响应式被内联样式击败(模块2-H)
6. AI Console ReasoningPanel 死代码(模块3-H)
7. AI Console 会话状态指示缺失(模块3-H)
8. 错误 toast 播报优先级(模块8-H)
9. 全局搜索 aria-activedescendant(模块8-H)
10. Projects 审核严重度/状态无区分(模块5-H)
11. Settings 风险开关无警告样式(模块7-H)

### 第三批:Medium/Low(一致性/打磨)
按模块逐个治理,多为局部样式/i18n/反馈细节。

---

## 附:本轮 review 使用的 skill 流程

```bash
# 各模块对照设计智能基线
python3 scripts/search.py "dashboard analytics metrics cards productivity" --domain ux -n 8
python3 scripts/search.py "inbox email list three-pane reader unread filter" --domain ux -n 8
python3 scripts/search.py "chat conversation streaming tool-call approval timeline" --domain ux -n 8
python3 scripts/search.py "markdown editor live preview writing workspace autosave" --domain ux -n 8
python3 scripts/search.py "data table sort filter status badge empty state" --domain ux -n 8
python3 scripts/search.py "form validation error feedback settings risk toggle" --domain ux -n 8
python3 scripts/search.py "command palette keyboard navigation toast live region a11y" --domain ux -n 8
```

报告文件:`desktop-app/uipro-skill-review-modules.md`。所有 `file:line` 证据已由探查 agent 实读源码确认。
