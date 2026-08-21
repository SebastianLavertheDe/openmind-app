# 动效设计评审 — Desktop App

> 评审视角：专业产品设计师 / 动效系统角度
> 评审范围：`renderer/src`（React + 纯 CSS，无动效库）
> 评审日期：2026-07-05
> 评审人：Claude

## 总体结论

一句话概括这套界面在动效上的现状：**进入有动效，退出无动效；时长与缓动缺少 token，整体节奏不统一。**

成熟度评估：

| 维度 | 评分 | 说明 |
|------|------|------|
| 可访问性（reduced-motion） | ★★★★☆ | 5 处覆盖 `prefers-reduced-motion`，基线扎实 |
| 状态指示动效 | ★★★★☆ | spin / skeleton / thinking-dots / pulse 齐全且在用 |
| 进入动效 | ★★★☆☆ | 路由、toast、modal、segmented、details 有；浮层大面积缺失 |
| 退出动效 | ★☆☆☆☆ | 全线缺失——所有浮层瞬时卸载 |
| 微交互触感 | ★★☆☆☆ | hover 有颜色过渡，按压 / 抬起反馈几乎没有 |
| 动效语言一致性 | ★★☆☆☆ | 时长散落 140–220ms，缓动 69 处用通用 `ease`，无 token |

**最该先做的三件事（投入产出比最高）：**

1. 建立动效 token（duration / easing 变量），把散落的数值收敛。
2. 给所有浮层补退出动效——这是当前最明显的「廉价感」来源。
3. 给聊天消息流和列表新增项加入场动效——这是 AI 对话类产品的签名动作。

---

## 一、系统性问题（底层）

### 1.1 缺少动效设计 token

现状：时长散落在 `140 / 150 / 160 / 180 / 220ms` 五档；缓动函数统计——通用 `ease` 出现 69 次，`ease-out` 5 次，`ease-in-out` 7 次，真正经过调校的 `cubic-bezier(.2,0,.2,1)` 只有 3 次（且全部集中在 inbox）。`grep` 全仓没有 `--duration-*` / `--ease-*` 这类变量。

后果：同一个「卡片 hover」在不同模块节奏不同；新写组件的人随手取一个数，系统永远收敛不回来。inbox 是目前调校最好的模块（`renderer/src/styles/features/inbox.css:7-11`，transform 用 220ms `cubic-bezier(.2,0,.2,1)` + `will-change`），应作为基准推广。

建议在 `:root` 引入（值参考 Material 3 / Tailwind 的成熟档位）：

```css
:root {
  /* 时长 */
  --dur-instant: 80ms;     /* 按压、选中即时反馈 */
  --dur-fast: 140ms;       /* 颜色、边框、小图标 */
  --dur-normal: 200ms;     /* 浮层进入、位移 */
  --dur-slow: 280ms;       /* 浮层退出、大面积位移 */
  --dur-exit: 160ms;       /* 退出统一比进入略快、略短 */

  /* 缓动：进入用 emphasized-decel（减速，有重量感），退出用 emphasized-accel（加速，干脆） */
  --ease-standard: cubic-bezier(.2, 0, 0, 1);
  --ease-emphasized: cubic-bezier(.3, 0, 0, 1);
  --ease-exit: cubic-bezier(.4, 0, 1, 1);
  --ease-spring: cubic-bezier(.34, 1.56, .64, 1); /* 仅用于需要回弹的小元素 */
}
```

之后把现有 69 处 `ease`、散落的 ms 值逐替换为 token。这是后续所有改动的前提。

### 1.2 退出动效全线缺失（最高优先级）

这是当前界面「不够高级」的头号原因。进入：toast / modal 会淡入；退出：所有浮层在 1 帧内消失。**进入有动效、退出无动效的不对称，比完全没有动效更显廉价**——用户的视线刚锁定元素，元素就凭空消失。

受影响的浮层（全部缺失退出动效，多数连进入动效也没有）：

