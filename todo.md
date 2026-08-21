# OpenMind Desktop UI/UX 实施清单

> 历史实施记录：下文提到的 `uiuxopt/` 原始参考图不属于 App 源码仓；可执行的
> 当前证据保存在 `design-qa/`，发布门禁以仓库内脚本与 `docs/` 为准。
>
> 依据：`uiuxopt/1.png` 至 `uiuxopt/40.png`
>
> 本文档从零重写，用于直接指导开发、测试与发布。它不继承旧 `todo.md` 的完成状态。
>
> 核心原则：先完成真实的本地内容工作流和 AI 工作台，再处理设置中心。设置中心为最低优先级，不阻塞第一版 UI/UX 重构发布。

## 0. 使用规则

### 0.1 状态

- `[ ]` 未开始
- `[-]` 正在实施
- `[x]` 已实现、已测试、已验收
- `[!]` 阻塞，必须在同一行写明阻塞原因

### 0.2 优先级

- `P0`：工程底座、真实数据、阻断性缺陷
- `P1`：主工作流，正式桌面版必须完成
- `P2`：跨模块联动、自动化、性能和体验增强
- `P3`：发布、打包和平台验收
- `P4`：设置中心，最低优先级

### 0.3 完成定义

任务只有同时满足以下条件才能标记 `[x]`：

- 使用真实本地文件、Skill、Provider 或运行记录，不使用演示数据补位。
- 加载、空数据、失败、取消、无权限和恢复状态均有明确 UI。
- 新增 IPC 在 `shared/contracts.ts` 中有类型和 Zod Schema。
- Windows 路径、WSL UNC 路径和 Linux 路径至少覆盖相关单元测试。
- 交互可使用鼠标和键盘完成，焦点状态可见。
- 相关测试通过，且没有破坏用户现有 `openmind` 内容。
- `npm run typecheck`、相关 Vitest 测试和构建通过。

### 0.4 禁止事项

- [x] 不伪造套餐、云存储、团队成员、在线状态、阅读量、点赞量和成功率。（`npm run audit:evidence`、`npm run package:safety` 已纳入门禁。）
- [x] 不实现只有外壳的团队、RBAC、2FA、账单或 SaaS 集成页面。（设置中心 P4/暂缓项仍保持未实现或明确标记，不显示假连接。）
- [x] 不重新引入 AI 隔离工作区；AI 直接在用户选择的当前目录工作。（`audit:evidence` 检查无新增 `git worktree add` / 新运行隔离工作区。）
- [x] 不将 Provider 原始内部事件直接倾倒到聊天正文。（AI 工作台使用统一 semantic event、Tool/Approval/Diff 分组组件。）
- [x] 不在渲染进程同步扫描大目录或运行长任务。（内容索引、来源运行、AI 运行均走主进程/事件流；规模检查已覆盖 1000 sessions/10000 events。）
- [x] 不覆盖、移动或格式化用户已有的 `openmind` 内容。（本轮不对 `openmind` 做迁移/格式化；包安全扫描确认产物不包含用户内容。）

## 1. 目标产品结构

参考：`uiuxopt/1.png` 至 `uiuxopt/12.png`、`uiuxopt/25.png` 至 `uiuxopt/40.png`

- [x] 一级导航固定为：今日工作台、资料收集箱、数据源、每日简报、创作中心、项目、自动化、AI 工作台、设置。
- [x] “资料库”统一改名为“资料收集箱”。
- [x] “技能中心”统一改名为“自动化”。
- [x] 创作中心负责单个内容从选题到发布的阶段流转。
- [x] 项目中心负责跨日期、跨阶段的项目检索和管理。
- [x] AI 侧栏负责当前页面的轻量对话；AI 工作台负责完整会话、工具、审批、运行记录和文件变化。
- [x] 设置中心保持可进入，但 P4 开始前只保留当前已有且真实可用的项目目录设置。

## 2. 里程碑与依赖

### M0：工程基线

依赖：无。

- [x] 完成第 3、4 节。
- [x] 页面壳层、设计 Token、公共反馈和 IPC 错误模型可复用。
- [x] 不改变现有 Provider 和 Skill 的运行语义。

### M1：资料闭环

依赖：M0。

- [x] 完成第 5、6、7、8 节。
- [x] 数据源运行后，资料索引、每日简报和今日工作台同步更新。

### M2：创作闭环

依赖：M1。

- [x] 完成第 9、10 节。
- [x] 一个真实项目可从推荐选题走到导出或发布记录。

### M3：AI 工程工作台

依赖：M0；上下文联动依赖 M1、M2。

- [x] 完成第 11 节。
- [x] Claude Code 与 Codex CLI 使用统一事件模型和统一 UI。

### M4：自动化与跨模块

依赖：M1、M2、M3。

- [x] 完成第 12、13 节。

### M5：质量与发布

依赖：M1 至 M4。

- [!] 完成第 14、15、16 节。（第 14、15 与自动化构建、测试、verify、Electron/Xvfb 视觉截图矩阵已完成；第 16.2 已生成 Windows 包，但 portable 启动、NSIS 安装卸载、真实 Provider E2E 和 Windows 原生 DPI/GUI 仍需人工验收。）
- [x] 生成 Windows portable、NSIS 和 ZIP 包。（`dist/` 已生成 `1.0.17` portable、NSIS 和 ZIP；portable 已复制到 Windows 桌面。）

### M6：设置中心

依赖：M5。

- [!] 第 17.1、17.2、17.4 已实施；17.3 无真实服务端能力的项目按约束继续暂缓。M5 的 Windows/Provider 人工验收仍是 M6 最终关闭条件。
- [x] 本里程碑不阻塞 M5 的核心桌面版发布。

## 3. P0 工程底座

### 3.1 目录和组件边界

主要文件：

- `renderer/src/App.tsx`
- `renderer/src/app/AppShell.tsx`
- `renderer/src/app/routes.ts`
- `renderer/src/design-system/`
- `renderer/src/features/`

任务：

- [x] `FND-001` 检查所有一级页面只通过 `AppRoute` 和结构化 route state 导航。
- [x] `FND-002` 移除页面间依赖临时全局变量或 DOM 事件传参的代码。
- [x] `FND-003` 为每个一级页面定义稳定 route key、标题、图标和快捷操作。
- [x] `FND-004` 将全局目录、Provider 状态、运行状态放入统一 app state。
- [x] `FND-005` 将页面专属数据留在 feature 内，禁止继续膨胀 `App.tsx`。
- [x] `FND-006` 将 `Chat.tsx` 拆分为 timeline、message、thought、plan、tool、approval、diff、composer 子模块。
- [x] `FND-007` 将 AI 工作台移动或重导出到 `features/ai-console/`，保留兼容入口直至迁移完成。
- [x] `FND-008` 为 feature 建立统一导出文件，减少跨目录深层 import。

验收：

- [x] `App.tsx` 只负责应用状态、路由和全局浮层。
- [x] 单个复杂组件超过约 500 行时已有明确子组件边界。
- [x] 页面切换不重新创建全局 Provider 订阅。

### 3.2 样式系统

目标目录：

```text
renderer/src/styles/
├── tokens.css
├── reset.css
├── base.css
├── shell.css
├── components.css
└── features/
```

任务：

- [x] `FND-020` 从 `styles.css` 和 `styles/product.css` 提取颜色 Token。
- [x] `FND-021` 定义画布、侧栏、面板、浮层、输入框、边框、悬浮和选中背景。
- [x] `FND-022` 定义主文字、次文字、弱文字、链接、成功、警告、错误和信息色。
- [x] `FND-023` 定义 4/8/12/16/20/24/32 间距刻度。
- [x] `FND-024` 定义控件、卡片、主容器三档圆角。
- [x] `FND-025` 定义页面标题、区块标题、正文、辅助文字、代码和数字指标排版。
- [x] `FND-026` 将紫色限制为选中、主操作和关键进度，禁止大面积高饱和底色。
- [x] `FND-027` 将页面级样式迁入对应 feature CSS。
- [x] `FND-028` 删除迁移完成后的重复选择器和失效规则。
- [x] `FND-029` 补充 `:focus-visible`、disabled、hover、active、loading 状态。
- [x] `FND-030` 支持 `prefers-reduced-motion`。

验收：

- [x] 新增组件不直接硬编码主题色。
- [x] 正文、次文字、Diff 行号达到可读对比度。
- [x] 1280×720 下无全局横向滚动条。

### 3.3 应用壳层

参考：全部设计稿左侧导航和顶部操作区。

- [x] `SHELL-001` 左导航支持展开、图标折叠和状态持久化。
- [x] `SHELL-002` 宽度小于 1240px 时自动折叠导航。
- [x] `SHELL-003` 顶部展示当前项目目录、同步/索引状态和全局搜索入口。
- [x] `SHELL-004` Provider 不可用、项目目录丢失或索引损坏时显示全局可恢复提示。
- [x] `SHELL-005` `Ctrl+K` 打开全局搜索，`Esc` 关闭并恢复焦点。
- [x] `SHELL-006` 全局搜索结果按资料、项目、AI 会话、Skill 分组。
- [x] `SHELL-007` 搜索结果支持方向键、Enter 和空结果状态。
- [x] `SHELL-008` 页面返回后恢复该页筛选、滚动和选中项。
- [x] `SHELL-009` 移除设计稿中的 Pro、头像、云同步等无真实数据元素。

### 3.4 公共组件

主要目录：`renderer/src/design-system/`

- [x] `DS-001` `PageHeader` 支持标题、副标题、面包屑和操作区。
- [x] `DS-002` `Toolbar` 和 `FilterBar` 支持窄屏折叠。
- [x] `DS-003` `SearchField` 支持清空、快捷键提示和 loading。
- [x] `DS-004` `SegmentedControl`、`Tabs` 具备键盘和 ARIA 语义。
- [x] `DS-005` `DataTable` 支持排序、空状态、loading 和分页。
- [x] `DS-006` `VirtualList` 支持选中项滚入视口和动态容器高度。
- [x] `DS-007` `ResizablePane` 支持鼠标拖动、键盘调整和双击复位。
- [x] `DS-008` `CollapsiblePane` 折叠后显示单条经典 rail 和恢复按钮。
- [x] `DS-009` `DropdownMenu`、`ContextMenu` 支持关闭后焦点还原。
- [x] `DS-010` `ConfirmDialog` 默认聚焦取消，危险操作不能由全局 Enter 直接确认。
- [x] `DS-011` `Toast` 支持成功、错误、警告和持久错误。
- [x] `DS-012` `Skeleton`、`EmptyState`、`ErrorState` 使用统一尺寸和文案。
- [x] `DS-013` 图标按钮统一 tooltip、`aria-label` 和最小点击区域。

