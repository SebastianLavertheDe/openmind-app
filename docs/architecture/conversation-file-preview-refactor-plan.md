# AI 会话与文件预览重构方案

- **状态：** Implemented（已实施；仓库级既有门禁问题见第 22 节）
- **日期：** 2026-09-14
- **范围：** Renderer 中的 AI 会话界面，以及文件预览、编辑和视频预览场景
- **首要约束：** 不扩大现有内容目录、Project、IPC 和远程媒体安全边界

## 1. 结论摘要

本方案采用“统一核心能力，保留业务外壳”的设计：

1. AI 会话继续保持一套 `Chat` 核心，不合并 `AiSidebar` 与 `AiWorkbench`。
2. 文件侧新增无 UI 的状态控制器，统一加载、编辑、保存、脏数据保护和异步竞争处理。
3. 文件内容先归一化成带语义类型的 `PreviewResource`，再分别交给文档、PDF、视频等专业渲染器。
4. Daily Brief、Creative、Project 等页面继续保留自己的列表、业务状态、工具栏和响应式布局。
5. Project 视频从 AI 消息引用打开时，也应进入视频渲染器，不再因为文件名是 `.video.md` 就显示成普通 Markdown。
6. 首轮不增加任意远程 MP4、WebM、HLS 的应用内播放；直链继续通过系统浏览器打开。
7. 不新增 `readAnyFile` 一类宽权限 IPC，统一发生在 Renderer 领域层，现有文件和 Project 访问边界保持不变。

这不是要实现一个带大量开关的 `UniversalFileViewer`，而是建立一套可组合的公共生命周期和类型安全的渲染边界。

## 2. 背景与当前实现

当前应用在多个位置提供 AI 会话或文件内容：

- 独立 AI 工作台；
- Project Task 会话；
- Creative、Daily Brief、Projects 右侧的 AI Companion；
- 全局 Workspace 文件预览；
- Daily Brief 文件详情；
- Creative 主题文件与文章草稿；
- Project 资料与 Project 成品文档。

### 2.1 AI 会话现状

AI 会话已经具备较好的复用基础：

- 完整工作台和紧凑侧栏最终都渲染
  `renderer/src/features/ai-console/Chat.tsx`；
- 消息、事件、流式状态、审批和 Composer 使用同一套 AI Context；
- `AiWorkbench` 和 `AiSidebar` 的差异主要是布局、尺寸、焦点、历史入口和 Project Task 创建方式。

因此 AI 会话不适合重新实现一套抽象，只需要进一步收敛职责边界。

### 2.2 文件预览现状

文件显示只完成了底层渲染复用：

- 文本、Markdown、HTML 最终使用 `ContentPreview`、`MarkdownReader`、`DocumentReader`；
- PDF 使用 `PdfMaterialViewer`；
- Markdown 编辑使用 `MarkdownEditor`。

但以下逻辑仍由各页面分别维护：

- `loading/error`；
- `preview/edit`；
- `draft/dirty`；
- 保存中、保存成功和保存失败；
- 切换文件与关闭时的未保存确认；
- 只读、截断内容和可编辑能力判断；
- 旧异步请求晚于新请求完成时的状态覆盖；
- PDF、文本、视频等类型分流。

这部分是真正需要统一的工程重复。

### 2.3 视频现状

视频目前属于 Project Material 的特殊路径：

1. `VideoProjectMaterialConverter` 识别 YouTube，以及 HTTPS MP4、WebM、HLS URL。
2. 应用不下载视频文件，而是生成 `materials/videos/*.video.md`。
3. `.video.md` 保存视频元数据、原始 URL、时长和时间戳字幕。
4. `ProjectMaterialService.read()` 重新解析 Markdown，返回结构化 `video` 数据。
5. Project Files 根据 `material.kind === "video"` 渲染播放器和字幕。
6. 普通文件预览只看到 `.md` 后缀，因此会把同一视频资料显示成 Markdown。

