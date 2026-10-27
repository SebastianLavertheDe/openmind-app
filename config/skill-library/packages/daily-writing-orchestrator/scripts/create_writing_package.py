#!/usr/bin/env python3
import argparse
import datetime as dt
import json
import re
from pathlib import Path
from typing import Dict, List, Optional, Tuple

from runtime_paths import RuntimePathError, relative_content_path, require_content_root, resolve_content_path

TOPIC_DIR_RELATIVE = Path("creative/01-内容生产/选题管理")
OUTPUT_ROOT_RELATIVE = Path("creative/01-内容生产/文稿库/02-制作中")


def normalize_date(value: str) -> Tuple[str, str]:
    if not value:
        now = dt.datetime.now()
        return now.strftime("%Y%m%d"), now.strftime("%Y-%m-%d")

    value = value.strip()
    if re.fullmatch(r"\d{8}", value):
        parsed = dt.datetime.strptime(value, "%Y%m%d")
        return parsed.strftime("%Y%m%d"), parsed.strftime("%Y-%m-%d")
    if re.fullmatch(r"\d{4}-\d{2}-\d{2}", value):
        parsed = dt.datetime.strptime(value, "%Y-%m-%d")
        return parsed.strftime("%Y%m%d"), parsed.strftime("%Y-%m-%d")
    raise ValueError("--date must be YYYYMMDD or YYYY-MM-DD")


def parse_topic_file_date(path: Path) -> Optional[Tuple[str, str, int]]:
    daily = re.fullmatch(r"(\d{8})_daily_topic\.md", path.name)
    if daily:
        parsed = dt.datetime.strptime(daily.group(1), "%Y%m%d")
        return parsed.strftime("%Y%m%d"), parsed.strftime("%Y-%m-%d"), 1
    match = re.fullmatch(r"ai_topic_(\d{4}-\d{2}-\d{2})(?:_v(\d+))?\.md", path.name)
    if not match:
        return None
    parsed = dt.datetime.strptime(match.group(1), "%Y-%m-%d")
    version = int(match.group(2) or "1")
    return parsed.strftime("%Y%m%d"), parsed.strftime("%Y-%m-%d"), version


def section(content: str, heading_pattern: str) -> str:
    match = re.search(heading_pattern, content, flags=re.MULTILINE)
    if not match:
        return ""
    start = match.start()
    next_match = re.search(r"^##\s+", content[match.end() :], flags=re.MULTILINE)
    if not next_match:
        return content[start:].strip()
    return content[start : match.end() + next_match.start()].strip()


def subsection(content: str, title: str) -> str:
    pattern = rf"^###\s+{re.escape(title)}\s*$"
    match = re.search(pattern, content, flags=re.MULTILINE)
    if not match:
        return ""
    start = match.end()
    next_match = re.search(r"^###\s+", content[start:], flags=re.MULTILINE)
    if not next_match:
        return content[start:].strip()
    return content[start : start + next_match.start()].strip()


def clean_inline_markdown(text: str) -> str:
    text = re.sub(r"\[([^\]]+)\]\([^)]+\)", r"\1", text)
    text = re.sub(r"[*_`#>]", "", text)
    return re.sub(r"\s+", " ", text).strip(" -\t\r\n")


def first_meaningful_line(text: str) -> str:
    for raw in text.splitlines():
        line = raw.strip()
        if not line or line.startswith("###") or line.startswith("---"):
            continue
        bold = re.search(r"\*\*([^*]+)\*\*", line)
        if bold:
            return clean_inline_markdown(bold.group(1))
        return clean_inline_markdown(line)
    return ""


def extract_links(text: str) -> List[Dict[str, str]]:
    links: List[Dict[str, str]] = []
    seen = set()
    for label, url in re.findall(r"\[([^\]]+)\]\(([^)]+)\)", text):
        key = (label.strip(), url.strip())
        if key in seen:
            continue
        seen.add(key)
        links.append({"label": key[0], "url": key[1]})
    return links


def parse_candidate_rows(candidate_section: str) -> List[Dict[str, str]]:
    rows: List[Dict[str, str]] = []
    for raw in candidate_section.splitlines():
        line = raw.strip()
        if not line.startswith("|") or "---" in line or "热点" in line and "来源" in line:
            continue
        cells = [clean_inline_markdown(cell) for cell in line.strip("|").split("|")]
        if len(cells) < 7:
            continue
        rows.append(
            {
                "title": cells[0],
                "source": cells[1],
                "reliability": cells[2],
                "viral_potential": cells[3],
                "writing_value": cells[4],
                "risk": cells[5],
                "editor_note": cells[6],
            }
        )
    return rows


