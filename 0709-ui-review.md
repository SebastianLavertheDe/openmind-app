# OpenMind Desktop — UI 全面审查 (0709)

> 审查范围：`desktop-app/renderer/` 全部页面、组件、样式系统
> 审查日期：2026-07-09
> 对比基线：Cursor / Claude.ai / ChatGPT / Linear / Raycast（2024–2026 现代 AI 工具 UI）

---

## 一、核心结论（TL;DR）

你的直觉是对的，但**问题不在 AI 对话本身，而在它周围的"内容工作台"页面**。

这个 app 现在是**"分裂人格"**：

| 区域 | 现代化程度 | 说明 |
|---|---|---|
| AI Console（对话/Composer/推理/工具调用） | ⭐⭐⭐⭐ 现代派 | 7/8 刚重做完，对标 Cursor/Claude，几乎是另一个 app |
| 设计 Token 系统（颜色/字体/阴影/动效） | ⭐⭐⭐⭐ 地基扎实 | 9 阶语义色、Geist 字体、软阴影、spring 缓动都到位 |
| **Dashboard / Inbox / Creative / Projects / Sources 等内容页** | ⭐⭐ **这才是"老登"来源** | 原生 `<select>`、电子表格、textarea 编辑器、JSON dump、spinner 而非骨架屏 |

**一句话诊断**：AI 内核已经现代化了，但外壳（导航、各功能页）还停留在"传统管理后台"的形态——所以整体观感被拉低，"不像 AI 时代的 UI"。

下面把"哪里老、为什么老、怎么改"讲清楚。

---

## 二、已经做对的（别动，避免返工）

先确认基线，避免把好的改坏：

- **字体**：`Geist` + `JetBrains Mono`，变量字重（720/680 这种），tabular-nums，标题紧字距 `-.025em`，正文 `70ch` 行宽。这是当代 AI 工具标准配置。(`styles.css:76-92`)
- **颜色**：语义化 9 阶色阶（success/warning/danger/info 50–900），`color-mix()` 派生 tint，暗色模式刻意提亮（`#151922`，不再大面积纯黑）。(`styles.css:1-157`)
- **阴影/圆角**：三层软阴影 `--shadow-1/2/3`，圆角梯度 6/10/14px，聊天气泡非对称圆角 `16px 16px 4px 16px`。(`styles.css:51-67`)
- **动效**：完整 motion token（`--dur-*`、`--ease-*` 含 spring 超调），退场动画、stagger 入场、`prefers-reduced-motion` 全覆盖。(`styles.css:95-103`, `final-polish.css`)
- **AI Composer**：浮动卡片式输入框 + 圆形渐变发送钮 + ArrowUp 图标（ChatGPT 同款），文件/图片附件 + 缩略图 lightbox，chip 选择器。这是全 app 最现代的部分。(`composer.tsx`, `ai-console.css:1816-1963`)
- **推理展示**：折叠成一行 pill（"思考过程 · 12s · 1,842 字"），侧滑抽屉 + ⌘F 搜索，流式 shimmer 动画。比很多商用产品还细。(`thought.tsx`, `reasoning-panel.tsx`)
- **命令面板**：`⌘K` GlobalSearch 带 `backdrop-filter: blur(4px)` 毛玻璃、AI 意图识别卡片、键盘导航。Raycast/Linear 同款。(`GlobalSearch.tsx`, `shell.css:307`)

---

## 三、显得"老登"的具体问题（按影响力排序）

### 🔴 P0-1：原生 `<select>` 泛滥 —— 最出戏的一处

**问题**：全 app 大约 8+ 个页面都直接用浏览器原生 `<select>`，只套了个 6px 圆角 + 1px 边框。而代码库里**明明已经有自研的 `DropdownMenu` 组件**（`reader-pane.tsx:63` 就在用）。

**出现位置**：
- `InboxPage.tsx:380`（排序）
- `ProjectsPage.tsx:202-208`（阶段/平台/标签/日期 四连 select）
- `SettingsPage.tsx:149, 186`（模型、权限）
- `SourcesPage.tsx:271, 274`（类型、频率）
- `AiSidebar.tsx:97`（会话切换）

