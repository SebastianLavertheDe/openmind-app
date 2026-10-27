"""
OPML Parser - Parse OPML files to extract RSS feed subscriptions
"""

import os
import xml.etree.ElementTree as ET
from pathlib import Path
from typing import List
from dataclasses import dataclass


@dataclass
class RSSFeed:
    """RSS feed subscription"""

    text: str
    title: str
    url: str
    type: str = "rss"
    category: str = "article"
    source_opml: str = ""


class OPMLParser:
    """Parse OPML files to extract RSS feed subscriptions"""

    def __init__(self, opml_file: str = "subscriptions.opml"):
        if opml_file.startswith(("http://", "https://")):
            self.opml_file = opml_file
        else:
            self.opml_file = str(Path(opml_file).expanduser().resolve())

    def parse(self) -> List[RSSFeed]:
        """
        Parse OPML file and extract RSS feed subscriptions

        Returns:
            List of RSSFeed objects
        """
        if not os.path.exists(self.opml_file):
            raise FileNotFoundError(f"OPML file not found: {self.opml_file}")

        feeds = []

        try:
            tree = ET.parse(self.opml_file)
            root = tree.getroot()

            all_outlines = root.findall(".//outline[@xmlUrl]")

            for outline in all_outlines:
                text = outline.get("text", "")
                title = outline.get("title", text)
                url = outline.get("xmlUrl", "")
                feed_type = outline.get("type", "rss")
                feed_category = outline.get("category", "article")

                if url:
                    feeds.append(
                        RSSFeed(
                            text=text,
                            title=title,
                            url=url,
                            type=feed_type,
                            category=feed_category,
                            source_opml=self.opml_file,
                        )
                    )

            print(f"Loaded {len(feeds)} RSS feeds from {self.opml_file}")

            if not feeds:
                print(f"Warning: No RSS feeds found in {self.opml_file}")

            return feeds

        except ET.ParseError as e:
            print(f"Error parsing OPML file: {e}")
            return []
        except Exception as e:
            print(f"Error reading OPML file: {e}")
            return []