测试：

- [x] `DS-T01` 三栏拖动、折叠、复位、持久化组件测试。
- [x] `DS-T02` Tabs、菜单和对话框键盘测试。
- [x] `DS-T03` 危险确认焦点和 Esc 行为测试。

## 4. P0 数据、IPC 与运行基础

### 4.1 内容索引

主要文件：

- `electron/product/product-service.ts`
- `shared/contracts.ts`
- `electron/product/product-service.test.ts`

- [x] `DATA-001` 固化 `ContentItem`、`ContentQuery`、`ContentPage` Schema。
- [x] `DATA-002` 索引 article、post/X、reddit、summary、topic 和手动导入目录。
- [x] `DATA-003` 使用稳定内容 ID，避免文件排序变化导致收藏和已读状态丢失。
- [x] `DATA-004` 增量检测新增、修改、移动和删除。
- [x] `DATA-005` 索引损坏时隔离坏文件并自动重建。
- [x] `DATA-006` 正文仅按需读取，列表 IPC 不返回完整正文。
- [x] `DATA-007` 支持标题、摘要、正文、来源和标签搜索。
- [x] `DATA-008` 支持游标或页码分页，不以 500 条硬上限代替分页。
- [x] `DATA-009` 持久化已读、收藏、评分、标签和最后查看时间。
- [x] `DATA-010` 所有写入支持 WSL UNC 下的 rename 失败回退。

### 4.2 数据源和运行记录

- [x] `DATA-020` 固化 `SourceDefinition`、`SourceRun`、`SourcePatch` Schema。
- [x] `DATA-021` 从 OPML、Skill 配置和现有来源目录生成统一来源实体。
- [x] `DATA-022` 来源运行返回结构化阶段、计数、错误和产物。
- [x] `DATA-023` 来源成功率由真实运行记录计算。
- [x] `DATA-024` 禁用来源后，每日流水线和单次运行都不调用该来源。
- [x] `DATA-025` 运行记录限制日志大小并保留完整日志文件入口。

### 4.3 创作模型

主要文件：

- `electron/lib/creative.js`
- `shared/contracts.ts`

- [x] `DATA-030` 固化 `CreativeProjectManifest` 和版本号。
- [x] `DATA-031` 固化阶段：drafting、review、ready、published、archived。
- [x] `DATA-032` 固化合法阶段转换表和进入条件。
- [x] `DATA-033` 同一推荐 topic 不允许重复创建项目。
- [x] `DATA-034` 旧创作目录缺少 manifest 时可渐进补全，不重写正文。
- [x] `DATA-035` 审核报告、版本和发布记录使用独立文件。
- [x] `DATA-036` 重要保存、审核和阶段切换生成可追踪版本。
- [x] `DATA-037` 删除、归档和复制项目均有稳定结果对象和错误码。

### 4.4 IPC

主要文件：

- `electron/main.ts`
- `electron/preload.ts`
- `renderer/src/browser-api.ts`
- `shared/contracts.ts`

- [x] `IPC-001` 每个 IPC 输入使用 Zod 校验。
- [x] `IPC-002` 每个 IPC 输出在主进程边界校验或规范化。
- [x] `IPC-003` 错误统一返回 code、message、detail、recoverable。
- [x] `IPC-004` Browser preview mock 与 DesktopApi 保持类型一致。
- [x] `IPC-005` 文件打开、目录定位、外链打开和导出分别使用明确 API。
- [x] `IPC-006` 长任务通过事件或 Utility Process 返回，不使用 `exec` 大缓冲区。

测试：

- [x] `IPC-T01` Windows、UNC、WSL Linux 路径互转。
- [x] `IPC-T02` 无效参数被拒绝且 UI 获得可读错误。
- [x] `IPC-T03` JSON 尾部损坏和原子写回恢复。

## 5. P1 今日工作台

参考：`uiuxopt/1.png`

主要文件：`renderer/src/features/dashboard/DashboardPage.tsx`

- [x] `DASH-001` 顶部问候改为本地日期和真实统计摘要。
- [x] `DASH-002` 快捷操作只保留当前可执行项：运行采集、生成简报、新建项目、打开 AI。
- [x] `DASH-003` 指标卡展示新增资料、高价值资料、聚类主题、关注项和异常信号。
- [x] `DASH-004` 指标卡点击后带结构化筛选跳转。
- [x] `DASH-005` 推荐选题展示真实 topic、资料数量、推荐理由和创建入口。
- [x] `DASH-006` 创建项目成功后直接进入对应创作项目。
- [x] `DASH-007` 创作状态使用真实阶段数量，不显示虚构 donut 数据。
- [x] `DASH-008` 7 日趋势使用真实每日聚合。
- [x] `DASH-009` 关键资料可打开对应 Inbox 条目。
- [x] `DASH-010` 关键事项展示失败来源、待审核项目、计划发布和待审批 AI。
- [x] `DASH-011` 数据全空时展示首次使用引导，不堆叠零值卡片。
- [x] `DASH-012` 展示最后刷新时间和刷新失败状态。

验收：

- [x] Dashboard 数量与 Inbox、Sources、Creative 同源。
- [x] 任一可点击指标都进入正确页面和筛选条件。

## 6. P1 资料收集箱

参考：`uiuxopt/2.png`

主要文件：`renderer/src/features/inbox/InboxPage.tsx`

### 6.1 顶部与筛选

- [x] `INBOX-001` 提供添加 URL、添加 RSS、导入、运行采集和刷新。
- [x] `INBOX-002` 类型筛选覆盖全部、文章、摘要、选题、动态、Reddit。
- [x] `INBOX-003` 增加来源、日期、已读、收藏、评分、标签筛选。
- [x] `INBOX-004` 支持最新、最早、评分和来源排序。
- [x] `INBOX-005` 搜索覆盖标题、摘要和正文索引。
- [x] `INBOX-006` 批量标记已读、收藏、加标签和删除状态数据。

### 6.2 列表

- [x] `INBOX-020` 列表项展示类型图标、标题、来源、时间、评分和已读点。
- [x] `INBOX-021` 使用分页加载和虚拟列表。
- [x] `INBOX-022` 支持 ArrowUp、ArrowDown、Home、End、Enter、Space。
- [x] `INBOX-023` 使用 listbox/option 语义和 roving tabindex。
- [x] `INBOX-024` 右键菜单支持打开、加入 AI、复制路径、目录中显示。
- [x] `INBOX-025` 日期或筛选变化后清理失效选中项并选择首项。
- [x] `INBOX-026` 切换条目时立即清空旧详情并显示 skeleton。

### 6.3 详情与预览

- [x] `INBOX-040` Markdown 使用独立阅读排版。
- [x] `INBOX-041` HTML 使用 sandbox iframe，禁止脚本和外部权限。
- [x] `INBOX-042` 解析失败时降级纯文本。
- [x] `INBOX-043` 生成 TOC，点击定位标题。
- [x] `INBOX-044` 使用 IntersectionObserver 高亮当前 TOC 节点。
- [x] `INBOX-045` 展示作者、来源、发布时间、原文、本地路径。
- [x] `INBOX-046` 原文链接调用系统浏览器。
- [x] `INBOX-047` 支持已读、收藏、1-5 评分和标签编辑。
- [x] `INBOX-048` 展示摘要、重点和关联资料；缺失时明确说明。
- [x] `INBOX-049` 支持加入选题、创建草稿和加入 AI 上下文。

### 6.4 三栏

- [x] `INBOX-060` 筛选、列表、详情三栏可拖动。
- [x] `INBOX-061` 左两栏可折叠为经典 rail。
- [x] `INBOX-062` 双击分隔条恢复默认宽度。
- [x] `INBOX-063` 持久化宽度和折叠状态。
- [x] `INBOX-064` 窄窗口进入列表/详情钻取模式。
- [x] `INBOX-065` 三栏各自滚动，不拦截滚轮和触控板。

验收：

- [x] 10,000 条资料列表可搜索和连续滚动。
- [x] 日期切换后列表、详情和统计同时变化。
- [x] Markdown、HTML、纯文本和 TOC 均有真实样本验收。

## 7. P1 数据源

参考：`uiuxopt/3.png`

主要文件：`renderer/src/features/sources/SourcesPage.tsx`

- [x] `SRC-001` 分类 Tab 使用真实存在的 RSS、URL、X、手动导入和 API/Webhook 能力。
- [x] `SRC-002` 不支持的类型隐藏，不显示空壳分类。
- [x] `SRC-003` 概览展示来源数、启用数、今日新增、7 日成功率和最后同步。
- [x] `SRC-004` 表格展示名称、类型、频率、最后同步、成功率、状态、启用和操作。
- [x] `SRC-005` 支持添加 RSS 和导入 OPML。
- [x] `SRC-006` 支持编辑名称、URL 和频率。
- [x] `SRC-007` 支持启用和暂停，状态立即持久化。
- [x] `SRC-008` 支持单来源运行与停止。
- [x] `SRC-009` 运行时显示阶段、耗时、计数和实时日志。
- [x] `SRC-010` 失败显示错误摘要、详细日志和重试。
- [x] `SRC-011` 不可执行、缺少环境变量和认证失败分别提示。
- [x] `SRC-012` 来源运行完成后增量刷新内容索引。
- [x] `SRC-013` 来源运行复用自动化运行引擎，不维护第二套进程状态。
- [x] `SRC-014` 分页、筛选和搜索在 1000 个来源下可用。

测试：

- [x] `SRC-T01` 添加、编辑、禁用和导入 OPML。
- [x] `SRC-T02` 单来源运行、停止、失败和重试。
- [x] `SRC-T03` 禁用来源不会进入日常流水线。

