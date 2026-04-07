# Repository Structure

```
Treasury-Dashboard/
│
├── docs/                         # GitHub Pages root — static dashboard
│   ├── index.html                # 9-panel layout: yields, funding, risk, equities,
│   │                             # commodities, forex, macro, calendar, news
│   ├── style.css                 # Dark theme, CSS Grid, responsive, print styles
│   └── app.js                    # Client logic: fetch, render, Chart.js yield curve,
│                                 # alerts, keyboard shortcuts, panel collapse
│
├── proxy/                        # Cloudflare Worker — serverless API proxy
│   ├── worker.js                 # Two endpoints:
│   │                             #   /api/market-data — 35 parallel API calls
│   │                             #   /api/news — government RSS + optional NewsAPI
│   └── wrangler.toml             # Worker name + compatibility date
│
├── .env.example                  # Every required key with sign-up links
├── .gitignore                    # Secrets, node_modules, OS files
├── LICENSE                       # MIT
├── README.md                     # Summary, quickstart, architecture
└── STRUCTURE.md                  # This file
```

## Data flow

```
GitHub Pages (static)  --->  Cloudflare Worker  --->  Yahoo Finance (15 symbols)
  index.html                  /api/market-data        FRED API (18 series)
  style.css                   /api/news               NY Fed (SOFR, EFFR)
  app.js                                              Fed RSS, BLS RSS
  Chart.js (CDN)                                      NewsAPI (optional)
```

## Panel layout (3x3 grid + alerts)

```
[Treasury Yields + Curve] [Funding & Liquidity] [Risk & Credit    ]
[Equity Indices         ] [Commodities        ] [Forex             ]
[Macro Indicators       ] [Economic Calendar  ] [News & Intelligence]
```

## Adding new features

- **New data source**: Add fetch function to `proxy/worker.js`, include in response, render in `docs/app.js`
- **New alert**: Add threshold to `THRESHOLDS` in `app.js`, add logic to `computeAlerts()`
- **New panel**: Add `<section class="panel">` to `index.html`, add render function to `app.js`
- **New calendar event**: Add entry to `ECON_CALENDAR` array in `app.js`
- **Theme changes**: Edit CSS variables in `:root` in `style.css`
