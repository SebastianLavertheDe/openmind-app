# RSS topic review

`catalog.json` owns App-shipped source definitions and their default topics.
Classify a feed by its sustained article content, using recent entries and the
publisher's own description. A publisher's name, delivery channel, or a single
off-topic article is not sufficient evidence. `blog` and `WeChat` are channel
tags, not topics. Private subscription URLs and fetched article text never belong
in this directory.

| Topic | Content |
| --- | --- |
| `ai` | Models, ML research, training, evaluation, AI safety and AI news |
| `agents` | Agent frameworks, tools, harnesses, automation and application architecture |
| `prompts` | Practical AI usage, prompting, creative workflows and tool tutorials |
| `engineering` | Programming, infrastructure, security and open-source development |
| `product` | Product design, interface design, UX and interaction |
| `business` | Startups, investing, growth and commercialization |
| `tech` | Broader technology reporting, computing history and technology policy |
| `life` | Personal essays, reading, psychology, culture and social commentary |

The 2026-10-28 review corrected these defaults after checking article subjects:

| Source | Topic | Content focus |
| --- | --- | --- |
| Claude Blog | `ai` | Product announcements and broader Claude developments |
| Lilian Weng | `ai` | Scaling laws, reasoning, RL, training data and model research |
| gilesthomas.com | `ai` | GPT training, normalization, MoE and ML experiments |
| LessWrong | `ai` | AI safety, alignment and model behavior alongside rationality |
| shkspr.mobi | `life` | Books, theatre, personal reviews and everyday technology |
| hey.paris | `tech` | Technology policy, games, research and public-interest essays |
| danielchasehooper.com | `engineering` | C data structures, compilers, shaders and developer tools |
| 随机小分队 | `business` | Startup growth, financing and Agent commercialization |
| 深思圈 | `business` | AI company strategy, founders and product businesses |
| 山行AI | `agents` | Agent infrastructure, MCP and implemented automation workflows |
| 赛博禅心 | `ai` | Model releases, AI research and industry developments |
| AI寒武纪 | `ai` | AI model and industry news rather than primarily prompt tutorials |
| 浮之静 | `agents` | Agent runtimes, MCP, development workflows and AI tooling |
| 语言即世界language is world | `ai` | Interviews about AI research and its direction |
| 43 Talks | `business` | AI entrepreneurship, investing and organizational change |
| yikai 的摸鱼笔记 | `ai` | AI research and technology interviews and analysis |
| derekthompson.org | `life` | Social, cultural and economic commentary |

Publisher references include [Anthropic Engineering](https://www.anthropic.com/engineering),
[Cursor](https://cursor.com/blog), [Claude articles](https://claude.com/resources/articles),
[Lil'Log](https://lilianweng.github.io/), [Giles Thomas](https://gilesthomas.com/),
[Paris Buttfield-Addison](https://hey.paris/),
[Derek Thompson](https://www.theatlantic.com/author/derek-thompson/),
[ShowMeAI](https://www.cnblogs.com/showmeai),
[开源服务指南](https://osguider.com/), and
[The Gradient](https://thegradient.pub/about/).

Category migration version 2 repairs older registries with blank known-source
topics or the shipped `WeChat Tech and AI Feeds` folder. It matches the actual
subscription URL or a reviewed legacy alias, preserves custom groups and runtime
state, and does not repeat after a user deliberately clears a category. Unknown
subscriptions are left for content review rather than guessed from their names.
