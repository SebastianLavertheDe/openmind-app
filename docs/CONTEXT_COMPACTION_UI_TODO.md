# 上下文压缩事件 UI 查漏补缺

状态:**暂不实现**,仅记录缺口与落点,供后续排期。

## 背景

desktop-app 后台对 provider 的上下文压缩事件已有完整处理链路:识别、写入前裁剪 checkpoint、持久化、重建时整窗重置。但 AI 工作台前端对这类事件的可见性很低,用户几乎感知不到「刚刚发生过压缩」。

后台数据是丰富的,前端展示是贫乏的。这份文档列出缺口。

## 现状(已查)

压缩事件(`kind: "system"`,subtype `compact_boundary` / `context_compacted`)目前走的是普通 system 事件通道:

| 环节 | 位置 | 现状 |
|------|------|------|
| 来源 | `electron/ai/providers/claude-agent-sdk.ts:324`、`codex-app-server.ts:175` | provider 主动发,desktop-app 不触发 |
| 识别 | `electron/ai/event-chunking.ts:84` `isContextCompaction` | 已识别 |
| 写入前裁剪 | `electron/ai/rollout.ts:172` `buildCompactionCheckpoint` | 按 turn 倒序保留 `maxChars=48_000` |
| 持久化 | `electron/ai/session-store.ts:333` | checkpoint + turn_context + world_state 追加进 journal |
| 重建重置 | `electron/ai/rollout.ts:337` `applyCompaction` | history / referenceContext / worldState 同时清零,切新窗口 |
| **会话主流程渲染** | `renderer/.../ai-console/timeline.ts:180` `groupConversation` | **无 system 分支,压缩不进会话流** |
| **技术事件渲染** | `renderer/.../ai-console/events.tsx:54` `TechnicalEventGroup` | 折叠在「System / 运行详情」里,默认收起 |
| 文案 | `renderer/.../ai-console/timeline.ts:131` `technicalEventText` | 一行 `payload.text`:「Claude Code 已压缩上下文」/「Codex compacted the conversation context.」 |

## 缺口(漏)

后台 `AiRolloutCompacted`(`shared/contracts.ts:292`)携带的以下字段,前端**完全没有消费**:

- `windowNumber` —— 第几个压缩窗口
- `windowId` / `previousWindowId` —— 窗口标识与衔接关系
- `replacementHistory` —— 压缩后保留的轮次(保留了哪些、丢了哪些)

具体表现:

1. **会话流里没有压缩分隔条**。压缩发生的位置在主时间线上不可见,用户看不出「这一刻上下文被截断重置了」。
2. **没有压缩元数据展示**。窗口号、保留范围、丢掉的轮次一律不显示。
3. **没有专门 i18n 词条**。`shared/messages` 里 `compact` 只有「紧凑」(密度设置),压缩文案是 provider 转换时写死的硬编码字符串。
4. **会话列表不标记**。发生过压缩的 session 在列表里无任何标识。注意 `AiWorkbench.tsx:327` 的 `session-compact-meta` 类名是「紧凑布局」,与上下文压缩无关。

## 待补方案(补,排期时再定)

如果要做,优先级从高到低:

### P1 会话流压缩分隔条

在 `groupConversation`(`timeline.ts:180`)给 `system` + 压缩 subtype 增加独立分支,渲染成带图标的分隔 cell,样式类似 Claude Code CLI 的 compact 边界。文案带窗口号,例如「上下文已压缩 · 窗口 2」。数据从事件的 `payload.windowNumber` 取——需要先把 windowNumber 透传到 event payload(目前 `claude-agent-sdk.ts:325` 只塞了 text/subtype,Codex 那边 `...params` 已带)。

### P2 折叠展示保留范围

分隔条可展开,显示 `replacementHistory` 里保留的轮次摘要(轮数、字符量、被丢弃的最早轮时间),让用户知道压缩丢了什么。数据在 `rollout.ts` 重建阶段已算出,需经 `AiContextState` 暴露给 renderer。

### P3 i18n 与会话列表标记

- 把压缩文案移入 `shared/messages/zh-CN/ai.ts`,支持多语言。
- session 列表项(`AiWorkbench.tsx`)给发生过压缩的会话加一个细微标识(如窗口数徽标)。

## 暂缓原因

后台账本已完备,UI 缺口属体验增强,不影响压缩本身的正确性。当前无明确产品诉求驱动,先记录待排期。

## 关联文件

- 后台链路:`electron/ai/rollout.ts`、`electron/ai/session-store.ts`、`electron/ai/event-chunking.ts`
- Provider 转换:`electron/ai/providers/claude-agent-sdk.ts`、`electron/ai/providers/codex-app-server.ts`
- 前端渲染:`renderer/src/features/ai-console/timeline.ts`、`renderer/src/features/ai-console/events.tsx`
- 契约:`shared/contracts.ts`(AiRolloutCompactedSchema、context_compacted 事件类型)
- 相关旧文:`docs/CODEX_CONTEXT_ALIGNMENT.md`