当前内嵌播放只真正支持经过校验的 YouTube `youtube-nocookie.com` iframe。
直链 MP4、WebM、HLS 虽然能作为资料导入，但目前没有应用内播放器，会回退到系统浏览器。
本地二进制视频文件也没有通用预览能力。

## 3. 要解决的问题

### 3.1 职责过度集中

`AiWorkbench` 同时负责：

- 完整会话外壳；
- 会话历史入口；
- 文件路径解析；
- 文件读取和保存；
- PDF 原件加载；
- 编辑状态与脏数据确认；
- 文件/会话分栏和响应式状态。

修改文件预览时容易影响会话与响应式布局，修改会话时也容易触及文件逻辑。

### 3.2 页面重复维护状态

Daily Brief、Creative Topic File、AI Workbench、Project Output 都有相似的
`draft/dirty/saving/mode/error` 状态，但细节不同。最危险的差异是保存期间继续输入：

- `ProjectOutputsPanel` 已用编辑版本和串行保存避免丢失新输入；
- Daily Brief 与 Creative 的简单保存流程可能在旧保存完成时覆盖更新后的本地状态。

共享控制器应以更严格的 Project Output 行为为基准。

### 3.3 语义类型被文件扩展名覆盖

Project 视频的物理载体是 Markdown，但产品语义是视频。如果预览系统只根据
`.md` 选渲染器，同一资源在不同入口会得到不同展示。

### 3.4 存在过度抽象风险

如果把所有差异塞进一个组件，会快速出现大量参数：

```text
projectMode
embedded
readOnly
showTranscript
allowEdit
showMaterialStatus
showOpenExternal
showHistory
```

这种组件会把业务边界重新耦合起来，不能作为目标架构。

## 4. 设计目标

- 消息历史、流式输出、工具调用、审批和 Composer 只有一套实现。
- 同一个语义资源在所有支持的入口选择同一个内容渲染器。
- 文件加载、请求失效、编辑、保存、脏数据保护和只读规则集中维护。
- Renderer 的文件系统与 Project 访问继续经过 typed preload IPC。
- 增加新文件类型时，主要新增资源类型、渲染器和测试，而不是修改每个业务页面。
- 保留当前响应式、可访问性、流式性能和文档性能基线。
- 支持逐场景迁移，每个阶段都可独立验证和回退。

## 5. 非目标

首轮改造明确不做：

- 不把 `AiSidebar` 和 `AiWorkbench` 合成一个布局组件；
- 不合并 Daily Brief、Creative、Projects 等业务页面；
- 不修改 AI Provider 协议、AI 事件存储或会话持久化；
- 不改变 Project Material 转换流程和 `.video.md` 持久化格式；
- 不增加本地视频文件导入；
- 不增加任意远程 MP4、WebM、HLS 的应用内播放；
- 不放宽 Renderer CSP；
- 不创建绕过现有目录或 Project 归属校验的统一文件读取 IPC。

## 6. 设计原则

### 6.1 共享稳定规则，不共享偶然相似的页面结构

会话事件模型和文件生命周期属于稳定规则，应当复用。页面标题、列表、Project
转换状态、Task 创建和响应式摆放属于业务场景，应当继续独立。

### 6.2 组合优于万能组件

页面组合 Controller、Source 和 Renderer，而不是把所有业务差异变成一个组件的布尔参数。

### 6.3 依赖倒置

公共预览层依赖小型 `FilePreviewSource` 接口，不直接 import `projectsApi`，也不直接调用
`window.openmind`。具体业务模块通过适配器实现数据访问。

### 6.4 接口隔离

只读资料不需要伪造 `save()`；PDF 和视频也不必实现文本编辑接口。可用能力由 Source
和 Resource 共同决定。

### 6.5 语义优先于后缀

