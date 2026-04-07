# Treasury Intelligence Dashboard — Claude Code Optimization Prompt

**Project location:** `C:\Users\jorge.jimenez\Documents\CLAUDE_PROJECTS\Treasury-Dashboard`
**Live site:** https://jorgejimenez-crypto.github.io/Treasury-Dashboard/
**Worker:** https://treasury-proxy.treasurydashboard.workers.dev
**Files to modify:** `docs/index.html`, `docs/app.js`, `docs/style.css`, `proxy/worker.js`
**Stack:** Vanilla JS only. GitHub Pages (static). Cloudflare Worker proxy. Chart.js v4 + chartjs-plugin-datalabels. Zero cost constraint — no paid APIs, no npm build step.

---

## Current Architecture (read before touching anything)

The dashboard is a single-page vanilla JS app. `app.js` fetches from the Cloudflare Worker (`treasury-proxy.treasurydashboard.workers.dev`) at two endpoints:

- `/api/market-data` — full payload (Yahoo Finance + FRED + NY Fed), runs on 15-min timer
- `/api/ticker` — lightweight 9-symbol Yahoo payload, runs every 10s during market hours

`renderDashboard(data)` populates all panels. `tickerRefresh()` only updates the scrolling ticker bar + Commodities + Movers + Risk panels. FRED data (`data.fred`, `data.macro`) is only available from `/api/market-data` — never from the ticker endpoint. Do not merge these data paths.

**Current 3-column CSS grid panel order (source order in `index.html`):**

| Row | Col 1 | Col 2 | Col 3 |
|-----|-------|-------|-------|
| 1 | `panel-calendar` | `panel-live` | `panel-news` |
| 2 | `panel-yields` | `panel-commodities` | `panel-equities` |
| 3 | `panel-forex` | `panel-macro` | `panel-funding` |
| 4 | `panel-risk` | `panel-movers` | — |

**Key data objects available in `renderDashboard(data)`:**

- `data.yahoo` — keyed by symbol: `WTI`, `Brent`, `NatGas`, `HeatOil`, `Copper`, `Gold`, `Silver`, `SP500`, `DOW`, `NASDAQ`, `RUSSELL`, `EURUSD`, `GBPUSD`, `USDJPY`, `AUDUSD`, `USDCAD`, `USDCHF`, `USDCNH`, `DXY`, `VIX`. Each has `{current, prior, date, group}`.
- `data.fred` — keyed by FRED series ID: `DGS3MO`, `DGS6MO`, `DGS1`, `DGS2`, `DGS5`, `DGS10`, `DGS30`, `RRPONTSYD`, `BAMLC0A0CM`, `BAMLH0A0HYM2`. Each has `{current, prior, date}`.
- `data.macro` — `FEDFUNDS`, `CPIAUCSL`, `CPILFESL`, `PPIACO`, `UNRATE`, `ICSA`, `A191RL1Q225SBEA`, `WM2NS`.
- `data.nyfed` — `{sofr: {rate, date, volume}, effr: {rate, date, volume}}`.
- `data.fomc` — `{next, daysAway, dates[]}`.

**After any change to `proxy/worker.js`:** Run `npx wrangler deploy` from the `proxy/` folder. GitHub push alone does NOT redeploy the Cloudflare Worker.

**After changes to `docs/`:** Push to GitHub main — GitHub Pages auto-deploys in ~2 min.

---

## Tasks — implement in this exact order

---

### TASK 1 — Remove Equity Indices panel, add equities to ticker bar

**Problem:** `panel-equities` (S&P 500, Dow Jones, Nasdaq, Russell 2000) takes up 1/3 of a row. This data is lower priority than macro/credit for treasury operations. The scrolling ticker already has SP500 — the others should join it there.

**`docs/index.html`** — Delete the entire `panel-equities` section:

```html
<section class="panel" id="panel-equities">
  <h2>Equity Indices</h2>
  <div class="metrics-grid cols-2" id="equities-grid"></div>
</section>
```

**`docs/app.js`** — Update `TICKER_SYMBOLS` and `TICKER_LABELS` to include all four indices:

```javascript
var TICKER_SYMBOLS = ['SP500', 'DOW', 'NASDAQ', 'RUSSELL', 'WTI', 'Brent', 'NatGas', 'HeatOil', 'Gold', 'Silver', 'VIX', 'DXY'];
var TICKER_LABELS = {
  SP500: 'S&P 500', DOW: 'Dow Jones', NASDAQ: 'Nasdaq', RUSSELL: 'Russell 2k',
  WTI: 'WTI Crude (CL=F)', Brent: 'Brent (BZ=F)', NatGas: 'Nat Gas (NG=F)',
  HeatOil: 'Heat Oil (HO=F)', Gold: 'Gold (GC=F)', Silver: 'Silver (SI=F)',
  VIX: 'CBOE VIX', DXY: 'US Dollar (DXY)'
};
```

**`proxy/worker.js`** — Add DOW, NASDAQ, RUSSELL to `TICKER_SYMBOLS_WORKER` so the 10s refresh includes them:

```javascript
var TICKER_SYMBOLS_WORKER = [
  { key: 'SP500',   symbol: '%5EGSPC',  group: 'equities' },
  { key: 'DOW',     symbol: '%5EDJI',   group: 'equities' },
  { key: 'NASDAQ',  symbol: '%5EIXIC',  group: 'equities' },
  { key: 'RUSSELL', symbol: '%5ERUT',   group: 'equities' },
  { key: 'WTI',     symbol: 'CL%3DF',   group: 'commodities' },
  { key: 'Brent',   symbol: 'BZ%3DF',   group: 'commodities' },
  { key: 'NatGas',  symbol: 'NG%3DF',   group: 'commodities' },
  { key: 'HeatOil', symbol: 'HO%3DF',   group: 'commodities' },
  { key: 'Gold',    symbol: 'GC%3DF',   group: 'commodities' },
  { key: 'Silver',  symbol: 'SI%3DF',   group: 'commodities' },
  { key: 'VIX',     symbol: '%5EVIX',   group: 'risk' },
  { key: 'DXY',     symbol: 'DX-Y.NYB', group: 'risk' },
];
```

**`docs/app.js`** — Remove `renderEquities()` call from `renderDashboard()`. Remove its `addSourceAttribution('panel-equities', ...)` call. Keep `EQUITY_KEYS` and `EQUITY_LABELS` defined — do not delete them.

**New grid layout after removing equities (10 panels, 3-col grid):**

| Row | Col 1 | Col 2 | Col 3 |
|-----|-------|-------|-------|
| 1 | calendar | live | news |
| 2 | yields | commodities | forex |
| 3 | macro | funding | risk |
| 4 | movers | — | — |

---

### TASK 2 — Fix TradingView widget (not displaying)

**Problem:** The TradingView `embed-widget-symbol-overview` in `panel-commodities` is not rendering. The inline `<script>` at the bottom of `index.html` runs after `app.js` but has a container structure conflict and timing issue.

**`docs/index.html`** — Remove the entire inline TradingView `<script>` block at the bottom of the file (the IIFE starting with `(function() {` that injects the TradingView widget).

**`docs/app.js`** — Add `initTradingView()` and call it at the end of `renderDashboard()`, guarded by a one-time flag:

```javascript
var tvInitialized = false;

function initTradingView() {
  if (tvInitialized) return;
  var wrap = document.getElementById('tradingview-widget');
  if (!wrap) return;
  tvInitialized = true;

  var container = document.createElement('div');
  container.className = 'tradingview-widget-container';
  container.style.height = '220px';
  container.style.width = '100%';

  var inner = document.createElement('div');
  inner.className = 'tradingview-widget-container__widget';
  container.appendChild(inner);

  var config = {
    symbols: [
      ['WTI Crude', 'NYMEX:CL1!|1D'],
      ['Brent',     'NYMEX:BZ1!|1D'],
      ['Nat Gas',   'NYMEX:NG1!|1D'],
      ['Heat Oil',  'NYMEX:HO1!|1D']
    ],
    chartOnly: false,
    width: '100%',
    height: 220,
    locale: 'en',
    colorTheme: 'dark',
    autosize: true,
    showVolume: false,
    hideDateRanges: false,
    hideMarketStatus: false,
    hideSymbolLogo: true,
    scalePosition: 'right',
    scaleMode: 'Normal',
    fontFamily: '-apple-system, BlinkMacSystemFont, Segoe UI, sans-serif',
    fontSize: '10',
    noTimeScale: false,
    valuesTracking: '1',
    changeMode: 'price-and-percent',
    chartType: 'area',
    lineWidth: 2,
    lineType: 0,
    dateRanges: ['1d|1', '1w|15', '1m|60', '3m|1D']
  };

  var script = document.createElement('script');
  script.type = 'text/javascript';
  script.src = 'https://s3.tradingview.com/external-embedding/embed-widget-symbol-overview.js';
  script.async = true;
  script.textContent = JSON.stringify(config);
  container.appendChild(script);

  wrap.innerHTML = '';
  wrap.appendChild(container);
}
```

