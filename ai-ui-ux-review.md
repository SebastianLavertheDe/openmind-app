# AI 工作台 UI/UX Review

> 针对 `desktop-app/renderer/src/features/ai-console/` 的视觉与交互审查。
> 覆盖静态视觉（字号、圆角、色彩、层次、密度）与动态交互（状态机、过渡、反馈、可发现性、可达性）。
> 每项标注 `文件:行号`，便于直接定位落地。

> **✅ 全部优化已完成并复核通过（2026-07-08）**
>
> 落地清单：
> - **新增/重构组件**：`OverflowBox`（统一溢出容器 + ⌘F 搜索）、`ReasoningPanel`（方案 C 侧抽屉）、`PatchView`（diff 行级着色）、`file-icon.tsx`（共享文件 icon）
> - **P0 全量**：审批交互补全（退场动画/间距/toast/痕迹）、动态内容溢出 7 处收口、输入框浮动卡片化 + 发送按钮内嵌 + ChipSelect、消息气泡圆角 + provider avatar + 流式光标 glow、diff 行级着色 + 文件 icon
> - **P1 全量**：工具卡脉冲 stripe / cancelled 明确化 / 多开折叠、CompletedProcess 执行摘要、EmptyChat 示例卡片、jump-bottom FAB、session provider stripe + overflow 菜单、顶栏 status 圆点 + segmented control、**推理过程独立面板（方案 C 终局）**
> - **P2 全量**：stagger 进场、退场方向感、suggestion scrollIntoView + stripe、splitter 拖动不抖、edit dirty 确认、reasoning markdown + shimmer + elapsed、lightbox class 抽离 + chip hover、token 计数、空状态 chip、ErrorEvent stripe
> - **最终复核**：2026-07-08 已补齐剩余缺口（reasoning 路标化、侧抽屉搜索跳转、审批拒绝撤销、长 patch 搜索可达、测试契约同步）。
> - **验证**：`npm run typecheck` 通过；`npm run test:unit` 71/71 test files、721/721 tests 通过。

---

## 0. 总体诊断：为什么"像 90 年代"

设计语言停留在 **Flat 2.0 时代（2015 前后）**，对照 2024–2026 现代 LLM 客户端（Linear、Raycast AI、Cursor、v0、Claude.ai、ChatGPT），表现为五个共性症状：

| 维度 | 现状 | 现代标杆 |
|---|---|---|
| **字号** | 大量 `9px / 10px / 11px`（meta、session list、approval hint） | 正文 14–15px，meta 12px 起跳 |
| **圆角** | 气泡 `7-8px`、按钮 `4-5px`、徽章 `5px` | 气泡 `14-18px`、按钮 `10px`、胶囊 `999px` |
| **色彩** | 单一品牌蓝 `#2563eb`，无渐变、无语义色阶 | Avatar 化 + 渐变 + 语义色 token 系统 |
| **层次** | 几乎全靠 `1px solid var(--border)`，阴影罕见 | elevation token（3 层 shadow）+ 毛玻璃 |
| **密度** | 信息塞得很满，留白少 | 呼吸感（17–24px gap）+ 内容居中限宽 |

**交互层核心病灶：**
1. 状态可见性不足——cancelled 混 completed、running 不够醒目、审批决策无痕迹。
2. 高风险操作无强反馈——审批是唯一会"改变文件系统"的关口，但按钮语义色错、命令截断、无 undo、占输入框空间。
3. 可点击性弱——折叠卡片 hover 只变色，无 stripe/阴影/lift 预告。
4. 过渡曲线单一——所有动画都用同一条 `--ease-emphasized` + 240ms，缺乏分层。
5. 触屏/键盘/无障碍兜底缺失——hover-only actions、无 scrollIntoView、aria-live 过激。

---

## 1. 全局横切问题

### A. 设计 token 缺失
- [✅] **A1 引入 elevation token**：新增 `--shadow-1 / --shadow-2 / --shadow-3`，统一目前零散的阴影（`0 6px 22px`、`0 18px 48px` 各处硬编码）。
- [✅] **A2 引入语义色阶**：`--success / --warning / --danger / --info` 各 9 阶，替换单值的 `--green / --orange / --red`。
- [✅] **A3 引入渐变 token**：`--gradient-accent`，用于 avatar / 主按钮 / 流式光标 glow。

### B. 字号系统混乱
- [✅] **B1 收敛字号 token**：`styles.css` 当前无 `--fs-*`，组件硬编码 `9/10/11/12/13/14/16/18px` 8 档。收敛为 `--fs-xs(11) / sm(12) / base(13) / md(14) / lg(16) / xl(18) / 2xl(22)`。
- [✅] **B2 清理 9–10px 字号**：session-compact-meta `9px`、tool-insight dt `9px`、suggestion kbd `9px` 等全部提到 ≥11px。

### C. 头像/品牌身份缺失
- [✅] **C1 引入 provider avatar**：Codex / Claude Code 各一个 24–32px 圆形渐变 avatar，消息旁、session 旁、顶栏都用。
- [✅] **C2 引入用户头像**：消息旁或右上角。