| 浮层 | 位置 | 进入 | 退出 |
|------|------|------|------|
| Toast | `components/FeedbackHost.tsx:57-67` + `styles.css:1090` | ✅ `toast-in` | ❌ 瞬时 |
| 确认 Modal | `components/FeedbackHost.tsx:69-94` + `styles.css:1101` | ✅ `toast-in` | ❌ 瞬时 |
| 图片灯箱 | `features/ai-console/composer.tsx:449-500` | ❌ | ❌ |
| 全局搜索 | `app/GlobalSearch.tsx:181-251` + `shell.css:301-323` | ❌ | ❌ |
| 右键菜单 | `design-system/controls.tsx:235-259` + `components.css:206-216` | ❌ | ❌ |
| 下拉菜单 | `design-system/controls.tsx:204-233`（原生 `<details>`） | ❌ | ❌ |
| AI 侧栏遮罩 | `components/AiSidebar.tsx:49-113` + `styles.css:987-996` | ❌ | ❌ |
| 审批卡片 | `features/ai-console/composer.tsx:293-304` + `ai-console.css:469-640` | ❌ | ❌ |
| 指令/提及建议菜单 | `features/ai-console/composer.tsx:349-372` + `ai-console.css:660-918` | ❌ | ❌ |
| Composer 错误条 | `features/ai-console/composer.tsx:281-286` | ❌ | ❌ |
| 队列托盘 | `features/ai-console/composer.tsx:287-292` | ❌ | ❌ |

通用实现方案（二选一，推荐 A）：

- **A. 轻量 Presence 模式（不引第三方库）**：写一个约 30 行的 `<Presence>` 组件或 `useExitAnimation` hook——子组件卸载前先切到 `data-leaving` 状态，`onTransitionEnd` / `setTimeout(dur-exit)` 后再真正卸载。浮层加一条 `transition: opacity var(--dur-exit) var(--ease-exit), transform var(--dur-exit) var(--ease-exit)`，`[data-leaving]` 时 `opacity:0; transform: translateY(4px) scale(.98)`。
- **B. 引入 `motion`（原 framer-motion）**：`<AnimatePresence>` 一行解决退出，且自带 `layout` 动画（见 1.3 / P1-2 的 FLIP 需求也能覆盖）。成本是新增依赖 ~30KB。考虑到本评审里多处高级需求（列表 FLIP、共享布局、拖拽），值得评估。

退出动效的通用法则（写进 token 文档）：**退出比进入更快、更短、用加速曲线**——`--dur-exit`(160ms) + `--ease-exit`。退出拖泥带水会让 UI 显迟钝。

### 1.3 列表 / 流式新增项没有入场动效

聊天消息、会话列表、收件箱条目、队列任务、审批卡片——新增时全部瞬时出现。对 AI 对话产品尤其要命：流式回复是核心体验，token 一段段蹦出来却没有任何「到达」的动效，缺乏生气。

参考点：路由切换已经做了（`route-registry.tsx:52-60` 用 `key=nonce` 强制 remount + `final-polish.css:117-138` 的 `page-head-rise` / `pane-fade`），证明团队接受入场动效，只需把这套思路下沉到列表项。

---

## 二、分项发现（按优先级）

### P0-1 浮层退出动效（同 §1.2）
最优先。逐个浮层补 `data-leaving` 退出。重点：toast、modal、lightbox、global search、context menu、suggestion menu——这五个是用户每天高频触发的高感知面。

以刚改过的图片灯箱为例（`composer.tsx:449`），当前进入退出都是瞬时。建议进入：`opacity 0→1 + scale 1.02→1`，`var(--dur-normal) var(--ease-emphasized)`；退出：`opacity→0 + scale→0.98`，`var(--dur-exit) var(--ease-exit)`。切图时图片本身再做一次 `scale 1.04→1` 的微推近，给「放大查看」一个物理隐喻。

### P0-2 流式消息 / 列表项入场
- 聊天消息：`features/ai-console/message.tsx:34-57`、`Chat.tsx`。新消息 `opacity 0→1 + translateY(6px→0)`，`var(--dur-normal) var(--ease-emphasized)`。流式中的最后一段可加一条极轻的「打字」呼吸（透明度脉冲），收尾时落定。
- 会话列表新增：`features/ai-console/AiWorkbench.tsx:254` `sessions.map`。新增项入场，高度从 0 展开或淡入 + 下移。
- 收件箱：`features/inbox/InboxPage.tsx:396-410`。
- 队列 / 审批：`composer.tsx:287-304`。

