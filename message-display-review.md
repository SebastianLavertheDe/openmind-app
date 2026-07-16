# AI 消息展示区 设计评审 — Desktop App

> 评审视角：专业产品设计师
> 评审范围：`desktop-app/renderer/src/features/ai-console/`（`Chat.tsx`、`message.tsx`、`thought.tsx`、`tool.tsx`、`plan.tsx`）+ 相关样式 `styles.css` / `ai-console.css`
> 评审日期：2026-07-05
> 评审人：Claude
> 配套文档：`motion-design-review.md`（动效专项，本文涉及动效处指向该文档）

## 总体结论

工程底子很扎实：滚动记忆、按会话分页、markdown LRU 缓存、流式跳过高亮保性能、`details` 折叠模式贯穿一致。视觉上的核心问题是 **层级倒挂**——每一步工具调用都是有边框、有阴影的卡片，而用户最想看的 AI 回答反而是一段无任何锚点的暗色正文。对话的「角色感」和「时间感」被刻意压平，结果在长会话里读起来更像一份流水账文档，而不是一场对话。

成熟度评估：

| 维度 | 评分 | 说明 |
|------|------|------|
| 信息架构与折叠策略 | ★★★★☆ | `completed-process` 收纳已答问题的过程步骤，思路正确 |
| 角色与对话感 | ★★☆☆☆ | 助手消息无 label / 无头像 / 时间被隐藏，角色锚点缺失 |
| 视觉层级 | ★★☆☆☆ | 过程卡片在视觉上盖过回答本身 |
| 排版与密度 | ★★★☆☆ | 正文尚可；trace 卡片 9–10px 文字过密 |
| 流式体验 | ★★☆☆☆ | 缺末端光标，spinner 在右上角而非文本生长点 |
| 卡片系统一致性 | ★★★★☆ | 一套 `--panel`+`--border`+`--shadow-card`+`--radius-md` 贯穿，语义色统一 |
| 交互可发现性 | ★★☆☆☆ | 关键动作 hover 才显现，且无 tooltip 系统 |
| 可访问性 | ★★★☆☆ | 有 aria-live / aria-label；但 9–10px muted 文字对比度堪忧 |

**最该先做的三件事：**

1. 给助手消息加一个轻量「角色锚点」（左侧细色条 / 极淡底 / 或恢复 label），把回答从裸正文里立起来——一次改动就能纠正层级倒挂。
2. 给流式回复加末端光标，把「正在生成」的信号放回文本生长的位置。
3. trace 卡片里 9–10px 的字号整体上调到 11–12px 起步，解决可读性。

---

## 一、角色与对话感（核心问题）

### 1.1 助手消息没有任何角色锚点

`message.tsx:43` 渲染了 `label="AI"`，但 CSS 把它彻底藏掉了：

```css
/* styles.css:292-303 */
.assistant-message .message-meta { min-height:0; height:0; overflow:visible; justify-content:flex-end; color:transparent; ... }
.assistant-message .message-meta > span:first-child,   /* "AI" label */
.assistant-message .message-meta > time { display:none; } /* 时间 */
```

结果：助手消息既没有「AI」标签，也没有头像，连时间戳都看不到。区分用户与 AI 只能靠对齐（用户右浮气泡、AI 左侧满宽）。在短会话里勉强够用，长会话向上滚动时就分不清「这段是谁说的、什么时间说的」。

**这是渲染了又藏起来的死代码**——要么恢复可见，要么从 JSX 里移除，二者必居其一，不应长期挂着不可见的 label。

建议（任选其一，按侵入度从低到高）：
- **最小改动**：恢复一个极简角色锚点。助手消息左侧加一条 2px 的 `--accent` 色条（`border-left` + 配套左 padding），既不引入气泡、又能一眼区分起点。
- **中庸**：恢复 label + 时间，但弱化（`muted`、正常大小写、不要 uppercase tracked），放在消息顶部一行。
- **完整**：加 16–20px 的 AI 头像（lucide 的 `Bot`/`Sparkles`），与用户气泡形成对称角色。

### 1.2 时间戳只在用户消息可见

助手消息时间被 `display:none`。长会话里 AI 回答的时序完全丢失。建议至少在助手消息保留时间，弱化展示（muted，11px）。

### 1.3 uppercase tracked 标签对中文无效

`styles.css:282` `.message-meta` 用 `text-transform:uppercase; letter-spacing:.06em; font-weight:700`，这是为拉丁字母设计的「eyebrow label」样式。应用到中文「你」上，uppercase 不起作用，letter-spacing 反而把单字推开显得松散。建议 meta 文案走中文时降级为普通大小写、正常字距、`font-weight:600`。

