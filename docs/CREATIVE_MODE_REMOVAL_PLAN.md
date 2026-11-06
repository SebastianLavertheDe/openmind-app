# 创作模式移除计划（Creative Mode Removal Plan）

> 目标：彻底移除应用内的「创作」模式（侧边栏入口、页面、后端、IPC、设置、样式与文案），
> 同时保留被「项目」成品编辑和 AI 文件预览复用的编辑器组件，不删除用户已有创作数据。
>
> 状态：功能实现完成，相关回归通过；仓库聚合验收尚未全绿（2026-11-06）。`fe1fe57` 已完成主体移除；本次核对补齐自动化退役与回归测试。下方勾选表示代码与对应行为已经核对，不代表所有发布门禁已通过；未通过检查与平台验证边界见验收记录。
> 清单保留实施前的路径和行号用于追溯；当前编辑器位于 `renderer/src/features/document-editor/`，已删除模块通过 Git 历史查阅。

## 0. 关键约束

| 约束 | 说明 |
| --- | --- |
| 不能整目录删 `renderer/src/features/creative/` | `MarkdownEditor`、`InlineAiBar` 被 `features/projects/ProjectOutputEditor.tsx:5-6` 和 `features/ai-console/AiFilePreviewPane.tsx:13` 复用 |
| Milkdown 不能卸载 | 项目成品编辑仍依赖 Markdown 编辑器（迁移而非删除依赖） |
| 不自动删除用户数据 | `openmindRoot/creative/` 下的文稿、版本、素材、发布记录保留在内容库，应用只是停止专门管理 |
| 公众号导出保留 | 微信公众号导出已被「项目」使用，不随创作模式移除 |
| 项目会话隔离保留 | 离开 Projects 时清除 `project-task` 活动会话的保护逻辑保留，只更新提及 Creative 的注释 |
| 每日选题链路保留 | `daily-topic-selector` 写入 `daily-topic/`，属于每日简报链路，不随创作工作台退役 |
| 目录契约 v1 冻结 | 不直接删除或重分类 `openmind-layout-v1.ts` 条目；本计划保留其历史兼容定义，如需改变契约另建 v2 并提供迁移 |
| 视觉基线人工审查 | 按 AGENTS.md：基线图须显式更新并逐张检查 actual/expected/diff，禁止自动重生成蒙混 CI |

## 1. 迁出共用编辑器

以 `MarkdownEditor` 和 `InlineAiBar` 为入口迁移完整依赖链。不能只按「是否被创作目录外直接 import」判断可否删除：

- [x] 迁移 `MarkdownEditor.tsx` → `MilkdownEditor.tsx` → `milkdown-runtime.ts`（含 `EditorSelectionSnapshot`/`MarkdownEditorHandle` 类型与 `milkdown-runtime.test.ts`）到公共位置（已迁入 `renderer/src/features/document-editor/`，保留内部相对引用）
- [x] 迁移 `InlineAiBar.tsx` + `InlineAiBar.test.tsx`（依赖：`design-system/components`、`ai-context`、`@shared/messages`、`MarkdownEditor` 类型）
- [x] 一并迁移间接依赖：`DocumentToolbar`、`DocumentFindbar`、`DocumentMenu`、`document-navigation.ts`、`document-block-menu.ts`、`document-commands.ts`、`document-menu-icons.ts`，以及 `DocumentToolbar.test.tsx` 等相关测试。`MilkdownEditor` 直接使用工具栏/查找栏，`milkdown-runtime` 直接使用命令、导航和块菜单，这些文件不能删除
- [x] 更新全部引用方及测试 mock 的 import：包括 `features/projects/ProjectOutputEditor.tsx:5-6`、`features/ai-console/AiFilePreviewPane.tsx:13` 和 `AiFilePreviewPane.test.tsx`
- [x] 在此阶段迁出内联 AI 的 `creativeUi.inlineAi` 中英文文案，更新组件及测试引用；同时迁出 `.inline-ai-*` 公共样式至 `styles/features/document-editor-ai.css`，之后第 9 条才能删除原创作文案/样式文件
- [x] 阶段验收：项目成品编辑和 AI 文件预览均可打开、编辑和保存；工具栏、查找/替换、目录、块菜单、撤销/重做和局部 AI 改写的已有行为测试通过

