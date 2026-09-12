# Interface Review — 工作区未提交变更(UI 与交互)

- 审查日期:2026-09-12
- 审查方法:`interface-review`(范围解析/removed signals/状态分类)+ `better-interface`(严重度/合并/裁定)
- 结论:**Approve**(无 HIGH 级 Introduced/Regression;2 条 LOW 留作后续打磨)

## 范围块

| 字段 | 值 |
| --- | --- |
| 目标 | `working`(未提交的工作区变更) |
| 基准 | `origin/main` @ `b3ba3f5`(与 HEAD 一致,领先 0 个提交) |
| 提交 | 0 个已提交;51 个已跟踪文件修改(+1314/−837),14 个未跟踪条目(约 700 行) |
| 审查文件 | 64 个,其中接口相关的 renderer/shared/electron 全量精读 |
| 排除 | `scripts/*` 体积预算与性能脚本(开发工具,无用户面,仅略读)、`*.test.ts(x)`(作为意图证据)、`package.json`(脚本入口) |
| 扩展面 | 共享原语 `ai-context` 两跳扩展:grep 枚举全部约 25 个生产消费者;`typecheck` 验证未改动消费者(`route-registry.tsx`、`AutomationPage.tsx`、`use-topic-file-editor.ts`)编译与行为保持 |

### 变更主线

1. **AI Context 切片化**:`AiController` 拆为 Snapshot / Events / Ui / Actions 四个 Context,按变更频率分频订阅;消息行(`UserMessage`/`AssistantMessage`)memo 化——流式输出期间不再整页重渲染。
2. **主进程 worker 化 + 缓存**:`@` 文件搜索(openmind-file-search-engine + worker_threads)、内容索引(ContentIndexService/worker)、网页转换(web-worker)、文档转换扩展表前移;settings/preferences 按 mtime 指纹缓存;Skill 已装包检查按 lstat 签名缓存(执行准入仍全量哈希)。
3. **PDF 阅读器拖拽缩放**:分栏拖拽期间用 `transform: scale` 过渡跟手,停顿 140ms 后一次性真实缩放(`PDF_RESIZE_SETTLE_MS`)。
4. **每日简报最小宽度**:34rem → 40rem,主列先让宽,文档不再被压成不可读细条;`.document-library-page.brief-library-page` 双类选择器压过 workbuddy-refactor.css 的级联。
5. **IPC 通道搬家**:`PROJECT_IPC` 移入零依赖的 `ipc-channels.ts`,preload 不再拖入 Zod schema 表(perf:check 新增 64KiB preload 预算拦截回归)。

## 覆盖表

| 领域 | 检查的证据 | 结果 |
| --- | --- | --- |
| 交互/行为 | renderer 全部 diff、electron diff、11 个新增文件、removed lines 逐项核对 | 2 项 Introduced(见下) |
| 无障碍 | diff 中全部 aria-label/focus/role 行的 − 侧与 + 侧对照 | Clear(所有 aria 属性原样保留,无新增无名控件) |
| 布局/自适应 | daily-brief.css 地板变更及其 shell 联动 | Clear(注释完整的预期修复) |
| 文案 | 新增用户可见字符串(worker 错误信息、网页转换超时) | Clear(沿用现有中文错误文案风格) |
| 排版 / 色彩 | — | Not reviewed:变更范围内无证据 |
| 安全(点名一次) | web-extract 清洗器逐行比对旧实现 | 移除的 sanitizer(script/img/on*/srcset/链接白名单)在新文件中完整保留;Skill `usable` 展示缓存仅影响目录展示、执行准入仍全量哈希(有测试)。正确性/安全细节归项目常规代码评审 |

## 发现(Introduced / Regression)

| 严重度 | 领域 | 状态 | 位置 | 现状 | 建议 | 原因 |
| --- | --- | --- | --- | --- | --- | --- |
| LOW | UI | Introduced | `renderer/src/features/projects/PdfMaterialViewer.tsx:117-140` | 分栏拖拽期间 PDF 用 `transform: scale` 过渡跟手,停顿 140ms 后才做真实 `updateScale` + `viewer.update()` | 保持现方案,但落定回调对 `!finalWidth` 提前返回时同步清掉 transform 与 gestureZoom,避免零宽中断后残留缩放变量 | 手势期间页面是重采样位图(短暂发虚)、文本选中/命中与真实布局错位;非适配缩放(fit=false)下 `viewer.update()` 从每帧延迟到落定后,约 140ms 内布局不刷新。均为瞬态且是注释里明说的性能取舍。Not verified(未做渲染验证) |
| LOW | UI | Introduced | `electron/product/content-index.ts:26,72-75` | 全局搜索对每个日期逐次 stat 自检过期,外部改动立即出现在结果里 | 可接受;若要收紧,外部变更提示(如手动刷新入口)可绕过 30s TTL | 新增 30s 逐日期缓存(`SEARCH_DATE_REFRESH_INTERVAL_MS`):外部编辑的文件最迟 30s 后才进全局搜索;应用内写入仍经 `refreshDate` 即时刷新(`product-service.ts:128`)。注释已声明取舍 |

未发现任何 Regression。removed 信号逐项核对通过:

- 搜索评分/`IGNORED_DIRECTORIES`/`isSensitiveFile` 完整搬入 `electron/openmind-file-search-engine.ts`,并有 bounded top-K 与全量稳定排序的等价性测试;
- 消息行 memo 化未动任何 aria-label;
- FeedbackHost 确认框/Toast 的焦点管理与退场动画逻辑原样;
- `npm run typecheck`(两个 tsconfig)全绿,切片重构对全部消费者无破坏。

## Pre-existing(非本次变更责任)

| 严重度 | 领域 | 位置 | 问题 |
| --- | --- | --- | --- |
| MEDIUM | UI | `renderer/src/features/creative/use-topic-file-editor.ts:7` | 仍订阅完整 `useAi()` 控制器,而它被 CreativePage 使用——创意页在 InlineAiBar 流式输出期间依然每次 rAF flush 整页重渲染。这正是本次变更声称要消灭的模式("热表面订阅切片"),属未送达的意图;文件本身未被触及,行为与变更前相同。建议随手补上切片迁移(一行改动),让创意页也吃到本次性能重构的收益 |

### 正确性备注(归常规代码评审,不在接口裁定内)

- `renderer/src/features/settings/SettingsPage.tsx` 的 `loadProvidersYaml` 依赖数组仍是 `[ai]` 而回调已改用 `ui.notify`——今日无行为影响(`notify` 为空依赖稳定回调),但依赖数组与实际引用已脱节。
- `electron/project/converters/web-converter.ts` worker 超时/退出路径存在 reject-after-resolve 的无害 no-op。

## 验证

**已做**:

- `npm run typecheck` 通过(`tsconfig.json` + `tsconfig.electron.json`),验证切片重构对全部消费者无破坏;
- diff 的 − 侧逐 hunk 核对:a11y 属性、网页清洗器、搜索评分逻辑、目录/敏感文件过滤均无丢失;
- 新增 worker 门面(`content-index-service.ts`、`openmind-file-search.ts`)的 init 保序、进程内兜底、dispose/根切换释放路径走读。

**Not verified**:

- PDF 拖拽手势的视觉效果(发虚/命中偏移为源码推断,无廉价预览路径);
- worker 模式下全局搜索的实际新鲜度窗口。

## 裁定

**Approve** — 无 HIGH 级 Introduced/Regression。两条 LOW 留在表中作为后续打磨项;`use-topic-file-editor.ts` 的切片迁移建议随手补上(一行改动),可让创意页也吃到本次性能重构的收益。