普通 Workspace 文件可以用扩展名推断类型。Project Material 已有权威 `kind`，必须优先
使用业务语义，不能因为 `.video.md` 就退化为普通 Markdown。

### 6.6 显式状态转换

使用 reducer/state machine 表达生命周期，避免多个 boolean 组成无效状态。

## 7. 目标架构

```text
业务场景外壳
  - AI Workbench
  - Workspace Overlay
  - Daily Brief Detail
  - Creative Detail
  - Project File Detail
          |
          v
useFilePreviewController
  - 加载与旧请求失效
  - preview/edit 模式
  - draft/dirty/editRevision
  - 保存串行化
  - 关闭/切换确认
  - readOnly/truncated 校验
          |
          +--> FilePreviewSource
          |      - Workspace Content
          |      - Project Output
          |      - Project Material
          |
          +--> PreviewRenderer
                 - DocumentPreview
                 - PdfPreview
                 - VideoPreview
                 - UnsupportedPreview
```

统一点位于 Renderer 领域层，不等于统一底层存储或扩大 IPC 权限。

## 8. 资源模型

`PreviewResource` 是 Renderer 内部的判别联合。只有真正跨进程的数据结构才放入
`shared/` 并使用现有 Schema 约束。

```ts
type PreviewResource =
  | {
      kind: "document";
      record: ContentRecord;
    }
  | {
      kind: "pdf";
      title: string;
      data: Uint8Array;
    }
  | {
      kind: "video";
      title: string;
      playback: VideoPlayback;
      transcript: TranscriptSegment[];
      durationMs?: number;
    }
  | {
      kind: "unsupported";
      title: string;
      reason: string;
    };

type VideoPlayback =
  | {
      kind: "trusted-youtube";
      embedUrl: string;
      videoId: string;
    }
  | {
      kind: "external-only";
      sourceUrl: string;
    };
```

`PreviewRenderer` 使用穷尽 `switch` 或类型安全 Registry。增加新的 `kind` 后，如果没有
对应 Renderer，TypeScript 必须在编译期报错。

## 9. 数据源接口

```ts
type PreviewSaveInput = {
  content: string;
  title?: string;
};

interface FilePreviewSource {
  readonly id: string;
  load(signal?: AbortSignal): Promise<PreviewResource>;
  save?(input: PreviewSaveInput): Promise<PreviewResource>;
  openExternal?(): Promise<void>;
}
```

建议实现以下适配器：

- `WorkspaceContentSource`：封装 `readContent/writeContent`；
- `WorkspaceReadOnlySource`：只封装 `readContent`；
- `ProjectOutputSource`：封装 `readProjectOutput/saveProjectOutput`；
- `ProjectMaterialSource`：封装 `readProjectMaterial`，以及 PDF 原件的
  `readProjectMaterialOriginal`。

适配器放在拥有对应 API 边界的 Feature 内。通用预览模块只拥有接口和归一化资源模型，
不能反向依赖 Project Feature。

`AbortSignal` 用于 Renderer 侧主动失效；如果底层 IPC 暂时不能真正取消，Controller 仍要通过
`requestId` 阻止旧结果写回当前状态。

## 10. 文件预览状态机

```text
closed
  -> loading(resourceId, requestId)
      -> ready.preview(resource, persistedContent)
      -> error(resourceId, message)

ready.preview
  <-> ready.edit(draft, editRevision, dirty)
      -> saving(savedRevision)
          -> ready.preview / ready.edit
          -> error，并保留当前 draft
```

必须满足以下规则：

- 打开 B 后，A 的未完成读取不得覆盖 B；
- 关闭或切换 dirty 文档必须确认；
- 保存完成时，只有捕获的 `editRevision` 仍是最新版本才可以清除 dirty；
- 保存过程中发生的新编辑必须继续保持 dirty，并进入下一次串行保存；
- 保存失败不得丢弃 draft；
- truncated 或 Source 没有 `save()` 时不得进入编辑模式；
- 组件卸载后，异步回调不得更新状态；
- Project Task 的只读预览不得静默回退成 Workspace 可编辑文件。