## 2. 删除导航和路由

- [x] `renderer/src/app/routes.ts` — 删页面类型 `"creative"`（:6）及 `page === "creative"` 判断（:14）
- [x] `renderer/src/app/route-registry.tsx` — 删 lazy import（:20）、preload 映射（:33）、导航条目（:80，即侧边栏「创作」入口，icon `FilePenLine`，group `core`）
- [x] `renderer/src/App.tsx` — 删 `showAiCompanion` 的 `"creative"` 分支（:118）、`usesEmbeddedFilePreview` 的 `"creative"` 分支（:199）
- [x] **保留**离开 Projects 时对 `activeSession.scope.type === "project-task"` 调用 `setActiveSession(null)` 的逻辑（:244 附近）。它防止项目会话泄漏到每日简报和普通 AI 页面，不属于创作专用逻辑；只调整注释，并保留/补充对应回归断言

## 3. 删除创作专用页面

共用组件迁出后清理 `renderer/src/features/creative/` 剩余目录：

- [x] 删 `CreativePage.tsx` + `CreativePage.test.tsx`（选题列表、制作中/待审核/待发布/已发布流程）
- [x] 删 `CreativeDetailPane.tsx`（创作详情）
- [x] 删 `panels.tsx` + `panels.test.tsx`、`history-release.tsx` + `history-release.test.tsx`（版本历史、发布记录）
- [x] 删 `stream.tsx`（创作内容列表、日期分组与阶段筛选）
- [x] 删 `TopicFileWorkspace.tsx`、`use-topic-file-editor.ts`、`types.ts`、`index.ts`
- [x] 删除目录前确认第 1 条编辑器完整依赖链、测试、样式和文案均已迁出；不得删除迁出后的 `DocumentToolbar`、`DocumentFindbar`、`DocumentMenu`、`document-*.ts`

## 4. 清理搜索和内容扫描

- [x] `renderer/src/app/GlobalSearch.tsx` — 删 `"creative-project"` kind（:124）、跳转分支（:157-158）、图标分支（:256）
- [x] `electron/product/global-search.ts` — 删 `searchCreativeProjects` 调用（:30）
- [x] `electron/product/content-index.ts`、`electron/lib/content.ts` — 清理对旧创作目录的专用扫描注释与逻辑（content-index.ts:23）
- [x] `electron/product/content-source.ts` — 移除 `latestCreativeTopics()` 及 topics 列表对它的合并调用。`content-index.worker.ts` 实际使用 `createExplicitContentSource()`，必须同时覆盖主进程回退路径和 worker 路径；同步维护 `content-source.test.ts` 的行为一致性测试
- [x] 明确旧 `content-index.json` 和内存缓存的失效/重建策略，保证升级后创作专用索引项退出搜索、普通内容仍可正常搜索；只重建派生索引，不删除原始文稿。保留用户主动通过通用文件搜索/预览访问旧文件的能力
- [x] `renderer/src/browser-api.ts` — 删浏览器预览 mock：`creative-project` 搜索结果、`getCreativeProjects`、`createCreativeProject`（:642-651）

## 5. 兼容历史会话

旧会话持久化了 `page: "creative"`，删除后必须仍能加载：

