#!/usr/bin/env python3
"""Generate a daily summary with the shared preference-driven pipeline."""
import sys
from pathlib import Path
root = Path(__file__).resolve().parent
sys.path.insert(0, str(root if (root / '_shared').is_dir() else root.parent))
from _shared.brief_generation import main
if __name__ == '__main__':
    raise SystemExit(main('summary'))
