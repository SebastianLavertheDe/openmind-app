# 前端组件化成熟度评审

整改状态：**五项任务已完成**（2026-10-23），实现与验收记录见第 6 节。第 1–5 节保留原始审查结论及当时的验证边界。

2026-10-26 复核后补修两项详情/列表边界，并按当前产品范围将视觉门禁限定为 Windows/macOS，见第 6.5 节。

审查日期：2026-10-23；项目：OpenMind Desktop；审查基准：`f64dbc8`。

方式：只读源码审查、UI 静态检查、设计系统单元测试、Electron 视觉回归，以及隔离组件场景复现。评审没有修改应用源码或视觉基线。

## 1. 总体判断

当前组件化成熟度约为 **7/10：基础控件已经工程化，业务组件边界和治理覆盖仍需收敛。**

该分数是工程判断，不是自动化工具计算的指标。主要依据是公共组件契约、状态与请求归属、样式所有权、组件组合行为，以及验证机制能否持续运行。

| 维度 | 当前判断 | 依据 |
| --- | --- | --- |
| 基础控件复用 | 较成熟 | 公共组件入口、类型化变体、共享交互和行为测试已建立 |
| 样式治理 | 核心控件较成熟，覆盖不完整 | Button/Input/Select 有明确 owner；Tabs 等旧控件仍有多处外观定义 |
| 业务组件边界 | 中等 | 文件预览已有清晰分层；部分页面仍复用完整容器，导致状态和请求重复 |
| 组合交互 | 已有基础，仍有缺口 | 弹层和焦点能力已共享；菜单与 Tabs 组合存在键盘导航错误 |
| 自动化保障 | 体系已建立，当前未完全闭环 | 静态检查和设计系统测试通过，视觉回归因契约不一致而失败 |

审查主要覆盖 `renderer` 的设计系统、业务组件、状态上下文、样式，以及相关测试和 CI。采用结构扫描与重点调用路径核查，不等同于逐行审查所有前端代码，也不是对整个 Electron 后端架构的全面评估。

## 2. 优先处理的问题

### 2.1 [P1] 视觉回归无法跑通，组件变体与验证契约脱节

**现象与证据**

本次执行 `npm run visual:ui`，在首个场景截图前失败。普通输出只显示 Electron 脚本执行异常；通过临时诊断包装获取到具体错误：

```text
Button size escaped its contract: 28px vs 34
```

文字按钮的样式明确使用 `height: auto` 和小尺寸最小高度，而视觉检查对所有 `.ui-button` 都根据 `data-size` 要求固定高度，未区分 `text` 变体。