### D. 微交互缺失
- [✅] **D1 按钮 hover lift**：`transform: translateY(-1px)` + shadow。
- [✅] **D2 按钮 press feedback**：`:active { transform: scale(.98) }`。
- [✅] **D3 折叠曲线分层**：进场用 `--ease-emphasized`、收起用 `--ease-exit`；dur 从 240ms 降到 200ms。当前 `final-polish.css:153` 全部用同一条曲线 + 240ms，收起时"卡一下"。

### E. 折叠动画方案不一致
- [✅] **E1 统一折叠方案**：`final-polish.css:153` 用 `interpolate-size: allow-keywords`（新），但 `styles.css:315-330` 的 `timeline-presence-item` 仍用 `grid-template-rows: 0fr→1fr`（老）。两者并存，应统一（注意 `interpolate-size` 仅 Chrome 129+，需 fallback）。

---

## 2. P0 待办（最高优先级）

### P0-AI · AI 消息流（`message.tsx`）

- [✅] **P0-AI-1 消息加 provider avatar**
  - 文件：`message.tsx:38-62`、`styles.css:309`
  - 问题：AI 消息无容器无头像，用户分不清"哪段是 AI 说的"。
  - 改进：左侧 28px 彩色 avatar（Codex 橙、Claude 紫），8px 间距，作段落视觉锚。

- [✅] **P0-AI-2 流式光标现代化**
  - 文件：`styles.css:332-336`
  - 问题：`width:2px` 方块 + `steps(2, start)` 硬开关闪烁，位置随 last-child 跳。
  - 改进：smooth pulse（`opacity 0.4→1→0.4`）+ `box-shadow: 0 0 8px accent` glow。

- [✅] **P0-AI-3 streaming 结束过渡**
  - 文件：`message.tsx:41-44`、`styles.css`
  - 问题：streaming→落定瞬间，rehype-highlight 重新建节点，光标突然消失、markdown 闪烁一帧白屏。
  - 改进：加 120ms opacity 交叉淡入。

- [✅] **P0-AI-4 message actions 加过渡 + 触屏常驻**
  - 文件：`styles.css:305-306, 351-362`
  - 问题：`opacity:0→1` 无 transition（瞬间出现）；触屏无 hover，actions 永远不可达。
  - 改进：加 `transition: opacity 140ms`；移动端 actions 常驻 `opacity:.5`。

### P0-TOOL · 工具调用与命令终端（`tool.tsx`）

- [✅] **P0-TOOL-1 命令终端加 macOS titlebar**
  - 文件：`tool.tsx:222-234`、`ai-console.css:500-524`
  - 问题：`.command-terminal` 只是灰盒 + `<pre>`，无视觉信号说"这是终端"。
  - 改进：顶部 28px bar——左侧 3 个 12px traffic-light 圆点，中间 shell 名（bash/zsh），右侧 exit code badge（绿 0 / 红非 0）。

- [✅] **P0-TOOL-2 stdout/stderr 分流着色**
  - 文件：`tool.tsx:260-276`（`collectStreams` 把 stdout/stderr join 成一个字符串）
  - 问题：错误信息淹没在正常输出里，**严重可用性问题**。
  - 改进：stdout 用 `--green-tint` 前景、stderr 用 `--red-tint` 前景，按行渲染；或分两个区段。

- [✅] **P0-TOOL-3 命令行 vs 输出区分**
  - 文件：`tool.tsx:212`（`$ ${invocation}` 写在 `<pre>` 里）
  - 问题：命令和输出同色同字体。
  - 改进：命令行 accent 色 + bold，输出常规色。

- [✅] **P0-TOOL-4 exit code 非零红色 badge**
  - 文件：`tool.tsx:225`
  - 问题：exit code 是 header 右侧小灰字，扫读不到。
  - 改进：非 0 时红色 badge 放显眼位置。

- [✅] **P0-TOOL-5 `<pre>` 改 `pre`（不换行）+ 横向滚**
  - 文件：`styles.css` `.tool-event pre`（`white-space: pre-wrap`）
  - 问题：长行换行破坏终端列对齐。
  - 改进：`white-space: pre` + `overflow-x: auto`，保留终端原始排版。

### P0-APPROVAL · 审批交互（`approval.tsx`）

- [✅] **P0-APR-1 按钮语义色纠正**
  - 文件：`ai-console.css:668-699`
  - 问题：Decline 灰色（像"取消"）、Allow 蓝色（和发送撞色）、Accept-session 透明（藏在折叠里却最危险）。
  - 改进：Decline → 红色 destructive ghost；Allow → 绿色（通过语义）；Accept-session → 加更强警告视觉。

- [✅] **P0-APR-2 按钮加 hover lift**
  - 文件：`ai-console.css:650-699`
  - 问题：hover 只改背景色，无物理反馈。
  - 改进：`translateY(-1px)` + shadow。

- [✅] **P0-APR-3 命令完整可滚 + 危险词着色**
  - 文件：`approval.tsx:33,44`、`ai-console.css:605-613`
  - 问题：`approval-bar-cmd` 用 `text-overflow: ellipsis`，`rm -rf node_modules && npm install && npm test` 被截断后正好藏了危险部分。
  - 改进：`white-space: nowrap; overflow-x: auto`，命令完整可滚；`rm/sudo/>` 等危险词红色高亮。

