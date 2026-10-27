"""
Content Manager - Full content extraction using trafilatura
"""

import time
import trafilatura
import requests
import re
import os
import json
import html as html_lib
from typing import Optional, Dict, List, Tuple
from urllib.parse import urljoin, urlparse, parse_qs, unquote
from bs4 import BeautifulSoup
from bs4.element import Tag


class ContentExtractor:
    """Extract full content from article URLs"""

    def __init__(self, config: dict):
        self.extractor = config.get("extractor", "trafilatura")
        self.include_images = config.get("include_images", True)
        self.max_length = config.get("max_content_length", 50000)
        wechat_config = config.get("wechat", {})
        self.wechat_playwright_enabled = wechat_config.get("enabled", True)
        self.wechat_timeout_ms = wechat_config.get("timeout_ms", 30000)
        self.wechat_min_interval_seconds = wechat_config.get(
            "min_interval_seconds", 8
        )
        self.wechat_user_data_dir = os.path.expanduser(
            wechat_config.get("user_data_dir", "")
        )
        self.wechat_storage_state_path = os.path.expanduser(
            wechat_config.get("storage_state_path", "")
        )
        self.wechat_extra_http_headers = wechat_config.get(
            "extra_http_headers", {}
        )
        self._last_wechat_fetch_at = 0.0

    def extract_content(self, url: str) -> Dict:
        """
        Extract full content from article URL

        Returns:
            dict with 'content', 'images', 'author'
        """
        result = {
            "content": None,
            "images": [],
            "author": None,
            "validation_blocked": False,
        }

        try:
            if self._is_wechat_article(url) and self.wechat_playwright_enabled:
                playwright_result = self._extract_wechat_with_playwright(url)
                if playwright_result.get("content") or playwright_result.get(
                    "validation_blocked"
                ):
                    return playwright_result

            # Download the page
            downloaded = trafilatura.fetch_url(url)
            if not downloaded:
                # Fallback to requests
                response = requests.get(
                    url,
                    timeout=30,
                    headers={
                        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
                    },
                )
                downloaded = response.text

            # Obsidian Publish pages load content via a markdown endpoint
            obsidian_payload = self._extract_obsidian_publish_markdown(downloaded)
            if obsidian_payload:
                content, base_url = obsidian_payload
                if content:
                    if len(content) > self.max_length:
                        content = content[: self.max_length] + "\n\n...(内容过长已截断)"
                    result["content"] = content
                    result["images"] = self._extract_images_from_markdown(
                        content, base_url
                    )
                    metadata = trafilatura.metadata.extract_metadata(downloaded)
                    if metadata and metadata.author:
                        result["author"] = metadata.author
                    return result

            # Extract images list first
            image_list = []
            if self.include_images:
                image_list = self._extract_images(downloaded, url)

            # Use BeautifulSoup to extract content with embedded images
            content = self._extract_content_with_images(downloaded, image_list)

            # If the content is image-only or has too little text, treat as empty
            if self._is_low_text_content(content):
                content = ""

            # If content is too short, try structured data fallbacks (Next.js / ld+json)
            if not content or len(content.strip()) < 200:
                ld_json_content = self._extract_from_ld_json(downloaded)
                next_data_content = self._extract_from_next_data(downloaded)

                # Prefer the longest meaningful content
                candidates = [content or "", ld_json_content or "", next_data_content or ""]
                content = max(candidates, key=lambda c: len(c.strip()))

            # Last fallback: trafilatura text extraction
            if not content or len(content.strip()) < 200:
                traf_content = trafilatura.extract(downloaded) or ""
                if len(traf_content.strip()) > len((content or "").strip()):
                    content = traf_content

            if content:
                # Truncate if too long
                if len(content) > self.max_length:
                    content = content[: self.max_length] + "\n\n...(内容过长已截断)"
                result["content"] = content

            # Store images list
            result["images"] = image_list

            # Extract author from metadata
            metadata = trafilatura.metadata.extract_metadata(downloaded)
            if metadata and metadata.author:
                result["author"] = metadata.author

        except Exception as e:
            print(f"  Content extraction failed: {e}")

        return result

    def _is_wechat_article(self, url: str) -> bool:
        parsed = urlparse(url)
        return parsed.netloc.endswith("mp.weixin.qq.com")

    def _respect_wechat_rate_limit(self) -> None:
        if self.wechat_min_interval_seconds <= 0:
            return

        now = time.monotonic()
        elapsed = now - self._last_wechat_fetch_at
        remaining = self.wechat_min_interval_seconds - elapsed
        if remaining > 0:
            print(f"  Waiting {remaining:.1f}s before next WeChat request...")
            time.sleep(remaining)
        self._last_wechat_fetch_at = time.monotonic()

    def _extract_wechat_with_playwright(self, url: str) -> Dict:
        result = {
            "content": None,
            "images": [],
            "author": None,
            "validation_blocked": False,
        }

        try:
            from playwright.sync_api import TimeoutError as PlaywrightTimeoutError
            from playwright.sync_api import sync_playwright
        except ImportError:
            print("  Playwright not installed, falling back to HTTP extraction")
            return result

        self._respect_wechat_rate_limit()
        print("  Using Playwright for WeChat article extraction...")

        try:
            with sync_playwright() as playwright:
                extracted = None

                if self.wechat_user_data_dir:
                    extracted = self._extract_wechat_via_profile(
                        playwright, url, PlaywrightTimeoutError
                    )

                if not extracted:
                    extracted = self._extract_wechat_via_ephemeral_context(
                        playwright, url, PlaywrightTimeoutError
                    )

                if not extracted:
                    return result

                current_url = extracted.get("current_url", "")
                if "/mp/wappoc_appmsgcaptcha" in current_url:
                    result["validation_blocked"] = True
                    return result

                content_text = extracted.get("content_text", "")
                if self._is_wechat_validation_page(content_text):
                    result["validation_blocked"] = True
                    return result

                content_html = extracted.get("content_html", "")
                content = self._extract_wechat_markdown(content_html)
                if self._is_wechat_validation_page(content):
                    result["validation_blocked"] = True
                    return result
                if content and len(content) > self.max_length:
                    content = content[: self.max_length] + "\n\n...(内容过长已截断)"

                result["content"] = content or content_text or None
                result["images"] = list(dict.fromkeys(extracted.get("images", [])))
                result["author"] = extracted.get("author") or None
        except Exception as e:
            print(f"  Playwright extraction failed: {e}")

        return result

    def _playwright_page_options(self) -> Dict:
        options = {
            "user_agent": (
                "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/146.0.0.0 Safari/537.36"
            ),
            "viewport": {"width": 1440, "height": 2200},
            "locale": "zh-CN",
        }
        if self.wechat_extra_http_headers:
            options["extra_http_headers"] = self.wechat_extra_http_headers
        return options

    def _extract_wechat_via_profile(self, playwright, url: str, timeout_error):
        if not self.wechat_user_data_dir:
            return None

        profile_dir = self.wechat_user_data_dir
        if not os.path.exists(profile_dir):
            print(f"  WeChat profile dir not found: {profile_dir}")
            return None

        print(f"  Trying persistent Chromium profile: {profile_dir}")
        context = None
        try:
            context = playwright.chromium.launch_persistent_context(
                profile_dir,
                headless=True,
                **self._playwright_page_options(),
            )
            page = context.new_page()
            extracted = self._extract_wechat_from_page(page, url, timeout_error)
            context.close()
            return extracted
        except Exception as e:
            print(f"  Persistent profile extraction failed: {e}")
            if context:
                try:
                    context.close()
                except Exception:
                    pass
            return None

    def _extract_wechat_via_ephemeral_context(self, playwright, url: str, timeout_error):
        browser = None
        context = None
        try:
            browser = playwright.chromium.launch(headless=True)
            context_kwargs = self._playwright_page_options()
            if self.wechat_storage_state_path and os.path.exists(
                self.wechat_storage_state_path
            ):
                print(
                    f"  Loading WeChat storage state: {self.wechat_storage_state_path}"
                )
                context_kwargs["storage_state"] = self.wechat_storage_state_path

            context = browser.new_context(**context_kwargs)
            page = context.new_page()
            extracted = self._extract_wechat_from_page(page, url, timeout_error)
            context.close()
            browser.close()
            return extracted
        except Exception as e:
            print(f"  Ephemeral browser extraction failed: {e}")
            if context:
                try:
                    context.close()
                except Exception:
                    pass
            if browser:
                try:
                    browser.close()
                except Exception:
                    pass
            return None

    def _extract_wechat_from_page(self, page, url: str, timeout_error):
        page.goto(url, wait_until="domcontentloaded", timeout=self.wechat_timeout_ms)
        page.wait_for_timeout(1500)
        current_url = page.url

        body_text = page.locator("body").inner_text(timeout=5000)
        if self._is_wechat_validation_page(body_text):
            return {"content_text": body_text, "current_url": current_url}

        try:
            page.wait_for_selector("#js_content", timeout=self.wechat_timeout_ms)
        except timeout_error:
            body_text = page.locator("body").inner_text(timeout=5000)
            return {"content_text": body_text, "current_url": current_url}

        extracted = page.evaluate(
            """
            () => {
              const text = (selector) => {
                const el = document.querySelector(selector);
                return el ? (el.innerText || el.textContent || "").trim() : "";
              };
              const attr = (selector, name) => {
                const el = document.querySelector(selector);
                return el ? (el.getAttribute(name) || "").trim() : "";
              };
              const contentEl = document.querySelector("#js_content");
              const images = contentEl
                ? Array.from(contentEl.querySelectorAll("img"))
                    .map((img) =>
                      img.getAttribute("data-src") ||
                      img.getAttribute("data-original") ||
                      img.getAttribute("src") ||
                      ""
                    )
                    .filter(Boolean)
                : [];
              return {
                title:
                  text("#activity-name") ||
                  attr('meta[property="og:title"]', "content") ||
                  document.title,
                author: text("#js_name") || text(".rich_media_meta_text"),
                publish_time:
                  text("#publish_time") ||
                  attr('meta[property="article:published_time"]', "content"),
                content_html: contentEl ? contentEl.innerHTML : "",
                content_text: contentEl ? (contentEl.innerText || "").trim() : "",
                images,
              };
            }
            """
        )
        extracted["current_url"] = current_url
        return extracted

    def _is_wechat_validation_page(self, text: str) -> bool:
        if not text:
            return False
        normalized = re.sub(r"\s+", "", text)
        required_patterns = [
            "环境异常",
            "完成验证后即可继续访问",
            "去验证",
        ]
        weak_patterns = [
            "当前环境异常",
            "轻点两下取消赞",
            "轻点两下取消在看",
        ]
        if all(pattern in normalized for pattern in required_patterns):
            return True
        if "环境异常" in normalized and any(
            pattern in normalized for pattern in weak_patterns
        ):
            return True
        return False

    def _extract_wechat_markdown(self, html: str) -> str:
        if not html:
            return ""

        try:
            soup = BeautifulSoup(html, "html.parser")

            for tag in soup.find_all(["script", "style", "noscript"]):
                tag.decompose()

            content_parts = []
            for elem in soup.find_all(
                [
                    "section",
                    "p",
                    "blockquote",
                    "pre",
                    "h1",
                    "h2",
                    "h3",
                    "h4",
                    "img",
                    "iframe",
                    "ul",
                    "ol",
                ]
            ):
                if elem.name == "img":
                    src = (
                        elem.get("data-src")
                        or elem.get("data-original")
                        or elem.get("src")
                        or ""
                    )
                    if src:
                        content_parts.append(f"\n![图片]({src.strip()})\n")
                    continue

                if elem.name == "iframe":
                    src = elem.get("data-src") or elem.get("src") or ""
                    if src:
                        content_parts.append(f"\n[视频]({src.strip()})\n")
                    continue

                if elem.name in {"ul", "ol"}:
                    for index, li in enumerate(elem.find_all("li", recursive=False), start=1):
                        text = li.get_text("\n", strip=True)
                        if text:
                            prefix = "- " if elem.name == "ul" else f"{index}. "
                            content_parts.append(f"{prefix}{text}\n")
                    continue

                text = elem.get_text("\n", strip=True)
                if not text:
                    continue

                if elem.name == "h2":
                    content_parts.append(f"\n## {text}\n")
                elif elem.name == "h3":
                    content_parts.append(f"\n### {text}\n")
                elif elem.name == "h4":
                    content_parts.append(f"\n#### {text}\n")
                elif elem.name == "blockquote":
                    content_parts.append(f"\n> {text}\n")
                elif elem.name == "pre":
                    content_parts.append(f"\n```\n{text}\n```\n")
                else:
                    content_parts.append(f"\n{text}\n")

            result = "\n".join(content_parts)
            result = re.sub(r"\n{3,}", "\n\n", result).strip()
            if self._is_wechat_validation_page(result):
                return ""
            return result
        except Exception:
            return ""

    def _extract_from_ld_json(self, html: str) -> str:
        """Extract articleBody from JSON-LD if available"""
        try:
            soup = BeautifulSoup(html, "html.parser")
            scripts = soup.find_all("script", type="application/ld+json")
            candidates = []

            for script in scripts:
                raw = script.string or script.get_text()
                if not raw:
                    continue
                try:
                    data = json.loads(raw)
                except Exception:
                    continue

                self._collect_ldjson_candidates(data, candidates)

            return self._choose_best_candidate(candidates)
        except Exception:
            return ""

    def _collect_ldjson_candidates(self, data, candidates: List[str]) -> None:
        if isinstance(data, dict):
            # Prefer explicit article body fields
            for key in ["articleBody", "content", "body", "text"]:
                value = data.get(key)
                if isinstance(value, str):
                    candidates.append(self._normalize_candidate_text(value))

            # Handle graph structures
            for value in data.values():
                self._collect_ldjson_candidates(value, candidates)

        elif isinstance(data, list):
            for item in data:
                self._collect_ldjson_candidates(item, candidates)

    def _extract_from_next_data(self, html: str) -> str:
        """Extract content from Next.js __NEXT_DATA__ if available"""
        try:
            soup = BeautifulSoup(html, "html.parser")
            script = soup.find("script", id="__NEXT_DATA__")
            if not script:
                return ""

            raw = script.string or script.get_text()
            if not raw:
                return ""

            data = json.loads(raw)
            candidates = []
            self._collect_next_data_candidates(data, candidates)
            return self._choose_best_candidate(candidates)
        except Exception:
            return ""

    def _collect_next_data_candidates(self, data, candidates: List[str]) -> None:
        preferred_keys = {
            "content",
            "body",
            "articleBody",
            "markdown",
            "mdx",
            "mdxSource",
            "html",
            "text",
            "description",
            "summary",
        }

        if isinstance(data, dict):
            for key, value in data.items():
                if isinstance(value, str) and key in preferred_keys:
                    candidates.append(self._normalize_candidate_text(value))
                elif isinstance(value, list) and key in {"content", "body", "blocks", "sections"}:
                    block_text = self._join_text_from_blocks(value)
                    if block_text:
                        candidates.append(block_text)
                else:
                    self._collect_next_data_candidates(value, candidates)
        elif isinstance(data, list):
            for item in data:
                self._collect_next_data_candidates(item, candidates)

    def _join_text_from_blocks(self, blocks: List) -> str:
        lines = []

        def add_line(text: str, prefix: str = ""):
            text = text.strip()
            if text:
                lines.append(f"{prefix}{text}")

        def walk(block):
            if isinstance(block, str):
                add_line(block)
                return
            if isinstance(block, dict):
                block_type = str(block.get("type", "")).lower()
                for key in ["title", "heading", "subtitle", "text", "content"]:
                    value = block.get(key)
                    if isinstance(value, str):
                        if key in {"title", "heading"} or block_type in {"heading", "title", "h2", "h3"}:
                            add_line(value, "## ")
                        else:
                            add_line(value)
                # Recurse into children
                for child_key in ["children", "items", "blocks", "content"]:
                    child = block.get(child_key)
                    if isinstance(child, list):
                        for item in child:
                            walk(item)
            elif isinstance(block, list):
                for item in block:
                    walk(item)

        for block in blocks:
            walk(block)

        return "\n".join(lines).strip()

    def _normalize_candidate_text(self, text: str) -> str:
        text = html_lib.unescape(text).strip()
        if not text:
            return ""
        if "<" in text and ">" in text:
            return self._html_to_markdown(text)
        return text

    def _choose_best_candidate(self, candidates: List[str]) -> str:
        best = ""
        best_score = 0

        for candidate in candidates:
            if not candidate:
                continue
            cleaned = candidate.strip()
            if len(cleaned) < 200:
                continue
            if self._looks_like_code_or_blob(cleaned):
                continue

            score = len(cleaned)
            if cleaned.count("\n") > 5:
                score *= 1.1
            if cleaned.count(".") + cleaned.count("。") > 5:
                score *= 1.1

            if score > best_score:
                best_score = score
                best = cleaned

        return best

    def _looks_like_code_or_blob(self, text: str) -> bool:
        if "function(" in text or "webpack" in text or "__NEXT_DATA__" in text:
            return True
        if text.count("{") > 20 and text.count("}") > 20:
            return True
        if text.count("<") > 20 and text.count(">") > 20 and "<p" not in text:
            return True
        return False

    def _extract_obsidian_publish_markdown(
        self, html: str
    ) -> Optional[Tuple[str, str]]:
        """Extract markdown from Obsidian Publish preload endpoint if present."""
        try:
            match = re.search(r'preloadPage\s*=\s*f\([\'"]([^\'"]+)[\'"]\)', html)
            if not match:
                return None

            md_url = match.group(1)
            resp = requests.get(
                md_url,
                timeout=30,
                headers={
                    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
                },
            )
            if resp.status_code != 200:
                return None

            content_type = resp.headers.get("content-type", "")
            if "text/markdown" not in content_type and not md_url.endswith(".md"):
                return None

            base_url = md_url.rsplit("/", 1)[0] + "/"
            return resp.text, base_url
        except Exception:
            return None

    def _extract_images_from_markdown(self, markdown: str, base_url: str) -> List[str]:
        """Extract image URLs from markdown, resolving relative paths."""
        if not markdown:
            return []
        images = []
        for img in re.findall(r"!\[[^\]]*\]\(([^)]+)\)", markdown):
            images.append(img.strip())
        for img in re.findall(r"!\[\[([^\]]+)\]\]", markdown):
            images.append(img.strip())

        resolved = []
        for img in images:
            if img.startswith("http"):
                resolved.append(img)
            else:
                resolved.append(urljoin(base_url, img))
        return list(dict.fromkeys(resolved))

    def _count_meaningful_chars(self, text: str) -> int:
        if not text:
            return 0
        return len(re.findall(r"[A-Za-z0-9\u4e00-\u9fff]", text))

    def _is_low_text_content(self, content: Optional[str]) -> bool:
        if not content:
            return True
        img_count = len(re.findall(r"!\[[^\]]*\]\([^)]+\)", content))
        text_only = re.sub(r"!\[[^\]]*\]\([^)]+\)", "", content)
        meaningful_chars = self._count_meaningful_chars(text_only)
        if meaningful_chars < 40:
            return True
        if img_count > 0 and meaningful_chars < 120:
            return True
        return False

    def _html_to_markdown(self, html: str) -> str:
        """Convert HTML content to simple markdown-like text"""
        try:
            soup = BeautifulSoup(html, "html.parser")

            for tag in soup.find_all(["script", "style", "nav", "footer", "header", "aside", "noscript"]):
                tag.decompose()

            # Headings
            for tag in soup.find_all(["h1", "h2", "h3", "h4", "h5", "h6"]):
                level = int(tag.name[1])
                prefix = "#" * level
                tag.replace_with(f"\n\n{prefix} {tag.get_text(strip=True)}\n\n")

            # Lists
            for tag in soup.find_all("li"):
                tag.replace_with(f"\n- {tag.get_text(strip=True)}\n")

            # Paragraphs
            for tag in soup.find_all("p"):
                text = tag.get_text(strip=True)
                if text:
                    tag.replace_with(f"\n{text}\n")
                else:
                    tag.decompose()

            # Images
            for tag in soup.find_all("img"):
                src = tag.get("src", "")
                alt = tag.get("alt", "")
                if src:
                    tag.replace_with(f"\n\n![{alt}]({src})\n\n")
                else:
                    tag.decompose()

            text = soup.get_text(separator="\n", strip=True)
            text = re.sub(r"\n{3,}", "\n\n", text)
            return text.strip()
        except Exception:
            return ""

    def _extract_images(self, html: str, base_url: str) -> List[str]:
        """Extract image URLs from HTML using regex, filtering out logos and icons"""
        try:
            base = f"{urlparse(base_url).scheme}://{urlparse(base_url).netloc}"

            # Find all img tags with src and srcset attributes
            src_pattern = r'<img[^>]+src=[\'"]([^\'">]+)[\'"]'
            srcset_pattern = r'<img[^>]+srcset=[\'"]([^\'">]+)[\'"]'
            src_images = re.findall(src_pattern, html)
            srcset_images = re.findall(srcset_pattern, html)

            # Merge src and srcset images
            all_img_attrs = src_images + srcset_images

            # Convert to absolute URLs and deduplicate
            unique_images = set()
            for img in all_img_attrs:
                if "," in img:
                    img_urls = []
                    for part in img.split(","):
                        part = part.strip().split()[0]
                        img_urls.append(part)

                    for img_url in img_urls:
                        if self._should_include_image(img_url):
                            abs_url = self._resolve_image_url(img_url, base)
                            if abs_url:
                                unique_images.add(abs_url)
                    continue

                img_url = img
                if not self._should_include_image(img_url):
                    continue

                abs_url = self._resolve_image_url(img_url, base)
                if abs_url:
                    unique_images.add(abs_url)

            return list(unique_images)
        except Exception as e:
            print(f"  Image extraction failed: {e}")
            return []

    def _should_include_image(self, img_url: str) -> bool:
        skip_patterns = [
            "adsct",
            "analytics",
            "pixel",
            "facebook.com/tr",
            "twitter.com/i",
        ]
        if any(x in img_url for x in skip_patterns):
            return False
        if img_url.endswith(".gif") or "icon" in img_url.lower():
            return False

        logo_patterns = [
            "logo",
            "brand",
            "header-logo",
            "site-logo",
            "footer-logo",
            "favicon",
            "apple-touch-icon",
            "icon",
            "branding",
            "site-header",
            "site-footer",
            "company-logo",
            "header-brand",
            "social-share",
            "og:image",
        ]
        img_lower = img_url.lower()
        if any(pattern in img_lower for pattern in logo_patterns):
            return False

        small_size_patterns = [
            "w_32",
            "w_36",
            "w_64",
            "w_80",
            "h_32",
            "h_36",
            "h_64",
            "h_80",
        ]
        if any(x in img_url for x in small_size_patterns):
            return False

        if "placeholder" in img_lower:
            return False

        return True

    def _resolve_image_url(self, img_url: str, base: str) -> Optional[str]:
        try:
            parsed = urlparse(img_url)

            if "url=" in img_url:
                qs = parse_qs(parsed.query)
                if "url" in qs:
                    real_url = unquote(qs["url"][0])
                    if real_url.startswith("http"):
                        return real_url

            if img_url.startswith("http"):
                return img_url
            elif img_url.startswith("//"):
                return f"https:{img_url}"
            else:
                return urljoin(base, img_url)
        except Exception as e:
            print(f"  Failed to resolve image URL {img_url}: {e}")
            return None

    def clean_content(self, content: str) -> str:
        """Clean and format extracted content"""
        if not content:
            return ""
        return content.strip()

    def _extract_content_with_images(self, html: str, image_list: List[str]) -> str:
        """Extract content using BeautifulSoup, preserving image positions"""
        try:
            soup = BeautifulSoup(html, "html.parser")

            # Remove script, style, nav, footer, header elements (but keep iframe for videos)
            for element in soup(
                ["script", "style", "nav", "footer", "header", "aside", "noscript"]
            ):
                element.decompose()

            # Find the main content (try common content containers)
            main_content = (
                soup.find("article")
                or soup.find("main")
                or soup.find(
                    "div", class_=re.compile(r"content|article|post|entry", re.I)
                )
                or soup.body
            )

            if not main_content:
                return ""

            # Remove unrelated sections (ads, related posts, recommendations, etc.)
            self._remove_unrelated_sections(main_content)

            # Build text with embedded images
            content_parts = []
            text_char_count = 0

            # Extract base URL from image_list (all from same domain)
            base = ""
            if image_list:
                # Use the first image to determine base URL
                first_img = image_list[0]
                if first_img.startswith("http"):
                    parsed = urlparse(first_img)
                    base = f"{parsed.scheme}://{parsed.netloc}"
                elif first_img.startswith("/"):
                    # Relative path, need to get from HTML context
                    # Try to find base tag or use common domain
                    base_tag = soup.find("base")
                    if base_tag and base_tag.get("href"):
                        base = base_tag["href"]
                    else:
                        base = "https://www.anthropic.com"

            # Build filename mapping for faster matching
            filename_to_idx = {}
            for i, img_url in enumerate(image_list):
                parsed = urlparse(img_url)
                # Extract filename from URL
                filename = parsed.path.split("/")[-1]
                # Also try with query parameter (Next.js URLs)
                if "url=" in img_url:
                    from urllib.parse import unquote

                    # Extract the real URL from Next.js proxy
                    match = re.search(r"url=([^&]+)", img_url)
                    if match:
                        real_url = unquote(match.group(1))
                        real_parsed = urlparse(real_url)
                        filename = real_parsed.path.split("/")[-1]
                if filename:
                    filename_to_idx[filename] = i + 1

            # Track processed elements to avoid duplicates
            processed = set()

            # Process elements in DOM order to preserve image positions in content
            # Get all relevant elements in order
            all_elements = main_content.find_all(
                [
                    "p",
                    "h1",
                    "h2",
                    "h3",
                    "h4",
                    "h5",
                    "h6",
                    "blockquote",
                    "pre",
                    "ul",
                    "ol",
                    "img",
                    "iframe",
                ]
            )

            for elem in all_elements:
                elem_id = id(elem)
                if elem_id in processed:
                    continue

                # Check if this element is nested inside another list/block element
                parent = elem.find_parent(["ul", "ol", "li", "p", "blockquote", "pre"])
                if parent and id(parent) in processed:
                    continue

                # Handle images
                if elem.name == "img":
                    src = elem.get("src", "")
                    if not src:
                        continue

                    # Skip placeholder and decorative images
                    # Check if this image is in main content area (hero, card, content, article, etc.)
                    # Skip if parent doesn't have content-related class or tags
                    parent = elem.find_parent(
                        ["p", "h1", "h2", "h3", "div", "section", "article"]
                    )

                    if parent:
                        parent_class = parent.get("class", []) or []
                        parent_tag = parent.name

                        # Check if parent has content-related class
                        parent_class_str = (
                            " ".join(parent_class)
                            if isinstance(parent_class, list)
                            else str(parent_class)
                        )
                        has_content_class = any(
                            keyword in parent_class_str.lower()
                            for keyword in [
                                "hero",
                                "card",
                                "content",
                                "article",
                                "post",
                                "body",
                                "main",
                                "media",
                                "image",
                            ]
                        )

                        # Check if parent is a known container type
                        is_container = parent_tag in [
                            "div",
                            "section",
                            "article",
                            "main",
                        ]

                        # Skip if not in content area
                        if not has_content_class:
                            continue
                        # Also skip if in wrapper divs without content classes
                        if is_container and not has_content_class:
                            continue

                    # Also check filename for common decorative patterns
                    logo_patterns = [
                        "logo",
                        "brand",
                        "header-logo",
                        "site-logo",
                        "footer-logo",
                        "favicon",
                        "apple-touch-icon",
                        "icon",
                        "branding",
                        "site-header",
                        "site-footer",
                        "company-logo",
                        "header-brand",
                        "social-share",
                        "og:image",
                        "avatar",
                        "profile",
                        "symbol",
                        "badge",
                        "banner",
                        "sponsor",
                        "placeholder",
                    ]

                    src_lower = src.lower()
                    if any(pattern in src_lower for pattern in logo_patterns):
                        continue

                    # Convert to absolute for matching
                    if src.startswith("http"):
                        abs_src = src
                    elif src.startswith("//"):
                        abs_src = f"https:{src}"
                    else:
                        abs_src = urljoin(base, src)

                    # Extract filename and find matching index
                    parsed_src = urlparse(abs_src)
                    src_filename = parsed_src.path.split("/")[-1]

                    # Also check for Next.js proxy URLs
                    if "url=" in abs_src:
                        from urllib.parse import unquote, parse_qs

                        qs = parse_qs(parsed_src.query)
                        if "url" in qs:
                            real_url = unquote(qs["url"][0])
                            real_parsed = urlparse(real_url)
                            src_filename = real_parsed.path.split("/")[-1]
                            # Use the real URL for display
                            abs_src = real_url

                    # Find matching index by filename
                    idx = filename_to_idx.get(src_filename, len(filename_to_idx) + 1)

                    content_parts.append(f"\n\n![图片{idx}]({abs_src})\n\n")
                    processed.add(elem_id)

                # Handle iframes (videos)
                elif elem.name == "iframe":
                    src = elem.get("src", "")
                    if src:
                        # Convert embed URLs to watchable URLs
                        video_url = src
                        if "youtube.com/embed/" in src:
                            # Convert https://www.youtube.com/embed/VIDEO_ID
                            # to https://www.youtube.com/watch?v=VIDEO_ID
                            import re as re_module

                            match = re_module.search(r"/embed/([a-zA-Z0-9_-]+)", src)
                            if match:
                                video_id = match.group(1)
                                video_url = (
                                    f"https://www.youtube.com/watch?v={video_id}"
                                )
                        elif "youtu.be/" in src:
                            # Short URL already watchable
                            video_url = src
                        elif "player.vimeo.com/video/" in src:
                            # Convert https://player.vimeo.com/video/VIDEO_ID
                            # to https://vimeo.com/VIDEO_ID
                            match = re_module.search(r"/video/([0-9]+)", src)
                            if match:
                                video_id = match.group(1)
                                video_url = f"https://vimeo.com/{video_id}"

                        # Add video link
                        if any(
                            domain in src
                            for domain in [
                                "youtube.com",
                                "youtu.be",
                                "vimeo.com",
                                "player.vimeo.com",
                            ]
                        ):
                            content_parts.append(f"\n[视频]({video_url})\n")
                    processed.add(elem_id)

                # Handle lists
                elif elem.name in ["ul", "ol"]:
                    # Check if this is a metadata list (skip it)
                    elem_classes = elem.get("class", []) or []
                    if any("details" in str(c).lower() for c in elem_classes):
                        processed.add(elem_id)
                        continue

                    # Process list items
                    for li in elem.find_all("li", recursive=False):
                        # Check if this is a metadata list item
                        li_classes = li.get("class", []) or []
                        if any(
                            "details" in str(c).lower()
                            or "hero_blog_post" in str(c).lower()
                            for c in li_classes
                        ):
                            continue

                        text = li.get_text(strip=True)
                        if text:
                            # Also skip by content patterns
                            if any(
                                text.startswith(p)
                                for p in [
                                    "Category",
                                    "Product",
                                    "Date",
                                    "Reading time",
                                    "Copy link",
                                ]
                            ):
                                continue

                            if elem.name == "ul":
                                content_parts.append(f"- {text}\n")
                            else:
                                # Get the index from the parent
                                idx = 1
                                for prev_li in li.find_previous_siblings("li"):
                                    idx += 1
                                content_parts.append(f"{idx}. {text}\n")
                        processed.add(id(li))
                    processed.add(elem_id)

                # Handle text elements (headings, paragraphs, blockquotes, code)
                elif elem.name in [
                    "p",
                    "h1",
                    "h2",
                    "h3",
                    "h4",
                    "h5",
                    "h6",
                    "blockquote",
                    "pre",
                    "code",
                ]:
                    # Skip h1 titles since they're already added at the file level
                    if elem.name == "h1":
                        processed.add(elem_id)
                        continue

                    if elem.name in ["pre", "code"]:
                        # Preserve original formatting for code blocks
                        text = elem.get_text()
                        if text:
                            # Use markdown code block format
                            content_parts.append(f"\n```\n{text}\n```\n")
                    else:
                        text = elem.get_text(strip=True)
                        if text:
                            # Skip metadata items (short, label-value pairs)
                            # These are typically things like "CategoryCoding", "ProductClaude Code", "DateNovember 25, 2025"
                            if elem.name == "p":
                                # Skip if text starts with known metadata labels
                                metadata_prefixes = [
                                    "Category",
                                    "Product",
                                    "Date",
                                    "Reading time",
                                    "Copy link",
                                    "CategoryCoding",
                                    "ProductClaude",
                                ]
                                if any(
                                    text.startswith(prefix)
                                    or text.replace(" ", "") == prefix
                                    for prefix in metadata_prefixes
                                ):
                                    processed.add(elem_id)
                                    continue
                            # Add heading markers with proper newlines
                            if elem.name == "h2":
                                content_parts.append(f"\n\n## {text}\n\n")
                            elif elem.name == "h3":
                                content_parts.append(f"\n\n### {text}\n\n")
                            elif elem.name == "h4":
                                content_parts.append(f"\n\n#### {text}\n\n")
                            elif elem.name == "blockquote":
                                content_parts.append(f"\n> {text}\n")
                            else:
                                content_parts.append(f"\n{text}\n")
                            text_char_count += self._count_meaningful_chars(text)
                    processed.add(elem_id)

            # Handle line breaks
            for br in main_content.find_all("br"):
                # Only process br if not inside a processed element
                parent = br.find_parent(
                    ["p", "h1", "h2", "h3", "h4", "h5", "h6", "blockquote", "pre", "li"]
                )
                if not parent or id(parent) not in processed:
                    content_parts.append("\n")

            # Clean up excessive newlines
            result = "\n".join(content_parts)
            result = re.sub(r"\n{3,}", "\n\n", result)

            # Clean up unrelated sections from markdown result
            result = self._clean_markdown_content(result)

            result = result.strip()

            # If we extracted mostly images or too little text, fallback to br-based text
            if self._is_low_text_content(result) or text_char_count < 120:
                fallback_text = self._extract_text_with_br(main_content)
                if self._count_meaningful_chars(fallback_text) > self._count_meaningful_chars(
                    result
                ):
                    return fallback_text.strip()

            return result

        except Exception as e:
            print(f"  BeautifulSoup extraction failed: {e}")
            # Fallback to trafilatura
            return trafilatura.extract(html) or ""

    def _extract_text_with_br(self, container) -> str:
        """Extract text from a container that uses <br> instead of <p> tags."""
        if not container:
            return ""
        try:
            for br in container.find_all("br"):
                br.replace_with("\n")
            text = container.get_text(separator="\n", strip=True)
            text = re.sub(r"\n{3,}", "\n\n", text)
            return text.strip()
        except Exception:
            return ""

    def _remove_unrelated_sections(self, soup) -> None:
        """Remove unrelated sections like ads, related posts, recommendations"""
        if not soup:
            return

        try:
            # Patterns to identify unrelated content
            unrelated_patterns = [
                # Related posts / recommendations
                r"related[\s_-]?posts?",
                r"recommended",
                r"you\s+might\s+also\s+like",
                r"read\s+more",
                r"see\s+also",
                r"popular\s+posts",
                r"recent\s+posts",
                r"more\s+from",
                r"up\s+next",
                r"further\s+reading",
                r"explore\s+more",
                # Comments
                r"comments?",
                r"discussion",
                r"replies?",
                r"faq",  # FAQ sections
                # Share buttons
                r"share",
                r"social[\s_-]?share?",
                r"twitter",
                r"facebook",
                r"linkedin",
                r"email\s+this",
                # Subscription / Newsletter
                r"subscribe",
                r"newsletter",
                r"follow\s+us",
                r"developer\s+newsletter",
                # Author info boxes (if separate)
                r"author[\s_-]?box",
                r"about\s+the\s+author",
                # Footer / end of article sections
                r"product\s+news",
                r"best\s+practices",
                # Ads
                r"advertisement?",
                r"sponsored",
                r"promoted",
            ]

            # Combine patterns into a single regex
            pattern = re.compile("|".join(unrelated_patterns), re.IGNORECASE)

            # Remove elements with matching classes, ids, or text content
            for element in soup.find_all(True):
                if not isinstance(element, Tag):
                    continue

                # Check class and id attributes
                try:
                    classes = element.get("class", []) or []
                    class_str = (
                        " ".join(classes) if isinstance(classes, list) else str(classes)
                    )
                    elem_id = element.get("id", "") or ""
                except AttributeError:
                    continue

                # Check if element matches unrelated patterns
                text_content = element.string
                if text_content and pattern.search(text_content):
                    # Found matching text content
                    should_remove = True
                elif pattern.search(class_str) or pattern.search(elem_id):
                    should_remove = True
                else:
                    should_remove = False

                if should_remove:
                    # Check if it's a heading followed by unrelated content
                    # Only remove if it's clearly an unrelated section
                    if element.name in ["h1", "h2", "h3", "h4", "h5", "h6"]:
                        text = element.get_text(strip=True).lower()
                        if any(
                            keyword in text
                            for keyword in [
                                "related posts",
                                "recommended",
                                "you might also like",
                                "read more",
                                "see also",
                                "popular posts",
                                "more from",
                                "comments",
                                "share",
                                "subscribe",
                                "newsletter",
                            ]
                        ):
                            element.decompose()
                    elif element.name in ["div", "section", "aside", "nav"]:
                        element.decompose()

            # Remove specific common container classes/ids for unrelated content
            for selector in [
                {
                    "class_": re.compile(
                        r"related|recommended|more-reading|see-also", re.I
                    )
                },
                {
                    "class_": re.compile(
                        r"share|social|follow|subscribe|newsletter", re.I
                    )
                },
                {"class_": re.compile(r"comments?|discussion|replies?", re.I)},
                {"id": re.compile(r"related|recommended|comments?|share", re.I)},
            ]:
                for elem in soup.find_all(**selector):
                    if elem and hasattr(elem, "decompose"):
                        elem.decompose()

            # Also remove headings with specific keywords and all content after them
            for heading in soup.find_all(["h1", "h2", "h3", "h4", "h5", "h6"]):
                heading_text = heading.get_text(strip=True).lower()
                if any(
                    keyword in heading_text
                    for keyword in [
                        "related posts",
                        "recommended",
                        "you might also like",
                        "read more",
                        "see also",
                        "popular posts",
                        "more from",
                        "explore more",
                        "faq",
                        "newsletter",
                        "subscribe",
                        "product news",
                        "best practices",
                        "get the developer",
                    ]
                ):
                    # Remove this heading and all following siblings
                    current = heading
                    while current:
                        next_elem = current.next_sibling
                        current.decompose()
                        current = next_elem
                        # Stop if we hit another heading at same or higher level
                        if current and current.name in [
                            "h1",
                            "h2",
                            "h3",
                            "h4",
                            "h5",
                            "h6",
                        ]:
                            # Check if it's same or higher level (lower number)
                            try:
                                current_level = int(current.name[1])
                                heading_level = int(heading.name[1])
                                if current_level <= heading_level:
                                    break
                            except:
                                break
        except Exception as e:
            print(f"  Warning: Error removing unrelated sections: {e}")

    def _clean_markdown_content(self, markdown: str) -> str:
        """Remove unrelated sections from markdown content"""
        # Find headings that indicate unrelated content starts
        stop_patterns = [
            r"^## Related posts",
            r"^## Related Posts",
            r"^## Recommended",
            r"^## You might also like",
            r"^## Read more",
            r"^## See also",
            r"^## Popular posts",
            r"^## More from",
            r"^## Explore more",
            r"^## FAQ",
            r"^## Frequently Asked Questions",
            r"^## Get the developer",
            r"^## Subscribe",
            r"^## Newsletter",
            r"^## Product news",
            r"^## Transform how your organization",
        ]

        lines = markdown.split("\n")
        result_lines = []

        for line in lines:
            # Check if this line matches any stop pattern
            should_stop = False
            for pattern in stop_patterns:
                if re.match(pattern, line, re.IGNORECASE):
                    should_stop = True
                    break

            if should_stop:
                # Stop adding lines
                break

            result_lines.append(line)

        return "\n".join(result_lines)