def find_heading_block(content: str, keyword: str) -> str:
    keyword_l = keyword.lower()
    heading_matches = list(re.finditer(r"^###\s+(.+)$", content, flags=re.MULTILINE))
    for pos, match in enumerate(heading_matches):
        heading = clean_inline_markdown(match.group(1))
        if keyword_l not in heading.lower():
            continue
        start = match.start()
        end = heading_matches[pos + 1].start() if pos + 1 < len(heading_matches) else len(content)
        return content[start:end].strip()
    return ""


def select_topic(content: str, mode: str, topic_index: int) -> Dict[str, object]:
    structured = re.search(r"<!--\s*openmind-topics\s+([\s\S]*?)\s*-->", content)
    if structured:
        payload = json.loads(structured.group(1))
        rows = payload.get("items")
        if payload.get("schemaVersion") != 1 or not isinstance(rows, list):
            raise ValueError("Invalid OpenMind topic metadata.")
        if not rows:
            raise ValueError("No topics match the saved preferences.")
        if any(not isinstance(row, dict) or not isinstance(row.get("title"), str) or not row["title"].strip() for row in rows):
            raise ValueError("Topic metadata is missing a title.")
        if topic_index > 0:
            if topic_index > len(rows): raise ValueError(f"--topic-index {topic_index} out of range; candidates={len(rows)}")
            row = rows[topic_index - 1]
        elif mode and mode != "auto":
            row = next((item for item in rows if mode.lower() in item["title"].lower()), None)
            if row is None: raise ValueError(f"No topic matched keyword: {mode}")
        else:
            row = rows[0]
        context = '\n\n'.join(str(row.get(key) or '') for key in ["title", "summary", "reason", "sourceFile"])
        return {"mode": "topic-index" if topic_index > 0 else "topic" if mode != "auto" else "auto", "title": row["title"], "final_section": context,
                "matched_context": context, "candidate": None, "links": row.get("links", []), "preferencesRevision": payload.get("preferencesRevision")}

    final_section = section(content, r"^##\s+1\.\s+今日最终推荐\s*$")
    candidate_section = section(content, r"^##\s+4\.\s+今日候选热点池\s*$")
    xhs_section = section(content, r"^##\s+2\.\s+小红书选题 Agent 输出\s*$")
    wechat_section = section(content, r"^##\s+3\.\s+微信公众号选题 Agent 输出\s*$")
    candidates = parse_candidate_rows(candidate_section)

    if topic_index > 0:
        if topic_index > len(candidates):
            raise ValueError(f"--topic-index {topic_index} out of range; candidates={len(candidates)}")
        row = candidates[topic_index - 1]
        title = row["title"]
        return {
            "mode": "topic-index",
            "topic_index": topic_index,
            "title": title,
            "final_section": final_section,
            "matched_context": format_candidate_row(row),
            "candidate": row,
            "links": extract_links(final_section + "\n" + candidate_section),
        }

    if mode and mode != "auto":
        keyword = mode
        final_title = first_meaningful_line(subsection(final_section, "今日最值得优先写的主题"))
        if keyword.lower() in final_title.lower():
            return {
                "mode": "topic",
                "topic_keyword": keyword,
                "title": final_title,
                "final_section": final_section,
                "matched_context": final_section,
                "candidate": None,
                "links": extract_links(final_section),
            }

        for idx, row in enumerate(candidates, start=1):
            if keyword.lower() in row["title"].lower():
                return {
                    "mode": "topic",
                    "topic_keyword": keyword,
                    "topic_index": idx,
                    "title": row["title"],
                    "final_section": final_section,
                    "matched_context": format_candidate_row(row),
                    "candidate": row,
                    "links": extract_links(final_section + "\n" + candidate_section),
                }

        block = find_heading_block(xhs_section + "\n" + wechat_section, keyword)
        if block:
            heading = re.search(r"^###\s+(.+)$", block, flags=re.MULTILINE)
            title = clean_inline_markdown(heading.group(1)) if heading else keyword
            title = re.sub(r"^选题[一二三四五六七八九十]+[:：]\s*", "", title)
            return {
                "mode": "topic",
                "topic_keyword": keyword,
                "title": title,
                "final_section": final_section,
                "matched_context": block,
                "candidate": None,
                "links": extract_links(final_section + "\n" + block),
            }

        raise ValueError(f"No topic matched keyword: {keyword}")

    title_block = subsection(final_section, "今日最值得优先写的主题")
    title = first_meaningful_line(title_block)
    if not title:
        raise ValueError("Could not find final recommended topic title.")
    return {
        "mode": "auto",
        "title": title,
        "final_section": final_section,
        "matched_context": title_block,
        "candidate": None,
        "links": extract_links(final_section),
    }


