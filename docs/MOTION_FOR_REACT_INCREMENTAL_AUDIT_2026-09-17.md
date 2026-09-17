# Motion for React 增量动效审计

- 日期：2026-09-17
- 范围：OpenMind Desktop 当前 renderer 交互与既有 Motion System
- 阶段：审计完成；前三批局部改动已实施；第四批收尾记录见第 12 节

本次审计识别布局、对象位置与状态切换中的连续性问题，只考虑 Motion for React 能明显改善体验或降低维护成本的场景。现有 CSS、Web Animations、design tokens、动效门禁、性能基准与无障碍约束继续作为项目规范。

**阅读说明：第 1～8 节保留实施前的审计快照，其中“当前”“未安装”“未实施”“门禁失败”均指审计时点。第 9～12 节记录后续获授权的实施、保留原实现的决定及验证，其他推荐不构成待办承诺。**

## 1. 结论与证据边界

结合 zcode 的交叉审计并重新核对当前代码后，最值得进入下一轮 Motion 验证的三个场景调整为：Context Tray 的删除与排序、Projects 收藏跨组移动、Toast 集合移除后的邻居位移。Project 文件列表先解决后台刷新时卸载整组列表的问题，修正后再判断是否仍需位置动画。

没有发现必须通过引入 Motion 才能解决的已确认 P0 问题。Accordion、AI 文件预览、通用浮层、AI 消息列表已有连续性或退出保留机制，迁移收益不足。Source / AI Workspace 的离散空间分配保留一次性布局提交，不列入默认迁移范围；轨道插值会逐帧影响文档换行与虚拟尺寸缓存，局部 FLIP 也必须经过独立性能验证，不能视为天然安全的替代方案。

矩阵中的 Motion 推荐表示适合进行局部对比验证，尚未证明其 UX 或维护性收益。代码审计确认了状态分支、DOM 生命周期与 CSS 实现；运行验证使用临时合成数据和禁用 GPU 的 Linux Electron，不能替代真实低性能设备验证，也没有进行 Motion 与原实现的 A/B 测试。

优先级：

- **P0**：明显影响理解或操作。
- **P1**：明显提升空间连续性。
- **P2**：细节 polish。
- **Skip**：收益不足，保留现有实现。

`No animation` 指不额外添加时间插值动画；不要求删除现有反馈、拖动响应或已经有效的动效。

## 2. 审计矩阵

