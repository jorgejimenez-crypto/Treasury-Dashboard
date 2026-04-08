# Treasury Intelligence Dashboard — Claude Code Optimization Prompt

## FIRST: Read all files before touching anything

```bash
Read docs/index.html
Read docs/app.js
Read docs/style.css
Read proxy/worker.js
```

**Project location:** `C:\Users\JORGE-PC\Documents\Treasury\treasury dashboard`
**Live site:** https://jorgejimenez-crypto.github.io/Treasury-Dashboard/
**Worker:** https://treasury-proxy.treasurydashboard.workers.dev
**Files to modify:** `docs/index.html`, `docs/app.js`, `docs/style.css`, `proxy/worker.js`
**Stack:** Vanilla JS only. GitHub Pages (static). Cloudflare Worker proxy. Chart.js v4 + chartjs-plugin-datalabels. Zero cost — no paid APIs, no npm build step.

---

## Architecture — critical, read before any edit

The dashboard is a single-page vanilla JS app. `app.js` fetches from the Cloudflare Worker at two endpoints:

- `/api/market-data` — full payload (Yahoo Finance + FRED + NY Fed), 15-min timer
- `/api/ticker` — lightweight 9-symbol Yahoo-only payload, every 10s during market hours

`renderDashboard(data)` populates all panels. `tickerRefresh()` only updates the scrolling ticker bar + Commodities + Movers + Risk panels. **FRED data (`data.fred`, `data.macro`) is only available from `/api/market-data` — never merge these two data paths.**

**Current 3-column CSS grid panel order (HTML source order):**

| Row | Col 1 | Col 2 | Col 3 |
|-----|-------|-------|-------|
| 1 | `panel-calendar` | `panel-live` | `panel-news` |
| 2 | `panel-yields` | `panel-commodities` | `panel-equities` |
| 3 | `panel-forex` | `panel-macro` | `panel-funding` |
| 4 | `panel-risk` | `panel-movers` | — |

**Data objects in `renderDashboard(data)`:**

- `data.yahoo` — `WTI`, `Brent`, `NatGas`, `HeatOil`, `Copper`, `Gold`, `Silver`, `SP500`, `DOW`, `NASDAQ`, `RUSSELL`, `EURUSD`, `GBPUSD`, `USDJPY`, `AUDUSD`, `USDCAD`, `USDCHF`, `USDCNH`, `DXY`, `VIX` — each `{current, prior, date, group}`
- `data.fred` — `DGS3MO`, `DGS6MO`, `DGS1`, `DGS2`, `DGS5`, `DGS10`, `DGS30`, `RRPONTSYD`, `BAMLC0A0CM`, `BAMLH0A0HYM2` — each `{current, prior, date}`
- `data.macro` — `FEDFUNDS`, `CPIAUCSL`, `CPILFESL`, `PPIACO`, `UNRATE`, `ICSA`, `A191RL1Q225SBEA`, `WM2NS`
- `data.nyfed` — `{sofr: {rate, date, volume}, effr: {rate, date, volume}}`
- `data.fomc` — `{next, daysAway, dates[]}`

**Deployment rules — enforce strictly:**
- Any change to `proxy/worker.js` → must run `npx wrangler deploy` from the `proxy/` folder. GitHub push alone does NOT redeploy the Worker.
- Any change to `docs/` → push to GitHub main. GitHub Pages auto-deploys in ~2 min.
- After all changes → clear localStorage in browser console: `localStorage.clear(); location.reload();`

---

## DO NOT TOUCH — ever

- `WORKER_URL` value in `app.js`
- `renderFunding()`, `renderYields()`, `renderMacro()` render logic — confirmed working
- `cachedFred` / `cachedYahoo` merge logic in `tickerRefresh()`
- `fetchFREDSeries()` base URL and auth logic — only add `t2` field in Task 3
- `wrangler.toml`
- `@media print` block in `style.css`

