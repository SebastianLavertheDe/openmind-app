# OpenMind Desktop Motion Audit

审查日期：2026-09-14

审查类型：先完成只读审查；经确认后实施首轮改进（完成项以“✅ 已完成”标记）

审查范围：Shell、导航、AI Console、Projects、Daily Brief、Creative、Automation、Runs、Settings、Skills、Onboarding、共享 Design System、响应式布局与分栏拖拽

## 1. 结论

当前项目并不缺少基础动效。Hover、Press、共享浮层、AI 流式输出、拖拽调整等基础设施已经比较成熟。真正影响体验的是少数业务状态没有完整表达：

- 操作已经被接收，但界面没有持续的 pending 反馈；
- 切换内容时短暂显示错误空状态或上一条记录；
- 自定义浮层只有进入动画，没有退出动画；
- 少数列表重排、删除直接跳到最终位置；
- 个别局部 spring/scale 动效略显活跃，应当收敛，而不是继续增加动画。

本次共识别 4 项 P0、10 项 P1、8 项 P2。P0 都应先补状态模型，再添加过渡；不能只靠 CSS 动画掩盖状态缺失。

建议实际实施范围：全部 P0；P1 优先处理 Creative/会话 loading、Focus、自定义 Dialog 退出、限定范围的 AI/文件预览退出和 Projects 单栏列表/详情切换。P2 只建议先做 Select 退出计时与 Segmented 首帧这两项实现级修正，其余默认不实施。

实施更新：已完成 4 项 P0、8 项 P1 和 2 项 P2。P1-2 列表 FLIP、P1-3 Context Tray，以及其余低收益 P2 均未为了“增加动效”而顺带实施，继续保留为未完成建议。

说明：各问题中的“当前交互行为 / 存在的问题”保留初次审查时的基线描述，实施状态以标题中的“✅ 已完成”和第 7 节复选框为准。

## 2. 审查与验证方法

本轮以当前工作树为准，通读 Renderer 的交互状态、条件渲染、异步处理和样式规则，并结合现有 Electron 视觉矩阵核对主要界面。

初次审查阶段已执行：

- `npm run build:renderer`：通过；
- `npm run motion:check`：通过，0 个裸 transition 违规，0 个缺少 press variant 的可点击项；
- `npm run visual:snapshot`：55 个尺寸截图、67 个状态截图，0 失败；
- 机器可读结果：`.build/visual-snapshot-report.json`；
- 初次审查结束时业务代码未被修改；后续实现是在用户确认后单独进行。

实施后已执行：

- `npm run typecheck`：通过；
- `npm run build:renderer`：通过；
- `npm run motion:check`：通过，0 个裸 transition 违规，0 个缺少 press variant 的可点击项；
- 对应 Renderer 组件与 delayed Promise 交互测试：通过；
- `npm run visual:snapshot`：55 张截图，0 失败，报告位于 `.build/visual-snapshot-report.json`；
- `git diff --check`：通过；
- `npm run test:unit`：1952 个通过、3 个跳过；仅 1 个不在本次 UI 修改范围内的 `daily-article-summarizer` Skill 链路用例失败（运行日志显示成功处理 1 篇，但输出文件统计为 0 篇），定向复跑可稳定复现；与本次改动有关的 Renderer 用例全部通过，未在 Motion Audit 中越界修改该 Skill。

需要注意：`scripts/motion-contract-check.js` 只检查 duration/easing token 和可点击项的 press contract，不检查业务 pending、旧内容残留或退出连续性。静态截图也不是动效录屏，因此下列时序问题主要由组件状态流和异步代码确认。

Projects 和 Runs 当前不在 55 张标准页面截图中；相关结论来自实际代码路径与状态切换审查，没有把静态截图冒充成时序证据。

## 3. P0：缺少反馈可能让用户误认为操作没有生效

### P0-1 高影响异步命令缺少本地 pending 状态（✅ 已完成）

- 所在页面 / 组件：AI Composer Stop（`renderer/src/features/ai-console/composer.tsx:594`、`renderer/src/ai-context.tsx:864`）；Automation Run/Stop（`renderer/src/features/automation/AutomationPage.tsx:160`）；Runs Cancel/Retry/Delete/Retry Step（`renderer/src/features/runs/RunsPage.tsx:91`）；Creative 创建草稿（`renderer/src/features/creative/CreativePage.tsx:197`、`renderer/src/features/creative/panels.tsx:24`）。
- 当前交互行为：点击后直接等待 IPC 或异步请求，按钮通常维持原图标和原文案；部分按钮仍可重复点击。Runs 仅 Resume 单独实现了 busy。AI Stop 成功/取消事件到达时还会立即 `streamingStore.clearRun(runId)`，未完成的 transient 文本在同一状态切换中消失。
- 存在的问题：现有 press 反馈约 140ms，I/O 可能持续数秒。按压结束后界面恢复原样，用户可能认为操作没有生效，Stop/Retry 等操作尤其容易被重复触发；Stop 后半截文本硬清除也容易被理解为异常丢失，而不是“生成已停止”。
- 为什么需要动效：这里首先需要的是可持续的状态确认，动效用于让 idle → pending → result 的切换可感知，而不是替代状态。
- 推荐动效：点击同步进入 `starting / stopping / retrying / creating`；禁用重复操作并设置 `aria-busy`；图标和文字短 crossfade；失败恢复原状态并沿用现有 Toast。AI Stop 完成时，在“已取消”状态出现的同时为当前可见 transient 文本保留一个只用于退出的 UI snapshot，短淡出后再清除；不要把它伪装成最终答案。是否把半截内容持久化为可回看的“未完成回复”属于单独产品决策。
- 建议 duration：旧图标退出 80–100ms，新状态进入 100–140ms；transient 文本退出 120–160ms，不额外驻留。
- 建议 easing：退出用 `--ease-exit`，进入用 `--ease-standard`。
- 推荐属性：`opacity`，可选 `transform: scale(.96) → scale(1)`；不要移动整个按钮。
- 是否值得做：是，第一优先级。