列表入场注意**stagger（错峰）**：批量出现时每项延迟 `40ms`，最多错峰到 `240ms` 封顶，避免长列表闪太久。单条新增不要 stagger。

### P1-1 微交互缺少按压触感
- 主按钮 / 危险按钮：`styles.css:1081-1085`。`:active` 只有 `filter: brightness(.95)`，没有形变。加 `transform: translateY(1px) scale(.98)`，`var(--dur-instant) var(--ease-standard)`，松手回弹。按钮「按下去」的物理反馈是触感的基础。
- 卡片 hover：`styles.css:1074-1079`（metric / skill / action grid）。当前只有 border / shadow 渐变。加 `transform: translateY(-2px)` 让卡片「抬起」，配合 shadow 加深。inbox 已经在用 transform（`inbox.css:7-11`），直接复用其缓动。
- 发送按钮：`composer.tsx:391-397`。Play → LoaderCircle 的切换是瞬时的图标替换，加一次 `scale(.9→1)` 的弹入。
- 复选框：`features/inbox/row.tsx:23-30` 用原生 `accent-color`，勾选无动效。可用自定义 box + SVG 勾，`stroke-dashoffset` 画线，或 `scale(0→1.2→1)` 弹入（`--ease-spring`）。

### P1-2 拖拽重排瞬移
`composer.tsx` 的 context chip 重排（`dragId` + `reorderContexts`）：拖放手后元素瞬间换位。建议引入 FLIP（First-Last-Invert-Play）或 `motion` 的 `layout` 属性，让其余项平滑滑到新位置，`var(--dur-slow) var(--ease-emphasized)`。被拖项加 `scale(1.03) + shadow` 的「抬起」态（已有 `.dragging` class，目前只用来加样式，没有 transform）。

### P1-3 状态切换缺少过渡
- skeleton → 内容：`design-system/feedback.tsx:36-56` 的 `LoadingState` / `Skeleton`。数据到达后 skeleton 直接被替换，加一层 `var(--dur-normal)` 的 crossfade。
- 发送态切换：composer 的 `isSending` 切换、按钮 enable↔disable，目前是瞬时的 disabled 属性变化，可加透明度过渡。

### P2-1 细节打磨
- **复制反馈**：`automation/AutomationPage.tsx:136-146`、`ai-console/message.tsx:101-113`、`daily-brief/DailyBriefPage.tsx:50-53`。复制成功是 Copy 图标瞬换成 Check，没有过渡。加 Check 的 `scale(0→1)` 弹入（`--ease-spring`，`var(--dur-fast)`），1.5s 后弹回 Copy。
- **数字计数**：`dashboard/DashboardPage.tsx:46-48` 的 MetricCard、`design-system/controls.tsx:82-105`。数字直接渲染，首次出现或值变化时做 count-up（ease-out，`var(--dur-slow)`）。仅在数字有语义（计数、统计）时用，ID 类不用。
- **手风琴高度**：`final-polish.css:140-147` 的 `details-fade` 只做了内容 fade + 3px 上移，高度靠原生 `<details>` 瞬时撑开。用 `grid-template-rows: 0fr → 1fr` 的现代写法补一条平滑高度过渡（`var(--dur-normal) var(--ease-standard)`），消除撑开的跳变。
- **文档标签页**：`creative/history-release.tsx:61` + `styles.css:207-209`。segmented 有滑动指示器，但 document-tabs 是瞬时 class 切换，缺一条下划线滑动 + 内容 crossfade。
- **Tooltip**：全仓无 tooltip 组件。多处用 `title=` 原生提示，体验差。建议补一个带 fade-in（`var(--dur-fast) var(--ease-standard)`，150ms 延迟出现）的轻量 tooltip。

---

## 三、优先级路线图