## 11. AI 会话设计

### 11.1 保留共享 Chat Core

`renderer/src/features/ai-console/Chat.tsx` 继续作为唯一会话核心，负责：

- 时间线选择与归组；
- 流式和已完成事件；
- Tool、Reasoning、Plan、Change、Approval；
- 滚动恢复与历史加载；
- Composer 与上下文输入。

现有流式订阅、DOM 数量和 Markdown 节流优化属于本次必须保持的性能约束，不是重写目标。

### 11.2 保留不同展示外壳

- `AiSidebar`：负责 companion 的收起、宽屏、全屏、浮层、尺寸和焦点；
- `AiWorkbench`：负责完整会话页面、会话标题和历史入口；
- Project Task 页面：负责 Project 选择、Task 创建和 Session 激活。

`AiWorkbench` 目标结构：

```text
AiWorkbench
  - ConversationPane
      - ConversationHeader
      - Chat
  - AiFilePreviewPane
      - useFilePreviewController
      - PreviewRenderer
```

文件逻辑拆出后，将可产生非法组合的 `projectMode + projectName` 改为判别联合：

```ts
type ConversationSurface =
  | { kind: "workspace" }
  | { kind: "project-task"; projectName: string };
```

### 11.3 Composer 所有权

Projects 路由可能同时存在 Project Task Workbench 和 AI Companion。页面层必须明确当前
活动 Session 由哪个 Surface 提供可交互 Composer。

除非产品明确要求“双输入框同步编辑”，否则同一个活动 Session 同一时刻最多只能有一个
可见、可提交的 Composer。

## 12. 内容渲染器

### 12.1 DocumentPreview

继续复用：

- `ContentPreview`；
- `MarkdownReader`；
- `DocumentReader`；
- sandbox HTML iframe；
- `MarkdownEditor`。

Renderer 不负责读取和保存，只接收已经加载的 Resource/Draft 并上报编辑内容。

### 12.2 PdfPreview

继续使用 `PdfMaterialViewer`，保留搜索、缩放、页码和错误处理。二进制加载由 Source 完成。
首轮 PDF 保持只读。

### 12.3 VideoPreview

从 `ProjectMaterialsPanel.VideoMaterialDetail` 提取以下公共能力：

- 播放器与字幕的响应式布局；
- 当前播放时间；
- 活动字幕高亮；
- 点击时间戳跳转；
- 无字幕空态；
- 无法内嵌时的外部打开兜底。

Project Material 页面继续负责：

- importing/converting/ready/failed；
- 转换失败与重试；
- Material 元数据；
- Project 文件列表和选择。

首轮播放能力：

| 视频类型 | 行为 |
|---|---|
| 合法 YouTube Material | 内嵌 `youtube-nocookie.com` iframe，并显示字幕 |
| 非法或不可信 YouTube 元数据 | Fail closed，仅允许外部打开 |
| HTTPS MP4/WebM/HLS Material | 仅外部打开 |
| 本地二进制视频 | 明确提示当前不支持 |

即使 Main 已产生 Descriptor，Renderer 仍须再次校验：

- `https:`；
- hostname 必须是 `www.youtube-nocookie.com`；
- pathname 必须与 11 位 `videoId` 完全一致；
- `enablejsapi=1`；
- `postMessage` 的 `event.origin` 和 `event.source`。

## 13. 未来的直链视频内嵌

MP4、WebM、HLS 应用内播放必须作为独立功能评审，不能通过放宽 CSP 或将持久化 URL
直接赋给 `<video src>` 实现。

未来方案应由 Main 提供受控媒体桥或自定义 App Protocol，并至少具备：