- [x] `shared/ai-session-origin.ts` — 移除 `page: "creative"` schema 分支（:10）时做宽容解析：命中旧值时降级为普通 AI 会话或通用文件预览，不抛校验错误
- [x] `renderer/src/app/session-navigation.tsx` — 删除恢复分支（:29）前确认旧 origin 的回落路径
- [x] 会话存储中的创作上下文引用（projectDir/filePath/previewPath）做兼容转换，避免旧会话无法恢复
- [x] 区分两种历史字段：`AiSession.origin.page: "creative"` 与 `ContextReference.kind: "creative"`。后者不是搜索结果类型，实际持久化在 `AiRun.contexts` 中，不能只处理会话 origin
- [x] 在 `electron/ai/session-store.ts` 使用 `AiSessionSchema` / `AiRunSchema` 校验之前，或在对应共享 schema 的兼容输入层，归一化这些旧字段。携带文件路径的旧上下文转换为 `file`，纯文本上下文转换为 `content`，保留其标签、正文和有效路径；旧 origin 回落到 `ai`，可访问文件经现有预览接口重新解析。迁移不得扩大工作区/项目权限
- [x] 归一化应幂等；不得依赖现有 catch 静默跳过旧 session/run 文件。保留原始记录及消息、运行 ID，旧引用指向缺失文件时只提示文件不可用，不丢弃整个会话或运行记录
- [x] 在本阶段补回归：旧 origin 可加载、旧 `contexts` 的运行历史仍可展示、分支/重试可构造有效请求、缺失原文件时仍可查看历史、重复加载/迁移不会损失上下文；不能只断言会话首页能打开

## 6. 删除创作后端

- [x] 删 `electron/lib/creative.ts` + `creative.test.ts`（项目创建、保存、阶段推进、审核、版本恢复、复制、归档、统计的完整实现）
- [x] `electron/main.ts` — 删 import（:25）与 `ProductService` 注入（:258）
- [x] `electron/product/product-service.ts` — 删 creative 服务字段与构造参数（:5-9、:18、:29、:40、:51）、目录 mtime 缓存（:76-77）、`searchCreativeProjects`（:181-191）及全部 creative 方法（:204 起）
- [x] `electron/product/common.ts` — 删 `CreativeApi`、`CreativeServiceApi`、`LegacyCreativeProject` 类型
- [x] 顺带核查 `electron/lib/fs-utils.ts`、`electron/project/project-service.ts`、`electron/skills/skill-package-service.ts` 中的 creative 引用

## 7. 删除接口和类型

- [x] `shared/ipc-channels.ts` — 删 14 个 `APP_CREATIVE_*` 通道常量（:52-65）
- [x] `shared/ipc-registry.ts` — 删对应 method→channel 映射（:55-68）
- [x] `electron/ipc-handlers.ts` — 删 schema import（:13-16）与全部 handler 注册（:412-436 附近）
- [x] `shared/contracts.ts` — 删 `CreativeStageSchema`、`CreativeReviewIssue/ReportSchema`、`CreativePublishConfig/PatchSchema`、`CreativeProjectManifestSchema`、`CreativeTopic`、`CreativeProjectSummary`、`CreativeReleaseEvent` 及 Save/Create/ManifestPatch 输入类型（:837 起）；移除 `GlobalSearchResult` 的 `"creative-project"` kind（:729-730）
- [x] 第 5 条历史兼容测试通过后，收窄 **`ContextReference` 的 `"creative"` kind**（:109）。兼容输入继续接受并转换旧值，新生成的上下文只使用现存类型；同步检查运行记录、请求校验和分支/重试路径
- [x] 删 `shared/creative-registry.ts`（stage/platform/release 定义）
- [x] `shared/display-labels.ts` — 删 creative stage/platform/release label 函数与 `buildCreativeBuckets`（:5-58）
- [x] 暴露给界面的预加载 API 类型随 contracts 一并收窄（`getCreativeProjects` 等方法从 client 接口移除）

## 8. 清理创作工作流设置

`electron/lib/settings.ts`：

