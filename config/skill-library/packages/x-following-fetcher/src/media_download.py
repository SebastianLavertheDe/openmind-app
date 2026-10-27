from __future__ import annotations

import subprocess
from shutil import which
from pathlib import Path

import requests

from .config import AppConfig
from .models import Tweet


def _extension_for(media_content_type: str, media_url: str) -> str:
    lowered_type = media_content_type.lower()
    lowered_url = media_url.lower()
    if "mp4" in lowered_type or ".mp4" in lowered_url:
        return ".mp4"
    if "mpegurl" in lowered_type or ".m3u8" in lowered_url:
        return ".m3u8"
    return ".bin"


def _download_file(source_url: str, destination: Path) -> bool:
    destination.parent.mkdir(parents=True, exist_ok=True)
    temp_path = destination.with_suffix(destination.suffix + ".part")
    try:
        temp_path.unlink()
    except FileNotFoundError:
        pass
    try:
        response = requests.get(
            source_url,
            headers={
                "User-Agent": (
                    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36"
                ),
                "Referer": "https://x.com/",
                "Origin": "https://x.com",
            },
            stream=True,
            timeout=(15, 240),
        )
        response.raise_for_status()
        with temp_path.open("wb") as output:
            for chunk in response.iter_content(chunk_size=1024 * 256):
                if chunk:
                    output.write(chunk)
        temp_path.replace(destination)
        return True
    except (OSError, TimeoutError, requests.RequestException):
        try:
            temp_path.unlink()
        except FileNotFoundError:
            pass
        return False


def _thumbnail_path_for(video_path: Path) -> Path:
    return video_path.with_suffix(".jpg")


def _generate_video_thumbnail(video_path: Path) -> bool:
    ffmpeg_bin = which("ffmpeg")
    if ffmpeg_bin is None or not video_path.exists():
        return False

    thumbnail_path = _thumbnail_path_for(video_path)
    temp_thumbnail_path = thumbnail_path.with_name(f"{thumbnail_path.stem}.part{thumbnail_path.suffix}")
    try:
        temp_thumbnail_path.unlink()
    except FileNotFoundError:
        pass

    try:
        result = subprocess.run(
            [
                ffmpeg_bin,
                "-y",
                "-hide_banner",
                "-loglevel",
                "error",
                "-i",
                str(video_path),
                "-frames:v",
                "1",
                "-q:v",
                "2",
                str(temp_thumbnail_path),
            ],
            capture_output=True,
            text=True,
            timeout=120,
            check=False,
        )
        if result.returncode != 0 or not temp_thumbnail_path.exists():
            raise RuntimeError(result.stderr.strip() or f"ffmpeg exited with {result.returncode}")
        temp_thumbnail_path.replace(thumbnail_path)
        return True
    except (OSError, TimeoutError, RuntimeError, subprocess.TimeoutExpired):
        try:
            temp_thumbnail_path.unlink()
        except FileNotFoundError:
            pass
        return False


def cache_tweet_videos(date_dir: Path, tweets: list[Tweet], config: AppConfig) -> None:
    if config.storage is None or not config.render.include_images:
        return

    for tweet in tweets:
        video_index = 0
        for media in tweet.media:
            if media.media_type not in {"video", "animated_gif"}:
                continue
            if not media.stream_url:
                continue

            video_index += 1
            extension = _extension_for(media.stream_content_type, media.stream_url)
            relative_path = Path(config.storage.video_subdir) / f"{tweet.tweet_id}_{video_index:02d}{extension}"
            absolute_path = date_dir / relative_path

            if absolute_path.exists() and absolute_path.stat().st_size <= 0:
                absolute_path.unlink()
            if absolute_path.exists() and absolute_path.stat().st_size > 0:
                media.local_path = relative_path.as_posix()
                continue

            if _download_file(media.stream_url, absolute_path):
                _generate_video_thumbnail(absolute_path)
                media.local_path = relative_path.as_posix()