- HTTPS 公网 URL 和每次重定向重新校验；
- DNS 与私网地址防护；
- HTTP Range，避免完整下载大文件；
- MIME、响应体积和超时限制；
- 不转发 Cookie、Authorization 等用户凭证；
- 请求取消与并发限制；
- HLS 显式支持，不能假设 Chromium 原生支持；
- 独立威胁模型和打包环境验证。

## 14. 场景映射

| 场景 | Source | Renderer | 场景自身保留的职责 |
|---|---|---|---|
| 独立 AI Workbench | Workspace Content | Document/PDF/Unsupported | 会话、历史、分栏 |
| Project Task Workbench | Project Material/Output | Document/PDF/Video | Project Scope、只读边界 |
| 全局 Workspace Preview | Workspace ReadOnly | Document | Overlay/Embedded、打开原路径 |
| Daily Brief Detail | Workspace Content | Document | Summary 列表、日期、文件操作 |
| Creative Topic File | Workspace Content | Document | Topic 选择、Creative 工作流 |
| Creative Article Draft | Feature Draft | Document | 发布、导出、Inline AI |
| Project Output | Project Output | Document | Output 列表、标题、来源 Task |
| Project Document/Web Material | Project Material | Document/PDF | 转换状态、重试、查看模式 |
| Project Video Material | Project Material | Video | 转换状态、Material 元数据 |

## 15. 建议代码结构

```text
renderer/src/features/file-preview/
  model.ts
  file-preview-state.ts
  file-preview-state.test.ts
  use-file-preview-controller.ts
  use-file-preview-controller.test.tsx
  PreviewRenderer.tsx
  PreviewRenderer.test.tsx
  renderers/
    DocumentPreview.tsx
    PdfPreview.tsx
    VideoPreview.tsx
    VideoPreview.test.tsx
    UnsupportedPreview.tsx

renderer/src/features/ai-console/
  AiWorkbench.tsx
  AiFilePreviewPane.tsx
  workspace-preview-source.ts
  project-preview-source.ts

renderer/src/features/projects/
  project-material-preview-source.ts
  project-output-preview-source.ts
  ProjectMaterialsPanel.tsx
  ProjectOutputsPanel.tsx

renderer/src/components/
  ContentPreview.tsx
  MarkdownReader.tsx
  document/

shared/
  project-contracts.ts
  # 只有真正跨进程的 Schema/Type 才放这里
```

依赖方向必须保持为：

```text
Business Feature -> Preview Core Interface
Business Adapter -> Typed Preload API
Preview Core -X-> projectsApi / window.openmind
```

实际文件名可以在开发时调整，但依赖方向不能反转。

## 16. 分阶段实施计划

### Phase 0：行为基线与边界测试

- 记录每个 Preview Surface 的当前行为；
- 增加 A 未加载完成时打开 B 的竞争测试；
- 增加 dirty 关闭/切换、保存时继续输入、只读和 truncated 测试；
- 锁定 YouTube URL 校验、字幕跳转、直链兜底和视频响应式布局；
- 记录现有 Chat Streaming、Document 和 Resize 性能基线。

**交付物：** 仅增加测试，不改变生产行为。

### Phase 1：提取语义 Renderer

- 增加 `PreviewResource` 和穷尽 `PreviewRenderer`；
- 包装现有 Document/PDF 组件，不重写底层阅读器；
- 从 Project Material 中提取 `VideoPreview`；
- 页面暂时继续维护自己的加载和保存状态。

**交付物：** 一套共享 Renderer，用户体验不变。

### Phase 2：实现 File Preview Controller

- 实现 reducer 和无 UI Controller；
- 实现 Workspace Editable/ReadOnly Source；
- 依次迁移：
  1. `WorkspaceFilePreview`；
  2. Daily Brief 文件详情；
  3. Creative Topic File；
- 每个场景通过行为对比测试后，再删除旧状态代码。

**交付物：** 最相似的 Workspace Content 场景共用一套生命周期。

### Phase 3：拆分 AI Workbench

