# AI Conversation UI Redesign Plan

Date: 2026-06-18

## 修正方向

这版计划以 `AI Conversation` 本身为核心，不再把“运行轨迹”作为用户需要阅读和理解的一级 UI。

目标是让桌面端的对话展示和 Codex 的 transcript 体验对齐：用户看到的是一串语义清晰的 conversation cells，每个 cell 代表一种真实对话事件：

- 用户消息
- AI 普通消息或过程说明
- thought / reasoning summary
- tool call
- tool name / tool arguments
- approval / user input blocking state
- 最终结果

内部仍然可以使用 `timeline.ts` 做事件归组、状态推导和数据整理，但 UI 文案、布局和交互不能让用户感觉自己在看一个调试器或运行日志。

## 结论

第一阶段不要重做 provider 协议，也不要把右侧 inspector 做成主体验。应该先把 conversation pane 的展示模型改成 Codex 风格的连续 transcript：

1. `UserMessageCell`
2. `AssistantMessageCell`
3. `ThoughtSummaryCell`
4. `ToolCallCell`
5. `ApprovalCell`
6. `FinalAnswerCell`

这些 cell 在主对话流里按实际发生顺序出现。每个 cell 都有一致的 header、状态、展开/折叠、复制、跳转和详情查看能力。最终回复必须比过程消息更突出，但仍然留在同一个 conversation 流里。

## 相关文件

Desktop app target:

- `desktop-app/renderer/src/features/ai-console/Chat.tsx`
- `desktop-app/renderer/src/features/ai-console/message.tsx`
- `desktop-app/renderer/src/features/ai-console/tool.tsx`
- `desktop-app/renderer/src/features/ai-console/thought.tsx`
- `desktop-app/renderer/src/features/ai-console/timeline.ts`
- `desktop-app/renderer/src/features/ai-console/approval.tsx`
- `desktop-app/renderer/src/features/ai-console/diff.tsx`
- `desktop-app/renderer/src/features/ai-console/types.ts`
- `desktop-app/renderer/src/features/ai-console/AiWorkbench.tsx`
- `desktop-app/renderer/src/styles/components.css`
- `desktop-app/renderer/src/styles/product.css`
- `desktop-app/renderer/src/styles/responsive.css`
- `desktop-app/electron/ai/providers/codex-app-server.ts`
- `desktop-app/electron/ai/providers/types.ts`
- `desktop-app/shared/contracts.ts`

Codex reference:

- `/home/say/work/github/codex/codex-rs/tui/src/chatwidget/protocol.rs`
- `/home/say/work/github/codex/codex-rs/tui/src/chatwidget/streaming.rs`
- `/home/say/work/github/codex/codex-rs/tui/src/chatwidget/command_lifecycle.rs`
- `/home/say/work/github/codex/codex-rs/tui/src/chatwidget/tool_lifecycle.rs`
- `/home/say/work/github/codex/codex-rs/tui/src/history_cell/mod.rs`
- `/home/say/work/github/codex/codex-rs/tui/src/history_cell/messages.rs`
- `/home/say/work/github/codex/codex-rs/tui/src/history_cell/mcp.rs`
- `/home/say/work/github/codex/codex-rs/tui/src/exec_cell/render.rs`
- `/home/say/work/github/codex/codex-rs/app-server-protocol/src/protocol/v2/item.rs`

## Codex 对齐点

Codex 的核心不是“把执行过程包装成一块面板”，而是把所有事件放进同一条 transcript。

值得对齐的逻辑：

- 用户消息是一类独立 cell，不和执行状态混在一起。
- assistant streaming 是临时态，完成后合并成稳定的 assistant message。
- reasoning 只展示 summary，不和最终回复混用。
- command / MCP / web / patch 等工具是独立 history cell，不挂在 thought 下面。
- approval 是阻塞型交互，必须出现在对话流中用户能看到的位置。
- final answer 是 assistant message 的特殊阶段，需要在视觉上与中间说明区分。
- 完成后的过程 cell 会沉淀成简短历史记录，不继续占用主阅读流。

Codex 代码层面的校准：

