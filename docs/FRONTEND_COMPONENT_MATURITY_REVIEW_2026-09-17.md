# 前端组件成熟度 Review

审查日期：2026-09-17；项目：OpenMind Desktop。

方式：只读代码审查、前端单元测试、静态规范检查、隔离 React 场景复现。审查和文档整理均未修改项目源码。

补充依据：对用户提供的 Zcode review 进行了源码与指标核对，将成立的发现合并到本文；具体采纳边界见第 7 节。

## 1. 总体判断

当前前端组件成熟度约为 **7/10：已有较成熟的产品基础，业务组件在保存、弹窗组合和异常恢复上仍有明显缺口。**

该评分是本轮工程判断，不代表测试覆盖率或发布认证。项目已有可复用的基础组件、响应式策略和性能架构，下一步应优先补齐业务状态边界及组件组合场景。

审查范围包括 `design-system`、应用外壳，以及 AI、项目、创作、设置、Skills、自动化、每日简报、文件预览和文档阅读等主要组件。本轮采用结构扫描和重点调用路径审查，不等同于逐行审查所有前端实现。

| 维度 | 判断 | 主要依据 |
| --- | --- | --- |
| TypeScript 卫生 | 较好 | 128 个生产 TS/TSX 文件未发现显式 `any`、`@ts-ignore`、`@ts-nocheck` 或 TODO/FIXME 标记；这些信号不能替代运行时契约验证 |
| 基础组件与复用 | 比较成熟 | 已有 Select、Tabs、Tooltip、虚拟列表、反馈和布局组件；业务表单及弹窗尚未完全统一 |
| 响应式与性能架构 | 比较成熟 | 共享布局策略、容器测量、文档 Worker、虚拟化、AI 分片订阅已落地 |
| 异步状态可靠性 | 中等 | 文件预览有版本校验和保存协调；创作编辑器仍采用另一套处理，存在保存竞态 |
| 键盘与可访问性 | 中等 | 有焦点管理基础，多个浮层组合时存在冲突，部分模态弹窗未隔离背景 |
| 可维护性 | 中等 | 部分文件聚集较多职责，跨组件传递大量状态 setter，样式依赖覆盖层 |
| 回归保障 | 比较扎实 | 前端单测全部通过，但遗漏了慢响应、重复确认和浮层组合场景；动效检查当前失败 |

## 2. 已有的成熟基础

- **共享 UI 基础层已形成。** 控件、反馈、布局、浮层定位、退场生命周期和容器测量均有专门实现及相关测试。见 [组件导出](/home/say/work/github/openmind-app/renderer/src/design-system/components.tsx:1)。
- **可访问性已有行为测试。** 测试覆盖焦点恢复、菜单 Tab 离开、160ms 退场期间的 `inert`，以及共享焦点栈的分层 Escape 归属。见 [Select.test.tsx](/home/say/work/github/openmind-app/renderer/src/design-system/Select.test.tsx:75)、[焦点栈测试](/home/say/work/github/openmind-app/renderer/src/design-system/use-modal-focus-scope.test.tsx:51)。这比仅验证能否渲染更扎实，但不能推导出所有业务弹窗接入正确；本轮也未验证实际读屏器行为。
- **大文件不等于单个巨型组件。** Settings 分区文件包含多个独立 section，Skills 文件包含多个目录、详情和编辑子组件，Chat 分离了时间线、过程与事件组件。当前 Chat 文件中的 `memo` 声明为 `Chat`、`TimelineItems`、`TraceStepList` 三个，不能沿用“7 个 memo 子组件”的数量。维护判断应依据职责和状态耦合，而非文件行数。
- **路由按特性懒加载。** 页面使用明确的动态 import，导航还支持 hover/focus 预加载。见 [route-registry.tsx](/home/say/work/github/openmind-app/renderer/src/app/route-registry.tsx:16)。预加载有助于首次切换体验，失败恢复仍需 FC-006 的异常边界。
- **跨进程边界清晰。** Renderer 通过 `window.openmind` 使用类型化 preload IPC，跨进程类型放在 `shared/`；本轮生产源码扫描未发现直接导入 Node 文件系统、Electron 或直接调用 provider 的实现。
- **文件预览的异步处理较完整。** 打开意图、请求序号、AbortController、编辑版本和保存协调用于避免旧请求覆盖新选择及旧保存清除新修改。见 [use-file-preview-controller.ts](/home/say/work/github/openmind-app/renderer/src/features/file-preview/use-file-preview-controller.ts:33)。
- **响应式拥有统一策略。** Electron 窗口约束与 Renderer 布局使用共享契约，嵌套组件可依据自身容器选择布局。见 [responsive-policy.ts](/home/say/work/github/openmind-app/shared/responsive-policy.ts:1)。
- **性能治理已有架构支撑。** AI 对话使用分片订阅、历史范围限制和工具组虚拟化，长文档使用 Worker 解析及虚拟渲染。见 [Chat.tsx](/home/say/work/github/openmind-app/renderer/src/features/ai-console/Chat.tsx:76)、[文档解析生命周期](/home/say/work/github/openmind-app/renderer/src/components/document/use-reading-document.ts:20)。这些是当前代码能力，本轮未重新测量 Electron 帧率。

