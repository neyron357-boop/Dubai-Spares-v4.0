from __future__ import annotations

import json
import threading
from pathlib import Path
from typing import Any


class StateStore:
    def __init__(self, path: Path):
        self.path = path
        self._lock = threading.Lock()
        self._state: dict[str, Any] = {
            "owner_chat_id": None,
            "last_seen_created_at": None,
            "last_seen_id": None,
        }
        self._load()

    def _load(self) -> None:
        if not self.path.exists():
            self.path.parent.mkdir(parents=True, exist_ok=True)
            self._flush()
            return

        with self.path.open("r", encoding="utf-8") as fh:
            try:
                data = json.load(fh)
            except json.JSONDecodeError:
                data = {}

        if isinstance(data, dict):
            self._state.update(data)

    def _flush(self) -> None:
        temp = self.path.with_suffix(".tmp")
        with temp.open("w", encoding="utf-8") as fh:
            json.dump(self._state, fh, ensure_ascii=False, indent=2)
        temp.replace(self.path)

    def get_owner_chat_id(self) -> int | None:
        with self._lock:
            value = self._state.get("owner_chat_id")
            return int(value) if value is not None else None

    def set_owner_chat_id(self, chat_id: int) -> None:
        with self._lock:
            self._state["owner_chat_id"] = int(chat_id)
            self._flush()

    def get_last_seen(self) -> tuple[str | None, str | None]:
        with self._lock:
            return (
                self._state.get("last_seen_created_at"),
                str(self._state.get("last_seen_id")) if self._state.get("last_seen_id") is not None else None,
            )

    def set_last_seen(self, created_at: str, record_id: str | int | None) -> None:
        with self._lock:
            self._state["last_seen_created_at"] = created_at
            self._state["last_seen_id"] = str(record_id) if record_id is not None else None
            self._flush()
