# CC Tools Desktop

CC Tools Desktop 是 cctools 的本地内容与 AI 工程工作台。桌面端使用 React、TypeScript、Vite 和 Electron；Claude Code、Codex CLI 与 skills 全部在本机运行。

## 产品能力

- 独立 AI 工作台：会话、运行、审批、风险和工具日志。
- 三档权限：只读、编辑、自动执行。删除、提权、项目外访问等操作始终需要审批。
- Provider：Codex 使用正式 app-server 协议；Claude 使用 Claude Agent SDK。会话创建后锁定 Provider。
- 直接目录运行：AI 在设置中选择的项目目录读取、写入文件和执行命令，不创建临时 worktree。
- 项目会话：完整语义事件保存在 `.cctools/ai/`，除 `.runtime/` 外默认可进入 Git。
- 轻量 AI 侧栏：资料库和创作中心可以携带当前内容进入同一个 AI 会话。
- 统一 Skill 引擎：技能中心与 AI 工具调用共享进程管理、取消、日志、权限和超时机制。
- 内容工作台：资料库、Markdown/HTML 预览、Markdown TOC、创作项目与技能中心。

## 环境要求

- Windows 11 或现代 macOS/Linux
- Node.js 22.12+
- Git
- Python 3 和 `uv`
- 已登录的 Claude Code 或 Codex CLI

Windows 安装包可连接 Windows 本地项目，也可直接连接：

```text
\\wsl.localhost\Ubuntu\home\say\work\github\cctools
```

应用会分别诊断 Windows 与 WSL 中的 Provider。缺少 app-server、平台依赖或协议能力的安装会显示诊断并阻止启动，不会降级到危险参数。

## 开发

在 WSL 项目中开发时，使用 WSL 的 npm，避免 Windows npm 在 `\\wsl$` 路径上创建损坏的依赖链接：

```bash
cd desktop-app
npm install
npm run typecheck
npm test
npm start
```

浏览器预览：

```bash
npm run dev -- --host 0.0.0.0 --port 4173
```

浏览器预览使用 mock API，不执行真实 AI 任务。

## 数据与安全

```text
.cctools/ai/
├── schema.json
├── settings.json
├── sessions/<session-id>/
│   ├── session.json
│   ├── search-index.json
│   ├── rollout.jsonl
│   └── runs/<run-id>/
│       ├── run.json
│       ├── events.jsonl  # 仅旧版迁移源，迁移后保持不动
│       ├── changes.patch  # 仅旧版历史运行可能存在
│       └── security-report.json
└── .runtime/
    ├── locks/
    └── provider-state/
```

`rollout.jsonl` 是会话的唯一权威历史，采用 Codex CLI 的 append-only item 流：`session_meta`、`event_msg`、`response_item`、`turn_context`、`world_state` 和 `compacted`。页面通过完整 turn 的 cursor 分页读取；逐 Token delta 不落盘。旧版每个 run 的 `events.jsonl` 会一次性迁移到 rollout，但不会被修改或删除。风险扫描只提醒，不脱敏、不修改、不阻止保存。`.cctools/ai/.runtime/` 已加入 `.gitignore`。

旧版 `ai-sessions.json` 不迁移、不展示，也不会自动删除。

## 构建与打包

```bash
npm run verify
npm run dist:win
```

仓库位于 WSL 的 `\\wsl$` 路径时，应从 Windows PowerShell 运行：

```powershell
npm.cmd run dist:win:staged
```

该命令会在 Windows 本地临时目录重新安装平台依赖并完成打包，避免 NSIS 不支持 UNC 路径以及误打入 Linux 可选依赖。

Windows 构建产物写入 `desktop-app/dist/`：

- NSIS 安装包
- Portable 单文件便携版，双击直接运行
- ZIP 便携包，解压后可直接运行

macOS 可运行 `npm run dist:mac`。本次正式发布阻断平台是 Windows 本地项目与 Windows 连接 WSL 项目。

## 功能架构

### 进程模型

```text
React renderer
  ↕ 强类型 preload IPC
Electron 主进程
  ↕ 请求/响应 + 推送事件
AI Utility Process
  ├─ ProviderRegistry
  ├─ RunScheduler
  ├─ ApprovalBroker
  ├─ SessionStore
  ├─ LegacyChangeManager
  └─ SkillToolRegistry
```

渲染进程不直接拉起 provider、不直接碰项目文件。所有可变 AI 运行时状态都在独立的 Utility Process 里。worker 崩溃会让在途 IPC 请求 reject,下一次请求会重建 worker,中断的 run 标记为失败,项目记录不丢。

### Provider

- Codex 走 `codex app-server` 的 JSONL JSON-RPC,只为已注册的 cctools 工具开启实验能力,消费 thread/turn/item/approval/usage/diff 事件,绝不解析终端正文。
- Claude 走 `@anthropic-ai/claude-agent-sdk`,权限决策通过 `canUseTool` 汇入同一个 ApprovalBroker,开启 sandbox,永不开启 bypass-permissions。
- Provider 事件在落盘或渲染前归一为版本化的 `AiEvent`。