## 3. 优先处理的问题

下列 FC-001 至 FC-005，以及补充核对时发现的 FC-007，已使用隔离 React 测试复现，共 6 个场景。IPC 使用模拟数据，保存和刷新场景模拟延迟响应，未读写开发者的真实内容仓库。FC-006 是静态代码检查确认的恢复缺口。

### FC-001 · P1 · 创作编辑器可能把尚未保存的新修改标记为已保存

**代码位置：** [CreativePage.tsx](/home/say/work/github/openmind-app/renderer/src/features/creative/CreativePage.tsx:178)。

自动保存完成后直接执行 `setDetail(next)`、`setDirty(false)` 和 `setAutoSaveStatus("saved")`，没有检查保存的草稿版本是否仍是当前编辑版本。手动保存也存在同样的版本校验缺口。

**已复现的过程：**

1. 编辑草稿 A，等待自动保存请求开始。
2. 请求尚未完成时继续编辑草稿 B。
3. 让 A 的保存响应返回，再等待超过自动保存间隔。
4. 编辑器仍显示 B，但界面显示“已自动保存”；保存请求只有一次，保存内容为 A。

A 的响应清除了 B 的脏状态，B 的待执行保存定时器随 effect 清理被取消。用户因此可能误以为最后一次修改已经持久化，离开页面后丢失修改。

**建议：** 协调自动保存与手动保存的顺序，仅在当前草稿与已保存版本一致时清除脏状态；保存响应还应校验项目和文件身份。优先复用已有文件预览保存协调能力，或提取范围明确的编辑保存 hook。

**验收：** 保存 A 期间编辑 B，A 返回后 B 仍处于未保存状态并继续保存；切换文件或项目后，旧保存响应不能覆盖新编辑器状态。

### FC-002 · P1 · 确认框与底层弹窗的 Escape 处理冲突

**代码位置：** [FeedbackHost.tsx](/home/say/work/github/openmind-app/renderer/src/components/FeedbackHost.tsx:21)、[use-modal-focus-scope.ts](/home/say/work/github/openmind-app/renderer/src/design-system/use-modal-focus-scope.ts:133)、[AiSidebar.tsx](/home/say/work/github/openmind-app/renderer/src/components/AiSidebar.tsx:163)。

共享焦点管理在 document 捕获阶段处理 Escape，并阻止事件传播；确认框另在 window 监听键盘，没有进入共享浮层管理体系。

**已复现：** 底层模态容器内打开确认框，在确认框按 Escape，先触发底层容器的关闭回调，确认框仍然存在。这与 AI 侧栏处于模态状态时再出现确认框的组合路径一致。

