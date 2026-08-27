# UI 响应式最终修改清单（2026-08-27）

## 文档信息

- 初始审查：**Claude Code**
- 交叉审核：**ZCode（GLM）**
- 运行态复核与最终整理：**Codex（OpenAI）**
- 产品约束确认：**用户**
- 代码基准：2026-08-27 当前 HEAD
- 文档性质：最终修改范围与验收依据，不是原始审查过程记录

本文件综合三轮审查，但以当前代码调用链、CSS 实际层叠和运行态几何数据为最终裁决依据。静态代码风险不会直接等同于已发生故障；不可达路由、已有明确降级方案以及产品确认的交互不会列入必须修改项。

## 一、已经确认的产品约束

以下行为是既定设计，不作为缺陷处理：

1. 进入每日简报时，AI 必须自动打开；
2. 窄屏进入单画布模式后，优先展示 AI 对话；
3. 用户连续缩放窗口时，可以看到 AI 从并排、浮层到单画布的动态变化；
4. Daily Brief 的文件列表与正文当前保持 master/detail 并排；
5. Markdown 宽表格在窄容器内使用局部横向滚动；
6. Lightbox 翻页按钮覆盖在图片边缘属于现有交互；
7. `runs` 路由没有生产导航入口，不计入当前可见 UI 的修改范围。

## 二、最终结论

必须优先修改 4 个 P1、6 个 P2，并补强视觉回归门禁。其余内容进入低优先级维护批次。

| 优先级 | 数量 | 范围 |
|---|---:|---|
| P1 | 4 | Settings Token、Creative ready 高度流、AI 历史浮层、Automation 裁切 |
| P2 | 6 | Confirm 高度保护、Select 定位、cURL 弹层、长字符串、Context chips、触屏会话操作 |
| 测试门禁 | 1 组 | 可见性、模态遮挡、关键状态和高度维度 |
| P3/维护 | 1 批 | 死 CSS、断点 ownership、低概率溢出和缺失样式 |

## 三、P1：功能可达性问题

### P1-1 Settings Browser Token 中间宽度溢出

状态：**运行态已复现**。

相关位置：

- `renderer/src/styles/features/settings.css:1759`
- `renderer/src/styles/features/settings.css:1804`
- `renderer/src/styles/features/settings.css:1908`
- `renderer/src/features/settings/settings-sections.tsx:557`

现象与证据：

| 窗口宽度 | 结果 |
|---:|---|
| 720px | 已切为单列，正常 |
| 840px | Token 卡片横向溢出约 84px |
| 900px | 仍溢出约 30px |
| 1020px | 恢复正常 |

根因是 Token 区采用 `minmax(220px, 1fr) minmax(300px, auto)`，连同间距至少需要约 536px；单列化却按整个窗口 `max-width:820px` 触发，没有依据设置详情卡片的实际可用宽度。

修改要求：

- 优先让 Token 卡片或设置详情成为 query container，按组件可用宽度切换单列；
- 如果暂不使用 container query，应将降级阈值覆盖实际发生溢出的中间宽度；
- 不要通过给整页增加横向滚动掩盖问题。

验收标准：

- 720、840、900、1020px 下输入框及保存/清除按钮均位于卡片和详情区域内；
- 页面、详情区和 Token 卡片均没有非预期横向滚动；
- 从宽到窄连续调整时，布局只逐级简化，不再出现“更窄正常、中间宽度溢出”。

### P1-2 Creative `ready` 阶段在低高度下编辑器归零

状态：**720×600 运行态已复现；仅确认 `ready`，不扩大到 `published`**。

相关位置：

- `renderer/src/features/creative/CreativeDetailPane.tsx:241-291`
- `renderer/src/features/creative/panels.tsx:35-80`
- `renderer/src/styles/workbuddy-refactor.css:1495-1503`
- `renderer/src/styles/features/creative.css:1045-1050`

现象与证据：

- `.publish-form` 实测约 615px 高；
- `.creative-editor` 实测高度为 0；
- `.creative-detail-transition` 的 `scrollHeight` 大于 `clientHeight`，但其 `overflow:hidden`；
- 正文不可见、不可编辑，属于主流程功能损失。

修改要求：

- 为 `ready` 详情建立明确的纵向滚动所有权；
- PublishForm、编辑器和 WritingStats 必须能够通过同一可理解的滚动路径到达；
- 编辑器不能继续作为唯一可压缩到 0 的 flex 子项；
- 不要无证据修改 `published` 阶段，先单独验证其实际高度。

验收标准：

- 720×600、900×600、1280×600 下，`ready` 项目的编辑器高度大于 0 且正文可编辑；
- PublishForm 顶部、底部导出区域、编辑器和 WritingStats 均能通过滚动到达；
- 页面不存在嵌套滚动陷阱，Tab 焦点不会进入不可见区域；
- 普通高度窗口的现有视觉结构不退化。

