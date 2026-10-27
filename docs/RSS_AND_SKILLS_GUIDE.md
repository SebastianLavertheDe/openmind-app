# RSS、每日偏好与内置 Skills

OpenMind 现在自己维护、构建和分发原 `cctools-skills` 的 15 个保留包，以及 `blog-rss-feed` 的 RSS 转换能力。运行和安装均不需要检出这两个仓库；它们可继续保留历史。`knowledge-wiki-compiler` 不再分发，已有知识库文件不会被删除。

## 开始使用

1. 选择自己的 OpenMind 内容目录，在设置中开启内置 Python。首次准备依赖需要联网；之后运行使用应用管理的解释器，不依赖系统 Python。
2. 打开侧栏 **RSS 源**。227 个公开建议源默认全部停用，可以搜索名称、地址和标签，按启用、停用或异常筛选。
3. 启用需要的源，或点击 **添加源**，填写网站或 RSS/Atom 链接并检测。网站提供多个 Feed 时，选择具体频道后保存。也可导入 OPML。
4. 点击 **更新 RSS**、**采集文章**或**更新并采集**。原网站转换型显示原网站；直接订阅型显示原 RSS 链接。错误会保留在对应源上，并记录错误阶段。
5. 需要自动执行时，打开 **定时任务**。首次准备内置包会建立默认停用的任务模板；分别设置周期、时区并启用。安装 Skill、订阅启停和任务启停是独立设置。

编辑、停用、删除使用源的修订号提交。在途任务返回时会检查当前修订，丢弃已删除、停用或替换地址的结果。删除源保留已经保存的文章、摘要和选题；空列表也是有效配置，重启和升级不会恢复已删除的源。

“准备内置 Skills”从本地资源安装完整集合；关闭这个开关保留已安装包、内容、订阅和任务设置。需要停止采集时停用相应源或任务；需要停止某个 Skill 时使用它自己的启停操作。

## 总结与选题偏好

在 **RSS 源**或**每日简报**打开 **总结与选题偏好**。例如：

> 关注产品设计和交互研究，优先选择有实际案例的内容，排除融资快讯。用中文简洁总结，每天推荐最多 10 条，并说明推荐理由。

保存偏好与生成是两个独立操作。保存后可以选择日期，生成总结或选题；修改未保存时不能生成。留空按内容质量与时效整理，不预设 AI 领域、作者白名单、公众号文风或传播评分。

总结、社交内容初筛、选题排序和手动 `ai-media-topic-selector` 使用同一份偏好。每次任务冻结修订号，缓存同时考虑原文、模型、提示词版本和偏好；修改偏好后直接重新生成，无需重新抓取原文。生成失败保留上一份文档，成功重新生成时把旧文档留在对应目录的 `.versions/` 中。

总结和选题需要在 **设置 → AI 与模型**配置可用的默认 Process Provider。普通 RSS 同步和文章采集不需要大模型。Agent 类型的 Skill 继续通过已配置的 Claude Code / Codex CLI 会话执行。

## 三个 RSS 执行模式

| 模式 | 行为 | 是否调用模型 |
| --- | --- | --- |
| `sync` | 请求启用的原网站或 Feed，生成本地标准 RSS 2.0 | 否 |
| `collect` | 从有效本地 RSS 提取新文章，保存正文和去重索引 | 否 |
| `pipeline` | 先更新，再采集本次成功更新的源；失败源保留旧 RSS | 否 |
| `brief generate` | 按偏好生成当天总结；加 `--topics` 生成选题 | 是 |

源更新失败不会被显示成完整采集成功。单源失败不阻断其他源；批次记录成功、部分失败、失败及各源跳过原因。同一源重叠执行跳过，文章 URL 索引跨源共享；远端文章更新保存至 `article/.updates/`，保留用户编辑过的原文件。

应用内默认提供 RSS 更新、RSS 文章采集、每日总结、每日选题、X 关注流和 Reddit 采集六个独立任务模板。`rss-to-summary-workflow` 是可手动运行的“完整采集 → 总结”组合，不隐式执行选题。

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

只有可确认属于旧官方默认集合、包内容完整、未被用户主动保留的安装才会转换为 `openmind-library` 内置身份。第三方、用户修改和同名导入包保留，并在技能库显示来源冲突；需在已安装 Skills 中处理后重试。迁移前检查在途任务，安装中断后通过持久化日志继续，保留原启停状态。偏好驱动的每日选题和手动选题都提供统一的 `openmind-topics` 元数据，写作素材包可直接读取，同时兼容旧选题文档。旧任务保留启停、周期和时区；旧 RSS 默认工作流规则转为 `pipeline`，历史运行目标不改写。

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
```

Python 回归需要 RSS 项目的依赖，可在独立测试环境执行：

```sh
uv run --project config/skill-library/packages/rss-article-saver python -m unittest discover -s tests/rss -v
# 或使用已准备好的测试解释器：
OPENMIND_TEST_PYTHON="/absolute/path/to/python" npm run test:rss
```

`scripts/rss-packaged-smoke.cjs <Linux解包目录>` 使用真实安装包启动器和临时用户目录验证无显示服务、内置 Python、1025 个源的完整结果、同步/采集、并发去重及历史记录保护；再通过本地 HTTP 模型替身检查 Provider 配置、偏好改变后的总结/选题、缓存和旧版本。`scripts/rss-ui-smoke.cjs` 使用隔离 Electron 配置验证浅深色、720/1280 宽度、错误重试、偏好和键盘操作。所有样例数据均是测试夹具。

逐项结果见[实施计划的验收记录](RSS_AND_SKILLS_CONSOLIDATION_PLAN.md#12-实施与验收记录)。固定样例和模型替身用于检验配置、筛选与缓存契约；不将其当作公网登录站点、真实模型质量或跨平台实测结果。