---

## Tasks — implement in this exact order, one at a time

---

### TASK 1 — Remove Equity Indices panel; move equities to ticker bar

**Why:** `panel-equities` consumes 1/3 of a row for data that belongs in the ticker. Removing it frees a row slot and declutters the grid.

**`docs/index.html`** — Delete this entire section:

```html
<section class="panel" id="panel-equities">
  <h2>Equity Indices</h2>
  <div class="metrics-grid cols-2" id="equities-grid"></div>
</section>
```

**`docs/app.js`** — Replace `TICKER_SYMBOLS` and `TICKER_LABELS` with:

```javascript
var TICKER_SYMBOLS = ['SP500', 'DOW', 'NASDAQ', 'RUSSELL', 'WTI', 'Brent', 'NatGas', 'HeatOil', 'Gold', 'Silver', 'VIX', 'DXY'];
var TICKER_LABELS = {
  SP500: 'S&P 500', DOW: 'Dow Jones', NASDAQ: 'Nasdaq', RUSSELL: 'Russell 2k',
  WTI: 'WTI Crude (CL=F)', Brent: 'Brent (BZ=F)', NatGas: 'Nat Gas (NG=F)',
  HeatOil: 'Heat Oil (HO=F)', Gold: 'Gold (GC=F)', Silver: 'Silver (SI=F)',
  VIX: 'CBOE VIX', DXY: 'US Dollar (DXY)'
};
```

**`docs/app.js`** — Remove `renderEquities(data.yahoo)` call from `renderDashboard()`. Remove `addSourceAttribution('panel-equities', ...)` call. Keep `EQUITY_KEYS` and `EQUITY_LABELS` variables defined — do not delete them.

**`proxy/worker.js`** — Replace `TICKER_SYMBOLS_WORKER` with:

```javascript
var TICKER_SYMBOLS_WORKER = [
  { key: 'SP500',   symbol: '%5EGSPC',  group: 'equities'    },
  { key: 'DOW',     symbol: '%5EDJI',   group: 'equities'    },
  { key: 'NASDAQ',  symbol: '%5EIXIC',  group: 'equities'    },
  { key: 'RUSSELL', symbol: '%5ERUT',   group: 'equities'    },
  { key: 'WTI',     symbol: 'CL%3DF',   group: 'commodities' },
  { key: 'Brent',   symbol: 'BZ%3DF',   group: 'commodities' },
  { key: 'NatGas',  symbol: 'NG%3DF',   group: 'commodities' },
  { key: 'HeatOil', symbol: 'HO%3DF',   group: 'commodities' },
  { key: 'Gold',    symbol: 'GC%3DF',   group: 'commodities' },
  { key: 'Silver',  symbol: 'SI%3DF',   group: 'commodities' },
  { key: 'VIX',     symbol: '%5EVIX',   group: 'risk'        },
  { key: 'DXY',     symbol: 'DX-Y.NYB', group: 'risk'        },
];
```

**Target grid layout after this task:**

| Row | Col 1 | Col 2 | Col 3 |
|-----|-------|-------|-------|
| 1 | calendar | live | news |
| 2 | yields | commodities | forex |
| 3 | macro | funding | risk |
| 4 | movers | — | — |

**Deploy worker after this task:** `cd proxy && npx wrangler deploy`

---

### TASK 2 — Fix TradingView energy chart (not displaying)

**Why:** The inline `<script>` IIFE at the bottom of `index.html` has a container structure conflict. The widget must be initialized after the DOM is ready and `renderDashboard()` has run.

**`docs/index.html`** — Remove the entire TradingView inline script block at the bottom of the file. It starts with:
```javascript
(function() {
  var wrap = document.getElementById('tradingview-widget');
```
Delete everything from that line through the closing `})();` and `</script>` tag.

**`docs/app.js`** — Add this function and the guard variable near the top of the file (after the STATE section):

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