### P1-3 AI 历史会话浮层越出右边界

状态：**运行态已复现；正确区间约为 841–1019px，不是 720px**。

相关位置：

- `renderer/src/features/ai-console/AiWorkbench.tsx:161-198`
- `renderer/src/features/ai-console/AiWorkbench.tsx:312-338`
- `renderer/src/styles/features/ai-console.css:2525-2539`

现象与证据：

- 720/840px drawer 状态下 `.history-toggle` 隐藏；
- 841、850、900、940、1000、1019px 下浮层均向右越界约 255px；
- 约 1020px 进入 expanded navigation 后，该按钮重新隐藏；
- 当前只在打开时读取一次按钮 `left/top`，没有视口钳制、翻转或 resize/scroll 重定位。

修改要求：

- 以触发按钮右缘对齐浮层，并将最终坐标钳制在视口安全边距内；
- 下方空间不足时向上翻转；
- 打开后在 window resize、visual viewport resize 和相关滚动事件中重新定位；
- 保持现有 portal、Escape、点击外部关闭和焦点返回行为；
- 优先抽取可复用的 anchored popover 定位能力，供 Select/Context detail 后续复用。

验收标准：

- 841、850、900、940、1000、1019px 下浮层完全位于视口内；
- 打开后连续缩放窗口，浮层仍与触发器保持正确关系；
- 长会话列表内部可滚，首项、末项和操作均可点击；
- 720/840 drawer 状态和 ≥1020 expanded 状态的现有导航行为不变。

### P1-4 Automation 在 720×600 下裁掉列表和控制台

状态：**运行态已复现；严重度高于原静态报告中的 P2“双滚动”**。

相关位置：

- `renderer/src/styles/features/automation.css:2-7`
- `renderer/src/styles/features/automation.css:374-381`
- `renderer/src/styles/responsive.css:49-57`
- `renderer/src/features/automation/AutomationPage.tsx:188-257`

现象与证据：

- `.automation-rules-layout` 实测高度 680px，内部 `scrollHeight` 约 1066px，并设置 `overflow:hidden`；
- 窄宽单列后 `.automation-rule-list` 高度变为 0；
- 日志控制台整体位于布局裁切边界之外；
- 外层页面虽然能滚动约 188px，但无法显示被内部容器裁掉的控制台。

修改要求：

- 移除窄宽/低高度状态下的固定 680px 最小高度冲突；
- 明确 Automation 单列状态的滚动所有权，列表、详情、运行历史和控制台必须进入同一可达内容流；
- 如果保留 pane 内滚，父布局必须提供真实可用高度，不能依赖溢出到 `overflow:hidden` 外部；
- 复核 `responsive.css` 的低特异性规则，避免其继续被 feature 规则压制。

验收标准：

- 720×600 下规则列表高度大于 0，可以切换规则；
- 规则详情全部字段、保存/运行操作、运行历史和日志控制台都能滚动到达；
- 外层滚动到底后不存在仍被内部裁切的内容；
- 840×600、900×600 和普通 720px 高窗口下均无回归。

## 四、P2：确定需要补强的风险

### P2-1 Confirm 弹窗高度保护

相关位置：`renderer/src/styles.css:1425-1429`、`renderer/src/components/FeedbackHost.tsx:87-112`。

当前业务确认文案通常较短，因此不列 P1；但通用组件允许任意 `white-space:pre-wrap` body，没有高度边界。

修改要求：

- scrim 允许纵向滚动；
- modal 设置安全 `max-height`；
- 标题与操作区保持可见，正文区域内部滚动；
- 增加长标题、长 body 和 600px 高度夹具。

### P2-2 Select 菜单缺少翻转和钳制

相关位置：`renderer/src/design-system/Select.tsx:210-237`、`renderer/src/styles/components.css:859-873`。

修改要求：

- 根据触发器和视口剩余空间决定向上/向下展开；
- 对左右边界进行钳制；
- 避免被 `overflow:hidden/auto` 祖先裁切，优先使用 portal；
- 保留现有键盘导航、ARIA 和焦点恢复；
- 与 P1-3 共用 anchored popover 基础能力。

### P2-3 Skills cURL 编辑弹层高度保护

相关位置：`renderer/src/styles/features/skills.css:607-655`、`renderer/src/features/skills/SkillsPage.tsx:1049-1058`。

修改要求：

- scrim 允许纵向滚动；
- editor 设置视口最大高度；
- textarea 的 resize 不得把 footer 永久推出视口；
- 600px 高度下拉高 textarea 后，“取消/覆盖保存”仍可达。

### P2-4 Chat 超长无空格文本换行