- [✅] **P0-APR-4 审批不占 composer 空间**
  - 文件：`composer.tsx:329-344`、`ai-console.css:548-556`
  - 问题：审批卡渲染在输入框上方，出现时挤压 draft、跳动遮挡。
  - 改进：改为顶部 sticky banner 或 modal/overlay，不占 composer 空间。

- [✅] **P0-APR-5 busy 态覆盖所有按钮**
  - 文件：`approval.tsx:16-29, 61-72`
  - 问题：Decline 点击后无 loading 反馈（只有 Allow 有 `LoaderCircle`）。
  - 改进：所有按钮 busy 态统一。

- [✅] **P0-APR-6 `aria-live` 改 polite**
  - 文件：`composer.tsx:330`
  - 问题：`assertive` 会打断屏幕阅读器当前朗读。
  - 改进：改 `polite`。

### P0-COMPOSER · 输入框（`composer.tsx`）

- [✅] **P0-CMP-1 textarea 浮动卡片化**
  - 文件：`styles.css:953`、`ai-console.css:797-810`
  - 问题：2015 风格 `1px border + 7px radius`，无阴影无层次。
  - 改进：`border-radius: 16px; box-shadow: var(--shadow-card); padding: 14px 16px`，聚焦 `border-color: accent + 3px ring`。

- [✅] **P0-CMP-2 发送按钮内嵌右下角**
  - 文件：`composer.tsx:412-419`、`styles.css`
  - 问题：发送按钮在 textarea 外部下方。
  - 改进：40px 圆形 accent 实心，`ArrowUp` icon，内嵌 textarea 右下角，disabled 时灰。

- [✅] **P0-CMP-3 原生 select 自定义化**
  - 文件：`composer.tsx:299-310`
  - 问题：浏览器默认 `<select>` 与自定义 UI 极不协调。
  - 改进：自定义 segmented control 或顶部胶囊 chip（点击展开下拉）。

### P0-DIFF · 文件变更（`diff.tsx`）

- [✅] **P0-DIFF-1 patch 行级着色**
  - 文件：`diff.tsx:52`（`<pre>{file.patch}</pre>` 裸 diff 文本）
  - 问题：无 `+`/`-` 行着色！绿色加 / 红色删是 diff 基本契约（GitHub 1998 年就这样）。
  - 改进：解析 patch 按行渲染——`+` 行 `background: color-mix(var(--green) 8%)`、`-` 行 `color-mix(var(--red) 8%)`，配行号 grid。

- [✅] **P0-DIFF-2 文件类型 icon**
  - 文件：`diff.tsx:42-44`
  - 问题：header 是 `<code>{path}</code>` + 状态文字，无文件类型 icon。
  - 改进：按 extension 区分（复用 `composer-suggestion-menu.tsx:152` 的 `fileIcon` 逻辑 + 彩色 token）。

---

### P0-CONTENT-OVERFLOW · 动态内容撑爆界面（跨组件专项）

> **这是一类系统性问题，不止思考过程**：凡是 AI / 工具流式或批量产出的长内容，如果不主动限高 + 提供逃逸路径，就会一路向下撑爆时间线 / composer / 面板。思考过程（见 `P1-REASONING`）只是最典型的一例。
>
> **统一原则（"脚注优于正文"）：** 任何可能无限增长的动态内容，视觉权重都该是"脚注"而非"正文"——默认退到背景（限高 / 路标 / 折叠），需要时一键拉到前台（展开 / 独立面板 / 搜索）。具体三步：
> 1. **硬限高**（`max-height` + `overflow:auto`）——防止撑爆；
> 2. **渐变遮罩**——暗示"还有内容"，避免突然截断；
> 3. **逃逸路径**（展开全文 / 跳独立面板 / ⌘F 搜索）——需要时能拉出来。
>
> 以下 7 处现状对照该原则审查：

- [✅] **P0-OFL-1 工具输出 `ChunkedText` 无进度 / 无总量反馈**
  - 文件：`tool.tsx:167-177`、`OUTPUT_CHUNK_SIZE = 8_000`
  - 现状：`pre` 有 `max-height: 360px; overflow: auto`（`styles.css:521`），分块 +8000 字符按钮。
  - 问题：分块按钮只说"加载更多"，**不告诉用户总量**（"已显示 8000 / 48000 字符"）；用户不知道还要点几次、何时到头；且每次点击 +8000 会把已渲染内容撑得很大。
  - 改进：① 按钮显示 `加载更多（已 8000 / 共 48000 字符）`；② 提供"全部展开"一键到底；③ 超过阈值（如 50KB）时引导"输出过长，建议 ⌘F 搜索或下载完整日志"。

- [✅] **P0-OFL-2 长工具输出无 in-output 搜索**
  - 文件：`tool.tsx:179-234`（`ToolResultTerminal`）
  - 问题：stdout 几千行（如 `npm install`、`grep -r`），找一行 error 要肉眼滚。这是"逃逸路径"缺失。
  - 改进：输出区加 ⌘F 触发的 in-output 搜索栏（参考 Warp / Wave Terminal），高亮匹配行 + 上/下跳转 + 计数。

