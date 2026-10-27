#!/usr/bin/env python3
"""
Generic external RSS importer that fetches and reformats RSS feeds.
Supports RSS, Atom, and feedparser-based parsing.
Can be used via command line arguments or environment variables.
"""

import requests
import os
import sys
import argparse
import time
import re
import json
from datetime import datetime, timezone, timedelta
from email.utils import format_datetime
import xml.etree.ElementTree as ET

# Optional imports
try:
    import feedparser
    HAS_FEEDPARSER = True
except ImportError:
    HAS_FEEDPARSER = False

try:
    from feedgen.feed import FeedGenerator
    HAS_FEEDGEN = True
except ImportError:
    HAS_FEEDGEN = False

# Remove invalid XML 1.0 chars
INVALID_XML_RE = re.compile(r"[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]")


def clean_xml_text(s: str) -> str:
    """Remove invalid XML characters."""
    if not s:
        return ""
    s = INVALID_XML_RE.sub("", s)
    return s


class ExternalRSSImporter:
    def __init__(self, rss_url, output_file, feed_title=None, feed_link=None, feed_description=None,
                 use_feedparser=False, use_atom=False, max_retries=3):
        self.rss_url = rss_url
        self.output_file = output_file
        self.feed_title = feed_title
        self.feed_link = feed_link
        self.feed_description = feed_description
        self.use_feedparser = use_feedparser
        self.use_atom = use_atom
        self.max_retries = max_retries
        self._extracted_feed_info = None
        self._date_cache = None
        self._date_stats = {'page': 0, 'wayback': 0, 'dropped': 0, 'deferred': 0}
        self._wb_fail_streak = 0

    # ------------------------------------------------------------------
    # Missing-date resolution: page metadata -> Wayback first capture.
    # Items still undated after both are dropped from the output feed.
    # ------------------------------------------------------------------

    def _load_date_cache(self):
        if self._date_cache is not None:
            return self._date_cache
        path = self._date_cache_path()
        try:
            with open(path, 'r', encoding='utf-8') as f:
                self._date_cache = json.load(f)
        except (OSError, ValueError):
            self._date_cache = {}
        return self._date_cache

    def _save_date_cache(self):
        if self._date_cache is None:
            return
        path = self._date_cache_path()
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, 'w', encoding='utf-8') as f:
            json.dump(self._date_cache, f, ensure_ascii=False, indent=2)

    def _date_cache_path(self):
        return os.path.join('cache', 'date_cache.json')

    def _extract_date_from_page(self, link):
        """Extract a publication date from the article page itself."""
        try:
            resp = requests.get(link, timeout=15, allow_redirects=True, headers={
                "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
            })
            resp.raise_for_status()
            html = resp.text[:200000]
        except requests.exceptions.RequestException:
            return None

        # <meta property="article:published_time"> / og:updated_time / dc.date / itemprop
        for pattern in (
            r'<meta[^>]+(?:property|name|itemprop)=["\'](?:article:published_time|og:updated_time|dc\.date|datePublished|date)["\'][^>]+content=["\']([^"\']+)["\']',
            r'<meta[^>]+content=["\']([^"\']+)["\'][^>]+(?:property|name|itemprop)=["\'](?:article:published_time|og:updated_time|dc\.date|datePublished|date)["\']',
            r'<time[^>]+datetime=["\']([^"\']+)["\']',
            r'"datePublished"\s*:\s*"([^"]+)"',
        ):
            m = re.search(pattern, html, re.IGNORECASE)
            if m:
                dt = self.parse_date(m.group(1))
                if dt:
                    return dt
        return None

    # Sentinel returned by _extract_date_from_wayback when the CDX API
    # definitively reports no captures (vs None, which means the probe itself
    # failed and the item should be retried next run).
    _WB_NOT_FOUND = 'not_found'

    def _extract_date_from_wayback(self, link):
        """First Wayback capture timestamp ~= publication date for popular pages.

        Returns a datetime, _WB_NOT_FOUND (200 but no captures), or None when
        the probe fails (network error / non-200) so it can be retried later.
        """
        last_error = None
        for attempt in range(2):
            try:
                resp = requests.get(
                    'http://web.archive.org/cdx/search/cdx',
                    params={'url': re.sub(r'^https?://', '', link), 'output': 'json',
                            'limit': 1, 'fl': 'timestamp'},
                    timeout=20,
                )
                if resp.status_code in (429, 500, 502, 503):
                    last_error = f"HTTP {resp.status_code}"
                else:
                    resp.raise_for_status()
                    rows = resp.json()
                    # [["timestamp"], ["20080509061013"]]
                    if isinstance(rows, list) and len(rows) > 1 and len(rows[1]) > 0:
                        ts = rows[1][0]
                        return datetime.strptime(ts[:14], '%Y%m%d%H%M%S').replace(tzinfo=timezone.utc)
                    return self._WB_NOT_FOUND
            except (requests.exceptions.RequestException, ValueError, IndexError) as e:
                last_error = str(e)
            if attempt == 0:
                time.sleep(3)  # brief backoff before the single retry
        print(f"    wayback probe failed ({last_error}), will retry next run: {link}")
        return None

    def resolve_missing_date(self, link):
        """Resolve a date for a dateless item. Returns None if undated (item is dropped).

        Negative results are cached with a TTL: a brand-new article may have no
        Wayback capture yet, so drops are re-probed after a few days.
        """
        if not link:
            return None
        cache = self._load_date_cache()
        if link in cache:
            cached = cache[link]
            if isinstance(cached, str):
                return self.parse_date(cached)
            # Negative entry: re-probe only after the TTL. Legacy nulls carry
            # no timestamp and are re-probed once, then rewritten with one.
            if isinstance(cached, dict):
                failed_dt = self.parse_date(cached.get('no_date_at', ''))
                if failed_dt is None or datetime.now(timezone.utc) - failed_dt < timedelta(days=7):
                    return None
            # Legacy null or expired negative: fall through and probe again

        dt = self._extract_date_from_page(link)
        source = 'page'
        if dt is None:
            if self._wb_fail_streak >= 5:
                # Circuit breaker: CDX looks unreachable, defer the rest
                self._date_stats['deferred'] += 1
                return None
            time.sleep(1.0)  # be polite to the CDX API
            wb = self._extract_date_from_wayback(link)
            if wb is None:
                # Probe failed (network/rate limit): don't cache anything so
                # the item is retried next run
                self._wb_fail_streak += 1
                self._date_stats['deferred'] += 1
                return None
            self._wb_fail_streak = 0
            dt = None if wb is self._WB_NOT_FOUND else wb
            source = 'wayback'

        if dt is not None:
            self._date_stats[source] += 1
            cache[link] = dt.astimezone(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')
            print(f"    dated via {source}: {link} -> {cache[link]}")
        else:
            self._date_stats['dropped'] += 1
            cache[link] = {
                'no_date_at': datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'),
            }
            print(f"    no date found, dropping: {link}")
        self._save_date_cache()
        return dt

    def _print_date_stats(self):
        s = self._date_stats
        if s['page'] or s['wayback'] or s['dropped'] or s['deferred']:
            print(f"  Date resolution: {s['page']} via page, {s['wayback']} via wayback, "
                  f"{s['dropped']} dropped, {s['deferred']} deferred to next run")

    def _sort_key_datetime(self, value):
        return value if value is not None else datetime.min.replace(tzinfo=timezone.utc)

    def _extract_feed_info(self, root):
        """Extract feed title, link, description from RSS/Atom feed"""
        title = self.feed_title
        link = self.feed_link
        description = self.feed_description

        # Try RSS channel first
        channel = root.find('.//channel')
        if channel is not None:
            if not title:
                title_elem = channel.find('title')
                if title_elem is not None:
                    title = title_elem.text
            if not link:
                link_elem = channel.find('link')
                if link_elem is not None:
                    link = link_elem.text
            if not description:
                desc_elem = channel.find('description')
                if desc_elem is not None:
                    description = desc_elem.text
        else:
            # Try Atom feed format
            if not title:
                title_elem = root.find('{http://www.w3.org/2005/Atom}title')
                if title_elem is not None:
                    title = title_elem.text
            if not link:
                link_elem = root.find('.//{http://www.w3.org/2005/Atom}link[@rel="alternate"]')
                if link_elem is not None:
                    link = link_elem.get('href')
            if not description:
                desc_elem = root.find('{http://www.w3.org/2005/Atom}subtitle')
                if desc_elem is None:
                    desc_elem = root.find('{http://www.w3.org/2005/Atom}description')
                if desc_elem is not None:
                    description = desc_elem.text

        # Fallback to URL if no link found
        if not link:
            link = self.rss_url

        # Fallback to generic description if none found
        if not description:
            description = f"Latest posts from {title if title else 'this feed'}"

        # Fallback title if none found
        if not title:
            title = "RSS Feed"

        return {
            'title': clean_xml_text(title),
            'link': clean_xml_text(link),
            'description': clean_xml_text(description)
        }

    def parse_date(self, date_str):
        """Parse various date formats. Returns None when unparseable."""
        from dateutil import parser as date_parser
        if not date_str:
            return None
        try:
            parsed_date = date_parser.parse(date_str, tzinfos={"UT": timezone.utc, "UTC": timezone.utc})
            if parsed_date.tzinfo is None:
                parsed_date = parsed_date.replace(tzinfo=timezone.utc)
            return parsed_date
        except (ValueError, OverflowError, TypeError):
            return None

    def fetch_with_retry(self):
        """Fetch feed with retry logic"""
        headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
            "Accept": "application/rss+xml, application/xml;q=0.9, */*;q=0.8",
            "Accept-Language": "en-US,en;q=0.9",
        }

        for attempt in range(self.max_retries):
            try:
                print(f"Fetching RSS (attempt {attempt + 1}/{self.max_retries}) from: {self.rss_url}")
                response = requests.get(self.rss_url, headers=headers, timeout=30, allow_redirects=True)
                response.raise_for_status()
                return response.content
            except requests.exceptions.RequestException as e:
                print(f"Warning: Attempt {attempt + 1} failed: {e}")
                if attempt < self.max_retries - 1:
                    wait_time = min(2 ** attempt, 10)
                    print(f"Waiting {wait_time}s before retry...")
                    time.sleep(wait_time)
                else:
                    raise

    def fetch_and_reformat(self):
        """Fetch RSS from URL and reformat"""
        if self.use_feedparser and HAS_FEEDPARSER:
            return self.fetch_with_feedparser()
        elif self.use_atom:
            return self.fetch_atom_feed()
        else:
            return self.fetch_rss_feed()

    def fetch_with_feedparser(self):
        """Fetch and parse using feedparser library"""
        if not HAS_FEEDPARSER:
            print("Warning: feedparser not available, falling back to ElementTree")
            return self.fetch_rss_feed()

        print(f"Fetching RSS with feedparser from: {self.rss_url}")

        try:
            raw = self.fetch_with_retry()
            parsed = feedparser.parse(raw)

            if parsed.bozo and parsed.bozo_exception:
                print(f"Warning: Feed parse error: {parsed.bozo_exception}")
                print("Attempting to continue anyway...")

            # Extract feed info from parsed feed if not provided
            title = self.feed_title if self.feed_title else parsed.feed.get('title', 'RSS Feed')
            link = self.feed_link if self.feed_link else parsed.feed.get('link', self.rss_url)
            desc = self.feed_description if self.feed_description else parsed.feed.get('subtitle', parsed.feed.get('description', f"Latest posts from {title}"))

            # Store for later use
            if not self.feed_title:
                self.feed_title = title
            if not self.feed_link:
                self.feed_link = link
            if not self.feed_description:
                self.feed_description = desc

            print(f"Extracted feed info: title='{title}', link='{link}'")

            # Build RSS with ElementTree
            rss = ET.Element('rss', attrib={'version': '2.0'})
            channel = ET.SubElement(rss, 'channel')

            ET.SubElement(channel, 'title').text = clean_xml_text(title)
            ET.SubElement(channel, 'link').text = clean_xml_text(link)
            ET.SubElement(channel, 'description').text = clean_xml_text(desc)
            ET.SubElement(channel, 'language').text = 'en'
            ET.SubElement(channel, 'lastBuildDate').text = format_datetime(datetime.now(timezone.utc))

            def entry_datetime(entry):
                parsed_value = entry.get('published_parsed') or entry.get('updated_parsed')
                if parsed_value:
                    return datetime(*parsed_value[:6], tzinfo=timezone.utc)
                return None

            sorted_entries = sorted(
                parsed.entries,
                key=lambda entry: self._sort_key_datetime(entry_datetime(entry)),
                reverse=True,
            )[:30]

            for e in sorted_entries:
                dt = entry_datetime(e)
                if dt is None:
                    # Undated upstream entry: resolve or drop
                    dt = self.resolve_missing_date(e.get('link', ''))
                    if dt is None:
                        continue

                item = ET.SubElement(channel, 'item')
                ET.SubElement(item, 'title').text = clean_xml_text(e.get('title', ''))
                ET.SubElement(item, 'link').text = clean_xml_text(e.get('link', ''))

                guid_val = e.get('id') or e.get('guid') or e.get('link', '')
                guid = ET.SubElement(item, 'guid', attrib={'isPermaLink': 'false'})
                guid.text = clean_xml_text(guid_val)

                ET.SubElement(item, 'pubDate').text = format_datetime(dt)

                # description
                summary = e.get('summary', '')
                ET.SubElement(item, 'description').text = clean_xml_text(summary)
            # Save output
            os.makedirs('rss', exist_ok=True)
            output_path = os.path.join('rss', self.output_file)
            self._print_date_stats()

            tree = ET.ElementTree(rss)
            ET.indent(tree, space='  ')
            with open(output_path, 'wb') as f:
                f.write(b'<?xml version="1.0" encoding="utf-8"?>\n')
                tree.write(f, encoding='utf-8', xml_declaration=False)

            print(f"✓ RSS saved to: {output_path}")
            print(f"  Processed {len(sorted_entries)} items")
            return True

        except Exception as e:
            print(f"✗ Error fetching RSS with feedparser: {e}")
            return False

    def fetch_atom_feed(self):
        """Fetch and parse Atom feed"""
        if not HAS_FEEDGEN:
            print("Warning: feedgen not available, falling back to ElementTree")
            return self.fetch_rss_feed()

        print(f"Fetching Atom feed from: {self.rss_url}")

        try:
            content = self.fetch_with_retry()
            root = ET.fromstring(content)

            # Extract feed info if not provided
            if not all([self.feed_title, self.feed_link, self.feed_description]):
                feed_info = self._extract_feed_info(root)
                if self.feed_title is None:
                    self.feed_title = feed_info['title']
                if self.feed_link is None:
                    self.feed_link = feed_info['link']
                if self.feed_description is None:
                    self.feed_description = feed_info['description']
                print(f"Extracted feed info: title='{self.feed_title}', link='{self.feed_link}'")

            # Create feedgen instance
            feed = FeedGenerator()
            feed.title(self.feed_title)
            feed.link(href=self.feed_link, rel='alternate')
            feed.description(self.feed_description)
            feed.language('en')

            # Find all entries in Atom format
            entries = root.findall('.//{http://www.w3.org/2005/Atom}entry')

            parsed_entries = []
            for entry in entries:
                try:
                    title_elem = entry.find('{http://www.w3.org/2005/Atom}title')
                    link_elem = entry.find('.//{http://www.w3.org/2005/Atom}link[@rel="alternate"]')
                    content_elem = entry.find('{http://www.w3.org/2005/Atom}content')
                    published_elem = entry.find('{http://www.w3.org/2005/Atom}published')
                    updated_elem = entry.find('{http://www.w3.org/2005/Atom}updated')
                    id_elem = entry.find('{http://www.w3.org/2005/Atom}id')

                    if title_elem is None or link_elem is None:
                        continue

                    title_text = title_elem.text if title_elem is not None else ''
                    link_text = link_elem.get('href') if link_elem is not None else ''
                    content_text = content_elem.text if content_elem is not None else title_text

                    pub_date_text = None
                    if published_elem is not None:
                        pub_date_text = published_elem.text
                    elif updated_elem is not None:
                        pub_date_text = updated_elem.text

                    guid_text = id_elem.text if id_elem is not None else link_text

                    parsed_date = self.parse_date(pub_date_text) if pub_date_text else None
                    if parsed_date is None:
                        # Undated upstream entry: resolve or drop
                        parsed_date = self.resolve_missing_date(link_text)
                        if parsed_date is None:
                            continue
                    parsed_entries.append({
                        "title": title_text,
                        "link": link_text,
                        "description": content_text,
                        "guid": guid_text,
                        "pub_date": parsed_date,
                    })

                except Exception as e:
                    print(f"Warning: Error processing entry: {e}")
                    continue

            parsed_entries.sort(
                key=lambda item: self._sort_key_datetime(item["pub_date"]),
                reverse=True,
            )

            for entry_data in parsed_entries:
                feed_entry = feed.add_entry(order='append')
                feed_entry.title(entry_data["title"])
                feed_entry.link(href=entry_data["link"])
                feed_entry.description(entry_data["description"])
                feed_entry.guid(entry_data["guid"], permalink=True)

                if entry_data["pub_date"]:
                    feed_entry.pubDate(entry_data["pub_date"])

            # Save output
            os.makedirs('rss', exist_ok=True)
            output_path = os.path.join('rss', self.output_file)
            self._print_date_stats()
            rss_content = feed.rss_str(pretty=True)
            with open(output_path, 'wb') as f:
                f.write(rss_content)

            print(f"✓ RSS saved to: {output_path}")
            print(f"  Processed {len(parsed_entries)} entries")
            return True

        except Exception as e:
            print(f"✗ Error fetching Atom feed: {e}")
            return False

    def fetch_rss_feed(self):
        """Fetch RSS from URL and reformat with ElementTree"""
        print(f"Fetching RSS from: {self.rss_url}")

        try:
            content = self.fetch_with_retry()

            # Handle potential encoding issues
            if isinstance(content, bytes):
                try:
                    content = content.decode('utf-8')
                except UnicodeDecodeError:
                    content = content.decode('latin-1')

            # Fix malformed XML: ensure newline after XML declaration
            content = re.sub(r'^<\?xml[^>]*\?>', r'\g<0>\n', content, count=1)

            # Clean up problematic WordPress tags
            # Remove site tag that causes parsing issues
            content = re.sub(r'<site[^>]*>.*?</site>\s*', '', content, flags=re.DOTALL)

            # Parse the external RSS
            root = ET.fromstring(content)

            # Extract feed info if not provided
            if not all([self.feed_title, self.feed_link, self.feed_description]):
                feed_info = self._extract_feed_info(root)
                if self.feed_title is None:
                    self.feed_title = feed_info['title']
                if self.feed_link is None:
                    self.feed_link = feed_info['link']
                if self.feed_description is None:
                    self.feed_description = feed_info['description']
                print(f"Extracted feed info: title='{self.feed_title}', link='{self.feed_link}'")

            # Find the channel element
            channel = root.find('.//channel')
            if channel is None:
                channel = root  # Some RSS don't have channel wrapper

            # Create new RSS with ElementTree
            new_rss = ET.Element('rss', attrib={'version': '2.0'})
            new_channel = ET.SubElement(new_rss, 'channel')

            ET.SubElement(new_channel, 'title').text = self.feed_title
            ET.SubElement(new_channel, 'link').text = self.feed_link
            ET.SubElement(new_channel, 'description').text = self.feed_description
            ET.SubElement(new_channel, 'language').text = 'en'
            ET.SubElement(new_channel, 'lastBuildDate').text = format_datetime(datetime.now(timezone.utc))

            # Find all items and collect them for sorting
            items = channel.findall('.//item')

            # Parse all items first for sorting
            parsed_items = []
            for item in items:
                try:
                    title = item.find('title')
                    link = item.find('link')
                    description = item.find('description')
                    pub_date = item.find('pubDate')
                    guid = item.find('guid')

                    if title is None or link is None:
                        continue

                    title_text = title.text if title is not None else ''
                    link_text = link.text if link is not None else ''
                    description_text = description.text if description is not None else title_text
                    pub_date_text = pub_date.text if pub_date is not None else None
                    guid_text = guid.text if guid is not None else link_text

                    parsed_date = None
                    if pub_date_text:
                        parsed_date = self.parse_date(pub_date_text)
                    if parsed_date is None:
                        # Undated upstream item: resolve or drop
                        parsed_date = self.resolve_missing_date(link_text)
                    if parsed_date is None:
                        continue

                    parsed_items.append({
                        'title': title_text,
                        'link': link_text,
                        'description': description_text,
                        'guid': guid_text,
                        'pub_date': parsed_date
                    })

                except Exception as e:
                    print(f"Warning: Error processing item: {e}")
                    continue

            # Sort items by date (newest first)
            parsed_items.sort(key=lambda x: x['pub_date'], reverse=True)

            # Add sorted entries to channel
            for item_data in parsed_items:
                item_elem = ET.SubElement(new_channel, 'item')
                ET.SubElement(item_elem, 'title').text = item_data['title']
                ET.SubElement(item_elem, 'link').text = item_data['link']
                ET.SubElement(item_elem, 'description').text = item_data['description']
                guid_elem = ET.SubElement(item_elem, 'guid', attrib={'isPermaLink': 'true'})
                guid_elem.text = item_data['guid']

                if item_data['pub_date']:
                    ET.SubElement(item_elem, 'pubDate').text = format_datetime(item_data['pub_date'])

            # Create rss directory if it doesn't exist
            os.makedirs('rss', exist_ok=True)

            # Save to file with pretty print
            output_path = os.path.join('rss', self.output_file)
            self._print_date_stats()
            xml_bytes = ET.tostring(new_rss, encoding='utf-8', xml_declaration=True)

            # Pretty print by parsing and re-serializing
            parsed = ET.fromstring(xml_bytes)
            ET.indent(parsed, space='  ')
            with open(output_path, 'wb') as f:
                f.write(ET.tostring(parsed, encoding='utf-8', xml_declaration=True))

            print(f"✓ RSS saved to: {output_path}")
            print(f"  Processed {len(items)} items")
            return True

        except Exception as e:
            print(f"✗ Error fetching RSS: {e}")
            return False


