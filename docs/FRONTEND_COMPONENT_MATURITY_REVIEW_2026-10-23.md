# 前端组件化成熟度评审

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

- [文字按钮样式：buttons.css:31](/home/say/work/github/openmind-app/renderer/src/styles/components/buttons.css:31)
- [按钮高度断言：ui-catalog-electron.cjs:229](/home/say/work/github/openmind-app/scripts/ui-catalog-electron.cjs:229)

**影响**

当前视觉比较没有完成，不能据此声称视觉回归通过。该检查已经接入 CI，因此组件变体与检查脚本不同步会阻断对应验证流程。

**建议**

为固定高度按钮和随文本布局的按钮分别定义几何契约，同步检查脚本后重新执行视觉比较。若产生基线差异，应检查实际图、预期图和差异图；不能仅为消除失败自动重建基线。

### 2.2 [P2] 部分共享控件只统一了 JSX，外观仍由页面维护

**现象与证据**

`Tabs` 的 `className` 直接替换基础 `ui-tabs` 类。项目页面自行设置其高度、内边距、字体、颜色和选中态。

`Tabs`、`SegmentedControl`、`ToggleSwitch` 没有进入样式所有权检查名单，默认外观仍分散在 `components.css`、`final-polish.css`、`workbuddy-refactor.css` 等文件中。因此，当前 `check:ui` 通过不代表全部共享控件都已完成样式收敛。

- [Tabs 的 className 行为：controls.tsx:54](/home/say/work/github/openmind-app/renderer/src/design-system/controls.tsx:54)
- [项目页面控件外观：projects.css:163](/home/say/work/github/openmind-app/renderer/src/styles/features/projects.css:163)
- [旧共享控件样式覆盖：workbuddy-refactor.css:763](/home/say/work/github/openmind-app/renderer/src/styles/workbuddy-refactor.css:763)
- [所有权检查名单：model.cjs:5](/home/say/work/github/openmind-app/scripts/ui-contract/model.cjs:5)

**影响**

修改共享控件后，各页面可能继续保持各自的外观。新增页面仍需要参考和复制已有页面的控件样式，增加视觉调整与回归成本。

**建议**

为现有差异补充语义化变体，保留基础类，收回 feature 中的控件外观定义；将这些控件纳入单一 CSS owner、静态检查和视觉目录。迁移时比较已有页面的实际效果，保留合理的设计差异。

### 2.3 [P2] 项目文件页复用完整业务容器，造成重复请求和状态

**现象与证据**

`ProjectFilesPanel` 已读取资料与产物列表，并维护当前选择；详情区域又复用完整的 `ProjectMaterialsPanel` 或 `ProjectOutputsPanel`，且以文件路径作为组件 `key`。

切换文件会重挂载子面板，而子面板仍会读取该类别的完整列表、维护自己的选中项。

- [父组件加载列表：ProjectFilesPanel.tsx:85](/home/say/work/github/openmind-app/renderer/src/features/projects/ProjectFilesPanel.tsx:85)
- [按文件路径重挂载子面板：ProjectFilesPanel.tsx:338](/home/say/work/github/openmind-app/renderer/src/features/projects/ProjectFilesPanel.tsx:338)
- [资料子面板再次加载列表：ProjectMaterialsPanel.tsx:98](/home/say/work/github/openmind-app/renderer/src/features/projects/ProjectMaterialsPanel.tsx:98)
- [产物子面板再次加载列表：ProjectOutputsPanel.tsx:162](/home/say/work/github/openmind-app/renderer/src/features/projects/ProjectOutputsPanel.tsx:162)

**影响**

文件切换额外触发列表 IPC，父子组件分别管理列表、选择与刷新协调。该结论来自加载和挂载路径核查，本次没有测量真实大型项目的延迟。

**建议**

拆出资料详情、产物详情及相应 controller，让列表与选择状态只有一个管理者。独立页面可以再组合列表与详情；详情组件只加载当前文件所需的数据，并保留未保存修改的导航保护。

### 2.4 [P2] 组件组合后的键盘导航仍有缺口