相关位置：`renderer/src/styles/features/ai-console.css:320-359`、`renderer/src/styles.css:1683-1701`。

修改要求：

- 对 chat Markdown、行内 code、用户消息正文统一增加长 URL/路径/base64 的断行兜底；
- 代码块继续保留自身横向滚动，不要强制破坏代码格式；
- 增加 URL、UNC 路径、长 hash 和 base64 夹具。

### P2-5 Context chips 溢出提示与详情浮层

相关位置：`renderer/src/styles/features/ai-console.css:2320-2345`、`renderer/src/styles.css:1171-1186`。

修改要求：

- 为可横向滚动的附件条提供“还有更多”的视觉提示或等价可发现性；
- 详情浮层使用视口钳制，不再固定从 chip 左缘展开 280px；
- 键盘、鼠标和触屏都能查看靠右附件的完整详情。

### P2-6 最近会话操作的触屏可发现性

相关位置：`renderer/src/styles/workbuddy-refactor.css:486-503`、`renderer/src/app/SidebarRecent.tsx:118-140`。

实际操作是置顶/取消置顶和归档，不是重命名/删除。键盘 `focus-visible` 已有兜底，但触屏无法稳定触发 hover。

修改要求：

- 在 `hover:none`/粗指针环境下让操作常显，或提供显式“更多”菜单；
- 桌面鼠标环境可以继续保留 hover 渐显；
- 维持按钮的可访问名称和 44px 触屏目标策略。

## 五、视觉回归门禁必须补强

状态：**ZCode 提出，Codex 复核确认**。

相关位置：

- `scripts/visual-snapshot-electron.js:887-951`
- `scripts/visual-snapshot-electron.js:954-1013`

当前 `waitForReady` 和 `inspectPage` 都使用 `Boolean(document.querySelector(requiredSelector))` 判断语义目标，只能证明节点存在，不能证明它实际可见和可操作。现有报告有 50 张路由截图、24 个状态快照且零失败，但仍可能遗漏被 AI canvas 或其他模态层覆盖的页面本体问题。

修改要求：

1. `requiredSelector` 必须同时满足：
   - `display`/`visibility` 可见；
   - 几何宽高大于 0；
   - 自身及祖先不处于 `inert`；
   - 自身及祖先没有 `aria-hidden="true"`；
   - 关键采样点没有被非预期高层模态覆盖。
2. 保留 AI 单画布快照，用于验证既定的 AI 优先交互；
3. 为页面本体增加 companion 状态受控的独立快照，不能用“后方 DOM 存在”代替布局验收；
4. 新增以下状态级场景：
   - Settings Browser Token：720/840/900/1020px；
   - Creative ready：720×600、900×600、1280×600；
   - AI history 打开：841/900/1019px，并在打开后 resize；
   - Automation：720×600，验证列表、详情和控制台可达；
   - Confirm 长 body、cURL textarea 拉高、Select 靠近视口底部；
   - Chat 超长 URL/路径、多个 Context chips。

## 六、P3 与维护批次

这些内容原列为不阻塞 P1/P2 的维护批次，本轮已一并完成：

1. 删除或改写 `ai-console.css:1404-1434` 中被后续 `!important` 覆盖的旧 `.ai-workbench` 规则；当前 `.session-pane` 已不在生产组件树中，不把它描述成功能故障；
2. 逐个清理无生产 TSX 引用的旧 diff、settings config/runtime/skill packages、`.funnel-bar` 等选择器；
3. 为有 TSX 引用但没有 CSS 定义的 `.creative-warn` 补充明确样式，或确认不需要后移除 class；
4. 收敛 Creative 的 JS workspace 状态、旧 media breakpoint 和 feature 私有断点的 ownership，保留 React `compact-*` 为当前生效契约；
5. 为 toast stack 增加低高度下的最大高度/内部滚动兜底；
6. Analytics 84px 标签轨道已加入长平台名夹具，采用 ellipsis 并通过 `title` 保留完整内容；
7. History compare/version row 已加入长 note 和窄容器夹具；现有 ellipsis 未发生功能裁切，并补齐完整文本提示；
8. Slash 菜单已采用跟随 textarea 光标的 anchored popover 交互，覆盖多行、滚动、resize 和视口边缘场景。

## 七、明确不修改的项目

以下项目从最终缺陷清单移除：

- 窄屏时 AI 单画布接管页面；
- Daily Brief 不切换为 Creative 式互斥单栏；
- InlineAiBar “四个按钮同时出现”的假设；
- Markdown 表格 `min-width:640px` 配合局部横向滚动；
- Onboarding 720×600 所谓“断点空隙”；
- Lightbox 翻页按钮覆盖图片边缘；
- 没有生产入口的 `runs` 页面候选；
- 已有 ellipsis 且未溢出的 AI sidebar 标题“局促”问题；
- 未经运行态复现的 Settings/Skills 整体“761–1100px 必然遮挡”结论；
- “≤620/≤520 断点永远不可达”的绝对表述；zoom/显示缩放可能让 CSS 视口进入该区间。