- 从 `AiWorkbench` 提取 `AiFilePreviewPane`；
- 路径解析、读取、保存全部进入 Source；
- 保留分栏、Preview-only、比例持久化、焦点恢复、PDF 和 Project 只读行为；
- 引入 `ConversationSurface` 判别联合；
- 明确同一活动 Session 的 Composer 所有权。

**交付物：** `AiWorkbench` 只协调会话和文件 Pane，不再混合底层文件生命周期。

### Phase 4：迁移 Project Output 与 Material

- 迁移 Project Output，同时保留编辑版本和串行保存能力；
- Project Document/PDF 接入公共 Renderer；
- Project Video 接入 `VideoPreview`；
- Material 转换、失败、重试继续留在 Project Feature。

**交付物：** Project Files 使用公共预览生命周期和专业 Renderer。

### Phase 5：统一 Project AI 视频引用

- Project AI 点击 `.video.md` 时，通过 `ProjectMaterialSource` 解析；
- 返回 `PreviewResource(kind="video")` 并进入 `VideoPreview`；
- 非 Project 的普通 `.video.md` 仍按 Markdown 处理，除非存在权威业务元数据；
- 原始 MP4/WebM 等二进制引用返回明确的不支持提示。

**交付物：** 同一 Project 视频从 Project Files 和 AI 消息打开时展示一致。

### Phase 6：清理与最终门禁

- 删除已经迁移的页面级重复生命周期代码；
- 确认只有 Source Adapter 直接调用文件/Project 读写 IPC；
- 完整执行功能、视觉、性能和安全验证；
- 实现稳定后，将本文状态更新为 Accepted，或提炼成正式 ADR。

## 17. 测试矩阵

### 17.1 Controller 单元测试

- Load 成功、失败、重试；
- 打开新文件后旧 Load 才完成；
- dirty 关闭/切换的确认和取消；
- Save 成功和失败；
- Save 期间继续编辑；
- Load/Save 期间卸载；
- ReadOnly/Truncated 禁止编辑。

### 17.2 Source Contract 测试

- Workspace Path 不得越过选中的 `openmindRoot`；
- Project Material/Output 不得越过所属 Project；
- Project Task Preview 不得回退为任意 Workspace 可编辑文件；
- PDF Original 必须通过 Material Record 获取，不能信任任意路径；
- Source 错误不得导致当前用户 Draft 丢失。

### 17.3 Renderer 测试

- Markdown、Plain Text、Sandbox HTML；
- PDF Load/Error/Fallback；
- 合法 YouTube Embed；
- 非法协议、Host、Video ID、Path、Query 被拒绝；
- `postMessage` Origin/Source 校验；
- 字幕 Seek 和 Active Cue；
- Direct Media 和 Binary Unsupported Fallback。

### 17.4 Surface 集成测试

- Standalone AI 文件分栏；
- Project Task 只读文件分栏；
- Global/Embedded Workspace Preview；
- Daily Brief Edit/Save/Switch；
- Creative Topic Edit/Save/Switch；
- Project Output 保存期间继续输入；
- Project Document/PDF/Video；
- 从 Project AI 消息打开 Video Material。

### 17.5 验证命令

开发阶段先运行聚焦 Vitest，阶段完成后运行：

```bash
npm run typecheck
npm run test:unit
npm run build
npm run perf:documents
npm run perf:stream
npm run perf:resize
npm run visual:snapshot
```

最终集成门禁运行：

```bash
npm run verify
```

## 18. 验收标准

全部满足才视为完成：

