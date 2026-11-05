"""Send alerts to the console, Telegram and/or email (configured via env vars)."""
from __future__ import annotations

import html
import logging
import os
import smtplib
from email.message import EmailMessage

import requests

from .filters import score
from .models import Product

log = logging.getLogger(__name__)


def _money(v: float | None, cur: str) -> str:
    return f"{cur}{v:,.0f}" if v is not None else "?"


def format_text(p: Product, cur: str) -> str:
    lines = [f"[{p.category}] {p.title[:110]}",
             f"  {_money(p.price, cur)} (MRP {_money(p.mrp, cur)}) - {p.discount_pct:.0f}% OFF"]
    if p.source == "community":
        lines.append("  community deal - no rating data, check reviews before buying")
    else:
        lines.append(f"  {p.rating} stars from {p.reviews:,} ratings - score {score(p)}")
    lines.append(f"  {p.url}")
    return "\n".join(lines)


def format_html(p: Product, cur: str) -> str:
    quality = ("<i>community deal - check reviews</i>" if p.source == "community"
               else f"⭐ {p.rating} ({p.reviews:,} ratings)")
    return (f"<b>{html.escape(p.category)}</b>\n"
            f"<a href=\"{html.escape(p.url)}\">{html.escape(p.title[:110])}</a>\n"
            f"💰 <b>{_money(p.price, cur)}</b> <s>{_money(p.mrp, cur)}</s> "
            f"— <b>{p.discount_pct:.0f}% off</b>\n{quality}")


def send_telegram(deals: list[Product], cur: str) -> None:
    token, chat = os.getenv("TELEGRAM_BOT_TOKEN"), os.getenv("TELEGRAM_CHAT_ID")
    if not (token and chat):
        return
    for p in deals:
        r = requests.post(f"https://api.telegram.org/bot{token}/sendMessage", timeout=20, data={
            "chat_id": chat, "text": format_html(p, cur), "parse_mode": "HTML",
            "disable_web_page_preview": "false",
        })
        if not r.ok:
            log.error("Telegram send failed: %s %s", r.status_code, r.text[:200])


def send_email(deals: list[Product], cur: str) -> None:
    host, user, pw, to = (os.getenv(k) for k in ("SMTP_HOST", "SMTP_USER", "SMTP_PASSWORD", "ALERT_EMAIL_TO"))
    if not (host and user and pw and to):
        return
    msg = EmailMessage()
    msg["Subject"] = f"Deal alert: {len(deals)} deal(s) at 40%+ off"
    msg["From"], msg["To"] = user, to
    msg.set_content("\n\n".join(format_text(p, cur) for p in deals))
    msg.add_alternative("<br><br>".join(format_html(p, cur).replace("\n", "<br>") for p in deals),
                        subtype="html")
    with smtplib.SMTP_SSL(host, int(os.getenv("SMTP_PORT", "465")), timeout=30) as s:
        s.login(user, pw)
        s.send_message(msg)


def notify(deals: list[Product], cur: str, dry_run: bool = False) -> None:
    for p in deals:
        print(format_text(p, cur), end="\n\n")
    if dry_run or not deals:
        return
    send_telegram(deals, cur)
    try:
        send_email(deals, cur)
    except (smtplib.SMTPException, OSError) as e:
        log.error("Email send failed: %s", e)