---

## 二、视觉层级倒挂

### 2.1 过程卡片盖过了答案

对比同屏元素的视觉权重：

| 元素 | 视觉处理 | 来源 |
|------|----------|------|
| 工具调用 `tool-event` | 边框 + `--shadow-card` + `--radius-md` + 30px 图标卡 + 多行标题 | `styles.css:437-451` |
| 运行态 `run-activity` | 边框 + 阴影 + 指示灯动画 + 进度条 | `styles.css:411-422` |
| 审批 `approval-card` | 边框 + 阴影 + 语义色 | `ai-console.css:469-640` |
| **AI 回答 `.chat-markdown`** | **无任何容器，`color:var(--text-dim)` 暗色正文** | `styles.css:316` |

用户最在意的产物（AI 的回答）视觉权重最轻，而每一道工序都披着完整卡片样式。一次复杂任务跑下来，屏幕被工具卡片填满，真正的答案反而像夹缝里的注释。

`completed-process`（`Chat.tsx:310-326`）把已答问题的工具步骤折叠到「已处理 · 12s」后面，是对的方向，也是目前唯一的层级救济。问题在于它只在回答落地后才折叠——**进行中的任务**和**当前回合**依然层级混乱。

建议：
- 给助手回答一个克制的容器（极淡 `--panel` 底色 或 左侧色条），把它从「裸正文」升格为「主内容」。
- 进行中的工具调用可以更紧凑：未展开时压低阴影、缩小图标卡（24px 而非 30px），把视觉焦点让给正在生长的回答。
- 错误与审批保持现在的强样式——它们本来就该跳出来。

### 2.2 完成态折叠的入口太弱

`completed-process > summary`（`styles.css:399-404` / `ai-console.css:340-364`）是一行 muted 灰字「已处理 · 12s」压在 `border-bottom` 上，颜色与正文同级，几乎融进背景。「这里能点开看完整过程」的 affordance 极弱，多数用户不会发现可展开。

建议：summary 加 hover 反馈（背景色 / chevron 已有但太轻）、未读态给一个极淡的强调色提示，或展开前给一行「调用了 N 个工具」的副标题，让用户知道展开有内容。

---

## 三、排版与密度

### 3.1 trace 卡片字号普遍过小

实测字号（`styles.css` / `ai-console.css`）：

| 元素 | 字号 | 评价 |
|------|------|------|
| `.tool-event-title small` | 9px | 过小 |
| `.tool-event-title i`（分类标） | 9px | 过小 |
| `.trace-status` | 9px | 过小 |
| `.trace-toolbar` / `.trace-toolbar button` | 10px | 偏小 |
| `.run-activity > div > span` | 11px | 勉强 |
| `.tool-event-title code` | 11px monospace | 勉强 |

大量 9–10px 文字承担真实信息（命令、状态、计数）。低于 12px 在常见 DPR/视距下阅读吃力，且 `muted` 灰色对比度多半不达 WCAG AA（正文要求 4.5:1）。

建议：trace 区文字起步 11px，关键标签 12px；`muted` 序列里再分一档 `--muted-strong` 给真正要读的文字。顺手核对对比度。

### 3.2 完成态正文已经调好，作为基准保留

`ai-console.css:377-385` 的 `.process-narrative`：15px / 1.72 行高 / `--text` 本色 / `white-space:pre-wrap`——这是整套界面里最舒服的阅读设置（`design-qa.md` 也确认过这是刻意为之）。助手回答正文可向它看齐：当前 `.chat-markdown` 是 `--text-dim` + 1.65 行高，略灰略紧。

---

## 四、流式体验

### 4.1 缺末端光标

`Chat.tsx:191` 流式期间渲染 `<AssistantMessage streaming>`，文本在 `.chat-markdown` 里逐字变长，但**生长点没有任何视觉信号**——没有闪烁光标、没有打字指示。

### 4.2 spinner 位置不对

`message.tsx:44` 流式时显示 `<LoaderCircle className="spin">`，但它在被压成 `height:0` 的 meta 里，靠 `.message-actions { position:absolute; top:-2px; right:0 }`（`styles.css:304-310`）浮到消息**右上角**。结果：「正在生成」的转圈出现在消息块的右上角，离文本实际生长的左下角很远，视线对不上。

建议：
- 流式时在 `.chat-markdown` 末尾追加一个 CSS 闪烁光标（`▍` 或 1px 宽的 `::after` 块，`animation` 1s step-end 透明度切换）——这是 ChatGPT/Claude 的标准做法，成本极低。
- spinner 可保留作为「正在思考/调用工具」的顶栏信号，但回答文本生长期间，光标才是主角。

