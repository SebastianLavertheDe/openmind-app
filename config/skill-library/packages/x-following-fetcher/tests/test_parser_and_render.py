import os
import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from src.config import AppConfig, CompatConfig, FetchConfig, RenderConfig, StorageConfig, load_config
from src.media_download import cache_tweet_videos
from src.media_enrichment import enrich_tweet_media
from src.models import Author, Media, Tweet, UrlEntity
from src.parser.timeline import parse_timeline_payload
from src.render.html import render_timeline_html, render_tweet_html
from src.render.markdown import render_tweet_markdown
from src.storage.cache import PostCache
from src.storage.files import save_new_tweets
from src.runtime_paths import write_artifact_report


class TimelineParserTests(unittest.TestCase):
    def test_parse_visibility_note_tweet_and_filter_promoted(self):
        payload = {
            "data": {
                "home": {
                    "home_timeline_urt": {
                        "instructions": [
                            {
                                "type": "TimelineAddEntries",
                                "entries": [
                                    {
                                        "content": {
                                            "__typename": "TimelineTimelineItem",
                                            "itemContent": {
                                                "__typename": "TimelineTimelineItemContent",
                                                "tweet_results": {
                                                    "result": {
                                                        "__typename": "TweetWithVisibilityResults",
                                                        "tweet": {
                                                            "core": {
                                                                "user_results": {
                                                                    "result": {
                                                                        "core": {
                                                                            "name": "Visible User",
                                                                            "screen_name": "visible_user",
                                                                        }
                                                                    }
                                                                }
                                                            },
                                                            "legacy": {
                                                                "id_str": "123",
                                                                "created_at": "Wed Mar 26 08:00:16 +0000 2026",
                                                                "full_text": "fallback https://t.co/short",
                                                                "lang": "en",
                                                                "favorite_count": 1,
                                                                "retweet_count": 2,
                                                                "reply_count": 3,
                                                                "quote_count": 4,
                                                                "bookmark_count": 5,
                                                                "entities": {
                                                                    "urls": [
                                                                        {
                                                                            "url": "https://t.co/short",
                                                                            "expanded_url": "https://example.com/full",
                                                                            "display_url": "example.com/full",
                                                                        }
                                                                    ]
                                                                },
                                                                "extended_entities": {
                                                                    "media": [
                                                                        {
                                                                            "type": "photo",
                                                                            "media_url_https": "https://img.example/photo.jpg",
                                                                            "url": "https://t.co/media1",
                                                                            "expanded_url": "https://x.com/media1",
                                                                            "display_url": "pic.x.com/media1",
                                                                        }
                                                                    ]
                                                                },
                                                            },
                                                        },
                                                        "note_tweet": {
                                                            "note_tweet_results": {
                                                                "result": {
                                                                    "text": "Long note body https://t.co/short",
                                                                    "entity_set": {
                                                                        "urls": [
                                                                            {
                                                                                "url": "https://t.co/short",
                                                                                "expanded_url": "https://example.com/full",
                                                                                "display_url": "example.com/full",
                                                                            }
                                                                        ]
                                                                    },
                                                                }
                                                            }
                                                        },
                                                    }
                                                },
                                            },
                                        }
                                    },
                                    {
                                        "content": {
                                            "__typename": "TimelineTimelineItem",
                                            "itemContent": {
                                                "__typename": "TimelineTimelineItemContent",
                                                "promotedMetadata": {"advertiser_results": {}},
                                                "tweet_results": {
                                                    "result": {
                                                        "__typename": "Tweet",
                                                        "legacy": {"id_str": "999"}
                                                    }
                                                },
                                            },
                                        }
                                    },
                                ],
                            }
                        ]
                    }
                }
            }
        }

        tweets = parse_timeline_payload(payload, include_promoted=False)
        self.assertEqual(len(tweets), 1)

        tweet = tweets[0]
        self.assertEqual(tweet.author.screen_name, "visible_user")
        self.assertEqual(tweet.content, "Long note body https://t.co/short")
        self.assertEqual(tweet.link, "https://x.com/visible_user/status/123")
        self.assertEqual(len(tweet.media), 1)
        self.assertEqual(tweet.url_entities[0].expanded_url, "https://example.com/full")

    def test_parse_retweet_and_quote(self):
        payload = {
            "data": {
                "home": {
                    "home_timeline_urt": {
                        "instructions": [
                            {
                                "type": "TimelineAddEntries",
                                "entries": [
                                    {
                                        "content": {
                                            "__typename": "TimelineTimelineItem",
                                            "itemContent": {
                                                "__typename": "TimelineTimelineItemContent",
                                                "tweet_results": {
                                                    "result": {
                                                        "__typename": "Tweet",
                                                        "core": {
                                                            "user_results": {
                                                                "result": {
                                                                    "core": {
                                                                        "name": "Sharer",
                                                                        "screen_name": "sharer",
                                                                    }
                                                                }
                                                            }
                                                        },
                                                        "legacy": {
                                                            "id_str": "555",
                                                            "created_at": "Wed Mar 26 08:00:16 +0000 2026",
                                                            "full_text": "RT @source: short retweet wrapper",
                                                            "lang": "en",
                                                            "favorite_count": 0,
                                                            "retweet_count": 0,
                                                            "reply_count": 0,
                                                            "quote_count": 0,
                                                            "bookmark_count": 0,
                                                            "retweeted_status_result": {
                                                                "result": {
                                                                    "__typename": "Tweet",
                                                                    "core": {
                                                                        "user_results": {
                                                                            "result": {
                                                                                "core": {
                                                                                    "name": "Source Author",
                                                                                    "screen_name": "source_author",
                                                                                }
                                                                            }
                                                                        }
                                                                    },
                                                                    "legacy": {
                                                                        "id_str": "556",
                                                                        "created_at": "Wed Mar 26 07:00:00 +0000 2026",
                                                                        "full_text": "Original retweeted post",
                                                                    },
                                                                }
                                                            },
                                                        },
                                                        "quoted_status_result": {
                                                            "result": {
                                                                "__typename": "Tweet",
                                                                "core": {
                                                                    "user_results": {
                                                                        "result": {
                                                                            "core": {
                                                                                "name": "Quoted Author",
                                                                                "screen_name": "quoted_author",
                                                                            }
                                                                        }
                                                                    }
                                                                },
                                                                "legacy": {
                                                                    "id_str": "557",
                                                                    "created_at": "Wed Mar 26 06:00:00 +0000 2026",
                                                                    "full_text": "Quoted content",
                                                                },
                                                            }
                                                        },
                                                    }
                                                },
                                            },
                                        }
                                    }
                                ],
                            }
                        ]
                    }
                }
            }
        }

        tweets = parse_timeline_payload(payload)
        self.assertEqual(len(tweets), 1)

        tweet = tweets[0]
        self.assertTrue(tweet.is_retweet)
        self.assertIsNotNone(tweet.retweeted_tweet)
        self.assertEqual(tweet.retweeted_tweet.author_screen_name, "source_author")
        self.assertIsNotNone(tweet.quoted_tweet)
        self.assertEqual(tweet.quoted_tweet.author_screen_name, "quoted_author")