- [✅] **P0-OFL-3 变更 patch `<pre>` 限高但无展开/搜索**
  - 文件：`diff.tsx:52`（`<pre>{file.patch}</pre>`）、`styles.css:598`（`max-height: 260px`）
  - 现状：单个文件 patch 限高 260px 可滚。
  - 问题：**多文件 patch 纵向堆叠**（一个 change-trace-card 内 N 个 `.change-file-card`，每个 260px），N=10 时整卡 2600px+；patch 内无 `+`/`-` 着色（见 P0-DIFF-1）；长 patch 无搜索。
  - 改进：① 多文件用**虚拟列表**（只渲染视口内文件卡）；② 单 patch 超 50 行时折叠为"展开 312 行"按钮；③ 配合 P0-DIFF-1 的行级着色后，错误行（含 `error/exception`）可一键跳转。

- [✅] **P0-OFL-4 AI 回复代码块无限高**
  - 文件：`message.tsx:178-181`（`MarkdownPre`）、`styles.css:207`（`.chat-markdown pre { overflow: auto }` **无 max-height**）、`styles.css:376-377`（`.markdown-code-block`）
  - 问题：AI 贴一个 500 行的代码块，整块平铺撑爆时间线；只有复制按钮，无折叠 / 无行号 / 无语言标签 / 无限高。
  - 改进：① `.chat-markdown pre` 加 `max-height: 480px`（约 30 行），超过则渐变遮罩 + "展开全部 N 行" 按钮；② 加 macOS 风格 titlebar（语言标签 + 复制 + 行数）；③ 折叠态只显前 30 行 + 渐变遮罩。

- [✅] **P0-OFL-5 `sent-contexts` / 已发送上下文列表无限高**
  - 文件：`message.tsx:121-133`（`SentContexts`）、`styles.css:383-386`
  - 现状：展开后每个 context 一个 grid row，`padding: 5px 0`，**无 max-height、无滚动**。
  - 问题：用户一次拖入 20 个文件 / 粘贴大段引用作为 context，展开后这条消息的 context 列表无限长。
  - 改进：`.sent-contexts .ui-disclosure-content-inner` 加 `max-height: 240px; overflow:auto`；列表项超过 8 个时 summary 显示"使用了 20 个上下文"（已有，但内部需限高）。

- [✅] **P0-OFL-6 审批详情 `approval-detail-pre` / paths / risks 堆叠**
  - 文件：`approval.tsx:96-108`、`ai-console.css:809`（`approval-detail-pre` 有 `max-height` 但 paths 与 risks 区段无独立限高）
  - 现状：`approval-detail-pre` 单段限高；但 `.approval-detail-risks` ul（`ai-console.css:834`）**无限高**；多 path 用一个 `<pre>` join（`approval.tsx:99`），100 个 path 时撑爆面板。
  - 问题：长命令 + 多 path + 多 risk 三段叠加，详情面板 `max-height: min(260px, 36vh)`（`ai-console.css:707`）整体限高了，但内部各段无独立折叠，长 path 列表会把 risk 挤出视口。
  - 改进：paths / risks 各自 `max-height: 120px; overflow:auto`；超 5 条时折叠为"显示全部 N 条"。

- [✅] **P0-OFL-7 `composer-approvals` 多审批堆叠 + context-tray 横向溢出**
  - 文件：`composer.tsx:329-344`、`ai-console.css:618`（`composer-approvals` 有 `max-height: min(420px, 46vh)` ✓）、`styles.css:965`（`.context-chips { overflow-x: auto }` ✓）
  - 现状：审批容器整体限高 ✓；context chips 横向滚动 ✓——**这两处已做对了**，列为正面参照。
  - 残留问题：① 多审批是列表堆叠，无批量操作（见 P1-APR-4）；② `context-chips` 横向滚无"还有 N 个被滚出"的视觉提示，用户不知道左边还有 chip。
  - 改进：context-tray 左右两端加渐变遮罩暗示可滚 + 显示总数 badge `12 个上下文`。

#### 正面参照（已做对的）

下列容器已正确应用"限高 + 滚动"，可作为其他场景的实现模板：
- `.reasoning-content { max-height: 320px; overflow: auto }`（`styles.css:573`）
- `.command-terminal pre { max-height: 300px }`（`ai-console.css:513`）
- `.composer-approvals { max-height: min(420px, 46vh); overflow-y: auto }`（`ai-console.css:618`）
- `.context-chips { overflow-x: auto }`（`styles.css:965`）
- `.approval-detail-panel { max-height: min(260px, 36vh); overflow-y: auto }`（`ai-console.css:707`）

#### 统一实现建议（"标准溢出容器"组件）

建议抽一个 `<OverflowBox>` 组件统一这 7 处 + 思考面板：
```
props: maxHeight, showCount, searchable, expandLabel
渲染: <div class="overflow-box">
        <div class="overflow-box-content">{children}</div>   // max-height + 渐变遮罩
        <footer>                                              // 可选
          <button>展开全文（{count}）</button>
          <button>⌘F 搜索</button>
        </footer>
      </div>
```
一处实现，所有"动态长内容"场景复用，保证体验一致。

### P0-BUBBLE · 消息气泡（`styles.css`）

