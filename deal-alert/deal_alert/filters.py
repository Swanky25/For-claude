"""Decide which products are 'best ones at best prices'."""
from __future__ import annotations

import math

from .models import Category, Product
from .parsing import parse_screen_inches


def matches_category(p: Product, c: Category) -> bool:
    t = f" {p.title.lower()} "
    if c.must_match_any and not any(k.lower() in t for k in c.must_match_any):
        return False
    if any(k.lower() in t for k in c.exclude):
        return False
    if c.min_screen_inches is not None:
        size = parse_screen_inches(p.title)
        if size is None or size < c.min_screen_inches:
            return False
    return True


def rejection_reason(p: Product, c: Category, g: dict) -> str | None:
    """None if the product qualifies, else a short reason (useful for --explain)."""
    if not matches_category(p, c):
        return "not in category"
    if p.price is None:
        return "no price"
    if p.price < c.min_price:
        return f"price below {c.min_price} (likely accessory)"
    d = p.discount_pct
    if d is None or d < g["min_discount_pct"]:
        return f"discount {d}% < {g['min_discount_pct']}%"
    if p.source == "community":
        return None  # feeds carry no ratings; discount + category is all we can check
    if p.rating is None or p.rating < g["min_rating"]:
        return f"rating {p.rating} < {g['min_rating']}"
    if p.reviews is None or p.reviews < g["min_reviews"]:
        return f"reviews {p.reviews} < {g['min_reviews']}"
    return None


def score(p: Product) -> float:
    """Rank by discount, then quality: rating weighted by how many people rated it."""
    s = p.discount_pct or 0
    if p.rating:
        s += (p.rating - 4.0) * 40           # 4.5 stars = +20
    if p.reviews:
        s += math.log10(p.reviews) * 5       # 10k reviews = +20
    return round(s, 1)


def select_deals(products: list[Product], c: Category, g: dict) -> list[Product]:
    good = [p for p in products if rejection_reason(p, c, g) is None]
    for p in good:
        p.category = c.name
    return sorted(good, key=score, reverse=True)[: g["top_n_per_category"]]
