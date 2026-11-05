"""Where products come from: Amazon search results and community deal feeds."""
from __future__ import annotations

import logging
import time
import xml.etree.ElementTree as ET
from urllib.parse import quote_plus

import requests
from bs4 import BeautifulSoup

from .models import Category, Product
from .parsing import (
    parse_count,
    parse_discount_from_text,
    parse_price,
    parse_rating,
    parse_rupee_amounts,
)

log = logging.getLogger(__name__)

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/130.0 Safari/537.36"
    ),
    "Accept-Language": "en-IN,en;q=0.9",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
}


class BlockedError(RuntimeError):
    """The store served a captcha / bot-check page instead of results."""


def parse_amazon_search(html: str, domain: str = "amazon.in") -> list[Product]:
    if "captcha" in html.lower() and "s-search-result" not in html:
        raise BlockedError("Amazon returned a captcha page")
    soup = BeautifulSoup(html, "html.parser")
    products: list[Product] = []
    for card in soup.select('div[data-component-type="s-search-result"]'):
        asin = card.get("data-asin")
        h2 = card.find("h2")
        if not asin or not h2:
            continue
        title = (h2.get("aria-label") or h2.get_text(" ", strip=True)).strip()
        title = title.removeprefix("Sponsored Ad - ").strip()

        price_el = card.select_one("span.a-price:not(.a-text-price) span.a-offscreen")
        mrp_el = card.select_one("span.a-price.a-text-price span.a-offscreen")
        rating_el = card.select_one("span.a-icon-alt")

        reviews = None
        for sel in ('a[href*="customerReviews"] span', "span.a-size-base.s-underline-text",
                    'span[aria-label$="ratings"]', 'span[aria-label$="rating"]'):
            el = card.select_one(sel)
            if el:
                reviews = parse_count(el.get("aria-label") or el.get_text(strip=True))
                if reviews is not None:
                    break

        products.append(Product(
            source="amazon",
            id=asin,
            title=title,
            url=f"https://www.{domain}/dp/{asin}",
            price=parse_price(price_el.get_text() if price_el else None),
            mrp=parse_price(mrp_el.get_text() if mrp_el else None),
            rating=parse_rating(rating_el.get_text() if rating_el else None),
            reviews=reviews,
        ))
    return products


def fetch_amazon(category: Category, domain: str, pages: int, delay: float,
                 session: requests.Session) -> list[Product]:
    found: dict[str, Product] = {}
    for query in category.queries:
        for page in range(1, pages + 1):
            url = f"https://www.{domain}/s?k={quote_plus(query)}&page={page}"
            try:
                resp = session.get(url, headers=HEADERS, timeout=30)
                resp.raise_for_status()
                for p in parse_amazon_search(resp.text, domain):
                    p.category = category.name
                    found.setdefault(p.key, p)
            except BlockedError as e:
                log.warning("%s (query %r) - skipping the rest of this run's Amazon queries", e, query)
                return list(found.values())
            except requests.ConnectionError as e:
                log.warning("Cannot reach %s (%s) - skipping Amazon this run", domain, e.__class__.__name__)
                return list(found.values())
            except requests.RequestException as e:
                log.warning("Amazon request failed for %r page %d: %s", query, page, e)
            time.sleep(delay)
    return list(found.values())


def parse_feed(xml_text: str) -> list[Product]:
    """Parse RSS 2.0 or Atom into Products (price/MRP inferred from the title)."""
    root = ET.fromstring(xml_text)
    atom = "{http://www.w3.org/2005/Atom}"
    entries = []
    for item in root.iter("item"):
        entries.append((item.findtext("title") or "", item.findtext("link") or "",
                        item.findtext("description") or ""))
    for entry in root.iter(f"{atom}entry"):
        link_el = entry.find(f"{atom}link")
        entries.append((entry.findtext(f"{atom}title") or "",
                        link_el.get("href", "") if link_el is not None else "",
                        entry.findtext(f"{atom}summary") or ""))

    products = []
    for title, link, desc in entries:
        text = f"{title} {BeautifulSoup(desc, 'html.parser').get_text(' ')}"
        amounts = parse_rupee_amounts(text)
        price = min(amounts) if amounts else None
        mrp = max(amounts) if len(amounts) > 1 else None
        stated = parse_discount_from_text(text)
        if price is not None and mrp is None and stated:
            mrp = round(price / (1 - stated / 100), 0)
        products.append(Product(source="community", id=link or title, title=title.strip(),
                                url=link, price=price, mrp=mrp))
    return products


def fetch_feeds(urls: list[str], session: requests.Session) -> list[Product]:
    out: list[Product] = []
    for url in urls:
        try:
            resp = session.get(url, headers=HEADERS, timeout=30)
            resp.raise_for_status()
            out.extend(parse_feed(resp.text))
        except (requests.RequestException, ET.ParseError) as e:
            log.warning("Feed %s failed: %s", url, e)
    return out