class MarkdownRenderTests(unittest.TestCase):
    def test_render_replaces_urls_and_renders_quote(self):
        payload = {
            "data": {
                "home": {
                    "home_timeline_urt": {
                        "instructions": [
                            {
                                "type": "TimelineAddEntries",
                                "entries": [
                                    {
                                        "content": {
                                            "__typename": "TimelineTimelineItem",
                                            "itemContent": {
                                                "__typename": "TimelineTimelineItemContent",
                                                "tweet_results": {
                                                    "result": {
                                                        "__typename": "Tweet",
                                                        "core": {
                                                            "user_results": {
                                                                "result": {
                                                                    "core": {
                                                                        "name": "Author",
                                                                        "screen_name": "author",
                                                                    }
                                                                }
                                                            }
                                                        },
                                                        "legacy": {
                                                            "id_str": "700",
                                                            "created_at": "Wed Mar 26 08:00:16 +0000 2026",
                                                            "full_text": "Body https://t.co/short https://t.co/media1",
                                                            "lang": "en",
                                                            "favorite_count": 1,
                                                            "retweet_count": 2,
                                                            "reply_count": 3,
                                                            "quote_count": 4,
                                                            "bookmark_count": 5,
                                                            "entities": {
                                                                "urls": [
                                                                    {
                                                                        "url": "https://t.co/short",
                                                                        "expanded_url": "https://example.com/full",
                                                                        "display_url": "example.com/full",
                                                                    }
                                                                ],
                                                                "media": [
                                                                    {
                                                                        "url": "https://t.co/media1",
                                                                        "expanded_url": "https://x.com/media1",
                                                                        "display_url": "pic.x.com/media1",
                                                                    }
                                                                ],
                                                            },
                                                            "extended_entities": {
                                                                "media": [
                                                                    {
                                                                        "type": "video",
                                                                        "media_url_https": "https://img.example/video.jpg",
                                                                        "expanded_url": "https://x.com/video1",
                                                                        "display_url": "pic.x.com/video1",
                                                                    }
                                                                ]
                                                            },
                                                        },
                                                        "quoted_status_result": {
                                                            "result": {
                                                                "__typename": "Tweet",
                                                                "core": {
                                                                    "user_results": {
                                                                        "result": {
                                                                            "core": {
                                                                                "name": "Quoted",
                                                                                "screen_name": "quoted",
                                                                            }
                                                                        }
                                                                    }
                                                                },
                                                                "legacy": {
                                                                    "id_str": "701",
                                                                    "created_at": "Wed Mar 26 07:00:00 +0000 2026",
                                                                    "full_text": "Quoted body",
                                                                },
                                                            }
                                                        },
                                                    }
                                                },
                                            },
                                        }
                                    }
                                ],
                            }
                        ]
                    }
                }
            }
        }

        tweet = parse_timeline_payload(payload)[0]
        tweet.fetched_at = "2026-03-26T08:10:00+00:00"
        markdown = render_tweet_markdown(tweet, RenderConfig())

        self.assertIn("https://example.com/full", markdown)
        self.assertNotIn("https://t.co/media1", markdown)
        self.assertIn("## 媒体", markdown)
        self.assertIn("## 引用内容", markdown)
        self.assertIn("Quoted body", markdown)

    def test_render_html_outputs_x_like_layout(self):
        payload = {
            "data": {
                "home": {
                    "home_timeline_urt": {
                        "instructions": [
                            {
                                "type": "TimelineAddEntries",
                                "entries": [
                                    {
                                        "content": {
                                            "__typename": "TimelineTimelineItem",
                                            "itemContent": {
                                                "__typename": "TimelineTimelineItemContent",
                                                "tweet_results": {
                                                    "result": {
                                                        "__typename": "Tweet",
                                                        "core": {
                                                            "user_results": {
                                                                "result": {
                                                                    "core": {
                                                                        "name": "Author",
                                                                        "screen_name": "author",
                                                                    },
                                                                    "avatar": {
                                                                        "image_url": "https://img.example/avatar.jpg"
                                                                    },
                                                                }
                                                            }
                                                        },
                                                        "legacy": {
                                                            "id_str": "800",
                                                            "created_at": "Wed Mar 26 08:00:16 +0000 2026",
                                                            "full_text": "Body text https://t.co/short",
                                                            "favorite_count": 12,
                                                            "retweet_count": 34,
                                                            "reply_count": 56,
                                                            "quote_count": 7,
                                                            "bookmark_count": 0,
                                                            "entities": {
                                                                "urls": [
                                                                    {
                                                                        "url": "https://t.co/short",
                                                                        "expanded_url": "https://example.com/full",
                                                                        "display_url": "example.com/full",
                                                                    }
                                                                ]
                                                            },
                                                            "extended_entities": {
                                                                "media": [
                                                                    {
                                                                        "type": "photo",
                                                                        "media_url_https": "https://img.example/photo.jpg",
                                                                        "expanded_url": "https://x.com/photo1",
                                                                        "display_url": "pic.x.com/photo1",
                                                                    }
                                                                ]
                                                            },
                                                        },
                                                    }
                                                },
                                            },
                                        }
                                    }
                                ],
                            }
                        ]
                    }
                }
            }
        }

        tweet = parse_timeline_payload(payload)[0]
        tweet.fetched_at = "2026-03-26T08:10:00+00:00"

        detail_html = render_tweet_html(tweet, RenderConfig())
        timeline_html = render_timeline_html([tweet], RenderConfig(), date_label="20260326", output_dir=Path("/tmp/20260326"))

        self.assertIn("tweet-card", detail_html)
        self.assertIn("media-grid", detail_html)
        self.assertIn("js-lightbox-trigger", detail_html)
        self.assertIn("tweet-lightbox", detail_html)
        self.assertIn("https://example.com/full", detail_html)
        self.assertIn('data-fullsrc="https://img.example/photo.jpg"', detail_html)
        self.assertIn("X-like Timeline Frontend", timeline_html)
        self.assertIn("lightbox", timeline_html)
        self.assertIn("https://x.com/author/status/800", timeline_html)

    def test_render_html_embeds_click_to_play_video(self):
        payload = {
            "data": {
                "home": {
                    "home_timeline_urt": {
                        "instructions": [
                            {
                                "type": "TimelineAddEntries",
                                "entries": [
                                    {
                                        "content": {
                                            "__typename": "TimelineTimelineItem",
                                            "itemContent": {
                                                "__typename": "TimelineTimelineItemContent",
                                                "tweet_results": {
                                                    "result": {
                                                        "__typename": "Tweet",
                                                        "core": {
                                                            "user_results": {
                                                                "result": {
                                                                    "core": {
                                                                        "name": "Author",
                                                                        "screen_name": "author",
                                                                    }
                                                                }
                                                            }
                                                        },
                                                        "legacy": {
                                                            "id_str": "801",
                                                            "created_at": "Wed Mar 26 08:00:16 +0000 2026",
                                                            "full_text": "Body text",
                                                            "extended_entities": {
                                                                "media": [
                                                                    {
                                                                        "type": "video",
                                                                        "media_url_https": "https://img.example/video.jpg",
                                                                        "expanded_url": "https://x.com/author/status/801/video/1",
                                                                        "display_url": "pic.x.com/video1",
                                                                        "original_info": {
                                                                            "width": 1280,
                                                                            "height": 720,
                                                                        },
                                                                        "video_info": {
                                                                            "duration_millis": 12345,
                                                                            "variants": [
                                                                                {
                                                                                    "content_type": "application/x-mpegURL",
                                                                                    "url": "https://video.example/video.m3u8",
                                                                                },
                                                                                {
                                                                                    "bitrate": 832000,
                                                                                    "content_type": "video/mp4",
                                                                                    "url": "https://video.example/video-832.mp4",
                                                                                },
                                                                                {
                                                                                    "bitrate": 2176000,
                                                                                    "content_type": "video/mp4",
                                                                                    "url": "https://video.example/video-2176.mp4",
                                                                                },
                                                                            ],
                                                                        },
                                                                    }
                                                                ]
                                                            },
                                                        },
                                                    }
                                                },
                                            },
                                        }
                                    }
                                ],
                            }
                        ]
                    }
                }
            }
        }

        tweet = parse_timeline_payload(payload)[0]
        tweet.media[0].local_path = "videos/video-832.mp4"
        timeline_html = render_timeline_html([tweet], RenderConfig(), date_label="20260326", output_dir=Path("/tmp/20260326"))

        self.assertEqual(tweet.media[0].stream_url, "https://video.example/video-832.mp4")
        self.assertIn("js-video-trigger", timeline_html)
        self.assertIn('data-stream-src="videos/video-832.mp4"', timeline_html)
        self.assertIn("inline-video", timeline_html)

    def test_render_html_hides_duplicate_title_when_content_starts_with_title(self):
        tweet = Tweet(
            tweet_id="802",
            author=Author(name="Author", screen_name="author"),
            title="它来了它来了。一百多个图例，6000 多精选矢量图标，一句话就可以根据你的 Markdown 内容自动定制。",
            content=(
                "它来了它来了。一百多个图例，6000 多精选矢量图标，一句话就可以根据你的 Markdown 内容自动定制。\n\n"
                "包括架构图、流程图、工作流图、状态图。"
            ),
            created_at="2026-03-26T08:00:16+00:00",
            link="https://x.com/author/status/802",
        )

        timeline_html = render_timeline_html([tweet], RenderConfig(), date_label="20260326", output_dir=Path("/tmp/20260326"))

        self.assertNotIn('<h1 class="tweet-title">', timeline_html)
        self.assertIn("tweet-content", timeline_html)
        self.assertEqual(timeline_html.count("它来了它来了"), 1)


