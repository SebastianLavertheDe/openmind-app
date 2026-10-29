# RSS、每日偏好与内置 Skills

OpenMind 现在自己维护、构建和分发原 `cctools-skills` 的 15 个保留包，以及 `blog-rss-feed` 的 RSS 转换能力。运行和安装均不需要检出这两个仓库；它们可继续保留历史。`knowledge-wiki-compiler` 不再分发，已有知识库文件不会被删除。

## 开始使用

1. 选择自己的 OpenMind 内容目录，在设置中开启内置 Python。首次准备依赖需要联网；之后运行使用应用管理的解释器，不依赖系统 Python。
2. 打开 **设置 → RSS 源**。227 个公开建议源默认全部停用，以卡片展示，按 **AI、Agent、Prompt、编程技术、产品设计、商业创业、科技资讯、生活思考** 八个主题浏览。也保留自定义分类和未分类；搜索名称、完整网址、标签和分类，可组合启用、停用、异常、待配置筛选，并按名称或最近 RSS 更新排序。数量以当前内容目录的实际订阅为准。
3. 启用需要的源，或点击 **添加源**，填写网站或 RSS/Atom 链接并检测。检测会实际解析 Feed 或运行网站转换器，至少得到一篇有标题和有效链接的文章才通过；不会生成本地 RSS 或采集正文。网站提供多个 Feed 时，选择具体频道并重新检测通过后保存。也可导入 OPML。
4. 页面顶部提供 **总结与选题偏好**；定时设置在侧边栏 **自动化**。手动执行时，点击卡片底部的 **更新并采集**只处理该源；详情内也可单独更新 RSS 或采集文章。提交后提示“已提交”，实际结果在详情中查看。
5. 需要自动执行时，打开 **自动化**，分别配置 **RSS 更新**、**RSS 文章采集**、**每日总结**。首次准备内置包会建立默认停用的任务模板；分别设置周期、时区并启用。安装 Skill、订阅启停和任务启停是独立设置。

**设置 → 数据与会话** 中分别提供 **RSS 源**、**X/Twitter 源**和 **Reddit 源**。X 显示已配置的请求数量和编辑入口，默认隐藏完整登录请求；Reddit 显示当前实际配置的社区名称、地址和启停状态，可直接搜索、添加或编辑。这里复用 Skills 管理中的来源配置，修改会保存到同一份持久化数据中；定时任务的周期和启停继续在 **自动化** 中管理。

编辑、停用、删除使用源的修订号提交。在途任务返回时会检查当前修订，丢弃已删除、停用或替换地址的结果。删除源保留已经保存的文章、摘要和选题；空列表也是有效配置，重启和升级不会恢复已删除的源。

修改预置源地址后，再通过 OPML 导入它原来的地址，会建立独立订阅，保留修改过的源及其状态；重复导入相同地址不会重复添加。

## 分类、卡片与源详情

分类 Tab 沿用 Skills 的图标、名称和胶囊选中效果，不在每个 Tab 后堆叠数量。下方显示“当前结果数 / 总源数”，同时应用分类、搜索和状态筛选。八个内置主题始终可选；自定义分类和未分类在存在对应源时显示。真实分组名即使为 `all` 或 `ungrouped`，也与“全部”“未分类”入口区分。

新增或编辑时，在 **分类** 中选择已有主题、自定义分类或未分类；选择 **新建分类…** 后输入名称，与源一起保存即可。首尾空白会清理，大小写、全半角不同的同名分类会复用；取消或保存失败不会创建空分类。只改分类、名称或启停不会重新检测网址、使当前有效 XML 失效或抹掉上次错误。过期 XML 也不会因改分类被重新标为就绪。

旧版“博客/公众号”是渠道。升级首次读取时，按原始地址将这些旧分组迁移到目录中的主题，同时把渠道保留为标签；不匹配目录的旧渠道源进入未分类。自定义分组、手动清空的分类、启停、删除记录和采集状态都会保留。分类依据与完整规则见 [RSS 主题分类](RSS_SOURCE_CATEGORIES.md)。

