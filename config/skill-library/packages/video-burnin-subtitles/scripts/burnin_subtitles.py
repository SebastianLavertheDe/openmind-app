#!/usr/bin/env python3
"""Download, prepare, translate and burn subtitles for one video job."""

from __future__ import annotations

import argparse
import datetime as dt
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path

if os.environ.get("OPENMIND_SHARED_PYTHON") == "1" and os.environ.get("OPENMIND_MEDIA_FFMPEG"):
    os.environ["PATH"] = str(Path(os.environ["OPENMIND_MEDIA_FFMPEG"]).parent)


SCRIPT_DIR = Path(__file__).resolve().parent
STYLE = "Fontname=Noto Sans CJK SC,Fontsize=32,Outline=3,Shadow=1,Alignment=2"


class BurninError(RuntimeError):
    pass


def command_path(name: str, env_name: str | None = None) -> str | None:
    if env_name:
        configured = os.environ.get(env_name, "").strip()
        if configured:
            candidate = Path(configured)
            if candidate.is_file():
                return str(candidate)
            raise BurninError(f"Configured tool does not exist: {env_name}")
    return shutil.which(name)


def python_command(name: str, module: str, env_name: str) -> list[str]:
    configured = os.environ.get(env_name, "").strip()
    if configured: return [require_command(name, env_name)]
    if os.environ.get("OPENMIND_SHARED_PYTHON") == "1": return [sys.executable, "-m", module]
    return [require_command(name, env_name)]


def require_command(name: str, env_name: str | None = None) -> str:
    found = command_path(name, env_name)
    if not found:
        raise BurninError(f"Missing required tool: {name}")
    return found


def run(command: list[str], *, cwd: Path | None = None, capture: bool = False) -> subprocess.CompletedProcess[str]:
    try:
        return subprocess.run(
            command,
            cwd=str(cwd) if cwd else None,
            check=True,
            text=True,
            capture_output=capture,
        )
    except FileNotFoundError as exc:
        raise BurninError(f"Missing required tool: {command[0]}") from exc
    except subprocess.CalledProcessError as exc:
        detail = (exc.stderr or exc.stdout or "").strip()
        raise BurninError(f"Command failed ({exc.returncode}): {command[0]} {detail[:800]}") from exc


def resolve_content_root() -> Path:
    raw = (os.environ.get("OPENMIND_ROOT") or "").strip()
    if not raw:
        raise BurninError("OPENMIND_ROOT is required and must point to an existing content root.")
    root = Path(raw).expanduser()
    if not root.is_dir():
        raise BurninError(f"Content root does not exist or is not a directory: {root}")
    return root.resolve()


def slugify(value: str) -> str:
    value = value.replace(" ", "_")
    value = re.sub(r"[^A-Za-z0-9._-]", "", value)
    value = re.sub(r"_+", "_", value).strip("_")
    return value or "video"


def is_url(value: str) -> bool:
    return bool(re.match(r"^https?://", value, flags=re.IGNORECASE))


def acquire_video(source: str, language: str, output_name: str, output_root: Path) -> tuple[Path, Path]:
    if is_url(source):
        yt_dlp = python_command("yt-dlp", "yt_dlp", "OPENMIND_MEDIA_YTDLP")
        workdir = output_root / slugify(output_name or "video")
        workdir.mkdir(parents=True, exist_ok=True)
        template = str(workdir / "%(title).200s.%(ext)s")
        result = run(
            [
                *yt_dlp,
                "-f", "bv*+ba/b",
                "--write-subs", "--write-auto-subs",
                "--sub-langs", language,
                "--sub-format", "srt/vtt",
                "--restrict-filenames",
                "--no-playlist",
                "-o", template,
                "--print", "after_move:filepath",
                source,
            ],
            cwd=workdir,
            capture=True,
        )
        candidates = [Path(line.strip()) for line in result.stdout.splitlines() if line.strip()]
        candidates = [candidate if candidate.is_absolute() else workdir / candidate for candidate in candidates]
        video = next((candidate.resolve() for candidate in reversed(candidates) if candidate.is_file()), None)
        if video is None:
            raise BurninError("Failed to determine downloaded video path.")
        return video, workdir

    source_path = Path(source).expanduser()
    if not source_path.is_file():
        raise BurninError(f"Input file not found: {source_path}")
    job_name = output_name or source_path.stem
    workdir = output_root / slugify(job_name)
    workdir.mkdir(parents=True, exist_ok=True)
    destination = workdir / source_path.name
    shutil.copy2(source_path, destination)
    return destination.resolve(), workdir.resolve()


