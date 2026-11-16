# 应用技能库配置

这里维护 28 张 Skill 卡片的定义。其中 6 个采集、总结、视频及工作流包随 App 内置；21 个 handraw-style 原版子 Skill 和 `agent-browser` 共 22 张卡片通过独立目录和 ZIP 下载分发，不进入 App 安装包。Agent、Process、Workflow 保留原执行类型；外部 Git 导入与用户编写的技能继续使用独立来源身份。
`catalog.json` 包含技能清单、执行指令及中英文展示信息；App 构建不读取外部技能仓库。

## 添加技能

在 `catalog.json` 的 `skills` 数组中添加一条配置即可，例如：

```json
{
  "id": "om-weekly-report",
  "category": "writing",
  "instructions": [
    "根据用户提供的工作记录，整理本周完成事项、待解决问题和下周计划。",
    "保留事实和关键数据，缺少依据时说明，不编造完成进度。"
  ],
  "display": {
    "zh-CN": {
      "title": "周报生成",
      "subtitle": "把工作记录整理成周报",
      "description": "生成包含完成事项、问题和下周计划的完整周报。",
      "inputHint": "提供本周工作记录"
    },
    "en": {
      "title": "Weekly report",
      "subtitle": "Turn work notes into a weekly report",
      "inputHint": "Provide this week's work notes"
    }
  }
}
```

运行 `npm run publish:skill-library`，将上述新条目发布到项目根目录的 `skill-registry/`，然后刷新技能页。无需重新构建 App、修改 TypeScript 或翻译模块，也无需在 `cctools-skills` 添加目录。`prepare:skill-library` 同时准备 6 个内置包并发布目录；`build` 和 `dev:electron` 自动执行这个准备步骤。

## 可选辅助文件

需要脚本或模板时，把文件放到 `assets/<技能ID>/`，在技能条目的 `files` 中声明相对路径：

```json
{
  "files": ["scripts/format_report.py"],
  "requirement": "python"
}
```

构建时只包含明确声明的文件，保持包内相对路径。禁止路径越界，也不能覆盖构建生成的
`SKILL.md`、包 manifest 和技能库元信息。用户内容、运行结果和凭据不属于这里。

多个技能共享参考资料时，可以显式映射 `assets/` 内的文件，无需复制多份源文件：

```json
{
  "files": [
    {
      "source": "_shared/references/writing-guide.md",
      "target": "references/writing-guide.md"
    }
  ]
}
```

`source` 相对于 `assets/`，`target` 相对于生成的技能包；两者均禁止绝对路径和 `..`。
构建拒绝越界的符号链接、重复目标和覆盖生成元信息。每个安装包都有独立资源副本，
运行时不依赖其他技能是否安装。

## 字段约定

- 顶层 `schemaVersion` 当前为 `1`；`executionRules` 为所有应用技能共用的执行规则。
- `skills` 的数组顺序决定默认展示顺序。
- `id`：唯一标识，以小写字母开头，可包含小写字母、数字、`-`、`_`、`.`。
- `version`：默认 `1.0.0`，使用三段数字版本号。
  修改已经发布的执行流程时递增版本；共享资源变化也会改变包摘要。
- `instructions`：配置式预设必填的指令段落数组；构建时生成 `SKILL.md`。原生包可省略，使用包内的 `SKILL.md`。
- `category`：`research`、`writing`、`image`、`slides`、`video`、`web`，同时决定封面图标。
- `requirement`：可省略；可选 `image`、`python`、`ffmpeg`，`ffmpeg` 同时要求 Python。
- `display`：支持 `zh-CN`、`en`，至少提供一种。优先使用当前界面语言，缺失时回退到已有语言。
- `title` 必填；`subtitle`、`inputHint` 默认空文本；`description` 省略时使用副标题。
- `files`：可选辅助文件列表，不会扫描或复制外部技能仓库。
- `recommended`：默认 `false`；设为 `true` 时可在新任务页作为推荐卡片展示，无需向前端添加 ID。
- `cardCover`：可选，指向 `assets/` 下的 PNG、JPEG 或 WebP，相对路径不得越界，最大 512 KiB。发布时与小头像一同写入远程目录的 data URL，浏览卡片不需要先下载 Skill ZIP。

## 贡献者昵称和头像

在技能条目上添加可选的 `contributor`，卡片简介下方和详情标题下方会显示头像及 `@昵称`：

```json
{
  "contributor": {
    "nick": "CommunityMember",
    "avatar": "avatars/member.png",
    "profileUrl": "https://github.com/member"
  }
}
```

