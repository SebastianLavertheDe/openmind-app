"""
文本处理工具函数
"""

import re
from typing import List, Dict, Any


def clean_text(text: str) -> str:
    """清理文本内容，移除HTML标签"""
    if not text or text == "无内容":
        return ""

    # 移除HTML标签
    clean_text = re.sub(r'<[^>]+>', '', str(text))
    # 移除多余的空白字符
    clean_text = ' '.join(clean_text.split())

    return clean_text


def split_text_to_blocks(text: str, max_length: int = 1900) -> List[str]:
    """将长文本按指定长度分段"""
    if not text:
        return []

    # 如果文本长度在限制内，直接返回
    if len(text) <= max_length:
        return [text]

    # 按 max_length 字符分段
    segments = []
    for i in range(0, len(text), max_length):
        segment = text[i:i + max_length]
        segments.append(segment)

    return segments


def build_paragraph_blocks(text: str) -> List[Dict[str, Any]]:
    """将文本构建为多个段落块"""
    blocks = []
    segments = split_text_to_blocks(text)

    for segment in segments:
        if segment.strip():  # 只添加非空段落
            blocks.append({
                "object": "block",
                "type": "paragraph",
                "paragraph": {
                    "rich_text": [{
                        "type": "text",
                        "text": {"content": segment}
                    }]
                }
            })

    return blocks


def parse_published_time(published_str: str) -> str:
    """解析发布时间并格式化为 ISO 格式"""
    from datetime import datetime, timezone

    try:
        if not published_str or published_str == "无时间":
            return datetime.now(timezone.utc).isoformat()

        # 尝试解析常见的时间格式
        from email.utils import parsedate_to_datetime
        dt = parsedate_to_datetime(published_str)
        return dt.isoformat()
    except Exception as e:
        print(f"时间解析失败: {e}, 使用当前时间")
        return datetime.now(timezone.utc).isoformat()