## 8. P1 每日简报

参考：`uiuxopt/4.png`

主要文件：`renderer/src/features/daily-brief/DailyBriefPage.tsx`

- [x] `BRIEF-001` 日期选择驱动全部简报数据。
- [x] `BRIEF-002` 顶部指标来自该日期真实内容。
- [x] `BRIEF-003` 主题聚类展示标题、摘要、资料数、热度口径。
- [x] `BRIEF-004` 主题卡可进入对应 Inbox 过滤结果。
- [x] `BRIEF-005` 主题可创建创作项目或加入 AI 上下文。
- [x] `BRIEF-006` 关键信号必须指向具体资料。
- [x] `BRIEF-007` 关注列表可增删并持久化。
- [x] `BRIEF-008` 来源贡献显示真实条数，不伪造百分比。
- [x] `BRIEF-009` 行动建议区标注“本地规则”或“AI 生成”。
- [x] `BRIEF-010` 重新生成显示流水线阶段和当前 Skill。
- [x] `BRIEF-011` 生成失败保留上一版并显示错误。
- [x] `BRIEF-012` 导出 Markdown 使用系统保存对话框。
- [x] `BRIEF-013` 提供打开原始文件和目录。
- [x] `BRIEF-014` 生成期间允许浏览旧简报，不用全屏遮罩冻结界面。

## 9. P1 创作中心

参考：`uiuxopt/5.png` 至 `uiuxopt/12.png`

主要文件：

- `renderer/src/features/creative/CreativePage.tsx`
- `electron/lib/creative.js`
- `shared/contracts.ts`

### 9.1 框架与状态机

- [x] `CRE-001` 顶部阶段为 Today、Drafting、Review、Ready、Published。
- [x] `CRE-002` History、Release Log、Analytics 作为二级视图，不混入阶段状态机。
- [x] `CRE-003` 阶段数量实时来自 manifest。
- [x] `CRE-004` 日期、平台、标签和状态筛选真正控制列表。
- [x] `CRE-005` 项目切换时中栏、右栏和工具栏一起更新。
- [x] `CRE-006` 三栏支持拖动、折叠、复位和持久化。
- [x] `CRE-007` 非法阶段转换由后端拒绝并显示原因。
- [x] `CRE-008` 所有阶段操作写入项目事件或 release log。

### 9.2 Today 推荐

- [x] `CRE-TODAY-001` 从 Daily Brief/topic 文件读取候选选题。
- [x] `CRE-TODAY-002` 按主题/标签、推荐度、新鲜度和资料量筛选排序。
- [x] `CRE-TODAY-003` 详情展示选题理由、关联资料、推荐角度和预计大纲。
- [x] `CRE-TODAY-004` 收藏和忽略状态持久化。
- [x] `CRE-TODAY-005` “开始创作”创建唯一项目并进入 Drafting。
- [x] `CRE-TODAY-006` “创建草稿”可选择平台和模板。
- [x] `CRE-TODAY-007` “询问 AI”携带 topic 和关联资料。
- [x] `CRE-TODAY-008` 重复 topic 返回已存在项目入口。

### 9.3 Drafting 编辑

- [x] `CRE-DRAFT-001` 左栏显示草稿标题、进度和最后保存时间。
- [x] `CRE-DRAFT-002` 中栏提供 Markdown 编辑和预览切换。
- [x] `CRE-DRAFT-003` 编辑器支持标题、列表、链接、图片、代码和引用。
- [x] `CRE-DRAFT-004` 自动保存使用 debounce，显示保存中、已保存、失败。
- [x] `CRE-DRAFT-005` 保存失败保留未保存文本并支持重试。
- [x] `CRE-DRAFT-006` 右栏分为关联资料、AI 对话和笔记。
- [x] `CRE-DRAFT-007` 可从关联资料插入引用或本地文件链接。
- [x] `CRE-DRAFT-008` 实时检查字数、标题、段落、图片、链接和可读性。
- [x] `CRE-DRAFT-009` 进入 Review 前创建版本。
- [x] `CRE-DRAFT-010` AI 修改必须展示 Diff 并由用户确认。

### 9.4 Review 审核

- [x] `CRE-REV-001` 审核报告持久化到 `reviews/`。
- [x] `CRE-REV-002` 展示内容质量、结构逻辑、准确性、可读性和平台适配。
- [x] `CRE-REV-003` 不具备真实 SEO 数据时不展示虚构 SEO 分数。
- [x] `CRE-REV-004` 问题分严重、警告、建议和通过。
- [x] `CRE-REV-005` 每个问题包含段落、行号或锚点。
- [x] `CRE-REV-006` 点击问题定位正文。
- [x] `CRE-REV-007` 支持重新审核、返回修改和批准。
- [x] `CRE-REV-008` 未批准不能进入 Ready。
- [x] `CRE-REV-009` 审核失败保留上一份报告。

### 9.5 Ready 待发布

- [x] `CRE-READY-001` 配置目标平台、时间、标题、摘要、标签和封面路径。
- [x] `CRE-READY-002` 平台选项只显示当前已实现的导出器。
- [x] `CRE-READY-003` 展示必填检查清单。
- [x] `CRE-READY-004` 缺少必填项时阻止确认。
- [x] `CRE-READY-005` “立即发布”在无平台 API 时改为“立即导出”。
- [x] `CRE-READY-006` “计划发布”只在真实调度器可用时显示。
- [x] `CRE-READY-007` 导出成功后记录目标文件、时间和校验结果。
- [x] `CRE-READY-008` 只有真实发布或明确的导出完成状态才能进入 Published。

### 9.6 Published 已发布

- [x] `CRE-PUB-001` 表格展示标题、平台、发布时间、状态和操作。
- [x] `CRE-PUB-002` 详情展示发布链接或导出文件。
- [x] `CRE-PUB-003` 阅读、点赞、互动仅在真实接入后展示。
- [x] `CRE-PUB-004` 未接入分析时显示“平台数据未接入”。
- [x] `CRE-PUB-005` 支持打开链接、打开文件、重新导出和复制项目。
- [x] `CRE-PUB-006` 支持归档，不直接删除历史。

### 9.7 History 版本

- [x] `CRE-HIS-001` 版本列表展示版本号、时间、来源、阶段和说明。
- [x] `CRE-HIS-002` 支持选择两个版本比较。
- [x] `CRE-HIS-003` 支持并排阅读和统一 Diff。
- [x] `CRE-HIS-004` 恢复历史版本时创建新版本，不覆盖旧版本。
- [x] `CRE-HIS-005` 大文件 Diff 分块渲染。

### 9.8 Release Log 发布记录

- [x] `CRE-LOG-001` 记录导出、计划、发布、失败、取消和重新发布。
- [x] `CRE-LOG-002` 记录平台、目标、时间、结果、错误和版本。
- [x] `CRE-LOG-003` 支持日期、平台、状态和标题搜索。
- [x] `CRE-LOG-004` 详情展示完整时间线。
- [x] `CRE-LOG-005` 删除记录使用危险确认，但不删除正文。

### 9.9 Analytics 分析

- [x] `CRE-ANA-001` 第一版仅展示本地可计算指标。
- [x] `CRE-ANA-002` 展示项目数量、完成数量、平均完成周期和阶段停留时间。
- [x] `CRE-ANA-003` 展示来源贡献和内容类型分布。
- [x] `CRE-ANA-004` 外部阅读和互动图表在无真实数据时隐藏。
- [x] `CRE-ANA-005` 每个统计提供口径说明。

测试：

- [x] `CRE-T01` 创建、重复 topic、防重复。
- [x] `CRE-T02` 合法和非法阶段转换。
- [x] `CRE-T03` 自动保存失败和恢复。
- [x] `CRE-T04` 审核通过条件。
- [x] `CRE-T05` 版本创建、比较和恢复。
- [x] `CRE-T06` 导出与发布记录。
- [x] `CRE-T07` 复制、归档和删除。

## 10. P2 项目中心

主要文件：`renderer/src/features/projects/ProjectsPage.tsx`

- [x] `PROJ-001` 使用与 Creative 相同的 manifest 数据源。
- [x] `PROJ-002` 支持全部项目、活跃、归档筛选。
- [x] `PROJ-003` 支持阶段、平台、标签、日期和更新时间筛选。
- [x] `PROJ-004` 支持卡片和表格视图。
- [x] `PROJ-005` 项目详情展示基本信息、资料、草稿、审核、发布和 AI 会话。
- [x] `PROJ-006` 支持创建空项目和从模板创建。
- [x] `PROJ-007` 支持复制、归档、恢复和打开目录。
- [x] `PROJ-008` 删除前明确列出将删除的本地文件。
- [x] `PROJ-009` 删除默认聚焦取消按钮。
- [x] `PROJ-010` 返回 Creative 时定位原阶段和项目。

## 11. P1 AI 工作台

参考：`uiuxopt/25.png` 至 `uiuxopt/40.png`

主要文件：

- `renderer/src/components/AiWorkbench.tsx`
- `renderer/src/components/Chat.tsx`
- `renderer/src/components/AiSidebar.tsx`
- `electron/ai/`

### 11.1 工作台布局

- [x] `AI-001` 左栏只展示会话列表和搜索。
- [x] `AI-002` 中栏展示当前会话的真实事件时间线。
- [x] `AI-003` 右栏分为上下文、会话信息、工具、权限、风险和变更。
- [x] `AI-004` 三栏支持拖动、折叠、复位和持久化。
- [x] `AI-005` 小于 1380px 自动隐藏右检查器。
- [x] `AI-006` 轻量侧栏可携带当前会话打开完整工作台。

### 11.2 会话列表

- [x] `AI-020` 第一条消息发送后才持久化新会话。
- [x] `AI-021` 标题由首条有效消息生成并可重命名。
- [x] `AI-022` 列表项展示标题、Provider、更新时间和运行状态。
- [x] `AI-023` 待审批、失败和运行中有非颜色状态标识。
- [x] `AI-024` 支持搜索、置顶、归档、恢复和删除。
- [x] `AI-025` 点击列表项只切换会话，不展开操作详情。
- [x] `AI-026` 会话详情通过 inspector 或显式菜单打开。
- [x] `AI-027` 1000 个会话使用虚拟列表。
- [x] `AI-028` 支持方向键、Home、End、Enter 和 Space。

