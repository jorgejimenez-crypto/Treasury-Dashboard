# Treasury Management Dashboard

**Real-time treasury intelligence for corporate funding desks.**

A professional-grade dashboard that monitors short-term yields, overnight funding rates, FX cross-rates, and macro catalysts — all in a single institutional-dark-theme view. Built for treasury managers who need rates, spreads, and market context at a glance.

**[Live Dashboard](https://jorgejimenez-crypto.github.io/Treasury-Dashboard/)** · v0.9 Beta

---

## Key Features

- **Treasury Yields Hero** — Interactive grouped bar chart (1M / 3M / 6M) comparing T-1, T-7, and T-14 snapshots with bps deltas and datalabels on every bar
- **Funding & Liquidity** — SOFR, EFFR, SOFR 30D Average, and short-term T-Bill rates with live/stale status indicators
- **FX Converter + Cross Rates** — Split panel: live EUR/GBP/JPY/AUD/CAD/CHF rates vs USD (left) + full converter with quick treasury pairs, 250K–50M presets, pips, and copy button (right)
- **Economic Calendar** — TradingView embedded widget filtered to US high-importance events
- **Risk Summary Pills** — VIX, DXY, IG OAS, and 10Y yield color-coded by severity thresholds
- **Rate Movement Alerts** — Triggers when short-end yields shift >5 bps vs T-7 with actionable "funding costs rising/easing" messaging
- **Bloomberg TV Live** — Embedded Bloomberg Television stream with loading/error states
- **WSJ News Feed** — Filtered Wall Street Journal headlines via Google News RSS proxy
- **Market Ticker** — Scrolling strip: S&P 500, 2Y/10Y UST, DXY, WTI, Gold, EUR/USD, VIX

## Screenshots

| Yields Chart + Calendar | Funding + FX Converter |
|---|---|
| ![Row 1](docs/screenshots/row1.png) | ![Row 2](docs/screenshots/row2.png) |

> *Add screenshots by saving images to `docs/screenshots/` and pushing to the repo.*

## Technology Stack

| Component | Technology |
|---|---|
| Frontend | Vanilla JavaScript, HTML5, CSS3 |
| Charts | Chart.js v4 + chartjs-plugin-datalabels |
| Calendar | TradingView Economic Calendar widget |
| API Proxy | Cloudflare Workers (free tier) |
| Data Sources | FRED API, NY Fed API, Yahoo Finance, Google News RSS |
| Hosting | GitHub Pages (static, $0/month) |
| News | WSJ via Google News RSS aggregation (rss2json fallback) |

## Architecture

```
Browser (GitHub Pages)          Cloudflare Worker Proxy
─────────────────────           ─────────────────────────
docs/index.html                 proxy/worker.js
docs/app.js ──GET /api/───────→   ├─ /api/market-data (Yahoo + FRED + NY Fed)
docs/style.css                    ├─ /api/ticker (Yahoo, 10s refresh)
                                  └─ /api/news (Google News RSS + WSJ)
```

## Deployment

### GitHub Pages (Frontend)

The `docs/` folder is served as a static site via GitHub Pages.

1. Push changes to `main` branch
2. GitHub Pages rebuilds automatically from `docs/`
3. Live at: `https://<username>.github.io/Treasury-Dashboard/`

### Cloudflare Worker (API Proxy)

The worker proxies FRED, NY Fed, and Yahoo Finance APIs to avoid CORS and keep API keys server-side.

```bash
cd proxy

# Set secrets (one-time)
npx wrangler secret put FRED_API_KEY

# Deploy
npx wrangler deploy
```

Worker URL: `https://treasury-proxy.treasurydashboard.workers.dev`

## Local Development

```bash
# Clone
git clone https://github.com/jorgejimenez-crypto/Treasury-Dashboard.git
cd Treasury-Dashboard

# Edit frontend files in docs/
# Open docs/index.html in a browser, or use a local server:
npx serve docs

# Edit worker in proxy/
cd proxy
npx wrangler dev   # local worker dev server
```

### Cache Busting

When updating `app.js` or `style.css`, bump the version query string in `index.html`:
```html
<link rel="stylesheet" href="style.css?v=20260421">
<script src="app.js?v=20260421"></script>
```

## Changelog

### v0.9 Beta (April 2026)
- Two-column grid layout: Yields+Calendar | Funding+FX | Catalyst+News
- Grouped bar chart with T-1/T-7/T-14 comparison and zoomed Y-axis
- FX split panel: live cross rates + converter with pips and quick pairs
- TradingView Economic Calendar widget (replaced custom TE API integration)
- Risk pills (VIX, DXY, IG OAS, 10Y) and rate movement alerts
- WSJ news via Google News RSS (bypasses DJ WAF block)
- Bloomberg TV live embed with loading/error states
- About modal with project info and GitHub link

---

**Internal use only — not financial advice.**