卡片分别显示 **RSS 尚未生成／需要更新／已就绪**、RSS 条目数和上次运行错误。例如 Feed 已解析、正文请求返回 403 时，会同时显示“RSS 已就绪”和“正文采集失败 · 访问被拒绝”。条目数不是已采集文章数；应用不根据 403 推断登录或网站验证要求。

点击卡片主体进入详情，链接、开关和快捷操作独立响应：

- **概览**区分原始网址、识别出的 RSS 网址和采集使用的本地 XML，支持打开网址和复制完整地址。RSS 更新与正文采集成功时间单独记录；旧数据没有这两个字段时显示未知，下一次实际执行后更新。技术错误通过折叠区域查看。单独采集要求源已启用、地址有效且本地 XML 就绪；检测只验证解析，不写入本地 XML。
- **RSS 条目**按需读取真实本地文件，每页 30 条，按发布日期倒序，未知日期在后。旧 XML 仍可阅读，但会提示更新；文件版本变化后回到第一页。打开详情和切换 Tab 不联网抓取、不提交任务。读取失败可在当前 Tab 重试。
- **运行记录**每次读取当前内容根、当前源最近 20 条记录，可加载更多。批量任务只显示这个源的结果；没有单源结果时显示可证实的任务进度，不套用批量成功／失败。运行详情复用日志展示组件并分页读取日志，返回后保留源详情。旧版未记录内容根与源归属的运行不混入此列表，可在全局运行记录查看。

详情与编辑共用一个弹窗。从详情编辑后，保存或取消返回概览；卡片快捷编辑则返回卡片页。未保存修改需要确认，后台轮询保留草稿和原修订号，冲突不会静默覆盖。删除位于更多菜单，确认后保留已经保存的文章并恢复到结果区域。

“准备内置 Skills”从本地资源安装完整集合；关闭这个开关保留已安装包、内容、订阅和任务设置。需要停止采集时停用相应源或任务；需要停止某个 Skill 时使用它自己的启停操作。

## 总结与选题偏好

在 **RSS 源**打开 **总结与选题偏好**。例如：

> 关注产品设计和交互研究，优先选择有实际案例的内容，排除融资快讯。用中文简洁总结，每天推荐最多 10 条，并说明推荐理由。

保存偏好与生成是两个独立操作。保存后可以选择日期，生成总结或选题；修改未保存时不能生成。留空按内容质量与时效整理，不预设 AI 领域、作者白名单、公众号文风或传播评分。

总结、社交内容初筛、选题排序和手动 `ai-media-topic-selector` 使用同一份偏好。每次任务冻结修订号，缓存同时考虑原文、模型、提示词版本和偏好；修改偏好后直接重新生成，无需重新抓取原文。生成失败保留上一份文档，成功重新生成时把旧文档留在对应目录的 `.versions/` 中。

指定输出语言时，总结和选题的文档标题、栏目名称及推荐理由也使用该语言；筛选后没有入选内容时，仍按该语言显示零条结果。未指定语言时按来源内容生成。原文链接和文件路径保持原值。

总结和选题需要在 **设置 → AI 与模型**配置可用的默认 Process Provider。普通 RSS 同步和文章采集不需要大模型。Agent 类型的 Skill 继续通过已配置的 Claude Code / Codex CLI 会话执行。

## 三个 RSS 执行模式

| 模式 | 行为 | 是否调用模型 |
| --- | --- | --- |
| `sync` | 请求启用的原网站或 Feed，生成本地标准 RSS 2.0 | 否 |
| `collect` | 从有效本地 RSS 提取新文章，保存正文和去重索引 | 否 |
| `pipeline` | 先更新，再采集本次成功更新的源；失败源保留旧 RSS | 否 |
| `brief generate` | 按偏好生成当天总结；加 `--topics` 生成选题 | 是 |