- `HistoryCell` 是 transcript 的基本单位；user、assistant、reasoning、exec、MCP、web search 都是同一条 transcript 里的兄弟 cell。
- `ReasoningSummaryCell` 使用 `•` 前缀和 dim/italic 样式，说明它比 assistant/final answer 低一层，但不是 tool 的父节点。
- reasoning delta 运行时主要更新 status/header，不直接把完整 thought 流刷进历史；reasoning final 后才插入 summary cell。
- `ExecCell` / `McpToolCallCell` 在 Codex TUI 中会显示少量截断输出，这是终端里的可用性取舍；桌面端这版不照搬输出预览，主对话只展示工具名和参数。
- command/MCP/web/patch 完成后都会 flush 成历史 cell；桌面端应进一步折叠 completed thought/tool，只保留一行可扫描摘要。

不需要照搬的点：

- 不照搬终端里的 `•`、`›` 作为桌面主视觉。
- 不让所有 cell 长得几乎一样。
- 不把 stdout/stderr、tool output、error body、diff、raw JSON 放进主对话 tool block。
- 不把内部事件名暴露给普通用户。

## 当前桌面端问题

当前 desktop app 已经有足够的数据事件：

- `user-message`
- `assistant-message`
- `assistant-delta`
- `reasoning-delta`
- `reasoning-summary`
- `tool-start`
- `tool-output`
- `tool-complete`
- `approval-request`
- `approval-decision`
- `status`
- `usage`
- `changes`
- `risk`
- `error`
- `system`

主要问题不是事件不够，而是展示层把“过程归组”放得太重，导致用户需要先理解一个执行容器，再去找真正关心的消息、工具、thought 和最终结果。

具体问题：

- 用户消息、AI 消息、工具、thought、结果的视觉层级不统一。
- 最终结果没有成为清晰的结束节点。
- assistant streaming 容易像一个漂浮在底部的临时块，而不是当前 conversation 的自然延续。
- tool call 的名称、参数、状态没有形成统一规则。
- thought / reasoning summary 容易和 AI 普通消息混淆。
- approval 虽然能操作，但在 conversation 里的阻塞感不够强。
- 右侧 inspector 和主对话的职责边界不够清晰。

## 产品目标

主目标：

- 用户一眼能区分：我说了什么、AI 正在说什么、AI 想了什么、AI 调了什么工具、工具参数是什么、最后结论是什么。
- 和 Codex transcript 对齐：事件按时间进入主对话流，而不是要求用户打开某个执行面板。
- 工具默认摘要化，展开后只检查调用参数，不在主对话看 output/error/diff/raw。
- thought 默认是摘要，不暗示展示了完整隐藏推理。
- 最终回复在主对话流中显著收束。
- approval / user input 是主对话里的强阻塞 cell。
- 保留现有 Claude / Codex provider 兼容。

非目标：

- 第一阶段不重写 provider 执行逻辑。
- 第一阶段不引入新的复杂事件协议。
- 不把 conversation pane 做成日志查看器。
- 不在主对话里默认展示完整技术日志。
- 不做营销式聊天 UI。

## 新信息架构

用户看到的主结构应是：

```text
UserMessageCell
AssistantMessageCell?        // commentary/progress, only when useful
ThoughtSummaryCell?          // reasoning summary / plan summary
ToolCallCell*
ApprovalCell?
ToolCallCell*
FinalAnswerCell
ChangedFilesCell?            // compact result artifact, only when relevant
TurnErrorCell?               // whole-turn failure artifact, only when relevant
```

这些 cell 共享一套 conversation chrome：

- 左侧或顶部有稳定身份标识：User、Codex、Thought、Tool、Approval、Result。
- 每个 cell 有自己的状态：running、success、failed、waiting、cancelled。
- 过程型 cell 可以折叠，消息型 cell 默认展开。
- 细节型内容进入展开区或 inspector，不挤占主阅读流。
- 同一轮对话可以有轻量分组线，但不能包装成需要阅读的“运行模块”。
- Thought 和 Tool 是同一级过程 cell：同一条 conversation rail、同一左边界、同一间距体系；Tool 不是 Thought 的子节点，Thought 也不是 Tool 的说明块。
- AI 完成后，Thought 和 Tool 默认折叠成一行历史摘要；只有 running、pending approval、failed turn 这类状态需要临时提高可见度。