## 八、实施顺序

### 批次 1：P1 与对应回归测试

1. Settings Token；
2. Creative `ready` 高度流；
3. AI history flyout；
4. Automation 低高度/窄宽布局；
5. 同步加入各自状态级视觉断言。

### 批次 2：浮层与弹窗基建

1. anchored popover 定位能力；
2. Select portal/翻转/钳制；
3. Confirm 和 cURL 弹层高度保护；
4. Context detail 复用定位能力。

### 批次 3：内容与触屏兜底

1. Chat 长字符串；
2. Context chips 溢出提示；
3. 最近会话触屏操作。

### 批次 4：门禁和维护清理

1. 全局补强 visual readiness 与遮挡检查；
2. 清理失效 CSS；
3. 收敛断点 ownership；
4. 处理 P3 夹具验证后确认的问题。

## 九、完成定义

本轮响应式修复只有同时满足以下条件才算完成：

- 4 个 P1 的运行态复现场景全部消失；
- P2 项各自具备对应的交互或长内容测试；
- 视觉矩阵覆盖宽度、最小高度、zoom、弹出态和组合态；
- 测试能区分“节点存在”和“用户实际可见/可操作”；
- `npm run typecheck`、相关单元/集成测试、`npm run build`、`npm run visual:snapshot`、`git diff --check` 通过；
- 没有改变“每日简报自动打开 AI、窄屏优先 AI”的产品行为。

## 十、实施结果（2026-08-27）

实施与验收：**Codex（OpenAI）**。

状态：**全部完成**。本清单的 P1、P2、视觉回归门禁与 P3 维护项均已落地：

1. Settings Browser Token 改为基于卡片可用宽度的 container query 单列降级；
2. Creative `ready` 阶段明确由详情容器管理纵向滚动，编辑器保留可用高度，并修复窄屏重新选择详情时的状态切换；
3. 抽取共用 anchored popover 定位能力，AI 历史、Select、Context detail 和 Slash 菜单共用 portal、翻转、视口钳制与 resize/scroll 重定位；AI 历史在触发器因 840/1020px 断点隐藏时同步关闭，不保留脱锚浮层；
4. Automation 窄屏单列布局改为可达内容流，列表、详情、运行历史和控制台不再被父容器裁切；
5. Confirm、Skills cURL editor 和 toast stack 增加低高度保护，操作区保持可达；
6. Chat 长 URL/路径/hash/base64 增加断行兜底，代码块仍保持自身横向滚动；
7. Context chips 增加真实溢出状态提示，最右侧 chip 的详情浮层也可通过鼠标、键盘和触屏完整查看，并验证 Escape 关闭及焦点返回；
8. 粗指针/触屏环境下最近会话操作常显，并使用 44px 触摸目标；视觉门禁通过真实 coarse pointer/touch 模拟验证；
9. 视觉快照门禁现在区分“DOM 存在”与“用户真实可见/可操作”，同时保留 AI 优先的产品快照并增加页面本体 companion 快照；P1 场景覆盖连续 resize、实际 Tab 焦点、滚动可达性和 1480/1481px Creative ownership 边界；
10. 清理了生产 TSX 零引用的旧 diff、settings config/runtime/skill packages、`.funnel-bar`、`.session-pane` 等样式，并为 `.creative-warn` 补充明确样式；
11. Creative 恢复可见的工作台/版本历史/发布记录/数据分析视图入口，并修复视图切换与项目选择之间的状态竞争；Analytics 长平台名使用 ellipsis 并保留完整 `title`，History 长版本备注同样可读取完整文本；
12. Slash 菜单改为跟随 textarea 当前光标定位，支持多行输入、滚动、resize/visual viewport 重定位和空间不足时向上翻转，同时保留现有键盘与 ARIA 交互。

产品约束保持不变：每日简报仍自动打开 AI，窄屏单画布仍优先显示 AI。

### 验证记录

| 命令 | 结果 |
|---|---|
| `npm run build` | 通过（包含 typecheck、renderer/electron build 和仓库检查） |
| `npm run test:unit` | 通过：138 个测试文件，1572 个用例 |
| `npm run test:integration` | 通过 |
| `npm run test:e2e` | 通过：Electron 隔离 fixture smoke |
| `npm run visual:snapshot` | 通过：50 张路由快照、60 个状态快照、0 失败 |
| `git diff --check` | 通过 |

上述命令均使用仓库要求的 Node.js `v22.12.0` 完成验证。