**为什么老**：原生 select 的下拉是操作系统渲染的，字体、圆角、阴影、动画全不受 token 系统控制，跟周围精心设计的卡片格格不入。在 Electron 里尤其明显（Chromium 默认 select 样式非常朴素）。现代 AI 工具（Cursor/Linear/Raycast）**没有一个**用原生 select。

**改法**：统一替换成已有的 `DropdownMenu`（或封装一个 `Select` 薄封装），接入 token 系统。工作量集中在封装 + 替换，不动样式地基。

---

### 🔴 P0-2：Sources 页是"电子表格管理后台"

**问题**：`SourcesPage.tsx:234-263` 用 `role="table"` + 固定列宽 CSS Grid（`minmax(230px,1.5fr) 90px 96px 120px 70px ...`），表头是 **9px 全大写字母**（`sources.css`），行用 `border-bottom` 分隔，底部是经典"上一页/下一页 · 第 x/y 页"分页栏。

```
source-head: font-size: 9px; letter-spacing: .06em; text-transform: uppercase;
source-row:  grid-template-columns: ...; min-width: 780px;
```

**为什么老**：这是 2015 年前后 Bootstrap admin 模板的标配形态。9px 字号还低于自家的 `--fs-xs: 11px` 下限（`styles.css:86` 注释明确说过要把 9–10px 全提到 11px，这里漏网了）。对比之下 Inbox 用的是**虚拟化列表**（`VirtualList`, `InboxPage.tsx:397`）+ `onReachEnd` 无限滚动——同一 app 里两种时代感并存。

**改法**：改成卡片网格或紧凑列表行（参考 Inbox 的 row 形态），分页换成无限滚动或"加载更多"。9px 表头提到 ≥11px。

---

### 🔴 P0-3：Creative 编辑器 = textarea + 手动 Markdown 按钮

**问题**：`CreativePage.tsx` 的编辑区是一个裸 `<textarea>` + 一排文字按钮（`H2` / `B` / `•` / `链接` / `图片` / `代码` / `引用` / `本地文件`），靠 `insertAtCursor` 往光标插标记。没有所见即所得、没有 slash 命令、没有选中浮工具栏、没有快捷键提示。

**讽刺点**：这个页面**正上方就挂着现代的 `InlineAiBar`**（选中文本 → AI 改写/扩写/翻译 → 流式预览 → 接受/丢弃，Notion-AI/Cursor 同款）。结果 AI 部分很现代，编辑器本体却是 2015 年 BBCode 风格，割裂感极强。

**改法**：至少接入轻量富文本（CodeMirror 6 / ProseMirror / Tiptap），支持 slash 命令和 Markdown 快捷输入。或最低成本：给 textarea 加选中浮工具栏 + 快捷键。

---

### 🟠 P1-1：加载态全是 spinner，不用骨架屏

**问题**：代码库里**已经有 `Skeleton` 组件**（`feedback.tsx:50-56`，带 `role="status"` 和递减宽度行），但**全 app 没有一处用它**。所有加载态都是 `LoadingState`（居中转圈 + 文字）。

- `DashboardPage.tsx:24`、`InboxPage.tsx:397`、`SettingsPage.tsx:106`、`ProjectsPage` 等

**为什么老**：2018 年以后的产品基本都用骨架屏填充列表/卡片区域，因为 spinner 会让内容区"塌陷成空白"，跳动明显。骨架屏保持布局稳定，观感更"成品"。

**改法**：把 Inbox 列表、Dashboard 指标卡、Projects 详情的 loading 从 spinner 换成对应形态的 `Skeleton`。组件现成，只是没被用起来。

---

### 🟠 P1-2：Projects 详情直接 dump JSON

**问题**：`ProjectsPage.tsx:186, 307` 把 `JSON.stringify(detail.manifest, null, 2)` 塞进 `<pre className="project-manifest">` 当"清单"展示。这是开发者视角的原始数据，对终端用户非常不友好。

**改法**：把 manifest 解析成结构化的 key-value 卡片（项目已有 `<dl>` 模式 `project-info-grid`，可复用）。

---

### 🟠 P1-3：Automation 页有明显未完成处