def format_candidate_row(row: Dict[str, str]) -> str:
    return "\n".join(
        [
            f"- 标题：{row.get('title', '')}",
            f"- 来源：{row.get('source', '')}",
            f"- 可靠性：{row.get('reliability', '')}",
            f"- 传播潜力：{row.get('viral_potential', '')}",
            f"- 写作价值：{row.get('writing_value', '')}",
            f"- 风险：{row.get('risk', '')}",
            f"- 主编备注：{row.get('editor_note', '')}",
        ]
    )


def safe_name(text: str, max_len: int = 64) -> str:
    text = clean_inline_markdown(text)
    text = re.sub(r"[\\/:*?\"<>|]", "", text)
    text = re.sub(r"\s+", "-", text).strip("-")
    return text[:max_len] or "untitled-topic"


def unique_package_dir(root: Path, date_compact: str, title: str) -> Path:
    base = root / f"{date_compact}-{safe_name(title)}"
    if not base.exists():
        return base
    for idx in range(2, 100):
        candidate = root / f"{date_compact}-{safe_name(title)}-v{idx}"
        if not candidate.exists():
            return candidate
    raise RuntimeError("Could not allocate unique package directory")


def platform_list(value: str) -> List[str]:
    if value == "all":
        return ["xiaohongshu", "wechat", "twitter"]
    return [value]


def write_topic_brief(
    path: Path,
    date_dash: str,
    topic_file: Path,
    selected: Dict[str, object],
    platforms: List[str],
    content_root: Path,
) -> None:
    final_section = str(selected.get("final_section") or "")
    title = str(selected["title"])
    core_judgment = str(selected.get("matched_context") or "") or subsection(final_section, "今日最值得优先写的主题")
    editor_note = str(selected.get("editor_note") or subsection(final_section, "主编判断") or "待从 ai topic 中补充主编判断。")
    platform_note = str(selected.get("platform_note") or subsection(final_section, "首发平台建议") or "待补充首发平台建议。")
    risk_note = str(selected.get("risk_note") or subsection(final_section, "风险控制") or "暂无；写作时继续从 ai topic 风险点中补充。")
    links = selected.get("links") or []
    link_lines = "\n".join(
        f"- [{item['label']}]({item['url']})" for item in links if isinstance(item, dict)
    ) or "- 暂无显式 Markdown 链接；creative-writing 写作前需要从本地素材库补齐来源。"

    content = f"""---
date: {date_dash}
topic: "{title}"
status: brief_ready
source_topic_file: "{relative_content_path(topic_file, content_root)}"
platforms: {json.dumps(platforms, ensure_ascii=False)}
risk_level: tbd
---

# Topic Brief：{title}

## 主题一句话

{title}

## 选择方式

- 模式：{selected.get("mode")}
- 候选序号：{selected.get("topic_index", "N/A")}

## 今日为什么值得写

{editor_note}

## 核心判断

{core_judgment}

## 目标读者

- AI 产品/工具用户
- AI 行业观察者
- 内容创作者和开发者

## 平台分发建议

{platform_note}

## 可用素材

{selected.get("matched_context", "")}

## 角度设计

### 常规写法

多数人可能会把这个题写成新闻转述、资料整理或观点复述。写作时不要停在这个层面。

### 避开角度

- 不要只复述“发生了什么”。
- 不要把多个素材平铺成清单。
- 不要只做行业意义总结。

### 推荐角度

围绕“{title}”找一个读者没立刻想到、但看完会觉得合理的切口。正式写作前由 `creative-writing` 基于本地素材库补强并确认。

### 读者新理解

读者看完后，应该获得一个新的判断框架，而不是只知道一条新消息。

### 开头场景

从一个具体场景、冲突、问题或反常识观察切入。避免用“最近，某某发布了...”这种资讯开头。

### 故事线

建议顺序：具体场景 → 问题浮出 → 关键反差 → 证据/案例 → 对读者的启发 → 收束结论。

## 预期证据清单

- 如果引用具体某人的观点，草稿中必须标注原帖或原始页面，供后续截图。
- 如果引用核心数据，草稿中必须标注数据来源，供后续截图。
- 如果引用社区观点，草稿中必须标注社区来源和不确定性。

## 可引用链接

{link_lines}

## 必须核查的事实

- 日期、公司名、产品名、模型名、数字和交易状态。
- 任何媒体报道中的“计划”“传闻”“据称”不能写成已确认事实。

## 不确定信息

{risk_note}

## 禁止夸大的点

- 不编造未公开金额、用户量、性能数据或内部动机。
- 不把单一社区体验写成行业结论。
- 不做投资建议。

## 小红书角度

交给 `creative-writing` 接管。写小红书草稿前必须读取 `creative-writing/references/xiaohongshu-methodology.md`，并遵循 `creative-writing` 的写作规则和目录流转。

## 公众号角度

交给 `creative-writing` 接管。写公众号草稿前必须读取 `creative-writing/references/wechat-methodology.md`，并遵循 `creative-writing` 的写作规则和目录流转。

## Twitter/X 角度

交给 `creative-writing` 接管。若当前缺少 Twitter/X 方法论，先按 `creative-writing` 的通用写作规则处理，并保留关键来源，不把未确认信息写成事实。
"""
    path.write_text(content, encoding="utf-8")


