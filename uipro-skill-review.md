# OpenMind Desktop — UI/UX Pro Max Skill 审查报告

> 审查工具：`ui-ux-pro-max` skill (BM25 设计智能引擎,已安装于 `.claude/skills/`)
> 审查日期：2026-07-09
> 审查范围：`renderer/` 全部 UI 代码(styles.css + shell/components/features CSS + AppShell 及各 feature 页面)
> 技术栈：Electron + React 19 + Vite + 原生 CSS(无 Tailwind / 组件库)

---

## 0. 设计智能基线(skill 推荐 vs. 现状)

skill 对「开发者桌面工具 / 控制中心」这类产品给出的推荐:

| 维度 | skill 推荐 | 现状 | 评价 |
|------|-----------|------|------|
| **风格** | Dark Mode (OLED) + Minimalism / Flat | 浅色默认 + 深色可选,Flat | ✅ 符合 |
| **配色** | #0F172A 底 / #F8FAFC 字 / #22C55E 强调 / 蓝 focus | #f6f7f9 底 / #2563eb accent | ✅ 接近,蓝色 accent 合理 |
| **字体** | Inter,300-700 全字重 | Inter 为主 + JetBrains/Cascadia Mono | ✅ 符合 |
| **Dashboard 风格** | Drill-Down Analytics / Real-Time Monitor | 多 pane drill-down | ✅ 符合 |
| **可访问性** | WCAG AAA(深色) / focus 可见 | 部分不达标 | ⚠️ 见 §1 |

**总体**:设计方向与 skill 推荐高度吻合,token 体系成熟。问题集中在 **token 落地不彻底** 和 **可访问性细节**。

---

## 1. CRITICAL — 可访问性(必须修)

### 1.1 主输入框焦点环被移除(WCAG 2.4.7 违规)

`renderer/src/styles/features/ai-console.css:1856-1858`

```css
.composer-editor textarea:focus-visible { outline: 0; box-shadow: none; }
```

聊天主输入框在获得键盘焦点时**既无 outline 也无 box-shadow 替代**,键盘用户完全看不到焦点位置。这是最严重的可访问性缺陷。

**修复**:保留 `outline: 0` 但补一个 box-shadow 环,或直接移除该覆盖让全局 `:focus-visible`(styles.css:169)生效。

### 1.2 `--muted-2` 对比度全面不达标(WCAG 1.4.3)

| 主题 | token 值 | 对面板背景比 | AA 正文(4.5)? |
|------|---------|------------|--------------|
| 深色 | `#7a8699` on `#202632` | **4.11** | ❌ FAIL |
| 深色 | `#7a8699` on `#252c39`(control) | **3.80** | ❌ FAIL |
| 浅色 | `#98a2b3` on `#ffffff` | **2.58** | ❌ FAIL(连大字也失败) |

`--muted-2` 被用作 **~90 处** 11px(`--fs-xs`)辅助文字的颜色,例如:
- `styles.css:460` `.trace-duration` / `:467` `.trace-toolbar` / `:547` `.tool-event-title small` / `:582` `.tool-insight dt` / `:626` `.reasoning-title small` / `:645` `.change-trace-card small` … 以及几乎所有 feature CSS。

**修复**:深色 `--muted-2` 提至 `#8d99ac`(≈5.0),浅色提至 `#6b7280`(≈4.9);或把 11px 辅助文字从 `--muted-2` 迁到 `--muted`(已达标:深 6.14)。

### 1.3 10px 等宽字体渲染真实内容(WCAG 1.4.4)

- `styles.css:650` `.change-trace-card code { font: 10px/1.5 … }` — 变更文件路径
- `styles.css:657` `.change-file-card pre { font: 10px/1.55 … }` — diff 内容

10px 对真实代码内容过小。另有多处 11px 硬编码(见 §详细清单)。建议 `--fs-xs` 从 11px 提到 12px,10px 硬编码提到 ≥11px。

### 1.4 图标按钮缺 `aria-label`(WCAG 1.3.1 / 4.1.2)

- `features/projects/ProjectsPage.tsx:245-246` — 视图切换按钮(`LayoutGrid`/`List`)仅靠 `title`,未加 `aria-label`。`title` 不会被多数读屏软件当可访问名暴露。
- `features/ai-console/tool.tsx:289` — `.read-file-link` 仅 `title={previewPath}`。

