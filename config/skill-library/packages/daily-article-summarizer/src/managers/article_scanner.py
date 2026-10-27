"""Article scanner for finding today's articles in the content root"""

import os
import re
from datetime import datetime
from pathlib import Path
from typing import Iterable, List, Optional, Union
from ..core.models import ArticleMetadata


class ArticleScanner:
    """Scans the content root for articles"""

    def __init__(self, article_directory: Union[str, Iterable[str]]):
        self.article_directory = self._normalize_paths(article_directory)

    def _normalize_paths(self, article_directory: Union[str, Iterable[str]]) -> List[str]:
        if isinstance(article_directory, str):
            paths = [article_directory]
        else:
            paths = list(article_directory)

        return [os.path.expanduser(p) for p in paths]

    def get_todays_articles(self) -> List[ArticleMetadata]:
        """Get all articles for today"""
        today = datetime.now().strftime("%Y%m%d")
        return self.get_articles_by_date(today)

    def get_articles_by_date(self, date: str) -> List[ArticleMetadata]:
        """Get all articles for a specific date (YYYYMMDD format)"""
        articles: List[ArticleMetadata] = []
        searched_dirs: List[str] = []

        for base_dir in self.article_directory:
            date_dir = os.path.join(base_dir, date)
            searched_dirs.append(date_dir)

            if not os.path.exists(date_dir):
                continue

            for filename in os.listdir(date_dir):
                if filename.endswith(".md"):
                    file_path = os.path.join(date_dir, filename)
                    metadata = self.parse_article_metadata(file_path, filename)
                    if metadata:
                        articles.append(metadata)

        if not articles:
            dirs_display = ", ".join(searched_dirs)
            print(f"  No articles found for date {date} (directories: {dirs_display})")

        return articles

    def get_reddit_posts_by_date(self, date: str) -> List[ArticleMetadata]:
        """Parse daily subreddit markdown files into individual Reddit post metadata."""
        posts: List[ArticleMetadata] = []
        searched_dirs: List[str] = []

        for base_dir in self.article_directory:
            date_dir = os.path.join(base_dir, date)
            searched_dirs.append(date_dir)

            if not os.path.exists(date_dir):
                continue

            for filename in os.listdir(date_dir):
                if not filename.endswith(".md"):
                    continue
                file_path = os.path.join(date_dir, filename)
                posts.extend(self.parse_reddit_posts(file_path, filename))

        if not posts:
            dirs_display = ", ".join(searched_dirs)
            print(f"  No reddit posts found for date {date} (directories: {dirs_display})")

        return posts

    def parse_article_metadata(
        self, file_path: str, filename: str
    ) -> Optional[ArticleMetadata]:
        """Parse metadata from article markdown file"""
        try:
            with open(file_path, "r", encoding="utf-8") as f:
                content = f.read()

            # Extract title (first line, usually # Title)
            title_match = re.search(r"^#\s+(.+)$", content, re.MULTILINE)
            title = title_match.group(1).strip() if title_match else filename

            # Extract metadata section
            link = ""
            author = ""
            published_date = None
            saved_time = None

            # Parse metadata section
            in_metadata = False
            for line in content.split("\n"):
                line = line.strip()

                if line == "## 元数据":
                    in_metadata = True
                    continue

                if in_metadata:
                    if line.startswith("##"):
                        # End of metadata section
                        break

                    if "**链接**:" in line or "Link:" in line:
                        link = re.sub(r".*?\*?\*?链接\*?\*?:\s*", "", line).strip()
                    elif "**作者**:" in line or "Author:" in line:
                        author = (
                            re.sub(r".*?\*?\*?作者\*?\*?:\s*", "", line).strip()
                        )
                    elif "**发布时间**:" in line or "Published:" in line:
                        published_date = re.sub(
                            r".*?\*?\*?发布时间\*?\*?:\s*", "", line
                        ).strip()
                    elif "**保存时间**:" in line or "Saved:" in line:
                        saved_time = re.sub(
                            r".*?\*?\*?保存时间\*?\*?:\s*", "", line
                        ).strip()

            return ArticleMetadata(
                title=title,
                cache_key=filename,
                file_path=file_path,
                filename=filename,
                link=link,
                author=author,
                published_date=published_date,
                saved_time=saved_time,
                content=content[:8000],  # 摘要只取前 8000 字符（见 shared_summarizer），扫描时即截断省内存
            )

        except Exception as e:
            print(f"  Warning: Failed to parse {file_path}: {e}")
            return None

    def parse_reddit_posts(self, file_path: str, filename: str) -> List[ArticleMetadata]:
        """Parse one subreddit markdown file into per-post records."""
        try:
            with open(file_path, "r", encoding="utf-8") as f:
                content = f.read()
        except Exception as e:
            print(f"  Warning: Failed to read reddit file {file_path}: {e}")
            return []

        if not content.startswith("# r/"):
            return []

        subreddit_match = re.match(r"^#\s+r/([^\s]+)", content)
        subreddit = subreddit_match.group(1).strip() if subreddit_match else Path(filename).stem

        sections = re.split(r"\n---\n+", content)
        posts: List[ArticleMetadata] = []

        for section in sections:
            title_match = re.search(r"^##\s+\d+\.\s+(.+)$", section, re.MULTILINE)
            if not title_match:
                continue

            title = title_match.group(1).strip()
            author = self._extract_metadata_value(section, "作者")
            published_date = self._extract_metadata_value(section, "发布时间")
            reddit_link = self._extract_metadata_value(section, "Reddit 链接")
            post_id = self._extract_reddit_post_id(reddit_link) or self._slugify_title(title)
            post_content = self._extract_reddit_body(section)
            cache_key = f"reddit_{subreddit}_{post_id}"
            synthetic_filename = f"{cache_key}.md"

            posts.append(
                ArticleMetadata(
                    title=f"[r/{subreddit}] {title}",
                    cache_key=cache_key,
                    file_path=file_path,
                    filename=synthetic_filename,
                    link=reddit_link,
                    author=author,
                    published_date=published_date,
                    saved_time=None,
                    content=post_content,
                )
            )

        return posts

    def _extract_metadata_value(self, section: str, label: str) -> str:
        pattern = rf"-\s+\*\*{re.escape(label)}\*\*:\s*(.+)"
        match = re.search(pattern, section)
        return match.group(1).strip() if match else ""

    def _extract_reddit_post_id(self, reddit_link: str) -> str:
        match = re.search(r"/comments/([a-z0-9]+)/", reddit_link or "")
        return match.group(1) if match else ""

    def _slugify_title(self, title: str) -> str:
        normalized = re.sub(r"[^\w\u4e00-\u9fff]+", "_", title).strip("_")
        return normalized[:48] or "reddit_post"

    def _extract_reddit_body(self, section: str) -> str:
        body_match = re.search(
            r"###\s+正文\s*\n+([\s\S]*?)(?:\n###\s+图片|\n###\s+评论|\Z)",
            section,
        )
        if not body_match:
            return ""
        return body_match.group(1).strip()
