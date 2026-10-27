# VideoDownload Claude Skill

A Claude skill that downloads videos from URLs and extracts their text content.

## Features

- Downloads videos from various platforms (YouTube, Vimeo, Bilibili, etc.) to a selected Export Location
- Extracts subtitles when available
- Transcribes audio content using Whisper AI when subtitles aren't available
- Organizes files in a structured directory format
- Saves text content as markdown files

## Installation

1. Make sure you have [uv](https://github.com/astral-sh/uv) installed
2. Install dependencies:
   ```bash
   uv sync
   ```

## Usage

The skill can be used within Claude by simply providing a video URL. For example:

```
Download this video and extract the text: https://www.youtube.com/watch?v=example
```

## Directory Structure

When processing a video, the skill creates below the selected Export Location:
```
<export-location>/
├── [video_name]/
│   ├── [video_file.mp4]
│   └── subtitles.md
```

## Dependencies

- `yt-dlp` - For video downloading
- `openai-whisper` - For audio transcription
- `torch` - Required by Whisper
- `torchaudio` - Required by Whisper

## Supported Platforms

- YouTube
- Vimeo
- Bilibili
- Twitter/X
- TikTok
- Most video hosting platforms supported by yt-dlp

## Error Handling

The skill includes robust error handling for:
- Invalid URLs
- Network issues
- Unsupported platforms
- Download failures
- Transcription errors