### P0-2 Projects 打开项目没有即时选中或 loading（✅ 已完成）

- 所在页面 / 组件：`renderer/src/features/projects/ProjectsPage.tsx:171`、项目行 `renderer/src/features/projects/ProjectsPage.tsx:492`。
- 当前交互行为：`openProject` 先等待 `projectsApi.getProject`，成功后才设置 `activeProject`。
- 存在的问题：慢磁盘或大项目下，按压反馈结束后列表和详情都不变化，用户很容易再次点击或认为第一次点击无效。
- 为什么需要动效：需要把“点击意图已被接受”和“项目内容仍在读取”两个状态明确串起来。
- 推荐动效：增加 `openingProjectName`；目标行立即进入 pending-selected 并显示小型 spinner；旧详情变为不可交互并轻微降透明度；超过约 100ms 再显示详情骨架；加载完成后 crossfade 到目标项目，失败时恢复原项目。
- 建议 duration：行状态 100–120ms；详情 140–160ms。
- 建议 easing：`--ease-standard`；失败恢复可用 `--ease-exit`。
- 推荐属性：`background-color`、`opacity`；不改变列表或工作区位置。
- 是否值得做：是。

### P0-3 Daily Brief 文件切换会闪出错误空状态（✅ 已完成）

- 所在页面 / 组件：`renderer/src/features/daily-brief/DailyBriefPage.tsx:61`、详情渲染 `renderer/src/features/daily-brief/DailyBriefPage.tsx:164`、`renderer/src/features/file-preview/file-preview-state.ts:49`。
- 当前交互行为：打开新文件时 reducer 立即清空 `resource` 并进入 loading，但 `selectedPath` 要在成功后才更新；详情区没有单独的 loading 分支，因而落入“请选择文件”的空状态。
- 存在的问题：用户点击新文件后，旧行仍保持选中，详情却闪成错误空状态。既破坏空间连续性，也像文件没有打开。
- 为什么需要动效：文件切换需要明确表达目标文件、加载阶段和内容到达，不能让 loading 看起来像“未选择”。
- 推荐动效：在放弃修改确认通过后立即设置 `pendingPath`；目标行进入 pending；旧详情淡出并显示“正在打开……”遮罩；快速请求可以跳过骨架；新资源 ready 后只做内容 crossfade，不做整页滑动。
- 建议 duration：淡出 100ms，淡入 140–160ms。
- 建议 easing：退出 `--ease-exit`，进入 `--ease-standard`。
- 推荐属性：`opacity`；必要时只动画 loading 遮罩。
- 是否值得做：是。

### P0-4 Runs 切换记录时可能短暂显示上一条事件（✅ 已完成）

- 所在页面 / 组件：`renderer/src/features/runs/RunsPage.tsx:79`、事件区 `renderer/src/features/runs/RunsPage.tsx:199`。
- 当前交互行为：选择另一个 Skill Run 后异步读取 events，但读取前没有清空上一条 Run 的 events。
- 存在的问题：新 Run 的标题已经出现，事件区却可能暂时展示上一条 Run 的内容。这首先是状态正确性问题，而不是纯视觉问题。
- 为什么需要动效：需要明确告知用户事件区正在切换目标，避免把旧数据误认为新 Run 的结果。
- 推荐动效：选择后立即设置 `eventsLoading` 并移除旧 events；显示与新 Run 绑定的 loading 状态；返回后淡入。旧内容不能在无标识的情况下继续显示。
- 建议 duration：旧内容退出 80–100ms，新内容进入 120–160ms。
- 建议 easing：退出 `--ease-exit`，进入 `--ease-standard`。
- 推荐属性：`opacity`；不使用位移。
- 是否值得做：是，必须先修状态。

## 4. P1：明显改善交互连续性和产品质感

### P1-1 Creative 项目详情错误复用“未选择”空状态（✅ 已完成）

- 所在页面 / 组件：`renderer/src/features/creative/CreativePage.tsx:126`、`renderer/src/features/creative/CreativeDetailPane.tsx:137`。
- 当前交互行为：选中项目后立即 `setDetail(null)`，异步读取完成前显示“从左侧选择”的空状态。
- 存在的问题：目标项目已经选中，详情却表达为“未选择”，状态语义错误并产生闪烁。
- 为什么需要动效：选中 → loading → ready 应当是一条连续状态链。
- 推荐动效：增加明确的 detail-loading，保留项目名和阶段；显示详情骨架，ready 后从列表方向做极轻的进入。
- 建议 duration：140–180ms。
- 建议 easing：`--ease-standard`。
- 推荐属性：`opacity`，最多 `translateX(4px)`。
- 是否值得做：是。