**影响：** 用户想取消当前确认，却关闭了底层表面；待确认操作没有得到预期的取消结果。

**建议：** 将确认框接入统一浮层与焦点管理，明确浮层优先级；危险确认仍应默认聚焦取消按钮。

**验收：** Escape 只关闭最上层确认框；Tab 留在确认框内；确认框关闭后焦点返回正确的底层触发元素。

### FC-003 · P2 · 重复确认请求会使先前的 Promise 一直等待

**代码位置：** [ai-context.tsx](/home/say/work/github/openmind-app/renderer/src/ai-context.tsx:676)。

`confirm()` 只保存单个 `confirmResolver`。第二次调用会覆盖第一次的 resolver，但不会结束第一次请求。

**已复现：** 连续调用两次 `confirm()`，随后确认当前对话框，第二个 Promise 返回 `true`，第一个 Promise 仍处于等待状态。

**影响：** 等待第一次确认的业务流程无法继续，可能表现为操作无响应或忙碌状态无法结束。

**建议：** 明确确认请求的排队或取消规则，保证每个请求最终都有结果。

**验收：** 连续触发确认时，没有悬空 Promise；取消、关闭和卸载均能正确结束对应请求。

### FC-004 · P2 · Select 的空值展示与真实状态不一致

**代码位置：** [Select.tsx](/home/say/work/github/openmind-app/renderer/src/design-system/Select.tsx:67)、[发布表单](/home/say/work/github/openmind-app/renderer/src/features/creative/panels.tsx:38)。

找不到匹配选项时，`selectedIndex` 被 `Math.max(0, ...)` 强制设为 0。按钮因此显示第一项，真实值却仍为空，placeholder 没有显示。

**已复现：** 传入 `value=""`、两个选项及 placeholder，按钮显示第一项 Alpha，原生代理 select 的值仍为 `""`。

发布表单使用空平台值，并以 `Boolean(platform)` 判断是否满足导出条件，可能出现“看起来已经选了平台，导出仍被禁用”。

**建议：** 将展示值与键盘导航的初始索引分开处理。空值或失效值显示 placeholder，打开菜单后再选择合适的导航起点。

**验收：** 空值不展示为已选第一项；真实值、可见标签与提交条件保持一致。

### FC-005 · P2 · 部分模态弹窗没有真正隔离背景

**代码位置：** [ProjectDialog.tsx](/home/say/work/github/openmind-app/renderer/src/features/projects/ProjectDialog.tsx:33)、[背景隔离实现](/home/say/work/github/openmind-app/renderer/src/design-system/use-modal-focus-scope.ts:117)。

`ProjectDialog` 将焦点管理 ref 放在内层 section。共享 hook 只隔离该容器的直接兄弟节点；section 的父节点是遮罩，因此不会隔离外部页面。

**已复现：** 弹窗声明 `aria-modal="true"`，背景按钮及所在页面仍未处于 `inert` 范围内。

**影响：** 模态声明与实际背景隔离不一致。类似接入方式也出现在部分 Skills 编辑浮层，应一并核查。

**建议：** 统一弹窗外层与焦点管理的接入方式，让背景隔离覆盖正确的 DOM 范围，并保留焦点恢复和退场交互隔离。

**验收：** 弹窗打开期间背景被隔离；关闭后恢复原有状态；嵌套浮层不会过早解除背景隔离。

### FC-006 · P2 · 缺少组件异常后的恢复界面

**代码位置：** [main.tsx](/home/say/work/github/openmind-app/renderer/src/main.tsx:10)、[路由容器](/home/say/work/github/openmind-app/renderer/src/App.tsx:251)。

入口和路由使用了 Suspense，但生产 Renderer 中未发现 ErrorBoundary。Suspense 提供加载等待界面，当前代码缺少组件渲染抛错或 lazy 导入失败后的恢复界面。

