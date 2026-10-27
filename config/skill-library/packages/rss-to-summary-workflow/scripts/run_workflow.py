#!/usr/bin/env python3
"""Compatibility launcher using the installed OpenMind CLI and its shared locks."""
import argparse
from datetime import datetime
from pathlib import Path
import subprocess


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--cli', required=True)
    parser.add_argument('--root', required=True)
    parser.add_argument('--user-data', required=True)
    parser.add_argument('--date', default=datetime.now().strftime('%Y%m%d'))
    args = parser.parse_args()
    for value in (args.cli, args.root, args.user_data):
        if not Path(value).is_absolute(): parser.error('CLI, root and user-data paths must be absolute.')
    datetime.strptime(args.date, '%Y%m%d')
    common = ['--root', args.root, '--user-data', args.user_data, '--date', args.date]
    for command in (['rss', 'pipeline'], ['brief', 'generate']):
        result = subprocess.run([args.cli, *command, *common], check=False)
        if result.returncode: return result.returncode
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