### 运行与项目访问

一个 session 绑定 project、cwd、Provider 和权限档位。一个 session 同一时刻只跑一个 turn,不同 session 可并发。每个 run 直接用 session 的 cwd,不建 Git worktree、不复制目录、不设 baseline commit;读、写、命令、注册 skill 都在当前项目目录执行;文件写入立即生效,回滚走项目自己的 Git 流程。旧版桌面留下的 ChangeSet 由 `LegacyChangeManager` 应用/撤销/清理,它只处理既有记录,不能新建 worktree。

### 权限

| 档位 | 读 | 安全命令 | 项目内编辑 | 网络 | 破坏/越界/提权 |
| --- | --- | --- | --- | --- | --- |
| 只读 | 允许 | provider 只读工具 | 拒绝 | 拒绝 | 始终拒绝/审批 |
| 编辑 | 允许 | 自动 | 自动 | 审批 | 审批 |
| 自动 | 允许 | 自动 | 自动 | 自动 | 审批 |

注册的 cctools skill 自带权限要求、超时和产物 pattern;AI 调用 skill 一律作为正式 tool 事件可见。

### 持久化

`.cctools/ai/` 是唯一权威源。`session.json`、`run.json`、`search-index.json` 是物化索引;会话的对话历史只有一条 append-only 的 `rollout.jsonl`(Codex 形态:item 流,首条 `session_meta`,后续 `event_msg`/`response_item`/`turn_context`/`world_state`/`compacted`)。JSON 索引用临时文件替换写入;rollout 追加串行化;replay 时畸形记录计数后跳过,不重写历史;大的语义载荷分块再拼回。provider 私有的 token/状态 delta 不落盘、不渲染。旧版每 run 的 `events.jsonl` 一次性迁移到 rollout 后原样保留为恢复件。搜索基于项目文件,每个 session 维护 `search-index.json`,不引入 SQLite 或云端索引。

### 安全

RiskScanner 识别疑似 token、凭据、cookie、私钥和绝对路径,结果写入事件和 run 的 security report,策略是**只告警**:不脱敏、不改、不阻断。应用不使用 `dangerously-bypass-approvals-and-sandbox`、`dangerously-skip-permissions`、直连 API provider、云同步或多 agent 编排。

### 关键文件

- `electron/main.ts`:窗口、系统能力、强类型 IPC 入口。
- `electron/ai/worker.ts`:独立 Utility Process,承载全部 AI 运行时。
- `electron/ai/providers/`:Codex App Server 与 Claude Agent SDK 适配器,实现统一的 `ProviderAdapter` 接口。
- `electron/ai/session-store.ts`:JSONL 追加、恢复、索引、风险记录。
- `electron/ai/skill-tool-registry.ts`:结构化 skill 清单与统一执行引擎。
- `electron/ai/workspace-manager.ts`:仅应用/撤销/清理旧版 ChangeSet,不会新建 worktree。
- `renderer/src/`:React 工作台、AI 三栏、轻量侧栏和内容页面。
- `shared/contracts.ts`:版本化领域模型、Zod schema 和 IPC 类型,跨进程唯一类型源。

更完整的设计见 [docs/AI_WORKSPACE.md](docs/AI_WORKSPACE.md);发布流程见 [docs/RELEASE_CHECKLIST.md](docs/RELEASE_CHECKLIST.md)。

## 代码规范

### 目录职责

| 目录 | 放什么 | 禁止 |
| --- | --- | --- |
| `electron/ai/` | AI 运行时:调度、会话存储、provider 适配、skill 执行 | 渲染逻辑 |
| `electron/lib/` | 通用工具:fs、settings、内容操作 | 业务策略 |
| `electron/product/` | 产品业务层:内容索引、源、创意、仪表盘 | 跨进程类型 |
| `shared/` | 跨进程唯一类型源:契约、IPC、文案、纯工具 | 进程特定代码、Node/renderer 运行时依赖 |
| `renderer/src/` | UI:页面、组件、设计系统、特性 | 直接访问文件系统或 provider |

渲染进程不直接访问文件系统或 provider,所有跨进程数据走 IPC;`shared/` 不依赖 electron 或 renderer 运行时。

### 加一个新 IPC 调用(端到端类型安全)

1. `shared/ipc-channels.ts`:加通道常量,如 `APP_NEW_FEATURE: "app:new-feature"`。
2. `shared/contracts.ts`:在 `DesktopApi` 接口加方法签名,用 Zod 定义输入输出。
3. `shared/ipc-registry.ts`:在 `IPC_INVOKE_REGISTRY` 加 `{ method: "newFeature", channel: IPC.APP_NEW_FEATURE }`。
4. `electron/ipc-handlers.ts`:在 `createIpcHandlerEntries` 加 handler,入口用 Zod `parse` 校验参数后再进业务。
5. preload 经 `createDesktopInvokeBridge` 自动暴露类型安全方法,渲染层调用 `window.cctools.newFeature(...)`。