注:app 大部分图标按钮(AiSidebar / composer / message / GlobalSearch)标签做得好,这两处是遗漏。

---

## 2. HIGH — 布局 / 响应式 / 一致性

### 2.1 三栏布局无响应式覆盖,小窗口内容列被饿死

`styles.css:222`

```css
.three-pane { grid-template-columns: var(--three-pane-columns, 210px 8px 330px 8px minmax(0, 1fr)); }
```

默认预留 540px+ 固定宽度,**`responsive.css` 里没有任何针对 `.three-pane` 的断点**。窗口 < ~820px 时内容列可能 < 100px。对比之下 `.ai-workbench` / `.creative-workspace` 都有响应式覆盖,唯独 `.three-pane`(reader/文档布局)没有。

### 2.2 `.source-row` 六列固定网格在 `overflow:hidden` 卡片内被裁剪

`styles.css:1494`(卡片 `overflow:hidden`)+ `:1504`(行 `grid-template-columns: minmax(0,1fr) 90px 120px 80px 90px 150px`)。窄窗下列被**隐藏而非滚动**,内容丢失。需加 `overflow-x: auto` 或响应式收起。

### 2.3 z-index 无系统刻度(13+ 个裸值)

skill 推荐 0/10/20/40/100/1000 系统刻度。实际散落:`1, 2, 3, 8, 14, 15, 20, 30, 40, 55, 60, 98, 100, 120, 1000, 9999`,**没有 `--z-*` token**。同名概念「浮层侧栏」在两处用不同值(`responsive.css:12` 用 40,`styles.css:1341` 用 15)。

**修复**:在 `:root` 定义 `--z-base/sticky/overlay/dropdown/modal/topmost` 并替换裸值。

### 2.4 border-radius 17 种取值,token 仅 3 种

token:`--radius-sm:6 / -md:10 / -lg:14`。实际出现 `0,1,2,3,4,5,6,7,8,9,10,11,12,14,16,50,999px` 共 17 种,其中 `5px`(32 处)和 `7px`(21 处)既不在刻度上又是最高频。`--radius-*` 变量用了 ~181 处但同文件混用字面量,迁移做了一半。

### 2.5 间距严重偏离 4/8 网格

token:`--space-1..8 = {4,8,12,16,20,24,32}`。实际 padding 主导值是 `5/6/7/9/10/11px`(全部 off-grid)。最显眼的 `.page-scroll { padding: 38px }`(styles.css:200)既不在网格上也不是 token。相邻 nav 元素 gap 在 9/10/11px 间漂移。

---

## 3. MEDIUM — 视觉一致性 / 深色对等 / 动效

### 3.1 ~50 处硬编码 hex/rgba 绕过 token(集中在代码/diff/工具事件区)

颜色 token 系统完善(9 阶语义色阶 + tints),但代码渲染区大量硬编码:
- `styles.css:434-437` `.hljs-*` 语法色 `#d9a7a3 / #b6cfae / #c5b88d / #79828f`(假定深色底)
- `styles.css:491-498` `.trace-step-marker` 6 组硬编码对
- `styles.css:550` `.tool-event-title em { color: #d99b95 }`、`:586`、`:597`、`:602/605/606`(approval-card)、`:611`、`:615`、`:1192/1207/1221/1227-1230/1242` …

### 3.2 深色对等的盲区(token-swap 策略的漏洞)

深色主题**完全靠 `:root[data-theme="dark"]` 重定义 token** 实现,所有其他 CSS 文件里 0 个 `[data-theme="dark"]` 覆盖块。这个策略优雅,但导致**任何硬编码颜色都不随主题变**:

- `styles.css:251` `.html-preview { background: white }` — 深色模式下 HTML 预览 iframe **硬白**闪烁。
- `.hljs-*` / `.diff-line` 色调是为**深色底**调的,浅色模式(底是 `#f1f3f6`)下对比度差——反向对等问题。

### 3.3 ~36 处阴影绕过 token,含字节级重复

