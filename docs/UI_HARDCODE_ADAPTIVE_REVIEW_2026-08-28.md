# OpenMind UI Hardcode 与适应性布局 Review

- 日期：2026-08-28
- 仓库：`/home/say/work/github/openmind-app`
- 范围：Renderer UI、响应式布局、弹出层、导航交互、文案与业务规则硬编码
- 方式：先完成只读 Review，再按本报告方案实施、补门禁并验证
- 当前状态：本报告列出的可执行项已完成，最终验证通过

## 结论

本报告最初识别出的功能错误、双控制源、错误 viewport 所有权、浮层定位、文案硬编码和视觉覆盖缺口已经完成治理。最终实现没有追求“消灭所有 px 或所有组件断点”，而是将应用级 composition、组件级内容临界点和测试场景分别交给明确的状态所有者。

最终视觉门禁覆盖 11 个 viewport、5 个生产主页面、55 张基础截图和 72 个状态契约，失败为 0。全量 139 个测试文件、1587 个 unit 用例、integration smoke、Electron E2E、build、静态审计和 `git diff --check` 均在 Node.js 22.12.0 下通过。

## 实施结果（2026-08-28）

| 原问题 | 实施结果 | 主要落点 |
| --- | --- | --- |
| Global Search 内容与 Skill 结果落错页面 | 内容结果消费真实 `path` 并打开 Workspace 文件预览；Skill 结果进入指定 Skill 详情；增加 `GlobalSearch -> App -> 最终页面` 测试 | `renderer/src/app/GlobalSearch.tsx`、`renderer/src/App.tsx`、`renderer/src/app/route-registry.tsx`、对应测试 |
| 搜索意图与 Prompt 固定在组件 | 意图 pattern、显示文案和 Prompt 模板集中到共享消息层，同时支持英文 summary/compare 表达 | `shared/messages/zh-CN/app.ts`、`renderer/src/app/GlobalSearch.tsx` |
| Creative `/` 菜单固定在编辑器顶部 | 使用 CodeMirror caret 虚拟锚点、Portal 和共享 anchored popover；滚动、resize 时重定位并支持视口翻转/钳制 | `renderer/src/features/creative/MarkdownEditor.tsx`、`renderer/src/styles/features/creative.css` |
| Settings 620px 规则误读 viewport | Provider 等嵌套表单改由内容容器 query 决定排列 | `renderer/src/styles/features/settings.css` |
| 多套本地浮层算法 | `DropdownMenu`、Provider Menu、ResponsiveActionBar、Composer ChipSelect、ContentSelectionQuote 统一接入 anchored popover；补键盘导航、Portal、外部点击和焦点恢复 | `renderer/src/design-system/controls.tsx`、`renderer/src/components/ContentSelectionQuote.tsx`、`renderer/src/features/ai-console/composer.tsx` |
| Skills 的 JS/CSS 双份 1100px | 删除 viewport `matchMedia` 和 CSS 1100px 路径，使用 `SKILLS_SPLIT_MIN_INLINE_SIZE=860` 的容器语义 `split/stacked`，CSS 与滚动交互消费同一状态 | `renderer/src/features/skills/SkillsPage.tsx`、`renderer/src/styles/features/skills.css` |
| Skills loading 后晚挂载导致未测量 | 共享 Hook 改为 callback ref，在节点出现或替换时重新订阅 `ResizeObserver`；使用 border-box 作为阈值盒模型并增加回归测试 | `renderer/src/design-system/use-container-layout-mode.ts`、对应测试 |
| AiWorkbench 的 inline grid 与 980px `!important` 双控制源 | `file-preview-layout.ts` 单独拥有 980px 内容临界点与 pane 常量；React 渲染 `split/preview-only` 结构，删除 CSS 强制覆盖；补进入/退出焦点迁移 | `renderer/src/features/ai-console/AiWorkbench.tsx`、`renderer/src/features/ai-console/file-preview-layout.ts`、`renderer/src/styles/features/ai-console.css` |
| 应用尺寸重复与旧导航规则 | AppShell 从 responsive policy 输出语义 CSS variables；删除无消费者 `.nav/.nav-collapsed` 和 64/60px 冲突路径，CSS fallback 消费共享变量 | `renderer/src/app/AppShell.tsx`、`renderer/src/styles.css`、`renderer/src/styles/shell.css`、`renderer/src/styles/workbuddy-refactor.css` |
| 原生 `window.confirm` | AiWorkbench、Automation、Runs 统一使用应用 Confirm contract，保持焦点范围、键盘和视觉一致性 | `renderer/src/ai-context.tsx`、`renderer/src/features/automation/AutomationPage.tsx`、`renderer/src/features/runs/RunsPage.tsx` |
| 用户可见中文文案散落 | 生产 Renderer 组件中的直接中文 UI 字面量收口到 `@shared/messages`；增加静态审计。`browser-api.ts` 作为独立预览 fixture 数据集明确排除 | `shared/messages/zh-CN/*.ts`、`scripts/audit-ui-copy-hardcode.js` |
| 720×600 与组件断点覆盖不足 | 视觉矩阵增加 720×600 全生产主页面、839/840/841、1479/1480/1481、Skills 859/860/861、AI Preview 979/980/981、Popover、焦点恢复和 onboarding 第二窗口 | `scripts/visual-snapshot-electron.js`、`scripts/visual-snapshot-preload.js` |