源更新失败不会被显示成完整采集成功。单源失败不阻断其他源；批次记录成功、部分失败、失败及各源跳过原因。同一源重叠执行跳过，文章 URL 索引跨源共享；远端文章更新保存至 `article/.updates/`，保留用户编辑过的原文件。

采集失败后可直接重试：正文完整写入后才提交去重索引，中途失败不会把半篇文章登记成已完成。正文已保存、索引尚未提交时，重试会复用完整文件；若文件已被编辑，则保留它并将完整采集版本放入 `article/.updates/`。重试成功后清除该源的采集错误；若最近一次 RSS 更新仍失败，仅采集旧 RSS 不会清除更新错误。

应用内默认提供 RSS 更新、RSS 文章采集、每日总结、每日选题、X 关注流和 Reddit 采集六个独立任务模板。`rss-to-summary-workflow` 是可手动运行的“完整采集 → 总结”组合，不隐式执行选题。

三个任务各自运行：**RSS 更新**只获取文章列表并生成本地 RSS；**RSS 文章采集**只读取本地 RSS、下载正文并去重保存；**每日总结**只读取已经保存的内容、按偏好生成总结，不触发 RSS 更新或正文采集。

## 安装包命令与 crontab

命令不创建 Electron 窗口，直接使用安装包中的 Node/Python 和相同的内容、配置与运行记录。

| 平台 | 命令位置 |
| --- | --- |
| Linux 解包目录 | `<安装目录>/resources/cli/openmind` |
| macOS | `/Applications/OpenMind.app/Contents/Resources/cli/openmind` |
| Windows 安装目录 | `<安装目录>\resources\cli\openmind.cmd` |

`--root` 和 `--user-data` 必须是明确的绝对路径，且不能互相包含。内容根必须已经存在。`userData` 应与桌面应用使用的一致，可通过桌面启动前的 `OPENMIND_USER_DATA_DIR` 明确指定。不要将其设为源码目录。

Linux 示例（替换为自己的安装位置和数据目录）：

```sh
"/opt/OpenMind/resources/cli/openmind" runtime prepare --root "/srv/My OpenMind" --user-data "/srv/OpenMind App Data"
"/opt/OpenMind/resources/cli/openmind" rss sync --root "/srv/My OpenMind" --user-data "/srv/OpenMind App Data"
"/opt/OpenMind/resources/cli/openmind" rss collect --root "/srv/My OpenMind" --user-data "/srv/OpenMind App Data"
"/opt/OpenMind/resources/cli/openmind" rss pipeline --root "/srv/My OpenMind" --user-data "/srv/OpenMind App Data"
"/opt/OpenMind/resources/cli/openmind" brief generate --date 20261027 --root "/srv/My OpenMind" --user-data "/srv/OpenMind App Data"
"/opt/OpenMind/resources/cli/openmind" brief generate --topics --date 20261027 --root "/srv/My OpenMind" --user-data "/srv/OpenMind App Data"
```

需要浏览器渲染的网站（例如 Sequoia）另外执行一次 `runtime prepare --browser`，参数同上。Chromium 安装在应用的 `userData/runtimes/browser-playwright/`。Linux 还需要主机具备 Chromium 所需的系统库；缺少浏览器时任务明确报错，不会生成伪成功的空 Feed。

RSS 命令可加 `--source-id ID` 单独处理一个源；不指定日期时使用运行主机的当地日期。命令输出 JSON，失败及部分失败返回非零状态。初始化后仍须在 App 中选择启用哪些源；首次 CLI 使用不会自动订阅所有建议源。

crontab 示例：