def clean_srt(source: Path, destination: Path) -> None:
    content = source.read_text(encoding="utf-8", errors="ignore")
    kept: list[str] = []
    for block in content.split("\n\n"):
        lines = [line.rstrip("\r") for line in block.splitlines() if line.strip()]
        if len(lines) < 3:
            continue
        index, timecode, *text_lines = lines
        text = "\n".join(text_lines)
        if re.search(r"(MING PAO TORONTO|明报多伦多)", text, flags=re.IGNORECASE):
            continue
        kept.append("\n".join([index, timecode, *text_lines]))
    destination.write_text("\n\n".join(kept) + "\n", encoding="utf-8")


def find_subtitle(video: Path, workdir: Path, language: str, explicit: str) -> tuple[Path | None, bool]:
    if explicit:
        subtitle = Path(explicit).expanduser()
        if not subtitle.is_file():
            raise BurninError(f"Subtitle file not found: {subtitle}")
        return subtitle.resolve(), True

    stem = video.stem
    for extension in ("srt", "vtt", "ass"):
        for candidate in (
            workdir / f"{stem}.{language}.{extension}",
            workdir / f"{stem}-{language}.{extension}",
            workdir / f"{stem}_{language}.{extension}",
        ):
            if candidate.is_file():
                return candidate, False
    for extension in ("srt", "vtt", "ass"):
        candidate = workdir / f"{stem}.{extension}"
        if candidate.is_file():
            return candidate, False
    return None, False


def prepare_subtitle(video: Path, workdir: Path, language: str, explicit: str) -> Path:
    subtitle, user_supplied = find_subtitle(video, workdir, language, explicit)
    ffmpeg = require_command("ffmpeg", "OPENMIND_MEDIA_FFMPEG")
    if subtitle is None:
        embedded = workdir / f"{video.stem}.embedded.{language}.srt"
        try:
            run([ffmpeg, "-i", str(video), "-map", f"0:s:m:language:{language}?", str(embedded)])
        except BurninError:
            # Absence of an embedded stream is a normal branch; Whisper is
            # attempted below when no sidecar or embedded subtitle exists.
            pass
        if embedded.is_file():
            subtitle = embedded
    if subtitle is None:
        whisper = python_command("whisper", "whisper", "OPENMIND_SPEECH_WHISPER")
        run([
            *whisper,
            str(video),
            "--model", os.environ.get("WHISPER_MODEL", "large-v3"),
            "--language", language,
            "--task", "transcribe",
            "--output_format", "srt",
            "--output_dir", str(workdir),
        ])
        generated = workdir / f"{video.stem}.srt"
        if generated.is_file():
            subtitle = generated
    if subtitle is None or not subtitle.is_file():
        raise BurninError(f"No subtitles found or generated for language: {language}")
    if user_supplied:
        return subtitle
    cleaned = workdir / f"{video.stem}.clean.srt"
    clean_srt(subtitle, cleaned)
    cleaned.replace(subtitle)
    return subtitle


def escape_filter_path(path: Path) -> str:
    return str(path).replace("\\", "\\\\").replace(":", "\\:").replace("'", "\\'")


def translate_subtitle(source: Path, target: Path) -> None:
    run([
        sys.executable,
        str(SCRIPT_DIR / "translate_srt_gemini.py"),
        str(source),
        str(target),
        "Simplified Chinese",
    ])


def burn_video(video: Path, subtitle: Path, output: Path) -> None:
    ffmpeg = require_command("ffmpeg", "OPENMIND_MEDIA_FFMPEG")
    filter_name = "ass" if subtitle.suffix.lower() == ".ass" else "subtitles"
    subtitle_value = escape_filter_path(subtitle)
    filter_value = f"{filter_name}=filename='{subtitle_value}':force_style='{STYLE}'"
    run([
        ffmpeg,
        "-y", "-i", str(video),
        "-vf", filter_value,
        "-c:v", "libx264", "-crf", "18", "-preset", "medium", "-c:a", "copy",
        str(output),
    ])


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Burn translated subtitles into a video.")
    parser.add_argument("--input", required=True, dest="source", help="Video URL or local path")
    parser.add_argument("--lang", required=True, dest="language", help="Source subtitle language code")
    parser.add_argument("--subtitle", default="", dest="subtitle_file", help="Optional source subtitle file")
    parser.add_argument("--output-name", default="video", dest="output_name", help="Job/output name")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    try:
        content_root = resolve_content_root()
        output_root = content_root / "video"
        output_root.mkdir(parents=True, exist_ok=True)
        video, workdir = acquire_video(args.source, args.language, args.output_name, output_root)
        subtitle = prepare_subtitle(video, workdir, args.language, args.subtitle_file)
        translated = workdir / f"{video.stem}.zh.srt"
        translate_subtitle(subtitle, translated)
        date_tag = dt.date.today().strftime("%Y%m%d")
        output_name = f"{slugify(args.output_name or video.stem)}.zh.{date_tag}.burned.mp4"
        output = workdir / output_name
        burn_video(video, translated, output)
        print(f"Burn-in complete: {output}")
        return 0
    except BurninError as exc:
        print(str(exc), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