1. 所有 AI 会话 Surface 继续渲染同一个 `Chat` Core；
2. `AiWorkbench` 不再拥有底层文件读取、保存和状态机实现；
3. 已迁移页面不再分别实现 Load/Save/Dirty/Request Versioning；
4. Project Video 从 Project Files 或 Project AI 消息打开时使用同一个 `VideoPreview`；
5. YouTube 字幕跳转和 Active Cue 保持工作；
6. 首轮 Direct MP4/WebM/HLS 明确保持 External-only；
7. ReadOnly、Truncated、Save Failure 和 Save-during-edit 不会丢失用户数据；
8. Preview 重构没有扩大文件、Project、Frame 或 Remote Media 权限；
9. Responsive、Visual、Chat Streaming 和 Document Performance 门禁通过；
10. 新增 Preview 类型时，不需要在每个业务页面重复增加类型分支。

## 19. 风险与缓解

| 风险 | 缓解方式 |
|---|---|
| 异步保存导致用户输入丢失 | Local Edit Revision + 串行 Save |
| 旧读取覆盖新选中文件 | Request ID + Abort/Invalidation |
| Project 路径边界被统一接口扩大 | 保留业务 Typed API，并增加 Adapter Contract Test |
| 任意 iframe/media URL 进入 Renderer | Main 归一化 + Renderer Allowlist + CSP |
| 大规模改造造成回归 | 一次迁移一个 Surface，通过后才删除旧逻辑 |
| 公共组件出现大量业务 Boolean | Headless Controller + Resource Union + Feature Shell |
| Chat Streaming 性能下降 | Chat Core 不重写，并复跑 Streaming Gate |
| Resize/Focus 行为下降 | 保留 Container-derived Layout，并增加边界和焦点测试 |

## 20. 工作量预估

按一名熟悉当前仓库的工程师估算，不包含 Direct Media 内嵌播放：

| 工作项 | 粗略工期 |
|---|---:|
| 行为测试和资源模型 | 1–1.5 天 |
| Renderer 提取 | 1–1.5 天 |
| Controller 与 Workspace 场景迁移 | 2 天 |
| AI Workbench 拆分 | 1.5–2 天 |
| Project Output/Material/Video 迁移 | 2–2.5 天 |
| 最终视觉、性能和安全回归 | 1–1.5 天 |
| **合计** | **约 8–11 天** |

安全的 Direct MP4/WebM/HLS Media Bridge 需要单独 Spike，建议额外预留 3–5 天；HLS、
Range Request 和 Packaged App 行为是不确定性最高的部分。

## 21. 推荐交付方式

建议拆成四个可独立 Review 的变更，而不是一次大提交：

1. 行为测试、Resource Model 和 Renderer；
2. Controller 和 Workspace Content 场景；
3. AI Workbench 拆分与 Composer 所有权；
4. Project Output/Material/Video 迁移和最终门禁。

每个变更默认保持用户可见行为不变。Direct Media 内嵌播放继续作为后续单独评审、单独授权的功能。

## 22. 实施结果

本方案已于 2026-09-14 完成生产代码迁移。实现遵循“统一核心能力、保留业务外壳”，没有新增跨进程协议，也没有放宽文件、Project、iframe 或远程媒体边界。

### 22.1 阶段完成情况

| 阶段 | 实施结果 |
|---|---|
| Phase 0 | 增加 Load Race、Dirty、Save-during-edit、只读、截断、卸载、Project 越界、视频安全和 Surface 集成回归测试 |
| Phase 1 | 落地 `PreviewResource` 判别联合及 Document/PDF/Video/Unsupported 穷尽渲染；PDF 与视频保持按需加载 |
| Phase 2 | 落地 reducer + `useFilePreviewController` + Workspace Source，并迁移 Workspace Preview、Daily Brief、Creative Topic File |
| Phase 3 | 从 `AiWorkbench` 提取 `AiFilePreviewPane`，引入 `ConversationSurface`，保留分栏、焦点、比例持久化与路径恢复 |
| Phase 4 | Project Output、Document、PDF、Video Material 接入共享 Controller/Renderer；转换、失败与重试仍归 Project Feature |
| Phase 5 | Project AI 的 `.video.md` 先经 Project Material 语义解析，再进入共享 `VideoPreview`；普通 Workspace Markdown 行为不变 |
| Phase 6 | 删除已迁移页面的重复生命周期代码，收口读写调用，完成专项功能、视觉、性能及安全边界验证 |

