# 打包分发体验改进工作计划

> 目标：把 desktop-app 打包产物发给没有开发环境的用户后，对方能在**不打开终端、不理解内部结构**的前提下，完成 skill 导入与 AI Provider 就绪。
>
> 前置状态（已完成）：`executionTrust` 与 Installed Skill 的 `status/readiness` 门禁已移除；显式安装后由包路径、Manifest 身份和 digest 实时校验可用性。

> 实施状态（2026-08-14）：W1–W6 的代码、IPC、界面、文档和本地自动化测试已完成。Windows/macOS 干净机器安装包验收、真实公开 Git 导入验收和独立安全复核仍属于发布前外部证据门槛，不能由 Linux 本地单测代替；见 [`docs/CLEAN_MACHINE_EVIDENCE.md`](./CLEAN_MACHINE_EVIDENCE.md) 与 [`docs/SECURITY_REVIEW.md`](./SECURITY_REVIEW.md)。

---

## 总览

| # | 工作项 | 依赖 | 预估规模 | 优先级 |
|---|--------|------|----------|--------|
| W1 | 技能中心：Git / ZIP 来源导入 UI | 无（IPC 已就绪） | S | P0 |
| W2 | 设置页：CLI 一键安装（Windows 原生 + macOS 第一期） | W2.1 安装器服务 | L | P0 |
| W3 | 设置页：CLI 登录引导（预填命令的终端入口） | W2 | M | P1 |
| W4 | WSL 场景文案与降级路径 | W2 | S | P2 |
| W5 | 首次运行引导流（Onboarding 汇总页） | W1–W3 | M | P2 |
| W6 | 文档与发布说明更新 | 全部 | S | P1 |

平台承诺：W2/W3 第一期只做 **Windows 原生 + macOS**；WSL 连接场景（W4）保持现有文字指引，不提供一键安装。

---

## W1 技能中心：Git / ZIP 来源导入 UI

### 现状
- 后端完整：`SkillSourceService.inspect/install`（`electron/skills/skill-source-service.ts`）支持 directory / zip / HTTPS git（浅克隆、禁凭据、禁 hooks）。
- IPC 已注册：`inspectSkillSource` / `installSkillSource`（`shared/ipc-registry.ts`），契约在 `shared/contracts.ts`。
- **已完成**：renderer 已提供 Git / ZIP / 本地目录导入入口，且统一执行“先 inspect、后确认安装”；安装成功后自动刷新技能列表。

### 任务
1. `SkillsPage.tsx` 顶部工具栏新增"导入 Skill"入口，展开三种来源：
   - **Git**：URL 输入框（仅 https://，前端校验）+ 可选 ref（分支/tag），调用 `inspectSkillSource({ type: "git", locator, ref })`
   - **ZIP**：文件选择按钮，调用 `inspectSkillSource({ type: "zip", locator })`
   - **本地目录**：沿用现有 `selectSkillPackageSource` 或目录选择
2. inspect 结果先展示（名称、publisher、版本、digest、文件数、issues/warnings），确认后调 `installSkillSource`
3. 安装成功后列表自动刷新；失败展示 `SkillSourceError.code` 映射的中文文案（git-unavailable / git-timeout / git-package-missing / git-package-ambiguous 已有错误码体系，补 zh-CN 映射）
4. 加载态：git 克隆有网络延迟，需要 spinner + 可取消（后端 staging 清理已有 finally 保证）

### 验收
- 从一个公开 GitHub 仓库 URL 输入到安装完成、出现在技能列表且可运行，全程无终端操作
- 非法 URL / 404 / 超时有明确中文错误提示
- 测试：`SkillsPage.test.tsx` 增加 git/zip 导入用例（mock `inspectSkillSource` / `installSkillSource`）

---

## W2 设置页：CLI 一键安装

### 设计决策（已定）
- **不依赖用户机器的 Node/npm**。使用各 CLI 的原生安装通道：
  - Claude Code：官方 native installer
    - macOS/Linux: `curl -fsSL https://claude.ai/install.sh | bash`（下载解压到 `~/.local/bin/claude` 类路径）
    - Windows: PowerShell 安装脚本（`irm https://claude.ai/install.ps1 | iex`）
  - Codex CLI：npm 分发为主，第一期采用**App 托管 npm 便携目录**方案——安装到 `userData/tools/npm-global/{claude-code,codex}`，通过 Runtime Pack 内的 Node 运行（Runtime Pack 已含 Node），不写系统 PATH
- **安装位置**：App 私有目录 `userData/tools/`（与 ADR-001 的 userData 分区一致，新增 `tools` 子路径到 `AppPaths`）。理由：无需管理员权限、卸载 App 即清理、不污染宿主机
- **PATH 注入**：诊断/启动逻辑（`provider-registry.ts` 的探测顺序）在检测 CLI 时优先查 `userData/tools/` 及其 bin 子目录；仍保留系统 PATH 探测作为回退（用户自己装的仍可用）

### 任务拆解
1. **W2.1 安装器服务（electron/install/cli-installer-service.ts，新建）** ✅ 已实现（实现与初稿有一处方案调整）
   - 实际机制：**Claude Code 走官方安装脚本**（`https://claude.ai/install.ps1` / `install.sh`，下载后校验 SHA-256 并记录到安装清单，在隔离 HOME 下执行）；**Codex CLI 走 npm 便携安装**（App 内置 Node 运行 `npm install --prefix` 到 `userData/tools/npm-global`，`--ignore-scripts`，不碰系统 npm）
   - 初稿的「GitHub release 资产匹配（assetHints）」方案已放弃：两个 CLI 的 release 资产命名不稳定且 codex release 混有 `codex-app-server-*` 等同前缀资产，官方脚本/npm 通道更稳
   - 进度事件经 IPC 推送到 renderer；幂等安装、`upgrade(force)`、`checkForUpdate`、取消（AbortController）、失败回滚