| 优先级 | 工作项 | 范围 | 预估 |
|--------|--------|------|------|
| P0 | 动效 token（duration / easing 变量） | 全局 `:root` + 替换散落值 | 0.5d |
| P0 | 浮层退出动效（Presence 模式或引入 motion） | §1.2 表格全部 | 1–2d |
| P0 | 流式消息 + 列表项入场（含 stagger） | message / sessions / inbox / queue | 1d |
| P1 | 按钮按压 + 卡片抬起 + 发送按钮弹入 | buttons / cards / composer | 0.5d |
| P1 | 拖拽 FLIP 重排 | composer context chips | 0.5–1d（引入 motion 则 0.2d） |
| P1 | skeleton→内容 crossfade、状态过渡 | feedback.tsx / composer | 0.3d |
| P2 | 复制反馈弹入、数字 count-up、手风琴高度、文档 tab 滑动、tooltip | 多处 | 1.5d |

建议落地顺序：先做 token（P0 第 1 项），它不改变观感但让后面所有改动有统一节奏；再选 Presence 方案（决定是否引入 `motion`），因为它同时决定 P1-2 拖拽的实现成本；最后按 P0→P1→P2 推进。

---

## 四、决策点（需要确认）

1. **是否引入 `motion`（framer-motion）？** 引入则退出动效、FLIP、共享布局一并解决，省下自研 Presence 的工作量；代价是 ~30KB 依赖。自研则保持零依赖、可控，但要自己维护退出 / FLIP 逻辑。这决定后续所有 P0/P1 的实现路径。
2. **动效强度取向**：当前整体偏「克制」。是保持克制只补退出 + 列表入场（最小改动达到最大观感提升），还是顺势做一套更有存在感的动效语言（抬起、回弹、stagger 全开）？

---

## 附录 A：现有动效清单（已具备，作为基础保留）

| 动效 | 定义 | 用途 |
|------|------|------|
| `spin` / `spin-pulse` | `styles.css:1046` | 加载旋转，含 reduced-motion 变体 |
| `skeleton` / `skeleton-wave` | `styles.css:1107` | 骨架屏 shimmer |
| `toast-in` | `styles.css:1090,1100` | toast / modal 进入 |
| `page-head-rise` | `final-polish.css:130` | 路由 header 进入 |
| `pane-fade` | `final-polish.css:127` | 路由主区进入 |
| `details-fade` | `final-polish.css:140` | `<details>` 展开内容 |
| `activity-dot` / `thought-dot` | `styles.css:849` | 思考中呼吸点 |
| `activity-track` / `funnel-pulse` | — | 活动条 / 漏斗脉冲 |
| `inbox-spin` | — | inbox 旋转 |
| segmented 滑块 | `final-polish.css:30-47` | 分段控件指示器滑动（160ms） |
| toggle 开关滑块 | `settings.css:257` / `automation.css:547` | 开关 knob 平移（140ms） |
| chevron 旋转 | `styles.css:258,357,405` | 折叠箭头（160ms） |

这些都是对的、在用的，不用动。本评审的所有建议是在这套基础上**补齐缺失**，而非推翻重做。

## 附录 B：可访问性核对

- ✅ `prefers-reduced-motion` 已在 5 处覆盖（`styles.css:1049`、`final-polish.css:287`、`inbox.css:118`、`ai-console.css:1042,1130`）——把动画 / 过渡时长清零。
- ⚠️ 新增动效必须延续这套兜底：所有新 keyframe / transition 都要被 reduced-motion 媒体查询覆盖。建议把这条写进组件规范，PR 自查。
- ✅ Modal 焦点陷阱（`FeedbackHost.tsx:14-53`）已实现，新增浮层（global search、context menu）应复用同样的 focus 管理。

## 附录 C：交互动画状态矩阵（micro-interactions 总览）

把交互态拆成 hover / focus / active / 切换 几条独立维度全仓扫描，结论很偏科：