class MediaEnrichmentTests(unittest.TestCase):
    @patch("src.media_enrichment.urlopen")
    def test_enrich_tweet_media_backfills_video_stream(self, mock_urlopen):
        class _Response:
            def __enter__(self):
                return self

            def __exit__(self, exc_type, exc, tb):
                return False

            def read(self):
                return (
                    b'{"tweet":{"media":{"all":[{"type":"video","url":"https://video.example/video-2176.mp4",'
                    b'"thumbnail_url":"https://img.example/video.jpg","duration":76.833,"width":1920,"height":1080,'
                    b'"variants":[{"url":"https://video.example/video-832.mp4","bitrate":832000,"content_type":"video/mp4"},'
                    b'{"url":"https://video.example/video-2176.mp4","bitrate":2176000,"content_type":"video/mp4"}]}]}}}'
                )

        mock_urlopen.return_value = _Response()

        tweet = Tweet(
            tweet_id="900",
            author=Author(name="Video Author", screen_name="video_author"),
            content="Body",
            created_at="2026-03-26T08:00:16+00:00",
            link="https://x.com/video_author/status/900",
        )
        tweet.media.append(
            Media(
                media_type="video",
                url="https://img.example/original.jpg",
                expanded_url="https://x.com/video_author/status/900/video/1",
                display_url="pic.x.com/video1",
            )
        )

        enrich_tweet_media(tweet)

        self.assertEqual(tweet.media[0].stream_url, "https://video.example/video-832.mp4")
        self.assertEqual(tweet.media[0].stream_content_type, "video/mp4")
        self.assertEqual(tweet.media[0].url, "https://img.example/video.jpg")
        self.assertEqual(tweet.media[0].duration_millis, 76833)