- [x] 删 `creative:` 偏好组：`defaultPlatform`、`defaultLanguage`、`defaultContentLength`、`defaultTemplate`（:605）
- [x] 删创作专用 workflow 键：`workflowAutoSaveDraft`、`workflowAutoVersionOnStageChange`、`workflowReviewRequiredForReady`、`workflowPublishChecklistEnabled`、`workflowAutoArchiveEnabled`（:607、:433、:537 等）
- [x] **共享键结论**：`autoSaveIntervalMs`、`maxVersions`、`archiveAfterDays` 保留为旧设置读入/重置兼容字段；当前项目和每日简报不消费它们，不会据此定时归档或删除文件。创作专用偏好和 workflow 键已退出公开 schema/UI
- [x] 设置页 UI：`features/settings/` 中创作偏好控件与 `SettingsPage.test.tsx` 相关断言同步清理

## 9. 清理样式、文案和依赖

- [x] 确认第 1 条已迁出公共 `.inline-ai-*` 等样式后，删除 `renderer/src/styles/features/creative.css` 及 `styles/index.css` 中的注册
- [x] 清理残留类名：`styles/base.css`、`styles/final-polish.css`、`styles/responsive.css`、`styles/workbuddy-refactor.css`、`styles/features/daily-brief.css`
- [x] 第 1 条迁出的编辑器/内联 AI 改写样式一并迁走，保持单一 CSS owner；迁完跑 `npm run audit:styles`
- [x] `components/useContentListLayout.ts` — 处理存储键 `openmind.list-detail.creative.v1`（:5-8，注释明确保留旧键以延续列表宽度）：沿用旧键以保留每日简报的已保存宽度；`DailyBriefPage.test.tsx` 覆盖复用行为
- [x] i18n：确认第 1 条已迁出并重接 `creativeUi.inlineAi` 公共文案后，删除 `shared/messages/zh-CN/creative-ui.ts` + `shared/messages/en/creative-ui.ts` 及两处 `index.ts` 导出；清理 `core.ts`、`app.ts`、`features.ts`、`electron.ts`（中英两套）中残留的创作字符串（含导航 label `navLabel("creative")` 词条）。检查保留编辑器的引用和中英文键/插值签名一致性
- [x] Milkdown 依赖保留在 package.json（项目编辑仍在用），确认无仅创作页使用的 npm 依赖后一并移除
- [x] 仓库根目录杂项：`design-qa-creative-focus.png`、`design-qa/` 中创作相关产物

## 10. 处理已有数据

- [x] 旧创作文稿、版本、素材、发布记录**保留在内容库**，应用停止专门管理；任何代码路径不得自动删除 `openmindRoot/creative/`
- [x] 历史页面状态（URL/session state 中的 creative 路由状态）与创作缓存做兼容处理或静默丢弃
- [x] `electron/paths/openmind-fixture.ts` — 正常新建工作区场景移除创作生产夹具；保留或另建一份包含旧 `creative/...`、中文目录、文稿和版本的升级兼容夹具，验证功能退役后数据保持原样、仍可通过通用文件接口访问
- [x] `shared/openmind-layout-v1.ts` — **保留冻结 v1 的旧目录定义**（:45-47），不直接删项、改序或重分类；停止创作专用扫描/生产与保留历史路径解析是两件事。如需调整目录契约，另建 `openmind-layout-v2` 并更新 ADR、版本选择、路径解析和迁移测试后实施，不在本次下线中隐式修改 v1
- [x] 更新 `docs/architecture/data-migration.md`：说明 creative 目录从「受管」降级为「普通内容目录」的策略

## 11. 核对相关 Skills

本计划范围：退役应用自带的创作生产链，保留每日简报/每日选题和用户自行导入的独立 Skills。实施前先核对包来源，不按 ID 直接删除或禁用所有同名包。

