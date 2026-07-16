# Visual Audit Checklist

This checklist backs `todo.md` section 18.5.

## Automated Source Gate

```bash
npm run audit:evidence
npm run visual:snapshot
```

The command writes `.build/audit-evidence.json` and verifies:

- `uiuxopt/1.png` through `uiuxopt/40.png` exist.
- Feature routes are lazy-loaded and renderer chunks are split.
- Inbox and AI large lists still use `VirtualList`.
- Focus-visible and reduced-motion styles exist.
- Browser preview data is explicitly marked, and Electron preload failure does not silently fall back to preview data.
- Creative, Inbox, ProductService and RunScheduler are split below their line-count budgets.

`npm run visual:snapshot` renders the production renderer with Electron under Xvfb when needed, captures the primary pages at 1280x720, 1366x768, 1920x1080, 2560x1440, 1366x768 zoom 125%, and 1366x768 zoom 150%, then writes:

- `.build/visual-snapshot-report.json`
- `.build/visual-snapshots/*.png`

The automated snapshot gate fails if a page is blank, the active route does not match, or the document has global horizontal overflow.

## Screenshot Matrix

Run this matrix with the packaged Windows build and attach screenshots or dated notes.

| View | 1280x720 | 1366x768 | 1920x1080 | 2560x1440 | Windows 125% | Windows 150% |
| --- | --- | --- | --- | --- | --- | --- |
| 今日工作台 | automated | automated | automated | automated | automated zoom | automated zoom |
| 资料收集箱 | automated | automated | automated | automated | automated zoom | automated zoom |
| 数据源 | automated | automated | automated | automated | automated zoom | automated zoom |
| 每日简报 | automated | automated | automated | automated | automated zoom | automated zoom |
| 创作中心 | automated | automated | automated | automated | automated zoom | automated zoom |
| 项目 | automated | automated | automated | automated | automated zoom | automated zoom |
| 自动化 | automated | automated | automated | automated | automated zoom | automated zoom |
| AI 工作台 | automated | automated | automated | automated | automated zoom | automated zoom |
| 设置 | automated | automated | automated | automated | automated zoom | automated zoom |

## State Matrix

| State | Required evidence |
| --- | --- |
| Long title/path | Screenshot showing no text overlap or layout shift. |
| Mixed Chinese/English | Screenshot from Inbox and AI message body. |
| Empty data | Screenshot of empty state copy and available next action. |
| Error data | Screenshot of recoverable error and retry/open-log path. |
| Provider unavailable | Screenshot of global/provider diagnostic state. |
| Collapsed panes | Screenshot plus keyboard operation note. |
| TOC and reader | Screenshot showing active heading state. |
| Dangerous approval | Screenshot showing action, command/path and decision buttons. |

The automated matrix proves renderer layout integrity in the production build. Windows-native DPI scaling and packaged-app manual review still need dated human evidence before release sign-off.