### 保留但不视为未完成项的内容

- CSS 中仍允许组件拥有且有明确内容约束的 media/container query；不按“数字接近”机械合并到四个应用级断点。
- `renderer/src/styles/workbuddy-refactor.css` 中仍有一处 `.ui-metric-card::after { display: none !important; }`。它只关闭装饰伪元素，不参与布局状态或对抗 React inline style，因此不属于本报告治理的双控制源。
- 720×600、860px 和 980px 仍是固定值，但分别属于产品窗口契约、Skills 内容临界点和 AI Preview 内容临界点，均有单一所有者与边界测试。

## 原始 Review 发现（实施前证据）

以下章节保留实施前的代码证据和判断过程，便于理解改造原因；其中描述的“当前行为”不再代表最终代码状态，完成情况以上方实施结果为准。

### [P1] 全局搜索结果跳转存在明确错误

证据：

- `renderer/src/app/GlobalSearch.tsx:145-155`
- `renderer/src/App.tsx:92-99`
- `renderer/src/features/automation/AutomationPage.tsx:423-424`
- `shared/contracts.ts:629-638`
- `renderer/src/app/GlobalSearch.test.tsx:111-146`

当前行为：

1. 内容结果执行 `navigate("sources", { date })`。
2. `App` 会拦截 `sources`，将它打开为 Settings 的 Skills 区域，日期也不会被实际消费。
3. 搜索结果 contract 已提供 `path`，但 UI 没有使用它，因此无法打开匹配到的内容。
4. Skill 结果被导航到 Automation；如果没有匹配该 Skill 的 Rule，Automation 会回退选择第一条 Rule，可能展示完全无关的自动化规则。
5. 当前单元测试只验证 `GlobalSearch` 发出的局部导航参数，没有验证经过 `App` 后的最终页面，所以错误行为也能通过测试。

建议：

- 统一 `GlobalSearchResult.kind` 到最终页面的导航契约。
- 内容结果应消费 `path`，打开对应内容或内容预览，而不是进入 Skills 设置。
- Skill 结果应明确进入 Skill 详情；如果产品仍要求进入 Automation，则不得回退到无关 Rule。
- 增加覆盖 `GlobalSearch -> App.navigate -> 最终页面` 的集成测试。

### [P2] Creative `/` 命令菜单没有跟随光标

证据：

- `renderer/src/features/creative/MarkdownEditor.tsx:242-278`
- `renderer/src/styles/features/creative.css:1186-1199`

`MarkdownEditor` 将菜单渲染在编辑器容器中，但 CSS 将其固定为：

```css
left: clamp(24px, 6vw, 76px);
top: 18px;
```

菜单位置与 CodeMirror 当前 caret 的几何位置无关。在长文档或编辑器已经滚动后输入 `/`，菜单仍会出现在编辑器顶部，而不是输入位置附近。

建议读取 caret 坐标，并使用支持垂直翻转、视口钳制和滚动重定位的浮层定位逻辑。

### [P2] Settings 窄布局判断了整窗宽度，而不是右侧内容区宽度

证据：

- `shared/responsive-policy.ts:17-20`
- `renderer/src/styles/features/settings.css:54-68`
- `renderer/src/styles/features/settings.css:200-220`
- `renderer/src/styles/features/settings.css:1387-1426`
- `renderer/src/styles/features/settings.css:2156-2188`

应用正式窗口的最小宽度是 720px。在该宽度下，Settings 仍保留 184px 左侧导航，再扣除 margin 和 padding，右侧实际内容宽度约为 492px。

但是 Provider 操作区、两列表单和三列高级配置的窄布局使用：

```css
@media (max-width: 620px)
```

这个条件判断的是整个 viewport。正常 100% 缩放下，正式窗口不会低于 720px，因此该规则基本不可达；右侧内容已经很窄时，内部组件仍可能保持桌面排列。

建议将这组规则改成基于 `.settings-detail` 或 `.settings-card-body` 的 container query。

### [P2] 多套弹出菜单没有使用共享自适应定位层

仓库已有 `renderer/src/design-system/use-anchored-popover.ts`，支持：

- Portal 渲染
- 上下翻转
- 视口边缘钳制
- 可用高度限制
- `ResizeObserver`
- `window` 和 `visualViewport` resize/scroll 重定位

目前仍未迁移的组件包括：

#### Provider “更多”菜单

证据：

- `renderer/src/features/settings/settings-sections.tsx:963-971`
- `renderer/src/styles/features/settings.css:1933-1946`

菜单使用 `position: absolute` 和 `top: calc(100% + 6px)`，只能向下展开，没有翻转、视口钳制或最大可用高度。位于列表底部时可能被滚动容器裁切。

#### ResponsiveActionBar Dropdown

证据：

- `renderer/src/design-system/ResponsiveActionBar.tsx:139-169`
- `renderer/src/styles/components.css:176-205`