### P1-2 Projects、Recent Tasks、项目文件列表结构变化瞬移

- 所在页面 / 组件：Projects 收藏/归档 `renderer/src/features/projects/ProjectsPage.tsx:226`；Recent Tasks Pin/Archive `renderer/src/app/SidebarRecent.tsx:40`；项目文件删除/移动 `renderer/src/features/projects/ProjectFilesPanel.tsx:200`。
- 当前交互行为：操作已有 busy 和 Toast，但收藏会瞬间跨组，Pin 会瞬间换序，归档、删除或移动会直接移除原行。
- 存在的问题：用户看得到结果，却难以追踪元素去了哪里；保留行也会直接跳到新位置。
- 为什么需要动效：列表结构变化需要最低限度的空间连续性，帮助视线保持在同一个对象上。
- 推荐动效：删除使用现有 `useExitingList`；保留项使用 FLIP transform；新增只做短淡入。单次业务操作不要重新播放整组 stagger。
- 建议 duration：移位 180–220ms；删除 140–180ms。
- 建议 easing：移位 `--ease-standard`，删除 `--ease-exit`。
- 推荐属性：`transform`、`opacity`、`grid-template-rows`。
- 是否值得做：是。

### P1-3 AI Context Tray 拖拽和移除缺少落位反馈

- 所在页面 / 组件：`renderer/src/features/ai-console/composer.tsx:738`、`renderer/src/features/ai-console/composer.tsx:912`、`renderer/src/styles.css:1337`。
- 当前交互行为：拖拽时只把当前 chip 降至 0.5 opacity；Drop 后直接修改数组顺序，没有目标槽提示，移除也立即完成。
- 存在的问题：用户不能预判释放后的位置，其他 chip 也会瞬间重排。
- 为什么需要动效：这是直接操控场景，界面应当跟随指针，并让目标位置和最终落位可见。
- 推荐动效：指针移动期间保持 1:1 跟手并关闭 transition；目标槽显示克制的插入线；Drop 后 FLIP 到最终位置；删除短淡出并收起空间。
- 建议 duration：插入提示 80ms；Drop 160–180ms；删除 120–140ms。
- 建议 easing：Drop `--ease-standard`，删除 `--ease-exit`。
- 推荐属性：`transform`、`opacity`。
- 是否值得做：是。

### P1-4 自定义 Dialog 只有进入，没有退出（✅ 已完成）

- 所在页面 / 组件：Project Dialog `renderer/src/features/projects/ProjectDialog.tsx:34`；Settings Provider Dialog `renderer/src/features/settings/settings-sections.tsx:262`；Skills Source Dialog/Editor `renderer/src/features/skills/SkillsPage.tsx:498`、`renderer/src/features/skills/SkillsPage.tsx:1061`。
- 当前交互行为：组件直接条件挂载和卸载。Project Dialog 只有进入 keyframe；Settings 和 Skills 虽使用 `.ui-overlay`，但关闭时没有保留 DOM 播放 `data-leaving`。
- 存在的问题：出现时有重量，消失时却在一帧内完成，进出不对称。
- 为什么需要动效：Dialog 是独立空间，退出过程帮助用户理解它关闭并回到原上下文。
- 推荐动效：复用现有 `useExitPresence`；关闭时先淡出面板和 scrim，再卸载；保留现有焦点恢复逻辑。
- 建议 duration：进入维持 180–200ms，退出 140–160ms。
- 建议 easing：进入 `--ease-emphasized`，退出 `--ease-exit`。
- 推荐属性：`opacity`，面板可加 `translateY(4–6px)` 或 `scale(.99)`。
- 是否值得做：是。

### P1-5 Source Workspace 与 AI Workspace、Standalone 文件预览缺少退出连续性（✅ 已完成）

- 所在页面 / 组件：Projects Files/Tasks 联动 `renderer/src/features/projects/ProjectsPage.tsx:117`；AiSidebar rail/aside 切换 `renderer/src/components/AiSidebar.tsx:235`；Standalone Preview `renderer/src/App.tsx:241`、`renderer/src/components/WorkspaceFilePreview.tsx:51`。
- 当前交互行为：Projects 的 Files/Tasks 会自动展开或折叠 AI；AiSidebar 在 rail 和 aside 之间直接替换；floating/canvas AI 和 standalone preview 有进入效果，但关闭时直接卸载。
- 存在的问题：浮层或全画布表面消失时缺少去向；Source/AI 之间的关系会显得突然。
- 为什么需要动效：这些表面存在明确的来源与返回目标，适合用小幅横移和透明度表达空间关系。
- 推荐动效：只对 floating/full/canvas AI 和 standalone preview 增加 exit presence；AI 向右轻移并淡出，rail 短淡入；Standalone Preview 仅淡出。桌面 docked 模式保持一次性布局提交，不动画 grid 宽度。
- 建议 duration：文件预览 140–160ms；AI 浮层 160–200ms。
- 建议 easing：`--ease-exit`；rail 进入用 `--ease-standard`。
- 推荐属性：`opacity`、`translateX(6–8px)`，可选 `scale(.995)`。
- 是否值得做：是，但必须限定范围。

