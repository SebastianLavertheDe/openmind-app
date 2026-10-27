"""
RSS Manager - Main processing workflow for multiple RSS feeds
"""

import importlib

import feedparser
import html
import os
import json
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from datetime import datetime
from urllib.parse import urlparse
from ..core.models import Article
from ..managers.opml_parser import RSSFeed
from ..managers.cache_manager import ArticleCacheManager
from ..managers.content_manager import ContentExtractor


def is_mostly_english(text: str, threshold: float = 0.3) -> bool:
    """
    Check if text is mostly English (for detecting failed translations)

    Args:
        text: Text to check
        threshold: Ratio of non-ASCII chars to consider text translated (default 0.3 = 30%)

    Returns:
        True if text is mostly English (needs translation), False if likely translated
    """
    if not text or len(text.strip()) < 10:
        return True  # Treat very short text as English

    # Count Chinese characters (CJK Unified Ideographs)
    chinese_chars = sum(1 for c in text if '\u4e00' <= c <= '\u9fff')

    # Count total characters (excluding whitespace)
    total_chars = sum(1 for c in text if not c.isspace())

    if total_chars == 0:
        return True

    chinese_ratio = chinese_chars / total_chars
    return chinese_ratio < threshold  # True if less than 30% Chinese chars


class RSSManager:
    """Multi-feed RSS manager"""

    def __init__(self, config, run_date: str = ""):
        self.config = config
        self.run_date = run_date.strip() or datetime.now().strftime('%Y%m%d')
        try:
            datetime.strptime(self.run_date, '%Y%m%d')
        except ValueError as exc:
            raise ValueError(f"Invalid run date '{self.run_date}'; expected YYYYMMDD") from exc
        self.cache_manager = ArticleCacheManager(config.get_cache_file())
        self.content_extractor = ContentExtractor(config.get_content_settings())

        # Setup article directory
        self.article_base_dir = Path(config.get_article_base_dir()).resolve()
        self.article_base_dir.mkdir(parents=True, exist_ok=True)
        self.counter_file = Path(config.get_counter_file())
        self.article_counter, self.current_date = self._load_counter_state()
        # 保护 article_counter/current_date：并发处理文章时串行化编号分配。
        self._counter_lock = threading.Lock()

        # Initialize AI client with fallback chain:
        # Claude(智谱) -> DeepSeek -> Doubao
        try:
            ai_config = config.get_ai_settings()
            if ai_config.get("enabled", True):
                self.ai_clients = []
                _chain = [
                    ("Claude(智谱)", "claude_client"),
                    ("DeepSeek", "deepseek_client"),
                    ("Doubao", "doubao_client"),
                ]
                for label, module_name in _chain:
                    try:
                        mod = importlib.import_module(f".{module_name}", package=__package__.rsplit(".", 1)[0] + ".ai")
                        # Find the client class (first class ending with 'Client')
                        for attr_name in dir(mod):
                            if attr_name.endswith("Client") and not attr_name.startswith("Shared"):
                                client_cls = getattr(mod, attr_name)
                                client = client_cls()
                                self.ai_clients.append((label, client))
                                print(f"AI client initialized ({label})")
                                break
                    except Exception as e:
                        print(f"AI client {label} init skipped: {e}")
                self.ai_client = self.ai_clients[0][1] if self.ai_clients else None
            else:
                self.ai_client = None
                self.ai_clients = []
        except Exception as e:
            print(f"AI client init failed: {e}")
            self.ai_client = None
            self.ai_clients = []

        # Initialize translator based on config
        try:
            translation_config = config.get_translation_settings()
            self.translation_enabled = translation_config.get("enabled", False)
            if self.translation_enabled:
                from ..ai.translation_client import FallbackTranslator

                # Fallback chain: Claude(智谱) -> DeepSeek -> Doubao
                self.translator = FallbackTranslator()
            else:
                self.translator = None
        except Exception as e:
            import traceback

            print(f"Translator init failed: {e}")
            traceback.print_exc()
            self.translator = None
            self.translation_enabled = False

    def _load_counter_state(self):
        """Load counter state from file for persistence across runs"""
        try:
            saved_counter = 0
            saved_date = None

            # Try to load from counter file first
            if self.counter_file.exists():
                import json
                with open(self.counter_file, 'r', encoding='utf-8') as f:
                    data = json.load(f)
                    saved_date = data.get('current_date')
                    today = self.run_date

                    # Reset counter if it's a new day
                    if saved_date != today:
                        print(f"New day detected, will check directory for existing files (saved: {saved_date}, today: {today})")
                        saved_counter = 0  # Reset, will check directory below
                        saved_date = None
                    else:
                        saved_counter = data.get('article_counter', 0)
                        print(f"Restored counter state: {saved_counter} (date: {saved_date})")
                        return saved_counter, saved_date

            # Check existing files in today's directory to find max counter
            today_str = self.run_date
            today_dir = self.article_base_dir / today_str

            if today_dir.exists():
                # Find the maximum file number in today's directory
                max_num = 0
                for file in today_dir.glob("*.md"):
                    # Extract number from filename (e.g., "123_title.md" -> 123)
                    try:
                        num_str = file.stem.split('_')[0]
                        if num_str.isdigit():
                            num = int(num_str)
                            max_num = max(max_num, num)
                    except:
                        pass

                if max_num > 0:
                    print(f"Found existing files in {today_str}/, max counter: {max_num}")
                    return max_num, today_str

            return saved_counter, saved_date
        except Exception as e:
            print(f"Failed to load counter state: {e}, starting from 0")
            return 0, None

    def _save_counter_state(self):
        """Save counter state to file for persistence across runs"""
        try:
            import json
            with open(self.counter_file, 'w', encoding='utf-8') as f:
                json.dump({
                    'article_counter': self.article_counter,
                    'current_date': self.current_date
                }, f)
        except Exception as e:
            print(f"Warning: Failed to save counter state: {e}")

    def fetch_feed(self, feed: RSSFeed):
        """Fetch a single RSS feed"""
        import requests
        import tempfile
        from ..managers.opml_parser import OPMLParser

        try:
            resolved_source, is_local_file = self._resolve_feed_source(feed)

            if is_local_file:
                print(f"  Reading local feed source: {resolved_source}")
                with open(resolved_source, "r", encoding="utf-8") as file:
                    content = file.read()

                if "<opml" in content.lower():
                    print(f"  Detected local OPML file, parsing nested feeds...")
                    nested_feeds = OPMLParser(resolved_source).parse()

                    if nested_feeds:
                        print(f"  Found {len(nested_feeds)} nested RSS feeds in OPML")
                        return {
                            "type": "opml",
                            "feeds": nested_feeds,
                            "parent_title": feed.title,
                            "parent_category": feed.category,
                        }

                return feedparser.parse(resolved_source)

            # First, fetch the URL content to check if it's an OPML file
            print(f"  Fetching URL to check content type...")
            response = requests.get(resolved_source, timeout=10)
            response.raise_for_status()
            content = response.text

            # Check if the content is OPML format (contains <opml> tag)
            if "<opml" in content.lower():
                print(f"  Detected OPML file, parsing nested feeds...")
                # Save content to a temporary file
                with tempfile.NamedTemporaryFile(
                    mode="w", suffix=".opml", delete=False
                ) as tmp_file:
                    tmp_file.write(content)
                    tmp_file_path = tmp_file.name

                try:
                    # Parse the OPML file
                    opml_parser = OPMLParser(tmp_file_path)
                    nested_feeds = opml_parser.parse()

                    if nested_feeds:
                        print(f"  Found {len(nested_feeds)} nested RSS feeds in OPML")
                        # Return special structure to indicate OPML type
                        return {
                            "type": "opml",
                            "feeds": nested_feeds,
                            "parent_title": feed.title,
                            "parent_category": feed.category,
                        }
                    else:
                        print(
                            f"  Warning: OPML file contains no RSS feeds, falling back to RSS parser"
                        )
                finally:
                    # Clean up temporary file
                    try:
                        import os

                        os.unlink(tmp_file_path)
                    except:
                        pass

            # If not OPML, parse the response we already fetched above. Parsing the
            # URL directly would make feedparser perform a second request without
            # our requests timeout, which can hang on slow feeds.
            parsed = feedparser.parse(content)

            if parsed.bozo:
                print(f"  Feed parse warning: {parsed.bozo_exception}")

            return parsed

        except requests.RequestException as e:
            print(f"  Warning: Could not check if URL is OPML: {e}")
            # Fall through to feedparser
            try:
                resolved_source, _ = self._resolve_feed_source(feed)
                parsed = feedparser.parse(resolved_source)
                if parsed.bozo:
                    print(f"  Feed parse warning: {parsed.bozo_exception}")
                return parsed
            except Exception as e2:
                print(f"  Failed to fetch feed after fallback: {e2}")
                return None

        except Exception as e:
            print(f"  Failed to fetch feed: {e}")
            import traceback

            traceback.print_exc()
            return None

    def _resolve_feed_source(self, feed: RSSFeed):
        """Resolve feed URL or local path to a fetchable source."""
        source = feed.url

        if source.startswith(("http://", "https://")):
            if "github.com" in source and "/blob/" in source:
                source = source.replace(
                    "github.com", "raw.githubusercontent.com"
                ).replace("/blob/", "/")
                print(f"  Converted GitHub blob URL to raw URL")
            return source, False

        if source.startswith("file://"):
            source = source[7:]

        path = Path(source).expanduser()
        if not path.is_absolute():
            source_opml = getattr(feed, "source_opml", "")
            if source_opml and not source_opml.startswith(("http://", "https://")):
                path = (Path(source_opml).resolve().parent / path).resolve()
            else:
                path = path.resolve()

        return str(path), True

    def get_feed_identity(self, feed: RSSFeed) -> str:
        """Return a normalized identifier for feed-level deduplication."""
        resolved_source, _ = self._resolve_feed_source(feed)
        return resolved_source

    def process_feed(
        self, parsed_feed, feed_info: RSSFeed, parent_category: str = None
    ) -> None:
        """Process feed entries"""
        max_articles = self.config.get_max_articles_per_feed()
        max_age_days = self.config.get_max_article_age_days()

        # First, filter out cached articles, then limit
        new_articles = []

        for entry in parsed_feed.entries:
            # Stop if we've reached the max limit
            if len(new_articles) >= max_articles:
                break

            link = entry.get("link", "")

            if self.cache_manager.is_article_cached(link):
                continue

            # Filter by article age if configured
            if max_age_days > 0:
                published = entry.get("published", "")
                if not self._is_article_within_days(published, max_age_days):
                    # Article is too old, or has no parseable date (treated as
                    # out-of-window), skip this entry but continue checking others
                    continue

            article = self._create_article_from_entry(entry, feed_info, parent_category)
            new_articles.append(article)

        print(f"  New articles: {len(new_articles)}")

        # 并发处理文章（extract/translate 是网络 IO，线程并发收益大）。
        # 缓存去重(try_add)与编号分配(_save_article)各自在 Lock 下串行化。
        worker_count = max(1, min(8, len(new_articles))) if new_articles else 1
        with ThreadPoolExecutor(max_workers=worker_count) as executor:
            futures = [executor.submit(self._process_article, article) for article in new_articles]
            for future in as_completed(futures):
                future.result()

        # 批末尾落盘：缓存一次 + counter 一次（替代曾经的每篇 fsync/每篇写 counter）
        self.cache_manager.save()
        self._save_counter_state()

    def _create_article_from_entry(
        self, entry, feed_info: RSSFeed, parent_category: str = None
    ) -> Article:
        """Create Article from RSS entry"""
        category = parent_category if parent_category else feed_info.category

        # Extract content from RSS entry (content or description field)
        # This is especially useful for Reddit feeds which include full post content
        rss_content = entry.get("content", {})
        if isinstance(rss_content, list) and len(rss_content) > 0:
            rss_content = rss_content[0].get("value", "")
        elif not isinstance(rss_content, str):
            rss_content = ""

        # Fallback to description if no content
        if not rss_content:
            rss_content = entry.get("description", "")

        # For Reddit posts, the description contains HTML content
        # Use it as full_content if available
        full_content_from_rss = rss_content if rss_content and len(rss_content) > 100 else None

        return Article(
            title=html.unescape(entry.get("title", "No Title")),
            link=entry.get("link", ""),
            author=entry.get("author", feed_info.title),
            published=entry.get("published", ""),
            summary=entry.get("summary", entry.get("description", "")),
            full_content=full_content_from_rss,  # Use RSS content if available
            feed_type=feed_info.type,
            feed_category=category,
            feed_name=feed_info.title,  # Store RSS feed name
            feed_url=feed_info.url,  # Store RSS feed URL
        )

    def _process_article(self, article: Article) -> None:
        """Process single article: extract content, translate, save to local"""
        print(f"\n  Processing: {article.title[:50]}...")

        extracted = {}
        if self._should_use_rss_content_directly(article):
            print("    Using full content from WeChat RSS feed")
        else:
            # Extract full content from page when RSS body is unavailable or incomplete
            print("    Extracting content from page...")
            extracted = self.content_extractor.extract_content(article.link)

        # Use extracted content, or fall back to RSS content
        if extracted.get("validation_blocked"):
            print("    WeChat article requires validation, skipping save for now")
            return
        if extracted.get("content"):
            article.full_content = extracted["content"]
        elif article.full_content:
            print("    Warning: Page extraction failed, using RSS content (may contain HTML)")

        # Extract images
        if extracted.get("images"):
            article.image_urls = extracted["images"]
        if extracted.get("author"):
            article.author = extracted["author"]

        # For Reddit posts, try to extract comments
        if "reddit.com" in article.link:
            print("    Extracting Reddit comments...")
            article.comments = self._extract_reddit_comments(article.link)

        # Translate content to Chinese if enabled
        if self.translation_enabled and self.translator and article.full_content:
            print("    Translating to Chinese...")
            try:
                # Translate title
                if hasattr(self.translator, 'translate_title'):
                    translated_title = self.translator.translate_title(article.title)
                    if translated_title:
                        article.translated_title = translated_title
                        print(f"    Title translated: {translated_title}")

                # Translate content with retry and detection
                translation_success = False
                max_attempts = 2

                for attempt in range(max_attempts):
                    translated_content = self.translator.translate_to_chinese(
                        article.full_content,
                        max_retries=3
                    )

                    if translated_content:
                        # Check if translation actually worked (content is no longer mostly English)
                        if not is_mostly_english(translated_content):
                            article.full_content = translated_content
                            print("    Content translation completed")
                            translation_success = True
                            break
                        else:
                            print(f"    Warning: Translation result still mostly English (attempt {attempt + 1}/{max_attempts})")
                            if attempt < max_attempts - 1:
                                print("    Waiting 3 seconds before retry...")
                                time.sleep(3)
                    else:
                        print(f"    Warning: Translation returned None (attempt {attempt + 1}/{max_attempts})")
                        if attempt < max_attempts - 1:
                            print("    Waiting 3 seconds before retry...")
                            time.sleep(3)

                if not translation_success:
                    print("    Warning: Translation failed after all attempts, using original content")

                # Add delay between articles to avoid rate limits
                time.sleep(2)

            except Exception as e:
                print(f"    Warning: Translation error: {e}, using original content")

        # Deduplicate and save
        if not self.cache_manager.try_add_article_to_cache(article):
            print("    Duplicate detected from cache, skipping article save")
            return

        # Save article to file
        self._save_article(article)

    def _should_use_rss_content_directly(self, article: Article) -> bool:
        """Prefer RSS body for WeChat articles when the feed already contains full text."""
        if not article.full_content or len(article.full_content.strip()) < 500:
            return False

        link_host = urlparse(article.link).netloc.lower()
        feed_host = urlparse(article.feed_url).netloc.lower()

        if link_host != "mp.weixin.qq.com":
            return False

        if feed_host != "wechat2rss.bestblogs.dev":
            return False

        return True

    def _save_article(self, article: Article) -> None:
        """Save article to article/ below the content root, organized by week as Markdown"""
        try:
            # Get current date
            now = datetime.now()
            current_date_str = self.run_date

            # 分配唯一编号（并发处理文章时串行化）
            with self._counter_lock:
                if self.current_date != current_date_str:
                    self.current_date = current_date_str
                    self.article_counter = 0
                self.article_counter += 1
                article_index = self.article_counter

            # Use translated title for filename if available, otherwise use original title
            title_for_filename = (article.translated_title or article.title)[:100]

            # Create safe filename (keep Chinese characters)
            safe_title = title_for_filename.replace("/", "-").replace("\\", "-")
            safe_title = safe_title.replace(":", "").replace("?", "").replace("*", "")
            safe_title = (
                safe_title.replace('"', "")
                .replace("<", "")
                .replace(">", "")
                .replace("|", "")
            )
            # Only replace special characters, keep alphanumeric and Chinese
            safe_title = "".join(
                c
                if c.isalnum() or c > "\u4e00" and c < "\u9fff" or c in (" ", "-", "_")
                else "_"
                for c in safe_title
            )

            # Use title as filename with number prefix
            filename = f"{article_index}_{safe_title}.md"

            # Get date directory (format: YYYYMMDD)
            # Determine base directory based on feed type
            date_dir_name = self.run_date

            # Save to different directories based on feed category
            if article.feed_category == "post":
                save_base_dir = self.article_base_dir.parent / "post"
            else:
                save_base_dir = self.article_base_dir

            save_base_dir.mkdir(parents=True, exist_ok=True)
            date_dir = save_base_dir / date_dir_name
            date_dir.mkdir(exist_ok=True)

            filepath = date_dir / filename

            # Build Markdown content
            md_content = []

            # Title - use translated title if available
            title_to_use = article.translated_title if article.translated_title else article.title
            md_content.append(f"# {title_to_use}\n")

            # Metadata
            md_content.append("## 元数据\n")
            md_content.append(f"- **链接**: {article.link}")
            md_content.append(f"- **作者**: {article.author}")
            if article.feed_url:
                md_content.append(f"- **来源**: {article.feed_url}")

            # Format published time to Shanghai timezone (UTC+8)
            formatted_published = self._format_published_time(article.published)
            md_content.append(f"- **发布时间**: {formatted_published}")
            md_content.append(
                f"- **保存时间**: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}\n"
            )

            # Original Content (images are embedded in content)
            md_content.append("## 正文\n")
            # Clean and decode content
            content_to_save = article.full_content or ""
            if content_to_save:
                try:
                    import html
                    from bs4 import BeautifulSoup

                    # Decode HTML entities first
                    content_to_save = html.unescape(content_to_save)

                    # Check if content contains HTML tags
                    if "<" in content_to_save and ">" in content_to_save:
                        # Use BeautifulSoup to remove HTML tags but keep text
                        soup = BeautifulSoup(content_to_save, 'html.parser')

                        # Convert to markdown-like format
                        # Convert headings
                        for tag in soup.find_all(['h1', 'h2', 'h3', 'h4', 'h5', 'h6']):
                            level = int(tag.name[1])
                            prefix = "#" * level
                            tag.replace_with(f"\n\n{prefix} {tag.get_text()}\n\n")

                        # Convert paragraphs
                        for tag in soup.find_all('p'):
                            text = tag.get_text()
                            if text.strip():
                                tag.replace_with(f"\n{text}\n")

                        # Convert images
                        for tag in soup.find_all('img'):
                            src = tag.get('src', '')
                            alt = tag.get('alt', '')
                            if src:
                                tag.replace_with(f"\n\n![{alt}]({src})\n\n")
                            else:
                                tag.decompose()

                        # Remove all other tags but keep text
                        for tag in soup.find_all(['div', 'span', 'section', 'article']):
                            tag.unwrap()

                        # Get final text
                        content_to_save = soup.get_text(separator='\n', strip=True)

                        # Clean up excessive newlines
                        import re
                        content_to_save = re.sub(r'\n{3,}', '\n\n', content_to_save)
                except Exception as e:
                    print(f"    Warning: Failed to clean HTML: {e}")
            md_content.append(f"{content_to_save}\n")

            # Comments section (if available)
            if article.comments:
                md_content.append("\n## 评论\n")
                md_content.append(f"{article.comments}\n")

            # Save to file
            with open(filepath, "w", encoding="utf-8") as f:
                f.write("\n".join(md_content))

            print(f"    Saved to: {filepath}")
        except Exception as e:
            print(f"    Warning: Failed to save article: {e}")

    def _is_article_within_days(self, published_str: str, days: int) -> bool:
        """Check if article was published within the specified number of days"""
        try:
            from datetime import datetime, timezone, timedelta

            # Try to parse common RSS date formats
            formats = [
                "%a, %d %b %Y %H:%M:%S %z",  # RFC 2822 with timezone
                "%a, %d %b %Y %H:%M:%S %Z",  # RFC 2822 with UTC
                "%a, %d %b %Y %H:%M:%S",     # RFC 2822 without timezone
                "%Y-%m-%dT%H:%M:%S%z",       # ISO 8601
                "%Y-%m-%dT%H:%M:%SZ",        # ISO 8601 UTC
                "%Y-%m-%d %H:%M:%S",         # Simple format
            ]

            parsed_time = None
            for fmt in formats:
                try:
                    parsed_time = datetime.strptime(published_str, fmt)
                    break
                except ValueError:
                    continue

            if parsed_time is None:
                # Missing/unparseable date: treat as out-of-window and skip
                return False

            # Convert to UTC if timezone info available
            if parsed_time.tzinfo is not None:
                parsed_time = parsed_time.astimezone(timezone.utc).replace(tzinfo=None)
            else:
                # Assume no timezone means UTC
                pass

            # Get current UTC time
            now_utc = datetime.now(timezone.utc).replace(tzinfo=None)

            # Check if article is within the specified days
            age_delta = now_utc - parsed_time
            return age_delta <= timedelta(days=days)

        except Exception:
            # Missing/unparseable date: treat as out-of-window and skip
            return False

    def _format_published_time(self, published_str: str) -> str:
        """Format published time to Shanghai timezone (UTC+8)"""
        try:
            from datetime import datetime, timezone, timedelta

            # Try to parse common RSS date formats
            # Format: "Wed, 28 Jan 2026 13:55:00 +0000"
            formats = [
                "%a, %d %b %Y %H:%M:%S %z",  # RFC 2822 with timezone
                "%a, %d %b %Y %H:%M:%S %Z",  # RFC 2822 with UTC
                "%a, %d %b %Y %H:%M:%S",     # RFC 2822 without timezone
                "%Y-%m-%dT%H:%M:%S%z",       # ISO 8601
                "%Y-%m-%dT%H:%M:%SZ",        # ISO 8601 UTC
                "%Y-%m-%d %H:%M:%S",         # Simple format
            ]

            parsed_time = None
            for fmt in formats:
                try:
                    parsed_time = datetime.strptime(published_str, fmt)
                    break
                except ValueError:
                    continue

            if parsed_time is None:
                # If parsing fails, return original string
                return published_str

            # Convert to Shanghai timezone (UTC+8)
            shanghai_tz = timezone(timedelta(hours=8))

            # If parsed time has timezone info, convert it
            if parsed_time.tzinfo is not None:
                parsed_time = parsed_time.astimezone(shanghai_tz)
            else:
                # If no timezone, assume UTC
                parsed_time = parsed_time.replace(tzinfo=timezone.utc).astimezone(
                    shanghai_tz
                )

            # Format as "2026-01-29 08:18:47"
            return parsed_time.strftime("%Y-%m-%d %H:%M:%S")

        except Exception:
            # If conversion fails, return original string
            return published_str

    def _extract_reddit_comments(self, reddit_url: str) -> str:
        """Extract comments from Reddit post using JSON API"""
        try:
            import requests

            # Convert to old.reddit.com for better compatibility
            old_url = reddit_url.replace("www.reddit.com", "old.reddit.com")
            json_url = old_url if old_url.endswith(".json") else f"{old_url}.json"

            headers = {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
            }

            response = requests.get(json_url, timeout=30, headers=headers)
            response.raise_for_status()

            data = response.json()

            # Reddit JSON returns a list: [post_data, comments_data]
            if not isinstance(data, list) or len(data) < 2:
                return ""

            comments_data = data[1]
            comments = []

            # Extract comments from the JSON structure
            def extract_comment_text(comment_data):
                """Recursively extract comment text"""
                if not isinstance(comment_data, dict):
                    return None

                # Get the comment data
                comment = comment_data.get("data", {})

                # Extract the comment body
                body = comment.get("body", "")
                if body and body != "[deleted]" and body != "[removed]":
                    # Get author if available
                    author = comment.get("author", "Unknown")
                    # Get score if available
                    score = comment.get("score", 0)
                    return f"{body} (by {author}, +{score})"

                # Check for replies
                children = comment_data.get("replies", {})
                if isinstance(children, dict) and "data" in children:
                    children_data = children["data"].get("children", [])
                    for child in children_data[:3]:  # Limit to top 3 replies per comment
                        text = extract_comment_text(child)
                        if text:
                            comments.append(text)

                return None

            # Process top-level comments
            if "data" in comments_data:
                children = comments_data["data"].get("children", [])
                for child in children[:20]:  # Limit to top 20 comments
                    text = extract_comment_text(child)
                    if text:
                        comments.append(text)

            if comments:
                return "\n\n".join([f"- {c}" for c in comments])
            else:
                return ""

        except Exception:
            # Silently fail - Reddit blocks most requests
            return ""

    def _analyze_article(self, article: Article) -> None:
        """Analyze article with AI, trying fallback providers on failure"""
        content_for_ai = article.full_content or article.summary

        for label, client in self.ai_clients:
            try:
                ai_result = client.analyze_content(
                    title=article.title, content=content_for_ai
                )
                if ai_result:
                    article.translated_title = ai_result.get("translated_title")
                    article.ai_summary = ai_result.get("summary")
                    article.ai_score = ai_result.get("score")
                    article.ai_category = ai_result.get("category")
                    article.ai_tags = ai_result.get("categories", [ai_result.get("category")])
                    if label != self.ai_clients[0][0]:
                        print(f"    AI analysis used fallback: {label}")
                    return
            except Exception as e:
                print(f"    AI analysis failed for {label}: {e}")
                continue

        print("    Warning: All AI providers failed for analysis")