这是通用组件，但 Dropdown 同样固定向下展开，不具备 viewport clamp/flip，因此通用性和组件名称表达的“Responsive”能力不一致。

#### Composer ChipSelect

证据：

- `renderer/src/features/ai-console/composer.tsx:919-975`
- `renderer/src/styles/features/ai-console.css:1904-1952`
- `renderer/src/styles/workbuddy-refactor.css:2566-2573`

基础样式固定向下展开，后加载样式又将 Provider、Permission、Mode 菜单固定为向上展开。它没有根据实时空间选择方向，也没有最大高度和视口钳制；Provider 数量较多或窗口高度较低时可能越界。

#### 内容选区“引用到 AI”按钮

证据：

- `renderer/src/components/ContentSelectionQuote.tsx:40-47`
- `renderer/src/components/ContentSelectionQuote.tsx:100-105`

定位逻辑使用 `72` 和 `44` 作为按钮尺寸及边距假设，没有测量浮层实际尺寸。文案、字体、缩放或本地化变化后，钳制结果可能不再正确。

建议以上组件统一复用 `useAnchoredPopover`，避免继续维护多套互不一致的定位算法。

### [P3] Skills 的布局与交互仍依赖 viewport 和固定高度推算

证据：

- `renderer/src/features/skills/SkillsPage.tsx:229-234`
- `renderer/src/styles/features/skills.css:39-50`
- `renderer/src/styles/features/skills.css:771-823`

问题包括：

- 选择 Skill 后是否滚动到详情，使用 `window.matchMedia("(max-width: 1100px)")` 判断整窗宽度，而不是 Skills 组件的实际宽度。
- 主布局高度使用 `clamp(520px, calc(100vh - 250px), 760px)`，依赖固定的 `250px` 页面占用假设。
- Skills 嵌入 Settings 后，真正决定可用空间的是 Settings 右侧内容区，而不是整个 viewport。
- `.skills-detail` 虽然已经声明 `container-type: inline-size`，但现有 container query 主要覆盖 Sources 工具栏，尚未接管整体布局和选择后的滚动交互。

这类问题当前没有在视觉门禁中形成明确溢出失败，属于潜在适应性债务。

### [P3] 响应式语义常量仍存在多份硬编码

统一策略定义在：

- `shared/responsive-policy.ts:6-20`

但相同语义值仍散落在：

- `renderer/src/app/AppShell.tsx:148-151`：再次写入 `60px` 和 `260px`
- `renderer/src/styles.css:105-108`：再次写入 `380px`、`760px`、`430px`
- `renderer/src/styles.css:107`：`calc(33.333% - 86.667px)` 隐式反推导航宽度
- `renderer/src/styles/shell.css:1-23`：fallback 导航宽度仍为 `236px`
- `renderer/src/styles/workbuddy-refactor.css:2898-2917`：后加载样式又使用 `260px` 覆盖

当前最终效果依赖 CSS 导入和级联顺序。后续调整导航、工作区或 AI Sidebar 尺寸时，很容易只更新其中一处，从而产生启动阶段闪动或不同页面尺寸漂移。

建议由共享 responsive policy 统一向 App 根节点输出 CSS variables，CSS 只消费变量，不再维护多套 fallback 数值。

### [P3] 全局搜索意图识别和 Prompt 是固定中文规则

证据：

- `renderer/src/app/GlobalSearch.tsx:26-64`

当前通过固定正则识别总结、写作和对比意图，并直接在 Renderer 中拼接 Prompt：

- 总结：`总结|摘要|归纳|要点|概览|梳理`
- 写作：`小红书|公众号|推文|开头|写一|起草|改写|...`
- 对比：`对比|比较|区别|异同|vs|VS`

影响：

- 英文及未命中关键词的自然表达无法触发动作。
- Prompt、产品规则和 UI 代码耦合。
- 后续修改 Prompt 需要发布 Renderer。
- `PaletteAction` 的能力声明与实际可识别意图容易逐渐不一致。

建议至少将意图规则、Prompt 模板和显示文案集中管理；若未来支持多语言，应避免直接依赖固定中文关键词。

### [P3] UI 文案仍有较大范围直接硬编码

对非测试 TS/TSX 的直接中文字符串和模板字符串进行静态扫描，共有 33 个源码文件命中。较集中的 UI 模块包括：

- `renderer/src/features/settings/settings-sections.tsx`：约 88 行
- `renderer/src/features/automation/AutomationPage.tsx`：约 74 行
- `renderer/src/features/skills/SkillsPage.tsx`：约 64 行
- `renderer/src/features/creative/CreativePage.tsx`：约 29 行
- `renderer/src/features/daily-brief/DailyBriefPage.tsx`：约 21 行

项目已经存在 `@shared/messages`，但尚未完全收口。影响主要是：

- 本地化困难
- 文案一致性难以统一检查
- 相同提示在不同页面产生变体
- 业务提示、无障碍标签、Toast 和确认文案散落在组件代码中

