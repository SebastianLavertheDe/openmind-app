# RSS 主题分类

更新：2026-10-28（Asia/Shanghai）。主题映射维护在 `config/rss-sources/catalog.json`，稳定 ID 维护在 `shared/rss-categories.ts`。公开目录共有 227 个源；下表数量是目录快照，页面结果数以当前内容根的订阅为准。

## 八个默认主题

| Tab 名称 | 存储 ID | 源数 | 范围 | 代表来源 |
| --- | --- | ---: | --- | --- |
| AI | `ai` | 48 | 模型发布、机器学习研究、实验室与论文 | OpenAI、Google DeepMind、Stanford HAI、Hugging Face、DeepSeek |
| Agent | `agents` | 11 | 智能体、工具调用、AI 编程和自动化工程 | Anthropic Engineering、Cursor、LangChain、Latent Space、Lilian Weng、Dify |
| Prompt | `prompts` | 20 | 提示词、AI 工具使用、创作方法和应用案例 | Claude Blog、Ben's Bites、歸藏的AI工具箱、赛博禅心、向阳乔木、阿真Irene |
| 编程技术 | `engineering` | 89 | 软件工程、编程语言、系统、开源与安全 | Azure、DHH、Jeff Geerling、antirez、Krebs on Security、Sean Goedecke |
| 产品设计 | `product` | 12 | 产品思维、交互、体验、视觉设计 | Smashing Magazine、Jim Nielsen、Geoffrey Litt、优设、体验进阶、超人的电话亭 |
| 商业创业 | `business` | 18 | 创业、投资、商业模式与经营 | Sequoia、Greylock、Bessemer、NFX、Menlo、a16z |
| 科技资讯 | `tech` | 21 | 科技行业动态、硬件、产业与社会影响 | TLDR、Daring Fireball、Pluralistic、Construction Physics、Derek Thompson |
| 生活思考 | `life` | 8 | 生活、阅读、心理、个人写作与思考 | LessWrong、dynomight、Gwern、Herman、Experimental History、L先生 |

每个源目前只有一个主分类。作者常跨多个领域，按主要内容和阅读用途归类；例如投资机构的 AI 专栏仍放在商业创业，提示词和工具实践放在 Prompt。用户可随时修改归属。目录变更经过人工维护，运行时不会根据名称自动猜分类。

原有 `blog` 和 `WeChat` 表示渠道，保留为 `tags`，不再作为默认主题 Tab。搜索仍能匹配渠道标签。

分类时结合源名称、网站及作者自述；对边界来源核对了 [向阳乔木的介绍](https://www.qiaomu.ai/about/)、[阿真Irene 的公开项目](https://github.com/irenerachel)、[超人的电话亭作者的设计文章](https://www.uxbaike.com/page/7289)、[Daniel De Laney 的个人网站](https://danieldelaney.net/)、[Herman 的自述](https://herman.bearblog.dev/)和 [Experimental History 的介绍](https://www.experimental-history.com/about)。归类是本目录的编辑判断，不是这些来源自行声明的统一标签。

## 添加、编辑和浏览

- 分类 Tab 沿用 Skills 的图标、名称、胶囊选中效果和键盘导航。八个默认主题始终存在，后面追加实际使用的自定义分类和未分类；源数量集中显示在结果区。
- 添加、编辑源均可选择内置主题、已有自定义分类或未分类。选择「新建分类…」后输入名称，与源一起保存。
- 名称最多 200 字符，清理首尾空白。比较同名分类时忽略大小写和全半角差异；UI 也匹配内置主题的显示名称，复用原有分类。
- 空名称不能保存。保存失败保留输入；取消不会创建分类。分类由源的 `group` 派生，没有空分类记录或另一份独立分类列表。
- 分类、搜索、状态筛选共同决定结果。删除或移动自定义分类的最后一个源后，该 Tab 消失；如果当前选中它，回到全部。默认主题没有源时保留空态。
- 仅修改分类不会触发链接检测；历史错误、RSS 更新/正文采集时间保持不变，当前有效 XML 保持有效，过期 XML 仍然过期。

## 旧配置迁移

旧 `sources.json` 没有 `categoryVersion` 时，首次读取在 registry 锁内进行一次性迁移，原子保存后标记 `categoryVersion: 1`：

1. 仅处理原来属于 `blog`、`WeChat` 的源。按实际 `inputUrl` 匹配公开目录，找到后采用其主题；地址已改为目录外网址或无匹配的源进入未分类，不仅凭 `presetId` 强行归类。
2. 原渠道加入标签。已有自定义分组、明确清空的分类保持原样；不新增或恢复源，不更改启停、名称、地址、删除记录、历史错误和采集时间。
3. 被迁移源的修订号递增，使迁移前的在途结果不能覆盖新状态。仅在 XML 原本与修订号一致时对齐 `feedRevision`；不改写 XML 内容，不把过期文件标为就绪。
4. 标记存在后不重复迁移。此后用户的分类选择以用户为准。

首次从历史 OPML 建档或新导入 OPML 时，旧渠道分组采用相同的主题映射；自定义 OPML 文件夹保持原名。没有分组、且能匹配目录的导入源采用目录主题，其余进入未分类。重复导入按地址去重。

## 验证入口

- `electron/rss/rss-repository.test.ts`：227 个稳定 ID、八个主题、渠道标签、代表映射、一次性迁移、XML 有效性、用户状态保护、旧 OPML 和同名分类。
- `renderer/src/features/sources/SourcesPage.test.tsx`：已有分类选择、新建/复用、保存失败保留输入、保存后筛选、分类编辑不重新检测。
- `scripts/rss-ui-smoke.cjs`：用 227 个公开定义生成页面截图，不抓取 Feed；验证分类选择及新建交互。长分类名、长地址和 213 源压力夹具独立运行，不混作正常页面示例。

截图与测试仅使用临时配置。Windows/macOS 像素基线需在对应原生环境验收，Linux 截图不代替该项检查。