| 处理 | Skill | 原因/产物 |
| --- | --- | --- |
| 退役应用自带版本 | `creative-writing` | 生成多平台创作包，读写 `creative/**` |
| 退役应用自带版本 | `daily-writing-orchestrator` | 生成创作素材包 |
| 退役应用自带版本 | `ai-media-topic-selector` | 写入创作选题管理目录的 `ai_topic_*.md` |
| 退役应用自带版本 | `collect-interest-markers` | 实际产物是 `creative/01-内容生产/选题管理/00-兴趣收集箱.md` |
| 退役应用自带版本 | `asset-collector` | 从创作包提取素材，读写 `creative/**` |
| 保留 | `daily-topic-selector` | 输出 `daily-topic/`，仍被每日简报和默认每日选题任务使用 |

- [x] 核对其余包对退役 Skill 的引用和 `creative/**` 读写，更新 `config/skill-library/catalog.json`、包源目录、构建清单、`shared/skill-compatibility-matrix.ts` 及对应数量/清单测试；保持每日总结、每日选题及 RSS 链路可用
- [x] 在启动/绑定内容根的升级逻辑中识别已经安装的应用自带退役包，并做幂等停用/退役标记；仅删除源码或 catalog 不够。`SkillPackageService.isRetired()` 按来源和用户保留标记判定退役，列表和执行快照在迁移写盘前也过滤退役包
- [x] 新会话技能选择、技能库、手动执行、Broker/Workflow 准入和自动化均应尊重退役状态；旧会话的历史技能快照保留作展示，但新一轮执行必须重新校验，不能恢复已退役能力。第三方 Git/目录/ZIP 导入和用户保留副本应按来源区分，不静默删改
- [x] 处理引用退役包的已有自动化规则：停用直接引用退役包及通过 Workflow Process 步骤依赖它的规则，说明退役原因。未准入的排队/重试记录转为 `blocked`，保留输入、触发器及历史；已准入子任务正常结束，失败后不再创建新尝试。保留 `daily-topic-generation` 等仍有效任务
- [x] 明确进行中任务的策略：允许已经准入的任务按绑定版本结束，结束前不替换/删除所用包；完成后阻止新的退役包准入。退役包源码退出分发，旧安装文件及其运行数据不做无差别删除
- [x] 升级回归夹具覆盖：已有启用的自带旧包、同名用户导入包、旧自动化、旧会话技能快照、进行中任务和重复启动；断言不再自动安装/重新启用退役包，保留功能及用户文稿不受影响
- [x] **微信公众号导出已被「项目」使用，保留**，不随本计划移除

## 12. 更新测试和文档

测试随所属阶段同步迁移或删除；此节用于核对覆盖范围和最终收尾，不能把所有测试/mock 修改推迟到最后：

- [x] 随目录/模块删除创作专用 `.test.tsx/ts`；第 1 条编辑器、工具栏、运行时和局部 AI 的测试随公共组件迁出并继续执行
- [x] 更新跨文件断言：`App.test.tsx`、`App.session-origin.test.tsx`、`app/AppShell.test.tsx`、`app/GlobalSearch.test.tsx`、`components/Chat.test.tsx`、`features/settings/SettingsPage.test.tsx`、`features/ai-console/composer.test.tsx`、`features/automation/AutomationPage.test.tsx`、`features/daily-brief/DailyBriefPage.test.tsx`
- [x] 主进程测试：`electron/ipc-handlers.test.ts`、`electron/ai/*`（scheduler/session-store/skill-selection 等测试中的创作场景）、`settings-v2.test.ts`
- [x] 主进程测试同时核对 `electron/product/product-service.test.ts`、`global-search.test.ts`、`content-source.test.ts` 及路径/目录契约测试；构造参数、fixture 和 mock 随相关生产代码同步调整
- [x] 新增回归：旧 origin 和旧 `contexts` 运行历史可加载、展示及分支/重试（第 5 条）；「创作」入口消失；离开项目后不会继续使用项目会话；项目成品编辑、AI 文件预览、公众号导出、每日简报和每日选题正常工作；退役 Skills 的新准入受阻且用户导入包保留（第 11 条）

工程脚本：