| 交互态 | 覆盖 | 证据 |
|--------|------|------|
| **hover** | ✅ 充分 | 全仓 113 条 `:hover` 规则，颜色 / 边框 / 阴影过渡齐全（`styles.css` 47 条、`dashboard-brief.css` 10 条、`inbox` / `ai-console` / `shell` 各 6–9 条） |
| **focus** | ✅ 充分 | 49 条 focus / outline 规则分布在 8 个样式文件，焦点环到位（可访问性基线好） |
| **active 按压** | ❌ **几乎全线缺失** | 全仓只有 2 条实质规则：`.primary-button:active:not(:disabled) { filter: brightness(.95) }`（`styles.css:1083`，仅亮度、无形变）、`.context-chip[draggable]:active { cursor: grabbing }`（`styles.css:1123`，仅改光标） |
| 切换开关 | ✅ 动了 | settings / automation 的 knob `translateX` 140ms（`settings.css:276`、`automation.css:565`） |
| 复选框 | ❌ 原生 | inbox 用 `accent-color`，勾选无动效（`row.tsx:23-30`） |
| 拖拽重排 | ❌ 瞬移 | 有 `.dragging` class 但无 transform、无 FLIP（`composer.tsx` ContextTray） |
| 复制反馈 | ❌ 瞬时 | Copy ↔ Check 图标直接换，无过渡（`message.tsx:101-113` 等多处） |

**核心结论：hover 和 focus 做得好，按压（`:active`）态几乎完全没有。** 按钮「按下去」没有形变反馈，是整体触感单薄的主因。这条独立于「进入 / 退出动效」——即使把浮层退出都补全，按下按钮依然是死板的。

修复点位（详细方案见正文，不在此重复）：
- 按压形变 → §P1-1（`primary-button` / `icon-text-button` / `action-grid button` 加 `:active { transform: translateY(1px) scale(.98) }`，`var(--dur-instant)`）。
- 拖拽 FLIP → §P1-2。
- 状态过渡（含 toggle 之外的切换）→ §P1-3。
- 复制反馈弹入、复选框打勾、文档 tab 滑动 → §P2-1。

**最小投入快赢（不依赖 token 化即可先上）**：给上述四个按钮选择器各加一条 `transition: transform 80ms ease; :active { transform: scale(.98); }`。一次提交，全仓触感立刻不一样。

---

# 现状复查（2026-07-14）

> 目标：复核每个按钮 / 页面 / 卡片的动效覆盖与一致性，定位**仍然缺失**的部分。
> 证据来源：`renderer/src/**`（TSX + CSS）实测 grep + `scripts/motion-contract-check.js` 通过（0 违例）。

## 复查总览

2026-07-05 评审里的 **P0 已全部落地**，**P1 基本落地**，只剩 P2 尾巴和一批「列表项/卡片入场」未覆盖。一致性方面，新写代码已统一走 token（`--dur-*` / `--ease-*`），contract gate 在 CI 里卡住新的裸 `transition ...ms ease`，所以**新动效的节奏是一致的**；遗留不一致集中在历史代码。

| 维度 | 当时 | 现在 | 变化 |
|------|------|------|------|
| 动效 token | ★☆☆☆☆ | ★★★★★ | `styles.css:103-111` 已定义 5 档 duration + 4 档 easing，contract 强制使用 |
| 退出动效 | ★☆☆☆☆ | ★★★★☆ | `useExitPresence` / `useExitingList` 覆盖 toast / modal / 灯箱 / 全局搜索 / 建议菜单 / 队列 / 审批 / 会话列表 / 历史 / 预览 |
| 按压触感 | ★★☆☆☆ | ★★★★☆ | `data-motion`（action/icon/selection/toggle/overlay/disclosure）+ 语义 class 兜底，覆盖主/危险/图标/卡片按钮 |
| 列表入场 | ★☆☆☆☆ | ★★★☆☆ | session-list / queue / source-item（带 stagger）/ msg-in 已有；**其余功能页列表项仍瞬时** |
| 微交互 | ★★☆☆☆ | ★★★☆☆ | 复制反馈 `copy-check-pop`、灯箱 zoom、disclosure 高度（interpolate-size）已做；**count-up / tooltip 仍缺** |