### 22.2 最终代码边界

- `renderer/src/features/file-preview/` 只拥有资源模型、状态机、Headless Controller、Workspace Adapter 和专业 Renderer。
- `renderer/src/features/ai-console/project-preview-source.ts` 与 Project Feature 下的两个 Adapter 继续通过既有 typed Project API 读取资料、PDF 原件和产物。
- Project Task 的文件引用只接受当前 Project 内的相对路径或完整逻辑路径。任意其他 `openmind/...`、盘符绝对路径和 UNC 路径即使可能通过 Workspace `readContent` 读取，也会在调用 IPC 前拒绝；这是有意的权限收紧。项目内绝对路径应由上游转换成 `openmind/projects/<project>/...` 逻辑路径后再引用。
- `AiWorkbench` 只保留会话标题、历史入口及唯一 `Chat` Core；文件生命周期与布局由 `AiFilePreviewPane` 负责。
- Project Material 的 Video Descriptor 优先于 `.video.md` 扩展名；直链 MP4、WebM、HLS 仍为 External-only，本地二进制视频仍明确不支持。
- PDF、视频、Project 语义解析和全局 Workspace Preview 均按需加载，避免把低频预览代码与 PDF 样式并入首屏入口。

### 22.3 验证记录与仓库既有门禁

| 验证项 | 结果 |
|---|---|
| `npm run typecheck` | 通过 |
| 重构相关 Vitest | 通过；Controller、Source、Renderer、AI Pane、Daily、Creative、Project 等回归均为绿色 |
| `npm run build` | 通过 |
| `npm run test:integration` | 通过；隔离内容 Fixture 为 1 Article / 1 Post / 1 Summary |
| `npm run test:e2e` | 通过；Electron 启动、内容读取、搜索和主题 Smoke 正常 |
| `npm run perf:documents` | 通过；10/200/500 页 Fixture 的 p95 均约 16.7–16.8ms |
| `npm run perf:stream` | 通过；Commentary/Reasoning 均无 Long Task，p95 分别为 16.8ms / 16.7ms，折叠历史的 Tool DOM 为 0 |
| `npm run perf:resize` | 通过；1000 次 Resize 的 p95 16.8ms，Long Task 为 0 |
| `npm run visual:snapshot` | 通过；55 张完整状态快照 |
| `npm run security:review` | 报告生成成功；仓库仍要求人工处理既有 P0/P1 项，本重构未新增权限或 IPC |
| `npm run verify` | 已执行；Build 通过，随后在下述既有 Skill 单测失败处停止 |

全量门禁仍有两项已在未修改的 `HEAD` 上复现的仓库基线问题，因此不能把 `npm run verify` 记录为全绿：

1. `npm run test:unit` 当前为 1939 通过、3 跳过、1 失败；唯一失败是独立 `cctools-skills` 的 `reddit-fetcher → daily-article-summarizer → daily-topic-selector` 链路，Summarizer 日志显示成功处理 1 篇，但产出的日报统计为 0 篇。该失败在未修改的 `HEAD` 临时工作树中同样稳定复现，与 Renderer 预览代码没有依赖路径。
2. `npm run perf:check` 的绝对启动 JS 预算在未修改的 `HEAD` 已是 1514.6 KiB / 1400 KiB；本次实现为 1509.9 KiB，较基线减少约 4.7 KiB。启动 CSS 为 479.0 KiB / 520 KiB，PDF 的 209.8 KiB 样式保持在按需 chunk 中，没有进入启动 CSS。

以上基线问题不属于本方案授权范围，未通过提高预算、跳过测试或修改独立 Skill 源码掩盖。除这两项仓库既有阻断外，第 18 节的预览重构验收项均已实现并通过对应专项验证。