### 4.3 「思考中」过渡的空白

`Chat.tsx:185-190` `showPendingThought` 会先放一个 pending 的 `ReasoningCard`（只有转圈 + 字符计数）。从用户点发送到第一个 token 出现之间的空窗，目前只有一个小转圈，没有「我正在读你的问题 / 正在检索 / 正在组织」这类阶段性反馈。建议复用 `run-activity`（已经有指示灯 + 进度条）作为这一阶段的更主动的状态展示。

---

## 五、各类卡片的视觉处理

整体卡片系统一致性好（统一 `--panel`+`--border`+`--shadow-card`+`--radius-md`，语义色 green/orange/red 统一）。逐项：

| 卡片 | 现状 | 建议 |
|------|------|------|
| `reasoning-event`（thought.tsx） | 可折叠，summary 显示首行预览 + 字符数；streaming 自动展开 | 预览首行很好，保留。展开内容是纯文本，长 reasoning 可考虑渐变遮罩 + 「展开全部」 |
| `tool-event`（tool.tsx） | summary 三列：图标 / 标题（动作+工具名+分类标）/ 状态+耗时；展开后 request+output+搜索框+导出 | 信息架构清晰。分类标 9px 偏小（见 §3.1）。`running→completed` 是 class 切换，无过渡（见 motion review） |
| `command-terminal` | 模拟终端：`$ cmd` + stdout/stderr + 底部状态条 | 设计到位。`failed/running/success` 三态语义清晰 |
| `command-group` | 多个命令合并成一个可折叠组 | 合并降噪做得好 |
| `plan-card`（plan.tsx） | `<ol>` 列表，每项一个 `<span aria-hidden>` 当状态点 + 文本 + 状态标 | 状态切换瞬时（pending→in-progress→completed 无动效），见 motion review。状态点建议补一个打勾/转圈的微动效 |
| `approval-card` | 强样式（橙色语义） | 对，审批本就该跳出。进入/退出无动效（见 motion review P0-1） |
| `error-event` / `system-event danger` | 红色语义 | 同上 |

---

## 六、交互可发现性

### 6.1 消息动作 hover 才显现

`styles.css:287-315`：`.message-actions` 默认 `opacity:0`，hover/focus-within 才到 1。助手消息的动作（引用 / 分支 / 重跑 / 复制）放在 `position:absolute; top:-2px; right:0`，纯图标、无标签、命中区 28×26px。

引用、复制这类高频动作问题不大（用户会去试），但**分支（branch）/ 重跑（rerun）是高价值进阶功能**，藏在角落的 13px 小图标里，新用户几乎发现不了。

建议：
- 引用 / 复制保持 hover 显现即可；
- 分支 / 重跑考虑提升到消息底部一行常驻的次级动作条，或至少补 tooltip（目前全仓无 tooltip 系统，见 motion review §P2-1）。
- 触摸场景下 hover 不存在，这些动作当前完全不可达——若 desktop-app 未来上触屏，需补长按或常驻菜单。

### 6.2 无 tooltip 系统

`title=` 原生提示散落各处（message.tsx 里大量 `title={...}`），体验差、延迟长、不可样式化。建议引入轻量 tooltip 组件，统一 hover 延迟与 fade（见 motion review P2-1）。

---

## 七、图片处理

### 7.1 AI 回答里的图片只能当文字链

`message.tsx:163-165` `SafeMarkdownImage` 把 markdown 图片渲染成「查看图片」文字链（`<a class="safe-image-link">`），点击在新窗口打开。AI 无法在回答里内联展示图片。

对一个处理媒体/推文素材的产品，这是实打实的体验损失。安全与尺寸顾虑可以理解，但有更好折中：

建议：
- 对可信任来源（本地截图、已知 CDN、用户自己粘贴的 data URL）内联渲染缩略图，点击复用刚做的多图灯箱（`composer.tsx` ContextTray 那套）放大查看。
- 仅对外部不可信大图保留文字链。

这样 AI 讲「看这张图」时，图真能出现在回答里。

---

## 八、空状态 / 加载 / 滚动

### 8.1 空状态

`Chat.tsx:299-308` `EmptyChat`：Bot 图标 + 标题 + 正文 + hint，居中。结构对，但 30px 灰图标偏冷清。建议加一个轻入场动效（fade + 微上移，复用 `page-head-rise` 的语言），并把 hint 里的可操作项（如「按 / 唤起技能」）做成可点击。

