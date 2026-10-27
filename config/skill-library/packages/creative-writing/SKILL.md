---
name: creative-writing
description: "Chinese content creation workflow for multi-platform publishing (WeChat Official Account / 公众号, Xiaohongshu / 小红书, short video / 短视频). Covers topic capture, material research from the local knowledge base, draft writing, title generation, cover text design, video intro optimization, article archiving, and data tracking. Use this skill whenever the user mentions writing articles, creating content for Chinese social media, managing topics (选题), generating titles (标题), writing drafts (文稿), creating cover text (封面), optimizing video intros (开头), recording data (数据), archiving articles (收录文章), or any content production activity for 公众号/小红书/短视频 — even if they don't explicitly name this skill. Also use when the user says trigger words like 记录选题, 深化选题, 写当天主题, 接管发布包, 生成发布包草稿, 写某个主题, 不限时间, 生成标题, 生成封面, 优化开头, 检索素材, 收录文章, 搜索补充资料, 记录数据, 沉淀素材, or 发布了."
allowed-tools: Bash,Write,Read,Edit,Glob,Grep,WebSearch
---

# Creative Writing - 内容生产系统

A systematic content creation workflow that turns fragmented creation into a repeatable, knowledge-driven production system. Every piece of content feeds back into the material library for future reuse.

## Directory Map

> All paths in this document are relative to the content root `$OPENMIND_ROOT` — the data root the user selected in openmind-app. Always resolve via `$OPENMIND_ROOT`, never assume a fixed location.

The system spans two locations:

**Content production** at `$OPENMIND_ROOT/creative/`:
```
01-内容生产/
├── 选题管理/
│   ├── 00-选题收集箱.md       # Quick capture for raw ideas
│   └── 01-选题池.md           # Screened, ready-to-develop topics
├── 文稿库/
│   ├── 01-待深化/             # Topics confirmed, drafts to write
│   ├── 02-制作中/             # Drafts written, awaiting publish
│   └── 03-已发布/
│       ├── 公众号/
│       └── 小红书/
02-方法论/
├── 公众号/公众号方法论.md
├── 小红书/小红书方法论.md
└── 短视频/短视频方法论.md
03-数据统计/内容数据统计.md
04-业务运营/
```

**Knowledge base** at `$OPENMIND_ROOT/` (the user-selected data root):
```
article/          # Archived web articles, original text, extracts
daily-summary/    # Daily info summaries and reviews
daily-topic/      # Daily topic ideas and creative leads
post/             # Finished content archives, by date
weixin-drafts/    # WeChat draft articles
wiki/
├── concepts/     # Core concepts, frameworks, models
├── entities/     # People, companies, products, platforms
├── themes/       # Thematic threads, topic clusters
├── sources/      # Source references and links
├── queries/      # Research results and explorations
├── index/        # Index files for quick lookup
└── _state/       # System state (don't edit directly)
```

When this skill says "素材库", it means the knowledge base above ($OPENMIND_ROOT).

---

## Commands (triggered by Chinese keywords)

### 1. 记录选题 (Record Topic)

**Triggers**: `记录选题`, `有个想法`, `选题`

1. If the user's idea isn't clear, ask what it is
2. Append to `creative/01-内容生产/选题管理/00-选题收集箱.md`
3. Format: `- [ ] 选题内容 | 来源 | YYYY-MM-DD`
4. Confirm with a short message

### 2. 深化选题 (Develop Topic into Draft)

**Triggers**: `深化选题`, `写文稿`, `展开这个选题`

This is the core creation command. The workflow is critical — follow it exactly:

Use the three-step creation method for every serious draft:

1. 获取信息: search and collect enough source material before writing.
2. 找角度: decide the specific angle, contrast, reader surprise, and one-sentence thesis.
3. 创作: turn the angle into a story with scenes, rhythm, and platform-specific structure.

**Step 1: Search the knowledge base** (mandatory, never skip)

Search these directories under $OPENMIND_ROOT for relevant material:
- `daily-summary/` — daily source summaries and X/Reddit observations?
- `daily-topic/` — daily reading leads and prior topic notes?
- `post/` — X/Twitter collected posts and rendered pages?
- `reddit/` — Reddit community observations?
- `article/` and `wiki/sources/` — articles, data, references?
- `wiki/concepts/` — theory frameworks?
- `wiki/themes/` — thematic threads and viewpoints?
- `wiki/entities/` — people, products, platforms?
- `weixin-drafts/` — reusable WeChat drafts?
- `creative/01-内容生产/选题管理/` — social-media topic files and planning notes?
- `creative/01-内容生产/文稿库/03-已发布/` — prior published content and reusable structures?

**Step 2: Suggest reuse**

If relevant material is found, show it to the user and suggest reusing rather than creating from scratch.