Call `initTradingView()` at the end of `renderDashboard()`, after all other render calls.

> **Note:** `autosize: true` is required for the widget to fill the panel width. The `.tradingview-widget-container__widget` div must exist before the script runs — this is why the container is built first, then the script appended.

---

### TASK 3 — Yield curve chart: overlay T-1 and T-2 prior days

**Problem:** The yield curve chart shows only today's curve. Treasury ops need T-1 and T-2 overlaid to track parallel shifts, bear/bull steepening, and inversions developing over time.

**`proxy/worker.js`** — In `fetchFREDSeries()`, add `t2` to the returned object:

```javascript
return {
  id:      series.id,
  current: parseFloat(obs[0].value),                              // T
  prior:   obs.length >= 2 ? parseFloat(obs[1].value) : null,    // T-1
  t2:      obs.length >= 3 ? parseFloat(obs[2].value) : null,    // T-2
  date:    obs[0].date,
  label:   series.label,
};
```

**`docs/app.js`** — Rewrite `renderYieldCurve(fred)` to render three datasets:

```javascript
function renderYieldCurve(fred) {
  var labels = [], valuesT = [], valuesT1 = [], valuesT2 = [];
  for (var i = 0; i < CURVE_KEYS.length; i++) {
    var d = fred[CURVE_KEYS[i]];
    labels.push(CURVE_LABELS[i]);
    valuesT.push(d && d.current != null ? d.current : null);
    valuesT1.push(d && d.prior   != null ? d.prior   : null);
    valuesT2.push(d && d.t2      != null ? d.t2      : null);
  }

  var datasets = [
    {
      label: 'Today',
      data: valuesT,
      borderColor: '#3b82f6',
      backgroundColor: 'rgba(59,130,246,0.08)',
      fill: true, tension: 0.3, pointRadius: 5,
      pointBackgroundColor: '#3b82f6',
      borderWidth: 2,
    },
    {
      label: 'T-1',
      data: valuesT1,
      borderColor: '#64748b',
      backgroundColor: 'transparent',
      fill: false, tension: 0.3, pointRadius: 3,
      borderDash: [4, 3], borderWidth: 1.5,
    },
    {
      label: 'T-2',
      data: valuesT2,
      borderColor: '#374151',
      backgroundColor: 'transparent',
      fill: false, tension: 0.3, pointRadius: 2,
      borderDash: [2, 4], borderWidth: 1,
    }
  ];

  // ... Chart.js construction using these three datasets ...
  // datalabels plugin: only show labels on dataset index 0 (Today)
  // Set datalabels display: false on T-1 and T-2 datasets
}
```

Add an inline HTML legend below the canvas (not Chart.js legend — too bulky):

```javascript
var legendDiv = document.createElement('div');
legendDiv.className = 'yield-curve-legend';
legendDiv.innerHTML =
  '<span><span class="ycl-swatch" style="background:#3b82f6"></span>Today</span>' +
  '<span><span class="ycl-swatch" style="background:#64748b"></span>T-1</span>' +
  '<span><span class="ycl-swatch" style="background:#374151;border:1px solid #64748b"></span>T-2</span>';
// Insert legendDiv after the canvas container
```

**`docs/style.css`** — Add legend styles:

```css
.yield-curve-legend {
  display: flex;
  gap: 12px;
  margin-top: 6px;
  font-size: 10px;
  color: var(--text-muted);
}
.ycl-swatch {
  display: inline-block;
  width: 20px;
  height: 3px;
  border-radius: 2px;
  margin-right: 4px;
  vertical-align: middle;
}
```

Run `npx wrangler deploy` after the worker change.

---

### TASK 4 — News & Intelligence: prioritize recency and relevance

**Context:** Age filtering (72h) and financial keyword gating are already implemented in the current codebase. The remaining issues are display-side sorting and visual tagging.

**`docs/app.js`** — In `fetchNews()`, sort so that Federal Reserve and ECB items are pinned to the top, then sort remaining items by date descending:

