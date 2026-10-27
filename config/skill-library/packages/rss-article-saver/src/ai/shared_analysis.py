"""RSS article analysis adapter backed by the package-local AI client."""

from __future__ import annotations

import json
import time
from typing import Dict, Optional, Tuple

from ..ai_client import call_provider_text, extract_json_text, resolve_provider


class SharedAnalysisClient:
    provider_name = ""
    display_name = ""

    def __init__(self):
        self.provider = resolve_provider()
        self.model = self.provider.model
        self.base_url = self.provider.base_url

    def _make_request(self, prompt: str, max_tokens: int = 1000, max_retries: int = 3) -> Optional[str]:
        try:
            return call_provider_text(
                self.provider,
                prompt,
                temperature=0.3,
                max_tokens=max_tokens,
                timeout=120,
                retries=max_retries,
                response_format_json=True,
            )
        except Exception as e:
            print(f"{self.display_name} API 请求失败: {e}")
            return None

    def summarize_text(self, text: str, max_length: int = 200) -> Optional[str]:
        if not text or len(text.strip()) < 10:
            return "内容过短，无需分析"
        prompt = build_analysis_prompt(text)
        return self._make_request(prompt, max_tokens=4000)

    def classify_text(self, text: str) -> Optional[Tuple[str, float]]:
        categories = [
            "System Design", "Distributed Systems", "Database", "Network",
            "Architecture", "Algorithms", "Backend", "Frontend",
            "DevOps", "Machine Learning", "AI", "Golang", "Other",
        ]
        prompt = f"""你是一个专业的文本分类专家。请对用户提供的文本进行分类。

可选分类：{', '.join(categories)}

要求：
1. 从上述分类中选择最合适的一个
2. 返回JSON格式：{{"category": "分类名称", "confidence": 置信度(0-1的小数)}}
3. 置信度表示分类的确信程度
4. 如果不确定，选择"Other"类别

请对以下内容进行分类：

{text}"""
        result = self._make_request(prompt, max_tokens=200)
        if not result:
            return None
        try:
            parsed = json.loads(extract_json_text(result))
            category = parsed.get("category", "Other")
            confidence = float(parsed.get("confidence", 0.5))
            if category not in categories:
                return "Other", 0.3
            return category, confidence
        except (json.JSONDecodeError, ValueError, TypeError):
            for category in categories:
                if category in result:
                    return category, 0.6
            return "Other", 0.3

    def analyze_content(self, title: str, content: str) -> Dict:
        if not content or len(content.strip()) < 10:
            return {
                "summary": "内容过短，无需分析",
                "score": 0,
                "ai_processed": False,
                "timestamp": time.time(),
            }

        full_text = f"{title}\n\n{content}" if title else content
        ai_response = self.summarize_text(full_text)
        classification = self.classify_text(full_text)

        summary_text = None
        score = None
        translated_title = None
        if ai_response:
            try:
                parsed = json.loads(extract_json_text(ai_response))
                summary_text = parsed.get("summary", "")
                score = parsed.get("score")
            except json.JSONDecodeError:
                summary_text = ai_response

        if summary_text:
            for line in summary_text.split("\n"):
                line = line.strip()
                if line.startswith("# "):
                    translated_title = line[1:].strip()
                    break
                if line.startswith("## "):
                    break

        if translated_title:
            translated_title = translated_title.strip("*").strip()

        result = {
            "translated_title": translated_title,
            "summary": summary_text or "总结生成失败",
            "score": score if score is not None else 50,
            "category": "Other",
            "confidence": 0.0,
            "ai_processed": True,
            "timestamp": time.time(),
        }
        if classification:
            result["category"] = classification[0]
            result["confidence"] = classification[1]
        return result


def build_analysis_prompt(text: str) -> str:
    return f"""你是一名严谨的技术/行业内容编辑 + 选题评审员（面向程序员内容与 AI/Agent 方向）。请对我提供的单篇文章全文进行总结与评分，并且只输出一个合法 JSON，只包含两个字段：summary 与 score。

## 我的目标读者
- Go 工程师、后端工程师、想入门/跟进 AI 与 AI Agent 的程序员
- AI 技术爱好者：关注 LLM 应用、RAG、Agent 工作流、评测与工程化落地
- Prompt 玩法人群：喜欢提示词技巧、工作流提示词、结构化输出、提示词模板与可复用套路

## 总规则
- 只基于原文输出，不要加入外部背景或推测。
- 不要杜撰数据、机构、时间、人物、引用。
- 输出必须是严格 JSON，不要用 Markdown 代码块包裹。
- score 必须是 0-100 的数字。

## summary 字段要求
summary 的值是 Markdown 字符串，按下面结构输出：

# [中文翻译的标题]

## 核心结论
1句说明文章讨论什么和作者核心结论。

## 400-500字摘要
覆盖背景/问题、核心论点、技术细节、证据、结论或实践建议。

## 要点（3-5条）
* 优先包含时间、人物/机构、因果链、数据/对比、关键定义。

## 证据与数据
* 把原文出现的数字、研究、案例或引用逐条列出；若没有，写无明确数据。

## 文章的意义/价值
说明它对目标读者有什么启发或可行动建议；必须能从文中推导。

## 评分依据
* 信息密度（0-20）
* 证据质量（0-20）
* 逻辑与结构（0-15）
* 新颖性/洞察（0-15）
* 实用性/可行动性（0-20）
* 表达清晰度（0-10）
* 判定：保留/可选/淘汰，并给出理由。

## JSON 输出要求
必须返回形如：{{"summary":"...markdown...","score":82}}
summary 内部换行必须用 \\n 表示，确保 JSON 合法。

请分析以下文章：

{text[:20000]}"""