**现象与证据**

使用生产组件的隔离场景已最小复现：项目页当前选中 Materials，从新增菜单按 Tab 后，焦点落到未选中的 Tasks，目标元素的 `aria-selected=false`、`tabIndex=-1`。

菜单自行查询下一按钮时，选择器中的 `button:not([disabled])` 仍会包含 `tabIndex=-1` 的按钮，也没有统一过滤隐藏或 inert 元素。Select 内还存在同类实现。

- [DropdownMenu 焦点逻辑：controls.tsx:280](/home/say/work/github/openmind-app/renderer/src/design-system/controls.tsx:280)
- [Select 的同类实现：Select.tsx:304](/home/say/work/github/openmind-app/renderer/src/design-system/Select.tsx:304)
- [真实菜单与 Tabs 组合：ProjectsPage.tsx:399](/home/say/work/github/openmind-app/renderer/src/features/projects/ProjectsPage.tsx:399)

**影响**

单个控件测试通过，仍不能保证控件组合符合页面的 Tab 顺序和 roving tabindex 约定。

**建议**

统一“下一可参与 Tab 导航元素”的基础能力，补充菜单与 Tabs、隐藏区域、inert 区域的组合测试。复现采用内存 esbuild + JSDOM 场景，本次没有执行真实屏幕阅读器验证。

### 2.5 [P2] 通用应用反馈与 AI 业务上下文耦合

**现象与证据**

`AiUiValue` 同时包含 `notify/confirm`、发送状态、AI 面板模式与项目对话目标。微信设置等非 AI 功能也通过 `useAiUi` 获取通用反馈能力；反馈宿主本身同样依赖 AI 上下文。

- [混合的状态接口：ai-context.tsx:89](/home/say/work/github/openmind-app/renderer/src/ai-context.tsx:89)
- [反馈宿主依赖：FeedbackHost.tsx:16](/home/say/work/github/openmind-app/renderer/src/components/FeedbackHost.tsx:16)
- [非 AI 功能的依赖：WechatSettingsSection.tsx:19](/home/say/work/github/openmind-app/renderer/src/features/wechat/WechatSettingsSection.tsx:19)

**影响**

非 AI 功能的独立挂载和测试需要 AI 上下文，并订阅不相关的 AI UI 状态。现有 AI 状态分片已经降低部分更新成本，但应用级反馈边界尚未独立。

**建议**

抽出应用级反馈 Provider，区分稳定的提示、确认命令接口和 toast/confirm 状态订阅。AI 发送状态、面板模式与对话目标继续归 AI 模块管理。

## 3. 已经成熟的能力

- **公共控件契约已经建立。** Button、Input、Select、Dialog 等具备公共入口、类型化变体和明确样式归属。相关检查真正接入构建，另有负例验证约束能阻止违规实现。见 [UI_COMPONENT_CONTRACT.md](/home/say/work/github/openmind-app/docs/UI_COMPONENT_CONTRACT.md)。
- **复用覆盖公共交互。** 弹层关闭、焦点恢复、退出动画等已有共享机制；表单测试覆盖 busy 状态、原生校验、输入 DOM 身份和嵌套 Escape 等行为。
- **文件预览有清晰的业务分层。** source、capabilities、controller、renderer 分离，不同调用场景提供适配器。该模式适合推广到其他跨场景业务组件。见 [model.ts:92](/home/say/work/github/openmind-app/renderer/src/features/file-preview/model.ts:92)、[PreviewRenderer.tsx:24](/home/say/work/github/openmind-app/renderer/src/features/file-preview/PreviewRenderer.tsx:24)。
- **状态订阅已考虑更新频率。** AI snapshot、events、UI、actions 已分片，草稿使用按 key 订阅的 external store，避免每次输入广播全应用。见 [ai-context.tsx:60](/home/say/work/github/openmind-app/renderer/src/ai-context.tsx:60)、[ai-context.tsx:1086](/home/say/work/github/openmind-app/renderer/src/ai-context.tsx:1086)。
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