```javascript
deduped.sort(function(a, b) {
  if (a.isGov && !b.isGov) return -1;
  if (!a.isGov && b.isGov) return 1;
  return new Date(b.date || 0) - new Date(a.date || 0);
});
```

**`docs/app.js`** — In `renderNews()`, cap display at 20 items (currently 15). Add a "last updated" timestamp to the panel header using the most recent article's `date` field.

**`docs/style.css`** — Ensure all tag color classes exist with distinct colors:

```css
.news-tag-FED         { background: rgba(59,130,246,0.15);  color: var(--blue);    }
.news-tag-INFLATION   { background: rgba(249,115,22,0.15);  color: #f97316;        }
.news-tag-RATES       { background: rgba(6,182,212,0.15);   color: var(--cyan);    }
.news-tag-LABOR       { background: rgba(234,179,8,0.15);   color: var(--yellow);  }
.news-tag-GDP         { background: rgba(34,197,94,0.15);   color: var(--green);   }
.news-tag-COMMODITIES { background: rgba(217,119,6,0.15);   color: #d97706;        }
.news-tag-MARKETS     { background: rgba(125,141,161,0.15); color: var(--text-muted); }
.news-tag-FX          { background: rgba(34,197,94,0.15);   color: var(--green);   }
.news-tag-CREDIT      { background: rgba(167,139,250,0.15); color: var(--purple);  }
.news-tag-MACRO       { background: rgba(239,68,68,0.15);   color: var(--red);     }
```

---

### TASK 5 — Energy Movers: compact to a full-width chip strip

**Problem:** The Energy Movers panel occupies a full 1/3 column with a vertical list. Its only unique value is the ranked ordering by % move — this fits better as a compact horizontal strip.

**`docs/style.css`** — Add chip strip styles:

```css
.movers-strip {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  padding: 4px 0;
}
.mover-chip {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 5px 9px;
  border-radius: 4px;
  border: 1px solid var(--border);
  background: var(--bg-card-alt);
  font-family: var(--font-mono);
  font-size: 11px;
  min-width: 0;
}
.mover-chip-name  { color: var(--text-muted); font-size: 10px; text-transform: uppercase; letter-spacing: 0.3px; }
.mover-chip-price { color: var(--text); font-weight: 600; }
.mover-chip-pct   { font-weight: 600; }
.mover-chip.chip-up   { border-color: rgba(34,197,94,0.25); }
.mover-chip.chip-down { border-color: rgba(239,68,68,0.25); }
.mover-chip.chip-up   .mover-chip-pct { color: var(--green); }
.mover-chip.chip-down .mover-chip-pct { color: var(--red);   }
```

**`docs/app.js`** — Replace `renderMovers()` to output horizontal chips:

```javascript
function renderMovers(yahoo) {
  var container = document.getElementById('movers-content');
  if (!container) return;
  var movers = [];
  for (var i = 0; i < MOVERS_KEYS.length; i++) {
    var k = MOVERS_KEYS[i];
    var d = yahoo[k];
    if (d && d.current != null && d.prior != null) {
      var pct = pctChange(d.current, d.prior);
      if (pct != null) movers.push({ key: k, price: d.current, pct: pct });
    }
  }
  movers.sort(function(a, b) { return Math.abs(b.pct) - Math.abs(a.pct); });

  var strip = document.createElement('div');
  strip.className = 'movers-strip';
  for (var j = 0; j < movers.length; j++) {
    var m = movers[j];
    var isNonDollar = m.key === 'VIX' || m.key === 'DXY';
    var prefix = isNonDollar ? '' : '$';
    var chip = document.createElement('div');
    chip.className = 'mover-chip ' + (m.pct >= 0 ? 'chip-up' : 'chip-down');
    chip.innerHTML =
      '<span class="mover-chip-name">' + MOVERS_LABELS[m.key] + '</span>' +
      '<span class="mover-chip-price">' + prefix + m.price.toFixed(2) + '</span>' +
      '<span class="mover-chip-pct">' + sign(m.pct) + m.pct.toFixed(2) + '%</span>';
    strip.appendChild(chip);
  }
  container.innerHTML = '';
  container.appendChild(strip);
}
```

**`docs/style.css`** — Make `panel-movers` span full width and stay compact at the bottom of the grid:

```css
#panel-movers {
  grid-column: 1 / -1;
  max-height: 130px;
  overflow: hidden;
}
```