- `nick`：去掉首尾空格和开头的 `@` 后为 1～24 个 Unicode 字符，不能包含换行或控制字符。
- `avatar`：可省略；相对于 `assets/<技能ID>/` 的 PNG、JPG 或 WebP 文件路径，大小不超过 100KB。
  推荐使用 128×128 的正方形图片。构建时自动把声明的头像复制到技能包，无需重复加入 `files`。
  多个技能共用头像时，也可在 `files` 中显式映射共享源文件，并让 `avatar` 指向该映射的 `target`；
  构建会对共享头像执行相同的格式、大小校验。
- 未提供头像或头像丢失时显示默认头像；旧条目未提供 `contributor` 时保持可用。
- `profileUrl`：可省略；只接受 `https://github.com/<用户名>` 或 `https://x.com/<用户名>` 的用户主页。
  可填写 `www` 和末尾 `/`，保存时统一移除。拒绝仓库、帖子、平台功能页、查询参数、片段和其他域名；
  检查链接格式，不联网验证账户是否存在。配置后，卡片和详情中的 `@昵称` 可点击，在系统浏览器打开。
  留空时昵称保持普通文本。
- 提交共建改动时一并提交技能配置和贡献者同意公开的小头像，不要提交本机绝对路径或私人原图。

App 的创建／编辑表单也支持填写昵称、作者主页、上传和移除头像。主页可清空，不影响昵称和头像。
原图上限 2MB，上传后自动居中裁切，
重新编码成 128×128、100KB 以内的 PNG；仅保存处理后的图片。上传取消或失败保留原头像。
贡献者信息随草稿和已安装技能保存。最近保存的原创技能贡献者信息在 App
`userData` 中保留，后续创建自动带入；历史个人副本保留原作者信息，不会覆盖这份默认信息。
技能库不再提供「复制为我的技能」；公开技能通过安装使用，自建技能继续支持创建和编辑。

App 中创建的技能保存在本地「我的」，不会自动投稿。公开共建仍通过此目录的配置和资源收录，
按照下述分发流程更新客户端。

## 分发与来源隔离

App 安装包仅包含以下 6 个内置 Skill（ID 清单位于 `shared/skill-registry.ts`）：

- `video-download`：视频下载
- `daily-article-summarizer`：每日文章总结
- `reddit-fetcher`：Reddit 内容抓取
- `rss-article-saver`：RSS 文章采集
- `rss-to-summary-workflow`：RSS 到每日总结
- `x-following-fetcher`：X Following 抓取

这 6 个包输出到 `.build/skill-library/`，随安装包分发到 `resources/skill-library/`，在「探索」隐藏，安装后出现在「我的」。`OPENMIND_SKILL_LIBRARY_BUNDLE` 仍可指定这部分内置资源目录。它们的源码或应用执行能力更新仍按 App 版本交付。

其余 22 张探索卡片（handraw-style 21 张、浏览器自动化 1 张）通过独立目录发布：

```bash
npm run publish:skill-library
```

该命令只读取本项目的 `config/skill-library/`，不执行 App build，也不读取相邻仓库或用户数据。生成目录 `skill-registry/` 已被 Git 忽略：

```text
skill-registry/
  catalog.json
  packages/<skill-id>-<ZIP-SHA256>.zip
```

目录记录每张卡片的展示信息、完整 prompt 预览、推荐/封面、包版本、相对路径、长度、ZIP SHA-256 和包内容摘要。包版本取自验证后的 manifest；原生包的 prompt 从 `SKILL.md` 读取，目录预览保留公共执行规则。发布先验证全部包，最后原子替换 `catalog.json`；失败保留上次有效目录，旧哈希包继续保留，避免已获取旧目录的客户端下载失败。新增兼容当前客户端的卡片只需再次发布，不用发新版 App；新增客户端能力仍需升级 App。

开发环境默认把项目根目录 `skill-registry/` 当作目录源，模拟后续远程分发。安装版没有项目检出目录，需显式指定来源；本次不包含公共线上地址。配置按以下顺序选择：

1. 环境变量 `OPENMIND_SKILL_REGISTRY`：绝对目录，或 HTTP(S) 基础地址。
2. `<userData>/settings/skill-registry.json`，例如 `{"source":"/absolute/path/to/skill-registry"}`。Windows JSON 路径中的反斜杠需要写为 `\\`。
3. 仅开发环境回退到项目的 `skill-registry/`。