- [✅] **P0-BUB-1 用户气泡圆角升级**
  - 文件：`styles.css:307`（`border-radius: 8px 8px 2px 8px` 的"小尖角"）
  - 问题：2015 年 WhatsApp 早期模仿尾巴。
  - 改进：`border-radius: 16px 16px 4px 16px`，padding `12px 16px`，去 border 改 `background: var(--accent-tint)`。

- [✅] **P0-BUB-2 删除全大写 meta**
  - 文件：`styles.css:160, 300`（`text-transform: uppercase; letter-spacing: .06em/.12em`）
  - 问题：所有 label 当"章节标题"处理，视觉太"硬"。
  - 改进：改 `font-size: 12px; font-weight: 500; color: var(--muted)` 的 chip。

---

## 3. P1 待办

### P1-TOOL · 工具卡状态与折叠

- [✅] **P1-TOOL-1 running 卡片加脉冲 stripe**
  - 文件：`styles.css:502-504`
  - 问题：running 只 border 变 `#4e5d4d`（暗绿），长列表扫一眼找不到"正在跑的"。
  - 改进：左侧 3px 脉冲 stripe 或整卡 `box-shadow` glow。

- [✅] **P1-TOOL-2 cancelled 视觉明确化**
  - 文件：`styles.css:505-507`
  - 问题：cancelled 和 completed 几乎一样（都灰边框）。
  - 改进：删除线/灰化 icon + "已取消"明确文字。

- [✅] **P1-TOOL-3 折叠态加 accent stripe 锚点 + chevron spring**
  - 文件：`styles.css:484-498`
  - 问题：hover 只轻微变色，用户不知道"点哪里展开"；展开后无"我现在打开的"视觉锚；chevron 旋转无 spring。
  - 改进：hover 时 chevron 提前旋转 10° + 卡片左侧 accent stripe 预告；`data-open` 时 border 变 accent、shadow 抬升一层；chevron 用 `cubic-bezier(.34,1.56,.64,1)`。

- [✅] **P1-TOOL-4 running 计时实时化**
  - 文件：`tool.tsx:150-158`
  - 问题：`useLiveNow` 每秒 tick，但卡片折叠时用户看不到耗时增长。
  - 改进：折叠态 summary 也显示 elapsed。

### P1-PROCESS · 命令分组与 CompletedProcess

- [✅] **P1-PRC-1 CompletedProcess 加执行摘要**
  - 文件：`Chat.tsx:369-392`
  - 问题：summary 只有"已处理 · 12s"，无"3 个命令、改 2 个文件"。`summarizeTrace`/`traceSummaryText` 已存在但未用。
  - 改进：summary 显示 trace 摘要。

- [✅] **P1-PRC-2 用户可控折叠偏好**
  - 文件：`Chat.tsx:251-307`（`foldAnsweredSteps` 全自动折叠）
  - 问题：回答一出现工具调用瞬间收进"已处理"，用户无控制。
  - 改进：加"保持展开"偏好或手动展开后不自动收回。

- [✅] **P1-PRC-3 CommandGroup 改手风琴为多开**
  - 文件：`tool.tsx:25-63`（`expandedKey` 同时只展开一个 call）
  - 问题：想对比两个命令输出时做不到。
  - 改进：允许多开。

### P1-APPROVAL · 审批补全

- [✅] **P1-APR-1 详情面板收起动画**
  - 文件：`approval.tsx:76-121`、`ai-console.css:715-718`
  - 问题：进场有 `approval-detail-in`，收起直接卸载无动画。
  - 改进：用 `AnimatedDisclosure` 或 `useExitPresence` 补退场。

- [✅] **P1-APR-2 按钮间距防误触**
  - 文件：`ai-console.css:555, 643-648`
  - 问题："详情/拒绝/允许"在同一 flex row，间距 6px，触屏易误触。
  - 改进：扩大间距或分组（主操作和次操作分隔）。

- [✅] **P1-APR-3 决策后 toast + undo**
  - 文件：`approval.tsx:16-29`
  - 问题：点"允许"后卡片直接消失，无确认，点错无法撤销。
  - 改进：toast "已允许：npm test" + 5s undo 窗口。

- [✅] **P1-APR-4 批量审批**
  - 文件：`composer.tsx:329-344`
  - 问题：多审批堆叠，无"全部允许/全部拒绝"。
  - 改进：加批量操作。

- [✅] **P1-APR-5 决策历史加痕迹**
  - 文件：`approval.tsx:128-140`（`ApprovalDecisionEvent`）
  - 问题：决策后只留 11px 灰字一行，淹没在消息流；失败的审批无回溯痕迹。
  - 改进：拒绝的决策用更明显视觉（橙色/红色左 stripe）。

### P1-CHAT · 对话流容器

- [✅] **P1-CHAT-1 EmptyChat 改示例卡片网格**
  - 文件：`Chat.tsx:358-367`
  - 问题：一个 `Bot size={30}` 灰 icon + 标题 + 两行说明，缺乏吸引力。
  - 改进：欢迎 + 3–4 张可点击示例 prompt 卡片（参考 ChatGPT 空状态）。