```cron
# 使用当前系统 cron 的时区；日志目录需预先存在。
0 * * * * "/opt/OpenMind/resources/cli/openmind" rss pipeline --root "/srv/My OpenMind" --user-data "/srv/OpenMind App Data" >> "/srv/OpenMind App Data/rss-cron.log" 2>&1
0 22 * * * "/opt/OpenMind/resources/cli/openmind" brief generate --root "/srv/My OpenMind" --user-data "/srv/OpenMind App Data" >> "/srv/OpenMind App Data/brief-cron.log" 2>&1
```

App 的定时规则明确保存自己的 IANA 时区；系统 crontab 使用主机 cron 的时区设置。两者调用同一批处理与锁，但不会相互编辑调度配置。切换时自行停用旧仓库的脚本任务，避免旧脚本绕过新锁重复采集。本次迁移不会读写用户 crontab。

Windows 可通过任务计划程序运行 `openmind.cmd`；macOS 可由 launchd 或用户自己的 cron 调用。两种启动器随包提供，本次实际安装包验证的平台为 Linux ARM64。

## 内置包清单与额外条件

| Skill | 类型 | 输出或使用条件 |
| --- | --- | --- |
| `rss-article-saver` | Process / Python | 本地 RSS、`article/`；部分源需要浏览器 |
| `daily-article-summarizer` | Process / Python | `daily-summary/`；Process Provider |
| `daily-topic-selector` | Process / Python | `daily-topic/`；Process Provider |
| `rss-to-summary-workflow` | Workflow | 使用上述采集、总结包，保留同次偏好快照 |
| `reddit-fetcher` | Process / Python | `reddit/`；用户管理的社区与网站访问条件 |
| `x-following-fetcher` | Process / Python | `post/`、`article/`；用户自己的登录凭据 |
| `daily-writing-orchestrator` | Process / Python | `creative/` 素材与写作包 |
| `collect-interest-markers` | Process / Python | 兴趣收集箱，读取已有内容 |
| `skill-run-reporter` | Process / Python | 运行报告，不再检查知识库生成器 |
| `asset-collector` | Process / Python | 写作素材清单及缺失素材报告 |
| `video-download` | Process / Python | 用户选择的导出位置；yt-dlp、Whisper，按需使用 FFmpeg |
| `video-burnin-subtitles` | Process / Python | `video/`；FFmpeg、Whisper、字幕字体，翻译需要 Provider |
| `agent-browser` | Agent | 已连接的 Agent CLI 与浏览器能力；用户指定证据导出位置 |
| `creative-writing` | Agent | 已连接的 Agent CLI，写作工作区 |
| `ai-media-topic-selector` | Agent | 已连接的 Agent CLI，注入相同的选题偏好 |

Python 依赖由应用管理的 uv 环境根据已安装包准备。视频包包含较大的语音/模型依赖；下载模型、访问登录网站、配置外部导出位置仍由相应能力的正常设置流程完成。FFmpeg 复用应用的视频工具设置，Whisper 通过同一个 Python 解释器启动。

原有 21 个配置式 Agent 预设继续保留，总技能库为 36 个包。Git、目录、ZIP 导入和用户自建 Skill 继续使用各自的来源身份。

## 数据与迁移

| 位置 | 用途 |
| --- | --- |
| `<内容根>/.agent/skills/` | 安装包代码，可更新 |
| `<内容根>/.agent/skill-data/rss-article-saver/sources.json` | 唯一活动订阅清单、启停、修订及删除记录 |
| 同目录 `feeds/`、`articles/`、`locks/` | 本地 RSS、去重索引、任务锁 |
| `<内容根>/.agent/preferences/daily-brief.json` | 偏好文本、修订号、更新时间 |
| `<内容根>/.agent/skill-data/<skill>/` | 各 Skill 的可变状态、生成缓存 |
| `<内容根>/article/`、`daily-summary/`、`daily-topic/` | 用户内容与历史版本 |
| `<userData>/runs/`、`settings/migrations/` | App/CLI 共用运行记录、安装迁移记录 |