## Cell 设计

### 1. UserMessageCell

用途：展示用户输入，是每一轮 conversation 的起点。

默认展示：

- 用户文本
- sent context chips
- cwd / selected session / provider metadata，只在有实际价值时展示
- 时间或相对时间

交互：

- copy
- quote
- edit and resend
- branch from here
- rerun from here

视觉要求：

- 比工具和 thought 更像正文消息。
- 不要做成气泡聊天风格过重的 IM UI。
- 长文本、代码块、中文英文混排必须稳定换行。

### 2. AssistantMessageCell

用途：展示 AI 的普通回复、过程说明或 commentary。

默认展示：

- provider label：Codex / Claude Code
- 状态：正在回复 / 已回复
- markdown body
- copy / quote / branch / rerun actions

规则：

- 如果是最终结果，使用 `FinalAnswerCell` 的视觉样式。
- 如果只是过程说明，保持轻量，不和最终结果争夺注意力。
- streaming 时保留稳定最小高度，避免内容跳动。

### 3. ThoughtSummaryCell

用途：展示可见的 reasoning summary、plan summary 或 provider 暴露的思路摘要。

默认展示：

- label：`Thought` 或中文 `思考摘要`
- provider-aware label：
  - Codex：`推理摘要`
  - Claude：`思考摘要` 或 `执行思路`
- 一行摘要
- running / completed 状态

展开展示：

- 完整 summary 文本
- plan steps，如果 provider 事件明确表示这是 plan

规则：

- 不展示或暗示隐藏 chain-of-thought。
- 文案里避免“完整思考过程”这类误导。
- thought cell 的视觉权重应低于最终结果，高于纯 metadata。
- 和 tool cell 视觉齐平，都是过程 cell；区别只在样式强弱和图标/label，不通过缩进表达父子关系。
- AI 执行中可以显示 running thought 摘要；AI 执行完成后默认折叠成一行，例如 `推理摘要 · 已完成`，用户主动展开才看 summary 文本。

### 4. ToolCallCell

用途：展示 AI 调用了什么工具，以及调用参数是什么。

默认摘要：

- tool category icon
- tool name
- operation summary，例如 `Run command`、`Read file`、`Search`、`Call MCP tool`
- status
- duration
- primary target：command、file path、URL、query、skill name，如果能从参数中稳定提取
- parameter preview：最多 1-2 行，只展示关键参数

展开详情：

- normalized arguments / parameters
- copy invocation
- copy parameters
- open file / reveal directory，如果参数里有本地路径

明确不在 ToolCallCell 展示：

- output
- stdout / stderr
- error body
- structured result
- diff
- raw JSON
- search inside output
- save output

Codex 对齐规则：

- shell command 对应 Codex 的 `ExecCell` 思路，但桌面端主对话只展示 command 参数，不展示命令输出。
- MCP / skill / web tool 对应 Codex 的 tool history cell，但桌面端主对话只展示 server/tool/arguments，不展示返回值。
- patch / file edit 在主对话里只展示工具名和文件参数；文件变化另由 `ChangedFilesCell` 或 diff inspector 负责。

视觉要求：

- 工具默认比最终答案弱一档。
- 多个连续工具可以形成自然连续列表，但不要套大卡片。
- 和 thought cell 齐平，都是 transcript 里的过程 cell。
- running 时展示状态和参数；completed 后默认折叠成一行，例如 `Tool · read_file · path=... · completed`。
- 不因为 tool-output 增量更新改变主对话高度。

### 5. ApprovalCell

用途：展示需要用户决策的阻塞状态。

默认展示：

- approval 类型：command / file change / network / destructive / escalation
- 风险摘要
- 请求来源
- 待执行命令或操作
- allow / allow for session / deny

规则：