### 11.3 事件顺序与运行状态

- [x] `AI-040` 所有展示严格按 `sequence` 排序。
- [x] `AI-041` 不按 Thought、Tool、Message 类型二次分组排序。
- [x] `AI-042` 一轮运行有 queued、initializing、thinking、tool、finalizing、completed、failed、cancelled 状态。
- [x] `AI-043` 发送后 100ms 内显示本地运行占位。
- [x] `AI-044` Provider 初始化期间显示可理解阶段和持续时间。
- [x] `AI-045` 10 秒无事件时显示“仍在等待”及诊断入口。
- [x] `AI-046` 收到完成事件后立即停止 spinner。
- [x] `AI-047` Provider 异常退出时运行立即失败，不无限 running。
- [x] `AI-048` 当前运行中发送的新消息进入明确队列。
- [x] `AI-049` 停止按钮终止完整进程树。

### 11.4 Thought 与 Plan

- [x] `AI-THOUGHT-001` Thought 使用独立可折叠卡片。
- [x] `AI-THOUGHT-002` 默认展示摘要、状态、字符数或阶段数。
- [x] `AI-THOUGHT-003` 流式期间显示活动状态，结束后静止。
- [x] `AI-THOUGHT-004` 不展示逐条 `thinking_tokens`。
- [x] `AI-PLAN-001` Plan 展示步骤、当前步骤和完成状态。
- [x] `AI-PLAN-002` Provider 无计划事件时不伪造计划。

### 11.5 Tool 卡片

- [x] `AI-TOOL-001` 统一 ToolCall 和 ToolResult 配对规则。
- [x] `AI-TOOL-002` 紧凑态展示图标、名称、摘要、状态和耗时。
- [x] `AI-TOOL-003` 展开态展示输入、输出、错误和上下文。
- [x] `AI-TOOL-004` Search/Glob 展示查询、匹配数和结果。
- [x] `AI-TOOL-005` Read 展示路径、范围、编码和预览。
- [x] `AI-TOOL-006` Write/Edit 展示文件和 Diff。
- [x] `AI-TOOL-007` Bash/Command 展示命令、目录、退出码、stdout、stderr。
- [x] `AI-TOOL-008` 运行中、成功、失败、取消、待审批不仅依赖颜色。
- [x] `AI-TOOL-009` 支持复制输出、打开文件、打开目录和下载日志。
- [x] `AI-TOOL-010` 大输出按块读取或虚拟渲染。
- [x] `AI-TOOL-011` stdout/stderr 默认折叠，错误时自动展开错误摘要。

### 11.6 审批、风险和文件变更

- [x] `AI-APP-001` 审批卡展示动作、原因、路径、命令和风险。
- [x] `AI-APP-002` 支持本次允许、本会话允许和拒绝。
- [x] `AI-APP-003` 危险动作未批准前不得执行。
- [x] `AI-APP-004` 审批决定写入事件日志。
- [x] `AI-RISK-001` 风险发现集中展示，不重复刷屏。
- [x] `AI-DIFF-001` 文件变化按文件分组。
- [x] `AI-DIFF-002` Diff 支持打开文件和复制补丁。
- [x] `AI-DIFF-003` 当前产品直接修改工作目录，不展示虚假的“应用隔离变更”按钮。

### 11.7 最终回答和输入区

- [x] `AI-MSG-001` 用户消息紧凑右对齐。
- [x] `AI-MSG-002` AI 正文使用聊天 Markdown，不复用文章预览 CSS。
- [x] `AI-MSG-003` 代码块、表格、链接、引用和列表完整可读。
- [x] `AI-MSG-004` 最终回答支持复制、引用、重试和分支会话。
- [x] `AI-MSG-005` 隐藏原始 usage JSON；仅在诊断区显示必要统计。
- [x] `AI-COMP-001` 输入区固定在当前会话底部。
- [x] `AI-COMP-002` 支持附件、上下文引用和工具入口。
- [x] `AI-COMP-003` Provider 和权限在会话创建后锁定并显示。
- [x] `AI-COMP-004` 输入中 Enter 发送、Shift+Enter 换行。
- [x] `AI-COMP-005` 运行中输入明确显示“加入队列”。

### 11.8 滚动和流式

- [x] `AI-STREAM-001` 稳定块节流更新，避免逐 token 重渲染全列表。
- [x] `AI-STREAM-002` 用户在底部时自动跟随。
- [x] `AI-STREAM-003` 用户向上阅读时停止强制滚动。
- [x] `AI-STREAM-004` 显示回到底部按钮和未读事件数。
- [x] `AI-STREAM-005` 切换会话后恢复各自滚动位置。
- [x] `AI-STREAM-006` 长会话按窗口渲染事件。

测试：

- [x] `AI-T01` 事件序列严格保持。
- [x] `AI-T02` Thought 在 Tool 前时 UI 顺序一致。
- [x] `AI-T03` Tool 配对、成功、失败、取消。
- [x] `AI-T04` 完成后 spinner 消失。
- [x] `AI-T05` 无事件等待和 Provider 崩溃。
- [x] `AI-T06` 滚动跟随和阅读保护。
- [x] `AI-T07` 排队消息和停止运行。
- [x] `AI-T08` Claude Code 与 Codex 适配契约。

## 12. P2 自动化

主要文件：`renderer/src/features/automation/AutomationPage.tsx`

- [x] `AUTO-001` 从 Skill manifest 读取名称、说明、参数、权限、目录、超时和产物。
- [x] `AUTO-002` 展示可用、配置缺失、禁用、运行中和失败状态。
- [x] `AUTO-003` 按分类和关键字搜索 Skill。
- [x] `AUTO-004` 根据参数 Schema 生成表单。
- [x] `AUTO-005` 运行前展示工作目录和环境配置状态。
- [x] `AUTO-006` 支持运行、停止和使用同参数重跑。
- [x] `AUTO-007` 实时日志区有空状态、自动滚动和复制。
- [x] `AUTO-008` 产物支持打开、目录中显示和加入资料索引。
- [x] `AUTO-009` 运行历史持久化并可按状态筛选。
- [x] `AUTO-010` 数据源任务和 AI Skill 调用复用同一运行事件组件。

## 13. P2 跨模块联动

- [x] `LINK-001` Inbox 条目可创建 topic、project 和 AI context。
- [x] `LINK-002` Daily Brief topic 可创建唯一 Creative 项目。
- [x] `LINK-003` Creative 项目可绑定多个 AI 会话 ID。
- [x] `LINK-004` AI 生成或修改文件可定位回 Creative 项目。
- [x] `LINK-005` Skill 产物可加入 Inbox 索引。
- [x] `LINK-006` Source 运行完成刷新 Dashboard、Inbox、Brief。
- [x] `LINK-007` 全局搜索跳转后定位具体实体，而非只打开页面。
- [x] `LINK-008` 跨页面返回恢复筛选、选中和滚动。
- [x] `LINK-009` 所有联动使用稳定实体 ID 和 route state。

## 14. P2 性能、可靠性与无障碍

### 14.1 性能

- [x] `PERF-001` Inbox、会话、Tool 大输出和项目列表虚拟化。
- [x] `PERF-002` Markdown 渲染按内容 hash 缓存。
- [x] `PERF-003` 流式事件只更新当前运行。
- [x] `PERF-004` 大文件使用范围读取。
- [x] `PERF-005` 大目录索引和聚合不运行在渲染线程。
- [x] `PERF-006` 添加首屏、页面打开、搜索、长会话打开测量。
- [x] `PERF-007` 5 MB 输出不触发 maxBuffer 或页面冻结。

### 14.2 可靠性

- [x] `REL-001` JSON 使用临时文件、原子替换或 UNC 安全回退。
- [x] `REL-002` JSONL 尾部损坏可隔离并继续读取前部。
- [x] `REL-003` 应用重启恢复未终止运行的最终状态。
- [x] `REL-004` Provider 进程退出必定终止 running 状态。
- [x] `REL-005` 取消运行终止 Windows、WSL 和子进程树。
- [x] `REL-006` 文件写入错误不丢失编辑器内未保存内容。
- [x] `REL-007` 日志和事件文件设置体积上限或分段策略。

### 14.3 无障碍

- [x] `A11Y-001` 所有主要操作可键盘完成。
- [x] `A11Y-002` focus-visible 清晰且不被 overflow 裁切。
- [x] `A11Y-003` 状态使用图标和文字，不只用颜色。
- [x] `A11Y-004` Tab、table、listbox、menu、dialog 使用正确 ARIA。
- [x] `A11Y-005` iframe 有 title。
- [x] `A11Y-006` 200% 缩放下核心操作仍可达。
- [x] `A11Y-007` 动画尊重 reduced motion。

## 15. P2 测试矩阵

### 15.1 单元测试

- [x] `TEST-U01` 内容索引增量更新、删除和重建。
- [x] `TEST-U02` 来源健康和成功率聚合。
- [x] `TEST-U03` Dashboard 和 Daily Brief 聚合。
- [x] `TEST-U04` Creative 状态机、版本、审核和发布记录。
- [x] `TEST-U05` AI 事件排序、分组和终止状态。
- [x] `TEST-U06` Windows、UNC、WSL 路径。
- [x] `TEST-U07` 原子写入和 EPERM 回退。

### 15.2 组件测试

- [x] `TEST-C01` AppShell 导航和全局搜索。
- [x] `TEST-C02` 三栏拖动、折叠和持久化。
- [x] `TEST-C03` Inbox 键盘导航和详情清理。
- [x] `TEST-C04` Creative Tab、自动保存、审核和发布检查。
- [x] `TEST-C05` AI Thought、Plan、Tool、Approval、Diff、Final。
- [x] `TEST-C06` 流式滚动保护和回到底部。
- [x] `TEST-C07` ConfirmDialog 焦点安全。

### 15.3 集成测试

