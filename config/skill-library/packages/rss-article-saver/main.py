"""Compatibility entry; all callers use the same local RSS pipeline."""
from pipeline import main

if __name__ == "__main__":
    raise SystemExit(main())