**影响：** 单个页面的异常可能扩大到整个 React 根节点，缺少保留应用外壳、展示错误和恢复操作的路径。这是代码层面的风险，本轮未在 Electron 中注入异常。

**建议：** 设置应用级兜底与路由级异常边界，提供明确的错误反馈及返回、重试或重新加载操作。

**验收：** 页面渲染异常或 lazy 导入失败时有可操作的恢复界面；页面级故障尽可能保留应用外壳。

### FC-007 · P2 · 较旧的刷新结果可以覆盖较新的状态

**代码位置：** [AutomationPage.tsx](/home/say/work/github/openmind-app/renderer/src/features/automation/AutomationPage.tsx:36)、[事件驱动刷新](/home/say/work/github/openmind-app/renderer/src/features/automation/AutomationPage.tsx:67)。

自动化页可由多个终态事件触发刷新，`load()` 未校验请求序号。所有请求都可以更新数据、错误和 loading 状态，较旧请求晚返回时会覆盖较新结果。

**已复现的过程：**

1. 初次加载完成后，触发刷新 A，并让其保持等待。
2. 再触发刷新 B，让 B 成功完成，此时页面没有错误。
3. 让 A 返回失败，页面显示 A 的错误，覆盖 B 已成功完成的状态。

**影响：** 页面可能显示过期数据或错误；某个旧请求结束还可能在新请求仍进行时提前清除 loading。

**建议：** 先为实际可并发的加载路径增加请求序号、资源身份和卸载后的写回保护。若多个调用具有相同生命周期契约，再提取小型 `useAsyncResource` 或等价 hook；保留各业务自己的数据合并、脏稿保护和刷新策略。

当前跨进程 API 返回普通 Promise，例如 `listAutomationRules()` 和 `listProjects()` 没有 `AbortSignal` 参数。前端保护可以忽略过期响应，但仅增加 AbortController 不会自动取消主进程的 IPC 工作。

**验收：** B 成功后 A 的成功或失败都不能覆盖 B；loading 与有效请求对应；卸载或资源身份切换后不再写回旧状态。

## 4. 工程规范与维护成本

### 共享弹窗应优先收敛，其他原语按需补齐

设计系统尚无通用 `Dialog`、`Button`、`TextField`。项目模块已有业务级 `ProjectDialog` 和 `ProjectTextField`，因此不能概括为整个项目没有弹窗或字段封装。

最值得采纳的是共享 Dialog：确认框、设置弹窗、Skills 编辑器和项目弹窗分别组合遮罩、焦点管理和退出生命周期，已经出现 FC-002、FC-005 的实际问题。Skills 导入浮层还直接使用了 `settings-provider-dialog-scrim`、`settings-provider-dialog` 等其他特性的样式类，通用弹窗样式所有权不清晰。见 [SkillsPage.tsx](/home/say/work/github/openmind-app/renderer/src/features/skills/SkillsPage.tsx:502)。

建议共享弹窗外层负责 portal、焦点范围、Escape、背景隔离、退场交互隔离和命名关联；业务组件保留表单内容、危险操作默认焦点及提交逻辑。可随 P1 修复收敛同类表面，不要求一次迁移全部弹窗。

Button 可在 loading、disabled、图标命名和默认 `type` 等行为反复实现时引入。TextField 则应在错误关联、提示文本与验证规则有共同需求时补齐。原生 `<button>` 本身不是架构违规，已有 CSS 与语义类也承担了统一反馈，不能用裸标签数量直接证明需要全面替换。

`PageHeader` 确实仅被 Creative 使用，但其他页面标题承担了不同的导航和详情职责，未发现“四个页面逐字节相同”的依据。原生 select 与自定义 Select 的混用也属实，但原生控件本身有完整语义与表单行为，应按一致性需求选择；先修复 FC-004，再决定迁移范围。

### 重复加载模式值得统一保护，不宜统一全部业务逻辑