- [x] `scripts/visual-snapshot-electron.js` — 删 creative 页面配置（:45）、`captureCreativeReaderLayout`（:178、:255-280）；**本次无需更改公共组件像素基线**；创作截图已退出采集清单，Linux 采集结果和原生平台限制见下文
- [x] `scripts/visual-snapshot-preload.js` — 删 creative mock（选题 ：121-123、项目 ：127、`creative-writing` 技能 fixture :404、`creative/**` 权限 :454、`getAllCreativeTopics` :529 等）
- [x] `scripts/motion-contract-check.js` — 删 `creative-item-row`、`creative-tab` 动效契约（:122）
- [x] `scripts/audit-evidence.js` — 删 CreativePage 行数预算与模块存在性检查（:42-43）
- [x] `scripts/ai-context-performance.js` + `ai-context-performance-electron.js` + `scripts/fixtures/ai-context-performance/fixture.tsx` — 移除 CreativePage 分片基准（:7、:24、:27）
- [x] `scripts/input-controls-style.js` — 删 `.creative-workspace` 探针选择器（:25）
- [x] `scripts/package-safety-scan.js` — 保留对旧 `creative/` 用户内容误打包的禁止规则（:61）；功能下线不等于历史内容可以进入安装包
- [x] `scripts/integration-smoke.js` — 核对 creative 引用

文档：

- [x] 更新提及创作模式的文档：`RELEASE_CHECKLIST.md`、`PERFORMANCE_CHECKLIST.md`、`VISUAL_AUDIT_CHECKLIST.md`、`PROJECT_MANAGEMENT_AND_CREATION_PLAN.md`、`docs/adr/ADR-002-openmind-layout-contract.md` 等
- [x] 本文档在第 10 条完成后更新数据策略结论

## 实现核对与数据策略结论（2026-11-06）

| 范围 | 当前实现与回归证据 |
| --- | --- |
| 公共编辑器 | `features/document-editor/` 保留 Milkdown、工具栏、查找替换、大纲、块菜单及局部 AI 改写；项目成品编辑和 AI 文件预览均引用新目录。`milkdown-runtime.test.ts`、`DocumentToolbar.test.tsx`、`InlineAiBar.test.tsx` 覆盖真实编辑运行时和交互；页面测试覆盖加载、编辑、保存和未保存保护。 |
| 页面与接口 | 创作页、导航/路由、14 个 IPC、服务注入、工作流偏好和中英文专用文案均已清理。`App.test.tsx` 验证入口消失及项目会话隔离；`ipc-handlers.test.ts` 保留现存接口约束。 |
| 索引与原始文件 | 主进程和 worker 使用相同内容扫描语义；旧 `content-index.json` 项被过滤并写回派生索引。普通文件搜索/预览仍能访问旧路径。`content-index.test.ts`、`content-source.test.ts` 及退役升级测试验证中文文稿、版本、二进制素材、发布记录、Skill 运行数据在重复升级后逐字节不变。 |
| 历史会话 | `shared/legacy-creative.ts` 在 schema 输入层归一化旧 origin 和 contexts；原始文本、标签、运行和消息保留。`session-store.test.ts` 覆盖重载、分支、重试与幂等；`App.session-origin.test.tsx` 覆盖恢复实际文件路径，以及文件不存在时仍保留会话并显示缺失提示。 |
| Skill 退役 | 按内置来源、publisher 和 locator 识别五个退役包；目录/Git/ZIP 导入及显式保留副本不受影响。包文件保留，旧会话快照只能用于历史展示，新准入重新校验。`retired-skills.test.ts` 覆盖重复启动、列表、Broker、Provider Bridge、依赖 Workflow 与来源区分。 |
| 调度与进行中任务 | `AutomationRepository.retireRules()` 停用受影响规则并结束未准入队列；scheduler 对已准入任务保留 childRunId、跟踪实际终态且不重试。`automation-scheduler.test.ts` 覆盖成功/失败终态、排队重试和重复检查。Workflow 已准入步骤继续按原 version/digest 校验。 |
| 保留能力 | 每日总结、每日选题、RSS、项目成品编辑与公众号导出保留；冻结的目录契约 v1–v4 未修改。旧列表宽度键和通用保存偏好只做兼容读取，不恢复创作生产链。 |