### P1-6 少数输入框 Focus 状态不可见（✅ 已完成）

- 所在页面 / 组件：Daily Brief 搜索 `renderer/src/styles/workbuddy-refactor.css:740`；Project Dialog 字段 `renderer/src/styles/features/projects.css:810`。
- 当前交互行为：全局已有 `:focus-visible`，但 Daily Brief 的后置 input 规则把 outline 清掉且容器没有 `:focus-within`；Project Dialog 字段明确把 focus 的 outline 和 shadow 都设置为 none。
- 存在的问题：键盘用户很难确认当前焦点，状态变化缺少视觉反馈。
- 为什么需要动效：Focus 必须在同一帧进入明确状态，短过渡只用于避免边框和 ring 生硬闪变。
- 推荐动效：在容器或字段上增加细边框与低透明 focus ring；不做缩放或位移。
- 建议 duration：100–140ms。
- 建议 easing：`--ease-standard`。
- 推荐属性：`border-color`、`box-shadow`、轻微 `background-color`。
- 是否值得做：是，兼具可访问性价值。

### P1-7 AI 会话切换缺少 session-bound loading（✅ 已完成）

- 所在页面 / 组件：会话选择 `renderer/src/ai-context.tsx:578`、events 读取 `renderer/src/ai-context.tsx:448`、时间线重挂载 `renderer/src/features/ai-console/Chat.tsx:294`。
- 当前交互行为：点击历史会话后立即切换 `activeSessionId`，未缓存的会话在 `loadEvents` 返回前使用空 events；`TimelineItems` 又按 `sessionId` 重挂载，并把首次收到的整批条目视为已提交内容。
- 存在的问题：标题和选择态先切换，正文可能短暂空白，数据返回后整批瞬现；旧会话、新会话和 loading 三者没有形成可辨认的状态链。
- 为什么需要动效：这是 AI 主路径的高频上下文切换，需要让用户明确知道“目标会话已选中，内容仍在读取”，同时避免把旧会话内容误挂在新标题下。
- 推荐动效：选择态和标题立即更新；为目标 `sessionId` 设置独立 loading，内容区维持稳定尺寸；超过约 100ms 才显示 2–3 行中性骨架以避免快速请求闪烁；events 到达后对整个会话容器做一次淡入。不要逐条重播历史消息，也不要在新标题下保留无标识的旧内容。
- 建议 duration：loading 延迟阈值约 100ms；内容进入 140–180ms。
- 建议 easing：`--ease-standard`。
- 推荐属性：`opacity`；骨架只使用现有 shimmer，不增加位移 stagger。
- 是否值得做：是，高频且能同时改善状态正确性与连续性。

### P1-8 Projects 单栏列表与详情直接互换（✅ 已完成）

- 所在页面 / 组件：`renderer/src/features/projects/ProjectListDetail.tsx:26`、`renderer/src/styles/features/projects.css:534`。
- 当前交互行为：单栏模式通过 `showList` / `showDetail` 直接条件挂载列表或详情；进入详情和返回列表都在一帧内完成。Split 模式则持续显示两侧，并由 splitter 直接提交列宽。
- 存在的问题：单栏中的 Back 操作缺少空间去向，列表和详情像两个无关系的页面突然替换。
- 为什么需要动效：两者有清晰的父子空间关系，极小幅方向提示能帮助用户理解“进入详情 / 返回列表”。
- 推荐动效：只在 `single` 模式接入 exit presence；列表→详情、详情→列表使用相反方向的 4–6px 位移加淡入淡出。Split/docked 模式维持离散列宽提交；不要动画 `grid-template-columns`，除非先通过真实长文档/PDF resize 基准。
- 建议 duration：退出 140–160ms，进入 160–180ms。
- 建议 easing：退出 `--ease-exit`，进入 `--ease-standard`。
- 推荐属性：`opacity`、`translateX(4–6px)`；不使用宽度或 grid 轨道动画。
- 是否值得做：是，但仅限单栏模式。

### P1-9 AI 会话历史状态点没有获得预期布局（✅ 已完成）