- [✅] **P1-CHAT-2 jump-bottom 改悬浮 FAB + unread 红点**
  - 文件：`Chat.tsx:193-200`、`styles.css`（`.jump-bottom`）
  - 问题：普通 button，无 unread 强调，无阴影 elevation。
  - 改进：圆形 40px FAB + unread count 红点徽章 + `var(--shadow-card)`。

### P1-SESSION · 会话列表

- [✅] **P1-SES-1 字号放大**
  - 文件：`ai-console.css:1396-1401`
  - 问题：title `11px`、meta `9px`，把 sidebar 当 spreadsheet。
  - 改进：title 13px、meta 11px。

- [✅] **P1-SES-2 provider 彩色 stripe**
  - 文件：`AiWorkbench.tsx:285-368`
  - 问题：一列灰白色卡片，分不清 Codex / Claude。
  - 改进：左侧 2px provider 彩色 stripe（Codex 橙、Claude 紫）。

- [✅] **P1-SES-3 actions 精简为 overflow 菜单**
  - 文件：`AiWorkbench.tsx:360-365`
  - 问题：4 个 23px icon button（pin/rename/archive/delete）密度高易误触。
  - 改进：默认只露 pin + `⋯` overflow menu（收纳 rename/archive/delete）。

### P1-HEADER · 顶栏

- [✅] **P1-HDR-1 status 改圆点 + 脉冲**
  - 文件：`AiWorkbench.tsx:160`、`styles.css:292-294`
  - 问题：方形带边框药丸，颜色硬编码 `#3f6748/#6c5a36`。
  - 改进：8px 圆点 + running 态脉冲，配语义色 token。

- [✅] **P1-HDR-2 provider 改 segmented control + 彩色 dot**
  - 文件：`AiWorkbench.tsx:154-156`
  - 问题：eyebrow 全大写 + `·` 拼接，扫读困难。
  - 改进：segmented control 带 provider 彩色 dot。

---

## 4. P2 待办（打磨）

### P2-INTERACTION · 交互细节

- [✅] **P2-INT-1 折叠 dur 降到 200ms + 曲线分层**（见 D3）
- [✅] **P2-INT-2 长输出搜索 + 滚动按钮**
  - 文件：`tool.tsx:167-177`、`styles.css`
  - 问题：`ChunkedText` 无进度指示；长输出无搜索/回顶。
  - 改进：in-output search（参考 Warp/Wave Terminal）；"已显示 N/M 字符"进度；滚动到顶/底按钮。
- [✅] **P2-INT-3 suggestion menu scrollIntoView + 翻转**
  - 文件：`composer.tsx`、`ai-console.css:812-817`
  - 问题：active item 滚出视口时键盘选不到；menu 无 flipping，textarea 在视口顶部时被截断。
  - 改进：active item `scrollIntoView({block:'nearest'})`；引入 flipping（Radix Popper 自带逻辑）。
- [✅] **P2-INT-4 消息流 stagger 进场**
  - 文件：`styles.css:257-261`（仅 session-list 有 stagger）
  - 问题：消息流/工具卡/审批卡进场同时弹出，缺节奏感。
  - 改进：批量出现时 30ms 递增 delay。
- [✅] **P2-INT-5 退场方向感**
  - 文件：`styles.css:312-331`
  - 问题：所有项都向上淡出。
  - 改进：被取代的旧回答（rerun 后）向左滑出，被删除的才向上。

### P2-PREVIEW · 文件预览

- [✅] **P2-PRV-1 拖动 splitter 时内容不抖**
  - 文件：`ai-console.css:1282-1307`
  - 问题：`is-resizing-preview` 态两边内容都 `opacity .94 + translateX ±2px`，干扰拖动判断。
  - 改进：拖动时只高亮 splitter，内容不动。
- [✅] **P2-PRV-2 edit 模式 dirty 提示**
  - 文件：`AiWorkbench.tsx:189-224`
  - 问题：切回 preview 不问"丢弃改动吗"。
  - 改进：切模式时若有 dirty 提示确认。

### P2-THOUGHT · 推理过程

> **专项：思考过程过长（独立子方案）**
>
> **根因（三层）：**
> 1. **折叠态全文平铺**：`Chat.tsx:515-522` 的 `FoldedNarrative` 把所有 reasoning event 的 text join 后直接渲染为 `.process-narrative`，配 `ai-console.css:444-452` 的 `white-space: pre-wrap; font-size: 16px`——**无 max-height、无截断**，一段 2000 字思考就是 2000 字高度。
> 2. **展开态默认展开**：`Chat.tsx:527` `<ReasoningCard events={step.events} defaultOpen />`，`thought.tsx:28` `useState(hasContent && (streaming || defaultOpen))` 让长内容一上来就撑满 `max-height: 320px`。
> 3. **多段堆叠**：`timeline.ts:271-276` 的 `buildTraceSteps` 把连续 reasoning 合并到一个 step，但不同时间点的 reasoning 分成多个 step，每个渲染一个 `process-narrative-block`，在 CompletedProcess 里纵向叠加。
>
> **方案对比：**
>
> | 方案 | 形态 | 工作量 | 评价 |
> |---|---|---|---|
> | A 渐变遮罩 + 展开全文 | inline 限高 + 点击展开 | 小 | 治标。120px 块仍夹在主线里，打断阅读流 |
> | B 多段合并成单卡 | inline 1 张卡 | 中 | 治标。范式没变，1 张 320px 卡仍占位 |
> | **C 独立面板（终局）** | **路标 + 侧抽屉/modal** | **中大** | **治本。主线零干扰，过程信息退到背景** |
> | D 流式虚拟滚动 | 窗口式渲染尾部 | 大 | 解决性能不解决认知，是 C 的补充 |
>
> **结论：做方案 C（独立面板），它是终局形态，做完不用再迭代。**
> A/B 是过渡，做完用户还是会嫌"思考夹在中间烦"；D 是 C 在极长文本下的内部补充。

