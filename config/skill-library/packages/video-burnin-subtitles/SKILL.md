---
name: video-burnin-subtitles
description: Download or use local videos, detect or generate subtitles in a specified language, and burn (hardcode) subtitles into the output video. Use when users provide YouTube links or local video paths and want subtitles burned into the video, including cases with existing .srt/.vtt sidecar files or when subtitles must be generated.
---

# Video Burnin Subtitles

## Overview

Download videos from URLs or use local files, detect or generate subtitles, translate them to Simplified Chinese when needed, and burn them into the final video with ffmpeg. Outputs are always written to the Broker-bound `OPENMIND_ROOT/video/`.

## Workflow Decision Tree

1. **Confirm inputs**
   - Source: URL (YouTube, etc.) or local video path.
   - Target language code (e.g., `en`, `zh`, `ja`).
   - Optional: preferred subtitle file path and output name.
   - If language is missing, ask for it.

2. **Acquire video**
   - **URL**: Use `yt-dlp` to download the video into a new folder under the bound `OPENMIND_ROOT/video/`. Prefer best video+audio merge. Always use `--restrict-filenames` to avoid spaces and unsafe characters in folder names.
   - **Local path**: Verify the file exists and copy it into a new folder under the bound `OPENMIND_ROOT/video/` to keep outputs together. Slugify folder name (no spaces).

3. **Detect or create source subtitles (priority order)**
   - **Sidecar files**: Look for `*.srt`, `*.vtt`, or `*.ass` in the working folder with the same basename as the video (any language).
   - **Embedded streams**: If none found, check the video for subtitle streams and extract the first available stream.
   - **Online subs (URL only)**: Use `yt-dlp` to download official subs in any available language; if none, use auto-subs.

4. **Generate subtitles if missing**
   - Use `whisper` (or `faster-whisper` if available) to transcribe to SRT (source language).
   - You can set `WHISPER_MODEL` (default `large-v3`) to improve accuracy.
   - Store the generated SRT in the working folder.

5. **Translate subtitles to Simplified Chinese**
   - Use the selected Provider Profile to translate SRT text while preserving timestamps.
   - Output file: `*.zh.srt` in the working folder.

6. **Burn subtitles into the video**
   - Use `ffmpeg` with the `subtitles` (SRT/VTT) or `ass` filter.
   - Force bottom-centered style: `Fontname=Noto Sans CJK SC, Fontsize=32, Outline=3, Shadow=1, Alignment=2`.
   - Output filename includes `.zh.YYYYMMDD.burned.mp4`.

6. **Report outputs**
   - Provide the final output path and any subtitle file used/created.

## Automation Script

Use `scripts/burnin_subtitles.sh` for one-shot automation. It handles URL/local input, subtitle detection, generation if missing, translation through the Broker-bound Provider Profile, and burn-in. The script does not read `.env` files; direct invocations must provide the neutral `OPENMIND_PROVIDER_*` variables explicitly.

## Command Templates

See `references/commands.md` for the exact command templates and path-escaping tips if you need to run steps manually.

## Notes and Guardrails

- Prefer official subtitles over auto-generated ones when both exist.
- Translate to Simplified Chinese (`zh-Hans`) before burning in. Do not keep original subtitles.
- Force subtitle cleaning: remove tags and non-dialogue cues (e.g., [Music], (Applause), ♪).
- If the user provides a subtitle file path, use it directly instead of auto-detecting.
- Always write outputs to the Broker-bound `OPENMIND_ROOT/video/`; the installed Skill cannot select a different content root.
- If required tools are missing (`yt-dlp`, `ffmpeg`, `whisper`, `python3`), tell the user what is missing and stop before proceeding.