首次升级优先导入旧持久化 OPML，展开子 OPML，合并旧名称、标签及停用设置，恢复已知 GitHub 中转地址对应的原站地址。原 OPML 保留备份；损坏、循环或缺失引用会阻止提交新配置。不能可靠恢复的中转源显示“待配置”，不会猜测地址。旧文章按原链接建立索引，避免升级后整批重存。

只有可确认属于旧官方默认集合、包内容完整、未被用户主动保留的安装才会转换为 `openmind-library` 内置身份。第三方、用户修改和同名导入包保留，并在技能库显示来源冲突；需在已安装 Skills 中处理后重试。迁移前检查在途任务，安装中断后通过持久化日志继续，保留原启停状态。偏好驱动的每日选题和手动选题都提供统一的 `openmind-topics` 元数据，写作素材包可直接读取，同时兼容旧选题文档。

升级时，旧的“RSS 抓取与每日总结”定时任务（包括曾被迁为 `pipeline` 的任务）一次性拆为上述三个任务。原规则改为仅采集正文，保留启停、周期、时区和历史记录；缺少的 RSS 更新与每日总结任务自动补出，继承原规则的启停与时区，周期分别默认为每小时和每日 22:00。已单独配置的任务不覆盖。拆分后独立修改、停用或删除不会在重启时恢复；历史运行的实际目标不改写。

官方旧 `knowledge-wiki-compiler` 包退出安装集合；用户主动导入的独立副本按外部包保留。历史知识库和运行记录保持可读，失去执行目标的自定义任务保留定义并显示不可用。

迁入来源版本、包文件及源地址映射见 [`config/skill-library/migration.json`](../config/skill-library/migration.json) 和 [`config/rss-sources/migration.json`](../config/rss-sources/migration.json)。公开清单将 203 个 OPML 叶子源与 145 条旧站点定义合并为 227 个源；一个含私人订阅参数的定义只记录排除原因。网站转换代码保留原 [Apache-2.0 许可证](../config/skill-library/packages/rss-article-saver/src/feed_generation/LICENSE)。

## 开发验证

```sh
npm run build
npm run test:unit
npm run test:integration
npm run test:e2e
npm run check:ui
npm run visual:ui
npm run motion:check
node scripts/rss-ui-smoke.cjs
node scripts/rss-motion-smoke.cjs
```

Python 回归需要 RSS 项目的依赖，可在独立测试环境执行：

```sh
uv run --project config/skill-library/packages/rss-article-saver python -m unittest discover -s tests/rss -v
# 或使用已准备好的测试解释器：
OPENMIND_TEST_PYTHON="/absolute/path/to/python" npm run test:rss
```

`scripts/rss-packaged-smoke.cjs <Linux解包目录>` 使用真实安装包启动器和临时用户目录验证无显示服务、内置 Python、1025 个源的完整结果、同步/采集、并发去重及历史记录保护；再通过本地 HTTP 模型替身检查 Provider 配置、偏好改变后的总结/选题、缓存和旧版本。`scripts/rss-ui-smoke.cjs` 先使用公开目录的 227 个源定义验证八个主题、新建分类及浅深色 720/1280 页面，再用独立的 213 源压力夹具验证长分组、长地址、操作范围、详情分页、日志、错误重试和键盘操作。截图不抓取公网 Feed，不读取真实用户配置。`rss-motion-smoke.cjs` 与 Skills 实际组件比较弹窗和胶囊 Tab，保存进退场帧及正常／减少动态效果的时序证据。生产组件目录另外覆盖约 390px 内嵌布局。测试使用隔离 Electron 配置；截图输出到忽略的 `.tmp/`。

逐项结果见[实施计划的验收记录](RSS_AND_SKILLS_CONSOLIDATION_PLAN.md#12-实施与验收记录)。固定样例和模型替身用于检验配置、筛选与缓存契约；不将其当作公网登录站点、真实模型质量或跨平台实测结果。
