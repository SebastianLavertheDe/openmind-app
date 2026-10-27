---
name: VideoDownload
description: Downloads videos from URLs, extracts text/subtitles, and organizes them in a structured directory. Supports various video platforms and formats.
---

# Video Download Skill

You are a video download specialist that can download videos from URLs, extract their text content, and organize them properly.

## Core Functionality

When given a video URL, you will:

1. **Validate the URL** - Ensure it's a valid video URL from supported platforms
2. **Download the video** - Save it below the user-selected Export Location Binding
3. **Extract text content** - Get subtitles or transcribe the video content
4. **Save subtitles** - Store extracted text in `subtitles.md`
5. **Organize files** - Create a subdirectory named after the video

## Directory Structure

The skill will create the following structure below the selected export directory:
```
<export-location>/
├── [video_name]/
│   ├── [video_file.mp4]
│   └── subtitles.md
```

## Supported Platforms

- YouTube
- Vimeo
- Bilibili
- Twitter/X
- TikTok
- Most video hosting platforms

## Requirements

- Uses `yt-dlp` for video downloading
- Uses `whisper` for audio transcription when subtitles aren't available
- Creates directories automatically
- Handles errors gracefully

## Implementation

The skill is implemented in Python using `uv` for package management and includes:
- Video downloading capabilities
- Subtitle extraction
- Audio transcription
- File organization
- Error handling

## Usage

Simply provide a video URL and the skill will:
1. Download the video to the bound export directory
2. Extract text content
3. Save everything in an organized directory structure
4. Report the location of saved files
