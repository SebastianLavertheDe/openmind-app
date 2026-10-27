"""Versioned compatibility helpers for local Skill development.

This directory is a Python package for source-level compatibility only. It is
not a runnable Skill and has no ``cctools.skill.yaml`` manifest. Production
Skill packages vendor the adapter they need instead of importing this package
through a workspace-relative ancestor walk.
"""

__version__ = "1.0.0"