---

### TASK 6 — Economic Calendar: color-coded impact legend

**Problem:** The calendar uses urgency coloring (`cal-urgency-high` = yellow, FOMC = blue label) but there's no legend explaining the color system.

**`docs/app.js`** — In `renderCalendar()`, insert a legend `<div>` above the table:

```javascript
var legend = document.createElement('div');
legend.className = 'cal-legend';
legend.innerHTML =
  '<span class="cal-legend-item"><span class="cal-legend-dot dot-high"></span>High Impact</span>' +
  '<span class="cal-legend-item"><span class="cal-legend-dot dot-medium"></span>Medium</span>' +
  '<span class="cal-legend-item"><span class="cal-legend-dot dot-fomc"></span>FOMC</span>' +
  '<span class="cal-legend-item"><span class="cal-legend-dot dot-today"></span>Today</span>';
container.insertBefore(legend, table);
```

**`docs/app.js`** — Add medium impact tier. Define in CONFIG section:

```javascript
var MEDIUM_IMPACT_KEYWORDS = ['PMI', 'Retail', 'Durable', 'UMich', 'Claims', 'Sentiment'];
```

In the calendar render loop, apply `cal-urgency-medium` class when an event matches medium keywords but not high ones.

**`docs/style.css`** — Add legend and medium impact styles:

```css
.cal-legend {
  display: flex;
  gap: 12px;
  margin-bottom: 8px;
  padding-bottom: 6px;
  border-bottom: 1px solid var(--border);
}
.cal-legend-item {
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 10px;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.3px;
}
.cal-legend-dot {
  width: 8px;
  height: 8px;
  border-radius: 2px;
  flex-shrink: 0;
}
.dot-high   { background: var(--yellow); }
.dot-medium { background: var(--text-muted); }
.dot-fomc   { background: var(--blue); }
.dot-today  { background: rgba(59,130,246,0.3); border: 1px solid var(--blue); }

.cal-urgency-medium td { color: var(--text); }
.cal-urgency-medium .cal-event { font-weight: 500; }
```

---

### TASK 7 — Bloomberg TV: verify positioning and embed

**Context:** `panel-live` is already correctly placed at Row 1, Col 2 (between Calendar and News). No repositioning needed. Verify the following are correct and fix if not.

**`docs/app.js`** `initLiveStreams()` — Confirm embed URL is:
```
https://www.youtube.com/embed/live_stream?channel=UCIALMKvObZNtJ6AmdCLP7Lg&autoplay=1&mute=1&playsinline=1&modestbranding=1&rel=0
```

**`docs/style.css`** — Confirm these rules exist and are correct:
```css
.live-streams { display: grid; grid-template-columns: 1fr; gap: 8px; }
.live-stream-slot iframe { width: 100%; aspect-ratio: 16 / 9; border: 1px solid var(--border); border-radius: 4px; background: #000; }
```

No other changes needed for this panel.

---

### TASK 8 — Final grid layout

After Tasks 1–7, the final panel source order in `index.html` must be:

```
Row 1: panel-calendar | panel-live | panel-news
Row 2: panel-yields   | panel-commodities | panel-forex
Row 3: panel-macro    | panel-funding     | panel-risk
Row 4: panel-movers   (spans all 3 columns via grid-column: 1 / -1)
```

Verify this order matches the HTML source. `panel-equities` must be fully removed.

---

## Deployment sequence

```bash
# 1. Deploy updated worker (required for T-2 yield data + equity ticker symbols)
cd proxy
git pull origin main
npx wrangler deploy

# 2. Push docs changes to GitHub Pages
cd ..
git add docs/ proxy/
git commit -m "feat: equity ticker, TV widget, T-1/T-2 yields, news sort, movers compact, calendar legend"
git push origin main
```

Then clear stale localStorage and force a fresh data fetch:

```javascript
// Paste in browser console on the live dashboard:
localStorage.clear(); location.reload();
```

---

## Do NOT touch

- `WORKER_URL` value in `app.js`
- `renderFunding()`, `renderYields()`, `renderMacro()` render logic — confirmed working
- `cachedFred` / `cachedYahoo` merge logic in `tickerRefresh()`
- `fetchFREDSeries()` base URL and auth logic — only add the `t2` field
- `wrangler.toml`
- Print CSS (`@media print` block in `style.css`)