2. **W2.2 诊断接线** ✅
   - `provider-registry.ts` / 现有 CLI 诊断（`shared/messages/zh-CN/electron.ts:72-77` 的判断来源）增加 app-tools 路径探测
   - 诊断结果新增字段 `installable: boolean`（当前平台 + 当前 CLI 是否支持一键安装；WSL 场景为 false）
3. **W2.3 UI** ✅
   - `settings-sections.tsx` Provider 区诊断卡片改造：
     - 未安装且 `installable` → 显示 **[一键安装]** + [查看手动步骤]（折叠显示现有文案）
     - 安装中 → 进度条 + 取消
     - 安装失败 → 错误信息 + 重试 + 手动步骤
   - 文案明确"安装到应用私有目录，不影响系统"
4. **W2.4 测试** ✅
   - 单测：installer 服务的 detect/幂等/回滚（mock 下载）；诊断探测顺序
   - UI 测试：三种状态的卡片渲染与按钮行为
   - 真机验收：已接入 multi-OS CI（`.github/workflows/desktop-app.yml` 的
     `Clean-machine one-click CLI install smoke` 步骤，windows-latest / macos-latest
     干净 runner 上执行 `npm run cli:install:smoke`，真实走官方脚本/npm 安装并验证
     `--version`）。打包产物的完整 clean-machine 场景（离线、非管理员、强退安装等）
     仍按 `docs/CLEAN_MACHINE_EVIDENCE.md` 的表格逐项人工/CI 补齐。

### 明确不做（第一期）
- WSL 内一键安装（W4 处理）
- 安装 Claude Desktop / 浏览器扩展等周边
- CLI 版本管理与升级（后续可加"检查更新"）

---

## W3 设置页：CLI 登录引导

### 任务
1. 诊断状态为"已安装、未登录"时，提供 **[打开终端登录]** 按钮：
   - Windows：`start cmd /k claude login`（或直接 `claude /login`，以实际 CLI 参数为准）
   - macOS：`open -a Terminal` + AppleScript 预填命令（或提示粘贴）
2. 登录完成检测：卡片提供 **[我已完成登录，重新检测]** 按钮，触发一次 provider 诊断刷新（复用现有诊断 IPC）
3. 备选交互：设置页内嵌只读日志面板展示 `claude /login` 输出（如果 CLI 支持 `--print-logs` 类非交互模式；不支持则维持外部终端方案，不做伪终端）

### 验收
- 从"未登录"到"已登录"状态，用户点击数 ≤ 3 次，全程无需手动输入命令

---

## W4 WSL 场景（Windows 连接 WSL 项目）

- 诊断卡片在 WSL 场景下不显示一键安装，改为分步指引卡片（复制按钮）：
  1. WSL 内安装 CLI 的命令（一键复制）
  2. WSL 内 `claude /login`
  3. 回到 App 点重新检测
- 文案沿用 `electron.ts:73` 的 WSL 体系，仅交互升级为复制按钮

---

## W5 首次运行引导（Onboarding）

### 任务
1. 新增首启检查页（bootstrap readiness 已以 openmindRoot 为基准，扩展为三步清单）：
   - ① 选择 openmind 根目录（现有 `PathSettingsSection.onSelectOpenmind` 复用）
   - ② 导入 Skill（跳转 W1 的导入入口，或跳过）
   - ③ AI Provider 就绪（跳过 / 一键安装 CLI / 填 providers.yaml key）
2. 每步显示状态（完成 / 待办 / 可跳过），完成后进入主界面；设置里可随时回看
3. 仅首次启动展示，状态落在 `userData/settings.json`

---

## W6 文档与发布

1. README "环境要求"章节改写：区分「产品运行依赖（App 自带）」与「可选外部依赖（CLI、provider key）」，注明一键安装入口
2. `README.md` 增加"分发给别人"小节：安装包 + skill 仓库 URL 的最小交付说明
3. CHANGELOG / release notes 注明：skill 审批门禁移除（装即执行）的安全语义变更
4. 清理代码中已过时的 host-trust 注释与 UI 文案；当前代码仅保留迁移兼容字段删除、legacy inspection-only 错误码和 ADR-004 历史记录，不再把它们作为现行执行门禁。

---

## 实施顺序与里程碑

```
M1（W1）          → Git/ZIP 导入 UI， IPC 全现成，先行发布价值最高
M2（W2.1–W2.3）   → Windows 原生一键安装 + 诊断接线 + UI
M3（W2.4 真机 + W3 + W4）→ macOS 对齐、登录引导、WSL 文案
M4（W5 + W6）     → Onboarding、文档、发布
```

每个里程碑独立可发布；M1 不碰安全面，M2 是最大的新增攻击面（网络下载 + 执行安装脚本），需要 security:review 覆盖新增的下载/校验代码路径。

## 风险登记

| 风险 | 缓解 |
|---|---|
| CLI 官方安装脚本变更 | 安装脚本 URL/校验方式集中配置在一个常量文件；失败时自动降级为手动指引卡片 |
| App 私有目录 PATH 探测遗漏某些调用点 | grep 全部 `claude`/`codex` 进程启动点，统一走一个 resolveCliPath() |
| macOS Gatekeeper 拦截下载的二进制 | 安装后首次执行失败时给出引导文案（xattr 提示），或改用可签名的安装方式 |
| WSL 一键安装需求被用户提出 | W4 预留 `installable=false` 字段，后续版本可翻转 |
| 一键安装引入供应链面 | 限定 HTTPS 官方域名白名单；安装清单记录来源 digest；纳入 security:review |