### 8.2 滚动行为（亮点，保留）

`Chat.tsx:96-146` 的滚动逻辑做得很好：
- 近底部自动贴底，离开则不抢滚动；
- `scrollMemory` 按会话记忆滚动位置，切回恢复；
- 离开底部时新消息累计 `unread`，`jump-bottom` 按钮带未读计数；
- 跳底 `behavior:"smooth"`。

这套是同类产品里少见的细致，建议保留并在团队内作为模式推广。

### 8.3 `jump-bottom` 按钮

`Chat.tsx:193-200` 离底时出现，带未读计数。按钮本身样式偏朴素，建议加进入动效（fade + 微上移），见 motion review。

---

## 九、动效（指向 motion-design-review.md）

为避免重复，本区动效问题汇总指向专项文档，仅列命中点：

- **新消息 / 流式 token 无入场**：motion review P0-2。本区最高优先。
- **流式末端光标缺失**：见本文 §4.1（这是动效之外的信号缺失，但与流式动效一并解决）。
- **`tool-event` / `plan-card` 状态切换无过渡**：motion review P1-3 / P2-1。
- **`completed-process` 展开无高度过渡**：motion review §手风琴高度（P2-1）。
- **审批卡片 / 错误条进入退出无动效**：motion review P0-1。

---

## 十、可访问性

- ✅ `aria-live`：`composer-approvals` assertive、reasoning pending `role="status"` polite、toast 栈 polite——覆盖到位。
- ✅ 动作按钮均有 `aria-label`。
- ✅ 结构语义正确（`article` / `details` / `summary` / `ol` / `time`）。
- ⚠️ **9–10px muted 文字对比度**：见 §3.1，需核对 WCAG AA（正文 4.5:1）。
- ⚠️ **角色锚点缺失本身是可访问性损耗**：屏幕阅读器有 `aria-label`，但视觉用户失去角色线索（见 §1.1）。
- ⚠️ hover-only 动作在键盘焦点下靠 `:focus-within` 显现，逻辑上可达，但 tab 顺序与视觉位置（右上角浮层）需要核对，避免焦点跳到不可见元素。

---

## 十一、优先级路线图

| 优先级 | 工作项 | 命中点 | 预估 |
|--------|--------|--------|------|
| P0 | 助手消息加角色锚点（左色条 / 恢复 label / 头像） | §1.1, §2.1 | 0.5d |
| P0 | 流式末端光标 + spinner 归位 | §4.1, §4.2 | 0.3d |
| P0 | trace 字号 9–10px → 11–12px，核对对比度 | §3.1, §10 | 0.5d |
| P1 | 助手回答正文容器化（淡底 / 色条），纠正层级倒挂 | §2.1 | 0.5d |
| P1 | `completed-process` 入口可发现性（hover / 副标题） | §2.2 | 0.3d |
| P1 | 消息动作分层：高频 hover，分支/重跑提升或加 tooltip | §6.1, §6.2 | 0.5d |
| P1 | 思考空窗用 `run-activity` 主动反馈 | §4.3 | 0.3d |
| P2 | 图片内联渲染（可信来源）+ 接入多图灯箱 | §7.1 | 1d |
| P2 | 空状态入场动效 + 可操作 hint | §8.1 | 0.3d |
| P2 | 配合 motion review 落地消息入场 / 状态过渡 | §9 | 见该文档 |

建议落地顺序：先做三项 P0（角色锚点、光标、字号），它们改动小、观感提升最大；再处理 P1 的层级与可发现性；图片内联与动效作为 P2 收尾。

---

## 附录：现有亮点（保留，勿动）

- **滚动系统**（§8.2）：贴底判断、会话级滚动记忆、未读计数、平滑跳底——同类产品少见，作为团队模式推广。
- **`completed-process` 折叠策略**：把已答问题的过程步骤收纳，方向正确，是层级问题的现行救济。
- **markdown 性能优化**（`message.tsx:60-95`）：流式跳过 `rehype-highlight`、落定后进 96 项 LRU、缓存命中时 LRU 前移——工程考究。
- **完成态正文排版**（`ai-console.css:377-385`）：15px / 1.72 / 本色，最舒适的阅读设置。
- **卡片系统一致性**：统一的 `--panel`+`--border`+`--shadow-card`+`--radius-md` 与 green/orange/red 语义色。
- **本地文件深度集成**：`MarkdownLink` / `MarkdownCode`（`message.tsx:124-161`）把代码块和链接变成可预览的本地文件入口，产品差异化亮点。
