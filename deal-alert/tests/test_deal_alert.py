from pathlib import Path

import pytest

from deal_alert.__main__ import load_config
from deal_alert.filters import rejection_reason, select_deals
from deal_alert.models import Product
from deal_alert.parsing import parse_count, parse_screen_inches
from deal_alert.sources import BlockedError, parse_amazon_search, parse_feed
from deal_alert.state import State

ROOT = Path(__file__).resolve().parent.parent
FIX = Path(__file__).resolve().parent / "fixtures"


@pytest.fixture
def config():
    g, cats = load_config(ROOT / "config.toml")
    return g, {c.name.split()[0].lower(): c for c in cats}


def test_screen_size_parsing():
    assert parse_screen_inches("Acme 139 cm (55 inches) 4K TV") == 55
    assert parse_screen_inches("Brand 164 cm 4K TV") == 64.6
    assert parse_screen_inches('Brand 50" Smart TV') == 50
    assert parse_screen_inches("Smart TV 4K") is None


def test_count_parsing():
    assert parse_count("(12,345)") == 12345
    assert parse_count("1.2K") == 1200
    assert parse_count("3,456 ratings") == 3456


def test_amazon_parse_and_tv_filter(config):
    g, cats = config
    products = parse_amazon_search((FIX / "amazon_search.html").read_text())
    assert len(products) == 5
    good = products[0]
    assert good.title.startswith("Acme 139 cm")   # "Sponsored Ad - " stripped
    assert (good.price, good.mrp, good.rating, good.reviews) == (329.99, 699.99, 4.4, 12345)
    assert good.discount_pct == 52.9

    tv = cats["tv"]
    reasons = {p.id: rejection_reason(p, tv, g) for p in products}
    assert reasons["B0TVGOOD01"] is None
    assert reasons["B0TVSMALL1"] == "not in category"        # 32 inch
    assert reasons["B0TVLOWDSC"].startswith("discount")       # only 22% off
    assert reasons["B0TVMOUNT1"] == "not in category"        # accessory
    assert reasons["B0TVFEWREV"].startswith("reviews")        # 7 reviews, untrustworthy
    assert [p.id for p in select_deals(products, tv, g)] == ["B0TVGOOD01"]


def test_captcha_detected():
    with pytest.raises(BlockedError):
        parse_amazon_search("<html>Enter the characters you see below captcha</html>")


def test_feed_parse_and_filters(config):
    g, cats = config
    items = parse_feed((FIX / "feed.xml").read_text())
    assert items[0].price == 269.99 and items[0].mrp == 599.99
    assert items[1].price == 19.99 and items[1].discount_pct == pytest.approx(55, abs=0.5)
    water = [p.id for p in select_deals(items, cats["water"], g)]
    mop = [p.id for p in select_deals(items, cats["mop"], g)]
    assert water == ["https://example.com/d/1"]
    assert mop == ["https://example.com/d/2"]                 # refill pads excluded
    assert select_deals(items, cats["vacuum"], g) == []


def test_state_dedup(tmp_path):
    s = State(tmp_path / "state.json")
    p = Product("amazon", "X", "TV", "u", price=30000, mrp=60000)
    assert s.is_new_or_cheaper(p, 5)
    s.remember(p); s.save()
    s2 = State(tmp_path / "state.json")
    assert not s2.is_new_or_cheaper(p, 5)
    p.price = 28000                                           # 6.7% cheaper -> alert again
    assert s2.is_new_or_cheaper(p, 5)
