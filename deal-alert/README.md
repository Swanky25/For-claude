# Deal Alert

An alert agent that watches for **top-rated products at 40%+ off** in four
categories and messages you when it finds one:

| Category | What counts |
|---|---|
| Vacuum cleaner | Any vacuum (robot, wet & dry, cordless…), accessories/spares excluded, ≥ ₹2,000 |
| Mop | Spin / electric / steam mops, refills & pads excluded, ≥ ₹400 |
| TV | **50 inches and above** only (size read from the title, inches or cm), mounts/remotes excluded |
| Water filter | RO / UV purifiers and tap filters, candles/cartridges/membranes excluded |

## What "best ones for best prices" means here

A product is alerted only if **all** of these hold (all editable in `config.toml`):

- **≥ 40% off** the listed MRP
- **≥ 4.0 stars** from **≥ 100 ratings**, so a 5-star item with 7 reviews doesn't count
- It is the real product, not an accessory (keyword and minimum-price filters)
- At most the **top 5 per category** each run, ranked by discount plus rating
  weighted by review count

It remembers what it already sent (`state.json`) and only alerts again if the
price drops another 5%.

**Sources:** Amazon.in search results, plus community deal feeds (RSS) for deals
from other stores. Feed deals have no star rating, so they're marked
*"community deal: check reviews"*.

## Setup (≈5 minutes, free)

It runs on GitHub Actions 4 times a day (`.github/workflows/deal-alert.yml`).
You get the alerts on Telegram, by email, or both.

**Telegram (recommended):**
1. In Telegram, message **@BotFather** → `/newbot` → copy the **bot token**.
2. Send any message to your new bot, then open
   `https://api.telegram.org/bot<TOKEN>/getUpdates` and copy `"chat":{"id": …}`.
3. GitHub repo → *Settings → Secrets and variables → Actions* → add
   `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID`.

**Email (Gmail):** create an [App Password](https://myaccount.google.com/apppasswords),
then add the secrets `SMTP_HOST=smtp.gmail.com`, `SMTP_USER=<your gmail>`,
`SMTP_PASSWORD=<app password>` and `ALERT_EMAIL_TO=<where to send>`.

Then run it once from *Actions → Deal Alert → Run workflow*.

> The workflow only runs on schedule from the repository's **default branch**,
> so merge this branch first.

## Run locally

```bash
cd deal-alert
pip install -r requirements.txt
python -m deal_alert --dry-run     # print matching deals, send/save nothing
python -m deal_alert               # real run (uses env vars above)
pip install pytest && python -m pytest tests
```

## Known limitations

- **Amazon sometimes blocks automated requests** (captcha), especially from
  cloud IPs like GitHub Actions. The agent detects that, logs a warning and
  carries on with the feeds. If it happens often, run it from your own PC or a
  home server (e.g. a cron job or Windows Task Scheduler), where it is far less
  likely to be blocked.
- Store page layouts change. If Amazon results suddenly drop to 0, the HTML
  selectors in `deal_alert/sources.py` need updating.
- "MRP" is the store's listed price, and stores sometimes inflate it.
  Treat a 70%-off TV with suspicion and compare prices before buying.
- Flipkart isn't scraped directly (its markup changes very often); its deals
  arrive through the community feeds instead.