- 必须出现在 conversation 当前上下文位置。
- 右侧 inspector 可以同步展示，但主对话不能只留一个弱提示。
- keyboard focus 和 screen reader label 必须清晰。
- 用户决策后，原 cell 变成 `approved` / `denied` 的历史记录。

### 6. FinalAnswerCell

用途：展示每轮 AI 的最终输出，是用户最关心的结果。

默认展示：

- label：`最终回复`
- provider
- markdown body
- copy / quote / branch / rerun
- changed files shortcut，如果本轮有文件修改
- errors or warnings shortcut，如果最终回复提到了未完成事项

视觉要求：

- 在同一 conversation 流中明显收束。
- 比普通 assistant commentary 更突出。
- 不要脱离当前轮次漂到页面底部。
- 长答案、表格、代码块必须可读。

判定规则：

- Codex payload 有 `MessagePhase::FinalAnswer` 时，直接作为最终回复。
- 如果 provider 没有 phase，但该 assistant message 是一次已完成响应的最后一条主消息，可以启发式标记为最终回复。
- streaming 期间使用 `streaming final answer` 状态，完成后合并为稳定 final answer。

### 7. ChangedFilesCell

用途：展示本轮实际产物，而不是聊天内容。

默认展示：

- changed file count
- file list preview
- open diff
- open file

规则：

- 只有存在文件修改时展示。
- 不能抢最终回复的位置。
- 细节可以交给 right inspector 或 diff panel。

### 8. TurnErrorCell

用途：展示整轮失败、取消、provider error 的收束信息。

默认展示：

- error type
- failed stage or provider
- one-line reason
- retry / copy diagnostics

规则：

- tool 内部错误不在 ToolCallCell 展示详细错误体，只给 tool cell 一个 failed 状态。
- 导致整轮失败的错误才提升成独立 `TurnErrorCell`。

## Component Plan

### 1. 新增 Conversation Cell 基础层

新增：

- `renderer/src/features/ai-console/conversation-cell.tsx`

建议导出：

- `ConversationCell`
- `ConversationCellHeader`
- `ConversationCellBody`
- `ConversationCellActions`
- `ConversationCellMeta`
- `ConversationStatusPill`
- `ExpandableCellSection`
- `ParameterPreview`

职责：

- 统一 cell 外壳、间距、图标、状态、focus、aria。
- 不感知 provider 原始事件。
- 不做业务分组。

### 2. 改造 `message.tsx`

任务：

- 将用户消息和 AI 消息接入 `ConversationCell`。
- 把 assistant label 从泛化的 `AI` 改成状态感知：
  - `Codex`
  - `Claude Code`
  - `正在回复`
  - `最终回复`
- 增加 final answer class：
  - `assistant-message--commentary`
  - `assistant-message--streaming`
  - `assistant-message--final`
- 保留 markdown cache、copy、quote、branch、rerun。

### 3. 改造 `thought.tsx`

任务：

- 将 `ReasoningCard` 改成 conversation cell 风格。
- UI label 使用 `推理摘要` / `思考摘要`，避免“完整思考”。
- running delta 显示为正在更新的 thought cell。
- completed summary 保持可折叠。
- `PlanCard` 如果是 actionable plan，可以作为 thought cell 的一个 variant。

### 4. 改造 `tool.tsx`

任务：

- 保留现有 `ToolCallCard` 能力，但外观和交互改成 `ToolCallCell`。
- 摘要行固定字段：
  - tool name
  - operation
  - primary argument / target
  - status
  - duration
  - compact parameter preview
- 展开区只显示参数：
  - normalized arguments
  - provider-specific arguments, only if normalized arguments lose useful fields
- 移除主对话 tool block 中的 output / error / diff / raw 展示入口。
- 移除 search output、load more output、save output 这类输出型交互。
- 保留 copy invocation、copy parameters、open path / reveal directory。
- 对命令、读文件、写文件、搜索、网络、skill、MCP 分别生成参数摘要。

### 5. 改造 `approval.tsx`

任务：

- 让 approval 作为 `ApprovalCell` 出现在主 conversation 中。
- pending 时视觉权重高于普通 tool cell。
- accepted / denied 后保留历史状态，不从 conversation 消失。
- inspector 可以镜像显示 pending approval，但不是唯一入口。