class MediaDownloadTests(unittest.TestCase):
    @patch("src.media_download.requests.get")
    @patch("src.media_download.subprocess.run")
    @patch("src.media_download.which", return_value="/usr/bin/ffmpeg")
    def test_cache_tweet_videos_writes_to_separate_directory(self, mock_which, mock_run, mock_get):
        with tempfile.TemporaryDirectory() as tempdir:
            date_dir = Path(tempdir) / "20260326"
            date_dir.mkdir(parents=True, exist_ok=True)
            response = MagicMock()
            response.iter_content.return_value = [b"fake video bytes"]
            mock_get.return_value = response

            def _fake_run(*args, **kwargs):
                command = args[0]
                if command[0] == "/usr/bin/ffmpeg":
                    target_thumbnail_file = Path(command[-1])
                    target_thumbnail_file.parent.mkdir(parents=True, exist_ok=True)
                    target_thumbnail_file.write_bytes(b"fake thumbnail bytes")
                else:
                    raise AssertionError(f"Unexpected command: {command}")

                class _Result:
                    returncode = 0
                    stderr = ""

                return _Result()

            mock_run.side_effect = _fake_run
            config = AppConfig(
                storage=StorageConfig(
                    output_dir=Path(tempdir) / "out",
                    cache_file=Path(tempdir) / "posted_ids.json",
                    article_output_dir=Path(tempdir) / "article",
                    video_subdir="videos",
                )
            )
            tweet = Tweet(
                tweet_id="901",
                author=Author(name="Video Author", screen_name="video_author"),
                content="Body",
                created_at="2026-03-26T08:00:16+00:00",
                link="https://x.com/video_author/status/901",
                media=[
                    Media(
                        media_type="video",
                        url="https://img.example/thumb.jpg",
                        stream_url="https://video.example/video.mp4",
                        stream_content_type="video/mp4",
                    )
                ],
            )

            cache_tweet_videos(date_dir, [tweet], config)

            self.assertEqual(tweet.media[0].local_path, "videos/901_01.mp4")
            self.assertTrue((date_dir / "videos" / "901_01.mp4").exists())
            self.assertTrue((date_dir / "videos" / "901_01.jpg").exists())

    @patch("src.media_download.requests.get")
    @patch("src.media_download.subprocess.run")
    @patch("src.media_download.which", return_value=None)
    def test_cache_tweet_videos_skips_thumbnail_when_ffmpeg_missing(self, mock_which, mock_run, mock_get):
        with tempfile.TemporaryDirectory() as tempdir:
            date_dir = Path(tempdir) / "20260326"
            date_dir.mkdir(parents=True, exist_ok=True)
            response = MagicMock()
            response.iter_content.return_value = [b"fake video bytes"]
            mock_get.return_value = response
            config = AppConfig(
                storage=StorageConfig(
                    output_dir=Path(tempdir) / "out",
                    cache_file=Path(tempdir) / "posted_ids.json",
                    article_output_dir=Path(tempdir) / "article",
                    video_subdir="videos",
                )
            )
            tweet = Tweet(
                tweet_id="901",
                author=Author(name="Video Author", screen_name="video_author"),
                content="Body",
                created_at="2026-03-26T08:00:16+00:00",
                link="https://x.com/video_author/status/901",
                media=[
                    Media(
                        media_type="video",
                        url="https://img.example/thumb.jpg",
                        stream_url="https://video.example/video.mp4",
                        stream_content_type="video/mp4",
                    )
                ],
            )

            cache_tweet_videos(date_dir, [tweet], config)

            self.assertEqual(tweet.media[0].local_path, "videos/901_01.mp4")
            self.assertTrue((date_dir / "videos" / "901_01.mp4").exists())
            self.assertFalse((date_dir / "videos" / "901_01.jpg").exists())