**Step 3: Design the angle before writing**

Before generating a topic brief or full draft, define:
- 常规写法: most people would write this topic from what obvious angle?
- 避开角度: which obvious angle should this piece avoid?
- 推荐角度: the strongest angle for this piece, stated in one direct sentence.
- 读者新理解: what should the reader understand after reading that they did not see before?
- 开头场景: one concrete scene, conflict, question, or anecdote that can open the piece.
- 故事线: how the piece moves from scene to problem to insight to conclusion.

If the angle is weak or only summarizes information, say so and ask for more direction instead of writing a bland draft.

**Step 4: Generate the output**

1. Ask: target platform? (小红书/公众号)
2. Ask: content type? (图文/短视频/音频)
3. Read the platform methodology file (see References section below)
4. If the user asks to deepen/develop a topic, create a topic brief: core viewpoint, target reader, usable materials, angle design, opening direction, story line, missing research, and next writing step
5. Save topic briefs to `creative/01-内容生产/文稿库/01-待深化/`
6. If the user asks for a full article/script, write the draft following the writing rules below
7. Save full drafts to `creative/01-内容生产/文稿库/02-制作中/`
8. Filename: `YYYYMMDD-平台-选题.md`

### 2.1 接管发布包并写正文 (Continue Package Into Draft)

**Triggers**: `接管发布包`, `继续写这个发布包`, `生成发布包草稿`, `写这个 topic-brief`, `写当天主题`

Use this after `daily-writing-orchestrator` has selected today's topic and created a package under:

`creative/01-内容生产/文稿库/02-制作中/YYYYMMDD-选题名/`

Default topic behavior:

- If the user does not specify a topic, use today's package generated by `daily-writing-orchestrator`.
- If today's package does not exist, run `daily-writing-orchestrator` first or ask the user to confirm which package to use.
- If the user specifies a topic, use that topic and still search the full local material library before writing.

Workflow:

1. Read `topic-brief.md`, `manifest.json`, and the requested platform task file (`xiaohongshu-draft.md`, `wechat-draft.md`, or `twitter-thread.md`)
2. Search the full local `$OPENMIND_ROOT/` material library before writing, following the mandatory search rules above
3. Read the relevant platform methodology file
4. Confirm the three-step creation frame from the package: information, angle, and story line. If the package lacks a usable angle, add one before drafting.
5. Replace the task body with a real platform draft while preserving frontmatter
6. Keep source, risk, and image-slot sections in the draft
7. Leave the package under `文稿库/02-制作中/` until the user says `发布了`

### 3. 生成标题 (Generate Titles)

**Triggers**: `生成标题`, `起个标题`, `标题`

1. Read the target platform's methodology file
2. Generate 3-5 title options based on the platform's title formulas
3. For each title, explain the logic behind it (which formula it uses, why it works)

Output format:
```
1. [公式类型] 标题文字
   → 简短解释逻辑
```

### 4. 生成封面文字 (Cover Text for Xiaohongshu)

**Triggers**: `生成封面`, `封面文字`

1. Read `references/xiaohongshu-methodology.md` cover section
2. Generate 3-5 cover text options, each 3-7 characters
3. Prioritize contrast, conflict, or numbers

### 5. 优化开头 (Optimize Video Intro)

**Triggers**: `优化开头`, `开头`, `前3秒`

1. Read `references/short-video-methodology.md`
2. Analyze what's wrong with the current intro
3. Provide 3 optimized versions using different hook types (问题型/反常识型/数字型)
4. Explain the logic for each

### 6. 检索素材 (Search Material Library)

**Triggers**: `检索素材`, `找素材`, `有没有相关的`

1. Search `$OPENMIND_ROOT/` for the keyword
2. Return matching files with brief content descriptions
3. Highlight the most relevant items

### 7. 收录文章 (Archive Web Article)

**Triggers**: `收录文章`, `保存这篇文章`, `加入资料库`

1. Gather: source (公众号/知乎/36氪 etc.), author, title, link (optional)
2. Ask what to extract: core viewpoints, great passages, reusable material (data/cases/quotes/frameworks), inspirations
3. Save to `article/YYYYMMDD/`
4. Filename: `来源-作者-标题.md`
5. Use standard article template with metadata header

### 8. 搜索补充资料 (Web Search for Material)

**Triggers**: `搜索`, `查一下`, `需要数据`, `补充资料`

1. Use WebSearch to find information
2. Extract and present key findings with source attribution
3. If the material is valuable, ask whether to archive it to the knowledge base

### 9. 记录数据 (Record Performance Data)

**Triggers**: `记录数据`, `数据复盘`, `这条内容数据`

1. Ask for: content title, platform, metrics
2. Record to `creative/03-数据统计/内容数据统计.md`
3. If performance is outstanding, suggest adding to 爆款文稿库