这些字面量不全是缺陷，应优先迁移用户可见文案、ARIA 标签、错误提示和业务规则文本，而不是机械替换所有字符串。

### [P3] 部分确认交互仍使用原生 `window.confirm`

证据：

- `renderer/src/features/ai-console/AiWorkbench.tsx:120-126`
- `renderer/src/features/automation/AutomationPage.tsx:377-380`
- `renderer/src/features/runs/RunsPage.tsx:105`

这些交互绕过了应用内 Confirm 的样式、焦点范围、键盘交互和视觉门禁。`RunsPage` 当前没有生产入口，因此不应将它升级为当前可见产品缺陷，但仍属于代码一致性债务。

建议统一使用设计系统 Confirm；Automation 中的删除确认文案也应从组件内模板字符串迁移到共享消息层。

## 本轮验证结果

全部命令使用 Node.js 22.12.0 执行。

### 构建与自动化测试

- `npm run build`：通过；包含 typecheck、repoRoot 审计、Skill manifest 校验、Renderer/Electron build。
- `npm run test:unit`：139 个测试文件、1587 个用例全部通过。
- `npm run test:integration`：通过；隔离 fixture 中 article、post、summary 数据链路正常。
- `npm run test:e2e`：通过；Electron 文档加载、workspace root、内容读取、文件搜索和主题状态正常。
- `git diff --check`：通过。

### 静态 Hardcode 审计

- `npm run audit:responsive-hardcode`：扫描 101 个生产 Renderer 文件；未发现布局双控制源，只有 1 个明确允许的装饰伪元素 `display:none!important`。
- `npm run audit:ui-copy-hardcode`：扫描 85 个生产 Renderer TS/TSX 文件；直接中文 UI 字面量 0。
- 审计仍输出 69 条 CSS query declaration、37 种 query，作为后续新增代码的可比较清单；数量本身不作为失败条件。

### 最终视觉门禁

- `npm run visual:snapshot`：通过。
- 基础截图：55，来自 11 个 viewport × 5 个生产主页面。
- 状态截图/契约：72。
- 失败：0。
- 关键通过项：
  - 720×600 的 AI、Daily Brief、Creative、Automation、Settings 和 onboarding。
  - 839/840/841 Shell 边界与 1479/1480/1481 Workspace 边界。
  - Skills 859/860/861 的 `stacked/split/split` 语义、双 pane 可达和零水平溢出。
  - AI Preview 979/980/981 的 `preview-only/split/split` 结构、Splitter 所有权和零水平溢出。
  - Provider Menu 的 Portal、视口包含、操作可达和菜单内焦点。
  - AI Preview 关闭后焦点恢复到 conversation。

### Resize 性能结果

- Fixture：1000 个事件、14754 个 DOM 节点
- 请求宽度：2040px -> 1800px
- 请求步骤：121
- 浏览器实际观察到的 resize 事件：26
- 帧采样：79
- p50：16.7ms
- p95：16.7ms
- 最大帧间隔：16.8ms
- 超过 20ms：0 次
- Long task：0

浏览器对连续 resize 事件进行了合并，因此该结果可以说明当前路径没有明显 long task，但不能证明每一个中间宽度都执行了独立布局更新。

### 验证边界

- 视觉门禁使用确定性 preload fixture，不等同于真实第三方 Provider 或真实用户数据验收。
- Resize 结果证明当前 fixture 下没有 long task 或掉帧信号，但 Chromium 会合并连续 resize 事件，因此不代表 121 个请求宽度都产生独立布局提交。
- 工作区包含用户已有的未提交 Electron/Skill 修改和旧文档删除；实施过程保留这些修改，没有还原、提交或推送。

## 不应归类为缺陷的固定行为

以下行为属于已确认的产品设计，不应作为响应式缺陷重复上报：

- Daily Brief 首次进入时自动打开 AI。
- 窄屏单画布优先显示 AI。
- Markdown 表格在自身容器内横向滚动。
- 当前没有生产入口的 Runs 页面问题，不作为当前用户路径的高优先级缺陷。

以下固定尺寸通常具有明确设计语义，也不应仅因为使用 px 就判断为 hardcode 缺陷：

- 图标尺寸
- 44px 点击区域
- 边框和圆角
- 可读行宽
- Electron 正式窗口最小尺寸

真正需要治理的是重复表达同一业务语义的尺寸、依赖未知容器尺寸的绝对定位、按 viewport 判断嵌套组件布局，以及会改变业务结果的固定路由和关键词规则。

## 原建议处理顺序（已执行）

1. 修正 Global Search 内容和 Skill 结果的最终导航契约，并补集成测试。
2. 让 Creative `/` 菜单跟随 caret 定位。
3. 将 Settings 的 620px 窄布局切换为 container query。
4. 将 Provider Menu、ResponsiveActionBar Dropdown、ChipSelect 和选区引用按钮迁移到共享 anchored popover。
5. 让 Skills 使用自身容器的统一布局状态，删除 JS/CSS 双份 `1100px` 控制。
6. 收口 AiWorkbench 文件预览分栏的状态所有权，删除 `980px + !important` 对 inline grid 的覆盖。
7. 将全部有生产入口的页面纳入 720×600 基础视觉门禁，并补充关键断点前后状态。
8. 统一 responsive policy 与普通 CSS dimensions，清理 `236/260/380/430/760` 等重复语义常量。
9. 再分批处理 `window.confirm`、中文关键词、Prompt 和用户可见文案硬编码。