def main():
    parser = argparse.ArgumentParser(
        description='Generic RSS importer - fetch and reformat external RSS feeds'
    )
    parser.add_argument('--rss-url', required=True, help='Source RSS feed URL')
    parser.add_argument('--output', help='Output filename (e.g., feed.xml)')
    parser.add_argument('--title', help='Feed title (auto-extracted from feed if not provided)')
    parser.add_argument('--link', help='Feed website URL (auto-extracted from feed if not provided)')
    parser.add_argument('--description', help='Feed description (auto-extracted from feed if not provided)')
    parser.add_argument('--use-feedparser', action='store_true', help='Use feedparser library for parsing')
    parser.add_argument('--use-atom', action='store_true', help='Parse as Atom feed')
    parser.add_argument('--max-retries', type=int, default=3, help='Maximum number of retries (default: 3)')

    args = parser.parse_args()

    # Exit if output is not provided
    if not args.output:
        parser.error("--output is required")

    importer = ExternalRSSImporter(
        rss_url=args.rss_url,
        output_file=args.output,
        feed_title=args.title,
        feed_link=args.link,
        feed_description=args.description,
        use_feedparser=args.use_feedparser,
        use_atom=args.use_atom,
        max_retries=args.max_retries
    )

    success = importer.fetch_and_reformat()

    # Use extracted title if not provided
    title = args.title if args.title else importer.feed_title

    if success:
        print(f"✓ {title} RSS imported successfully!")
    else:
        print(f"✗ Failed to import {title} RSS")

    return 0 if success else 1


if __name__ == "__main__":
    sys.exit(main())