| Location | Current behavior | Problem | Recommendation | Technology | Priority | Performance risk |
| --- | --- | --- | --- | --- | --- | --- |
| Sidebar 展开 / 收起：[use-navigation-motion.ts](../renderer/src/app/use-navigation-motion.ts#L48) | 仅显式切换启用 token 驱动的 grid 列宽过渡；已有反向操作、resize 取消与测量保护。 | 连续性已存在，但当前软件渲染性能预算仍有失败。 | 保留现有测量保护，进一步分析布局成本；没有证据支持直接迁移。 | Keep CSS | P1 | 高：影响整个工作区、虚拟文档与文字重排。 |
| Project / Creative Workspace 展开 / 折叠：[useListDetailLayout.ts](../renderer/src/components/useListDetailLayout.ts#L131) | CSS grid 列宽与 opacity 过渡；指针拖动期间关闭时间过渡。 | 未确认需要新技术解决的空间连续性缺口。 | 保留现有实现，不叠加第二层 layout 动画。 | Keep CSS | Skip | 中：内容换行与容器尺寸变化。 |
| Panel resize：[ColumnSplitter.tsx](../renderer/src/components/ColumnSplitter.tsx#L74) | rAF 合并指针移动，实时提交面板尺寸。 | 时间插值会与指针直接控制竞争。 | 不增加 Motion layout 测量；保持直接拖动响应。 | No animation | Skip | 高：高频输入；通用分栏仍可能更新 React state。 |
| Source / AI Workspace 空间分配：[AiSidebar.tsx](../renderer/src/components/AiSidebar.tsx#L143)、[ai-console.css](../renderer/src/styles/features/ai-console.css#L1548) | docked 模式立即改变 shell grid；关闭后返回 rail；floating / modal 已有 presence。 | 存在单次跳变，但逐帧插值与文档换行、虚拟尺寸缓存冲突；已有工作区注释记录该性能边界。 | 保留一次性布局提交。仅当后续证明存在明显操作或理解问题时，再独立验证局部 transform FLIP。LayoutGroup 本身不保证安全。 | No animation | Skip | 高：聊天滚动、虚拟内容与文字缩放失真。 |
| AI 文件预览：[use-preview-motion.ts](../renderer/src/features/ai-console/use-preview-motion.ts#L17) | 已有 Web Animations FLIP，每次操作读取前后几何；支持取消、resize 与 reduced motion。 | 没有明显迁移收益；现有 JS timing 使用与 CSS token 相同的字面量，仍有漂移风险。 | 保留 FLIP；后续通过薄 adapter 读取既有 timing token。 | Keep Web Animations | P2 | 低：每次离散操作两次几何读取，已可中断。 |
| Accordion：[final-polish.css](../renderer/src/styles/final-polish.css#L84) | 使用 interpolate-size / height 过渡与 grid fallback；关闭时保留内容并设置 inert。 | 相邻元素已有连续位移。 | 保留 AnimatedDisclosure，不额外添加 layout 或 LayoutGroup。 | Keep CSS | Skip | 中：高度动画有布局成本，Motion 尚无已证实收益。 |
| Projects 紧凑模式列表 → 详情：[projects.css](../renderer/src/styles/features/projects.css#L460)、[ProjectTasksPanel.tsx](../renderer/src/features/projects/ProjectTasksPanel.tsx#L377) | 正常 hosted / portal 路径通过 display: none 切换面板；ProjectListDetail 动效只出现在缺少 host 的 fallback。 | 已有 helper 动效未覆盖实际入口，面板切换仍可能直接跳变。 | 优先把现有方向 / presence CSS 接到根入口，保留组件实例、焦点、草稿与滚动。 | Keep CSS | P1 | 中：portal 生命周期与隐藏面板状态。 |
| Project 收藏跨组、排序与归档：[ProjectsPage.tsx](../renderer/src/features/projects/ProjectsPage.tsx#L320) | 收藏 / 最近项目位于不同 ProjectListGroup；排序立即改变位置，跨组会重新挂载并播放入场。 | 用户难以追踪同一个项目跨组后的位置。 | 局部评估 layoutId；必要时用限定作用域的 LayoutGroup 协调与隔离 ID，同组邻居只处理位置。 | Motion layoutId | P1 | 中高：集合无明确上限，须限制动画参与节点。 |
| Project row → Workspace：[ProjectsPage.tsx](../renderer/src/features/projects/ProjectsPage.tsx#L339) | 行显示 opening 反馈，随后出现同名标题与工作区内容。 | 当前反馈能识别目标；行与整个工作区不是同一视觉表面。 | 保留反馈，不将整行 morph 成整个工作区。 | Keep CSS | Skip | 高：整块共享过渡涉及复杂内容与几何。 |
| 文件行 → 文件详情：[ProjectFilesPanel.tsx](../renderer/src/features/projects/ProjectFilesPanel.tsx#L323) | 选中行打开独立 reader。 | 行与 reader 的形态、内容不同，未确认共享对象丢失导致理解问题。 | 保留选中与 loading 反馈，不将行拉伸为 reader。 | Keep CSS | Skip | 高：reader 生命周期与异步内容。 |
| 图片缩略图 → Lightbox：[composer.tsx](../renderer/src/features/ai-console/composer.tsx#L684) | 已有进入 / 退出、滑动与焦点恢复，使用图片 ID 跟踪当前对象。 | 未确认缺少共享过渡影响理解。 | 保留现有实现，不增加大幅缩放或飞行动画。 | Keep CSS | Skip | 中：滚动容器、遮罩与图片几何。 |
| Tab / Segmented active indicator：[controls.tsx](../renderer/src/design-system/controls.tsx#L20)、[ProjectsPage.tsx](../renderer/src/features/projects/ProjectsPage.tsx#L356) | Segmented 已测量 active offset，通过 CSS 伪元素移动滑块；Project tabs 使用 active background。 | 未证明现有 CSS 能力不足。 | 必要时复用既有滑块，不为 indicator 单独引入 Motion。 | Keep CSS | Skip | 低。 |
| 通用 Dialog / Dropdown / Select / Tooltip：[use-exit-presence.ts](../renderer/src/design-system/use-exit-presence.ts#L19) | 退出保留 DOM；重开取消退出计时；reduced motion 跳过延迟。 | 单纯替换为 AnimatePresence 没有明显收益。 | 保留现有 CSS presence 与焦点行为。 | Keep CSS | Skip | 低：只涉及浮层表面。 |
| Provider 新增 / 编辑弹窗：[settings-sections.tsx](../renderer/src/features/settings/settings-sections.tsx#L1064) | 条件 portal 关闭时立即卸载，已有入场样式。 | 退出不连续。 | 使用现有 useExitPresence 即可，无需新增依赖。 | Keep CSS | P1 | 低：仅处理外层 surface。 |
| Project 图标选择器：[ProjectAppearance.tsx](../renderer/src/features/projects/ProjectAppearance.tsx#L275) | 关闭或选择后条件 portal 立即卸载。 | 缺少退出保留。 | 复用既有 presence，不给每个图标启用 layout。 | Keep CSS | P2 | 低。 |
| Toast 集合：[FeedbackHost.tsx](../renderer/src/components/FeedbackHost.tsx#L62) | useExitingList 保留退出项，CSS 播放 exit；最终移出文档流。 | 最终移除时，其余 Toast 突然跳动。 | 单独外层 wrapper 使用 layout="position"，继续保留当前 CSS exit；限制动画参与范围。 | Motion layout | P1 | 低中：数量未设上限；容器 fixed 且可滚动。 |
| Context Tray：[composer.tsx](../renderer/src/features/ai-console/composer.tsx#L747) | 删除立即改变集合，drop 时提交新顺序；最后一项删除会卸载整个 tray。 | 邻居与顺序关系跳变，最后退出缺少连续性。 | 仅小型可见 chip 集合启用 layout="position"；父层负责最后一项的退出保留。 | Motion layout | P1 | 中：横向滚动、原生 drag 与 mask；拖动期间不能竞争控制位置。 |
| Project 文件列表：[ProjectFilesPanel.tsx](../renderer/src/features/projects/ProjectFilesPanel.tsx#L264) | 删除触发 load；loading 时整组 rows 卸载；按 updatedAt 排序。 | 刷新时集合消失后重入，survivor DOM 无法保持连续位置。 | 首先区分首次加载与后台刷新并保留 rows，按需复用 CSS presence；修正后再决定是否需要 Motion。 | Keep CSS | P1 | 中：当前 key 随重命名改变；乐观更新还涉及失败回滚，并非动效的必需前提。 |
| Daily Brief 列表刷新：[DailyBriefPage.tsx](../renderer/src/features/daily-brief/DailyBriefPage.tsx#L161) | loading skeleton 与保留的旧文件行同时渲染。 | skeleton 将旧列表推下，结束后旧行再跳回。 | 区分首次 / 后台 loading，先修正状态呈现与位置保持。 | No animation | P1 | 低：无需动画即可消除跳变。 |
| Source List：[SkillsPage.tsx](../renderer/src/features/skills/SkillsPage.tsx#L928) | 新增、导入、过滤直接更新集合；启用状态已有 CSS 反馈。 | 大批量位置动画收益不足。 | 保留即时查询与导入反馈，不给整组 rows 添加 layout。 | No animation | Skip | 高：批量导入与长列表。 |
| Search Results：[GlobalSearch.tsx](../renderer/src/app/GlobalSearch.tsx#L240) | debounce 查询后替换分组结果。 | 高频查询不适合让新结果追随旧结果位置。 | 保留搜索浮层 CSS；结果集合不增加 layout。 | No animation | Skip | 高：频繁更新与键盘选中。 |
| AI 消息 / Generating → Completed：[Chat.tsx](../renderer/src/features/ai-console/Chat.tsx#L377) | 已有列表 presence、过程折叠、临时项退出保留与大型工具组虚拟化。 | 未确认 Motion 可带来额外收益。 | 保留现有实现，不给 timeline、虚拟行或流式文本启用 layout。 | Keep CSS | Skip | 高：stream、scroll 与虚拟列表。 |
| Loading / Empty / Result、editing → preview：[CreativeDetailPane.tsx](../renderer/src/features/creative/CreativeDetailPane.tsx#L260)、[TopicFileWorkspace.tsx](../renderer/src/features/creative/TopicFileWorkspace.tsx#L22)、[AiFilePreviewPane.tsx](../renderer/src/features/ai-console/AiFilePreviewPane.tsx#L386) | Creative 主编辑器已有 view-fade；Topic 文件与 AI preview 的编辑 / 预览直接切换分支。 | 局部硬切存在，但主要属于简单 fade，并非布局能力不足。 | 按需复用 CSS；不要用 layoutId morph 不同构的编辑器与 reader，也不要通过扩大 key 范围重置草稿或编辑器状态。 | Keep CSS | P2 | 低中：异步状态、编辑器挂载与长文档。 |
| ProjectListDetail split 折叠：[projects.css](../renderer/src/styles/features/projects.css#L551)、[ProjectListDetail.tsx](../renderer/src/features/projects/ProjectListDetail.tsx#L54) | fallback 的 split grid 确实没有轨道 transition；正常 Projects 入口使用根 workspace 与 portal hosts。 | CSS 缺口成立，但不能据此认定主要入口的任务 / 文件面板都没有过渡。 | 先确认可达入口与实际跳变；不作为“一行修复即可改善主要路径”的首批项。若补齐，必须关闭拖动期间过渡并验证内容重排。 | Keep CSS | Skip | 中：可能承载 AI 会话与 reader，并非无文档风险。 |
| Recent Tasks 折叠：[SidebarRecent.tsx](../renderer/src/app/SidebarRecent.tsx#L98) | 条件挂载 / 卸载列表，只为箭头提供反馈。 | 列表高度瞬变，邻近导航内容被直接推挤。 | 复用 AnimatedDisclosure，保留既有列表滚动与高度限制。 | Keep CSS | P2 | 低中：侧栏纵向布局；需验证与导航开合同时操作。 |
| Recent Tasks Pin / Archive：[SidebarRecent.tsx](../renderer/src/app/SidebarRecent.tsx#L40) | pin 后按置顶排序；archive 后过滤行；没有位置连续性或列表退出保留。 | 行直接移动或消失，邻居立即补位。 | 后置评估局部 position layout；先观察 Context Tray 与 Projects 试点，不把方案扩散到整个 shell。最后一条消失还涉及根组件退出。 | Motion layout | P2 | 中：集合无明确上限，处于 shell 内，并可能与导航宽度变化重叠。 |
| Settings 手写折叠：[settings-sections.tsx](../renderer/src/features/settings/settings-sections.tsx#L463) | Skill、MCP、Provider advanced 内容条件渲染。 | 高度直接变化；已有 disclosure 方案未覆盖这些局部内容。 | 按需复用 AnimatedDisclosure，保持 aria-controls、inert 与原有布局。 | Keep CSS | P2 | 低中：内容高度与设置表单状态。 |
| 小窗导航 scrim：[AppShell.tsx](../renderer/src/app/AppShell.tsx#L164) | 条件渲染，关闭时立即卸载，而 drawer 自身仍有过渡。 | 背景先于 drawer 消失。 | 使用既有 useExitPresence 与 token 驱动 fade，退出时禁用交互。 | Keep CSS | P2 | 低：仅遮罩层。 |
| Settings 页面覆盖层：[App.tsx](../renderer/src/App.tsx#L274) | settingsOpen 为 false 后直接移除覆盖内容。 | 页面退出缺少保留。 | 如实际操作能感知到硬切，使用既有 CSS presence；保留退出快照与底层路由状态。 | Keep CSS | P2 | 低中：整页生命周期，不优先引入 AnimatePresence。 |
| Inline AI 划词浮条：[InlineAiBar.tsx](../renderer/src/features/creative/InlineAiBar.tsx#L118) | selection toolbar 条件挂载 / 卸载。 | 高频编辑场景有局部硬切，但选区消失通常需要即时反馈。 | 如需改善，只增加克制的 CSS opacity presence；不能延迟接受操作或让过期选区继续可操作。 | Keep CSS | P2 | 低中：编辑器 selection 与运行状态。 |
| 列表 presence 的 reduced motion：[use-exiting-list.ts](../renderer/src/design-system/use-exiting-list.ts#L25) | 固定 exitMs 保留移除项；hook 与当前调用方未按 reduced motion 归零时长。 | CSS 动画已归零时，项仍可能保留到计时结束，造成显示集合或占位滞后。 | 修正既有 hook / duration 适配与偏好变化取消；检查各调用方的 aria-hidden、inert。无需迁移技术。 | Keep CSS | P1 | 低中：共享 hook 的多个调用方需要回归验证。 |
| Creative workspace timing：[creative.css](../renderer/src/styles/features/creative.css#L32) | 轨道 transition 使用 220ms 字面量和已有 easing var。 | timing 没有读取 duration token，且被现有门禁的同一行 token 判断漏过。 | 选用语义合适的既有 duration token，并扩展原门禁检查；不增加新的 220ms token。 | Keep CSS | P2 | 低：规范修正；轨道自身的布局成本仍须独立看待。 |

本轮没有把 `Motion AnimatePresence` 或 `Motion LayoutGroup` 选为独立迁移项。前者只在已证实需要集合退出保留时考虑；后者只作为局部布局协调或 layoutId 命名空间工具。简单 opacity、transform、hover、focus、active、button press、颜色与边框背景过渡继续使用现有实现。

## 3. 下一阶段的三个 Motion 候选

以下顺序用于后续验证，不代表本次已经实施或批准批量迁移。

### 3.1 Context Tray：维持 chip 的顺序与邻接关系

用户目的：理解删除和 drop 后的顺序变化，提供 spatial continuity 与 feedback。

只对小型、可见 chip 集合评估 layout="position"，避免尺寸缩放影响文字。横向滚动容器需要正确处理滚动坐标；原生拖动期间不启用与指针竞争的位置过渡。最后一项删除时，上层条件分支会卸载整个 tray，必须由仍然存在的父层负责退出保留，不能仅在 tray 内部添加 presence。

Motion layout 根据实际 DOM 的前后位置插值，不会自动获得 HTML5 drag ghost 的释放坐标。因此，本候选优先改善邻居补位和新顺序的可追踪性，不承诺自动解决 ghost → 落点的完整搬运动画。chip 展开详情通过 portal 渲染，这些详情不参与 chip 的 layout 测量，并应验证删除或重排时的焦点与关闭行为。

快速删除、重排、重新添加与水平滚动应保持可中断性。大集合退回即时位置更新，保留现有反馈。tray 首尾挂载的高度问题单独验证；添加 height animate 会产生逐帧布局，不能以“使用 Motion”为由宣称全部开销仅来自 transform / opacity。

### 3.2 Projects 收藏跨组：让同一个项目保持身份

用户目的：理解项目在收藏组和近期组之间的去向，提供 spatial continuity 与 orientation。

favoriteProjects 与 recentProjects 位于不同父节点，key 相同不能避免跨父节点重挂。当前 CSS 入场会随重挂再次播放。这比同组排序更适合验证 layoutId：在列表范围内匹配同一项目，抑制移动行的重复入场，邻居仅处理位置；必要时使用带 ID 的局部 LayoutGroup 隔离共享身份。

归档没有可见目标对象，应使用退出保留与邻居位置连续性，而不是把 layoutId 当作所有移除操作的解法。移动最后一条导致整组条件卸载时，presence 必须位于仍存在的共同父层。项目列表可滚动且无明确数量上限，需要滚动坐标处理和动画参与预算；不能因为“通常几十行、没有虚拟化”就评为零风险。

本候选只覆盖列表自身，不覆盖 Project row → Workspace morph。后续对比必须包含首次收藏、取消最后一条收藏、归档最后一条、过滤中移动，以及导航开合 / resize 与操作同时发生。

### 3.3 Toast 集合：让移除造成的位移可追踪

用户目的：理解哪条反馈被移除，以及剩余反馈为何改变位置，提供 cause and effect 与 spatial continuity。

现有退出过程已经有效，缺口发生在退出结束、节点移出文档流的时刻。优先只为 Toast 外层增加位置连续性，保留叶节点 CSS exit，避免两个系统同时控制同一个 transform。layoutDependency 必须包含实际显示集合的变化，包括退出保留结束后的最终移除，不能只依赖原始业务 IDs。

Toast stack 是 fixed 且可滚动的容器；需要按 Motion 文档检查 layoutRoot 与 layoutScroll。当前集合没有数量上限，实施时应限制动画参与节点，不能为满足预算而截断用户反馈数据。若局部方案不能稳定满足预算，则保留现有实现。

### 3.4 文件列表后置条件：先保留 survivor，再验证位置动画

用户目的：理解文件删除、新增或排序后的去向，提供 spatial continuity 与 cause and effect。

当前 load 设置 loading，rows 只在非 loading 时渲染。直接添加 layout 不能跨越整组卸载，必须先区分首次加载和后台刷新，保留既有 rows 与其 DOM。之后仅对有限可见节点评估位置动画，避免把 reader 或整棵文件集合纳入测量。CSS exit 能改善消失过程，但仅接 useExitingList 不会自动插值最终移除时邻居的位置。

当前 key 包含 kind 与 relativePath；重命名会改变身份。没有额外稳定身份设计前，不宣称能够追踪 rename。已有 actionBusy 反馈不能简单描述为“IPC 期间无反馈”。乐观移除不是动效的必需条件，还会引入失败回滚；优先避免整组刷新卸载。若单独保留 rows 已消除主要跳变，而 Motion 没有额外明显收益，则只保留状态呈现修正。

### 3.5 合并后建议的五个实施场景

| 顺序 | 场景 | Technology | 实施边界 |
| --- | --- | --- | --- |
| 1 | Provider 新增 / 编辑弹窗退出 | Keep CSS | 连接已有退出 CSS，但需保留表单快照、焦点恢复与退出禁用交互；不是零风险。 |
| 2 | Context Tray 删除 / 排序 | Motion layout | 首个 Motion 试点；presence 仅处理确有需要的移除，不更换原生 DnD。 |
| 3 | Projects 收藏跨组 / 归档补位 | Motion layoutId | 共享对象只用于跨组；归档使用局部退出与位置连续性。 |
| 4 | Toast 最终移除后的补位 | Motion layout | 保留现有叶节点 CSS exit；检查 fixed、scroll 与实际显示集合变化。 |
| 5 | Recent Tasks 展开 / 收起 | Keep CSS | 复用 disclosure；Pin / Archive 的 Motion 后置。 |

这是后续范围建议，尚未实施。若希望缩小首批，先做前三项。共享 reduced-motion hook 缺口、既有 motion:check 失败与 token adapter 属于实施前必须明确的基础约束，不应为了凑够五个场景而增加装饰性动画。

## 4. 接入现有 Motion System 的约束

### 4.1 单一 token 来源与薄 adapter

当前权威 timing 定义位于 [styles.css](../renderer/src/styles.css#L106)：

| Token | 当前值 | 使用方式 |
| --- | --- | --- |
| --dur-instant | 80ms | 按既有语义读取，不复制到组件。 |
| --dur-fast | 140ms | 同上。 |
| --dur-normal | 200ms | 同上。 |
| --dur-slow | 240ms | 同上。 |
| --dur-exit | 160ms | 同上。 |
| --ease-standard | cubic-bezier(.2, 0, 0, 1) | 转为 Motion 接受的四元组。 |
| --ease-emphasized | cubic-bezier(.3, 0, 0, 1) | 同上。 |
| --ease-exit | cubic-bezier(.4, 0, 1, 1) | 同上。 |
| --ease-spring | cubic-bezier(.34, 1.56, .64, 1) | 当前是 bezier，不是物理 spring 参数规范。 |

表中值用于记录本轮审计快照，不构成新的 timing 配置。未来 adapter 只负责读取既有 CSS token、转换 ms / s 与解析 cubic-bezier；读取和缓存应避开逐帧路径。显式选择 tween，避免无意引入 Motion 默认 spring。组件不得新增 duration、easing、stiffness、damping 或 bounce 字面量，也不得建立第二张 TS timing 表。

AI 文件预览的现有 WA timing 字面量与 token 值一致，门禁不能据此证明它会随 token 更新；后续可在保留实现的前提下连接 adapter。

### 4.2 Reduced motion 与交互生命周期

MotionConfig 的 reducedMotion 默认是 never，若引入必须显式使用 user。但该设置仍允许 opacity 等非 transform 动画，不能单独满足项目当前 reduced-motion 规则。现有全局 CSS 归零 CSS 动画 / 过渡时长，不覆盖 JavaScript 动画；adapter 和 presence 必须同步项目规则，在 reduced motion 下直接到终态，并取消退出延迟。参见 [MotionConfig 官方文档](https://motion.dev/docs/react-motion-config)。

保留现有焦点恢复、inert、滚动锚点、输入草稿与异步请求生命周期。动画不能延迟删除操作本身，不能用视觉退出保留增加无障碍可操作的幽灵节点。

### 4.3 布局测量范围

- 只标记确实需要连续性的节点；文字项仅移动位置时优先 layout="position"。
- layoutDependency 绑定实际结构变化，不绑定整个流式 snapshot；退出计时结束后的真实移除也必须触发必要测量。
- LayoutGroup 只覆盖互相影响几何的局部集合，或隔离 layoutId，不设置全局 group。
- 固定与滚动容器分别检查 layoutRoot、layoutScroll；同一容器可能同时满足两种条件。
- 不给大型虚拟列表、文件树、stream 文本或高频滚动行全量添加 layout。
- 原生窗口 resize 与指针拖动应采用明确策略；Motion 在水平窗口 resize 时会阻止 layout animation，不能把它当作已验证的 resize 方案。
- 检查父子 transform、mask、文字缩放失真与 CSS exit 的 transform 所有权。

官方依据：[Layout animations](https://motion.dev/docs/react-layout-animations)、[LayoutGroup](https://motion.dev/docs/react-layout-group)、[AnimatePresence](https://motion.dev/docs/react-animate-presence)。本轮没有据此创建新的动画实现。

### 4.4 延伸现有门禁，避免第二套规范

当前 [motion-contract-check.js](../scripts/motion-contract-check.js) 主要检查 CSS transition 与原生按钮标记，尚不覆盖 WA / Motion 的 JS timing，也不能完整识别 motion.button。部分 CSS 检查以同一行是否含 token 引用为依据，不能等同于逐属性 token 校验。creative.css 的 220ms transition 与 easing var 共存就是当前可验证的漏检例子。

未来若采用 Motion，应扩展现有 motion:check 覆盖 adapter 使用和新增 API，保持一个门禁；不能另建独立 timing system 或把现有失败改成忽略。当前 package.json 未声明 motion / framer-motion 依赖，本轮未安装依赖。

## 5. 本轮验证结果

### 5.1 静态与既有测试

| 检查 | 结果 | 说明 |
| --- | --- | --- |
| npm run motion:check | **失败** | 当前基线已有两处 CSS transition 字面量及三个 JSX 按钮源码位置缺少动效标记；未修复或放宽规则。 |
| npm run typecheck | **通过** | renderer 与 Electron TypeScript noEmit 检查通过。 |
| npm run lint:reporoot | **通过** | 扫描 462 个文件，无禁止的根目录拼接。 |
| npm run lint:manifests | **通过** | 16 个正式 manifest，0 个 legacy，全部有效。 |
| 下列既有定向测试 | **通过** | 5 个测试文件，17 个测试。 |

测试命令：

```bash
npx vitest run \
  renderer/src/design-system/use-exit-presence.test.tsx \
  renderer/src/design-system/use-exiting-list.test.ts \
  renderer/src/design-system/animated-disclosure.test.tsx \
  renderer/src/app/use-navigation-motion.test.tsx \
  renderer/src/features/ai-console/use-preview-motion.test.tsx
```

motion:check 当前失败位置：

- [markdown-editor.css:43](../renderer/src/styles/features/markdown-editor.css#L43)：background-color、color、transform 使用 120ms 字面量。
- [markdown-editor.css:140](../renderer/src/styles/features/markdown-editor.css#L140)：opacity 使用 120ms 字面量。
- [ArtifactMessageBlock.tsx:42](../renderer/src/features/ai-console/ArtifactMessageBlock.tsx#L42)：copy 按钮缺少 data-motion。
- [MilkdownEditor.tsx:87](../renderer/src/features/creative/MilkdownEditor.tsx#L87)：映射的工具栏按钮源码位置缺少 data-motion。
- [MilkdownEditor.tsx:91](../renderer/src/features/creative/MilkdownEditor.tsx#L91)：本地文件按钮缺少 data-motion。

三个 JSX 位置不是运行时实际按钮数量。以上失败均在审计开始时存在；本轮不能报告全门禁通过。

### 5.2 Motion 性能基准

环境：Node v22.23.2、Linux Electron、GPU disabled、synthetic data、临时 userData。独立复跑报告记录视口 1440 × 973、1968 个 DOM 节点、reducedMotion=false。

首次 npm run perf:motion 与 typecheck / build 有 CPU 工作重叠，部分 preview、theme、tool group 预算失败。随后使用同一已构建产物，在新的临时运行目录独立执行既有 motion-performance-electron.js，**19 项预算全部通过**，未调整预算。首次失败仍保留，复跑通过不证明首次失败的唯一原因是并行编译。

| 独立复跑观察 | 结果 | 含义 |
| --- | --- | --- |
| 第一次 preview open | p95 66.7ms，max 100.1ms；24 次 layout | 冷操作仍有长帧；预算通过不等于全程 60fps。 |
| 第一次 preview close | p95 16.7ms，max 16.8ms；3 次 layout | 当前退出路径开销较低。 |
| 后续 preview open | p95 16.8 / 33.4ms | 有热路径改善，但不能替代候选方案的独立比较。 |
| Theme 切换 | max 83.3–116.7ms | 软件渲染场景仍有长帧。 |
| 过程展开 / 大型工具组展开与关闭 | p95 16.7–16.8ms | 现有折叠与虚拟化路径已有较好结果。 |
| 21 行 skeleton | 0 次 layout、0 次 paint event；21 个实际动画 | 存在动画的正向控制成立，不能把无事件误认为没有动画。 |

本地生成报告：[motion-performance-report.json](../.build/motion-performance-report.json)。该文件属于被忽略的运行产物，不随本文提交，也不保证在其他 checkout 存在。首次失败报告与独立复跑的临时产物没有复制进源码仓库。

### 5.3 Sidebar navigation 基准与功能检查

同一构建产物独立运行 navigation 基准，**13 项预算中 6 项失败**，未放宽预算：

| 失败项 | 实测 | 预算 |
| --- | --- | --- |
| navigation 0 p95 | 99.9ms | ≤34ms |
| navigation 2 p95 | 50.1ms | ≤34ms |
| navigation 2 max | 116.7ms | ≤100ms |
| navigation 3 p95 | 50.0ms | ≤34ms |
| companion 1440 run 1 p95 | 66.7ms | ≤34ms |
| companion 1150 run 1 p95 | 66.7ms | ≤34ms |

四次当前导航路径的 layout 次数为 21、28、28、28；注入 naive-grid 的负向控制为 146、139。已有保护能降低布局次数，但没有满足当前全部帧预算。不能用该结果宣称 Motion 能进一步改善。

既有 navigation-motion-qa 的功能断言通过：双向存在真实中间宽度，工作区位置跟随导航变化；虚拟文档中途无重叠；快速连续三次切换保留最新意图；70ms 时反向操作的宽度跳变小于 1px；焦点与阅读段落锚点保持；reduced motion 关闭过渡；1440 / 1150 窗口尺寸检查通过；操作后测量保护属性释放。

这些检查不是连续窗口 resize、完整 panel drag 或三个候选场景的 React render 验证。本地生成报告：[navigation-performance-report.json](../.build/navigation-performance-report.json)，同样是被忽略的运行产物。

### 5.4 尚未验证

- 全量 unit、integration、E2E 与 npm run verify。
- 独立 perf:resize 与完整连续窗口 resize / panel drag。
- 三个候选场景的 React Profiler commit / render 次数。
- 三个候选场景逐操作的完整 layout / paint / composite trace。
- CPU throttling 与实际低性能设备。
- Motion 与现有实现的同条件 A/B、维护复杂度与最终 UX 收益。

没有新增实现，因此不存在“实施后验证通过”的结论。

## 6. 后续实施验收清单

每个候选单独实施、单独比较；先保存同一构建模式、数据规模、窗口尺寸与设备条件下的原实现基线。

1. 通过现有 motion:check；当前基线失败单独记录并处理，不能宣称门禁全绿。
2. 通过适用的既有 lint、typecheck 与 tests；区分定向通过和全量检查结果。
3. 验证 prefers-reduced-motion，包括 JS transition、退出保留、偏好在动画中改变时的取消。
4. 对比修改前后性能基准，不修改预算掩盖回归；保留首次失败与复跑结果。
5. 使用 React Profiler 检查 commit / render 次数，确认没有按动画帧触发 React render。
6. 检查 layout、style、paint、composite 开销与测量范围；正向控制证明动画确实发生，负向控制证明能检测原跳变或开销。
7. 连续新增、删除、重排、切换与反向操作，确认动画自然中断并收敛到最新状态。
8. 检查窗口 resize、容器 resize、滚动中操作与拖动，确认无错误坐标和布局失真。
9. 检查 CPU throttling 与实际低性能设备；GPU-disabled 基准只作为一项证据。
10. 更新动效审计记录，记录范围、目的、前后收益、失败与保留原实现的决定。

如果 Motion 版本没有明显 UX 或维护性收益，则保留原实现。无论最终是否采用 Motion，都不批量迁移 CSS / WA，不增加装饰性动效。

## 7. 文档与工作区说明

审计开始时，原 docs/MOTION_AUDIT_CURRENT_2026-09-14.md 已处于删除状态；仅通过 Git 历史读取作为参考，没有恢复它。本文独立记录当前增量审计，保持该原有删除状态。后续若实施，应更新实际保留的审计文档，避免维护相互矛盾的动效规则。

## 8. zcode 交叉审计：采纳与修正

本节基于用户提供的审计文本与当前源码复核，未直接复制未验证的性能或规模假设。本轮补充只更新本文，没有新增依赖或修改业务实现；motion:check 再次运行仍报告两处 CSS transition 与三个 JSX 源码位置失败。

| zcode 建议或结论 | 判断 | 合并方式 / 修正 |
| --- | --- | --- |
| Context chips 使用 layout + presence | 采纳方向，收紧范围 | 提升为首个 Motion 试点；使用 position layout，处理外层卸载、横向滚动和 portal 详情。原生 ghost 落点不由 layout 自动解决。 |
| Projects 收藏跨组使用 layoutId | 采纳，提升优先级 | 纳入首批三个 Motion 候选；LayoutGroup 限定到列表，不按页面一刀切。归档与跨组是不同操作。 |
| Provider Add / Edit 退出 CSS 已写但没接入 | 采纳 | 条件 portal 未输出 data-leaving，而 CSS 已有退出规则；复用现有 presence，保存退出快照。 |
| Recent Tasks 及设置折叠复用 AnimatedDisclosure | 采纳 | 补充局部 CSS 缺口；Recent pin / archive 不随首批扩散到 shell。 |
| useExitingList 缺少 reduced-motion 分支 | 采纳 | 补充共享 hook 审计；明确计时保留与 CSS 动画归零不一致，逐调用方验证。已有 Chat 的 inert / aria-hidden 也应保留。 |
| creative.css 220ms 被门禁漏过 | 采纳 | 记录具体 duration token 漂移和既有门禁覆盖不足。 |
| AI docked 默认保持一次性布局提交 | 采纳谨慎决策 | 将原 Motion layout 候选改为 No animation / Skip；已有预览 FLIP 继续保留。LayoutGroup 不是唯一安全路径，也不会自动消除重排和缩放风险。 |
| 主 Sidebar 动画已平滑，风险低 / Skip | 部分采纳 | 无需迁移技术，但已有软件渲染 navigation 基准失败，仍保留 P1 性能问题，不能将门禁或帧预算描述为全绿。 |
| motion:check 通过中 | 不采纳事实结论 | 当前再跑仍失败：2 个 CSS、3 个 JSX 源码位置。 |
| CSS token 的 TS 镜像 + 新 motionSpring 参数 | 不采纳 | 复制 timing 要求两边同步，已经构成第二份配置；stiffness / damping / mass 无当前物理 spring 来源。仅读取现有 token 并做单位 / bezier 转换。 |
| project-list-detail.split 一行补过渡即可改善主要入口 | 不直接采纳 | 该 CSS 缺口真实，但正常入口用 portal hosts，helper 是 fallback；先验证可达路径、真实 UX 与文档成本。 |
| Selected item → detail 已全面覆盖 pane 进出 | 不采纳概括 | helper 有实现，不代表 hosted 主入口已接入；保留原审计对 compact 根路径的发现。 |
| 图片 lightbox 只改 transform-origin 可获约 80% 收益 | 不采纳收益承诺 | 没有测量依据；origin 改变缩放基点，不能单独建立两个矩形的位置与尺寸对应。当前 lightbox 继续保留。 |
| 文件列表接 CSS exit 即可闭环 | 部分采纳 | 先修后台刷新卸载；CSS exit 不等于邻居位置 FLIP，rename 身份与乐观回滚另行评估。 |
| 虚拟列表、Chat 不做 per-row layout | 采纳当前项目边界 | 当前基于绝对定位、固定行高或尺寸缓存的路径保持现状；不把该判断写成所有虚拟化技术永久禁止 Motion 的通则。 |
| 简单淡入、Skeleton、meta 交叉与大量 P2 一并补齐 | 后置 | 确有局部缺口，但“同类待遇不一致”不自动构成动效价值；只在实际影响状态理解时修正。 |
| 恢复已删除的旧审计文档 | 不采纳操作建议 | 保留用户工作区已有删除状态，持续更新本文即可，不恢复旧文档。 |

技术核对依据：[Motion layout 的测量与 transform 插值](https://motion.dev/docs/react-layout-animations)、[LayoutGroup 的协调与 ID 作用域](https://motion.dev/docs/react-layout-group)、[AnimatePresence 的父层保留要求](https://motion.dev/docs/react-animate-presence)、[CSS transform-origin](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/transform-origin)。这些 API 能力支持局部方案评估，不替代运行时收益验证。

## 9. 首批实施记录（2026-09-17）

用户指定实施 Provider 弹窗退出、Context Tray 删除/排序、Projects 收藏跨组移动。重复提到的 Projects 合并为同一项；Toast、文件列表、Recent Tasks、归档退出、Shell 布局和其他 P2 建议继续后置。

### 9.1 实现与保留边界

| Location | 实施前行为 | 本批结果与动效目的 | Technology | 范围与性能保护 |
| --- | --- | --- | --- | --- |
| Provider Add / Edit | 条件 portal 关闭即卸载，退出 CSS 未接入 | 接入已有 `useExitPresence`；保留最后绘制的表单值，取消操作仍立即回滚草稿；退出期间 inert / aria-hidden，焦点回到打开按钮；快速重开取消旧卸载。目的：State continuity、Feedback。 | Keep CSS | 不增加 Motion 元素；使用 CSS `--dur-exit` 作为退出计时来源。 |
| Context Tray 删除、排序 | 删除后邻居跳位，排序直接换序；最后一项使整个 Tray 卸载 | 芯片外壳 `layout="position"`，局部 `AnimatePresence mode="popLayout"`；原生拖动保持原 ghost，仅 drop 提交顺序后插值。最后一项/清空使用外层 CSS presence 与内容快照，保留尺寸到淡出结束。目的：Spatial continuity、Cause and effect。 | Motion layout + Motion AnimatePresence；末项外层 Keep CSS | 只测量 ID 顺序变化；横向容器 `layoutScroll`；最多 32 个参与 layout；超过预算仍完整显示内容。删除引用时立即关闭关联 portal；引用换位时关闭旧锚点的详情浮层并恢复键盘焦点。 |
| Projects 收藏 / 取消收藏 | 同一项目从一个 section 卸载，在另一个 section 重新进入 | 以稳定 project.id 建立局部 `layoutId`，仅列表使用 `LayoutGroup`；行与分组只做 position layout，跨组行不重播已有进入 CSS；恢复到新行按钮的焦点，不抢走用户已转移到其他项目的焦点。目的：Orientation、Spatial continuity。 | Motion layoutId + Motion LayoutGroup | 最多 40 个项目；仅收藏提交递增 layoutDependency；查询、直接 resize、导航布局变化期间不插值；滚动容器 `layoutScroll`。 |

新增 `motion@13.4.0` 精确版本。`design-system/motion-tokens.ts` 仅读取现有 CSS duration / cubic-bezier 并转换秒单位，没有复制一份时长表，没有新增 stiffness / damping / bounce。缺少有效 token 时立即落位。按挂载读取 token，动画帧内不读取样式或设置 React state。

`useMotionPreference` 订阅系统偏好变化，退出中开启 reduced motion 会立即完成卸载；CSS 同时清除集合外壳的 projection transform，避免正在执行的动画残留。没有只依赖 Motion 的挂载时偏好快照。`useExitPresence` 保留原 API，并修正为打开当次 render 就可挂载，使焦点作用域能找到节点。

性能边界保持明确：不为 Chat 消息、虚拟列表、文件树或工作区尺寸增加 layout；Context 最后一项退出结束后仍一次性释放编辑区空间，不插值整个 composer / 消息流高度。32 / 40 是本批 DOM 测量范围上限，不是数据上限，也不代表所有低性能设备都已达标。

沿用并扩展 `motion:check`：扫描试点 Motion JSX 的显式 transition，拒绝组件内字面量 timing 和默认 spring；修复“同一 CSS transition 中 easing token 掩盖裸 duration”的漏报。为恢复既有门禁，少量现存 duration 改为既有 token，Artifact / Milkdown 的三个按钮源码位置补回动效标记；没有迁移这些 CSS 动画。临时负向探针确认裸 CSS 时长、裸 Motion 时长、缺省 spring 都会失败，探针随后删除。门禁不是完整的 CSS/JS 数据流分析器。

### 9.2 验证方法与适用范围

新增 `node scripts/motion-performance.js --incremental`。使用实际 Composer、ProjectsPage、Provider 组件、生产 React profiling 构建、临时合成数据与独立 userData。Linux arm64 / Electron 42.8.1，窗口 1440×1000，禁用 GPU，CDP CPU 1× / 4×；每个操作采样 550ms。原实现来自修改前保存的构建，复用同一个 runner 执行，并在原实现上确认真实项目节点存在、读取其位置，避免把缺少新 data 属性误认成负向控制。

报告记录 React commit 时间与 duration、不同 transform 值、退出保留、CDP LayoutCount / LayoutDuration / RecalcStyleDuration / ScriptDuration，以及完整 timeline trace 中的 Layout、Paint、PrePaint、Layerize。`CompositeLayers` / `Commit` 在本环境未返回对应 X 事件，**不能解释为零合成开销**，也不构成真实 GPU / 光栅线程预算通过的证据。Profiler 有非零提交的正向控制；删除/重排和 shared layout 有多个真实中间 transform，且单独验证项目矩形经过原位置与目标位置之间。

功能断言覆盖：最后一个收藏分组消失/首次出现、快速反向收藏与焦点、快速连续重排/删除的最终顺序、实际 HTML DragEvent 的 dragstart/drop、横向/纵向滚动保持、窗口 900/1440 resize、固定 composer 容器（document 不滚动）、导航期间禁用集合插值、50 Context / 60 Project 不截断且不启用 layout、最后一张图片退出时保留 Tray 高度、Provider resize / reduced motion，以及动画过程中切换系统动效偏好。原生 OS 拖动 ghost 的像素表现仍需真实桌面人工检查。

已查看 Projects 与 Context 的 Electron 截图。截图检查稳定布局，时间连续性由动态矩形和事件断言验证。真实低性能设备、GPU 合成耗时与各平台触控/拖动手感尚未验证。


### 9.3 前后对比与采用判断

以下为同一 runner 最后一次前后采样，数值均为「原实现 → 本批实现」。时间单位 ms；Layout / Paint / Layerize 是整个 550ms 采样窗口累计时间，不是每帧时间。短样本与共享主机存在波动，不能用单次结果承诺稳定帧率。

| 操作 | React commits | Layout 次数 | Layout ms | Paint ms | Layerize ms | 帧间隔 p95 |
| --- | --- | --- | --- | --- | --- | --- |
| Context 删除 1× | 1 → 2 | 1 → 4 | 0.24 → 0.70 | 0.52 → 2.79 | 0.20 → 2.74 | 16.8 → 16.8 |
| Context 重排 1× | 1 → 1 | 1 → 3 | 0.28 → 1.36 | 0.29 → 0.52 | 0.20 → 2.92 | 16.7 → 16.7 |
| Context 最后一项 1× | 1 → 3 | 1 → 2 | 0.10 → 0.22 | 0.23 → 0.63 | 0.33 → 0.37 | 16.8 → 33.3 |
| Project 收藏 1× | 2 → 2 | 2 → 5 | 0.83 → 2.22 | 1.57 → 2.09 | 0.71 → 2.29 | 16.7 → 16.8 |
| Context 删除 4× | 1 → 2 | 1 → 4 | 2.36 → 6.69 | 2.60 → 8.73 | 1.06 → 7.49 | 16.8 → 16.8 |
| Context 重排 4× | 1 → 1 | 1 → 3 | 2.86 → 4.50 | 0.91 → 0.59 | 2.21 → 10.50 | 16.8 → 16.8 |
| Context 最后一项 4× | 1 → 3 | 1 → 2 | 1.11 → 1.77 | 1.08 → 6.95 | 0.42 → 1.66 | 16.8 → 16.8 |
| Project 取消收藏 4× | 2 → 2 | 2 → 4 | 2.77 → 13.18 | 1.66 → 6.06 | 1.33 → 10.86 | 16.8 → 16.8 |
| Provider Add 关闭 1× | 1 → 3 | 1 → 4 | 0.11 → 0.61 | 0.14 → 1.20 | 0.14 → 0.39 | 16.7 → 50.0 |
| Provider Edit 关闭 1× | 1 → 3 | 1 → 1 | 0.05 → 0.05 | 0.40 → 0.28 | 0.09 → 0.14 | 16.8 → 50.0 |

空间收益有直接证据：同一个项目的 top 从 258.38px 移到 136.19px。关闭菜单后约 50ms，原实现已经跳到 140.13px（只剩新行自身的少量 CSS 位移），本批实现仍位于路径中间的 187.70px。Context 重排原实现没有位置插值，本批有多个中间位置；自然中断后仍按最新顺序落位。

React 提交没有随插值帧数增长：普通重排 1 次，收藏移动 2 次；删除多 1 次退出完成提交，整托盘/Provider CSS presence 为 3 次。滚动菜单的定位/焦点更新另外产生提交（测得 4～5 次），原始时间样本保留在报告中，不将它们误算成每帧渲染，也不隐藏在简单操作上限内。

**采用结论：保留这三个局部实现，其收益是空间/状态连续性，不是性能提速。** Motion 的测量和样式开销确实增加，尤其 4× CPU 的 Projects；Provider 虽然完全复用 CSS，禁用 GPU 时淡出也有明显慢帧。不能把功能断言通过写成性能验收全绿，本批不扩展到其他集合或大列表。

多次运行中的慢帧仍保留：中间一次 4× Project p95 333.3ms、Context 末项 150ms；另一次 Provider Add p95 133.4ms。它们与最后一次采样一起记录，不能仅选最快一次。试点 fixture 的 JS 总量相对原构建净增约 134KiB，gzip 约 45KiB（包含库、适配和 fixture 差异，不等于首屏传输量）。

原始证据（本机临时产物，不提交运行数据）：

- 最终 before：`/tmp/openmind-motion-performance-QjZw9K/incremental-report.json`；after：`/tmp/openmind-motion-performance-e5yGdl/incremental-report.json`。
- 当前副本：`.build/incremental-motion-before.json`、`.build/incremental-motion-after.json`；每次运行目录包含 `incremental-trace-*.json`、截图，可在 Chrome trace 工具中检查。
- 慢帧样本：`/tmp/openmind-incremental-final2.log`、`/tmp/openmind-motion-performance-dLy6hl/incremental-report.json`。早期 native drop 未插值和 last-item 尺寸问题已修正；最终功能断言通过。
- 再次运行：`node scripts/motion-performance.js --incremental`。复用已保存原构建时设置 `OPENMIND_MOTION_PERF_REUSE_DIR` 与 `OPENMIND_INCREMENTAL_MOTION_BASELINE=1`；每次复制到新临时目录，保留既有报告。

### 9.4 门禁结果与未通过项

| 检查 | 结果 | 说明 |
| --- | --- | --- |
| `npm run motion:check` | 通过 | CSS、点击标记、Motion transition 均无违规；负向探针能使门禁失败。 |
| `npm run typecheck` | 通过 | renderer 与 Electron 类型检查。 |
| `lint:reporoot` / `lint:manifests` | 通过 | 未引入业务数据、provider keys 或 Skill 源码。 |
| `build:renderer` / `build:electron` | 通过 | 保留原构建 chunk size warning，没有调高预算。 |
| 本批定向单测 | 通过 | 最新 6 文件 / 57 项，含 Provider 快照/重开、CSS token、live reduced motion、Context 浮层锚点/焦点、Projects 异步焦点与 Sidebar。 |
| `npm run test:unit` | **未全过** | 最近一次全量 181 文件：180 通过、1 失败；2043 项通过、3 跳过、2 失败。末尾 Context 浮层修正由上述最新定向测试覆盖。 |
| `test:integration` / `test:e2e` | 通过 | 独立临时 fixture，真实 Electron 挂载与 typed preload 路径。 |
| 增量 Electron 检查 | 功能通过 | 最终完整构建通过 presence、真实路径、焦点、快速操作、拖放、scroll/fixed、resize、预算上限与 reduced motion 断言；不等于所有帧率达标。 |
| 既有 `perf:motion` | 独立前后复跑均 19/19 通过 | 原预算未修改；本轮首次原实现有 preview close layout=21/15、max frame=116.6/100 失败，首次修改后有 theme max frame=233.2/150 失败，全部保留。 |
| `perf:resize` | 完成 | 1000-event fixture，2040→1800，121 次设置被浏览器合并为 24 次 resize；p95 33.3ms、max 33.4ms、0 Long Task。它输出报告，不是带帧率预算的通过门禁。 |
| 流式性能基准 | 独立前后对跑通过；首次失败保留 | 改动前 HEAD `6b86e84` 从临时源码构建，最终应用使用相同 runner / 数据 / 预算，仅替换加载路径与报告路径。commentary/artifact/reasoning 前后 p95 为 16.7/16.7/16.7 → 16.8/16.7/16.7ms。 |
| `npm run verify` 完整发布流水线 | 未执行到底 | 全量单测仍有下述独立 Skill 失败，不能宣称项目所有门禁全绿。 |
| 真实低性能设备 / GPU 合成预算 | 未验证 | 4× CPU + GPU-disabled 只是模拟；仍须实际桌面设备检查手感、合成/光栅成本。 |

两项全量单测失败均在未修改的 `electron/skills/installed-skill-execution-resolver.test.ts`：真实 x-following-fetcher 安装版本与请求版本不一致，以及 reddit → daily-article-summarizer 链路没有产生预期文章总结。没有通过删除断言、跳过用例或修改独立 Skill 包来掩盖失败。首次全量另有 Sidebar 冷动态导入超时，单独复跑和后续独立全量均通过，未放宽该测试超时。

既有 motion 前后独立报告：`/tmp/openmind-motion-performance-xeBi2G/report.json`、`/tmp/openmind-motion-performance-9x7aCN/report.json`；首次失败：`/tmp/openmind-motion-performance-0mvW5O/report.json`、`/tmp/openmind-motion-performance-PuUhRg/report.json`。流式首次执行 commentary / artifact 多项预算失败，原始日志保留于 `/tmp/openmind-motion-stream-final.log`，第二批从日志提取的报告为 `/tmp/openmind-motion-stream-first-failed.json`（`.build/stream-performance-report.json` 是后续运行会覆盖的滚动副本）；独立前后复跑结果为 `/tmp/openmind-motion-stream-baseline.json`、`/tmp/openmind-motion-stream-repeat.json`。没有证据把首次所有失败唯一归因于并行编译或共享主机负载，复跑通过也不抹除慢帧风险。

本批交付是三个有可测空间/状态收益的局部实现及验证记录。其他候选保持审计建议；真实设备性能验收仍未闭环。

## 10. 第二批实施记录（2026-09-17）

用户授权实施第二批，对应第 3.5 节剩余两项：Toast 集合移除后的补位、Recent Tasks 展开/收起。第一批实现保留；Project 文件后台刷新、Recent Tasks 置顶/归档位移、Projects 归档、主 Sidebar 和 Workspace 布局均未扩入本批。

### 10.1 采用的局部方案

| Location | Current behavior（本批修改前） | Problem | Recommendation / 本批实现 | Technology | Priority | Performance risk |
| --- | --- | --- | --- | --- | --- | --- |
| `renderer/src/components/FeedbackHost.tsx` Toast stack | CSS 保留退出 160ms；实际卸载时相邻通知直接跳到终点 | 缺少删除后的空间连续性 | 保留叶子 CSS 进入/退出，只给外壳加 `layout="position"`。`layoutDependency` 使用包含退出项的实际显示 ID 序列，因此退出计时结束时也会触发补位。固定且可滚动的根使用 `layoutRoot` / `layoutScroll`。 | Motion layout | P1 | 同时显示（含退出）最多 8 条才插值；超过上限保留全部通知和原 CSS presence。没有 LayoutGroup、layoutId 或逐帧 React 状态。 |
| `renderer/src/app/SidebarRecent.tsx` Recent Tasks | 条件渲染立即增加/移除列表，只转动箭头 | 内容和相邻操作区域瞬间跳变 | 复用 `AnimatedDisclosure`，只过渡整个折叠区域；关闭立刻 `inert` / `aria-hidden`，token 时长结束后卸载列表，快速重开取消卸载；保留折叠记忆。 | Keep CSS | P2 | 现有 `--dur-normal` / `--ease-emphasized` 驱动局部高度过渡，会增加 layout / paint；列表仍有原来的 `min(32vh, 260px)` 高度上限，无逐行 Motion。 |
| `renderer/src/design-system/use-exiting-list.ts` 共享 presence | 系统减少动效时 CSS 已归零，JS 仍保留退出项 | 不可见项目仍等待计时，偏好变化时退出不立即结束 | 使用已有实时 reduced-motion hook；减少动效或零时长时立即移除，清理待退出计时，避免重现项目被旧计时器移除。Toast 退出元素增加 `inert` / `aria-hidden`。 | Keep CSS | P1 | 只调整 presence 生命周期；回归验证 Chat、approval banner、ResponsiveActionBar 的原有调用路径。 |

Toast 沿用第一批薄 adapter 中的 `tokens.layout` / `tokens.exitMs`；Recent Tasks 卸载时长从同一 adapter 的 normal duration 换算。没有新增 CSS timing、spring 参数或第二套 tokens。CSS 继续处理 hover、按钮、Toast 叶子进入/退出和 disclosure。`layoutRoot` / `layoutScroll` 用于坐标校正，能力依据见 [Motion 官方 layout 文档](https://motion.dev/docs/react-layout-animations)。

### 10.2 运行验证方法

新增 `scripts/fixtures/feedback-motion/` 与 `scripts/feedback-motion-electron.js`，通过 `node scripts/motion-performance.js --feedback` 运行真实 `FeedbackHost` / `SidebarRecent`，使用合成通知与 40 条合成任务、临时 Electron userData，不读取开发者数据或调用 provider。

- 在修改产品代码前构建并冻结第二批 baseline（已经包含第一批），前后使用相同 runner。不是用第一批实施前的 HEAD 冒充第二批 baseline。
- React production profiling 构建记录真实 commit 样本；断言有非零 commit，并限制每个简单操作最多 4 次，以识别动画帧驱动的 React 更新。
- 每阶段采样 550ms，记录 rAF p95 / max、CDP LayoutCount / LayoutDuration / RecalcStyleDuration / ScriptDuration 和完整 `devtools.timeline,cc` trace。高度样本用 ResizeObserver 收集。
- 几何读取单独运行，不混入上述性能窗口。对同一条真实通知的 rect 采样，旧构建必须没有中间位置，新构建必须有中间位置；不能仅凭新实现专属 DOM 属性判断动画成功。
- 检查固定滚动容器、12 条通知超预算但不丢数据、连续新增/删除、反复展开/收起、真实 Tab 键跳过退出项、窗口 resize、导航过渡重叠、reduced motion 初始及运行中切换。

环境为 Linux arm64、Electron 42.8.1、GPU disabled、1× / 4× CPU。4× 限速是模拟，不等于实际低性能设备。trace 中本环境没有完整 `CompositeLayers` duration 事件，不能把计数为零解释成合成成本为零；保留 Paint、PrePaint、Layerize 和原 trace 供复核。

### 10.3 收益与成本

首次完整局部基准：before `/tmp/openmind-motion-performance-xWH3gL/feedback-report.json`，after `/tmp/openmind-motion-performance-D8JaAt/feedback-report.json`。

- 同一通知最终都从 y=757 移到 808.5。原实现约在退出完成时直接跳变；Motion 实现退出后依次经过约 766、781、790 等中间位置，最后收敛到相同坐标。普通退出 / 滚动退出各记录到 14 种 transform 值，旧版为 0。
- Toast 普通删除仍为 2 次 React commit，正常 / 4× CPU 的 LayoutCount 均从 2 增至 4，没有按动画帧持续 layout。reduced-motion 删除从 2 次 commit / 2 次 layout 降至 1 / 1，且没有退出保留。
- Recent Tasks 原来仅一次高度变化；CSS disclosure 收起和展开各记录到约 13 个高度值。收起 commit 从 1 到 3，展开从 1 到 2；增加的是切换 / presence 收尾，不是逐帧 React render。
- CSS 高度过渡有真实成本：1× 收起 layout 总耗时约 0.14→2.39ms，展开约 3.27→6.38ms；4× 展开约 14.73→23.49ms。它改善空间连续性，不是性能优化，仍限于这个小区域。
- 首次全部操作的 p95 都在约 16.7～16.8ms。4× Recent Tasks 展开 max 从原来的 50.0ms 到 66.7ms；收起 max 从 16.7ms 到 33.3ms。保留慢帧证据，不承诺低性能设备全程 60fps。

Toast 的位置连续性通过几何对照确认，采用 Motion 外壳；Recent Tasks 采用现有 CSS disclosure，避免把任务行纳入 Motion 测量。没有因此扩展成通用列表迁移。

补齐真实键盘、导航过渡重叠、disclosure 期间 resize 和 layout 插值期间偏好切换后，用上述冻结构建再次运行同一完整 runner，所有功能断言通过：before `/tmp/openmind-motion-performance-kMN66M/feedback-report.json`，after `/tmp/openmind-motion-performance-4xSvcz/feedback-report.json`。前后 p95 仍约 16.7～16.8ms；4× 展开 max 为 66.7→83.3ms，layout 总耗时 14.66→40.51ms。trace 显示修改后最大的单次 layout 为 30.71ms、691 个 dirty objects，后续高度帧只有 9 个 dirty objects；长列表首次挂载仍是慢帧风险，不据此宣称 4× 限速无回归。

最终 1× Toast 删除 layout 总耗时 0.21→0.38ms、Paint 0.46→0.49ms；1× disclosure 展开 layout 3.91→6.63ms、Paint 1.44→4.29ms。增加的局部高度/位置连续性具有可见收益，同时保留其开销证据。没有调高任何现有性能预算。

复跑命令：`node scripts/motion-performance.js --feedback`。要复用修改前构建，设置 `OPENMIND_MOTION_PERF_REUSE_DIR=/tmp/openmind-motion-performance-xWH3gL` 和 `OPENMIND_FEEDBACK_MOTION_BASELINE=1`；输出会写入新临时目录，避免覆盖旧 trace。`.build/feedback-motion-before.json` / `.build/feedback-motion-after.json` 保存最近一次报告副本。

### 10.4 门禁与剩余限制

| 检查 | 结果 | 证据与边界 |
| --- | --- | --- |
| `motion:check` | 通过 | CSS、点击标记、Motion transition 均无违规；未放宽规则。 |
| `typecheck` | 通过 | renderer 和 Electron 类型检查。 |
| `lint:reporoot` / `lint:manifests` | 通过 | 仓库边界及 16 个正式 manifest 校验通过。 |
| `build:renderer` / `build:electron` | 通过 | 保留既有 chunk size warning；未清理历史基准报告。 |
| 定向测试 | 7 文件 / 139 项通过 | Toast、Recent Tasks、两种 presence/disclosure、ResponsiveActionBar、approval banner、Chat；新增 7 项生命周期回归测试，另加强 Toast inert 断言。日志 `/tmp/openmind-feedback-tests.log`。 |
| 全量 `test:unit` | **2 失败 / 2051 通过 / 3 跳过** | 181 文件中 180 通过；仍为第 9.4 节两项未修改的 InstalledSkillExecutionResolver 用例。日志 `/tmp/openmind-feedback-unit.log`；没有跳过或削弱断言。 |
| `test:integration` / `test:e2e` | 通过 | 独立合成数据，实际 Electron / preload / IPC 挂载通过；日志 `/tmp/openmind-feedback-integration.log`、`/tmp/openmind-feedback-e2e.log`。 |
| 本批 Electron 功能 / 几何对照 | 通过 | 首次及补充检查后的前后对跑均通过；真实 Tab、40 行保留、快速反向操作、fixed/scroll、超预算、resize、导航重叠和实时 reduced-motion 均有断言。 |
| 既有 `perf:motion` | 前后均 19/19 通过 | before 复用首批已保存的 `/tmp/openmind-motion-performance-9x7aCN` 构建，本次报告 `/tmp/openmind-motion-performance-dH3ZLo/report.json`；当前源码重新构建的 after 为 `/tmp/openmind-motion-performance-PQWvkV/report.json`。原预算不变。 |
| `perf:stream` | 14/14 通过 | commentary / artifact / reasoning 的 p95 为 16.7 / 16.8 / 16.8ms，max 33.4 / 33.3 / 16.8ms，均 0 Long Task。独立报告 `/tmp/openmind-feedback-stream-report.json`。 |
| `perf:resize` | 完成 | 1000-event fixture，121 次尺寸设置被合并为 26 次 resize，2040→1800；p95 16.7ms、max 33.4ms、0 Long Task。此脚本输出测量结果，没有帧预算通过门禁。报告 `/tmp/openmind-feedback-resize-report.json`。 |
| 完整 `verify` 发布流水线 | 未执行到底 | 全量单测仍有独立失败，不能声称所有项目门禁全绿。 |
| 真实低性能设备 / GPU | **未验证** | 4× CPU 软件渲染检查已做，Recent Tasks 长列表展开有慢帧。GPU 合成与实机交互手感仍需实际设备验收。 |

本批采用两个有明确空间/状态连续性收益的局部实现。保留高数量 Toast 的原行为和原有 CSS 技术边界；未引入第二套动效规范。

## 11. 第三批实施记录（2026-09-17）

用户授权实施剩余五项：Project 文件后台刷新、Daily Brief 后台刷新、Projects 紧凑列表 / 详情切换、Projects 归档退出、AI 预览 Web Animations timing 接入 tokens。本批没有增加 Motion 使用面；归档沿用第一批项目列表的有界 position layout，其余采用状态修正或既有 CSS / Web Animations。

### 11.1 采用方案与目的

| Location | Current behavior（本批修改前） | Problem | Recommendation / 本批实现 | Technology | Priority | Performance risk |
| --- | --- | --- | --- | --- | --- | --- |
| `ProjectFilesPanel.tsx` 后台刷新 | 每次 loading 都卸载文件行；失败用错误状态替换整个列表 | 保留下来的文件失去 DOM、焦点和滚动连续性 | 区分首次加载和后台刷新；原行保留，使用原搜索图标位置显示刷新反馈和 `aria-busy`；错误附在旧列表后并提供重试。请求序号防止旧响应覆盖新结果。 | No animation | P1 | 低：不增加 layout 测量，不为文件集合加 Motion；真实删除/重命名造成的数据及 key 变化仍按原逻辑提交。 |
| `DailyBriefPage.tsx` 列表刷新 | 七个 skeleton 插在旧文件行前；列表失败会替换右侧详情 | 旧行先下移再跳回，列表网络错误打断阅读 | Skeleton 只用于首次加载；后台刷新保留列表，错误放在列表底部。保留当前选择；晚到响应不覆盖期间的新选择，自动 Skill 刷新读取最新 dirty 状态，保留期间编辑的草稿。 | No animation | P1 | 低：不插值文件行；显式打开/重新读取详情继续走既有预览生命周期。 |
| `ProjectsPage.tsx` 实际 portal 紧凑入口 | `display: none` 直接切换；返回后再次选中同一文件/任务/文档可能不打开详情 | 状态切换硬切，当前对象与焦点返回路径不完整 | 只在显式操作时启用两面板短 opacity / 4px 方向过渡；保持 portal host、编辑器实例和草稿。退出面板立即 inert / aria-hidden，结束后 display:none；双向恢复焦点，重选当前项只切换面板。Resize / 导航 / reduced motion 关闭过渡。 | Keep CSS | P1 | 低中：退出期间短暂保留两个面板；不插值轨道宽度或编辑器高度，不持续保留隐藏聊天的布局。 |
| `ProjectsPage.tsx` 项目归档 | 归档即删除行；最后一个收藏使整个分组立即卸载。第一批已让普通同组邻居部分插值 | 退出不连续，分组消失时空间关系丢失 | 在分组前使用既有 `useExitingList` 保留退出行及最后一个分组，叶子复用 CSS opacity exit；卸载时更新 layoutDependency，让已有外壳补位。焦点移到相邻操作按钮或搜索，不抢走异步期间已移动的焦点。 | Motion layout | P1 | 中：使用已有外壳，最多 40 个显示项目启用 layout，查询 / resize / 导航期间禁用；超预算仍完整显示项目。系统减少动效立即结束退出保留。 |
| `use-preview-motion.ts` AI 预览 FLIP | JS 字面量复制 CSS timing，存在维护漂移 | 现有效果已流畅，问题是规范来源重复 | 扩展现有薄 adapter，读取 `--dur-slow` / `--ease-emphasized`，转换为 WA 毫秒与 easing 字符串；继续使用原 FLIP、取消及 resize 逻辑。缺少有效 token 时立即落位。 | Keep Web Animations | P2 | 低：仅挂载时读取 tokens，不改变几何读取范围，不把 WA 迁为 Motion。 |

紧凑面板使用既有 `useExitPresence` 驱动显示标记，仅在退出计时结束时应用 display:none；始终保留 React 组件和 portal hosts。`@starting-style` 为重新显示的面板提供进入起点，见 [Chrome 官方进入/退出动画说明](https://developer.chrome.com/blog/entry-exit-animations)。所有时长和 easing 来自既有 CSS tokens，没有新增 spring 参数、定时规范或逐帧 React state。

运行验证发现项目行的 inert 不会传播到其 portal 菜单，因此给 DropdownMenu 增加可选 `menuInert`，仅由归档退出行使用；普通菜单和收藏操作保持原生命周期。归档成功后先转移焦点，再将行及遗留菜单设为 inert / aria-hidden。连续操作 runner 也排除了仍在退出的旧菜单，避免用 `.click()` 点击非当前菜单。

中间版尝试了 CSS `display ... allow-discrete`，trace 记录到 160ms 内持续出现 8 个 dirty objects 的 Layout。改为 presence 后，后续样本仍有逐帧布局，不能把它全部归因于 display 插值。进一步的 invalidation trace 指向 `document-editor-scroll` 的 `Scrollbar changed`；局部 overflow clip、contain 和 scrollbar-gutter 探针均未消除，未将这些实验性改动写入产品。保留 opacity / 4px transform，并由既有 presence 控制最终 display；不能声称这个过渡完全没有布局成本。

另外发现紧凑详情退出时原 `list-collapsed` 类被清除，会立即移除编辑器为返回按钮预留的左侧空间。现让紧凑详情始终保留该 inset，避免淡出期间内容先横跳 56px；宽屏仍按原来的列表折叠状态调整。Runner 比较实际 computed padding，验证退出前后相同。

### 11.2 验证设计

新增 `scripts/fixtures/workspace-motion/` 和 `scripts/workspace-motion-electron.js`，通过 `node scripts/motion-performance.js --workspace` 执行。真实 ProjectsPage、DailyBriefPage、MarkdownEditor、portal 和 FeedbackHost，生产 profiling 构建；合成 8 / 42 个项目、21 个文件和 20 个简报，后台列表固定模拟 250ms 等待，独立临时 userData。

产品改动前冻结了包含前两批改动的 renderer / shared 源码：`/tmp/openmind-workspace-motion-before-8aqpg07s`。前后使用同一新 fixture 和 runner；不会把最初 HEAD 当成第三批 baseline。错误 API 参数和按钮标签导致的早期 harness 中断不作为产品失败或通过，日志保留。

每个操作目标采样 550ms：React commit / duration、rAF p95 / max、CDP LayoutCount / LayoutDuration / RecalcStyleDuration / ScriptDuration，以及 `devtools.timeline,cc` 的 Layout / Paint / PrePaint / Layerize 和原始 trace。报告同时保存实际 `sampleElapsedMs` 和最后一个 rAF 到停止采样的 `lastFrameGap`，最大间隔包含此尾部等待，避免忽略采样末尾的阻塞。几何和 computed style 验证另开窗口，避免把验证自身的强制测量计入性能数据。Profiler 必须有非零提交，简单归档和紧凑切换最多 6 次提交，检测动画逐帧驱动 React 的退化。

Linux arm64 / Electron 42.8.1、禁用 GPU、CPU 1× / 4×；这是真实 Electron 软件渲染测试和限速模拟，不替代真实低性能设备或 GPU 验收。`CompositeLayers` 未提供完整 duration 事件，不将空计数解释为零合成成本。前两批长列表/流式性能边界继续有效。

Profiler 覆盖当前页面及 FeedbackHost，提交数包含菜单、通知的 presence 和自动消失；不把所有提交都归因于文件行或紧凑面板，也不依据单次提交数差异宣称提速。共享主机多路编译期间保存过 CPU pressure 记录（`/tmp/openmind-workspace-host-pressure.log`），实际存在明显慢帧；没有证据把所有波动唯一归因于外部负载。

### 11.3 对照结果与性能限制

首次完整 presence 版本的对照报告（尚未补齐末尾 inset 修正）：before `/tmp/openmind-motion-performance-iR5Mm4/workspace-report.json`，after `/tmp/openmind-motion-performance-8DyLMx/workspace-report.json`。实际采样窗口 before 为 564～687ms，after 为 559～1361ms；共享主机卡顿会使目标 550ms 窗口延长，因此累计耗时不能当作相同工作时长下的稳定吞吐对比。

确认的体验收益：

- 文件后台刷新：旧构建会断开 survivor 行 DOM，新构建保持同一节点。单测同时覆盖焦点、scrollTop、选中项、失败保留和旧请求竞态。
- 简报后台刷新：旧构建首行 y 从 178 跳到 591px（七个 skeleton），新构建始终为 178px。后台请求期间编辑的草稿和更新的文件选择均保留。
- 归档：原来已经有部分分组位置插值，不能说本批首次实现了项目补位。本批增加的是先保留并淡出归档对象，再完成原有补位；同一邻居从 170.38 到 88.19px，新版在退出期间先保持原位置，然后经过约 119.70、99.29、90.11px。行及其 portal 菜单退出期间不能继续操作。
- 紧凑切换：旧版第一帧 opacity 已为 1；新版测得 0、0.17、0.52、1 等中间值。列表和详情 host、文档编辑器 DOM 保持同一实例；返回后重选同一文件/产物会恢复详情且不重复读取。
- AI 预览：生产 tokens 仍为 240ms / `cubic-bezier(.3, 0, 0, 1)`，视觉 timing 与原实现一致。单测改变 CSS token 后，WA 实际 options 跟随变化，消除了另一份字面量的维护来源。

上述 inset 修正前的完整 runner 通过连续归档、快速反向切换、真实 Tab 跳过退出详情、宽窄窗口切换、隐藏面板最终 display:none、reduced motion 及运行中偏好变化、42 个项目不截断且不启用 layout 的检查。异步 resize / 连续归档使用状态条件等待；没有放宽性能采样目标或现有帧预算。已查看真实 Electron 紧凑列表截图。

下表是同一 runner 的上述完整对照，均为「before → after」，时间为 ms；累计 Layout / Paint 不代表每帧成本。

| 操作 | fixture React commits | Layout 次数 | Layout ms | Paint ms | 帧间隔 p95 | 最大间隔（含尾部等待） |
| --- | --- | --- | --- | --- | --- | --- |
| 归档最后收藏 1× | 2 → 5 | 6 → 8 | 17.22 → 6.67 | 13.89 → 8.91 | 83.4 → 37.7 | 100.1 → 66.6 |
| 归档普通项目 1× | 2 → 5 | 6 → 8 | 5.01 → 15.15 | 5.99 → 34.58 | 16.8 → 133.3 | 16.8 → 133.3 |
| 文件后台刷新 1× | 5 → 7 | 8 → 9 | 19.77 → 13.71 | 11.40 → 16.56 | 78.9 → 16.8 | 83.4 → 33.3 |
| 简报后台刷新 1× | 3 → 2 | 2 → 3 | 37.34 → 2.26 | 1.67 → 0.80 | 33.3 → 16.8 | 150.1 → 16.8 |
| 紧凑列表切换 1× | 1 → 5 | 1 → 8 | 1.33 → 11.10 | 0.62 → 9.91 | 16.8 → 50.0 | 19.9 → 66.7 |
| 归档最后收藏 4× | 2 → 3 | 6 → 7 | 34.73 → 14.68 | 24.03 → 17.45 | 200.0 → 66.8 | 200.0 → 100.1 |
| 归档普通项目 4× | 2 → 3 | 5 → 6 | 42.77 → 121.29 | 58.70 → 19.41 | 166.7 → 216.7 | 247.8 → 303.7 |
| 文件后台刷新 4× | 6 → 4 | 8 → 3 | 41.42 → 259.51 | 33.67 → 50.07 | 116.7 → 325.2 | 116.7 → 435.2 |
| 简报后台刷新 4× | 3 → 5 | 3 → 6 | 44.75 → 22.74 | 14.92 → 24.15 | 166.6 → 150.1 | 166.6 → 150.1 |
| 紧凑列表切换 4× | 1 → 2 | 1 → 6 | 15.33 → 507.81 | 2.89 → 35.33 | 33.3 → 604.9 | 83.1 → 604.9 |

**功能与状态连续性有直接收益，但本批不能标记为性能验收全绿。** 4× 下出现严重慢帧，尤其紧凑切换；上述样本不足以证明低性能设备无回归。Presence 收尾、焦点恢复、通知会增加离散 React 提交和布局工作；没有逐帧 React 驱动，但仍观察到原生滚动区的逐帧布局，以及切换、presence 收尾及通知布局。CPU / GPU 验收需在稳定且有代表性的环境继续进行。

中间失败与慢帧样本不删除：`/tmp/openmind-motion-performance-nDMbEn/workspace-failure.json`、`/tmp/openmind-motion-performance-LotnCi/workspace-failure.json`、`/tmp/openmind-motion-performance-luF2cA/workspace-failure.json`。其中包含高负载下未在固定等待内完成的状态、旧 runner 点击退出菜单，以及中间 display 方案的成本；修正后的完整 runner 通过功能断言，不抹除这些性能风险。

同一 presence 版本再次完整前后对跑也通过全部功能断言：before `/tmp/openmind-motion-performance-FDGfQV/workspace-report.json`，after `/tmp/openmind-motion-performance-ki9hfJ/workspace-report.json`。采样窗口约 554～594ms。1× 文件刷新 p95 16.7→16.8ms、简报 16.8→16.8ms、紧凑切换 16.7→16.7ms；4× 紧凑切换 p95 16.7→33.2ms、Layout 总耗时 7.06→32.14ms。较轻负载下仍有额外成本，不能用这组较好样本覆盖前一组严重慢帧。

**最终 inset 修正后的验证单独记录：** 最新 renderer 构建 `/tmp/openmind-motion-performance-7TGQ6h` 的完整 workspace 尝试，在 4× 普通项目归档阶段出现 508.4ms 尾部等待，未捕获中间 transform，运行失败；日志 `/tmp/openmind-workspace-inset-runtime.log`。不能把前述完整通过结果当作最终源码的全量通过。

随后复用这一最终构建，仅对最后的 compact inset 修正进行 CPU 1×、禁用 GPU 的 Electron 功能检查，通过：退出前后 padding 均为 56px；返回后编辑器和 portal host 身份不变、不重复读取文档；Tab 跳过隐藏详情；reduced motion 正常收尾；宽屏恢复两面板和 0px inset，回到窄屏恢复 56px inset。报告 `/tmp/openmind-final-compact-check-ug0djj3a/compact-inset-report.json`，日志 `/tmp/openmind-final-compact-check.log`。此检查不采集性能，也不替代失败的最终 4× 全量检查。

复跑：`node scripts/motion-performance.js --workspace`。冻结 baseline 可使用 `OPENMIND_WORKSPACE_MOTION_BASELINE=1 OPENMIND_MOTION_PERF_REUSE_DIR=/tmp/openmind-motion-performance-oXdCmj`；每次写入新的临时目录，保留原报告和 trace。`.build/workspace-motion-before.json` / `.build/workspace-motion-after.json` 为最近报告副本。

### 11.4 门禁与验收边界

| 检查 | 结果 | 证据与边界 |
| --- | --- | --- |
| `motion:check` / `typecheck` | 通过 | 最后补齐 portal inert、compact presence 和固定 inset 后重跑通过；最新日志 `/tmp/openmind-workspace-inset-gate.log`、`/tmp/openmind-workspace-inset-typecheck.log`。 |
| `lint:reporoot` / `lint:manifests` | 通过 | 无边界违规，16 个正式 manifest 通过。 |
| `build:renderer` / `build:electron` | 通过 | 最终 renderer 构建日志 `/tmp/openmind-workspace-inset-build.log`；Electron 源码未变，构建通过。保留原 chunk size warning。 |
| 定向单测 | 7 文件共 49 项通过 | 初始 5 文件 39 项通过；最后 portal / compact 调整后 ProjectsPage、controls、useExitPresence 的 31 项再次通过，其中 21 项重叠。日志 `/tmp/openmind-workspace-unit.log`、`/tmp/openmind-workspace-final-tests.log`。 |
| 全量 `test:unit -- --maxWorkers=1` | 首轮未全过 | 182 文件：179 通过、3 失败；2049 通过、16 失败、3 跳过。包括已有两项 InstalledSkillExecutionResolver 失败和 14 项 App/Chat 超时或异步等待失败，日志 `/tmp/openmind-workspace-unit.log`。 |
| App / Chat 失败复核 | 117 / 117 通过 | 两个完整测试文件单独复跑，未修改超时、断言或跳过测试。日志 `/tmp/openmind-workspace-timeout-recheck.log`；不把首轮全量报告改写成全部通过。最后 portal 补充由上述定向测试覆盖。 |
| 最后 inset 修正的 Projects 回归 | 20 项通过 + 1 项超时复核通过 | 完整 21 项中归档首项超过原 5s 限制；使用原断言单独复跑通过，其余 20 项此前已通过。日志 `/tmp/openmind-workspace-inset-tests.log`、`/tmp/openmind-workspace-inset-test-recheck.log`，未调整测试超时。 |
| `test:integration` / `test:e2e` | 通过 | 独立 fixture / 实际 Electron；日志 `/tmp/openmind-workspace-integration.log`、`/tmp/openmind-workspace-e2e.log`。运行早于最后 portal / compact 调整；后续定向单测和 Electron 覆盖范围见本节其他记录。 |
| 第三批 Electron 功能 / 几何对照 | inset 修正前两次完整通过；最终 4× 尝试失败 | 第 11.3 节保留各版本报告。完整通过版本包含负向旧版控制、真实 DOM / editor 身份、快速操作、键盘、resize、实时减少动效；最终构建因 508.4ms 尾部等待未捕获归档中间位置，未完成全量检查。 |
| 最终 compact inset Electron 检查 | 定向功能通过 | 最终构建，CPU 1×、禁用 GPU；确认退出空间、编辑器实例、返回、焦点、reduced motion、宽窄窗口恢复。报告 `/tmp/openmind-final-compact-check-ug0djj3a/compact-inset-report.json`；不作为性能通过证据。 |
| 首批 `--incremental` 功能回归 | 完整复跑通过 | 24 个采样阶段，收藏跨组 / 焦点、Context 删除重排 / 原生拖放、Provider 退出、scroll / resize / reduced motion 均通过。报告 `/tmp/openmind-motion-performance-212ADf/incremental-report.json`。首次完整尝试被中断；下一次出现 383ms 慢帧、未捕获足够 shared 中间位置而失败，保留 `/tmp/openmind-workspace-incremental-verified.log`，未放宽断言。 |
| 既有 `perf:motion` | 本次 after 17 / 19 通过 | Preview 的 9 项 layout / close-frame 检查全部通过；两个未修改的 theme max-frame 检查为 164 / 233.3ms，超过 150ms。after `/tmp/openmind-motion-performance-0VZOTg/report.json`。 |
| 既有 `perf:motion` 本次 before | 中途中断 | 复用第二批冻结构建 `/tmp/openmind-motion-performance-PQWvkV`；本次旧版 open/close 已有 200～483ms 慢帧，并在第三次 close 未捕获 glide 时中断，日志 `/tmp/openmind-workspace-motion-before.log`，目录 `/tmp/openmind-motion-performance-XidtLO`。不能写成本次前后 19/19 通过。 |
| `perf:stream` | 本次 4 / 14 通过 | commentary / artifact / reasoning p95 为 33.4 / 16.8 / 33.3ms，max 166.7 / 216.7 / 183.4ms，Long Task 为 6 / 7 / 2。报告 `/tmp/openmind-workspace-stream-report.json`。第二批参考报告曾 14/14 通过，但不是本次同负载的 before；未调整预算。 |
| `perf:resize` | 完成 | 1000-event fixture，2040→1800，121 次设置合并成 19 个 resize；p95 33.4ms、max 66.7ms、0 Long Task，LayoutCount 38。此脚本没有帧预算门禁，报告 `/tmp/openmind-workspace-resize-report.json`。 |
| 低性能设备 / GPU / 全量发布 `verify` | 未验收完成 | 4× 软件渲染存在慢帧；真实设备与 GPU 合成尚未验证。全量单测存在独立 Skill 失败，未执行完整发布流水线，不能宣称项目所有门禁全绿。 |


## 12. 第四批：性能收尾与剩余 CSS 缺口（2026-09-17）

用户授权处理上轮推荐的五项。本批采用四个局部改动；Projects 紧凑切换完成定向性能排查，未找到有可验证收益的低风险替代，因此遵守「收益不足保留原实现」的约束，没有加入实验性 CSS 或移除原有动效。**这不表示紧凑切换性能问题已经解决。**

### 12.1 范围与采用决定

| Location | Current behavior（本批修改前） | Problem | Recommendation / 本批结果 | Technology | Priority | Performance risk |
| --- | --- | --- | --- | --- | --- | --- |
| Projects 紧凑切换 | opacity / 4px transform、既有 presence；软件渲染存在逐帧原生布局 | 编辑器滚动区在位移期间仍失效 | 定向对照后保留原实现。overflow、containment、layer、individual translate 和 3D transform 均未消除额外布局；不采用无明确收益的改动。 | Keep CSS | P1 | 未闭环：GPU / 真实低性能设备仍需验收。 |
| Recent Tasks 长历史展开 | 整体 CSS disclosure，一次挂载全部任务与操作按钮 | 首次挂载和布局成本随历史数量增长 | 超过 20 条时复用项目现有 TanStack virtualizer，仅挂载可见范围、overscan 和持有焦点的行；数据不截断，保留原 CSS 折叠。小集合仍完整渲染，阈值两侧保持同一 keyed row host。 | Keep CSS | P1 | 中：滚动、动态测高、焦点和数量阈值是主要回归面；无逐行 Motion。 |
| Settings Skill / MCP / Provider advanced | 条件渲染直接改变高度 | 相邻内容跳变，局部详情没有退出保留 | 复用 AnimatedDisclosure，按既有 normal token 收尾；关闭立即 inert / aria-hidden；高级表单值保持在原业务状态。MCP 搜索及清空搜索导致的批量展开/收起立即完成。 | Keep CSS | P2 | 低中：局部高度插值有实际 layout 成本，不宣称只走 compositor。 |
| 窄窗口导航遮罩 | 关闭时立即删除，而抽屉仍在退场 | 两者退出不同步 | 复用 useExitPresence，opacity transition 使用既有 normal / exit token；快速重开从当前状态反向过渡，关闭立即 inert；离开 drawer 布局立即撤去遮罩。 | Keep CSS | P2 | 低：单个 fixed surface；实际抽屉内容与焦点收尾仍有额外成本。 |
| Project 图标选择器 | 条件 portal，关闭即卸载 | 没有退出连续性；嵌套浮层需要独立焦点与 Escape 边界 | 复用 CSS presence，保留原进入幅度，改用可反向的 CSS transition；退出时 inert / aria-hidden，重开取消卸载。与父 ProjectDialog 同级的既有 focus scope 保证 Escape 先关闭图标选择器，焦点返回触发按钮。 | Keep CSS | P2 | 低中：portal、父弹窗关闭、锚点 resize 和退出焦点需同时覆盖。 |

没有新增依赖或 Motion layout 使用面。虚拟列表复用已安装库及工具消息列表使用的 `directDomUpdates` / `useFlushSync: false` 模式；正常滚动仅在可见范围变化时更新 React，CSS disclosure 的每帧高度变化不触发逐行 React 状态。End / Home、上下方向键、Tab / Shift+Tab 可跨越未挂载行，持有焦点的行在滚出可视区后仍保留。

最后复核将上述键盘接管明确限制为虚拟列表。20 条以内继续使用原生 Tab / Shift+Tab 与浏览器焦点滚动，避免静态列表调用禁用的 virtualizer 后又阻止原生滚动；新增短列表回归用例验证两个方向均不取消默认事件。此单行边界补充晚于第 12.3 节完整性能报告，不改变该报告中 40 / 400 条的虚拟列表路径。

AnimatedDisclosure 仅新增可选 `animate` 参数，用于明确的批量查询操作；默认行为保持不变。所有新过渡都读取既有 CSS tokens；virtualizer 的估算行高和数量阈值是布局 / 性能参数，不是第二套动效 timing。

### 12.2 紧凑切换定向排查

冻结第三批最终构建进行独立探针，报告分别为：

- `/tmp/openmind-followup-compact-probe-jifa2ix3/compact-probes.json`：原实现、overflow scroll / hidden、滚动区 layer、外层 clip。
- `/tmp/openmind-followup-compact-probe2-7297tnol/compact-probes.json`：scroll / editor shell strict containment、原生滚动条模式、pointer events。
- `/tmp/openmind-followup-compact-probe3-sjw9oeti/compact-probes.json`：opacity-only / transform-only 诊断控制、滚动条样式。
- `/tmp/openmind-followup-compact-probe4-kw56nq1v/compact-probes.json`：individual translate、translate3d 与重复原实现。

诊断控制中 opacity-only 为 3 次 Layout，保留位移的样本为约 7～12 次；这表明位移路径仍与额外布局有关，**不等同于已经确定浏览器内部根因**。降低或移除效果的探针仅用于区分触发条件，未写入产品；所有保留相同效果的简单探针都没有足够证据支持采用。主机负载存在明显波动，不用单次 duration 较低替代同效果的几何与布局次数证据。

追溯说明：最初一次探针误复用第三批临时构建目录 `/tmp/openmind-motion-performance-7TGQ6h`，覆盖了其中的 `workspace-trace-1.json`；该文件不能再作为第三批原始 trace。第三批失败日志和 JSON 报告未改。后续探针均复制构建到上列独立目录，本文本批对照只引用这些独立报告。

### 12.3 新增验证入口与证据范围

新增 `node scripts/motion-performance.js --followup`，真实 AppShell、SidebarRecent、SkillSettingsSection、AiProvidersSettingsSection、ProjectEditDialog；使用 40 / 400 个合成任务和合成设置数据、独立临时 userData。修改前源码冻结在 `/tmp/openmind-motion-followup-before-muahjygo`；before 使用相同新增 fixture / runner，只保留冻结的产品源码。

生产 profiling 构建，Linux arm64 / Electron 42.8.1、GPU disabled、CPU 1× / 4×。每阶段目标采样 550ms，记录实际采样时间、尾部 rAF 等待、React commit / duration、Layout / Style / Script、Paint / PrePaint / Layerize 与原始 trace；不能把未返回 duration 的 CompositeLayers 解释为零合成开销。几何 / 键盘断言独立于性能窗口。

原始 before：`/tmp/openmind-motion-performance-SFAu1i/followup-report.json`。虚拟化初版完整通过：`/tmp/openmind-motion-performance-eIZvi6/followup-report.json`；较早版本 `/tmp/openmind-motion-performance-WDr7VD/followup-failure.json` 在原生 Enter 注入检查处失败。定向控制证实 Electron 的 keyDown / keyUp 不会自动生成激活原生按钮所需的 char 事件，补齐实际 Enter 事件序列后通过，未改产品按钮或跳过末项打开验证。该初版完整报告早于随后「阈值两侧保留 host」及图标反向 transition 的补充。

`--feedback` 既有回归入口同步验证虚拟列表的完整 aria-setsize、挂载上限与实际 End / Home 到达最后一条；小集合/旧构建仍验证全部 DOM。不再以「40 个 DOM 节点」作为长历史数据完整性的替代证据，既有帧预算与 React 提交上限保持原值。

截图复核发现早期独立 Settings fixture 误占用了 `.settings-page` 的 260px 导航列，不能把早期设置高度 / 性能数据当作正常详情宽度的结果。已将 fixture 调整为既有 `.settings-detail-inner` 的 980px 内容上限，并在 runner 中对保存的 before / after 构建应用相同布局修正；增加详情卡片宽度大于 900px 的断言。产品页面未因该 fixture 修正而改变。

修正宽度后的 before 为 `/tmp/openmind-motion-performance-xpuyAg/followup-failure.json`：完成 16 个性能采样阶段，但随后触及原 120s watchdog，未完成最终几何检查；没有延长超时。after 为 `/tmp/openmind-motion-performance-ldFAhd/followup-report.json`：包含阈值 host 与图标 transition 修正、全部 16 阶段及功能检查通过，早于最后一行短列表原生 Tab 边界补充。之前的 `/tmp/openmind-motion-performance-8WLGWA/followup-report.json` 也完整通过，但设置容器宽度尚未修正，保留其适用边界。

已查看修正后的 Settings、图标选择器、Recent Tasks 末项截图。最终断言覆盖：400 条任务末项键盘打开、滚动时焦点行保留、Tab / Shift+Tab、20 / 400 条阈值双向切换保持同一焦点节点、resize、图标选择器顶层 Escape / 快速重开、Provider 高级字段折叠后保值、MCP 搜索批量即时展开、reduced motion 和退出期间切换偏好。没有用截图代替动态几何与事件验证。

以下是修正宽度后「before → after」的部分采样，单位 ms；全部阶段在上述 JSON / trace 中。before 实际采样窗口为 559.5～24239.1ms，after 为 569.3～2008.6ms，远非稳定空闲环境。运行期间存在本任务的全量测试 / 构建及共享主机其他工作负载；不能把所有卡顿唯一归因于外部负载，也不能据此给出稳定吞吐或提速百分比。

| 操作 | 挂载任务行 | React commits | Layout 总 ms | Paint 总 ms | 帧间隔 p95 | 最大间隔（含尾部） |
| --- | --- | --- | --- | --- | --- | --- |
| recent-40-expand-cpu1 | 40 → 12 | 2 → 2 | 202.78 → 42.47 | 81.75 → 133.68 | 299.90 → 468.66 | 299.90 → 468.66 |
| recent-400-expand-cpu1 | 400 → 12 | 2 → 2 | 157.62 → 72.27 | 65.77 → 46.50 | 517.18 → 257.95 | 517.18 → 257.95 |
| skills-expand-cpu1 | — → — | 1 → 2 | 13.18 → 62.15 | 3.90 → 91.71 | 33.30 → 116.70 | 33.30 → 116.70 |
| drawer-exit-cpu1 | — → — | 6 → 7 | 90.76 → 29.33 | 2.01 → 0.00 | 287.59 → 无 rAF 样本 | 287.59 → 640.00 |
| recent-400-expand-cpu4 | 400 → 12 | 2 → 2 | 4685.93 → 24.93 | 21.46 → 16.40 | 15866.71 → 1026.95 | 15866.71 → 1026.95 |
| mcp-expand-cpu4 | — → — | 1 → 2 | 2.27 → 44.22 | 98.82 → 55.98 | 216.65 → 133.40 | 216.65 → 230.90 |
| icon-exit-cpu4 | — → — | 3 → 4 | 0.68 → 0.39 | 0.20 → 111.89 | 66.60 → 266.60 | 146.20 → 266.60 |

长历史的确定收益是挂载范围由 400 行降到约 12 行，首屏挂载和展开仍是 2 次 React commit，且所有任务保持可达。40 条历史并非每次都更快，虚拟器与局部过渡也有真实成本。新增 CSS 折叠改善了高度连续性，不能称为性能优化。

某次 drawer 采样没有 rAF 回调，p95 不可计算；报告中的空缺不能按 0ms 处理，max 已计入尾部等待。runner 现显式输出 frameCount 和 null p95。Paint 为 0 的受阻采样同样不代表界面零绘制成本。**本批性能仍未全部验收通过，尤其紧凑切换、软件渲染慢帧及实机 GPU 验证。**

### 12.4 最终验证记录

| 检查 | 结果 | 证据与边界 |
| --- | --- | --- |
| `motion:check` | 通过 | 最后短列表键盘边界补充后重跑 `/tmp/openmind-followup-motion-check-final.log`，三类检查均 0 违规；未放宽规则。 |
| `typecheck` | 通过 | 最后短列表键盘边界补充后重跑，最终日志 `/tmp/openmind-followup-typecheck-final3.log`。首次新增测试中的 scrollTo mock 漏了可选参数，按真实 DOM overload 修正后通过。 |
| `lint:reporoot` / `lint:manifests` | 通过 | 470 个文件边界扫描、16 个 manifest；日志 `/tmp/openmind-followup-lint-root.log`、`/tmp/openmind-followup-lint-manifests.log`。 |
| `build:renderer` / `build:electron` | 通过 | `/tmp/openmind-followup-build-renderer-final.log`、`/tmp/openmind-followup-build-electron.log`；CSS 产物核对包含图标的可反向 transition，早于最后单行短列表 Tab 边界补充。保留原 chunk size warning。 |
| 定向单测 | 通过 | 初轮 8 文件 60 项；补齐虚拟列表测试后 SidebarRecent 10 项、AppShell 12 项复跑通过。最终全量运行中，本批 SettingsPage / ProjectAppearance / provider-presence / AppShell / SidebarRecent / settings-disclosure / AnimatedDisclosure 共 60 项再次通过。日志 `/tmp/openmind-followup-tests.log`、`/tmp/openmind-followup-final-nav-tests.log`、`/tmp/openmind-followup-unit.log`。 |
| 最后短列表键盘边界 | 11 / 11 通过 | `/tmp/openmind-followup-short-list-tests.log`，完整 SidebarRecent 文件；同时覆盖短列表不取消原生 Tab / Shift+Tab、400 条末项可达、presence、归档与收藏。未对单行事件边界修改重跑完整性能采样或 Electron E2E。 |
| `test:integration` | 通过 | `/tmp/openmind-followup-integration.log`，独立合成 fixture。 |
| `test:e2e` | 通过 | `/tmp/openmind-followup-e2e.log`，使用包含最终图标 transition 的生产构建，合成文章可读取、搜索。运行早于最后的短列表原生 Tab 边界补充；不作为该键盘边界的证据。 |
| 最终 Electron 局部检查 | 功能通过 | 修正测试画布宽度后 `/tmp/openmind-motion-performance-ldFAhd/followup-report.json`；包括焦点、阈值、快速反向、resize 与动态 reduced motion。不是帧预算通过结论。 |
| 全量 `test:unit -- --maxWorkers=1` | 未全过 | 184 文件：174 通过、10 失败；2047 通过、23 失败、3 跳过，共 2073 项。用时 1975.54s。日志 `/tmp/openmind-followup-unit.log`。晚于此轮添加的短列表键盘用例另行定向验证，不计入上述总数。 |

全量失败分布：InstalledSkillExecutionResolver 2 项（已有独立 Skill 版本 / 执行链失败）；Chat 9、CreativePage 3、App 2、ProjectPanels 2、SkillsPage 1、GlobalSearch 1、project-persistence-integrity 1、skill-package-service 1、safe-http 1。其余 21 项包含超时、异步 UI 等待及 deadline 次数断言；不能仅因文件未改就断言它们全部与本批无关。保留首轮完整失败，随后以原超时 / 原断言单独复跑这 9 个文件；复跑结果另列，不将首轮改写为全绿。

失败文件复跑 `/tmp/openmind-followup-failures-recheck.log`：244 项中 233 通过、11 失败；9 文件中 4 通过、5 失败，用时 394.28s。复跑期间本任务没有并行运行构建或性能采样。CreativePage、GlobalSearch、skill-package-service、safe-http 完整文件通过；仍失败的是 Chat 2、App 1、ProjectPanels 5、SkillsPage 1、project-persistence-integrity 2。部分首次通过用例在复跑时失败，因此不能把两次不同运行中的通过项拼接成全量通过。未修改超时、断言、预算或跳过列表，未将这些失败全部归类为已确认的独立基线问题。

本批没有再次运行完整 `--feedback`、`perf:motion`、`perf:stream` 或发布 `verify`。`--feedback` 的虚拟列表断言修改已通过脚本语法检查，但不冒充该入口运行通过；其目标行为由本批 `--followup` 和 SidebarRecent 定向测试覆盖。前三批 theme / stream 失败继续保留，当前主机未提供稳定负载的复验条件。

采用结论：四项局部改动具备明确的交互或挂载范围收益；紧凑切换保留原实现。**全量单测、性能和真实低性能设备 / GPU 验收仍有未通过或未完成项，不能标记为完整发布验收通过。**

### 12.5 后续失败复核（2026-09-17）

用户告知其他 AI 已处理失败后，本轮重新验证当前工作区，没有修改应用源码、测试、超时或断言。App HEAD 为 `6b86e84`，实际使用的独立 Skill 仓库为 `/home/say/work/github/cctools-skills`，HEAD `4a01f2f`。单测前后比对 584 个应用源码、测试和配置文件，内容与 HEAD 均未变化；独立 Skill 仓库保持干净。复核记录目录：`/tmp/openmind-failure-recheck-teqzushf/`。

| 检查 | 本轮结果 | 证据 |
| --- | --- | --- |
| 之前失败的 10 个完整文件 | 274 通过、3 失败，共 277 项 | `previous-failures.log` / `previous-failures.json`；两项 Skill 失败及一项 Project 已提交重命名恢复测试超时。App、Chat、SkillsPage、ProjectPanels、CreativePage、GlobalSearch、skill-package-service、safe-http 全部通过。 |
| 完整 `test:unit -- --maxWorkers=1` | 182 文件通过、2 文件失败；2069 项通过、3 项失败、3 项跳过，共 2075 项 | `full-unit.log` / `full-unit.json`，447.81s。两项 Skill 失败再次复现；Project 持久化 13 项全部通过，但跨进程 mutation lock 用例超过原 5s 限制。 |
| ProjectPathResolver 完整文件复跑 | 6 / 6 通过 | `lock-recheck.log` / `lock-recheck.json`；原失败用例耗时 1138ms，保留原断言及超时。 |
| `motion:check` / `lint:reporoot` / `lint:manifests` | 全部通过 | `motion-check.log`、`lint-reporoot.log`、`lint-manifests.log`；0 motion 违规、470 文件路径边界通过、16 个 manifest 通过。 |
| `typecheck` / `git diff --check` | 全部通过 | `typecheck.log`；renderer / shared 与 Electron 两个 TypeScript 项目均通过，文档更新后 diff 空白检查通过。 |

仍能连续复现的失败均在 `electron/skills/installed-skill-execution-resolver.test.ts`：

1. **X 抓取版本不匹配**：`executes the real x-following-fetcher package with Skill-data credentials`。测试请求固定为 `version: "1.0.0"`，实际安装的 `x-following-fetcher/cctools.skill.yaml` 为 `1.1.0`，执行被版本校验拒绝。
2. **日报链路未生成预期正文**：`chains reddit-fetcher → daily-article-summarizer → daily-topic-selector under one shared root snapshot`。summarizer 状态为 succeeded，产物却显示「共总结 0 篇文章」，不包含断言所需的「链路测试文章」，测试在进入 topic 阶段前失败。当前证据确认产物断言失败，未将其根因简化为网络或超时。

另有两项只在部分运行出现的 5s 超时：Project 已提交重命名恢复在后续全量中通过；跨进程 mutation lock 在上述定向复跑中通过。复跑结果用于区分持续失败与时序不稳定，不能合并成一次完整通过报告。本轮未重跑构建、Electron E2E、性能基准或发布 `verify`，第 12.3 / 12.4 节相关验收边界继续保留。
