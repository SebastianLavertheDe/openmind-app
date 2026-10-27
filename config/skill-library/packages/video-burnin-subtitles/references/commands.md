# Command Templates

## One-shot automation

```bash
bash video-burnin-subtitles/scripts/burnin_subtitles.sh \
  --input "<url-or-path>" --lang "<lang>"
```

Environment variables (required for translation; a managed Run injects these from the selected Provider Profile):

```bash
export OPENMIND_ROOT="/absolute/path/to/content-root"
export OPENMIND_PROVIDER_PROTOCOL="openai-chat"
export OPENMIND_PROVIDER_BASE_URL="https://generativelanguage.googleapis.com/v1beta/openai"
export OPENMIND_PROVIDER_MODEL="gemini-2.5-flash"
export OPENMIND_PROVIDER_API_KEY="***"
```

Output naming:
- Default output name: `<basename>.zh.YYYYMMDD.burned.mp4`

## URL download + subtitles (yt-dlp)

List available subtitles (filter to target language):

```bash
yt-dlp --list-subs "<URL>" | rg "<lang>"
```

Download video plus subtitles for a target language only (prefer official, fall back to auto):

```bash
yt-dlp -f "bv*+ba/b" \
  --write-subs --write-auto-subs \
  --sub-langs "<lang>" --sub-format "srt/vtt" \
  --restrict-filenames \
  -o "$OPENMIND_ROOT/video/%(title).200s/%(title).200s.%(ext)s" \
  "<URL>"
```

## Local subtitle detection

Look for sidecar subtitles with the same basename as the video:

```bash
ls "<dir>/<basename>."{srt,vtt,ass}
```

## Extract embedded subtitles (ffmpeg)

List streams:

```bash
ffmpeg -i "<video>"
```

Extract the first subtitle stream to SRT:

```bash
ffmpeg -i "<video>" -map 0:s:0 "<basename>.extracted.srt"
```

## Generate subtitles (whisper)

```bash
whisper "<video>" --language "<lang>" --task transcribe \
  --output_format srt --output_dir "<dir>"
```

## Burn subtitles into video (ffmpeg)

SRT/VTT:

```bash
ffmpeg -i "<video>" \
  -vf "subtitles=<subtitle-file>" \
  -c:v libx264 -crf 18 -preset medium -c:a copy \
  "<basename>.burned.mp4"
```

ASS:

```bash
ffmpeg -i "<video>" \
  -vf "ass=<subtitle-file>" \
  -c:v libx264 -crf 18 -preset medium -c:a copy \
  "<basename>.burned.mp4"
```

## Path escaping tips

- If the subtitle path has spaces, keep it quoted in the filter.
- If the path contains colons, prefer `subtitles=filename='<path>'` syntax.