静态核对发现 **11 个**使用 `setLoading(true)`、try/catch/finally、`setLoading(false)` 的加载回调，分布于 Automation、Creative、Daily Brief、Projects 的多个面板、Runs、Settings 和 Skills。数量指回调，不能称为 11 个独立特性域。

公共生命周期确有重复，FC-007 也证明缺少请求新旧校验会影响实际显示。但是这些回调并非逐字相同：Daily Brief 保留脏稿，Project Materials 会继续打开选中的资料，Skills 支持后台刷新和优先选择项，Settings 还应用主题及加载其他配置。

应优先统一请求保护、错误和 loading 的归属，保留业务语义。仅在卸载后尝试更新 React state，不能直接推导出用户可见缺陷或内存泄漏；需要结合未清理订阅、持续任务或资源切换证明影响。

### AI Provider 的职责边界需要改善

[AiProvider](/home/say/work/github/openmind-app/renderer/src/ai-context.tsx:417) 的函数跨度约 601 行，使用 18 个 `useState`；同一 provider 管理快照、会话事件、流式状态、草稿、上下文引用、面板及通用反馈。Toast 和确认框也依赖它，扩大了 AI 与普通业务 UI 之间的耦合。

值得采纳的是将通用 toast/confirm 与 AI 状态区分，先提取反馈状态和请求协调，再视复用需要迁入独立反馈 provider。会话、流式、草稿可进一步整理，但无需预先固定为“三个 hook”的拆分方案。

现有实现已经有 7 个分片 context，事件泵和草稿存储也有独立工厂。应保留分片订阅、草稿作用域和动作引用稳定性；当前证据支持职责问题，不能据此判定整个应用仍存在流式全局重渲染，也不能保证拆分一定提升性能。

### 动效检查当前失败

`npm run motion:check` 实际报告：

- 2 处裸动效时长，位于 [markdown-editor.css](/home/say/work/github/openmind-app/renderer/src/styles/features/markdown-editor.css:43) 的第 43、140 行。
- 3 处按钮声明违规，位于 [ArtifactMessageBlock.tsx](/home/say/work/github/openmind-app/renderer/src/features/ai-console/ArtifactMessageBlock.tsx:42) 的第 42 行，以及 [MilkdownEditor.tsx](/home/say/work/github/openmind-app/renderer/src/features/creative/MilkdownEditor.tsx:87) 的第 87、91 行。

这些是现有静态契约的违规，不直接证明实际按钮完全没有动效。建议补齐 token 与语义声明并核对实际反馈，保留已有动效。

脚本还对 `final-polish.css` 的裸 transition 检查实行整文件豁免，而非仅豁免指定旧声明。后续可将例外收敛为具体声明或基线，避免新增违规被一并放过。见 [motion-contract-check.js](/home/say/work/github/openmind-app/scripts/motion-contract-check.js:37)。这项检查通过也不代表运行时动效与可访问性全部通过。

### 文案规范尚未稳定覆盖新增组件

`audit:ui-copy-hardcode` 扫描 127 个生产 Renderer TS/TSX 文件，报告 **424 处直接中文字符串候选**，主要集中在项目模块与 Markdown 编辑运行时。脚本当前只输出报告，不阻止此类代码进入项目。

候选数量不等同于实际 UI 缺陷数量，应结合用途逐项判断。建议优先将新增组件的用户可见文案收敛到现有 `shared/messages`，再为整理后的范围建立回归约束。

可将文案审计升级为基线与新增候选审核，或对明确的用户可见文案范围建立门禁。单一总量阈值会允许删除旧候选后再引入新候选，不足以防止具体位置漂移；也不应直接将 424 个字符串全部判为违规。

### 组件职责与样式所有权仍可收敛

Skills、设置分区、composer 和 AI 状态模块存在千行以上文件；部分文件包含多个组件和辅助函数，不能仅凭文件长度认定为单个巨型组件。