**问题**：
- `AutomationPage.tsx:215` 的"编辑"按钮是**无 handler 的空按钮**（`<button type="button">{m.automation.edit}</button>`），规则还是硬编码常量数组（`RULES` `:24-71`），不可编辑。
- `:244-247` 运行日志是 `<pre>` 裸文本拼接，无日志级别着色、无过滤、无结构化。
- 复制粘贴了一个本地 `SwitchButton`（`:255-268`），和 Settings 里的实现重复。

**为什么老**：一个"编辑"按钮点了没反应 + 裸日志终端 = 半成品后台的味道。

**改法**：要么补全编辑能力，要么暂时把"编辑"按钮去掉/改成"查看详情"，别留死按钮。日志可以用已有的 `OverflowBox`（带搜索）+ 日志级别 chip。

---

### 🟡 P2-1：AI 在页面层分布不均

**现状**：
- ✅ 已内联 AI：Creative 编辑器（`InlineAiBar`）、命令面板（`GlobalSearch` 意图识别）、Inbox 阅读区（"加入 AI 上下文"一键）
- ❌ 无 AI：Dashboard（只有 3 个指标卡 + 2 个跳转按钮，非常空）、DailyBrief（明明是 AI 生成的内容，却只能只读 ReactMarkdown 渲染，**没有"重新生成/追问/针对某段提问"**）、Sources（纯 CRUD 表格）、Projects 详情（AI 只是以 chip 形式引用，要跳出去才能用）

**为什么影响"AI 时代感"**：现代 AI 工具的特征是"AI 触手可及、无处不在"。当前 AI 被关在 AI Console 和侧边栏里，其他页面像普通后台。尤其 DailyBrief——内容本身就是 AI 产物却不可交互，是最大的违和点。

**改法（按 ROI）**：
1. DailyBrief 加"重新生成 / 就此提问 / 段落级追问"——投入小，观感提升大。
2. Dashboard 加一张 AI 总结卡（"今日要点 / 建议下一步"），而不是纯静态指标。
3. Projects 详情支持"基于此项目发起 AI 会话"，而不是跳转。

---

### 🟡 P2-2：零散的硬编码破坏 token 一致性

虽然 token 系统本身现代，但有若干"漏网之鱼"绕过了它，局部显旧：

- **语法高亮用死 hex**：`styles.css:434-437` 的 `.hljs-*` 颜色（`#d9a7a3`/`#b6cfae`/`#c5b88d`/`#79828f`）是 Sublime/Atom 时代调色板，不随主题变。别处代码块已经用 token 了，这里没跟上。
- **状态/错误边框死 hex**：`styles.css:335-336, 457-459, 602-606, 1130, 1167-1168, 1325-1327` 一堆 `#3f6748`/`#674946`/`#54482f`/`#d4c6a9` 之类手调的"终端绿/红"，明显是为暗色 UI 单点调出来的，没进 9 阶语义色阶。
- **亚像素字号**：`shell.css:488, 495, 504` 出现 `13.5px`/`11.5px`/`10.5px` 这种魔法数字，不落在字号梯度上。
- **低于下限的 9–10px**：`shell.css:298`（9px badge）、`shell.css:60-63`（10px brand）、`components.css:136, 430`（10px），都低于自家 `--fs-xs: 11px` 规定。

**改法**：把这些值回收到 token 系统。纯清理工作，不动布局。

---

### 🟡 P2-3：Creative 页 i18n 不一致

**问题**：`CreativePage.tsx` 内联了大量中文字符串（`"刷新"`/`"阶段"`/`"内容流"`/`"正在读取创作数据"`/`"编辑中…"`/`"自动保存中…"` 等），而其他所有页面都走 `messages`/`m.*`。说明这个页面早于 i18n 约定、没回填。不影响视觉但属同类技术债。

---

## 四、改造优先级建议