- 所在页面 / 组件：`renderer/src/features/ai-console/AiWorkbench.tsx:253`、`renderer/src/styles/workbuddy-refactor.css:427`。
- 当前交互行为：`AiSessionNavigation` 在 portal 浮层中复用 `.nav-recent-item`，但基础 grid 和 `.has-status` 两列规则被限定在 `.app-nav nav` 下，浮层并不匹配；组件本身也没有输出 `.has-status`。idle 使用空 span，running/waiting/failed 换成声明为 7px 的空状态点。
- 存在的问题：在 portal 中，这个空 span 没有作为 grid item 被 blockify，7px 宽高和背景点不能可靠呈现；它与后面的 block/grid 主内容还可能形成不稳定的行流。结果不是单纯“缺少脉冲”，而是 running 状态反馈本身和行内几何都不可靠。
- 为什么需要动效：状态标记应当变化，文本几何不应跟着跳。这里应先稳定布局，再用短过渡表达状态。
- 推荐动效：为 `.app-session-navigation .nav-recent-item` 明确定义两列 grid，并固定保留 7px 状态槽；idle 时点为透明，running/waiting/failed 只切换 opacity 与颜色。不要在列表每一行复用持续脉冲，避免多个会话同时运行时形成噪声。
- 建议 duration：100–140ms。
- 建议 easing：`--ease-standard`。
- 推荐属性：`opacity`、`background-color`、`box-shadow`；grid 几何保持不变。
- 是否值得做：是，但排在会话 loading 与核心 pending 反馈之后。

### P1-10 AI 审批卡的可见内容没有真正完成退出（✅ 已完成）

- 所在页面 / 组件：`renderer/src/features/ai-console/approval.tsx:26`、`renderer/src/features/ai-console/approval-banner.tsx:18`。
- 当前交互行为：允许/拒绝按钮点击后会立即进入 `busyAction` 并显示 Loader；外层列表也会为移除项保留 200ms。但 snapshot 中的 pending approval 消失后，`ApprovalCard` 内部先因 `!current` 返回 `null`，因此留下的是正在淡出的空 wrapper，而不是卡片内容。
- 存在的问题：操作接收反馈是完整的，但解决完成时卡片主体仍可能一帧消失；现有 exit presence 没有真正作用到用户看得见的元素。
- 为什么需要动效：审批属于高敏感操作，短而完整的退出能连接“请求已处理”和“执行继续”，避免卡片像异常丢失。
- 推荐动效：在 Banner/presence 层保留审批卡的 stashed 内容直到退出结束，并在 leaving 阶段设置 `inert`、`aria-hidden`。允许成功可在退出开始时把 Loader 交叉淡为 Check，但不增加额外 Toast，也不固定驻留 300ms。
- 建议 duration：图标切换 80–100ms；卡片退出 140–160ms（可将现有 200ms 收敛到该范围）。
- 建议 easing：图标 `--ease-standard`，退出 `--ease-exit`。
- 推荐属性：`opacity`；最多 `translateY(2–4px)`，不缩放整个审批区。
- 是否值得做：是，作为 P1 连续性修正；无需提升为 P0。

## 5. P2：锦上添花，可以不做

### P2-1 Recent Tasks 展开/收起

- 所在页面 / 组件：`renderer/src/app/SidebarRecent.tsx:98`、`renderer/src/styles/workbuddy-refactor.css:405`。
- 当前行为与问题：Chevron 会旋转，但列表直接挂载/卸载，内容高度瞬变。
- 推荐动效：可换成现有 `AnimatedDisclosure`，只做高度和 opacity 过渡。
- 建议 duration：180–200ms。
- 建议 easing：进入 `--ease-emphasized`，退出 `--ease-exit`。
- 推荐属性：`height` 或 `grid-template-rows`、`opacity`。
- 是否值得做：可做，但不阻塞。

### P2-2 小窗口导航 scrim 关闭瞬消

- 所在页面 / 组件：`renderer/src/app/AppShell.tsx:162`、`renderer/src/styles/workbuddy-refactor.css:3131`。
- 当前行为与问题：Drawer 本体可以滑出，scrim 却在关闭时直接卸载。
- 推荐动效：只给 scrim 增加 exit presence；不要插值 backdrop blur。
- 建议 duration：120–140ms。
- 建议 easing：`--ease-exit`。
- 推荐属性：`opacity`。
- 是否值得做：可选。

### P2-3 Settings 全页覆盖层返回略显突然

- 所在页面 / 组件：`renderer/src/App.tsx:232`、`renderer/src/styles/workbuddy-refactor.css:649`。
- 当前行为与问题：原页面虽然被保留，但设置打开时通过 `display:none` 隐藏；关闭后原页面直接重新出现。
- 推荐动效：如果实际使用仍觉得跳，可把 Settings 当作可逆全画布覆盖层，关闭动画结束后再卸载。保持背景 inert 和焦点恢复。
- 建议 duration：160–200ms。
- 建议 easing：`--ease-standard` / `--ease-exit`。
- 推荐属性：`opacity`、最多 `translateX(4px)`。
- 是否值得做：收益有限，可延后。

### P2-4 路由与页面内部入场动画存在叠加

- 所在页面 / 组件：`renderer/src/styles/workbuddy-refactor.css:643`、`renderer/src/styles/final-polish.css:50`。
- 当前行为与问题：Route child 会执行 200ms 上移淡入，页面 header、feature pane 和部分详情又有独立入场。部分切换可能表现为多个区域依次重新出现。
- 推荐动效：减少动画。一次路由切换只保留一层 160–180ms 淡入，位移最多 4px；内部区域只在真实数据变化时动画。
- 建议 duration：160–180ms。
- 建议 easing：`--ease-standard` 或 `--ease-emphasized`。
- 推荐属性：`opacity`、`translateY(≤4px)`。
- 是否值得做：适合作为最后一轮清理。

