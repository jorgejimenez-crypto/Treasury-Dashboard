# Treasury Intelligence Dashboard

Professional-grade treasury monitoring dashboard for real-time financial markets, macroeconomic indicators, and economic news. Displays 40+ metrics across 9 panels with threshold alerts, yield curve visualization, and government news feeds. Static site on GitHub Pages, API proxy on Cloudflare Workers. Total cost: $0/month.

**[Live Dashboard](https://jorgejimenez-crypto.github.io/Treasury-Dashboard/)**

## What It Shows

| Panel | Data | Source |
|-------|------|--------|
| Treasury Yields | 2Y, 5Y, 10Y, 30Y + yield curve chart (3M-30Y) | FRED |
| Funding & Liquidity | SOFR, EFFR, ON RRP, SOFR-EFFR spread | NY Fed, FRED |
| Risk & Credit | VIX, DXY, IG OAS, HY OAS | Yahoo, FRED |
| Equity Indices | S&P 500, Dow, Nasdaq, Russell 2000 | Yahoo |
| Commodities | WTI, Brent, NatGas, Heating Oil, Copper, Gold | Yahoo |
| Forex | EUR/USD, GBP/USD, USD/JPY | Yahoo |
| Macro Indicators | Fed Funds, CPI, Core CPI, PPI, Unemployment, Claims, GDP, M2 | FRED |
| Economic Calendar | FOMC dates, upcoming releases with consensus/prior | Static + FOMC |
| News & Intelligence | Federal Reserve press releases, BLS data releases | RSS feeds |

## Features

- Dark terminal theme, dense information layout
- Color-coded directional indicators on all metrics
- Yield curve chart (Chart.js)
- Threshold alerts: commodity shocks, VIX spikes, DXY breaks, 10Y level, credit widening
- Collateral/margin pressure signal for energy commodities
- FOMC countdown with blackout period awareness
- Keyboard shortcuts (R=refresh, N=news, C=calendar, ?=help)
- Collapsible panels
- Responsive: desktop, tablet, mobile
- Print/export view with light theme
- Auto-refresh every 15 minutes

## Prerequisites

| Tool | Purpose |
|------|---------|
| [FRED API key](https://fred.stlouisfed.org/docs/api/api_key.html) (free) | Yields, macro data, credit spreads |
| [Cloudflare account](https://dash.cloudflare.com/) (free) | Hosts the API proxy Worker |
| [Node.js 18+](https://nodejs.org/) | Runs Wrangler CLI for Worker deployment |
| [GitHub account](https://github.com/) | Hosts the static dashboard via Pages |

Optional: [NewsAPI key](https://newsapi.org/) for enhanced news feed beyond government RSS.

## Quickstart

```bash
# 1. Clone
git clone https://github.com/jorgejimenez-crypto/Treasury-Dashboard.git
cd Treasury-Dashboard

# 2. Deploy the API proxy
cd proxy && npm install -g wrangler && wrangler login && npx wrangler deploy

# 3. Set secrets
npx wrangler secret put FRED_API_KEY       # paste your FRED key
npx wrangler secret put NEWSAPI_KEY        # optional

# 4. Configure dashboard — edit docs/app.js line 14:
#    var WORKER_URL = 'https://treasury-proxy.YOUR_SUBDOMAIN.workers.dev';

# 5. Push and enable GitHub Pages (Settings > Pages > main branch > /docs)
cd .. && git add -A && git commit -m "Configure worker URL" && git push
```

Dashboard is live at `https://YOUR_USERNAME.github.io/Treasury-Dashboard/`

## Architecture

```
Browser (GitHub Pages)  -->  Cloudflare Worker (proxy)  -->  Yahoo / FRED / NY Fed / RSS
   static HTML/CSS/JS          hides FRED API key            free public APIs
```

**Two endpoints:**
- `GET /api/market-data` — 35 parallel API calls (15 Yahoo + 18 FRED + 2 NY Fed), cached 5 min
- `GET /api/news` — Government RSS feeds + optional NewsAPI, cached 5 min

## Alert Thresholds

| Trigger | Condition | Level |
|---------|-----------|-------|
| Commodity shock | Any energy commodity > 2% DoD | Yellow |
| Multi-book pressure | 2+ energy commodities > 2% | Red |
| VIX spike | VIX > 30 | Red |
| VIX move | VIX DoD > 15% | Yellow |
| Dollar break | DXY outside 99-105 | Yellow |
| 10Y yield | 10Y > 5.0% | Red |
| Credit widening | IG OAS > 150 bps | Yellow |

Edit thresholds in `docs/app.js` > `THRESHOLDS` object.

## Data Sources & Costs

| Source | Data | Calls/Request | Key | Cost |
|--------|------|---------------|-----|------|
| Yahoo Finance | Equities, commodities, forex, DXY, VIX | 15 | No | Free |
| FRED API | Yields (3M-30Y), ON RRP, credit spreads, macro | 18 | Yes | Free |
| NY Fed API | SOFR, EFFR | 2 | No | Free |
| Federal Reserve RSS | Press releases, FOMC statements | 1 | No | Free |
| BLS RSS | Economic data releases | 1 | No | Free |
| NewsAPI (optional) | Financial news headlines | 1 | Yes | Free tier |
| **Total** | **40+ metrics** | **37-38** | | **$0/month** |

## Repo Structure

```
Treasury-Dashboard/
├── docs/                  # GitHub Pages root
│   ├── index.html         # Dashboard layout (9 panels + alerts + modals)
│   ├── style.css          # Dark theme, responsive grid, print styles
│   └── app.js             # Data fetching, rendering, charts, shortcuts
├── proxy/                 # Cloudflare Worker
│   ├── worker.js          # API proxy: Yahoo + FRED + NY Fed + RSS
│   └── wrangler.toml      # Worker config
├── .env.example           # All required keys with sign-up links
├── .gitignore
├── LICENSE
└── README.md
```

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `R` | Refresh all data |
| `N` | Toggle news panel |
| `C` | Toggle calendar panel |
| `?` | Show shortcuts |
| `Esc` | Close modal |
| `Ctrl+P` | Print / export |

## Economic Calendar

The calendar in `app.js` > `ECON_CALENDAR` is a static array of major US releases. FOMC dates are sourced from the Federal Reserve. Update the calendar quarterly for accuracy.

## License

[MIT](LICENSE)
