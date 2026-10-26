"""Render storyboard JSON to MP4 with ffmpeg. No shell, downloads or pip installs.

Usage: python render_video.py storyboard.json output.mp4
Input: {"slides": [{"text": "Hello", "duration": 2, "image": "optional.png"}]}
"""
import argparse
import json
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path


def render(data, output, electron=None, ffmpeg=None):
    executable = str(Path(ffmpeg).resolve(strict=True)) if ffmpeg else shutil.which('ffmpeg')
    if not executable:
        raise RuntimeError('ffmpeg is required')
    output = Path(output).resolve()
    if output.exists():
        raise FileExistsError(output)
    output.parent.mkdir(parents=True, exist_ok=True)
    width, height = int(data.get('width', 1280)), int(data.get('height', 720))
    if not 64 <= width <= 3840 or not 64 <= height <= 3840 or width % 2 or height % 2:
        raise ValueError('Use even dimensions between 64 and 3840')
    color = str(data.get('background', '0x172033'))
    if not color.startswith('0x') or len(color) != 8 or any(c not in '0123456789abcdefABCDEF' for c in color[2:]):
        raise ValueError('Background must be 0xRRGGBB')
    slides = data['slides']
    if not 1 <= len(slides) <= 100 or sum(float(s.get('duration', 3)) for s in slides) > 600:
        raise ValueError('Expected 1–100 slides and at most ten minutes')
    with tempfile.TemporaryDirectory(prefix='openmind-video-') as work:
        work = Path(work)
        filters = subprocess.run([executable, '-hide_banner', '-filters'], capture_output=True, text=True, check=True, timeout=10).stdout
        native_text = ' drawtext ' in filters
        if not native_text:
            if not electron:
                raise RuntimeError('This ffmpeg build lacks drawtext. Pass --electron with the OpenMind runtime executable from the Skill context.')
            config = {**data, 'width': width, 'height': height}
            (work / 'frames.json').write_text(json.dumps(config), encoding='utf-8')
            subprocess.run([str(Path(electron).resolve()), '--no-sandbox', str(Path(__file__).with_name('render_frames.cjs')), str(work / 'frames.json'), str(work)], check=True, timeout=120)
        for i, slide in enumerate(slides):
            duration = float(slide.get('duration', 3))
            if not .1 <= duration <= 60:
                raise ValueError('Slide duration must be between .1 and 60 seconds')
            (work / f'text-{i}.txt').write_text(str(slide.get('text', '')), encoding='utf-8')
            args = [executable, '-nostdin', '-v', 'error']
            if not native_text:
                args += ['-loop', '1', '-i', str(work / f'frame-{i}.png')]
            elif slide.get('image'):
                image = Path(slide['image']).resolve(strict=True)
                args += ['-loop', '1', '-i', str(image)]
            else:
                args += ['-f', 'lavfi', '-i', f'color=c={color}:s={width}x{height}:r=24']
            size = max(12, min(200, int(data.get('fontSize', 48))))
            frame_filter = f'scale={width}:{height}:force_original_aspect_ratio=decrease,pad={width}:{height}:(ow-iw)/2:(oh-ih)/2'
            if native_text:
                frame_filter += f',drawtext=textfile=text-{i}.txt:expansion=none:fontcolor=white:fontsize={size}:x=(w-text_w)/2:y=(h-text_h)/2'
            args += ['-vf', frame_filter, '-t', str(duration), '-r', '24', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-an', '-n', f'part-{i}.mp4']
            subprocess.run(args, cwd=work, check=True, timeout=180)
        (work / 'concat.txt').write_text(''.join(f"file 'part-{i}.mp4'\n" for i in range(len(slides))), encoding='utf-8')
        subprocess.run([executable, '-nostdin', '-v', 'error', '-f', 'concat', '-safe', '1', '-i', 'concat.txt', '-c', 'copy', '-movflags', '+faststart', '-n', str(output)], cwd=work, check=True, timeout=180)
    return str(output)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('storyboard')
    parser.add_argument('output')
    parser.add_argument('--electron')
    parser.add_argument('--ffmpeg')
    options = parser.parse_args()
    print(render(json.loads(Path(options.storyboard).read_text(encoding='utf-8')), options.output, options.electron, options.ffmpeg))