### 6. 调整 `timeline.ts`

保留它作为内部事件整理层，但不要让它决定用户看到“运行块”。

任务：

- 输出更接近 conversation cell 的结构：
  - `ConversationTimelineItem`
  - `UserMessageItem`
  - `AssistantMessageItem`
  - `ThoughtItem`
  - `ToolCallItem`
  - `ApprovalItem`
  - `FinalAnswerItem`
  - `ChangedFilesItem`
  - `TurnErrorItem`
- 保留现有归组函数用于 tool-output 合并、tool identity、assistant delta 合并。
- tool-output 事件只用于内部状态、diagnostics 或后续 evidence，不进入主 conversation tool block。
- 增加 `assistantPhase` 推导：
  - `commentary`
  - `final`
  - `streaming`
- 增加 `toolLifecycleStatus` 推导：
  - `queued`
  - `running`
  - `succeeded`
  - `failed`
  - `cancelled`
- 增加 `isBlocking` 推导给 approval / user-input。

### 7. 调整 `Chat.tsx`

任务：

- 主渲染改为遍历 conversation items，而不是先渲染用户消息、再渲染执行容器、再渲染答案。
- active streaming assistant text 放到当前 assistant/final answer cell。
- active reasoning delta 放到当前 thought cell。
- active tool status 放到当前 tool cell；active tool output 不渲染到主对话。
- 空工具调用不展示独立模块。
- 只在必要时展示轻量 turn separator，例如时间或 provider 切换。

### 8. 调整 `codex-app-server.ts`

任务：

- 尽量保留 Codex app-server 原始语义：
  - `itemId`
  - `turnId`
  - `phase`
  - `status`
  - `durationMs`
  - `command`
  - `cwd`
  - `exitCode`
  - `aggregatedOutput`
  - MCP server/tool/arguments/result/error
- 这些输出和结果字段只作为 provider evidence 保留，不作为 ToolCallCell 的默认 UI 内容。
- `item/agentMessage/delta` 映射为当前 assistant cell 的 streaming content。
- `item/completed` agent message 带上 `phase`，用于区分 final answer。
- reasoning summary 独立映射到 thought cell。
- dynamic tool call 也要变成稳定的 tool lifecycle item。

### 9. 合约策略

第一阶段不强制新增 event kind，优先在 payload 中增加可选字段：

- `phase`
- `itemId`
- `turnId`
- `toolStatus`
- `durationMs`
- `primaryTarget`
- `summary`
- `normalizedArguments`

如果 payload-only 后续变复杂，再考虑新增：

- `assistant-commentary`
- `assistant-final`
- `user-input-request`
- `user-input-result`

## 交互规则

### 默认展开/折叠

- 用户消息：默认展开。
- 普通 AI 消息：默认展开。
- thought：running 时显示当前摘要；AI 执行完成后默认折叠到一行。
- tool：running 时显示工具名和参数；AI 执行完成后默认折叠到一行。
- approval：pending 时默认展开，处理后折叠成历史状态。
- final answer：默认展开。
- changed files：默认折叠成产物条。

### 操作按钮

每类 cell 只展示和它有关的操作：

- message：copy、quote、branch、rerun。
- thought：copy summary、expand。
- tool：expand parameters、copy invocation、copy parameters、open path。
- approval：allow、allow session、deny。
- final answer：copy、quote、branch、rerun、open changed files。

图标使用 `lucide-react`，icon-only button 必须有 `aria-label` 和 tooltip。

### Inspector 职责

右侧 inspector 不是主叙事。它只处理：

- 当前选中 tool 的完整参数和来源 metadata。
- 当前 pending approval 的详细风险。
- changed files / diff。
- 当前 conversation item 的来源字段。

主对话必须在不打开 inspector 的情况下能看懂结果。

Tool output、error body、diff 和 raw payload 不作为普通 inspector 的默认入口；如果后续需要排障，可以放到显式开发者诊断模式，而不是主 conversation 交互。

## 视觉原则

整体风格：桌面开发工具、安静、密集、可扫描。