def write_platform_task(
    path: Path,
    date_dash: str,
    topic: str,
    platform: str,
    topic_file: Path,
    package_dir: Path,
    content_root: Path,
) -> None:
    platform_name = {
        "xiaohongshu": "小红书",
        "wechat": "微信公众号",
        "twitter": "Twitter/X",
    }[platform]
    methodology = {
        "xiaohongshu": "creative-writing/references/xiaohongshu-methodology.md",
        "wechat": "creative-writing/references/wechat-methodology.md",
        "twitter": "TODO: creative-writing/references/twitter-methodology.md",
    }[platform]
    content = f"""---
date: {date_dash}
topic: "{topic}"
platform: {platform}
status: task_ready
source_topic_file: "{relative_content_path(topic_file, content_root)}"
topic_brief: "{relative_content_path(package_dir / 'topic-brief.md', content_root)}"
asset_manifest: "{relative_content_path(package_dir / 'manifest.json', content_root)}"
risk_level: tbd
---

# {platform_name} 写作任务：{topic}

## 执行边界

这个文件由 `daily-writing-orchestrator` 初始化，正文必须由 `creative-writing` 接管生成。生成正式草稿时，保留 frontmatter，并把本任务说明替换为真正的 {platform_name} 内容。

## 输入

- 读取 `topic-brief.md`
- 读取原始 `ai_topic` 文件
- 写作前必须搜索全量本地素材库
- 写作前必须确认三步创作法：获取信息、找角度、创作节奏
- 使用 `topic-brief.md` 的“角度设计”区块；如果角度太普通，先重写角度再写正文
- 读取对应平台方法论：`{methodology}`
- 遵循 `creative-writing/SKILL.md` 的目录规则、平台流程和写作规则

## 输出要求

- 生成真正可编辑的 {platform_name} 草稿
- 遵循 `creative-writing` 的 "Kill the AI Tone"、自然表达、平台意识和来源复用规则
- 不要写成资料压缩或信息搬运；必须围绕一个明确角度展开
- 草稿要有节奏：场景、问题、反差、例子、收束
- 保留来源区
- 保留风险检查区
- 明确标注所有具体观点、帖子、数据引用的来源
- 插入图位，例如 `[图1：来源截图，证明 xxx]`
- 文件继续留在内容根 `creative/01-内容生产/文稿库/02-制作中/` 对应发布包内，直到用户明确说“发布了”

## 后续

草稿完成后，运行 asset-collector，根据引用和图位收集截图、图片和 manifest。
"""
    path.write_text(content, encoding="utf-8")


def write_review_placeholder(path: Path, topic: str) -> None:
    path.write_text(
        f"""# Publish Review：{topic}

状态：not_reviewed

## 检查项

- [ ] 草稿是否有来源支撑
- [ ] 是否只是信息搬运，没有明确角度
- [ ] 是否有具体开头场景和故事线
- [ ] 是否有节奏起伏，而不是平铺资料
- [ ] 图片/截图是否缺失
- [ ] 是否使用不可确认数据
- [ ] 是否有 AI 味句式
- [ ] 标题是否夸大
- [ ] 平台格式是否完整

## 结论

needs_manual_fact_check
""",
        encoding="utf-8",
    )