更直接的维护压力来自业务状态、IPC 调用与 UI 生命周期在同一文件聚集，以及 [CreativeDetailPane.tsx](/home/say/work/github/openmind-app/renderer/src/features/creative/CreativeDetailPane.tsx:21) 跨层接收较多状态和 setter。创作编辑器与文件预览各自处理保存，也增加了状态规则不一致的机会。

样式已有特性分层，同时 [product.css](/home/say/work/github/openmind-app/renderer/src/styles/product.css:1) 后加载的产品皮肤与修饰层覆盖基础样式。这是有意设计，但长期维护应明确组件样式与主题 token 的所有权。

主入口本地 CSS import 图包含 19 个文件，合计 **17,784 行**，包含空行与注释，不含依赖包 CSS。`product.css` 有 17 条 import，皮肤层 `workbuddy-refactor.css` 为 3,371 行，`final-polish.css` 为 320 行，覆盖顺序确实增加了查找最终样式的成本。

以 PostCSS 声明解析及默认 `:root` 的去重名称为口径，基础样式有 132 个 token；皮肤层声明 77 个，其中 **43 个**与基础层同名，34 个同名 token 的默认值不同。不能沿用“132 个中重声明了 82 个”的数量。明暗主题覆盖本身是正常机制，也不能仅因覆盖存在就认定为第二真源。

应按主题、通用组件和业务样式逐块明确所有权。主观认定所有皮肤覆盖都应下沉到 feature，或一口气删除覆盖层，会改变既有视觉效果；全局交互规则应留在通用样式范围。迁移主题 token 时还需同步更新直接读取皮肤文件的 [对比度检查](/home/say/work/github/openmind-app/scripts/color-contrast-contract-check.js:4)，并用视觉及交互检查验证等价性。

建议在修复实际问题时提取对应业务 hook、减少跨层可变状态，并逐步整理样式所有权。上述维护项属于后续收敛方向，不应先于保存和确认框问题进行大范围拆分。

## 5. 验证结果与边界

以下结果来自 2026-09-17 本次 Review 的实际执行。补充核对时重新运行了动效、字号、对比度及文案检查，另执行 1 个刷新竞态复现场景；类型检查和前端全套测试沿用本次初次 Review 的执行结果，未重复运行。

| 检查 | 结果 | 含义 |
| --- | --- | --- |
| `npm run typecheck` | 通过 | Renderer、shared 与 Electron 的类型检查通过 |
| `npx vitest run renderer/src --reporter=dot` | 通过 | 75 个前端测试文件、776 个测试全部通过 |
| 初次隔离 React 复现测试 | 5 个场景确认 | 确认 FC-001 至 FC-005 的现有错误行为 |
| 补充刷新竞态复现测试 | 1 个场景确认 | 确认 FC-007：旧刷新失败覆盖新刷新成功状态 |
| `npm run motion:check` | 失败 | 2 处裸动效时长、3 处按钮声明违规 |
| `npm run typography:check` | 通过 | 现有静态字号契约通过 |
| `npm run color:check` | 通过 | 脚本检查的 `--muted-2` 在产品表面上的对比度契约通过，不代表完整视觉可访问性检查 |
| `audit:responsive-hardcode` | 报告模式完成 | 扫描 148 个生产 Renderer 文件，报告 1 个候选；该候选不能直接视为响应式缺陷 |
| `audit:ui-copy-hardcode` | 报告模式完成 | 扫描 127 个生产 Renderer TS/TSX 文件，报告 424 个直接中文字符串候选 |

复现测试的断言用于确认问题现状，因此“测试通过”表示成功观察到错误行为，不表示对应业务行为正确。临时复现用例未加入项目测试目录。

补充指标核对的口径：