### 10. 沉淀素材 (Deposit Material)

**Triggers**: `沉淀素材`, `保存到素材库`, `这个概念很好`

1. Ask: what type? (核心概念/金句/案例)
2. Save to the appropriate knowledge-base subdirectory:
   - Concepts → `wiki/concepts/概念名称.md`
   - Quotes → append to relevant theme file
   - Cases → `wiki/sources/类型-案例名称.md`

### 11. 移动文稿 (Move to Published)

**Triggers**: `发布了`, `移动到已发布`

1. Move the draft from its current location to `文稿库/03-已发布/对应平台/`
2. Ask whether to record performance data

---

## Writing Rules (apply to ALL content creation)

### Rule 1: Kill the AI Tone

These contrast patterns scream "AI wrote this" — never use them:

- 不是...但是...
- 应该...而非...
- 在于...而非...
- 不在于...而在于...
- 不...而...
- 不...而是...
- 不...而在于...
- 更多是...而非...
- 不应是...而应该是...
- 不只是...还有...
- 不只有...还有...
- 不是...而是...
- 不再是...而是...
- 之所以...是因为...
- 既是...也是...

**Instead**: state the point directly. Use causal links (因为/所以). Use concrete scenes and examples. Write like talking to a friend.
Avoid sentences that first negate something and then pivot with "而/而是/而在于"; say the conclusion directly.

Examples of the fix:

| Bad (AI tone) | Good (natural) |
|---|---|
| "AI陪伴不是解决方案，而是暴露了问题。" | "AI陪伴只是暴露了问题，真正的问题是我们太孤独了。" |
| "这不只是商业决策，还有道德选择。" | "这是商业决策，更是道德选择。" |
| "这不是劝阻，而是肯定。" | "这哪里是劝阻？这是肯定。" |

### Rule 2: No List-Style Writing

- No long dash lists
- No "第一、第二、第三" enumeration
- No Q&A-style subheaders (### 1. 问题？### 2. 问题？)
- Use flowing paragraphs instead. Connect ideas like telling a story. Transition naturally, like chatting with the reader.

### Rule 3: Write Like a Friend

Conversational tone. Concrete scenes over abstract principles. Short paragraphs. Bold the key points. Leave breathing room between ideas.

### Rule 4: Build Around Angle and Rhythm

Do not turn material into a compressed report. A good draft must make the source material readable as a story.

- Start from one clear angle, not a pile of facts.
- Prefer a concrete scene, conflict, or reader pain over abstract setup.
- Give the reader a new way to see the topic, not just more information.
- Design rhythm: setup, tension, turn, example, payoff.
- If the draft reads like information搬运, rewrite around the angle before polishing sentences.

---

## References

Read these platform methodology files when generating content for the specific platform:

- **公众号 (WeChat Official Account)**: Read `references/wechat-methodology.md` — title formulas (悬念型/干货型/故事型/观点型/清单型), long-form structure, layout rules, publish timing, data review template
- **小红书 (Xiaohongshu)**: Read `references/xiaohongshu-methodology.md` — title formulas (数字+痛点/反常识/身份认同/紧迫感/好奇心), cover design rules, content structure for both image-text and video
- **短视频 (Short Video)**: Read `references/short-video-methodology.md` — intro hook types, pacing (one info point per 3-5 seconds), ending design, intro performance tracking
- **Cover Image Preferences**: Read `references/cover-image-preferences.md` — color palette, design style, dimension specs for each platform

Always read the relevant methodology file before generating content — it contains platform-specific title formulas, structure templates, and data tracking formats.

---

## File Naming Convention

| Type | Pattern | Example |
|---|---|---|
| Draft | `YYYYMMDD-平台-选题.md` | `20240115-小红书-为什么普通人更应该做内容.md` |
| Concept | `概念名称.md` | `内容复利.md` |
| Quote | append to theme file | — |
| Case | `类型-案例名称.md` | `个人经历-从0到1做内容.md` |
| Viral content | `平台-数据-选题.md` | `小红书-10w+-普通人做内容.md` |
| Web article | `来源-作者-标题.md` | `公众号-刘润-2024商业趋势.md` |

---

## Work Principles

1. **Search before creating**: Always search the knowledge base before writing. Reuse beats reinvention.
2. **Suggest reuse**: Found something relevant? Tell the user. Don't silently rewrite.
3. **Deposit after creating**: After each piece, ask if anything is worth saving back to the knowledge base.
4. **Data drives iteration**: Remind the user to record performance data. Methodology evolves from evidence.
5. **Platform awareness**: Different platforms have different rules. Always read the methodology file first.
6. **Don't over-create**: If existing material works, use it. Not everything needs to be original.
7. **Consistent naming**: Follow the file naming conventions. Consistency makes retrieval reliable.