### P2-5 局部 spring 与缩放幅度偏活跃

- 所在页面 / 组件：Copy 成功 `renderer/src/styles.css:1267`；Disclosure chevron `renderer/src/styles.css:1556`；图片 context hover `renderer/src/styles/features/ai-console.css:2011`。
- 当前行为与问题：Copy 图标从 0.6 放大并越过 1.15；图片 chip 使用 spring + `scale(1.08)`；和克制的桌面生产力工具语言相比略显娱乐化。
- 推荐动效：改用 standard easing；Copy 从 `.94 → 1`；图片 hover 降至 `1.02` 或只改变边框；Disclosure chevron 不使用 spring。
- 建议 duration：120–160ms。
- 建议 easing：`--ease-standard`。
- 推荐属性：`opacity`、小幅 `scale`、`transform`。
- 是否值得做：建议收敛，但可以不做。

### P2-6 Select 退出动画与卸载计时不一致（✅ 已完成）

- 所在页面 / 组件：`renderer/src/design-system/Select.tsx:58`、`renderer/src/styles/components.css:875`。
- 当前行为与问题：`useExitPresence` 在 140ms 后卸载菜单，但 CSS 的 `ui-select-out` 使用 160ms；动画最后约 20ms 会被 DOM 卸载截断。
- 推荐动效：不增加新动画，只把 presence 和 CSS 统一为同一个 token；建议两者都使用现有 `--dur-exit` 160ms。
- 建议 duration：160ms。
- 建议 easing：`--ease-exit`。
- 推荐属性：维持现有 `opacity`、`translateY`。
- 是否值得做：是，属于低成本实现修正。

### P2-7 Segmented 首次挂载会从零宽度展开 thumb（✅ 已完成）

- 所在页面 / 组件：`renderer/src/design-system/controls.tsx:20`、`renderer/src/styles/final-polish.css:26`。
- 当前行为与问题：thumb 默认宽度为 `0px`，组件在 `useEffect` 中才写入真实几何；CSS 的 width/left transition 已经生效，因此首次挂载可能播放一次无交互含义的 160ms“长出”。后续选项切换的位移动画本身是合理的。
- 推荐动效：首帧同步测量，或使用 `data-ready` 在初次定位前禁用 transition；只保留用户主动切换后的 160ms 位移。
- 建议 duration：首次定位 0ms，后续切换 160ms。
- 建议 easing：后续切换使用 `--ease-standard`。
- 推荐属性：`left`、`width`；不新增 scale。
- 是否值得做：是，属于移除无意义动画，而不是增加动效。

### P2-8 多条 Toast 退出后其余条目补位瞬移

- 所在页面 / 组件：`renderer/src/components/FeedbackHost.tsx:62`、`renderer/src/styles.css:1294`。
- 当前行为与问题：单条 Toast 已有完整的 160ms 退出，但 leaving 项最终卸载时，其余 Toast 会直接补位。单条提示时不可见，只有密集堆叠时才明显。
- 推荐动效：仅在产品中确实常见多 Toast 堆叠时，为保留项做 FLIP transform；不要过渡 auto height，也不要延长单条 Toast 的停留时间。
- 建议 duration：140–160ms。
- 建议 easing：`--ease-standard`。
- 推荐属性：`transform`。
- 是否值得做：可选；没有密集 Toast 使用证据时不实施。

## 6. 明确不需要修改

| 检查项 | 结论与证据 |
| --- | --- |
| 普通 Hover / Press | 不需要修改。`renderer/src/styles/final-polish.css:217` 已提供 action `.98`、icon `.92` 等语义化按压反馈，颜色和边框约 140ms。图片 chip 的局部例外已列为 P2。 |
| Dropdown / Select / Tooltip / Context Menu | 共享浮层的出现、消失和焦点恢复不需要重做；只修正 P2-6 的 Select 卸载计时，并处理 P1-4 中没有接入 presence 的自定义 portal。Dropdown 当前固定 `align: "end"`，右侧 transform origin 与实现一致。 |
| Toast / Confirm | 单条 Toast 和 Confirm 不需要修改。`renderer/src/components/FeedbackHost.tsx:17` 已有 Confirm 退出、焦点恢复和 Toast 单条离场；只有多 Toast 补位列为 P2-8。 |
| AI 审批即时反馈 | 不需要重做。`renderer/src/features/ai-console/approval.tsx:14` 已有 `busyAction`，允许/拒绝按钮会立即显示 Loader；只修正 P1-10 中被提前清空的可见退出，不增加固定 300ms 成功驻留。 |
| AI 开始生成 | 不需要修改。`renderer/src/ai-context.tsx:655` 会立即设置 `isSending`，Composer 随后显示 spinner；仅 Stop 缺少 command pending。 |
| AI Streaming | 正常流式过程不需要修改。`renderer/src/features/ai-console/message.tsx:107` 以 96ms 节流 Streaming Markdown，并对超长流式内容降级；禁止逐 token 淡入。取消时的短退出已归入 P0-1；若要永久保留半截回复，仍须先定义持久化和“非最终答案”语义。 |
| AI 消息与过程卡片 | 不需要修改。`renderer/src/features/ai-console/Chat.tsx:338` 已有在位退出和高度收起；Reasoning、Tool、Context disclosure 具备连续性。 |
| AI 内嵌文件预览 | 不需要修改。`renderer/src/features/ai-console/AiFilePreviewPane.tsx:87` 已有 240ms 列变化、内容 opacity/translate 和退出 presence。 |
| 分栏拖拽与窗口 Resize | 不要增加布局动画。拖拽期间关闭 transition，并按帧直接写入像素轨道；`renderer/src/styles/workbuddy-refactor.css:2937` 明确禁止 Shell 的 grid 轨道插值。 |
| Tab、Preview/Edit | 不需要修改。Tab 已有选中颜色过渡，Preview/Edit 使用约 200ms opacity crossfade；不新增滑动指示器。Segmented 的后续切换也自然，仅首帧问题列为 P2-7。 |
| 保存状态与运行终态 | 不需要为了可见性增加驻留或脉冲。Project Output 已有 StatusBadge、保存按钮 spinner；Creative 有自动保存文字和失败 Toast；Settings 有 `role="status"` 与 `aria-busy`。AI 失败/取消会更新文字并展开对应过程/错误内容，状态应及时到达。 |
| PDF Findbar 与字数统计 | 不需要修改。它们都是点击或输入后的轻量、局部工具反馈，即时出现比附加一次入场更直接。 |
| Reduced Motion | 不需要修改。`renderer/src/styles/final-polish.css:198` 会全局将 animation/transition duration 置零。 |
| Onboarding | 不需要修改。步骤移动、安装处理中、成功和失败状态均有明确反馈，不存在装饰性大动作。 |

