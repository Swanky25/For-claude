"""Remembers what was already alerted so you are not spammed with repeats."""
from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path

from .models import Product


class State:
    def __init__(self, path: Path):
        self.path = path
        self.data: dict = json.loads(path.read_text()) if path.exists() else {}

    def is_new_or_cheaper(self, p: Product, drop_pct: float) -> bool:
        prev = self.data.get(p.key)
        if prev is None or p.price is None:
            return True
        return p.price <= prev["price"] * (1 - drop_pct / 100)

    def remember(self, p: Product) -> None:
        self.data[p.key] = {
            "price": p.price,
            "title": p.title[:120],
            "alerted_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        }

    def save(self) -> None:
        self.path.write_text(json.dumps(self.data, indent=1, ensure_ascii=False, sort_keys=True) + "\n")