| 优先级 | 任务 | 预期观感提升 | 工作量 |
|---|---|---|---|
| P0 | 全局原生 `<select>` → 自研 `DropdownMenu`/`Select` | ⭐⭐⭐⭐⭐ 立刻去"管理后台感" | 中（封装1个 + 替换8处） |
| P0 | Sources 表格 → 卡片/紧凑列表 + 无限滚动 | ⭐⭐⭐⭐ | 中 |
| P0 | Creative 编辑器 textarea → 轻量富文本/CodeMirror | ⭐⭐⭐⭐ | 中-大 |
| P1 | 各页 loading spinner → `Skeleton`（组件已存在） | ⭐⭐⭐ | 小 |
| P1 | Projects JSON `<pre>` → 结构化展示 | ⭐⭐ | 小 |
| P1 | Automation 死按钮/裸日志清理 | ⭐⭐ | 小 |
| P2 | DailyBrief / Dashboard 内联 AI 交互 | ⭐⭐⭐⭐ AI 时代感核心 | 中 |
| P2 | 硬编码 hex / 魔法字号回收 token | ⭐⭐ 一致性 | 小-中 |
| P2 | Creative i18n 回填 | ⭐（不显性） | 小 |

**最小可见提升组合**（如果只做一轮）：P0 三件（select 统一化 + Sources 改造 + Creative 编辑器）+ P1 骨架屏。做完整体观感会从"管理后台"跳到"现代 AI 工具"。

---

## 五、与既有评审的关系（避免重复劳动）

`desktop-app/` 下已有三份评审，这次审查**不重复**它们，而是补充/验证：

| 既有文档 | 状态 | 本次验证结论 |
|---|---|---|
| `ai-ui-ux-review.md` | 标注"✅ 全部完成 2026-07-08" | **属实**。AI Console 部分的 P0/P1/P2 确实落地了（avatar、流式光标、approval 语义色、composer、diff 着色、OverflowBox、ReasoningPanel 都在）。这份不用再做。 |
| `message-display-review.md` (07-05) | 早期问题陈述 | 大部分已被上一份解决。残留：`message.tsx:43` 的 "AI" 死标签（渲染后 display:none）仍在；assistant 时间戳仍隐藏。小尾巴。 |
| `motion-design-review.md` (07-05) | 早期问题陈述 | motion token、退场动画、stagger 入场、`:active` 按压反馈**均已落地**。这份基本完成。 |
| `docs/AI_CONVERSATION_UI_REDESIGN_PLAN.md` | 架构北极星（cell 模型） | **部分实现**。ConversationCell / ThoughtSummaryCell / ToolCallCell 已有雏形；但 FinalAnswerCell 作为"明确收束节点"的强化、ToolCallCell 把输出/stderr/diff 移出主对话流到 inspector——这两点仍偏弱，工具输出还是会占满主对话区。 |
| `docs/CONTEXT_COMPACTION_UI_TODO.md` | 标注"暂不实现" | **仍是债**。后端有 compaction 事件，前端几乎无可见性（无分隔条、无元数据、会话列表无标记）。未变化。 |

**本次新增的价值**：前面三份评审**全部聚焦 AI Console**，没人系统看过 Dashboard/Inbox/Creative/Projects/Sources/Automation/Settings 这些"外壳页面"。而这恰恰是"老登感"的主要来源。本次审查补上了这个盲区。

---

## 六、一句话总结

> **AI 对话内核已经是 2026 年水准；但 app 外壳（各功能页）还是 2015 年管理后台形态。统一原生控件、改造 Sources/Creative、铺开骨架屏、把 AI 渗透到 DailyBrief/Dashboard——做完这四件事，"不像 AI 时代 UI"的感觉就会消失。**

---

### 附：关键证据索引

- 设计 token：`renderer/src/styles.css:1-157`
- AI Console 样式：`renderer/src/styles/features/ai-console.css`（2156 行）
- 原生 select 清单：`InboxPage.tsx:380` / `ProjectsPage.tsx:202-208` / `SettingsPage.tsx:149,186` / `SourcesPage.tsx:271,274` / `AiSidebar.tsx:97`
- Sources 表格：`SourcesPage.tsx:234-263` + `sources.css`
- Creative 编辑器：`CreativePage.tsx`（textarea + toolbar）
- 未用骨架屏：`feedback.tsx:50-56`（Skeleton 定义但零调用）
- JSON dump：`ProjectsPage.tsx:186, 307`
- Automation 死按钮：`AutomationPage.tsx:215`
- 硬编码 hex/字号：`styles.css:335,434,457,602,1130,1167,1325` / `shell.css:298,60,488`