#### P1-REASONING · 推理过程独立面板（方案 C，终局）

**设计哲学**：思考的视觉权重应该是"脚注"，不是"正文"。脚注不在正文流里，需要时翻过去看。默认看不到思考是正确的——大多数场景用户只关心答案；需要回溯"AI 为什么这么决定"时，用户愿意付一次点击，这次点击换来主线阅读的彻底干净，值得。和"工具调用默认折叠"同一哲学：过程信息默认退到背景，需要时一键拉到前台。

**核心差异（vs 方案 A）**：方案 A 限高后内容仍 inline 占时间线位置，120px 渐变遮罩块打断主线阅读，即使折叠了视觉位置仍被占据。方案 C 时间线只留一行路标，展开时内容浮出来（侧抽屉/modal），**完全不占时间线高度**。

- [✅] **P1-RSN-1 折叠态：时间线里的一行路标**
  - 文件：`Chat.tsx:513-530`（`TraceStepView` reasoning 分支）、`thought.tsx`
  - 形态：与 tool call 同级视觉权重的一行
    ```
    🧠 思考过程 · 12s · 1,842 字                    点击展开 →
    ```
  - 要点：
    - 左侧 shimmer icon（流式时脉冲、落定后静止）
    - 中间 elapsed + 字数（给"AI 认真想了"的反馈）
    - 右侧"展开"提示
    - **不渲染任何思考正文**，纯路标

- [✅] **P1-RSN-2 展开态：独立面板（侧抽屉 / modal）**
  - 文件：新增 reasoning panel 组件；复用 `AiWorkbench.tsx` 的 `ColumnSplitter` 机制
  - 形态二选一：
    - **右侧抽屉（推荐）**：从右侧滑入，宽度 480px，内部自由滚动，支持 ⌘F 搜索。复用文件预览的 splitter 基建。
    - **居中 modal**：工作区窄时全屏 modal，阅读体验更好。
  - 要点：
    - 面板内部走 markdown 渲染（解决 P2-THT-1）
    - 极长文本（>10000 字）面板内部用虚拟滚动（方案 D 作为 C 的内部补充）
    - 多段 reasoning 在面板内用章节标题分段（吸收方案 B 的优点）
    - Esc / 点外面 / 关闭按钮 收起

- [✅] **P1-RSN-3 流式特例：peek 预览**
  - 文件：`thought.tsx`
  - 形态：AI 正在思考时，默认仍是紧凑 shimmer 行（不强制看），但 hover 时临时浮一个气泡显示当前正在生成的最后 3–4 行，移开就消失。
  - 要点：满足窥探欲，但不持久占位；落定后气泡消失，路标变为"展开 →"。

#### P2-THOUGHT · 推理过程其他打磨（方案 C 之外的细节）

- [✅] **P2-THT-1 reasoning 走 markdown 渲染**
  - 文件：`thought.tsx:67`（`<div className="reasoning-content">{content}</div>` 纯文本）
  - 问题：思考常含列表/代码/公式，纯文本丢结构。
  - 改进：走 `chat-markdown` 同款 pipeline（方案 C 面板内部也需要这个）。
- [✅] **P2-THT-2 pending 加 elapsed timer**
  - 文件：`thought.tsx:42-50`
  - 问题：pending 只有"Thinking..."+ 旋转 icon，无进度感。
  - 改进："思考中 · 12s"（方案 C 路标也需要这个 elapsed）。
- [✅] **P2-THT-3 替换三点为 shimmer 文本流**
  - 文件：`thought.tsx:73-75`、`styles.css:459-462`
  - 问题：三个点动画是 2010 年 loading 模式。
  - 改进：流式 reasoning 带 fade-in bottom 边缘的 shimmer（方案 C 路标的 shimmer icon 复用）。
- [✅] **P2-THT-4 展开态默认收起 + 流式结束自动收起**
  - 文件：`Chat.tsx:527`（去 `defaultOpen`）、`thought.tsx:30-32`（补 streaming 结束自动收起的 effect）
  - 问题：当前 `defaultOpen=true` 让长内容一上来撑满 320px；`thought.tsx` 缺"streaming 结束后自动收起"。
  - 改进：方案 C 落地后此条自动满足（路标默认就是收起的）；过渡期可先去掉 `defaultOpen` 并补 effect。

### P2-CONTEXT · 上下文附件

- [✅] **P2-CTX-1 inline style 抽离到 class**
  - 文件：`composer.tsx:518-621`（lightbox 大量 inline style，硬编码 `rgba(0,0,0,.82/.6)`）
  - 问题：技术债，无法适配 dark mode / 主题切换。
  - 改进：抽 `lightbox-close-btn` / `lightbox-nav-btn` 等 class。