后续将整个 `skill-registry/` 原样托管到 HTTP(S)，并把来源设为例如 `https://example.com/skill-registry/` 即可；示例地址不是实际已部署服务。URL 不接受账号密码、查询参数或片段。HTTP 目录默认缓存五分钟，可由界面主动刷新；本地目录每次检查。先更新哈希包，再更新目录文件，避免向客户端提供不存在的包地址。

目录和下载包缓存在 `<userData>/cache/skill-registry/`，按源隔离；安装后的代码仍在 `<内容根>/.agent/skills/`。源不可访问时使用最后有效的目录；已经下载并通过校验的 ZIP 可离线安装，未缓存的包需恢复源访问后才能下载。包读取校验大小和 SHA-256，安装前继续验证 manifest 与包内容摘要。摘要是完整性校验，不是发布者签名，因此来源应由维护者配置为可信目录或服务。浏览目录不会下载所有包，也不会把包安装到缓存目录。

应用技能的发布者为 `openmind-library`。6 个内置包记录为 `sourceType: builtin`；独立目录包记录为 `sourceType: catalog`，保留实际目录来源和 ZIP 哈希。GitHub 导入保持 `sourceType: git` 和实际仓库地址。各来源共用执行机制和安装存储，但清单、更新及默认技能开关相互独立。GitHub 包即使使用相同 ID，也不会被认作应用技能或被其安装操作覆盖；切换独立目录来源也不会静默覆盖另一个目录源的同名安装。

历史 App 内置卡片在明确使用时可迁移为目录来源。旧版官方默认集合的 `agent-browser` 也保留迁移路径：仅原生包、可验证的官方旧 Git 来源、未被用户保留且内容完整的安装可以显式迁移。浏览目录不会触发迁移；第三方、用户保留和修改过的副本不会被覆盖。关闭内置集合开关不删除任何已安装包或历史内容。

运行时获取目录并保留有效缓存；新增条目不会自动安装，仍由用户点击使用。移出清单的已安装技能
默认保留在「我的」，不再出现在「探索」；列入 `shared/retired-skills.ts` 的退役内置包同时退出「我的」和新任务入口。

已安装的应用卡片发现包摘要变化后，会在用户下次点击「使用」时应用新版并使用新的
摘要创建会话；浏览列表不更新安装包。若显示更新后来源暂时不可达，则继续使用经过校验的已安装版本；新包内容损坏或校验不匹配仍明确报错。已经移出清单的包和历史个人编辑源保持独立。

## handraw-style 图像卡片