- [文字按钮样式：buttons.css:31](../renderer/src/styles/components/buttons.css#L31)
- [按钮高度断言：ui-catalog-electron.cjs:229](../scripts/ui-catalog-electron.cjs#L229)

**影响**

当前视觉比较没有完成，不能据此声称视觉回归通过。该检查已经接入 CI，因此组件变体与检查脚本不同步会阻断对应验证流程。

**建议**

为固定高度按钮和随文本布局的按钮分别定义几何契约，同步检查脚本后重新执行视觉比较。若产生基线差异，应检查实际图、预期图和差异图；不能仅为消除失败自动重建基线。

### 2.2 [P2] 部分共享控件只统一了 JSX，外观仍由页面维护

**现象与证据**

`Tabs` 的 `className` 直接替换基础 `ui-tabs` 类。项目页面自行设置其高度、内边距、字体、颜色和选中态。

`Tabs`、`SegmentedControl`、`ToggleSwitch` 没有进入样式所有权检查名单，默认外观仍分散在 `components.css`、`final-polish.css`、`workbuddy-refactor.css` 等文件中。因此，当前 `check:ui` 通过不代表全部共享控件都已完成样式收敛。

- [Tabs 的 className 行为：controls.tsx:54](../renderer/src/design-system/controls.tsx#L54)
- [项目页面控件外观：projects.css:163](../renderer/src/styles/features/projects.css#L163)
- [旧共享控件样式覆盖：workbuddy-refactor.css:763](../renderer/src/styles/workbuddy-refactor.css#L763)
- [所有权检查名单：model.cjs:5](../scripts/ui-contract/model.cjs#L5)

**影响**

修改共享控件后，各页面可能继续保持各自的外观。新增页面仍需要参考和复制已有页面的控件样式，增加视觉调整与回归成本。

**建议**

为现有差异补充语义化变体，保留基础类，收回 feature 中的控件外观定义；将这些控件纳入单一 CSS owner、静态检查和视觉目录。迁移时比较已有页面的实际效果，保留合理的设计差异。

### 2.3 [P2] 项目文件页复用完整业务容器，造成重复请求和状态

**现象与证据**

`ProjectFilesPanel` 已读取资料与产物列表，并维护当前选择；详情区域又复用完整的 `ProjectMaterialsPanel` 或 `ProjectOutputsPanel`，且以文件路径作为组件 `key`。

切换文件会重挂载子面板，而子面板仍会读取该类别的完整列表、维护自己的选中项。

- [父组件加载列表：ProjectFilesPanel.tsx:85](../renderer/src/features/projects/ProjectFilesPanel.tsx#L85)
- [按文件路径重挂载子面板：ProjectFilesPanel.tsx:338](../renderer/src/features/projects/ProjectFilesPanel.tsx#L338)
- [资料子面板再次加载列表：ProjectMaterialsPanel.tsx:98](../renderer/src/features/projects/ProjectMaterialsPanel.tsx#L98)
- [产物子面板再次加载列表：ProjectOutputsPanel.tsx:162](../renderer/src/features/projects/ProjectOutputsPanel.tsx#L162)

**影响**

文件切换额外触发列表 IPC，父子组件分别管理列表、选择与刷新协调。该结论来自加载和挂载路径核查，本次没有测量真实大型项目的延迟。

**建议**

拆出资料详情、产物详情及相应 controller，让列表与选择状态只有一个管理者。独立页面可以再组合列表与详情；详情组件只加载当前文件所需的数据，并保留未保存修改的导航保护。

### 2.4 [P2] 组件组合后的键盘导航仍有缺口

**现象与证据**

使用生产组件的隔离场景已最小复现：项目页当前选中 Materials，从新增菜单按 Tab 后，焦点落到未选中的 Tasks，目标元素的 `aria-selected=false`、`tabIndex=-1`。

菜单自行查询下一按钮时，选择器中的 `button:not([disabled])` 仍会包含 `tabIndex=-1` 的按钮，也没有统一过滤隐藏或 inert 元素。Select 内还存在同类实现。

- [DropdownMenu 焦点逻辑：controls.tsx:280](../renderer/src/design-system/controls.tsx#L280)
- [Select 的同类实现：Select.tsx:304](../renderer/src/design-system/Select.tsx#L304)
- [真实菜单与 Tabs 组合：ProjectsPage.tsx:399](../renderer/src/features/projects/ProjectsPage.tsx#L399)

**影响**

单个控件测试通过，仍不能保证控件组合符合页面的 Tab 顺序和 roving tabindex 约定。

**建议**

统一“下一可参与 Tab 导航元素”的基础能力，补充菜单与 Tabs、隐藏区域、inert 区域的组合测试。复现采用内存 esbuild + JSDOM 场景，本次没有执行真实屏幕阅读器验证。

### 2.5 [P2] 通用应用反馈与 AI 业务上下文耦合

**现象与证据**

`AiUiValue` 同时包含 `notify/confirm`、发送状态、AI 面板模式与项目对话目标。微信设置等非 AI 功能也通过 `useAiUi` 获取通用反馈能力；反馈宿主本身同样依赖 AI 上下文。

- [混合的状态接口：ai-context.tsx:89](../renderer/src/ai-context.tsx#L89)
- [反馈宿主依赖：FeedbackHost.tsx:16](../renderer/src/components/FeedbackHost.tsx#L16)
- [非 AI 功能的依赖：WechatSettingsSection.tsx:19](../renderer/src/features/wechat/WechatSettingsSection.tsx#L19)

**影响**

非 AI 功能的独立挂载和测试需要 AI 上下文，并订阅不相关的 AI UI 状态。现有 AI 状态分片已经降低部分更新成本，但应用级反馈边界尚未独立。

**建议**

抽出应用级反馈 Provider，区分稳定的提示、确认命令接口和 toast/confirm 状态订阅。AI 发送状态、面板模式与对话目标继续归 AI 模块管理。

## 3. 已经成熟的能力

- **公共控件契约已经建立。** Button、Input、Select、Dialog 等具备公共入口、类型化变体和明确样式归属。相关检查真正接入构建，另有负例验证约束能阻止违规实现。见 [UI_COMPONENT_CONTRACT.md](../docs/UI_COMPONENT_CONTRACT.md)。
- **复用覆盖公共交互。** 弹层关闭、焦点恢复、退出动画等已有共享机制；表单测试覆盖 busy 状态、原生校验、输入 DOM 身份和嵌套 Escape 等行为。
- **文件预览有清晰的业务分层。** source、capabilities、controller、renderer 分离，不同调用场景提供适配器。该模式适合推广到其他跨场景业务组件。见 [model.ts:92](../renderer/src/features/file-preview/model.ts#L92)、[PreviewRenderer.tsx:24](../renderer/src/features/file-preview/PreviewRenderer.tsx#L24)。
- **状态订阅已考虑更新频率。** AI snapshot、events、UI、actions 已分片，草稿使用按 key 订阅的 external store，避免每次输入广播全应用。见 [ai-context.tsx:60](../renderer/src/ai-context.tsx#L60)、[ai-context.tsx:1086](../renderer/src/ai-context.tsx#L1086)。
- **视觉验证具备工程基础。** 目录使用生产组件与应用 CSS，运行时和字体有校验，CI 禁止自动更新基线，测试使用临时 userData 和合成内容。当前执行失败需要修复，但这些机制本身值得保留。

## 4. 本次验证结果与边界

| 检查 | 结果 | 说明 |
| --- | --- | --- |
| `npm run check:ui` | 通过 | 扫描 175 个 renderer 源文件；12 个检查器相关测试通过 |
| `npx vitest run renderer/src/design-system --maxWorkers=2` | 通过 | 17 个测试文件、103 个测试通过 |
| `npm run visual:ui` | 失败 | 首个场景截图前触发按钮高度断言，未完成视觉比较 |
| 菜单 + Tabs 隔离场景 | 问题已复现 | Tab 焦点进入未选中、`tabIndex=-1` 的按钮 |
| 全量业务测试、完整 build、integration、E2E | 本轮未运行 | 不能据本轮结果声明整体通过 |
| 源码及视觉基线 | 未修改 | 文档整理只新增本评审文件 |

当前视觉目录配置的 48 张基线来自 12 个场景、两种主题和两种宽度，不代表所有公共组件的全部状态均已覆盖，也不代表本轮已成功比较这些截图。

文件行号对应审查基准 `f64dbc8`，后续代码变更后可能移动。检查结果描述的是本次审查状态，不是持续有效的通过证明。

## 5. 建议执行顺序与验收标准

| 顺序 | 工作 | 验收标准 |
| --- | --- | --- |
| 1 | 恢复视觉门禁 | 几何断言与公开变体一致；完成视觉比较；任何基线变更均经过图像检查 |
| 2 | 收敛旧共享控件样式 | Tabs/SegmentedControl/ToggleSwitch 有明确 owner 和类型化变体；feature 只管理布局；检查和目录覆盖新增契约 |
| 3 | 明确项目文件页状态归属 | 切换文件不因详情挂载重新请求整类列表；列表、选择及刷新由一处管理；未保存保护保持有效 |
| 4 | 补齐组合交互 | 菜单 Tab 跳转到正确的可导航元素；隐藏、inert 和非活动 tab 被正确排除 |
| 5 | 独立应用反馈能力 | 非 AI 功能可在独立反馈 Provider 下挂载和测试；不再为提示与确认订阅 AI 发送或面板状态 |

后续验收应关注：新增页面能否直接组合既有组件，修改公共组件能否一致生效，业务数据是否有明确归属，以及自动化能否发现组合后的回归。


## 6. 整改实现与验收记录（2026-10-23）

### 6.1 完成清单

| 原问题 | 状态 | 实现与验收证据 |
| --- | --- | --- |
| 2.1 恢复视觉门禁 | 已完成 | 公共 BUTTON_GEOMETRY 区分固定高度动作和内容高度文字动作，Button 输出 data-geometry；文字动作验证小尺寸最小高度，保留响应式和触摸目标；正式完成 52 次 Windows 像素比较 |
| 2.2 收敛共享控件样式 | 已完成 | Tabs 保留基础类；五种类型化变体覆盖原有设计；Tabs、SegmentedControl、ToggleSwitch 的外观集中至 selection.css，页面保留布局；加入所有权检查、负例和生产组件目录 |
| 2.3 明确文件页状态归属 | 已完成 | ProjectFilesPanel 持有唯一列表与选择；ProjectMaterialDetail、ProjectOutputDetail 只管理当前资源与导入/编辑生命周期；独立页面组合相同详情；移除按文件路径重挂载完整容器 |
| 2.4 补齐组合交互 | 已完成 | DropdownMenu、Select、模态焦点范围共享 tabStops；跳过负 tabindex、disabled、hidden、不可见、关闭的 details 和 inert 区域；模态内正确回绕，反向 Tab 返回触发器 |
| 2.5 独立应用反馈 | 已完成 | FeedbackProvider 独立于 AI 状态；稳定命令 useFeedback 与状态 useFeedbackState 分开订阅；FeedbackHost、微信设置及其他通用反馈调用已迁移；兼容独立 AiProvider 与旧完整 controller |

关键实现：

- [公共几何与选择变体](../renderer/src/design-system/control-contract.ts)、[选择控件样式 owner](../renderer/src/styles/components/selection.css)、[样式所有权检查](../scripts/ui-contract/model.cjs)。
- [资料详情及资源 controller](../renderer/src/features/projects/ProjectMaterialDetail.tsx)、[产物详情及编辑 controller](../renderer/src/features/projects/ProjectOutputDetail.tsx)、[文件列表与选择的管理者](../renderer/src/features/projects/ProjectFilesPanel.tsx)。
- [统一 Tab 导航](../renderer/src/design-system/tab-navigation.ts)、[应用级反馈](../renderer/src/feedback-context.tsx)、[反馈宿主](../renderer/src/components/FeedbackHost.tsx)。

文件页回归验证覆盖：多次跨文件/跨类型切换后两类列表均只请求一次；保存后的标题反映到父级列表；保存失败并取消放弃修改时保留同一个编辑器及草稿；初始路径失效时由列表选择有效文件；仅提供列表宿主时导入对话框仍能使用。原有自动保存、卸载保存、创建、导入、重试和未保存导航保护继续通过既有项目测试。

反馈回归验证在不挂载 AiProvider 的情况下运行真实微信设置、确认框和通知；验证通知变化不会重新渲染仅订阅命令的消费者，并在卸载时取消定时器、结束未完成确认。

### 6.2 视觉证据与平台边界

使用合成目录与临时 userData 完成迁移前后截图。首次迁移比较时，原有 12 类目录场景没有像素差异；新增选择场景的实际图、迁移前图及差异图已检查，随后检查两种主题、两种宽度的完整截图集合，显式建立 Windows x64 基线，再以非更新模式比较通过。没有改写原有 Linux arm64 PNG。

Windows x64 现在比较 13 场景 × 2 主题 × 2 宽度，共 52 张；原有 Linux arm64 仍保留 48 张。新增选择场景在 Linux 执行几何检查，其像素基线目前只覆盖 Windows。CI 新增 Windows 像素比较任务，原有 Linux 任务保留。本轮没有在 Linux arm64 本机执行，因此不声明 Linux 本机验证通过。

Windows 目录比较使用离屏渲染，避免 Windows 窗口被遮挡时动画帧停顿；交互预览仍使用可见窗口。新增 --capture-only 用于迁移取证，明确区分截图、更新基线、正式比较三种模式；CI 仍禁止更新基线，缺少受支持平台基线或运行时不匹配仍然失败。

### 6.3 验证结果

| 检查 | 结果 | 说明 |
| --- | --- | --- |
| npm run build | 通过 | 包含样式所有权、静态契约、类型检查、renderer 与 Electron 构建 |
| npm run typecheck | 通过 | 独立复核两进程类型 |
| npm run check:ui | 通过 | 13 项检查器回归；新增选择控件别名/后代覆盖的负例 |
| 前端单元测试 | 通过 | 最终完整复核 99 个测试文件、1017 项通过；新增 11 项详情/焦点/独立反馈回归 |
| npm run test:integration | 通过 | 隔离内容夹具的桌面集成 smoke |
| npm run test:e2e | 通过 | 真实 Electron、临时 userData、合成内容 |
| npm run visual:ui | 通过 | Windows x64 52 次像素比较、4 个长确认框几何场景；500 个无关动作下输入更新 P95 0.30ms |
| 全量单元测试 | 有既有失败 | 本轮全量运行 2584 通过、13 跳过、19 失败；之后补充的两个详情边界用例独立通过 |

全量单测失败集中在 8 个未修改的 Electron 后端测试文件，涉及 Windows 符号链接权限、大小写文件系统、路径格式和 POSIX 权限位。使用提交 dcaefa6 的干净源码副本，在相同机器复测这 8 个文件，得到相同的 19 个失败用例（另 81 项通过）；已逐项比较失败名称一致，没有用跳过用例或调整后端断言来掩盖这些问题。

验证日志与图像保存在忽略目录 .tmp/，包括 review-build.log、review-ui-check.log、review-renderer-final.log、review-all-unit.log、review-baseline-unit.log、review-integration.log、review-e2e.log、review-visual.log 及 ui-regression/report.json。上述结果不等于 npm run verify 全链路通过；本轮没有运行整个发布、安全与性能验收链路，也没有执行真实屏幕阅读器验证。

### 6.4 后续测试适配修正（2026-10-23）

上述 19 项为组件整改完成时的失败快照。随后按用户要求修复其中两类共 4 项测试：

- 大小写用例根据临时夹具所在文件系统的实际行为选择验证方式：允许同时存在等价名称时仍验证扫描及解析拒绝冲突；名称被视为同一路径时验证应用拒绝重复创建、保留原显示名。NFKC 等价名称的真实冲突验证继续保留。改名通过目录枚举检查实际名称，并验证文件内容保留。
- Skill 发现用例解析输出中的 JSON 记录后比较 skill_path 与 package_root；Provider 路径映射使用含空格、中文和反斜杠的 Windows 路径，确保 POSIX 主机也能覆盖路径转义。

4 项定向复跑全部通过；这两个测试文件完整运行得到 9 项通过、1 项因符号链接 EPERM 失败。类型检查通过。本次没有跳过或删除源文件中的测试，没有修改生产实现或系统权限设置，也没有重跑全量测试；其余符号链接权限与 POSIX 权限位两类仍待处理。日志见 .tmp/review-portable-targeted.log、.tmp/review-portable-tests.log、.tmp/review-portable-types.log。

### 6.5 复核修正与视觉平台范围（2026-10-26）

- 视觉门禁现限定为 Windows/macOS。Linux CI 保留构建、单元测试、集成与 Electron E2E，移除三项视觉步骤；本地 `visual:snapshot`、`visual:inputs` 和默认 `visual:ui` 也明确跳过 Linux。历史 Linux PNG 保留作参考，目录预览、显式截图取证及性能检查仍可使用。
- Windows CI 继续执行正式像素比较，并承接应用截图和输入控件检查。新增 macOS CI 执行应用截图、输入控件与目录几何检查；目录使用 `--capture-only` 保存证据。macOS 尚无已审阅的原生像素基线，不能将该任务记为像素比较通过。本轮执行主机为 Linux，没有执行这两个原生平台的 CI。
- 产物详情卸载时清理当前路径标记，使 StrictMode 重放 effect 后能够重新读取被 controller 取消的资源。回归覆盖指定初始路径和列表自动选择两种入口。
- 独立资料/产物列表在列表 IPC 失败时展示共享 `ErrorState`，重试仍由列表 owner 发起；成功后清除错误。回归同时覆盖独立布局和 portal 宿主布局。

新增 6 项回归用例在修复前全部失败，修复后项目相关用例及文件预览 controller 共 93 项全部通过；`npm run build`（含 UI 契约与类型检查）、集成 smoke 和真实 Electron E2E 通过。三个默认视觉命令在 Linux 均明确报告跳过；另已解析 CI YAML 并核对平台分工。本轮未重跑全量单测或 `verify`，也未修改视觉基线。定向结果见 .tmp/component-fix-before.json、.tmp/component-fix-tests.json，构建日志见 .tmp/component-fix-build.log。
