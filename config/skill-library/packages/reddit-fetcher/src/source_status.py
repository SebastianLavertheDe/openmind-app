"""Per-URL results shared with the desktop source cards, outside installed Skills."""
from __future__ import annotations

import hashlib
import json
import os
import tempfile
import uuid
from datetime import datetime, timezone
from pathlib import Path


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


class SourceStatus:
    def __init__(self, data_dir: Path, url: str):
        self.url = url
        self.path = data_dir / "source-status" / (hashlib.sha256(url.encode()).hexdigest() + ".json")
        self.attempt = uuid.uuid4().hex
        previous = self._read()
        self.state = {
            "schemaVersion": 1, "url": url, "attempt": self.attempt, "pid": os.getpid(),
            "startedAt": _now(), "completedAt": None, "status": "running",
            "lastSuccessAt": previous.get("lastSuccessAt"),
            # A retry is not a recovery: retain the last failure until success.
            "itemCount": previous.get("itemCount", 0),
            "error": previous.get("error") if previous.get("status") in ("failed", "running") else None,
        }
        self._write()

    def finish(self, count: int = 0, error: str | None = None) -> None:
        # Do not let an older request replace a subsequently started attempt.
        if self._read().get("attempt") != self.attempt:
            return
        failed = error is not None
        self.state.update(completedAt=_now(), status="failed" if failed else "success", error=(error[:4000] or "Collection failed") if failed else None)
        if error is None:
            self.state.update(itemCount=count, lastSuccessAt=self.state["completedAt"])
        self._write()

    def _read(self) -> dict:
        try:
            value = json.loads(self.path.read_text(encoding="utf-8"))
            return value if isinstance(value, dict) and value.get("url") == self.url else {}
        except (OSError, ValueError):
            return {}

    def _write(self) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        descriptor, temporary = tempfile.mkstemp(prefix=".status-", dir=self.path.parent)
        try:
            with os.fdopen(descriptor, "w", encoding="utf-8") as output:
                json.dump(self.state, output, ensure_ascii=False)
            os.replace(temporary, self.path)
        finally:
            if os.path.exists(temporary):
                os.unlink(temporary)
