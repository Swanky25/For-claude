"""Run one check:  python -m deal_alert [--config config.toml] [--dry-run]"""
from __future__ import annotations

import argparse
import logging
import tomllib
from pathlib import Path

import requests

from .filters import select_deals
from .models import Category
from .notify import notify
from .sources import fetch_amazon, fetch_feeds
from .state import State


def load_config(path: Path) -> tuple[dict, list[Category]]:
    cfg = tomllib.loads(path.read_text(encoding="utf-8"))
    return cfg["global"], [Category(**c) for c in cfg["category"]]


def main(argv: list[str] | None = None) -> int:
    here = Path(__file__).resolve().parent.parent
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--config", type=Path, default=here / "config.toml")
    ap.add_argument("--state", type=Path, default=here / "state.json")
    ap.add_argument("--dry-run", action="store_true", help="print deals, send nothing, save nothing")
    ap.add_argument("--no-amazon", action="store_true")
    ap.add_argument("--no-feeds", action="store_true")
    args = ap.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")

    g, categories = load_config(args.config)
    state = State(args.state)
    session = requests.Session()

    community = [] if args.no_feeds else fetch_feeds(g.get("community_feeds", []), session)
    alerts = []
    for c in categories:
        products = list(community)
        if not args.no_amazon:
            products += fetch_amazon(c, g["country_domain"], g["pages_per_query"],
                                     g["request_delay_seconds"], session)
        deals = select_deals(products, c, g)
        fresh = [p for p in deals if state.is_new_or_cheaper(p, g["realert_drop_pct"])]
        logging.info("%s: %d scanned, %d qualify, %d new", c.name, len(products), len(deals), len(fresh))
        alerts += [p for p in fresh if p.key not in {a.key for a in alerts}]

    notify(alerts, g["currency"], dry_run=args.dry_run)
    if not args.dry_run:
        for p in alerts:
            state.remember(p)
        state.save()
    logging.info("Done: %d alert(s)", len(alerts))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