要求：

- 不做营销聊天 UI。
- 不做卡片套卡片。
- 不使用大面积渐变、装饰图形、泡泡背景。
- 保持已有 pane layout。
- 文字层级清晰，按钮稳定，不因 hover 或 streaming 造成布局跳动。
- 中英文、路径、命令、URL、代码块必须安全换行或在内部滚动。
- 正常文本对比度至少满足 4.5:1。
- 所有可交互元素有 `:focus-visible`。
- 支持 reduced motion。

建议语义色：

- final answer：主文本色 + 轻微强调边框或左侧标记。
- thought：muted 背景或细线标记。
- tool running：accent/cyan 小状态。
- tool success：green。
- tool failure/error：red。
- approval pending：amber/warning，但不要过度警报化。

## 实施阶段

### Phase 0: Baseline

不改行为，只做现状记录。

任务：

- 截图保存当前 AI conversation：
  - simple answer
  - thought + final answer
  - multiple tools
  - approval pending
  - failed tool
  - changed files
  - tool with long stdout/stderr events, verifying the redesigned main conversation does not show the output log
  - long Chinese/English mixed answer
- 记录当前主要 UI 问题。

验证：

- `npm run typecheck`
- `npm run visual:snapshot`

### Phase 1: Conversation Cell Shell

任务：

- 新增 `conversation-cell.tsx`。
- 给 user、assistant、thought、tool 接入统一 cell chrome。
- 不改 provider normalization。
- 不改 persisted event schema。

预期结果：

- 主对话开始像 Codex transcript，而不是多个视觉系统拼在一起。
- 用户能快速区分消息、thought、tool、结果。

验证：

- `npm run typecheck`
- `npm run build:renderer`
- 组件测试覆盖基础 cell render。

### Phase 2: Final Answer 对齐

任务：

- 在 Codex provider payload 中保留 `phase`。
- 根据 `phase` 或完成态推导 `FinalAnswerCell`。
- streaming final answer 进入同一个 final answer 位置。
- 普通 assistant commentary 和 final answer 视觉分开。

预期结果：

- 最终结果不再像普通过程消息。
- 用户能从 conversation 流里明确看到本轮结束。

验证：

- Codex simple answer。
- Codex commentary + tool + final answer。
- Claude simple answer。
- streaming 中切 session、滚动、复制仍正常。

### Phase 3: ToolCallCell 对齐

任务：

- 统一工具调用和参数摘要模型。
- 按 tool category 生成不同摘要：
  - shell command：command、cwd、sandbox/approval source
  - file read：path、range
  - file write/edit：path、operation
  - search：query、scope
  - web/network：URL、method
  - skill/MCP：server/tool、arguments summary
- 展开区只保留完整 normalized arguments。
- completed tool 默认折叠成一行；running tool 可以展开显示参数。

预期结果：

- 用户不用展开每个 tool，也能知道 AI 调用了什么工具、用了什么参数。

验证：

- 长命令。
- 搜索多结果。
- 文件修改。
- MCP/skill tool。
- failed command。

### Phase 4: Thought 和 Approval

任务：

- thought 统一成 `ThoughtSummaryCell`。
- thought 和 tool 在同一 conversation rail 上齐平展示，不互相嵌套。
- AI 执行完成后，thought 和 tool 默认折叠成一行历史摘要。
- pending approval 进入主 conversation。
- approval 决策后保留历史状态。
- request-user-input 按同一 blocking cell 模型预留。

预期结果：

- 思考摘要和最终结果不混。
- 阻塞状态清楚，用户不用在界面里找按钮。

验证：

- reasoning streaming。
- reasoning completed。
- command approval。
- file approval。
- accept / deny / accept for session。
- keyboard focus。

### Phase 5: Inspector 协同

任务：

- 点击任何 cell 可让 inspector 显示对应完整详情。
- tool cell 展开区和 inspector 只展示参数/metadata，不展示 output/error/diff/raw。
- changed files 和 diff 优先在 inspector 中处理细节。

预期结果：

- 主对话回答“发生了什么”。
- inspector 回答“这个事件的完整细节是什么”。