## Hardcode 的工程判断

成熟客户端并不追求“代码里没有固定数值”。响应式布局最终一定需要尺寸、阈值和约束。真正需要治理的是数值有没有稳定语义、是否只有一个所有者，以及布局和交互是否消费同一状态。

| 类型 | 当前示例 | 工程判断 |
| --- | --- | --- |
| 产品契约 | 最小窗口 720×600 | 合理固定值，应集中定义并进入门禁 |
| 设计约束 | 导航 260px、rail 60px | 合理，但不能散落多份 |
| 内容临界点 | 两栏放不下时切单栏 | 合理，应由对应组件拥有 |
| 重复魔法数 | Skills 的 JS/CSS 各写 1100px | 需要治理 |
| 双控制源 | AiWorkbench 的 inline grid 与 CSS `!important` | 需要治理 |
| 误用 viewport | 嵌套在 Settings 中的 Skills 读取 `window.innerWidth` | 需要治理 |
| 测试场景 | 720×600 视觉快照 | 合理，不属于产品 UI hardcode |

判断一个固定值能否保留，可以使用以下规则：

1. 能否说明它对应的产品或内容约束。
2. 是否有唯一、可搜索的定义位置。
3. 修改时是否只需要更新一个事实来源。
4. CSS 呈现和 JS 交互是否由同一语义状态驱动。
5. 是否有边界前后与最小合法尺寸的自动化验证。

只要其中多项不满足，该数值就不是普通设计常量，而是需要治理的 magic number。

## 为什么当前会形成多套布局控制

这类代码通常来自连续迭代，而不是一次性设计：

1. 初期用 CSS media query 快速实现窗口响应。
2. 后续增加滚动到详情、焦点迁移、隐藏分隔条等 JS 交互。
3. 为了让 JS 与 CSS 同步，在两边复制同一个断点。
4. 再加入用户可拖拽分栏，React 开始通过 inline style 控制 grid。
5. CSS media query 无法覆盖 inline style，于是增加 `!important`。
6. 新页面继续增加本地断点，最终形成全局策略、CSS 和 React 三套控制源。

这是行业中常见的技术债形成方式，但不应作为最终架构保留。长期风险包括：

- CSS 已切换布局，JS 仍按旧布局执行滚动或焦点逻辑。
- 组件嵌入侧栏后，viewport 很宽但组件本身已经很窄。
- 动画过程中出现 splitter、ARIA 状态和实际可见区域不一致。
- 修改一处断点时遗漏另一处。
- 为解决级联问题继续叠加更高 specificity 和 `!important`。

## 行业通用的响应式分层

建议将 OpenMind 的响应式职责分成三层，而不是把所有断点强制收敛为四个全局值。

### 第一层：应用级布局策略

所有者：`shared/responsive-policy.ts` 与 `renderer/src/app/responsive-layout.tsx`。

只负责真正影响整个应用 composition 的状态：

- Electron 最小窗口尺寸。
- Navigation 的 expanded、rail、drawer。
- AI Companion 的 docked、compact、overlay、canvas。
- 主工作区 split、single。
- 全局 density。
- 全局操作栏 full、compact、minimal。

React 应将结果输出成语义类或 `data-*` 状态：

```html
<div
  data-shell="drawer"
  data-companion="canvas"
  data-workspace="single"
  data-density="narrow"
>
```

CSS 消费已经计算好的语义，不重复推导全局 breakpoint。

普通尺寸可以通过根 CSS variables 输出，例如：

```css
--navigation-expanded-width: 260px;
--navigation-rail-width: 60px;
--workspace-min-width: 760px;
--companion-min-width: 380px;
```

注意：CSS 自定义属性不能直接用于 media query 条件。下面的写法在当前 Chromium 中无效：

```css
@media (max-width: var(--shell-drawer)) {
  /* invalid */
}
```

如果 CSS 必须共享全局查询值，应使用构建期生成的 `@custom-media` 或生成 CSS 文件；现阶段更推荐继续使用 React 语义类。

### 第二层：组件级适应性布局

所有者：Settings、Skills、Automation、AiWorkbench、Composer 等具体组件。

组件内部是否改单栏，应根据组件自身可用空间决定，而不是强行对齐 Shell 的 1760/1480/840/720 四档。

推荐规则：

- 只有视觉呈现变化：优先 container query。
- 涉及滚动、焦点、ARIA、渲染分支：使用 `ResizeObserver` 或共享容器布局 Hook 产生语义状态。
- React 输出 `data-layout="split|stacked"`，CSS 和交互共同消费该状态。
- breakpoint 根据内容最小可用宽度推导，并使用有语义的命名常量。
- 禁止 feature component 直接通过 `window.innerWidth` 推导嵌套布局。

组件断点可以是 980、1100 或其他数值；它们不需要与全局四档相等，但必须有单一所有者和可解释来源。