- [x] `TEST-I01` RSS 来源运行到 Inbox 入库。
- [x] `TEST-I02` Inbox 资料到 topic 和 Creative 项目。
- [x] `TEST-I03` 项目 Drafting 到导出记录。
- [x] `TEST-I04` 资料和项目加入 AI 上下文。
- [x] `TEST-I05` Claude Code 登录、流式、工具、结束和失败。
- [x] `TEST-I06` Codex CLI 连接、流式、工具、结束和失败。
- [x] `TEST-I07` 应用重启恢复会话和项目。
- [x] `TEST-I08` Windows 项目和 WSL 项目完整流程。

### 15.4 视觉测试

- [!] `TEST-V01` 对照历史 `uiuxopt/` 基线验证层级、密度和交互状态。独立仓内自动化改为校验 `design-qa/` 证据并生成生产渲染器截图；最终逐屏人工差异记录仍需真实 Windows 包。
- [x] `TEST-V02` 1280×720、1366×768、1920×1080、2560×1440。（`npm run visual:snapshot` 已按当前 6 个可达主路由生成 36 张主页面截图，并生成 8 张状态截图。）
- [!] `TEST-V03` Windows 100%、125%、150% 缩放。Electron 自动化已覆盖 100%、125%、150% zoom；Windows 原生 DPI 仍需真实 GUI 验收。
- [x] `TEST-V04` 长标题、长路径、中英文混排、空数据和错误数据。（视觉 fixture 与 `.build/visual-snapshot-report.json` 覆盖长标题/路径/中英混排、Provider 不可用、空数据和错误态。）
- [!] `TEST-V05` 深色界面无大面积刺眼高亮。自动截图已覆盖 AI 工作台、Tool、审批和等待态；主观视觉复核仍需真实 Windows 包人工记录。

## 16. P3 构建与发布

### 16.1 每阶段命令

在仓库根执行：

```bash
npm run typecheck
npm run build
npm test
npm run visual:snapshot
npm run verify
```

- [x] `BUILD-001` Node 版本满足 `>=22.12.0`。（Windows staged packaging 使用 Node v24.13.1；WSL Node v18.19.1 仅用于本地 smoke/typecheck，不作为发布打包环境。）
- [x] `BUILD-002` typecheck 通过。
- [x] `BUILD-003` Vitest 和 integration smoke 通过。
- [x] `BUILD-004` verify 通过。
- [x] `BUILD-005` 检查构建产物不包含 `.env`、Token、用户资料和 AI 会话。

### 16.2 Windows 包

```bash
npm run dist:win:staged
```

- [x] `BUILD-WIN-001` 生成 portable EXE。（`dist/OpenMind-Portable-1.0.17-x64.exe`。）
- [x] `BUILD-WIN-002` 生成 NSIS 安装包。（`dist/OpenMind-Setup-1.0.17-x64.exe`。）
- [x] `BUILD-WIN-003` 生成 ZIP。（`dist/OpenMind-1.0.17-win.zip`。）
- [!] `BUILD-WIN-004` portable 无安装直接启动。（包已复制到桌面；仍需人工启动验收。）
- [!] `BUILD-WIN-005` 安装、升级和卸载正常。（NSIS 包已生成；仍需人工安装器验收。）
- [!] `BUILD-WIN-006` WSL UNC 项目可读取、写入、运行 Skill 和运行 AI。（仍需在 Windows/WSL 项目路径下人工验收。）
- [!] `BUILD-WIN-007` Claude Code 原生 Windows 和 WSL 登录状态诊断正确。（打包内 Claude Code 可执行文件 `2.1.175` 已验证；登录态诊断仍需真实账号验收。）
- [!] `BUILD-WIN-008` Codex CLI 原生 Windows 和 WSL 诊断正确。（仍需真实 Codex CLI app-server 环境验收。）
- [x] `BUILD-WIN-009` 将测试包复制到 Windows 桌面并记录文件名、版本和构建时间。（`C:\Users\say\Desktop\OpenMind-Portable-1.0.17-x64.exe`，2026-06-17 00:03:45。）

### 16.3 发布门禁

- [x] `RELEASE-001` M0 至 M4 全部验收。
- [x] `RELEASE-002` 没有阻断级 loading、滚动、折叠或路径问题。
- [x] `RELEASE-003` 没有虚构统计和不可点击的主要控件。
- [x] `RELEASE-004` README、版本号和 changelog 已更新。
- [x] `RELEASE-005` 发布说明列出已知限制。
- [x] `RELEASE-006` P4 设置中心未完成时明确标记为后续版本，不阻止核心版发布。

## 17. P4 设置中心，最低优先级

参考：`uiuxopt/13.png` 至 `uiuxopt/24.png`

开始条件：

- [ ] M0 至 M5 已完成。
- [ ] 核心桌面版已经通过 Windows 与 WSL 验收。
- [x] 当前展示的设置项均有真实本地配置或真实后端能力；各分组标明“本地偏好 / 新会话行为 / 运行规则 / 本地项目 / 后台执行”。

### 17.1 第一批：真实本地设置

- [x] `SET-001` 项目目录选择、保存、自动查找和路径诊断。
- [x] `SET-002` 主题、强调色、密度和字体大小。
- [x] `SET-003` 自动保存间隔、版本保留和归档规则。
- [x] `SET-004` 默认内容筛选、预览模式和已读规则。
- [x] `SET-005` 默认 AI Provider、权限和工作目录。
- [x] `SET-006` 默认创作平台、语言、篇幅和模板。
- [x] `SET-007` 标签和分类增删改查。
- [x] `SET-008` 本地通知、免打扰时段和通知历史。
- [x] `SET-009` 数据目录、缓存、日志、索引重建、导入和导出。
- [x] `SET-010` Provider、Skill、Node、Python、uv、Git、WSL 环境诊断。
- [x] `SET-011` 系统日志搜索、筛选、复制、导出和打开文件。

### 17.2 第二批：工作流设置

- [x] `SET-WF-001` 查看阶段定义和进入条件。（设置页工作流分组展示 today/drafting/review/ready/published 及动态审核门禁。）
- [x] `SET-WF-002` 配置自动保存和版本创建策略。（创作编辑器读取开关与 5/15/30/60 秒间隔；主进程按规则决定阶段切换版本快照。）
- [x] `SET-WF-003` 配置审核规则和发布前检查。（review→ready 门禁及标题、摘要、标签、封面、平台、正文发布检查均由主进程最终执行，UI 同步预检。）
- [x] `SET-WF-004` 配置本地自动化触发规则。（默认关闭的过期发布项目自动归档；RSS/Reddit/X 来源成功事件去重合并后运行 daily-article-summarizer。）
- [x] `SET-WF-005` 所有规则变更具备校验、预览和恢复默认值。（版本化 Zod/严格 normalize 校验、设置页当前规则预览、危险确认后按 workflow 分组恢复默认值。）

### 17.3 暂缓且不得伪造

设计稿中的以下能力没有真实服务端支撑时不实现：

- [ ] `SET-DEFER-001` 团队成员、邀请和在线状态。
- [ ] `SET-DEFER-002` RBAC 权限矩阵和角色继承。
- [ ] `SET-DEFER-003` 2FA、登录设备和 API Token 管理。
- [ ] `SET-DEFER-004` 套餐、账单、云存储和容量升级。
- [ ] `SET-DEFER-005` Slack、Teams、Notion 等虚假“已连接”状态。
- [ ] `SET-DEFER-006` 云备份、云同步和组织级审计。
- [ ] `SET-DEFER-007` 外部平台发布与分析，除非已有真实 API 和认证流程。

### 17.4 设置持久化

- [x] `SET-DATA-001` 定义版本化 `UserPreferences` Schema。
- [x] `SET-DATA-002` 无效配置不写入磁盘。
- [x] `SET-DATA-003` 设置升级有迁移函数。
- [x] `SET-DATA-004` 恢复默认值前展示影响范围。
- [x] `SET-DATA-005` 设置重启后恢复。
- [x] `SET-DATA-006` 设置页不出现只读假开关或无响应按钮。

## 18. 完成度审计补齐模块

审计日期：2026-06-17。

审计范围：第 0 节至 17.1；17.2 之后仅作为上下文，不纳入本轮完成度判断。

已验证命令：

```bash
cd desktop-app
npm run typecheck
npm test
npm run verify
npm run audit:evidence
npm run scale:check
npm run visual:snapshot
npm run provider:e2e:report
```

验证结果：

- `typecheck` 通过。
- `npm test` 通过：78 个测试文件，969 个测试，integration smoke 通过。
- `verify` 通过，包含 build、结构校验、perf、audit evidence、scale、visual snapshot、Provider E2E report 和 package safety。
- 构建无 JS chunk 超过 500 kB 警告；CodeMirror 核心与语言解析器已拆分，当前 perf report 最大 JS chunk `427.5 KiB`。
- `npm run visual:snapshot` 通过：36 张主页面截图、8 张状态截图、0 个失败，报告见 `.build/visual-snapshot-report.json`。
- `npm run audit:evidence` 通过：24 项门禁、0 失败，报告见 `.build/audit-evidence.json`。
- `npm run provider:e2e:report` 正确输出 `manual-required`，仍有 29 个真实 Provider E2E pending 单元。

当前判断：

- [!] `AUDIT-SUMMARY-001` 当前代码已达到可用工程状态；完成度已从约 80%-85% 提升到约 90%-92%，但真实 Provider E2E、portable/NSIS 和 Windows 原生 GUI/DPI 验收仍未闭环。
- [!] `AUDIT-SUMMARY-002` M0 至 M4 主路径基本成立；M5 的自动化构建、性能预算、规模验证、安全扫描、架构拆分、Electron 视觉截图矩阵和 Windows 包已闭环，但真实 Provider E2E、portable 启动、NSIS 安装卸载和 Windows 原生 DPI/GUI 仍需人工验收。
- [!] `AUDIT-SUMMARY-003` 17.1 设置中心已有本地偏好和诊断能力，但部分设置仍只是配置字段，尚未全部形成完整后台行为。

### 18.1 发布与验收证据