`openmindRoot/creative/` 已降级为普通用户内容目录。此次实施不自动迁移、重命名或删除其中的文稿、历史版本、素材和发布记录，也不删除已安装退役包及其 `.agent/skill-data/`。所有验证使用临时数据根和临时 userData，没有读取开发者真实内容库。

本次收尾另删除了 `installed-skill-execution-resolver.test.ts` 中仍尝试执行已退出分发的三个创作包的过期测试；有效 RSS/每日简报执行测试继续运行。会话导航测试使用阅读器 fixture 验证路径和恢复行为，共用编辑器本身由独立 Milkdown 行为测试验证，避免导航 fixture 卸载后遗留第三方编辑器定时器。

工程演练同步修正两处旧假设：恢复演练先验证不会回收存活 owner 的任务，再用临时记录模拟已退出 owner；视觉脚本显式选择待审批历史会话，并在审批完成后验证 idle 状态，避免把「新建任务」误当成原历史会话。

组件评审发现的 P2 已修复：退役判定按安装 key 缓存依赖列表，用 version、digest、packagePath 和 installedAt 区分安装身份；身份变化时重新检查，卸载后清理对应缓存。同轮巡检对重复目标去重。来源和用户保留标记每次重新判定，完整包体校验仍在首次建立依赖缓存和真实执行准入时进行，缓存不授予执行权限。

## 创作模式收尾阶段验收记录

- 定向回归：83 项通过，覆盖自动化、退役 Skill、实际保留 Skill 执行和历史会话导航。
- P2 修复追加验证：退役、自动化、执行解析与包服务共 105 项相关回归通过，类型检查及 Electron 构建通过。新增回归覆盖禁用规则去重、跨轮缓存、外部服务替换/重装、来源及用户保留变化，以及缓存后仍拒绝保持相同文件大小/时间戳的包篡改。
- P2 隔离性能复测：8 条禁用规则引用同一个约 16 MiB 的普通 Process 包，并保留一个退役内置包。修复前每轮整包检查 8 次、耗时 298–540 ms；修复后首次检查 1 次，后续三轮检查 0 次，耗时分别 2.09、1.13、0.71 ms。该数据仅代表本机临时夹具，不是端到端产品延迟。日志：`/tmp/openmind-retirement-cache-benchmark.log`。
- 完整构建（含类型、样式和 UI 契约）通过；256 个单元测试文件通过，2956 项通过、3 项平台跳过；临时内容库集成测试、真实 Electron E2E 通过。修正演练 fixture 后，恢复演练及独立进程崩溃恢复检查均通过。
- 继续逐项执行聚合命令中未运行的检查：规模、运行时、稳定性、动效、字体、对比度和各报告格式/证据契约通过。报告生成成功只证明报告可生成；Provider 实测、安全评审、干净机器安装与发布就绪报告仍为 `manual-required`，不算实测通过。
- `npm run visual:ui -- --capture-only`：Linux arm64 下完成浅/深色、720/1280 宽度共 128 张截图及 64 项几何检查，0 项失败；已抽查导航控件和新任务页面截图。此结果是采集/几何验证，不是像素基线比较。
- 补充使用临时 userData/Xvfb 执行应用视觉尾部场景：13 项状态截图及语义/几何检查通过，覆盖每日简报深色、历史响应、审批、上下文、Skill/文件菜单和 onboarding；已查看审批及文件上下文截图。报告为 `.build/visual-snapshot-tail-report.json`，不代替目标平台像素比较。
- 公共控件绘制和已审查的 Windows 基线未修改。本仓库将原生视觉门禁限制在 Windows/macOS；Linux 上 `visual:snapshot`、`visual:inputs`、`visual:ui` 正式比较会明确跳过。本次不宣称 Windows/macOS 原生像素回归已通过。