原作者：[yang0](https://github.com/yang0)，来源：[handraw-style](https://github.com/yang0/handraw-style)，固定修订 `ab848ebfd478cdcd29b69ee2ee5090b4bb7b9d89`。公开原仓库文件按原路径完整保存在 `packages/handraw-style/`，不改写原版 `SKILL.md`、引用资料、脚本或许可证。来源清单见 [handraw-upstream.json](handraw-upstream.json)。

每个独立子 Skill 一张卡，同名重复入口只展示一张，当前共 21 张。仓库总入口保留在安装包内，不另增卡片。

| 原版 ID | 卡片 | 原版入口 |
| --- | --- | --- |
| `article-cover-designer` | 文章封面设计 | `skills/article-cover-designer/SKILL.md` |
| `article-illustration-planner` | 文章配图规划 | `skills/article-illustration-planner/SKILL.md` |
| `community-share` | 作品分享 | `skills/community-share/SKILL.md` |
| `editorial-hairstylist` | 发型设计 | `skills/couple-photo-orchestrator/skills/hairstyle/SKILL.md` |
| `couple-photo-wardrobe-board` | 换装设计 | `skills/couple-photo-orchestrator/skills/huanzhuang/SKILL.md` |
| `couple-photo-requirements-planner` | 写真需求沟通 | `skills/couple-photo-orchestrator/skills/kefu/SKILL.md` |
| `editorial-makeup-artist` | 妆容设计 | `skills/couple-photo-orchestrator/skills/makeup/SKILL.md` |
| `reference-beauty-prep` | 人像美化 | `skills/couple-photo-orchestrator/skills/meihua/SKILL.md` |
| `couple-photo-shooting-planner` | 写真拍摄 | `skills/couple-photo-orchestrator/skills/paishe/SKILL.md` |
| `couple-photo-orchestrator` | 双人写真规划 | `skills/couple-photo-orchestrator/SKILL.md` |
| `custom-asset-manager` | 自定义素材管理 | `skills/custom-asset-manager/SKILL.md` |
| `handraw-skill` | 手绘风格与排版 | `skills/handdraw-style-prompter/SKILL.md` |
| `ip-designer` | IP 角色设计 | `skills/ip-designer/SKILL.md` |
| `layout-library-importer` | 排版库导入 | `skills/layout-library-importer/SKILL.md` |
| `handraw-personal-library` | 个人风格库 | `skills/personal-library/SKILL.md` |
| `poster-prompt-generator` | 海报提示词 | `skills/poster-prompt-generator/SKILL.md` |
| `release-illustration-planner` | 发布配图规划 | `skills/release-illustration-planner/SKILL.md` |
| `style-business-analyzer` | 风格商业分析 | `skills/style-business-analyzer/SKILL.md` |
| `style-fusion-prompter` | 风格融合 | `skills/style-fusion-prompter/SKILL.md` |
| `style-library-importer` | 风格库导入 | `skills/style-library-importer/SKILL.md` |
| `tweet-style-importer` | 推文风格导入 | `skills/tweet-style-importer/SKILL.md` |

所有卡片声明相同的 `packageId`、`packageDirectory` 和 `upstream`；`skillPath` 指向各自原版入口。发布器只生成一个 ZIP，安装任意一张后其余卡片共享同一份仓库、摘要及启停/卸载状态。应用仅在原文件之外生成 `openmind.skill.yaml`、`openmind.library.json` 和展示头像。许可证保留在原版 `LICENSE`。

安装和选用相互独立。模型不接收全部已安装 Skill 的目录、描述或路径，Codex 和 Claude 的原生自动发现也保持关闭。用户通过对话卡片、选择器或斜杠命令明确选用后，本轮才加载对应原文及其引用资料。下一轮未选用时不沿用上一轮的选用授权。原版要求的运行依赖和输出行为仍以原文为准，应用不把提示词流程改写为图片生成工作流。

原来的 10 个 `om-*` 图像改编预设及其专属指令、裁剪参考库已删除。旧 ID 仅保留在退役识别清单中，防止旧缓存重新提供入口；新版仍在使用的封面和作者头像继续保留。历史内容及用户独立导入的副本保留。

验证共享安装与原文完整性：

```bash
npm run publish:skill-library
npx vitest run electron/skills/original-skill-repository.test.ts electron/skills/handraw-library.test.ts electron/skills/skill-registry-publisher.test.ts electron/skills/skill-library-remote.test.ts
```

## 原生包与 RSS 转换器

`catalog.json` 的 `packageDirectory` 指向 `packages/` 下源码，`executionKind` 保留 agent/process/workflow，`discoverable` 决定是否展示在探索中。`prepare:skill-library` 将 6 个内置包、它们需要的共享 `_shared` 和 RSS 源目录复制到忽略的 `.build/skill-library/`，其余包独立输出到 `skill-registry/`。两种分发都先验证并统一生成 `openmind-library` 身份及内容摘要。安装器继续识别 `cctools.skill.yaml` 和 `openmind.skill.yaml`。

跨 Windows、macOS、Linux 同步内容仓库时，每台机器仍使用自己的 `openmindRoot` 配置，CLI 则使用显式的 `--root`。安装注册表中的标准路径 `…/.agent/skills/<skillId>` 在读取时解析到当前内容根目录下；读取不会将本机绝对路径回写到同步文件。安装包仍须通过内容摘要、Manifest 身份和真实路径边界校验；缺失、被修改或通过符号链接越界的包不会因此获得运行权限。旧的嵌套安装布局保持原有处理方式。

`migration.json` 记录原仓库修订和文件去向。`../rss-sources/catalog.json` 是公开建议清单，不是用户订阅；用户初始化后不会自动追加新版建议。带用户身份的订阅只在用户本地迁移，不能加入公共清单。

Knowledge Wiki 生成器不打包、不列入默认集合。确认归属的官方旧包可卸载；已有 Wiki 文件与用户主动导入的副本保留。

运行报告（`skill-run-reporter`）和视频烧录字幕（`video-burnin-subtitles`）已移除源码并退出分发。升级时按来源识别旧内置安装，隐藏卡片并阻止新任务、停用相关定时规则；已有内容、安装文件和运行历史保留，用户导入或显式保留的副本不受影响。RSS/偏好数据格式、调度和安装包验收见 [使用指南](../../docs/RSS_AND_SKILLS_GUIDE.md)。

每日选题 `daily-topic-selector` 已退役，不再分发或接受新任务。升级移除其默认自动化，保留历史运行、已有选题文档及独立导入的副本。