- Renderer 共 203 个 TS/TSX 文件，其中 128 个生产源码文件、75 个测试文件。同目录同名的测试能对应 60 个生产文件；测试还可能覆盖其他文件，因此这些数量都不是测试覆盖率。
- TypeScript AST 显式 `any` 在生产源码为 0，在全部 Renderer（含测试）为 5。“全 Renderer 0 个 any”的表述不成立。
- 生产源码未发现 `@ts-ignore`、`@ts-nocheck` 或 TODO/FIXME 标记。这是良好的工程卫生信号，不能证明无隐式逻辑错误或跨进程契约问题。
- JSX AST 核对：`PageHeader` 使用 1 处；Runs 有 10 处原生 button、3 处原生 select；设置分区文件有 5 处原生 select。设计系统 Select 内的原生代理不算业务绕过。
- CSS 主入口图为 19 个本地文件、17,784 行；Renderer 全部 20 个本地 CSS 文件共 17,937 行，包含一个未进入主入口 import 图的旧编辑器样式文件。行数不代表实际打包体积或性能成本。

本轮未执行完整 `npm run verify`、完整后端单元测试、集成测试、Electron E2E、视觉矩阵、帧率重测及跨平台验证。现有前端测试通过不能据此解释为完整发布门禁通过。

## 6. 建议处理顺序

1. **先处理两个 P1：** 修复创作保存竞态，统一确认框与底层浮层的键盘、焦点和关闭顺序；可随修复提取共享 Dialog 外层。
2. **补齐组件与异步契约：** 处理重复确认、Select 空值、模态背景隔离、异常恢复和刷新竞态，将 6 个已复现场景加入回归测试；通用加载 hook 以真实共同需求为边界。
3. **落实现有工程规范：** 修复动效契约违规，收敛整文件豁免，建立文案新增候选约束。类型卫生已经较好，优先增加组合与延迟响应验证。
4. **按业务修改收敛结构：** 分离通用反馈职责，减少跨层可变状态；逐块明确主题、组件与业务样式所有权。Button、TextField 及更大范围的 Provider 拆分按复用需求推进。

基础组件已有足够支撑，当前收益最大的工作是补齐以上边界，并让回归测试覆盖真实的编辑过程、延迟响应和组件组合。

## 7. Zcode review 的采纳与修正

| 外部结论或建议 | 判断 | 本文采用的范围 |
| --- | --- | --- |
| 类型卫生好、测试重行为、大文件多数含多个子组件 | 采纳并校正口径 | 纳入成熟基础；0 个 any 限于生产源码，文件数量比不当作覆盖率，未采用未经核实的子组件数量 |
| 优先补共享 Dialog | 采纳 | 结合 Escape 冲突、背景隔离和跨特性样式依赖，随实际问题收敛弹窗契约 |
| 同时全面补 Button/TextField、替换原生标签 | 部分采纳 | 原语按行为重复与复用需求引入；不将原生标签或控件混用直接认定为缺陷 |
| 11 个 load 克隆用 useAsyncResource 一次消除 | 部分采纳 | 11 个加载回调的公共模式属实，新旧结果保护已有复现依据；保留不同业务语义，不作统一机械替换 |
| AiProvider 是职责过重的 context | 采纳职责判断 | 优先分离 toast/confirm；保留现有分片订阅，未据此判定流式重渲染存在问题或承诺拆分后的性能收益 |
| CSS 覆盖层需要退役并迁移 82 个 token | 部分采纳 | 采纳样式所有权整理，修正 token 数量；主题覆盖有合理用途，渐进迁移需视觉等价验证 |
| 文案审计应升级为 gate | 采纳方向 | 采用具体基线与新增候选约束，先判断用户可见范围，不仅设置总量阈值 |
| 补应用级与路由级 ErrorBoundary | 采纳 | 与 FC-006 一致，补恢复路径；ErrorBoundary 不能替代异步 IPC 的错误处理 |
| 设计系统可访问性已经完整、工程卫生优于同类项目 | 不采用该强度判断 | 已有行为基础，但组合缺陷已复现，实际读屏器和同类项目对比未验证 |

补充结论不改变 P1 的优先级。共享组件和职责拆分应服务于已确认的边界问题，具体模块数、裸标签数、CSS 字面量数不单独作为大范围重构的依据。