### 第三层：验证契约

测试不负责重新发明一套断点，而是验证前两层承诺：

- 正式最小窗口尺寸。
- 全局语义断点前后。
- 组件临界点前后。
- 125% 与 150% 缩放。
- 长文本、长路径、大列表和弹出层。
- 键盘、焦点、滚动所有权和按钮可达性。

## Skills 1100px 的完整改造方案

### 当前问题

当前至少存在两个状态所有者：

- `renderer/src/styles/features/skills.css:776` 用 1100px 切换单双栏。
- `renderer/src/features/skills/SkillsPage.tsx:229-234` 用 1100px 决定点击后是否滚动详情。

Skills 嵌在 Settings 右侧时，窗口宽度不等于组件宽度。例如窗口 1200px 时，扣除 Settings 导航、margin 和 padding 后，Skills 实际可用宽度可能已经低于双栏要求，但 JS 仍认为是宽屏。

### 目标状态

定义组件拥有的布局语义：

```ts
type SkillsLayoutMode = "split" | "stacked";
```

布局状态只从 Skills 根容器的实际 inline size 得出。

推荐实现：

1. 给 Skills 主布局增加稳定的 root ref。
2. 使用共享 `useContainerLayoutMode` 或局部 `ResizeObserver` 读取容器宽度。
3. 将临界点命名为 `SKILLS_SPLIT_MIN_INLINE_SIZE`，并根据 catalog 最小宽度、detail 最小宽度、gap 和安全余量推导。
4. React 输出 `data-layout="split|stacked"`。
5. CSS 使用该状态控制 grid，而不再维护独立的 1100px media query。
6. `selectItem` 直接读取 `layoutMode === "stacked"` 决定是否滚动详情。
7. 切换到 stacked 时保留当前选中项；滚动后将焦点保持在用户选择的 Skill 或详情标题，避免无障碍焦点丢失。

示意：

```tsx
const { ref, mode } = useContainerLayoutMode({
  splitMinInlineSize: SKILLS_SPLIT_MIN_INLINE_SIZE
});

return (
  <section ref={ref} className="skills-page" data-layout={mode}>
    {/* catalog and detail */}
  </section>
);
```

```css
.skills-page[data-layout="split"] .skills-layout {
  grid-template-columns: minmax(300px, 340px) minmax(0, 1fr);
}

.skills-page[data-layout="stacked"] .skills-layout {
  grid-template-columns: 1fr;
}
```

### 验收标准

- Skills 源码中不再出现布局用途的 `window.matchMedia("(max-width: 1100px)")`。
- CSS 与 JS 不再各自维护 1100px。
- 在相同 viewport 下，通过改变 Settings 左栏或宿主容器宽度，可以正确触发 Skills stacked 状态。
- stacked 模式选择 Skill 后详情可达，键盘焦点不丢失。
- split/stacked 临界点前后均无水平溢出。

## AiWorkbench 文件预览分栏的完整改造方案

### 当前问题

当前存在两个互相竞争的布局所有者：

- React 根据 `previewRatio` 输出 inline `grid-template-columns`。
- `renderer/src/styles/features/ai-console.css:1727-1740` 在 980px 以下使用 `!important` 改成一列，并通过 `display: none` 隐藏 conversation 和 splitter。

视觉结果虽然可能正确，但 React 仍保持 split 状态，CSS 只是从外部覆盖其呈现。这会让渲染、动画、持久化、splitter ARIA 和实际可见布局存在不同步风险。

### 目标状态

定义 AiWorkbench 自己拥有的预览布局语义：

```ts
type FilePreviewLayoutMode = "split" | "preview-only";
```

临界点根据内容约束推导：

```text
Conversation 最小可用宽度
+ Splitter 宽度
+ Preview 最小可用宽度
+ 安全余量
= Preview split 最低容器宽度
```

该值可以仍然接近 980px，但必须命名并由 `file-preview-layout.ts` 单独拥有，而不是继续散落在 CSS。

推荐实现：

1. 扩展 `file-preview-layout.ts`，集中管理 preview ratio、split 最小宽度、clamp 和 storage schema。
2. 使用 `workbenchRef` 的 `ResizeObserver` 得到实际容器宽度。
3. React 计算 `filePreviewLayoutMode`。
4. split 模式渲染 conversation、ColumnSplitter 和 preview。
5. preview-only 模式不再渲染可交互 splitter；conversation 应隐藏并正确设置 inactive/inert 状态，或直接不进入该渲染分支。
6. 删除 CSS 中 `980px + !important` 对 inline grid 的覆盖。
7. 用户保存的 ratio 只在 split 模式生效；回到 split 后恢复原比例。
8. 进入 preview-only 时将焦点迁移到 Preview header 或关闭按钮；退出后恢复到触发预览的上下文。

不建议直接用全局 `workspaceSingle=1480` 替换 980px。当前 `workspaceSingle` 主要服务 Creative 主从画布，而文件预览有独立的内容约束。正确方向是组件容器语义，不是将所有组件塞入一个全局断点。

### 验收标准