class DailyBundleStorageTests(unittest.TestCase):
    def test_load_config_resolves_output_dir_from_repo_root(self):
        Path(os.environ["OPENMIND_ROOT"]).mkdir(parents=True, exist_ok=True)
        config = load_config(ROOT / "config.yaml")

        bound_root = Path(os.environ["OPENMIND_ROOT"])
        skill_data_dir = Path(os.environ["OPENMIND_SKILL_DATA_DIR"])
        self.assertEqual(config.storage.output_dir, bound_root / "post")
        self.assertEqual(config.storage.article_output_dir, bound_root / "article")
        self.assertEqual(config.compat.curl_files, [
            skill_data_dir / "curl.txt",
            skill_data_dir / "curl_foryou.txt",
        ])

    def test_save_new_tweets_writes_daily_bundle_files(self):
        with tempfile.TemporaryDirectory() as tempdir:
            base = Path(tempdir)
            config = AppConfig(
                fetch=FetchConfig(),
                render=RenderConfig(),
                storage=StorageConfig(
                    output_dir=base / "out",
                    cache_file=base / "posted_ids.json",
                    article_output_dir=base / "article",
                    daily_json_filename="posts.json",
                    daily_html_filename="index.html",
                    daily_markdown_filename="timeline.md",
                    write_daily_markdown=False,
                ),
                compat=CompatConfig(curl_file=base / "curl.txt"),
            )
            cache = PostCache(config.storage.cache_file)
            tweet = Tweet(
                tweet_id="900",
                author=Author(name="Bundle Author", screen_name="bundle_author"),
                content="Daily bundle body",
                created_at="2026-03-26T08:00:16+00:00",
                link="https://x.com/bundle_author/status/900",
            )

            reported: list[tuple[str, Path]] = []
            new_count, total_count = save_new_tweets(
                [tweet],
                config,
                cache,
                on_artifact=lambda declaration_id, artifact_path: reported.append(
                    (declaration_id, artifact_path)
                ),
            )

            date_dirs = list(config.storage.output_dir.iterdir())
            self.assertEqual(len(date_dirs), 1)
            date_dir = date_dirs[0]
            self.assertEqual(new_count, 1)
            self.assertEqual(total_count, 1)
            self.assertTrue((date_dir / "posts.json").exists())
            self.assertTrue((date_dir / "index.html").exists())
            self.assertFalse((date_dir / "900.html").exists())
            self.assertEqual(reported, [("x-posts", date_dir)])

    def test_write_artifact_report_is_atomic_and_run_scoped(self):
        with tempfile.TemporaryDirectory() as tempdir:
            run_dir = Path(tempdir) / "run"
            run_dir.mkdir()
            report_path = run_dir / "artifacts.json"
            previous = os.environ.get("OPENMIND_ARTIFACT_REPORT_PATH")
            os.environ["OPENMIND_ARTIFACT_REPORT_PATH"] = str(report_path)
            try:
                write_artifact_report(
                    run_dir,
                    [{"declarationId": "x-posts", "logicalPath": "post/20260824"}],
                )
            finally:
                if previous is None:
                    os.environ.pop("OPENMIND_ARTIFACT_REPORT_PATH", None)
                else:
                    os.environ["OPENMIND_ARTIFACT_REPORT_PATH"] = previous

            self.assertEqual(
                json.loads(report_path.read_text(encoding="utf-8")),
                {
                    "schemaVersion": 1,
                    "artifacts": [
                        {"declarationId": "x-posts", "logicalPath": "post/20260824"}
                    ],
                },
            )
            self.assertFalse(any(run_dir.glob(".artifacts.json.tmp-*")))

    @patch("src.storage.files._extract_external_articles")
    def test_save_new_tweets_saves_extracted_external_articles_to_article_dir(self, mock_extract):
        with tempfile.TemporaryDirectory() as tempdir:
            base = Path(tempdir)
            config = AppConfig(
                fetch=FetchConfig(),
                render=RenderConfig(),
                storage=StorageConfig(
                    output_dir=base / "out",
                    cache_file=base / "posted_ids.json",
                    article_output_dir=base / "article",
                    save_external_link_posts_to_article=True,
                ),
                compat=CompatConfig(curl_file=base / "curl.txt"),
            )
            cache = PostCache(config.storage.cache_file)
            mock_extract.return_value = {
                "https://example.com/articles/123": {
                    "url": "https://example.com/articles/123",
                    "title": "Example Article",
                    "author": "Example Author",
                    "published_date": "2026-03-20 12:00:00",
                    "content": "Real article body",
                }
            }
            tweet = Tweet(
                tweet_id="901",
                author=Author(name="Link Author", screen_name="link_author"),
                content="Worth reading https://t.co/ext",
                created_at="2026-03-26T08:00:16+00:00",
                link="https://x.com/link_author/status/901",
                url_entities=[
                    UrlEntity(
                        url="https://t.co/ext",
                        expanded_url="https://example.com/articles/123",
                        display_url="example.com/articles/123",
                    )
                ],
            )

            save_new_tweets([tweet], config, cache)

            article_dirs = list(config.storage.article_output_dir.iterdir())
            self.assertEqual(len(article_dirs), 1)
            article_files = list(article_dirs[0].glob("x_901_*.md"))
            self.assertEqual(len(article_files), 1)
            content = article_files[0].read_text(encoding="utf-8")
            self.assertIn("# Example Article", content)
            self.assertIn("https://example.com/articles/123", content)
            self.assertIn("## 正文", content)
            self.assertIn("Real article body", content)
            self.assertIn("## 元数据", content)
            self.assertIn("**来源推文**", content)


if __name__ == "__main__":
    unittest.main()