`--shadow-1/2/3` token 已定义且用了 29 处,但另有 ~18 处内联 `rgba(...)` 阴影。例如:
- `styles.css:1405` `.modal-card { box-shadow: 0 24px 60px rgba(0,0,0,.55) }` —— 几乎是 `--shadow-3` 的字节级复制,只是 alpha 不同。
- `components.css:96` `0 1px 2px rgba(16,24,40,.18)` —— 与 `--shadow-1` 完全相同的颜色内联重写。

### 3.4 `prefers-reduced-motion` 覆盖不一致

有两个全局 reset(styles.css:1323、final-polish.css:306)兜底,但部分动画缺专门规则,且 `animation-iteration-count:1 !important` 会让 `from{opacity:0}` 动画停在不可见首帧。**缺专门处理**:`msg-in`(393)、`stream-blink`(394)、`activity-dot`(538)、`activity-track`(539)—— 正是审查重点点名的四个。

### 3.5 截断文字缺 title/tooltip(系统性)

`tool-event-title` 做对了(truncated + `title`,tool.tsx:131-140),但大量截断元素无 tooltip:
- `.session-summary strong span`(styles.css:314) — 会话标题
- `.app-project-status strong/span`(shell.css:172) — 仓库路径(对比:工具栏同值字符串有 title,footer 没有,不一致)
- `.inspector-section dd`、`.session-detail dd`、`.run-activity span`、`.source-name`、`.inbox-row strong` … 系统性遗漏。

### 3.6 少量交互按钮无 `:hover` / 一个 emoji 当图标

- 缺 `:hover`:`.document-tabs button`(259)、`.filter-tabs button`(234)、`.session-filters button`(234)、`.load-history`(595)、`.diff-toolbar button`(1223)。
- `features/ai-console/message.tsx:145` — `"🖼️ 图片附件"` 用 emoji 当 UI 图标,应换 lucide `Image`。

---

## 4. 优先级清单(建议修复顺序)

### 🔴 立即修(CRITICAL,影响可访问性合规)
1. `ai-console.css:1856` — 恢复 composer textarea 焦点指示器
2. `--muted-2` token(styles.css:25 浅 / :123 深)— 提对比度,影响 ~90 处
3. `styles.css:650,657` — 10px 代码内容提至 ≥11px
4. `ProjectsPage.tsx:245-246` / `tool.tsx:289` — 补 `aria-label`

### 🟡 近期修(HIGH,影响体验与可维护性)
5. `.three-pane`(styles.css:222)— 加响应式断点
6. `.source-row`(styles.css:1504)— 加 `overflow-x: auto` 或响应式收起
7. z-index 引入 `--z-*` token 刻度
8. 截断元素补 `title`(session-summary、project-status 等)

### 🟢 持续治理(MEDIUM,设计系统一致性)
9. border-radius 收敛到 3-token 刻度(或显式扩为 5 级含 4/8px)
10. 间距迁回 `--space-*` 网格(优先 `.page-scroll` 的 38px)
11. 硬编码 hex/rgba → token(优先 `.hljs-*`、`.diff-line`、tool-event 区)
12. `.html-preview` / `.hljs-*` / `.diff-line` 加深浅色分支
13. 内联阴影 → `--shadow-*` token
14. 补 `prefers-reduced-motion` 专门规则(msg-in/stream-blink/activity-dot/activity-track)
15. 补 5 处 `:hover`;emoji 图标换 lucide

---

## 附:本次审查使用的 skill 命令

```bash
# 安装(skill CLI)
uipro init --ai claude

# 设计系统推荐(对照基线)
python3 scripts/search.py "developer desktop app control center dashboard dark mode productivity tool" \
  --design-system -p "OpenMind Desktop"

# 各维度深挖
python3 scripts/search.py "contrast keyboard focus dark mode icon button loading z-index truncation" --domain ux -n 10
python3 scripts/search.py "developer productivity tool desktop control center" --domain product -n 3
python3 scripts/search.py "developer dark dashboard" --domain color -n 3
python3 scripts/search.py "rerender memo list performance virtualize" --stack react -n 5
```

skill 数据文件位于 `.claude/skills/ui-ux-pro-max/data/`(styles/colors/typography/ux-guidelines/products/stacks 等 CSV),可随时按域检索补充规则。