## 一、一致性核查（已统一 ✅ / 仍不一致 ⚠️）

**✅ 已统一：**
- 所有**新写**动效走 token。`motion-contract-check.js` Rule 1 禁止裸 `transition: ...ms ease`，当前 0 违例。
- 进入 vs 退出节奏统一：进入 `--dur-normal`(200ms) + `--ease-emphasized`；退出 `--dur-exit`(160ms) + `--ease-exit`（加速、更短）。灯箱、chip-select、panel-slide、approval-detail 全部遵循。
- 退出曲线方向一致：全部用 `cubic-bezier(.4,0,1,1)`（加速），没有混用 ease-in-out。
- `prefers-reduced-motion` 全局兜底（`final-polish.css:269-275` 把所有 animation/transition 时长置零），新增动效无需逐个加媒体查询。

**⚠️ 仍不一致（历史代码，contract 暂时 grandfather）：**
- `final-polish.css` 内 `page-head-rise` / `pane-fade` / `details-fade` 用 `180ms / 140ms ease-out`（`final-polish.css:78,88,102`），与 token 档位（200/140）不完全对齐，且用 `ease-out` 而非 `--ease-emphasized`。这是 grandfather 文件，contract 放行，但节奏上与其它进入动效略差一档。
- `route-skeleton-pulse` / `activity-dot` / `activity-track` / `funnel-pulse` 等循环动画仍用字面 `ease-in-out`（`final-polish.css:369,379`、`styles.css:530,539`）——循环动画用通用 ease 影响小，但未收敛到 token。
- `dashboard-brief.css` / `daily-brief.css` / `creative.css` / `projects.css` / `settings.css` **完全没有 `animation` / `@keyframes`**（grep 确认），即这些页面的卡片/列表只继承路由级 `pane-fade`，没有任何页面内动效。

## 二、按「按钮」逐类核查

| 按钮类别 | 进入 | 按压(:active) | hover | 退出 | 结论 |
|----------|------|---------------|-------|------|------|
| 主操作 `.primary-button` / `.document-save-button` | 路由 pane-fade | ✅ `translateY(1px) scale(.98)` | ✅ | — | ✅ 完整 |
| 危险 `.danger-button` / `.source-delete` | 路由 pane-fade | ✅ 下沉缩放 | ✅ | — | ✅ 完整 |
| 图标 `.icon-button` / `.pane-header` / `.message-meta` | — | ✅ `scale(.92)` | ✅ | — | ✅ 完整 |
| 发送 `.composer-send` | — | ✅ `scale(0.96)`（`ai-console.css:1883`） | ✅ | — | ✅；但 Play→LoaderCircle 图标切换**仍瞬时**（P2 遗留） |
| 跳底 `.jump-bottom` | — | ✅ `scale(0.96)` | ✅ | ❌ 瞬时消失 | ⚠️ 退出缺 |
| 复制 Copy↔Check | — | icon 缩放 | ✅ | — | ✅ `copy-check-pop` 弹入（`styles.css:1384`） |
| 筛选/tab `.filter-tabs` `.session-filters` `.document-tabs` `.ui-tabs` | 指示器滑动 160ms | selection 无形变（靠颜色） | ✅ | — | ✅ 一致 |
| 开关 `.ui-toggle-switch` | — | toggle 无形变 | ✅ | — | ✅ knob translateX 140ms |
| 会话/文件/规则行 `.session-item` `.brief-file-item` `.source-item` `.rule-item` | ✅ session/source/brief 有 `list-item-in`（brief 见 `workbuddy-refactor.css:692`）；rule 无 | selection 无形变 | ✅ | ⚠️ rule 行无入场 |
| 卡片 `.workspace-card` `.metric-card` `.topic-card` | 路由 pane-fade | action 类下沉 | ✅ border/shadow | — | ⚠️ hover 无「抬起」transform（P1-1 未做） |
| 浮层内按钮 `.toast-action` `.confirm-*` | toast-in | ✅ | ✅ | ✅ data-leaving | ✅ 完整 |

