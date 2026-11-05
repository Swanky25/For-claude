"""Small, dependency-free parsers for prices, ratings and screen sizes."""
from __future__ import annotations

import re

_NUM = re.compile(r"\d[\d,]*(?:\.\d+)?")


def parse_price(text: str | None) -> float | None:
    """'₹32,999.00' -> 32999.0"""
    if not text:
        return None
    m = _NUM.search(text)
    return float(m.group().replace(",", "")) if m else None


def parse_rating(text: str | None) -> float | None:
    """'4.3 out of 5 stars' -> 4.3"""
    if not text:
        return None
    m = re.search(r"(\d(?:\.\d)?)\s*out of\s*5", text)
    return float(m.group(1)) if m else None


def parse_count(text: str | None) -> int | None:
    """'(12,345)', '12,345 ratings', '1.2K' -> int"""
    if not text:
        return None
    m = re.search(r"(\d[\d,]*(?:\.\d+)?)\s*([kKmM])?", text)
    if not m:
        return None
    value = float(m.group(1).replace(",", ""))
    suffix = (m.group(2) or "").lower()
    value *= {"k": 1_000, "m": 1_000_000}.get(suffix, 1)
    return int(value)


_INCH = re.compile(r"(\d{2,3}(?:\.\d)?)\s*(?:-\s*)?(?:inch(?:es)?|in\b|\"|”|'')", re.I)
_CM = re.compile(r"(\d{2,3}(?:\.\d+)?)\s*(?:-\s*)?cm\b", re.I)


def parse_screen_inches(title: str) -> float | None:
    """Largest plausible TV diagonal in the title, from inches or cm."""
    sizes = [float(x) for x in _INCH.findall(title)]
    sizes += [round(float(x) / 2.54, 1) for x in _CM.findall(title)]
    sizes = [s for s in sizes if 15 <= s <= 120]
    return max(sizes) if sizes else None


def parse_discount_from_text(text: str) -> float | None:
    """'... 59% off' -> 59.0"""
    m = re.search(r"(\d{1,2}(?:\.\d)?)\s*%\s*off", text, re.I)
    return float(m.group(1)) if m else None


def parse_rupee_amounts(text: str) -> list[float]:
    """All amounts written as Rs/₹/INR followed by a number."""
    return [
        float(x.replace(",", ""))
        for x in re.findall(r"(?:₹|rs\.?|inr)\s*(\d[\d,]*(?:\.\d+)?)", text, re.I)
    ]