**`docs/app.js`** — At the very end of `renderDashboard()`, after all other render calls and `addSourceAttribution` lines, add:

```javascript
initTradingView();
```

> `autosize: true` is required. The `.tradingview-widget-container__widget` div must exist in the DOM before the script tag is appended — which is why the container is constructed first.

---

### TASK 3 — Yield curve: overlay T-1 and T-2 prior trading days

**Why:** A single-day curve shows shape but not movement. Overlaying T-1 and T-2 lets you spot parallel shifts, bear/bull steepening, and inversion progression at a glance.

**`proxy/worker.js`** — In `fetchFREDSeries()`, find the return statement and add `t2`:

```javascript
return {
  id:      series.id,
  current: parseFloat(obs[0].value),
  prior:   obs.length >= 2 ? parseFloat(obs[1].value) : null,
  t2:      obs.length >= 3 ? parseFloat(obs[2].value) : null,
  date:    obs[0].date,
  label:   series.label,
};
```

The FRED call already uses `limit=5` so obs[2] is available without any URL change.

**`docs/app.js`** — Fully replace `renderYieldCurve(fred)` with:

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
  var canvas = document.getElementById('yield-curve-canvas');
  var ctx = canvas.getContext('2d');

  var datasets = [
    {
      label: 'Today',
      data: valuesT,
      borderColor: '#3b82f6',
      backgroundColor: 'rgba(59,130,246,0.08)',
      fill: true, tension: 0.3, pointRadius: 5,
      pointBackgroundColor: '#3b82f6',
      pointBorderColor: '#0a0e14',
      pointBorderWidth: 2,
      borderWidth: 2,
      datalabels: {
        display: true,
        color: '#e6edf3',
        anchor: 'end', align: 'top', offset: 2,
        font: { size: 10, family: 'Consolas, monospace', weight: '600' },
        formatter: function(v) { return v != null ? v.toFixed(2) + '%' : ''; }
      }
    },
    {
      label: 'T-1',
      data: valuesT1,
      borderColor: '#64748b',
      backgroundColor: 'transparent',
      fill: false, tension: 0.3, pointRadius: 3,
      borderDash: [4, 3], borderWidth: 1.5,
      datalabels: { display: false }
    },
    {
      label: 'T-2',
      data: valuesT2,
      borderColor: '#374151',
      backgroundColor: 'transparent',
      fill: false, tension: 0.3, pointRadius: 2,
      borderDash: [2, 4], borderWidth: 1,
      datalabels: { display: false }
    }
  ];

  if (yieldCurveChart) {
    yieldCurveChart.data.labels = labels;
    yieldCurveChart.data.datasets = datasets;
    yieldCurveChart.update();
  } else {
    yieldCurveChart = new Chart(ctx, {
      type: 'line',
      plugins: [ChartDataLabels],
      data: { labels: labels, datasets: datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        layout: { padding: { top: 20 } },
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: function(ctx) {
                return ctx.dataset.label + ': ' + (ctx.parsed.y != null ? ctx.parsed.y.toFixed(2) + '%' : 'N/A');
              }
            }
          }
        },
        scales: {
          x: { ticks: { color: '#7d8da1', font: { size: 10 } }, grid: { color: 'rgba(30,42,58,0.5)' } },
          y: { ticks: { color: '#7d8da1', font: { size: 10 }, callback: function(v) { return v.toFixed(1) + '%'; } }, grid: { color: 'rgba(30,42,58,0.5)' } }
        }
      }
    });
  }

  // Inline legend below chart
  var existingLegend = canvas.parentElement.parentElement.querySelector('.yield-curve-legend');
  if (!existingLegend) {
    var legendDiv = document.createElement('div');
    legendDiv.className = 'yield-curve-legend';
    legendDiv.innerHTML =
      '<span><span class="ycl-swatch" style="background:#3b82f6"></span>Today</span>' +
      '<span><span class="ycl-swatch" style="background:#64748b;height:2px;border-style:dashed"></span>T-1</span>' +
      '<span><span class="ycl-swatch" style="background:#374151;height:1px;border-style:dashed"></span>T-2</span>';
    canvas.parentElement.parentElement.appendChild(legendDiv);
  }
}
```

**`docs/style.css`** — Add:

```css
.yield-curve-legend {
  display: flex;
  gap: 14px;
  margin-top: 6px;
  font-size: 10px;
  color: var(--text-muted);
  padding-left: 4px;
}
.yield-curve-legend span {
  display: flex;
  align-items: center;
  gap: 5px;
}
.ycl-swatch {
  display: inline-block;
  width: 22px;
  height: 3px;
  border-radius: 2px;
  flex-shrink: 0;
}
```

**Deploy worker after this task:** `cd proxy && npx wrangler deploy`

---

### TASK 4 — News & Intelligence: gov pinning, tag colors, recency cap

**`docs/app.js`** — In `fetchNews()`, replace the final sort before `renderNews()` with:

```javascript
// Pin gov sources (Fed, ECB) to top; sort rest by date descending
deduped.sort(function(a, b) {
  if (a.isGov && !b.isGov) return -1;
  if (!a.isGov && b.isGov) return 1;
  return new Date(b.date || 0) - new Date(a.date || 0);
});
```

**`docs/app.js`** — In `renderNews(items)`, change the loop cap from `i < 15` to `i < 20`. Also add a last-updated timestamp to the news panel header. After rendering items, find the `news-count` badge and add a sibling span:

```javascript
// After setting countBadge.textContent:
var existingTs = document.getElementById('news-updated');
if (existingTs) existingTs.remove();
if (items.length > 0 && items[0].date) {
  var tsSpan = document.createElement('span');
  tsSpan.id = 'news-updated';
  tsSpan.className = 'news-updated';
  tsSpan.textContent = 'Updated ' + formatTime(items[0].date);
  countBadge.parentElement.appendChild(tsSpan);
}
```

**`docs/style.css`** — Add or replace all news tag classes and the timestamp style:

```css
.news-tag-FED         { background: rgba(59,130,246,0.15);  color: var(--blue);       }
.news-tag-INFLATION   { background: rgba(249,115,22,0.15);  color: #f97316;            }
.news-tag-RATES       { background: rgba(6,182,212,0.15);   color: var(--cyan);        }
.news-tag-LABOR       { background: rgba(234,179,8,0.15);   color: var(--yellow);      }
.news-tag-GDP         { background: rgba(34,197,94,0.15);   color: var(--green);       }
.news-tag-COMMODITIES { background: rgba(217,119,6,0.15);   color: #d97706;            }
.news-tag-MARKETS     { background: rgba(125,141,161,0.15); color: var(--text-muted);  }
.news-tag-FX          { background: rgba(34,197,94,0.15);   color: var(--green);       }
.news-tag-CREDIT      { background: rgba(167,139,250,0.15); color: var(--purple);      }
.news-tag-MACRO       { background: rgba(239,68,68,0.15);   color: var(--red);         }

.news-updated {
  font-size: 9px;
  color: var(--text-dim);
  font-family: var(--font-mono);
  margin-left: 6px;
}
```

---

### TASK 5 — Energy Movers: compact horizontal chip strip

**`docs/app.js`** — Fully replace `renderMovers(yahoo)` with:

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

**`docs/style.css`** — Add:

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
}
.mover-chip-name  { color: var(--text-muted); font-size: 10px; text-transform: uppercase; letter-spacing: 0.3px; }
.mover-chip-price { color: var(--text); font-weight: 600; }
.mover-chip-pct   { font-weight: 600; }
.mover-chip.chip-up   { border-color: rgba(34,197,94,0.25); }
.mover-chip.chip-down { border-color: rgba(239,68,68,0.25); }
.mover-chip.chip-up   .mover-chip-pct { color: var(--green); }
.mover-chip.chip-down .mover-chip-pct { color: var(--red);   }

#panel-movers {
  grid-column: 1 / -1;
  max-height: 130px;
  overflow: hidden;
}
```

---

### TASK 6 — Economic Calendar: color-coded impact legend + medium tier

**`docs/app.js`** — In the CONFIG section, add after `HIGH_IMPACT_KEYWORDS`:

```javascript
var MEDIUM_IMPACT_KEYWORDS = ['PMI', 'Retail', 'Durable', 'UMich', 'Claims', 'Sentiment'];

function isMediumImpact(eventName) {
  for (var i = 0; i < MEDIUM_IMPACT_KEYWORDS.length; i++) {
    if (eventName.indexOf(MEDIUM_IMPACT_KEYWORDS[i]) !== -1) return true;
  }
  return false;
}
```

**`docs/app.js`** — In `renderCalendar()`, after `container.innerHTML = ''` and before building the table, insert:

```javascript
var legend = document.createElement('div');
legend.className = 'cal-legend';
legend.innerHTML =
  '<span class="cal-legend-item"><span class="cal-legend-dot dot-high"></span>High Impact</span>' +
  '<span class="cal-legend-item"><span class="cal-legend-dot dot-medium"></span>Medium</span>' +
  '<span class="cal-legend-item"><span class="cal-legend-dot dot-fomc"></span>FOMC</span>' +
  '<span class="cal-legend-item"><span class="cal-legend-dot dot-today"></span>Today</span>';
container.appendChild(legend);
```

**`docs/app.js`** — In the calendar row render loop, after the existing `if (isHighImpact(e.event) || e.fomc)` block, add:

```javascript
else if (isMediumImpact(e.event)) tr.classList.add('cal-urgency-medium');
```

**`docs/style.css`** — Add:

```css
.cal-legend {
  display: flex;
  gap: 12px;
  margin-bottom: 8px;
  padding-bottom: 6px;
  border-bottom: 1px solid var(--border);
  flex-wrap: wrap;
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

### TASK 7 — Bloomberg TV: verify embed and positioning

`panel-live` is already at Row 1, Col 2. No repositioning needed. Only verify and fix if wrong.

**`docs/app.js`** — In `initLiveStreams()`, confirm the iframe `src` is:
```
https://www.youtube.com/embed/live_stream?channel=UCIALMKvObZNtJ6AmdCLP7Lg&autoplay=1&mute=1&playsinline=1&modestbranding=1&rel=0
```

**`docs/style.css`** — Confirm these rules exist exactly:
```css
.live-streams { display: grid; grid-template-columns: 1fr; gap: 8px; }
.live-stream-slot iframe { width: 100%; aspect-ratio: 16 / 9; border: 1px solid var(--border); border-radius: 4px; background: #000; }
```

If either is wrong, fix it. Otherwise skip.

---

### TASK 8 — Verify final grid layout

After Tasks 1–7, confirm the panel source order in `index.html` is exactly:

```
Row 1: panel-calendar | panel-live   | panel-news
Row 2: panel-yields   | panel-commodities | panel-forex
Row 3: panel-macro    | panel-funding     | panel-risk
Row 4: panel-movers   (grid-column: 1 / -1 via CSS — spans full width)
```

- `panel-equities` must be fully absent from the HTML
- `panel-movers` must be the last panel in source order
- No other panels should have `grid-column` overrides in the HTML

---

## Deployment sequence — run after all 8 tasks complete

```bash
# From project root:
cd proxy
git pull origin main
npx wrangler deploy

cd ..
git add docs/ proxy/
git commit -m "feat: equity ticker, TV widget fix, T-1/T-2 yields, news sort, movers strip, calendar legend"
git push origin main
```

Then in the browser console on the live dashboard:
```javascript
localStorage.clear(); location.reload();
```