`RegistryCoversDesktopApi` 在编译期强制 registry 与 `DesktopApi` 一一对应,`registerIpcHandlers` 再校验 handler 表与 registry 完全匹配。漏注册任一处都会编译失败,运行时不存在裸字符串通道。

### 加一个新 Provider

实现 `ProviderAdapter` 接口(核心是 `run(context)`,可选 `prewarm`/`disposeSession`),经 `ProviderRunContext` 拿 session、取消信号、事件发射和审批回调;在 `PROVIDER_PROBE_SPECS` 加探测规格,在 `RunScheduler` 注册实例。

### 持久化

- JSON 写权威数据走 `writeJsonAtomic` / `writeTextAtomic`(`electron/lib/fs-utils.ts`):临时文件 + 原子替换,失败回滚备份。禁止裸 `fs.writeFile` 写权威文件。
- 会话追加走 `RolloutJournal.append`(支持 durable 即时落盘)。
- 索引或会话元数据损坏时跳过并保留可手动恢复,不让单条坏数据中断整条读取。

### 命名

文件 kebab-case(`session-store.ts`、`product-service.ts`);类型/接口/类 PascalCase(`ProviderAdapter`、`IpcHandlerEntry`);函数/变量 camelCase(`createSession`、`appendRolloutLines`);常量 UPPER_SNAKE(`SCHEMA_VERSION`、`IPC_INVOKE_REGISTRY`);Zod schema 以 `Schema` 结尾(`AiSessionSchema`)。特性目录名小写 kebab-case。

## 编码风格

### TypeScript

`tsconfig.json` 开 `strict`、`allowJs: false`、target ES2022、moduleResolution Bundler;`@shared/*` 路径别名指向 `shared/`。渲染与 electron 各一份 tsconfig,`npm run typecheck` 同时检查两边。领域类型在 `shared/contracts.ts` 用 Zod 定义,schema 同时产出编译期类型与运行时校验,`SCHEMA_VERSION` 标记数据迁移版本。

### 组件

全部函数组件;props 用 `type` 定义(如 `export type ChatProps = { compact?: boolean }`),组件名 PascalCase。原子级通用 UI(SearchField、SegmentedControl、DataTable)放 `renderer/src/design-system/`,业务复合组件放 `renderer/src/components/` 或对应 `features/<name>/`。

### 状态与数据

不引入 redux/zustand 等状态库,全局状态用 React Context + 自定义 hook(如 `useAi()` 暴露 `AiController`/`AiStreamingStore`)。跨进程数据一律走 `window.cctools.*` 异步 API,范式:

```ts
const [data, setData] = useState<Result>(initial);
const [error, setError] = useState("");
const load = useCallback(async () => {
  try { setData(await window.cctools.getDashboard(today())); }
  catch (cause) { setError(String(cause)); }
}, []);
useEffect(() => { void load(); }, [load]);
```

错误抛标准 `Error`,用户可见错误文案走 `shared/messages/`;日志用 `console.warn`/`console.error` 带上下文。

### 路由

自管路由,不引 react-router。新增页面:在 `renderer/src/app/routes.ts` 的 `AppPage` 联合类型加 ID,在 `route-registry.tsx` 的 `ROUTE_DEFINITIONS` 加定义,导出页面组件,通过 `Navigate` 跳转、`AppRouteState` 传参。

### 样式

纯 CSS + 设计 token,禁 CSS-in-JS。语义 token 定义在 `renderer/src/styles.css`:`--text`/`--text-dim`/`--accent` 颜色、`--space-1`~`--space-8` 间距、`--radius-sm/md/lg`、`--dur-instant/fast/normal/slow`、`--ease-standard/emphasized/exit`、`--font-display/mono`。特性样式按 `renderer/src/styles/features/<name>.css` 组织;class 命名 kebab-case;优先复用 token,少写魔法值。

### 文案

集中式,不引 i18n 框架。文案按模块放 `shared/messages/zh-CN/`,聚合后从 `@shared/messages` 导入:组件里 `import { messages as m } from "@shared/messages"`,使用 `m.ai.chat.loadingHistory`。禁止在组件里写死裸字符串。

### 测试

Vitest + Testing Library。测试文件与源文件同目录,命名 `*.test.ts(x)`。渲染层测试 mock 掉 `window.cctools`,覆盖用户交互、状态变化、IPC 调用与可访问性;shared 层覆盖边界与错误分支(如 `model-catalog.test.ts`、`skill-sources.test.ts`)。`npm test` 先 build,再 `vitest run`,最后跑集成烟雾。