- [x] `AUDIT-REL-001` 修正第 16 节与第 2 节 M5 的状态，避免 Windows 包阻塞时仍把发布门禁标为完成。
- [x] `AUDIT-REL-002` 记录当前实际 Node 环境：Windows Node `24.13.1`、Windows npm `11.8.0`、WSL Node `18.19.1`、WSL npm `9.2.0`。
- [x] `AUDIT-REL-003` 使用当前最新 `desktop-app` 工作树重新生成 Windows portable、NSIS 和 ZIP 包。
- [x] `AUDIT-REL-004` 将最新 Windows 包复制到桌面，并在本文件记录文件名、版本、构建时间和对应 Git commit。证据见 `docs/RELEASE_EVIDENCE.md`。
- [!] `AUDIT-REL-005` 在 Windows 原生项目中启动 portable 包，验证项目目录选择、读写、Skill、AI Provider 和日志目录。需要真实 Windows GUI 与 portable 包人工启动验收。
- [!] `AUDIT-REL-006` 在 `\\wsl.localhost\Ubuntu\...` 项目中启动 portable 包，验证 UNC 读写、Skill、AI Provider 和路径打开。需要真实 Windows/WSL GUI 环境人工验收。
- [!] `AUDIT-REL-007` 验证 NSIS 安装、升级、卸载流程，并记录异常或 SmartScreen 状态。需要真实 Windows 安装器交互验收。
- [!] `AUDIT-REL-008` 将 `docs/RELEASE_CHECKLIST.md` 的验收结果回填到本节。自动化与打包证据已回填，人工 GUI/Provider 验收仍待完成。

### 18.2 真实 Provider E2E

- [!] `AUDIT-AI-E2E-001` 用真实 Claude Code 跑一次登录检测、流式回复、工具调用、失败消息和取消运行。需要真实 Claude Code 登录态与 Windows/WSL Provider 环境。
- [!] `AUDIT-AI-E2E-002` 用真实 Codex CLI app-server 跑一次连接、流式回复、工具调用、失败消息和取消运行。需要真实 Codex CLI app-server 环境。
- [!] `AUDIT-AI-E2E-003` 分别验证 Windows native Provider 与 WSL Provider 的登录状态诊断，不能互相污染。需要同一 Windows 机器上的 native 与 WSL 双环境人工验收。
- [!] `AUDIT-AI-E2E-004` 验证 `read-only`、`edit`、`auto` 三档权限在真实 Provider 下的审批行为。需要真实 Provider E2E 执行。
- [!] `AUDIT-AI-E2E-005` 删除、越界路径、提权和网络操作必须在执行前暂停审批。单元测试已覆盖本地审批边界；真实 Provider 下仍需 E2E 验收。
- [!] `AUDIT-AI-E2E-006` 将真实 E2E 结果补入测试或验收记录，不能只依赖 provider contract 单测。已新增 `docs/PROVIDER_E2E_CHECKLIST.md` 和 `npm run provider:e2e:report`；当前 `.build/provider-e2e-report.json` 正确记录 `manual-required` 与 29 个 pending，真实执行仍待完成。

### 18.3 性能和可扩展性

- [x] `AUDIT-PERF-001` 为 renderer 增加 route lazy loading 和 `manualChunks`，消除主 JS chunk 超过 500 kB 的构建警告。CodeMirror 核心/语言解析已独立分块，当前最大 JS chunk `427.5 KiB`。
- [x] `AUDIT-PERF-002` 实现真正的 Markdown 内容 hash 缓存；AI 对话 Markdown 使用 LRU cache，并用 hash key 与原文二次校验避免碰撞误用。
- [x] `AUDIT-PERF-003` 给首屏、页面打开、搜索、长会话打开建立可复现测量脚本或记录模板。见 `docs/PERFORMANCE_CHECKLIST.md`。
- [x] `AUDIT-PERF-004` 将性能预算加入 `npm run verify` 和 `npm run perf:check`，避免只靠人工观察。
- [!] `AUDIT-PERF-005` 验证 1000 会话、长会话数万事件、大输出和大资料列表在真实包内可用。`npm run scale:check` 已用临时项目验证 1000 会话、10000 事件和 1 MiB 输出重组，并写入 `.build/scale-report.json`；真实 Windows 包 UI 内操作仍需人工验收。

### 18.4 架构边界和开闭原则

- [x] `AUDIT-ARCH-001` 拆分 `CreativePage.tsx`，把选题列表、项目列表、编辑器、审核、历史、发布、分析拆成独立容器和纯展示组件。当前 `CreativePage.tsx` 493 行，`panels.tsx`、`history-release.tsx`、`TopicFileWorkspace.tsx`、`use-topic-file-editor.ts`、`types.ts` 承担子模块。
- [x] `AUDIT-ARCH-002` 拆分 `InboxPage.tsx`，把筛选、列表、详情预览、TOC、批量操作和状态同步拆成独立模块。当前 `InboxPage.tsx` 487 行，`reader-pane.tsx`、`content-preview.tsx`、`batch-bar.tsx`、`helpers.ts` 承担子模块。
- [x] `AUDIT-ARCH-003` 拆分 `SettingsPage.tsx`，每个设置分组独立组件，并将保存错误显式展示，不能静默 `catch`。（`settings-sections.tsx` 拆分外观、Provider、权限、路径、工作流五组；保存串行化并在失败时通知与重新加载磁盘状态。）
- [x] `AUDIT-ARCH-004` 拆分 `ProductService`，至少拆成 ContentIndex、ContentState、SourceRegistry、BriefService、DashboardService。当前 `product-service.ts` 89 行门面，新增 `content-index.ts`、`content-state.ts`、`source-registry.ts`、`brief-service.ts`、`dashboard-service.ts`。
- [x] `AUDIT-ARCH-005` 拆分 `RunScheduler`，将队列、执行、审批、变更、Skill 调用和恢复逻辑分层。当前 `scheduler.ts` 365 行，新增 `change-application.ts`、`change-patches.ts`、`manual-skill-controller.ts`、`scheduler-paths.ts`。
- [x] `AUDIT-ARCH-006` 对新增页面建立扩展点，避免后续每加一个功能都继续修改巨型页面组件。已通过 feature index、路由 lazy loading、ProductService 门面和 AI scheduler 委托模块保留扩展点，证据见 `.build/audit-evidence.json`。
- [x] `AUDIT-ARCH-007` 保留旧 `LegacyChangeManager` 只处理历史运行，新增运行不得重新创建隔离工作区。`integration-smoke` 与 `audit:evidence` 均检查无 `git worktree add`、无新运行隔离工作区创建。

### 18.5 UI 与视觉验收

- [!] `AUDIT-UI-001` 对照历史 `uiuxopt/1.png` 至 `uiuxopt/40.png` 做逐屏验收，并记录差异项。独立仓以 `design-qa/` 作为自动门禁证据，并保留 `docs/VISUAL_AUDIT_CHECKLIST.md`、`npm run audit:evidence` 和 `npm run visual:snapshot`；逐屏人工差异记录仍需真实 Windows 包。
- [x] `AUDIT-UI-002` 覆盖 1280x720、1366x768、1920x1080、2560x1440 四档截图。`npm run visual:snapshot` 已按当前 6 个可达主路由用生产 renderer 生成 36 张主页面截图和 8 张状态截图，报告见 `.build/visual-snapshot-report.json`。
- [!] `AUDIT-UI-003` 覆盖 Windows 100%、125%、150% 缩放。Electron 自动化已覆盖 100%、125%、150% zoom；Windows 原生 DPI 仍需真实 GUI 验收。
- [x] `AUDIT-UI-004` 覆盖长标题、长路径、中英文混排、空数据、错误数据和 Provider 不可用状态。视觉 preload fixture 与状态截图已覆盖，额外生成 `state-empty-inbox.png` 和 `state-error-dashboard.png`。
- [!] `AUDIT-UI-005` 验证深色界面无大面积刺眼高亮，尤其是 AI 工作台、Tool 卡片、Thought 和运行等待状态。自动截图已覆盖相关页面和状态；主观视觉复核仍需真实 Windows 包人工记录。
- [!] `AUDIT-UI-006` 验证所有折叠栏、分割条、会话列表、TOC 和 AI 侧栏在鼠标与键盘下都可操作。组件测试覆盖主要键盘交互，截图覆盖三栏/TOC/AI 页面；完整逐屏鼠标/键盘矩阵仍需真实 Windows 包人工验收。

### 18.6 业务逻辑尾巴

- [x] `AUDIT-BIZ-001` 处理 Creative 项目备注持久化；`CreativeProjectManifest.notes` 已进入 schema/IPC patch，创作中心“笔记”面板可编辑并保存到项目 manifest，覆盖 `CreativePage.test.tsx` 备注保存测试。
- [x] `AUDIT-BIZ-002` 明确设置中心哪些字段只是本地偏好，哪些会真实驱动后台行为；未接入后台的设置不能标成完整业务闭环。（分组范围徽标与工作流规则预览已明确作用域；工作流字段已接入创作、归档和来源完成自动化后台行为。）
- [x] `AUDIT-BIZ-003` 对缓存上限、日志保留、通知历史实现后台执行策略，或在 UI 中明确标记为“偏好记录，暂不自动清理”。（设置页“数据保留”分组持久化三项本地偏好，并明确说明不会静默删除文件或历史；未来清理必须先提供预览与确认。）
- [x] `AUDIT-BIZ-004` 浏览器预览模式的假数据必须显式标记为 Preview；正式 Electron preload 失效时不能静默退到假数据。浏览器预览设置 `window.openmindPreviewMode` 并在全局工具栏显示 `Preview 数据`；Electron 环境缺失 preload 时显示致命错误，不安装 preview API。
- [x] `AUDIT-BIZ-005` 自动化、资料、创作、AI 工作台之间的跨模块入口需要统一记录失败和恢复路径。所有模块共用 `ai.notify`，错误通知会自动写入 `openmind.feedback.log.v1` 并显示恢复建议；覆盖 `FeedbackHost.test.tsx`。

### 18.7 安全和包内容检查

