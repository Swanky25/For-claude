from __future__ import annotations

from dataclasses import dataclass, field


@dataclass
class Category:
    name: str
    queries: list[str]
    must_match_any: list[str] = field(default_factory=list)
    exclude: list[str] = field(default_factory=list)
    min_price: float = 0
    min_screen_inches: float | None = None


@dataclass
class Product:
    source: str            # "amazon" or "community"
    id: str                # stable id within the source (ASIN, feed link)
    title: str
    url: str
    price: float | None
    mrp: float | None = None    # list / "was" price
    rating: float | None = None
    reviews: int | None = None
    category: str = ""

    @property
    def key(self) -> str:
        return f"{self.source}:{self.id}"

    @property
    def discount_pct(self) -> float | None:
        if self.price is None or not self.mrp or self.mrp <= self.price:
            return None
        return round((1 - self.price / self.mrp) * 100, 1)