创作模式收尾时 `npm run verify` 尚未通过，下表保留当时失败项及后续处理状态；未重新验证的检查不据后续局部测试宣称通过。没有提高预算、放宽内容保护规则或改写像素基线来消除失败：

| 检查 | 当前结果与边界 |
| --- | --- |
| `perf:check` | `document.worker-CbrHJK9M.js` 为 1042.8 KiB，超出 1024 KiB；`index-CbqBLwMz.js` 为 582.2 KiB，超出 500 KiB。本次补齐前后的构建产物哈希及大小一致。 |
| `perf:stream` | 后续列表性能修复已更新历史翻页和展开 fixture。生产模式构建复测通过：1000 事件，commentary/artifact/reasoning 夹具分别配置为 49,152/102,400/24,576 字符，P95 帧间隔为 16.7–16.8 ms，各阶段均无 Long Task。此结果关闭原 fixture 失败，不代表聚合 `verify` 已通过。 |
| `audit:evidence` | 三项失败：反馈检查仍查旧 `ai-context.tsx`，路径检查仍查旧 `assertInsideProject` 名称；scheduler 为 556 行，超过 460 行预算（HEAD 为 559 行）。前两项实际实现分别位于 `feedback-context.tsx` 与 `resolvePathInsideRoot`，相关功能单测通过；审计脚本和行数预算尚待单独修正。 |
| `package:safety` | 两个保留 Skill（`daily-article-summarizer`、`rss-article-saver`）的 `.env.example` 被禁止路径规则命中。对应包源与构建/扫描脚本未修改；本次保留检查失败，不将示例文件直接加入放行名单。 |

验证日志保存在当前工作机 `/tmp/openmind-creative-removal-verify-final.log`、`/tmp/openmind-creative-removal-verify-remainder.log`、`/tmp/openmind-creative-removal-verify-tail.log`；这些是本次执行产物，不随源码提交。

## 验证

每个可独立编译的阶段连同引用方、测试、mock、样式/文案一起完成后运行类型检查，再运行该阶段相关的行为测试。遇到跨层类型/接口变更时合并为一个可编译阶段，不以故意悬空引用的中间状态作为验收点：

```bash
npm run typecheck
```

全部完成后运行完整聚合验证；`verify` 已包含 build、单元/集成/E2E、UI 和视觉等检查，下列子命令用于阶段验证或定位失败，已成功的检查只在后续变更影响它时重跑：

```bash
npm run verify      # 含 build + audit:styles 等聚合校验
npm run test:unit
npm run test:integration
npm run test:e2e
npm run check:ui
npm run visual:ui   # 基线 diff 须人工逐张审查后显式更新
```

## 实施顺序（已完成）

1. 确认第 10、11 条的数据保留和 Skills 退役范围；不修改冻结 v1 契约，明确进行中任务及第三方包策略。
2. 完成第 1 条完整编辑器依赖链、公共样式/文案和测试迁移；验证项目编辑、AI 预览和局部改写。
3. 先实现第 5 条历史 origin/contexts 兼容和回归，再将第 2、3 条路由/专用页面移除与引用方/mock 修改作为同一阶段；保留项目会话隔离。
4. 将第 4、6、7 条搜索、内容源、后端和 IPC/类型清理按依赖组合为可编译阶段；同步修改服务构造、测试和浏览器预览 mock。
5. 完成第 8、9 条设置、专用样式和文案清理，以及第 10、11 条升级兼容、已安装包退役和调度器处理；各阶段同步测试。
6. 按第 12 条核对剩余脚本、夹具和文档，执行完整验证并记录结果；采集截图已抽查，原生像素差异验证尚待目标平台执行。保留未通过项及平台限制，不将失败或跳过的检查记作通过。