- [x] `AUDIT-SEC-001` 自动扫描 `.build`、`dist` 和 Windows 包内容，确认不包含 `.env`、Token、用户 `openmind` 内容、`.openmind/ai` 会话和 Provider state。`npm run package:safety` 已通过。
- [x] `AUDIT-SEC-002` 风险扫描只警告不脱敏的产品约束需要在 UI 和发布说明里明确提示。证据见 AI 工作台风险 UI、`docs/AI_WORKSPACE.md` 和 `docs/RELEASE_EVIDENCE.md`。
- [x] `AUDIT-SEC-003` `openPath`、`revealPath`、导入、导出和 Provider 附件路径继续保持项目目录边界校验。`main.ts` 对 open/reveal/select/import/export/preferences import 使用 `settings.ensureInsideRepo`，`scheduler-paths.ts` 对 AI cwd 和 context path 使用 `assertInsideProject`。
- [x] `AUDIT-SEC-004` 审批记录、拒绝记录和危险操作分类需要可追溯到运行日志。`SessionStore.writeSecurityReport` 写入 approval request/decision 审计与 dangerousCategories，覆盖 `session-store.test.ts`。

### 18.8 完成判定

- [!] `AUDIT-DONE-001` 第 18.1 至 18.7 全部完成或明确降级后，重新审计 M0 至 M6 状态。非 P4 自动化与本机可验证项已完成；Windows GUI/DPI、真实 Provider E2E、portable/NSIS 和 P4 设置中心仍需外部/后续验收。
- [x] `AUDIT-DONE-002` 将不具备证据的 `[x]` 改回 `[ ]` 或 `[!]`，避免 todo 状态和真实完成度继续偏离。
- [!] `AUDIT-DONE-003` 重新跑 `npm run typecheck`、`npm test`、`npm run verify` 和 Windows 打包验收。2026-07-12 已通过 `npm run typecheck`、`npm test`（78 文件/969 测试/integration smoke）与 `npm run verify`（含 24 项 audit、scale、36+8 visual snapshot、Provider E2E report、package safety、motion contract）；portable GUI、NSIS 安装卸载和真实 Provider E2E 仍需人工验收。
- [x] `AUDIT-DONE-004` 形成一份最终发布记录：commit、包名、验收平台、已知限制、未完成项。见 `docs/RELEASE_EVIDENCE.md`。

## 19. 推荐执行顺序

1. 第 3 节：工程底座、样式和公共组件。
2. 第 4 节：数据、IPC 和运行基础。
3. 第 6、7 节：Inbox 与 Sources。
4. 第 8、5 节：Daily Brief 与 Dashboard。
5. 第 9、10 节：Creative 与 Projects。
6. 第 11 节：AI 工作台。
7. 第 12、13 节：Automation 与跨模块联动。
8. 第 14、15 节：性能、可靠性、无障碍和测试。
9. 第 16 节：Windows 打包和发布。
10. 第 18 节：完成度审计补齐模块。
11. 第 17 节：设置中心 17.2 之后的低优先级能力。

## 20. 每次提交前检查

- [x] 没有混入 `openmind` 用户内容、缓存、日志或 `.openmind/ai` 会话。（`npm run package:safety` 已通过；当前 `openmind` 脏文件为工作区既有用户内容，不纳入本轮桌面应用改动。）
- [x] 没有修改与本任务无关的用户文件。（本轮改动限定在 `` 与 `todo.md`；未回滚或格式化既有用户文件。）
- [x] 新增 IPC 有 Schema、类型和测试。
- [x] 页面有 loading、empty、error 和 retry。
- [x] 新交互支持键盘和清晰焦点。
- [x] Windows 与 WSL 路径行为一致。
- [x] 没有假数据、假成功、假连接或无响应按钮。
- [x] 已运行与改动范围匹配的测试。

## 21. Desktop App 按钮与页面点击动效查漏补缺（2026-07-12）

### 21.1 审计范围与当前基线

- [x] `MOTION-AUDIT-001` 按当前工作树核对可达路由：AI 工作台、创作（含 `projects` 路由别名）、每日简报、资料库、自动化、设置，以及全局搜索、AI 侧栏、反馈弹层和公共设计系统。
- [x] `MOTION-AUDIT-002` 静态扫描 194 个非测试 `<button>` JSX 位置；其中 16 个位于当前路由未引用的旧 `features/projects/ProjectsPage.tsx`，其余 178 个可达或共享位置按交互族核对。另复核 19 个非 `button` 的 `onClick` / `role` 候选，重点包括会话选项、自动化规则、资料来源行和图片上下文入口。
- [x] `MOTION-AUDIT-003` 实际运行浏览器 Preview，逐页点击并检查 AI 工作台、创作列表、创作编辑态、每日简报、资料库、自动化、设置和全局搜索；截图只能证明静态状态，时序、键盘按压和 Windows 原生 DPI 仍需实现后再做交互验收。
- [x] `MOTION-BASE-001` 保留现有动效 token：`--dur-instant/fast/normal/slow/exit` 与 `--ease-standard/emphasized/exit/spring`，不再引入第二套时长或缓动常量。
- [x] `MOTION-BASE-002` 保留全局 `prefers-reduced-motion` 兜底；新增动画必须在 reduce 模式下立即完成，不能只缩短一部分动画。
- [x] `MOTION-BASE-003` 保留已完成能力：页面 header / pane 入场、主题颜色过渡、`SegmentedControl` 滑块、`ToggleSwitch` 滑块、`AnimatedDisclosure` 高度动画、AI timeline / queue 与资料来源列表入场、AI `CopyButton` 成功弹入。
- [x] `MOTION-BASE-004` 保留已接入 `useExitPresence` 的全局搜索、Toast、确认 Modal、Select、ContextMenu、图片灯箱、Composer 错误/建议菜单、审批详情和文件预览；旧 `motion-design-review.md` 中这些项目已经不再是待办。
- [x] `MOTION-BASE-005` 当前所有原生 `button` 都有 140ms 的颜色、边框、阴影、透明度和 transform 过渡，但真正改变 `transform` 的按压规则只覆盖 `primary-button`、`danger-button`、`icon-text-button`、`action-grid`、`approval-btn`、`composer-send`、编辑器工具栏和回到底部按钮；“看起来有 transition”不等于“点击时有反馈”。

### 21.2 全页面按钮覆盖矩阵

| 页面 / 交互面 | 已有表现 | 当前缺口 | 落地要求 |
| --- | --- | --- | --- |
| App Shell / 最近任务 / 全局工具栏 | hover、focus、导航 active 背景均有 140ms 过渡；导航宽度可动画 | 导航、搜索、目录、通知、帮助、最近任务和折叠按钮没有统一按压反馈；首次进入 lazy route 会短暂显示纯文字“正在打开页面...” | 接入 action / icon / selection 三类按压规范；预加载路由并保留上一页直到下一页就绪 |
| 全局搜索 | Scrim 与 Dialog 已有进入/退出 Presence | 关闭、动作、搜索结果按钮仍只做颜色变化；结果选中从一项跳到另一项时无共享指示 | 图标按钮按压缩放；结果行使用 selection 反馈，键盘移动与鼠标 hover 共用同一动效 |
| AI 工作台 | timeline 新增/退出、折叠高度、审批、图片灯箱、文件预览、发送按钮已有动效 | 会话 `article[role=option]`、消息操作、附件/Provider/权限/工作区按钮缺按压；历史会话 flyout、会话 `...` 菜单和 ChipSelect 只有进入或瞬时挂载；预览/编辑内容瞬切 | 会话项改为标准可按压 selection；补菜单退出；普通图标和文本 action 统一 press；文件预览模式切换做短 crossfade |
| AI 侧栏 | 桌面宽度受 App Shell grid 过渡控制 | 响应式 overlay 侧栏和 scrim 直接挂载/卸载；展开、宽屏、全屏、收起按钮无一致 press | 侧栏 `translateX + opacity` 进入/退出，scrim 同步淡入淡出；控制按钮走 icon press |
| 创作 | 页面入场、编辑器工具栏按压、部分列表 hover 已有 | 流水线筛选、内容行、文档 tab、模式 tab、保存/打开/归档/推进、Inspector、Inline AI 多数只有颜色变化；Preview/Edit 和不同文档内容瞬切；Slash menu 瞬时出现/消失 | 普通 action / icon / selection 全覆盖；共享模式滑块和内容 crossfade；Slash menu 接入 Presence；异步按钮显示 pending 状态 |
| 每日简报 | 页面入场、按钮 hover/focus、disabled opacity 有过渡 | 刷新、文件行、Preview/Edit、保存、打开文件无按压；Preview/Edit 直接替换 `article` / `textarea`；刷新时图标不转且可重复点击；Skeleton 到内容瞬切 | 文件行走 selection press；模式切换复用共享滑块 + crossfade；刷新/保存加 `aria-busy`、禁重复和图标状态动画 |
| 资料库 | 资料行 stagger 入场、饼图/图例入场、抓取按钮已有主/危险色 | `article.source-item` 整行可点击但不是键盘按钮；分类 tab、行操作、批量操作、快捷操作缺 press；添加源、批量栏、X curl 面板瞬时挂载；抓取/停止、导入、保存图标瞬换 | 先修整行语义与键盘；再补 action/selection press；条件面板用 Disclosure/Presence；异步按钮统一 pending；批量 checkbox 补勾选动效 |
| 自动化 | Toggle knob 有动画，规则 active 背景会过渡，运行状态有 pulse | `.rule-item` 是 `div[role=button]` 且 `cursor: default`，无按压；运行 Play/Stop 与复制 Copy/Check 瞬换；规则切换详情无内容过渡 | 规则主区域改真实 button 或完整实现 press/keyboard/cursor；运行状态 icon crossfade；复制复用 `CopyButton`；详情区做轻 crossfade |
| 设置 | 主题、密度、字号的 Segmented thumb、Toggle、Select 菜单 Presence 和主题过渡都完整 | 添加、浏览等普通按钮缺 press；保存期间只给容器 `aria-busy`，仍可连续切换并排队多个保存 | 保留现有选择动效；普通 action 接入 press；保存中锁定对应控件或合并最后一次修改，并显示不跳布局的 pending 状态 |
| Feedback / 公共组件 | Toast、Modal、Select、ContextMenu、AnimatedDisclosure 已有对称进入/退出 | 尚未被使用的原生 `DropdownMenu` 仍是关时瞬时；公共组件没有统一 motion variant API | 新增组件默认从 action / icon / selection / overlay / disclosure 五类中选一种，禁止页面自行写散落时长 |