**contract 门禁**：`motion-contract-check.js` Rule 2 要求每个 `<button>` / `role=button` 必须带 `data-motion` 或命中已知语义 class，当前 0 flag——**按钮层面没有「漏网」的裸按钮**。

## 三、按「页面」逐个核查

> 所有页面通过 `route-registry.tsx:70-76` 的 `key={route.nonce}` 在导航时 remount，统一触发 `page-head-rise`（header）+ `pane-fade`（主区）路由级入场（`final-polish.css:78-100`）。下面只标页面**内部**动效。

| 页面 | 路由入场 | 列表/卡片入场 | 退出/状态切换 | 缺口 |
|------|----------|---------------|---------------|------|
| **ai (AiWorkbench)** | ✅ | ✅ `msg-in` / `list-item-in`(session/queue) | ✅ history/preview/suggestion menu 全有退出 | ✅ 最完整 |
| **ai composer** | — | ✅ approval/suggestion/queue 入场+退出 | ✅ error/chip-select 退出 | ✅ |
| **sources** | ✅ | ✅ `source-item-in` + stagger（30ms 错峰，`sources.css:604-608`） | ✅ add-panel/bulk-bar `panel-slide` 退出 | ✅ 最完整 |
| **automation** | ✅ | ✅ `automation-page-in` / `automation-detail-in`（`automation.css:386,491`） | ✅ | ✅ 较完整 |
| **daily-brief** | ✅ | ✅ `brief-file-item` stagger 入场（`workbuddy-refactor.css:692-699`，30ms 错峰） | ✅ 编辑↔预览 `view-switch-in` crossfade（`document-content-view key={mode}`） | ✅ 完整 |
| **creative** | ✅ | ⚠️ 仅 stream 卡片 `creative-stream-enter` + 返回列表 `creative-list-reopen-in`；**`creative-item-row` 首次入场无** | ⚠️ document-tabs 下划线瞬时切换 | ⚠️ 列表行入场 + tab 滑动缺 |
| **projects** | ✅ | ❌ `topic-list` / `dashboard-topic-list` **无入场** | — | ⚠️ 列表项入场缺 |
| **settings** | ✅ | ❌ 各 section 卡片**无入场** | ✅ toggle knob | ⚠️ section 入场缺（可选） |
| **dashboard-brief** | ✅ | ❌ `metric-card` / `topic-card` **无入场** | ❌ 数字无 count-up | ⚠️ 卡片入场 + count-up 缺 |

**共性缺口**：creative / projects / settings / dashboard-brief 这 4 个页面的**部分列表项与卡片首次渲染仍是瞬时出现**（daily-brief 已补齐）。即进 AI/Sources/Daily-brief 页列表项会淡入上移，进 Creative/Projects/Dashboard 列表却一次性蹦出——页面间不一致。

> 注：动效除 `final-polish.css` 外，还有第二个集中载体 `styles/workbuddy-refactor.css`（经 `product.css:14` 引入），承载 brief-file-item stagger、creative stream/list-enter、document-content view-switch 等。功能页是否「有动效」需同时查这两个文件，不能只看 `styles/features/*.css`。

## 四、按「卡片」逐类核查

| 卡片 | hover 抬起 | 入场 | 状态切换 | 缺口 |
|------|-----------|------|----------|------|
| `workspace-card`（通用容器） | ❌ 仅 border/shadow 渐变，**无 translateY** | 路由 fade | — | ⚠️ P1-1「抬起」未做 |
| `tool-event`（AI 工具事件卡） | ✅ border/bg/shadow 过渡（`styles.css:554`） | ✅ 随 trace | ✅ 展开 disclosure | ✅ 完整 |
| `plan-card`（计划清单） | — | ✅ li 过渡 | ✅ 圆点 scale+spring（`styles.css:650`） | ✅ |
| `approval-card`（审批） | — | ✅ `approval-detail-in` + 退出 | ✅ | ✅ |
| `metric-card` / `ui-metric-card` | ❌ | ❌ | ❌ 数字无 count-up | ⚠️ 入场 + count-up 缺 |
| `topic-card`（选题卡） | ❌ | ❌ | — | ⚠️ 入场 + hover 抬起缺 |
| `source-item` | ✅ | ✅ stagger | ✅ fetch-icon `icon-fade-in` | ✅ 完整 |
| `brief-file-item` | ✅ active 态 | ✅ stagger（`workbuddy-refactor.css:692`） | ✅ view-switch | ✅ 完整 |
| `creative-item-row` | ✅ | ❌ 首次入场无（仅 stream/返回有） | — | ⚠️ 入场缺 |