验证：

- inspector collapsed / expanded。
- 1280、1366、1920 宽度。
- 键盘切换 cell 和 inspector。

### Phase 6: Visual Polish

任务：

- 微调密度、边距、字体、状态色。
- 检查中英文混排、长路径、长命令。
- 检查 125% / 150% scaling。
- 检查 dark/light mode 如果当前产品支持。

验证：

- `npm run visual:snapshot`
- `npm run audit:evidence`
- `npm run scale:check`

## 测试计划

自动化：

- `npm run typecheck`
- `npm run build:renderer`
- `npm run test`
- `npm run visual:snapshot`
- `npm run audit:evidence`
- `npm run scale:check`

建议新增或更新：

- `renderer/src/components/Chat.test.tsx`
- `renderer/src/components/AiWorkbench.test.tsx`
- `renderer/src/ai-utils.test.ts`
- provider normalization tests
- conversation item derivation tests
- tool summary tests

手动场景：

- 一问一答，无工具。
- 一问一答，有 thought。
- tool-heavy conversation。
- approval pending / accepted / denied。
- tool failure 后 AI 给最终解释。
- 文件修改后展示 changed files。
- 存在长 stdout/stderr 的 run，主 conversation 不展示输出日志。
- 长 final answer，包含表格和代码块。
- 用户滚动离开底部时继续 streaming。
- session 切换与 scroll restoration。

可访问性：

- 所有 icon-only buttons 有 `aria-label`。
- keyboard 可以进入 cell action、tool details、approval。
- focus ring 可见。
- 状态不只依赖颜色。
- `details/summary` 或自定义展开控件有明确 label。

## 验收标准

改造完成后应满足：

- 主对话不再要求用户理解“运行过程模块”。
- 用户消息、AI 消息、thought、tool call、approval、最终结果在视觉上容易区分。
- thought 和 tool 在主 conversation 中是齐平的兄弟 cell，不互相嵌套。
- AI 执行完成后，thought 和 tool 默认折叠成一行。
- 最终结果是清晰的 conversation 收束节点。
- tool call 默认摘要足够解释 AI 调用了什么工具、用了什么参数。
- 展开 tool 只能看到参数详情，不显示 output、error body、diff 或 raw JSON。
- pending approval 在主对话里明显可见并可操作。
- active streaming 不漂在错误位置。
- 长文本、路径、命令、URL、代码块不重叠、不造成全局横向溢出。
- copy、quote、edit/resend、branch、rerun、approval、open path 等现有操作不回退。
- Codex 和 Claude provider 都能继续渲染旧会话。

## 风险与处理

- 风险：为了对齐 Codex，把 UI 做得过于终端化。
  处理：只借鉴 transcript/cell 模型，不照搬终端符号。

- 风险：过度折叠导致工具行为不可见。
  处理：closed summary 必须包含 tool name、operation、关键参数、status。

- 风险：不展示 output/error/diff/raw 可能影响排障。
  处理：主 conversation 坚持不展示；如确有排障需求，放到显式开发者诊断模式或 evidence，不进入普通 tool cell。

- 风险：assistant delta 和 completed message 重复。
  处理：保留 streaming buffer 与 completed message reconciliation 测试。

- 风险：provider payload 差异导致 phase 推导不稳定。
  处理：Codex 优先使用 `phase`，其他 provider 使用完成态启发式，并保留 fallback。

- 风险：主对话和 inspector 信息重复。
  处理：主对话展示摘要和关键操作，inspector 展示完整细节。

## 推荐 First PR

第一 PR 控制范围：

1. 新增 `conversation-cell.tsx`。
2. 改 user / assistant / thought / tool 的外壳和 label。
3. 不改 provider 协议。
4. 不改 persisted event schema。
5. 去掉用户可见的“运行轨迹”式一级结构。
6. 增加基础 rendering tests。
7. 跑 `npm run typecheck`、`npm run build:renderer`、`npm run visual:snapshot`。

这个 PR 的目标是先把主对话体验拉回 Codex transcript 模型，再进入 final answer phase、tool summary 和 approval blocking 的细化。