## 7. 建议实施清单

### 第一批：反馈与状态正确性

- [x] 为 AI Stop、Automation、Runs、Creative 创建动作增加真实 pending 状态、重复提交保护和 `aria-busy`；AI Stop 同时让可见 transient snapshot 完成短退出；
- [x] 为 Projects 增加 `openingProjectName` 和详情 loading；
- [x] 修复 Daily Brief 文件切换时的错误空状态；
- [x] 修复 Runs 切换记录时短暂显示上一条 events；
- [x] 为 Creative 项目详情增加明确 loading，而不是复用“未选择”空状态；
- [x] 为 AI 会话切换增加与目标 session 绑定的 loading，并在 ready 后做容器级淡入；
- [x] 补齐 Daily Brief 和 Project Dialog 的可见 Focus 状态。

### 第二批：必要的空间连续性

- [x] 自定义 Dialog、Skills Source、Settings Provider 统一接入 `useExitPresence`；
- [ ] Projects、Recent、项目文件列表复用 `useExitingList`，按需增加 FLIP；
- [ ] Context Tray 增加 Drop 位置提示与落位动画；
- [x] 仅为 floating/canvas AI 和 standalone preview 增加退出动画；
- [x] 让审批卡的 stashed 内容存活到 exit presence 结束，不增加固定成功驻留；
- [x] 仅在 Projects 单栏模式为列表/详情切换增加 exit presence；Split/docked 模式不动画列宽；
- [x] 固定 AI 会话历史状态点的布局槽，只过渡点的 opacity/color；
- [x] 本批异步状态测试使用 delayed Promise，验证点击后的同一 tick 已出现 busy/pending；
- [ ] 将 Projects、Runs 及 P0 延迟状态加入视觉或交互回归矩阵。（部分完成：已补交互回归；pending 视觉状态尚未加入快照矩阵。）

### 低成本实现修正

- [x] 将 Select 的 exit presence 与 CSS 退出时长统一为 160ms；
- [x] 禁止 Segmented thumb 首次定位时从 `width: 0` 播放 transition，保留后续主动切换动效。

### 默认延后

- [ ] Recent disclosure、移动端 scrim、Settings 返回 crossfade、Toast 堆叠 FLIP；
- [ ] 路由重复入场和 spring 动效收敛，作为最后一轮 polish；
- [ ] 任何 Shell/分栏宽度动画都必须先通过真实长文档 resize 基准，未通过时保持离散切换。

## 8. 实施护栏与验收口径

- 状态先于动画：必须先有 `pending / success / error / cancelled`，再设计状态之间的过渡；
- 微交互控制在 100–200ms，面板/布局控制在 180–240ms，退出通常为 140–160ms；
- 只复用 `--dur-*` 和 `--ease-*`，不新增另一套节奏；
- 业务状态切换优先使用 `opacity`、小幅 `transform`、必要的高度收起；
- 不给流式 token、虚拟列表滚动、指针拖拽过程增加逐项动画；
- 不动画桌面 Shell 的 `grid-template-columns`，不在拖拽中做带 transition 的宽度变化；
- 新增 presence 必须在 leaving 阶段设置 `inert` / `aria-hidden`，并保持触发器焦点恢复；
- Reduced Motion 下不得靠动画才能理解状态；
- 每个异步操作至少验证：点击后立即 busy、重复点击被阻止、失败恢复、成功只在真实完成后出现；
- 完成实现后至少重跑 `npm run build:renderer`、`npm run motion:check`、相关单元测试和 `npm run visual:snapshot`；若触及 Shell/分栏几何，再跑 `npm run perf:documents` 和 `npm run perf:resize`。