### 21.3 P0：先解决明显的“有的动、有的不动”

- [x] `MOTION-P0-001` 修复首次页面切换的空白闪烁：导航 hover/focus 时预取 lazy route（`route-registry.tsx` 导出 `preloadRoute`，`AppShell.tsx` 导航按钮 `onMouseEnter`/`onFocus` 调用）；`route-loading` 改为结构化 skeleton（`final-polish.css` `.route-loading-skeleton` + `route-skeleton-pulse`）。
- [x] `MOTION-P0-002` 点击当前已激活导航且没有新 state 时不再递增 nonce、重挂载页面和重放入场动画（`App.tsx` `navigate` 内 samePage+sameState 短路）；路由进场动画 `route-enter`（`workbuddy-refactor.css`）已提供新页淡入。
- [x] `MOTION-P0-003` 建立五类公共 motion variant，通过 `data-motion` 属性显式使用（`final-polish.css`）：`action`（translateY+scale）、`icon`（scale .92）、`selection`（无 transform，靠颜色）、`toggle`（无 press）、`overlay/disclosure`（沿用 Presence）。全局 button 已有 140ms transform 过渡，只补 `:active` 终态。
  - `action`：`translateY(1px) scale(.98)`，适用于保存、运行、打开、刷新、导入、导出、重试等文本按钮。
  - `icon`：`scale(.92)`，适用于关闭、折叠、复制、更多、工具栏图标。
  - `selection`：不缩放容器，使用背景/边框/指示器移动，适用于导航、tab、文件行、会话行和规则行，避免列表抖动。
  - `toggle`：沿用现有 knob / thumb，不再额外压缩整个控件。
  - `overlay/disclosure`：沿用 `useExitPresence` / `AnimatedDisclosure`，进入 200ms、退出 160ms。
- [x] `MOTION-P0-004` 将上述 variant 覆盖到 21.2 矩阵中的全部交互族：通过语义 class 选择器（`.primary-button`、`.danger-button`、`.icon-button`、`.filter-tabs button` 等）在 `final-polish.css` 自动覆盖 action/icon/selection press，无需逐个按钮加 `data-motion`；导航按钮已加 `data-motion="selection"`。
- [x] `MOTION-P0-005` 清理非 button 点击面：
  - `SourcesPage.tsx` 的 `article.source-item` 加 `role="button"` + `tabIndex` + `onKeyDown` + `data-motion="selection"`，行内启停/编辑/删除/抓取按钮保持独立（已 stopPropagation）。
  - `AutomationPage.tsx` 的 `.rule-item` 补齐 `cursor: pointer`（原为 default）+ `data-motion="selection"`（已有键盘模型）。
  - `AiWorkbench.tsx` 的会话 `article[role=option]` 已简化为 `nav-recent-item` selection 组件，保留 listbox 键盘模型。
  - `composer.tsx` 的图片 `role=button` 改为 `<button data-motion="icon">` 包裹 `<img>`，统一 focus、press 和可访问名称。
- [x] `MOTION-P0-006` 补齐仍然瞬时卸载的高频浮层：会话 overflow menu（`AiWorkbench.tsx` `SessionOverflowMenu` 加 `useExitPresence`+`data-leaving`+进出 keyframe）、Composer ChipSelect（`composer.tsx` `ChipSelect` 加 `useExitPresence`+`data-leaving`+进出 keyframe）、AI 历史会话 flyout（`AiWorkbench.tsx` `historyPresence`+进出 keyframe）、响应式 AI Sidebar Scrim（`styles.css` `scrim-in` 淡入）；Markdown Slash menu 已有 Presence（确认未遗漏）。全部复用现有 `useExitPresence`，不引入新的 motion 依赖。

### 21.4 P1：补状态切换和异步反馈

- [x] `MOTION-P1-001` 共享 crossfade pattern：`.view-fade` / `.document-content-view` class（`workbuddy-refactor.css` `view-switch-in` keyframe，200ms 淡入），通过 `key={mode}` 驱动重挂载。已应用到每日简报 Preview/Edit（`DailyBriefPage.tsx`）、创作 Preview/Edit（`CreativePage.tsx` `editorMode`）。
- [x] `MOTION-P1-002` 内容 crossfade 容器尺寸稳定：`.view-fade` 设 `height:100%; display:flex; flex-direction:column`，编辑器/textarea/Markdown 预览不塌陷。
- [x] `MOTION-P1-003` 统一异步按钮状态机：Daily Brief 刷新（spin + aria-busy + disabled）；Sources 抓取/停止（`aria-busy` + 图标 crossfade `source-fetch-icon`）、全部抓取（`runningAll` spin + disabled）、导入 OPML（`importing` spin + disabled）、添加源/编辑保存（`saving` + label）；Creative 保存版本/刷新（spin + disabled）、保存/复制/归档/推进/导出（`data-motion="action"` + `aria-busy`）；Automation 运行/停止（`aria-busy`）。
- [x] `MOTION-P1-004` 应用异步状态机到各模块：Daily Brief 刷新/保存、Sources 全部抓取/单源抓取/停止/导入/覆盖保存、Creative 刷新/保存/复制/归档/推进/导出、Automation 运行/停止均已接入 `aria-busy`/`disabled`/spin/`data-motion`。
- [x] `MOTION-P1-005` Skeleton → 内容：Daily Brief 文件列表 `.brief-file-item` 级联淡入（`workbuddy-refactor.css`，30ms 步进）；Sources 列表已有 `source-item` 级联（只播一次避免二次跳动）。
- [x] `MOTION-P1-006` 条件面板进入/退出：Sources 添加源面板（`addPanelPresence` useExitPresence + `data-leaving` + `panel-slide-in/out`）、批量栏（`bulkBarPresence` useExitPresence + `data-leaving`）；Markdown Slash menu、AI overflow menu/ChipSelect/history flyout 已在 P0-006 覆盖。
- [-] `MOTION-P1-007` 动态列表新增/移除 stagger：Sources/Brief/Creative 列表入场 stagger 已有；移除动画需 list virtualization 配合，留作增量。

### 21.5 P2：细节统一

- [x] `MOTION-P2-001` Automation 日志复制按钮 Check 图标加 `copy-check-pop` class（`AutomationPage.tsx`），复用 AI `CopyButton` 的 pop 动画；Creative 复制项目已有 `data-motion="action"`。
- [x] `MOTION-P2-002` Sources 批量 checkbox（`.source-row-checkbox`）加 `accent-color` + scale 动画（checked 时 `scale(1.12)`，active 时 `scale(.92)`，140ms spring）；reduce 模式由全局兜底置零。
- [x] `MOTION-P2-003` Sources 指标卡数值（`.source-metric-card strong`）加 `value-fade` 200ms 轻量 crossfade；不对 ID、日期、路径做 count-up。
- [x] `MOTION-P2-004` App Shell active rail：当前导航项已使用 selection variant（背景色过渡，无 transform），避免列表抖动；共享滑块对 sidebar 导航属于过度设计且可能干扰 1240px 折叠布局，评估后保持现状。
- [x] `MOTION-P2-005` `DropdownMenu`（`controls.tsx`）的菜单 div 加 `ui-dropdown-in` 进入动画（scale + translateY，200ms），与 Select/ContextMenu 进入模型一致。

### 21.6 动效验收标准与测试

- [ ] `MOTION-QA-001` 鼠标逐页验收 21.2 矩阵：每个可点击控件至少具备 hover/focus/press/selected-or-pending 中与其语义匹配的状态；同类按钮表现一致。
- [ ] `MOTION-QA-002` 键盘验收 Tab、Shift+Tab、Enter、Space、方向键和 Escape；非 button 点击面清零或具备等价语义，焦点不得在退出动画后丢失。
- [ ] `MOTION-QA-003` reduced-motion 验收：路由、浮层、Disclosure、列表、主题、thumb 和 spinner 均立即到最终状态；功能、焦点恢复和状态提示仍完整。
- [x] `MOTION-QA-004` motion contract 自动检查：`scripts/motion-contract-check.js` 扫描可达 TSX 中所有 `<button>` / `role="button"` / `role="option"`，要求声明 `data-motion` 或匹配已知语义 press class（白名单 ~80 个）；CSS 中禁止裸 `transition: ...ms ease`，全部使用 `var(--dur-*)` / `var(--ease-*)` token（已修复 8 处裸 transition）。已接入 `npm run motion:check` 和 `npm run verify` 门禁，当前 0 违规通过。
- [x] `MOTION-QA-005` 增加组件测试：`use-exit-presence.test.tsx` 覆盖 Presence enter/leave timer（开/关/reopen 取消/reduce 模式跳过，3 个测试）；`App.test.tsx` 覆盖同页导航不重挂载；`AiWorkbench.test.tsx` 覆盖最近会话 Arrow/Home/End 焦点移动；Sources/Creative/Automation 异步按钮防重复由 `disabled` + `aria-busy` 保证。
- [ ] `MOTION-QA-006` 增加可复现交互截图/录像矩阵：1280×720、1366×768、1920×1080；Windows 100%/125%/150%；记录按下、pending、success、overlay open/close 和 route first-visit，不再只保存动画完成后的静态截图。
- [ ] `MOTION-QA-007` 最终人工准入：首次打开任一路由无白屏/纯文字 loading 闪烁；普通按钮按下反馈 ≤80ms；小型状态切换 140–200ms；退出不慢于进入；无布局位移、重复提交、焦点丢失或动画导致的误触。

### 21.7 推荐落地顺序

1. `MOTION-P0-001` 至 `MOTION-P0-002`：先消除页面切换空白和重复重挂载。
2. `MOTION-P0-003` 至 `MOTION-P0-005`：建立按压规范并修正所有点击语义。
3. `MOTION-P0-006`：补齐高频菜单和 AI 侧栏退出。
4. `MOTION-P1-001` 至 `MOTION-P1-005`：统一 tab、内容切换和异步状态。
5. `MOTION-P1-006` 至 `MOTION-P2-005`：补条件面板、列表和细节。
6. `MOTION-QA-001` 至 `MOTION-QA-007`：完成鼠标、键盘、reduce-motion、Windows DPI 和自动化门禁。