- AiWorkbench 不再使用 `!important` 覆盖 React inline grid。
- React 的渲染结构、ARIA 和实际可见布局保持一致。
- Splitter 只在 split 模式可见、可聚焦和可操作。
- preview-only 与 split 切换时 ratio 可恢复。
- 临界宽度前后没有短暂重叠、零宽 pane 或焦点进入隐藏区域。
- 低高度与 125%/150% 缩放下 Preview header 和关闭操作仍可达。

## 720×600 全生产页面门禁方案

### 为什么它不是坏 hardcode

720×600 来自 `DESKTOP_WINDOW_MIN_SIZE`，是用户能够实际达到的正式窗口下限。只要应用允许这个尺寸，生产页面就必须保持可用。因此测试该尺寸是在验证产品契约，而不是针对某台设备写魔法数。

测试值应尽可能从与正式窗口相同的数据源生成。可选实现包括：

- 将纯数值放在 Renderer、Electron 和 Node 测试脚本都可读取的共享 JSON/JS policy 中。
- 在 build 后让视觉脚本读取已编译的 responsive policy。
- 由构建脚本生成测试场景 manifest。

不应让 Electron、Renderer 和视觉脚本分别手写一份 720×600。

### 基础路由矩阵

所有有生产入口的主页面至少执行一次 720×600 基础检查：

- AI
- Daily Brief
- Creative
- Automation
- Settings

`sources`、`skills`、`projects` 如果只是现有页面的路由别名，不需要重复完整矩阵，但应验证别名最终落地正确。`runs` 在没有生产入口前不计入主页面门禁。

Settings 应额外覆盖高风险 section：

- Providers
- Skills
- Browser Token
- Permissions/Runtime 中包含长路径或复杂操作行的区域

### 每个页面的最低几何断言

- `documentElement` 没有意外水平溢出。
- 主内容区域宽高大于零。
- 页面主标题与主要操作可见。
- 关键按钮中心点没有被其他元素遮挡。
- 页面存在内容溢出时，有明确滚动 owner。
- 最后一个关键操作可以通过滚动到达。
- 弹窗、菜单和浮层不越出 visual viewport。
- drawer/canvas/single 等语义状态符合预期。
- `aria-hidden`、`inert` 和视觉可见性一致。

### 边界矩阵

不需要对每个页面穷举所有宽度，但应对状态机边界做 ±1 验证：

- 839/840/841：Shell drawer 和 Companion canvas 边界。
- 1479/1480/1481：全局 workspace single 边界。
- 1759/1760/1761：Companion compact/docked 边界。
- Skills split 临界点 ±1：通过改变 Skills 容器宽度测试。
- AiWorkbench preview split 临界点 ±1：通过改变 workbench 容器宽度测试。

720 以下的窗口宽度不是正式用户路径，但可以通过 zoom 或测试容器验证极端 CSS viewport；这类场景应标记为 robustness test，而不是正式窗口契约。

### 高度与缩放矩阵

- 所有生产主页面：720×600、100%。
- 关键页面：1280×600、100%。
- 高风险页面：1366×768、125% 与 150%。
- 弹窗、Select、Popover、Creative ready、AI Preview、Automation Rule 等状态使用 600px 高度专项验证。

当前不建议仅因为缺少全局高度档位就立即增加 `short/tall` 状态。应先补齐 600px 门禁，根据真实失败聚类：

- 如果问题主要来自内容不可达，修正 scroll owner、`min-height: 0` 和 overflow。
- 如果大量页面都需要相同的密度变化，再增加全局 short-height 语义。
- 如果只有单个组件失败，由组件自身使用 container size 或 block-size 规则处理。

### 视觉门禁验收标准

- 所有生产主页面 720×600 基础状态通过。
- 全局断点和两个组件断点的 ±1 状态通过。
- 现有 50 页面/60 状态门禁不回退。
- 截图之外保留真实 geometry、遮挡、滚动可达性和 ARIA 状态断言。
- 正式验收使用仓库要求的 Node.js 22.12+。

## CSS 断点治理规则

当前 CSS 中存在约 20 个不同的 width media threshold。数量本身不能证明设计错误，因为 Shell breakpoint 与组件内容 breakpoint 的职责不同。

治理时应先分类：

| 分类 | 示例 | 处理方式 |
| --- | --- | --- |
| 应用 composition | 1760/1480/840/720 | 由 responsive policy 和语义类控制 |
| 嵌套组件布局 | Settings、Skills、Automation、Composer | 优先 container query/容器状态 |
| 微观排版 | header、padding、操作栏换行 | 允许组件本地定义 |
| 高度适应 | 600px 最小窗口、低高度弹窗 | 先通过滚动与门禁验证，再决定是否全局化 |
| 遗留规则 | `.app/.nav/.nav-collapsed` | 消费者审计后删除 |

不采用“将 920/980/1080 全部就近改成四档”的机械方案。收敛标准应是语义相同，而不是数字相近。

建议增加静态检查脚本，先以报告模式运行：