## 9. Zcode Motion Audit 交叉核验

交叉核验来源：`docs/MOTION_AUDIT_2026-09-14.md`。该文件只作为候选问题清单使用，未被修改；结论和优先级均重新按当前代码路径判断，没有直接照搬。

| Zcode 条目 | 核验结论 | 本文处理 |
| --- | --- | --- |
| P1-1 会话切换 | 成立。未缓存 events 会先表现为空，初次加载批次也没有容器级进入。 | 新增为 P1-7，使用 session-bound loading 和一次容器淡入，不逐条 stagger。 |
| P1-5 ProjectListDetail | 部分成立。单栏列表/详情确实直接互换；Split 列宽动画会触发复杂内容持续重排。 | 新增为 P1-8，但明确只动画单栏 opacity/小位移，拒绝 `grid-template-columns` 动画。 |
| P0-5 会话状态点 | 部分成立。真正的问题是 portal 中的 `AiSessionNavigation` 不匹配 `.app-nav nav` 下的 grid/`.has-status` 规则，状态点的 7px box 和行内几何都不可靠；“running 必须持续脉冲”并不成立。 | 降为 P1-9：在会话浮层内固定状态槽，只过渡 opacity/color，不给列表增加持续脉冲。 |
| P0-3 审批允许 | 部分成立。按钮已有同步 busy 和 Loader，并非缺少即时反馈；但 `ApprovalCard` 会在外层退出结束前返回 `null`。 | 降为 P1-10：保留可见卡片完成短退出，不增加 300ms 固定驻留。 |
| P2-2 Select 退出时长 | 成立。presence 140ms、CSS 160ms，存在 20ms 截断。 | 新增为 P2-6。 |
| P2-3 Segmented 首帧 | 成立。默认 `width: 0`，真实几何在 `useEffect` 后写入，可能触发一次无意义的初始 width transition。 | 新增为 P2-7，只取消首次定位动画。 |
| P2-1 Toast 补位 | 成立，但只在多条 Toast 堆叠时可见。 | 新增为 P2-8，保持默认不实施。 |
| P1-2/3/4、P1-10/11、P2-11/13 | 成立或大体成立，但已被本文覆盖。 | 分别归入 P1-2、P1-3、P1-4、P1-5、P2-3/P2-4，不重复计数。 |
| P0-1 停止生成 | 成立，但需拆开两层：Stop 缺少 command pending；取消时 transient 文本也确实硬清除。后者不等于应把半截文本持久化为最终回复。 | 合并进 P0-1：补真实 `stopping`，并让可见 transient snapshot 在“已取消”出现时短退出；不增加固定驻留，持久化另行决策。 |
| P0-2 “每条流式内容固定延迟 240ms” | 不成立。`animationDelay` 写在 `.timeline-presence-item`，实际 `msg-in` 动画运行在子节点 `.timeline-presence-inner`；`animation-delay` 不继承，因此当前写法没有产生所述 240ms 延迟。 | 不进入实施清单；可在普通代码清理时删除无效 style，但它不是 P0 动效问题。 |
| P0-4 保存徽章、P1-8 终态头、P1-9 发送/停止背景 | 状态均已有文字、busy/spinner、Toast 或错误内容；即时颜色切换本身不是反馈缺失。gradient 到纯色也不能靠补一条 `background-color` transition 自然插值。 | 不采纳。除非可用性测试证明用户持续错过状态，否则不增加驻留或装饰性过渡。 |
| P1-6 全局 Empty/Error/Loading 入场 | 组件没有全局入场这一事实成立，但“所有状态统一动画”不值得做。它会让正常静态空状态重复入场，也可能掩盖 P0-3/P1-1 这类错误状态模型。 | 不采纳全局规则，只在真实 loading → ready 的目标容器做局部过渡。 |
| P1-7 Materials、P1-12 列表统一 stagger | 当前资料详情没有自动轮询 processing → ready；Retry 已有 busy。给所有 fetch/过滤结果逐行重播 stagger 会增加等待感。 | 不采纳；显式新增、删除、重排已由 P1-2 覆盖。 |
| P2-4/5/7/8/9/10/12 | Tabs、token 字面量、Global Search、PDF Findbar、字数统计、queued shimmer、代码高亮等要么现状已自然，要么收益不足，部分还会引入持续动画。 | 明确不做或仅在触及相关代码时顺手做 token 卫生，不列为产品动效实施项。 |
| P2-6 Dropdown origin | 不成立。共享 `DropdownMenu` 当前固定使用 `align: "end"`，`top right` / `bottom right` 正好对应现有定位。 | 不修改。若未来开放 start/center，再让组件输出 align 数据并匹配 origin。 |
| P2-14 “三处死样式/属性” | 组合结论不成立。`data-detail-open` 被 Daily Brief 响应式 CSS 和测试使用；`project-section-in` 是正在使用的 keyframe。只有 `.ai-sidebar-scrim` 未发现运行时消费者。 | 不作为 Motion 问题合并；死代码清理由单独任务处理。 |