def write_manifest(
    path: Path,
    date_dash: str,
    topic_file: Path,
    package_dir: Path,
    selected: Dict[str, object],
    platforms: List[str],
    with_assets: bool,
    review: bool,
    content_root: Path,
) -> None:
    platform_states = {
        platform: "task_ready" if platform in platforms else "not_requested"
        for platform in ["xiaohongshu", "wechat", "twitter"]
    }
    manifest = {
        "date": date_dash,
        "topic": selected["title"],
        "source_topic_file": relative_content_path(topic_file, content_root),
        "package_dir": relative_content_path(package_dir, content_root),
        "selection": {
            "mode": selected.get("mode"),
            "topic_index": selected.get("topic_index"),
            "topic_keyword": selected.get("topic_keyword"),
        },
        "status": "tasks_ready",
        "platforms": platform_states,
        "assets": [],
        "missing_assets": [],
        "asset_collection": "pending_after_draft" if with_assets else "not_requested",
        "review": "placeholder_created" if review else "not_requested",
        "created_at": dt.datetime.now().isoformat(timespec="seconds"),
    }
    path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")


def main() -> None:
    parser = argparse.ArgumentParser(description="Create a daily social-media writing package.")
    parser.add_argument(
        "--date",
        default="",
        help="YYYYMMDD or YYYY-MM-DD. Default: today.",
    )
    parser.add_argument("--platform", choices=["xiaohongshu", "wechat", "twitter", "all"], default="all")
    parser.add_argument("--topic", default="auto", help='Default "auto" uses 今日最终推荐; otherwise match keyword.')
    parser.add_argument("--topic-index", type=int, default=0, help="1-based row from 今日候选热点池.")
    parser.add_argument("--topic-file", default="", help="Override ai_topic file path.")
    parser.add_argument("--output-root", default="", help="Override package output root.")
    parser.add_argument("--content-root", default="", help="Explicit content root; defaults to OPENMIND_ROOT.")
    parser.add_argument("--skill-data-dir", default="", help="Reserved app-private Skill data directory.")
    parser.add_argument("--run-dir", default="", help="Reserved app-private Run working directory.")
    parser.add_argument("--with-assets", action="store_true", help="Mark asset collection as pending after drafts.")
    parser.add_argument("--review", action="store_true", help="Create review.md placeholder.")
    args = parser.parse_args()
    topic_keyword = args.topic.strip()
    try:
        content_root = require_content_root(args.content_root)
        output_root = resolve_content_path(args.output_root, content_root, "--output-root") if args.output_root else content_root / OUTPUT_ROOT_RELATIVE
    except RuntimePathError as exc:
        parser.error(str(exc))

    date_provided = bool(args.date.strip())
    topic_file_provided = bool(args.topic_file.strip())
    if topic_file_provided:
        topic_file = Path(args.topic_file)
        topic_file = resolve_content_path(args.topic_file, content_root, "--topic-file")
        parsed = parse_topic_file_date(topic_file)
        if date_provided:
            date_compact, date_dash = normalize_date(args.date)
        elif parsed:
            date_compact, date_dash, _version = parsed
        else:
            date_compact, date_dash = normalize_date("")
    else:
        date_compact, date_dash = normalize_date(args.date)
        topic_file = content_root / TOPIC_DIR_RELATIVE / f"ai_topic_{date_dash}.md"
        if not topic_file.exists():
            topic_file = content_root / "daily-topic" / f"{date_compact}_daily_topic.md"

    if not topic_file.exists():
        raise FileNotFoundError(f"AI topic file not found: {topic_file}")

    content = topic_file.read_text(encoding="utf-8")
    selected = select_topic(content, topic_keyword, args.topic_index)

    platforms = platform_list(args.platform)
    package_dir = unique_package_dir(output_root, date_compact, str(selected["title"]))
    package_dir.mkdir(parents=True, exist_ok=False)
    for subdir in ["assets/sources", "assets/covers", "assets/cards"]:
        (package_dir / subdir).mkdir(parents=True, exist_ok=True)

    write_topic_brief(package_dir / "topic-brief.md", date_dash, topic_file, selected, platforms, content_root)

    task_paths = {
        "xiaohongshu": package_dir / "xiaohongshu-draft.md",
        "wechat": package_dir / "wechat-draft.md",
        "twitter": package_dir / "twitter-thread.md",
    }
    for platform in platforms:
        write_platform_task(task_paths[platform], date_dash, str(selected["title"]), platform, topic_file, package_dir, content_root)

    write_manifest(
        package_dir / "manifest.json",
        date_dash,
        topic_file,
        package_dir,
        selected,
        platforms,
        args.with_assets,
        args.review,
        content_root,
    )
    if args.review:
        write_review_placeholder(package_dir / "review.md", str(selected["title"]))

    print(f"Package: {package_dir}")
    print(f"Topic: {selected['title']}")
    print(f"Selection: {selected.get('mode')}")
    print(f"Platforms: {', '.join(platforms)}")


if __name__ == "__main__":
    main()