- 搜索 feature component 中用于布局的 `window.innerWidth`。
- 搜索 feature component 中的 `matchMedia(max-width)`。
- 搜索通过 `!important` 覆盖 inline grid/flex/position 的规则。
- 搜索 `.app/.nav/nav-collapsed` 等无消费者 selector。
- 输出 media/container query 清单、文件、行号和所属组件。

减少误报时应允许：

- `prefers-reduced-motion`、主题和输入设备能力查询。
- 组件拥有且有测试的 container query。
- 有命名 policy 和明确注释的少量 viewport query。

## 导航遗留 CSS 清理方案

`styles.css` 中的 `.app/.nav/.nav-collapsed` 已没有当前 AppShell 消费者，但不能直接删除整个 `@media (max-width: 1280px)` 块，因为同一块内的 `.ai-workbench` 仍可匹配。

清理步骤：

1. 逐个 selector 搜索生产 TSX 消费者。
2. 删除确认无消费者的 `.app/.nav/.nav-collapsed/.nav-toggle` 规则。
3. 将仍生效的 `.ai-workbench` 规则迁移到 AI Console 专属 CSS。
4. 核对 `shell.css` 的 820px 旧导航规则与后加载 semantic drawer 规则。
5. 不以“64px 与 60px 当前冲突”为删除理由；当前 grid 已被 semantic drawer 覆盖。删除理由应是规则失去状态所有权、增加误导和未来回归风险。
6. 删除后重跑 839/840/841、rail 状态、用户手动 collapsed 和 drawer mobile-open 状态。

## 可复用布局基础设施

在 Skills 与 AiWorkbench 都需要 JS 语义状态的前提下，可以抽取小型、无业务含义的基础 Hook：

```ts
type ContainerLayoutMode = {
  inlineSize: number;
  mode: "wide" | "compact";
};

useContainerLayoutMode({
  compactBelow,
  onModeChange
});
```

该 Hook 只负责：

- `ResizeObserver` 生命周期。
- requestAnimationFrame 合并。
- 避免尺寸未变化时触发 React render。
- visualViewport/字体缩放后的重新测量。
- SSR/测试环境安全 fallback。

业务组件仍负责：

- breakpoint 的命名和来源。
- mode 对应的渲染分支。
- 焦点迁移。
- ratio 持久化。
- ARIA 和操作可达性。

分栏调宽可以进一步抽取 `useResizableSplit`，统一：

- ratio/px 模式。
- min/max bounds。
- pointer capture。
- Arrow/Home/End 键盘操作。
- Escape 取消。
- 双击恢复默认。
- localStorage schema 与版本迁移。

AiSidebar 和 AiWorkbench 的业务含义不同，不应强制共享同一份状态，但可以共享这些底层机制。

## 分阶段实施方案（已完成）

### Phase 0：建立基线

- 在 Node.js 22.12+ 重跑 build、unit、integration、e2e 和视觉门禁。
- 保存当前 CSS query/selector 清单。
- 增加全部生产主页面的 720×600 基础场景，但暂不修改布局。
- 将新增失败分类为已有基线问题，不和后续重构回归混在一起。

### Phase 1：消除双控制源

- Skills 改为容器布局状态，删除 JS/CSS 双份 1100px。
- AiWorkbench 改为 `split/preview-only` 状态，删除 980px `!important` 覆盖。
- 增加两个组件临界点 ±1、焦点和键盘测试。

### Phase 2：收口应用级尺寸

- AppShell 从 `RESPONSIVE_LAYOUT_BREAKPOINTS` 输出 60/260px。
- 普通 CSS declarations 统一消费根变量。
- 清理 236/260、380/430/760 等重复 fallback。
- 保留有独立内容约束的组件尺寸。

### Phase 3：清理遗留与弹出层

- 删除无消费者 `.app/.nav/.nav-collapsed` CSS。
- 将 Provider Menu、ResponsiveActionBar Dropdown、ChipSelect 和选区引用按钮迁移到 anchored popover。
- 修复 Creative Slash 菜单 caret anchoring。

### Phase 4：业务和文案 hardcode

- 修正 Global Search 导航契约。
- 将搜索关键词、Prompt 模板和用户文案从组件代码收口。
- 将原生 `window.confirm` 迁移到设计系统 Confirm。

## 总体验收结果

截至 2026-08-28，下列验收项均已满足：

- 应用级布局只有 responsive policy 一个状态来源。
- 嵌套功能布局基于自身容器，而不是默认读取 viewport。
- 同一布局行为不再由 JS 和 CSS 各维护一个 breakpoint。
- 不再通过 `!important` 对抗 React inline 分栏状态。
- Skills 和 AiWorkbench 的视觉、滚动、焦点与 ARIA 状态同步。
- 所有生产主页面在 720×600 保持关键操作可见或可滚动到达。
- 全局与组件断点边界 ±1 有自动化验证。
- 125%/150% 缩放下没有新增水平溢出、遮挡或不可达操作。
- 固定数值都有明确的 contract、token 或组件 policy 所有者。
- `npm run build`、全量 unit/integration/e2e、`npm run visual:snapshot` 和 `git diff --check` 在 Node.js 22.12+ 全部通过。
