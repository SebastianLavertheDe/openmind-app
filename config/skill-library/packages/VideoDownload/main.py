#!/usr/bin/env python3
"""
Video Download Skill - Downloads videos and extracts text content
"""

import os
import re
import sys
import json
import argparse
import shutil
import subprocess
from pathlib import Path
from typing import Optional, Dict, Any

# Whisper invokes ffmpeg by name. Expose only the App-resolved tool directory,
# without depending on the host shell's PATH in a managed Process Skill.
if os.environ.get("OPENMIND_SHARED_PYTHON") == "1" and os.environ.get("OPENMIND_MEDIA_FFMPEG"):
    os.environ["PATH"] = str(Path(os.environ["OPENMIND_MEDIA_FFMPEG"]).parent)


class VideoDownloader:
    def __init__(self, output_dir: Path, output_name: str = ""):
        if not output_dir.is_absolute():
            raise ValueError("--output must be an absolute Export Location path")
        self.video_dir = output_dir.resolve()
        self.video_dir.mkdir(parents=True, exist_ok=True)
        self.output_name = output_name.strip()

    @staticmethod
    def yt_dlp_command() -> list[str]:
        command = os.environ.get("OPENMIND_MEDIA_YTDLP", "").strip()
        if command: return [command]
        # Run the installed module through the managed interpreter; uv console
        # launchers can embed the temporary environment's pre-rename path.
        if os.environ.get("OPENMIND_SHARED_PYTHON") == "1": return [sys.executable, "-m", "yt_dlp"]
        command = shutil.which("yt-dlp")
        if not command: raise RuntimeError("Prepare yt-dlp in the managed Python or video runtime.")
        return [command]

    def sanitize_filename(self, filename: str) -> str:
        """Sanitize filename for safe file system usage"""
        # Remove invalid characters and replace with underscore
        filename = re.sub(r'[<>:"/\\|?*]', '_', filename)
        # Remove control characters
        filename = re.sub(r'[\x00-\x1f\x7f-\x9f]', '', filename)
        # Limit length
        if len(filename) > 100:
            filename = filename[:100]
        return filename.strip()

    def extract_youtube_url(self, input_text: str) -> Optional[str]:
        """Extract and validate YouTube URL from input text"""
        # YouTube URL patterns
        youtube_patterns = [
            r'https?://(?:www\.)?youtube\.com/watch\?v=[\w-]+',
            r'https?://youtu\.be/[\w-]+',
            r'https?://(?:www\.)?youtube\.com/embed/[\w-]+',
            r'https?://(?:www\.)?youtube\.com/v/[\w-]+',
            r'https?://(?:www\.)?youtube\.com/shorts/[\w-]+'
        ]

        for pattern in youtube_patterns:
            match = re.search(pattern, input_text)
            if match:
                url = match.group(0)
                print(f"✓ Found YouTube URL: {url}")
                return url

        return None

    def validate_url(self, url: str) -> bool:
        """Validate if URL is a supported video URL"""
        if not url.startswith(('http://', 'https://')):
            return False

        # Check if it's a YouTube URL
        if 'youtube.com' in url or 'youtu.be' in url:
            return True

        # For other platforms, let yt-dlp handle validation
        return True

    def check_dependencies(self) -> bool:
        """Check if required dependencies are installed"""
        try:
            subprocess.run([*self.yt_dlp_command(), '--version'], capture_output=True, check=True)
            print("✓ yt-dlp is installed")
        except (RuntimeError, subprocess.CalledProcessError, FileNotFoundError):
            print("❌ yt-dlp not found. Install with: uv add yt-dlp")
            return False

        try:
            import whisper
            print("✓ whisper is available")
        except ImportError:
            print("❌ whisper not found. Install with: uv add openai-whisper")
            return False

        return True

    def get_video_info(self, url: str) -> Optional[Dict[str, Any]]:
        """Get video information without downloading"""
        try:
            cmd = [
                *self.yt_dlp_command(),
                '--no-download',
                '--print-json',
                url
            ]
            result = subprocess.run(cmd, capture_output=True, text=True, check=True)
            return json.loads(result.stdout)
        except subprocess.CalledProcessError as e:
            print(f"Error getting video info: {e.stderr}")
            return None

    def download_video(self, url: str, output_dir: Path) -> Optional[Path]:
        """Download video to specified directory"""
        try:
            output_template = str(output_dir / "%(title)s.%(ext)s")

            cmd = [
                *self.yt_dlp_command(),
                '--format', 'best[ext=mp4]/best',  # Prefer mp4 format
                '--output', output_template,
                '--no-playlist',  # Download single video only
                url
            ]

            result = subprocess.run(cmd, capture_output=True, text=True, check=True)

            # Extract filename from output
            if result.stdout:
                # Find the downloaded file path in yt-dlp output
                lines = result.stdout.split('\n')
                for line in lines:
                    if line.endswith('.mp4') and os.path.exists(line):
                        return Path(line)

            # Fallback: look for mp4 files in output directory
            mp4_files = list(output_dir.glob('*.mp4'))
            if mp4_files:
                return mp4_files[0]

        except subprocess.CalledProcessError as e:
            print(f"Error downloading video: {e.stderr}")

        return None

    def extract_subtitles(self, url: str, output_dir: Path) -> Optional[str]:
        """Extract subtitles from video"""
        try:

            cmd = [
                *self.yt_dlp_command(),
                '--write-subs',
                '--write-auto-subs',
                '--sub-langs', 'en,zh,zh-cn,zh-tw',  # Priority languages
                '--skip-download',
                '--output', str(output_dir / "subtitles"),
                url
            ]

            subprocess.run(cmd, capture_output=True, text=True, check=True)

            # Check for subtitle files
            for ext in ['.srt', '.vtt']:
                for file_path in output_dir.glob(f'subtitles*{ext}'):
                    with open(file_path, 'r', encoding='utf-8') as f:
                        content = f.read()
                    # Clean up subtitle file
                    file_path.unlink()
                    return content

        except subprocess.CalledProcessError as e:
            print(f"Subtitle extraction failed: {e.stderr}")

        return None

    def transcribe_audio(self, video_path: Path) -> Optional[str]:
        """Transcribe audio from video using whisper"""
        try:
            import whisper

            print("Loading Whisper model...")
            model = whisper.load_model("base")

            print(f"Transcribing audio from {video_path.name}...")
            result = model.transcribe(str(video_path))

            if result and 'text' in result:
                return result['text']

        except Exception as e:
            print(f"Audio transcription failed: {e}")

        return None

    def format_subtitles_md(self, content: str, video_info: Dict[str, Any]) -> str:
        """Format subtitle content as markdown"""
        md_content = []

        # Header
        md_content.append(f"# {video_info.get('title', 'Video Subtitles')}")
        md_content.append("")

        # Video info
        if video_info.get('uploader'):
            md_content.append(f"**Uploader:** {video_info['uploader']}")

        if video_info.get('upload_date'):
            date_str = video_info['upload_date']
            formatted_date = f"{date_str[:4]}-{date_str[4:6]}-{date_str[6:8]}"
            md_content.append(f"**Upload Date:** {formatted_date}")

        if video_info.get('duration'):
            duration = video_info['duration']
            hours = int(duration // 3600)
            minutes = int((duration % 3600) // 60)
            seconds = int(duration % 60)
            if hours > 0:
                duration_str = f"{hours:02d}:{minutes:02d}:{seconds:02d}"
            else:
                duration_str = f"{minutes:02d}:{seconds:02d}"
            md_content.append(f"**Duration:** {duration_str}")

        if video_info.get('webpage_url'):
            md_content.append(f"**URL:** {video_info['webpage_url']}")

        md_content.append("")
        md_content.append("---")
        md_content.append("")

        # Content
        if content:
            # Clean up subtitle formatting for both SRT and WebVTT
            # Remove WebVTT headers
            content = re.sub(r'WEBVTT.*?Language.*?\n\n', '', content, flags=re.DOTALL)

            # Remove SRT numbering
            content = re.sub(r'^\d+\n', '', content, flags=re.MULTILINE)

            # Remove timestamp lines (both formats)
            content = re.sub(r'\d{2}:\d{2}:\d{2}[,.]\d{3} --> \d{2}:\d{2}:\d{2}[,.]\d{3}.*?\n', '', content)
            content = re.sub(r'align:start position:0%\n', '', content)

            # Remove HTML tags and positioning info
            content = re.sub(r'<[^>]+>', '', content)
            content = re.sub(r'position:\d+%\n', '', content)

            # Remove empty lines and clean up
            content = re.sub(r'\n\s*\n', '\n\n', content)
            content = re.sub(r'^\s+', '', content, flags=re.MULTILINE)
            content = content.strip()

            # Split into lines and remove duplicate consecutive lines
            lines = content.split('\n')
            cleaned_lines = []
            prev_line = ""

            for line in lines:
                line = line.strip()
                if line and line != prev_line:
                    cleaned_lines.append(line)
                    prev_line = line

            final_content = '\n'.join(cleaned_lines)

            md_content.append("## Transcript")
            md_content.append("")
            md_content.append(final_content)
        else:
            md_content.append("No transcript available.")

        return '\n'.join(md_content)

    def process_video(self, url: str) -> Optional[str]:
        """Main processing function"""
        print(f"Processing video URL: {url}")

        # Check dependencies
        if not self.check_dependencies():
            return None

        # Get video info
        print("Getting video information...")
        video_info = self.get_video_info(url)
        if not video_info:
            print("Failed to get video information")
            return None

        video_title = video_info.get('title', 'unknown_video')
        safe_title = self.sanitize_filename(self.output_name or video_title)

        # Create video subdirectory
        video_subdir = self.video_dir / safe_title
        video_subdir.mkdir(exist_ok=True)

        print(f"Created directory: {video_subdir}")

        # Download video
        print("Downloading video...")
        video_path = self.download_video(url, video_subdir)
        if not video_path:
            print("Failed to download video")
            return None

        print(f"Video downloaded: {video_path}")

        # Try to extract subtitles first
        print("Extracting subtitles...")
        subtitle_text = self.extract_subtitles(url, video_subdir)

        # If no subtitles, try audio transcription
        if not subtitle_text:
            print("No subtitles found, attempting audio transcription...")
            subtitle_text = self.transcribe_audio(video_path)

        if subtitle_text:
            # Format and save subtitles
            md_content = self.format_subtitles_md(subtitle_text, video_info)
            subtitles_file = video_subdir / "subtitles.md"

            with open(subtitles_file, 'w', encoding='utf-8') as f:
                f.write(md_content)

            print(f"Subtitles saved: {subtitles_file}")
        else:
            print("Failed to extract or transcribe text content")

        return str(video_subdir)


def main():
    parser = argparse.ArgumentParser(description="Download a video and extract subtitles to an Export Location.")
    parser.add_argument("url", help="Video URL or text containing a YouTube URL")
    parser.add_argument("--output", required=True, help="Absolute Export Location directory")
    parser.add_argument("--output-name", default="", help="Optional output directory name")
    args = parser.parse_args()

    input_text = args.url
    try:
        downloader = VideoDownloader(Path(args.output), args.output_name)
    except ValueError as exc:
        print(str(exc), file=sys.stderr)
        sys.exit(1)

    # Try to extract YouTube URL if it's embedded in text
    url = downloader.extract_youtube_url(input_text) or input_text

    # Validate URL
    if not downloader.validate_url(url):
        print("Error: Invalid or unsupported video URL")
        sys.exit(1)

    result = downloader.process_video(url)

    if result:
        print(f"\n✅ Success! Video and subtitles saved in: {result}")
    else:
        print("\n❌ Failed to process video")
        sys.exit(1)


if __name__ == "__main__":
    main()