- [✅] **P2-CTX-2 图片 chip hover 放大 + tooltip**
  - 文件：`composer.tsx:518-521`
  - 问题：44x44 方块，hover 无反馈。
  - 改进：`transform: scale(1.05)` + shadow + 文件名 tooltip。

### P2-COMPOSER · 输入框打磨

- [✅] **P2-CMP-1 token / 字符计数**
  - 文件：`composer.tsx`
  - 问题：用户不知还剩多少 context。
  - 改进：底部状态栏 `⌘↵ 发送 · / 技能 · {n} tokens`。
- [✅] **P2-CMP-2 首次空状态 prompt 提示**
  - 文件：`composer.tsx:345-388`
  - 问题：`/ skill`、`@ file` 快捷键散在 11px 灰字，首次用户不知道。
  - 改进：空 draft 时 textarea 内显示 chip 提示，输入后消失。
- [✅] **P2-CMP-3 textarea 到底渐变遮罩**
  - 文件：`composer.tsx:134-139`
  - 问题：到 230px 停止增长出现滚动条，无视觉提示"现在内部滚动了"。
  - 改进：到底时加 fade-out 渐变遮罩。

### P2-EMPTY · 空状态与系统事件

- [✅] **P2-EVT-1 ErrorEvent 加红色 stripe + icon 背景**
  - 文件：`events.tsx:26-51`、`styles.css`
  - 问题：错误内容是温和的 `tone="error"`，视觉重量不足。
  - 改进：红色左 stripe + 红 icon 背景强调。
- [✅] **P2-SUG-1 suggestion active 项加左侧 stripe**
  - 文件：`ai-console.css:899-910`
  - 问题：active 只是浅蓝底 + border，"被选中"反馈弱。
  - 改进：`box-shadow: inset 2px 0 0 var(--accent)`。

---

## 5. 组件索引（按文件）

| 组件 | 文件 | 关键问题编号 |
|---|---|---|
| AiWorkbench | `AiWorkbench.tsx` | P1-HDR-1/2, P1-SES-1/2/3, P2-PRV-1/2 |
| Chat | `Chat.tsx` | P1-CHAT-1/2, P1-PRC-1/2 |
| composer | `composer.tsx` | P0-CMP-1/2/3, P0-APR-4/6, P1-APR-4, P2-CMP-1/2/3, P2-CTX-1/2, P2-INT-3 |
| message | `message.tsx` | P0-AI-1/2/3/4, P0-BUB-2 |
| tool | `tool.tsx` | P0-TOOL-1/2/3/4/5, P1-TOOL-1/2/3/4, P1-PRC-3, P2-INT-2, **P0-OFL-1/2** |
| approval | `approval.tsx` | P0-APR-1/2/3/5, P1-APR-1/2/3/5, **P0-OFL-6** |
| thought | `thought.tsx` | P1-REASONING (C 方案), P2-THT-1/2/3/4 |
| Chat（TraceStepView reasoning 分支） | `Chat.tsx:513-530` | P1-RSN-1, P2-THT-4 |
| diff | `diff.tsx` | P0-DIFF-1/2, **P0-OFL-3** |
| message（MarkdownPre / SentContexts） | `message.tsx:178-181, 121-133` | **P0-OFL-4/5** |
| composer（context-tray / approvals） | `composer.tsx:329-344, 427+` | P0-APR-4/6, **P0-OFL-7** |
| events | `events.tsx` | P2-EVT-1 |
| conversation-cell | `conversation-cell.tsx` | （抽象良好，无重大问题） |
| composer-suggestion-menu | `composer-suggestion-menu.tsx` | P2-SUG-1 |
| file-preview-context | `file-preview-context.tsx` | （无 UI 问题） |
| timeline | `timeline.ts` | P1-PRC-1（用现成 summarize 函数） |
| 设计 token | `styles.css` | A1/2/3, B1/2, C1/2, D1/2/3, E1 |
| ai-console.css | `styles/features/ai-console.css` | 多项 |
| final-polish.css | `styles/final-polish.css:153` | E1, D3 |

---

## 6. 建议落地顺序

| 批次 | 内容 | 预期收益 |
|---|---|---|
| **批次 1** | P0-APR（审批交互全量） | 安全风险最高，改完即像现代 IDE |
| **批次 2** | P0-TOOL（终端 + stdout/stderr 分流） | 视觉冲击最大，核心可用性 |
| **批次 2.5** | **P0-OFL（动态内容溢出专项）+ 抽 `<OverflowBox>` 组件** | **系统性解决"撑爆界面"，7 处一次性收口** |
| **批次 3** | P0-CMP + P0-BUB + P0-AI | 输入与对话区全面现代化 |
| **批次 4** | P0-DIFF + 全局 token（A/B/C/D） | 基线统一 |
| **批次 5** | P1 全量（含 P1-REASONING 独立面板） | 状态/折叠/列表细节 |
| **批次 6** | P2 全量 | 打磨 |

> 每批可独立 PR，互不阻塞。建议每批落地后跑一次 `desktop-app` 的视觉回归（如有）或手动截图对比。