## 五、仍然缺失的动效（按优先级，可作为下一步 backlog）

### P2-A 列表项 / 卡片入场（跨页面一致性，最值得做）
**问题**：creative / projects / settings / dashboard-brief 的部分列表项与卡片首次渲染瞬时出现，与 ai-console / sources / daily-brief 的 stagger 入场不一致。
**方案**：把已有的 `list-item-in` / `source-item-in`（`styles.css:312` / `sources.css:604`）下沉为通用 `.entrance-stagger > *` 工具类，给下列容器套用，复制 `nth-child` 错峰（封顶 6 项 / 240ms）。零新增依赖，一处改动覆盖全部。
- `creative-item-row` / `creative-tab`（creative 列表行；stream 卡已有）
- `topic-list` / `dashboard-topic-list`（projects）
- settings section 卡片
- `metric-card` / `topic-card`（dashboard-brief）

### P2-B 卡片 hover「抬起」(P1-1 残留)
**问题**：`workspace-card` / `metric-card` / `topic-card` hover 只有 border/shadow 渐变，没有 `translateY(-2px)` 的物理抬起（评审 §P1-1 建议项，目前只给 action-grid 做了 `styles.css:1399`）。
**方案**：`[data-motion="card"]:hover` 或 `.workspace-card:hover` 加 `transform: translateY(-2px)` + shadow 加深，复用 inbox 的 `cubic-bezier(.2,0,.2,1)` 220ms（`inbox.css:7-11`）。

### P2-C 数字 count-up（P2-1 残留）
**问题**：`MetricCard`（`controls.tsx:111`）的 `<strong>{value}</strong>` 直接渲染，数字首次出现/变化无滚动。
**方案**：`useCountUp(value, --dur-slow)` hook，仅在数字语义（统计计数）时用，ID/时间戳不用。`design-system/controls.tsx` 是唯一入口。

### P2-D 微交互尾巴
- **发送按钮图标切换**：`composer.tsx` Play → LoaderCircle 瞬时替换，加 `scale(.9→1)` 弹入。
- **`.jump-bottom` 退出**：出现有动画，消失瞬时（无 useExitPresence）。
- **document-tabs 下划线滑动**（creative `history-release.tsx`）：瞬时 class 切换，缺 segmented 式滑动指示器。
- **复选框打勾**：inbox `row.tsx` 仍用原生 `accent-color`，勾选无动效。

### P2-E Tooltip 组件（全仓缺失）
**问题**：全仓 14 处用原生 `title=`（grep 确认），无 `<Tooltip>` 组件，体验差且不可控延迟。
**方案**：补一个 `design-system/Tooltip.tsx`，`--dur-fast` + 150ms 延迟出现的 fade-in，复用 focus 管理。属新增组件，非阻塞。

## 六、结论

**有动效的部分节奏是否一致？** 新写代码一致（token + contract 强制）；历史 grandfather 代码（final-polish.css 的进入动画、循环动画的 ease-in-out）略差一档，但被 contract 锁死不会扩散。

**还缺什么？** 集中在两点：(1) **5 个功能页的列表项/卡片入场动效**——这是当前页面间最显眼的不一致；(2) **卡片的 hover 抬起 + 数字 count-up**——触感与数据感知的单点提升。其余（发送图标、jump-bottom 退出、document-tab 滑动、tooltip）是打磨级尾巴。

建议下一步只做 **P2-A（列表项入场下沉为通用类）+ P2-B（卡片抬起）** 两项，即可把「每个页面、每个卡片」的动效拉齐到 ai-console / sources 的水平。
