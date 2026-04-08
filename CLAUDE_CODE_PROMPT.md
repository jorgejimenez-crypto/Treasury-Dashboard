# Treasury Intelligence Dashboard — Claude Code Session Prompt

> **Read this entire file before writing a single line of code.**
> Follow the tasks in order. Verify each change against the actual file before modifying it.

---

## Project Snapshot

| Item | Value |
|------|-------|
| **Local path** | `C:\Users\jorge.jimenez\Documents\CLAUDE_PROJECTS\Treasury-Dashboard` |
| **Live site** | https://jorgejimenez-crypto.github.io/Treasury-Dashboard/ |
| **Worker URL** | https://treasury-proxy.treasurydashboard.workers.dev |
| **Stack** | Vanilla JS · GitHub Pages · Cloudflare Worker · Chart.js v4 + datalabels |
| **Constraint** | Zero cost — no paid APIs, no npm build, no bundler |

---

## Architecture — Non-Negotiable Rules

The app has two data paths. **Never merge them.**

| Path | Endpoint | Cadence | Contains |
|------|----------|---------|----------|
| Full refresh | `/api/market-data` | 15 min | Yahoo + FRED + NY Fed + macro |
| Ticker refresh | `/api/ticker` | 10s (market hours) | 9–12 Yahoo symbols only |

`renderDashboard(data)` handles the full refresh and populates every panel.
`tickerRefresh()` calls `/api/ticker`, merges result into `cachedYahoo`, and calls only `renderTicker`, `renderCommodities`, `renderRisk`, `renderMovers`. **FRED data (`data.fred`, `data.macro`) is never available from the ticker endpoint.**

**Deployment rules:**
- Changes to `proxy/worker.js` → run `npx wrangler deploy` from `proxy/` (GitHub push does NOT redeploy the worker)
- Changes to `docs/` → push to GitHub main → auto-deploys in ~2 min

---

## Current Panel Grid (3 columns)

```
Row 1:  panel-calendar  |  panel-live       |  panel-news
Row 2:  panel-yields    |  panel-commodities |  panel-equities
Row 3:  panel-forex     |  panel-macro       |  panel-funding
Row 4:  panel-risk      |  panel-movers      |  —
```

**Target grid after all tasks:**
```
Row 1:  panel-calendar  |  panel-live        |  panel-news
Row 2:  panel-yields    |  panel-commodities  |  panel-forex
Row 3:  panel-macro     |  panel-funding      |  panel-risk
Row 4:  panel-movers    (spans all 3 columns — full-width footer bar)
```

---

## Data Reference

```
data.yahoo   → WTI, Brent, NatGas, HeatOil, Copper, Gold, Silver,
               SP500, DOW, NASDAQ, RUSSELL,
               EURUSD, GBPUSD, USDJPY, AUDUSD, USDCAD, USDCHF, USDCNH,
               DXY, VIX   →  each: { current, prior, date, group }

data.fred    → DGS3MO, DGS6MO, DGS1, DGS2, DGS5, DGS10, DGS30,
               RRPONTSYD, BAMLC0A0CM, BAMLH0A0HYM2  →  { current, prior, date }

data.macro   → FEDFUNDS, CPIAUCSL, CPILFESL, PPIACO, UNRATE,
               ICSA, A191RL1Q225SBEA, WM2NS

data.nyfed   → { sofr: { rate, date, volume }, effr: { rate, date, volume } }
data.fomc    → { next, daysAway, dates[] }
```

---

## Tasks — Execute in Order

---

### TASK 1 · Remove Equity Indices panel · Move equities to ticker

**Why:** `panel-equities` consumes 1/3 of a row for data that is secondary to treasury ops. The ticker bar is the right home for index levels.

**Exact changes:**

**`docs/index.html`** — Delete these 4 lines:
```html
<section class="panel" id="panel-equities">
  <h2>Equity Indices</h2>
  <div class="metrics-grid cols-2" id="equities-grid"></div>
</section>
```

**`docs/app.js`** — Replace `TICKER_SYMBOLS` and `TICKER_LABELS` (currently around line 55):
```javascript
var TICKER_SYMBOLS = ['SP500','DOW','NASDAQ','RUSSELL','WTI','Brent','NatGas','HeatOil','Gold','Silver','VIX','DXY'];
var TICKER_LABELS  = {
  SP500: 'S&P 500', DOW: 'Dow Jones', NASDAQ: 'Nasdaq', RUSSELL: 'Russell 2k',
  WTI: 'WTI Crude (CL=F)', Brent: 'Brent (BZ=F)', NatGas: 'Nat Gas (NG=F)',
  HeatOil: 'Heat Oil (HO=F)', Gold: 'Gold (GC=F)', Silver: 'Silver (SI=F)',
  VIX: 'CBOE VIX', DXY: 'US Dollar (DXY)'
};
```

**`docs/app.js`** — In `renderDashboard()` (around line 847), remove:
```javascript
renderEquities(data.yahoo);
// and
addSourceAttribution('panel-equities', 'Yahoo Finance', data.yahoo.SP500 ? data.yahoo.SP500.date : null);
```

**`docs/app.js`** — Do NOT delete `EQUITY_KEYS`, `EQUITY_LABELS`, or the `renderEquities()` function definition. Just stop calling them.

**`proxy/worker.js`** — Replace `TICKER_SYMBOLS_WORKER` with the expanded 12-symbol list:
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

**After this task:** Run `npx wrangler deploy`. Verify ticker scrolls with all 12 symbols. Verify `panel-equities` div is gone from the DOM.

---

### TASK 2 · Fix TradingView energy chart (currently not displaying)

**Why:** The inline IIFE script at the bottom of `index.html` has a timing and container structure conflict with how TradingView injects its iframe. Moving initialization into `renderDashboard()` with a one-time guard fixes it.

**`docs/index.html`** — Remove the entire block from `<!-- TradingView Widget -->` to the closing `</script>` tag before `</body>`. It starts with:
```javascript
(function() {
  var wrap = document.getElementById('tradingview-widget');
```

**`docs/app.js`** — Add this new function and flag near the top of the STATE section:
```javascript
var tvInitialized = false;

function initTradingView() {
  if (tvInitialized) return;
  var wrap = document.getElementById('tradingview-widget');
  if (!wrap) return;
  tvInitialized = true;

  var container = document.createElement('div');
  container.className = 'tradingview-widget-container';
  container.style.cssText = 'width:100%;height:220px;';

  var inner = document.createElement('div');
  inner.className = 'tradingview-widget-container__widget';
  container.appendChild(inner);

  var script = document.createElement('script');
  script.src = 'https://s3.tradingview.com/external-embedding/embed-widget-symbol-overview.js';
  script.async = true;
  script.textContent = JSON.stringify({
    symbols: [
      ['WTI Crude','NYMEX:CL1!|1D'],
      ['Brent',    'NYMEX:BZ1!|1D'],
      ['Nat Gas',  'NYMEX:NG1!|1D'],
      ['Heat Oil', 'NYMEX:HO1!|1D']
    ],
    chartOnly: false, width: '100%', height: 220, locale: 'en',
    colorTheme: 'dark', autosize: true, showVolume: false,
    hideDateRanges: false, hideMarketStatus: false, hideSymbolLogo: true,
    scalePosition: 'right', scaleMode: 'Normal', noTimeScale: false,
    valuesTracking: '1', changeMode: 'price-and-percent',
    chartType: 'area', lineWidth: 2, lineType: 0,
    dateRanges: ['1d|1','1w|15','1m|60','3m|1D']
  });
  container.appendChild(script);

  wrap.innerHTML = '';
  wrap.appendChild(container);
}
```

**`docs/app.js`** — Add `initTradingView();` as the **last line** of `renderDashboard()`, after all `addSourceAttribution` calls.

> **Critical:** `autosize: true` + the `.tradingview-widget-container__widget` div must exist before the script appends — the inner div is the injection target. The order `inner → container → script → append` must be preserved exactly as written above.

**After this task:** Reload the dashboard. The Commodities panel should show a live TradingView chart with 4 energy symbols.

---

### TASK 3 · Yield curve: overlay T-1 and T-2 prior days

**Why:** A single curve shows the current shape but not the direction of travel. Overlaying T-1 (yesterday) and T-2 (two days ago) immediately reveals parallel shifts, steepening, flattening, and inversion events developing in real time.

**`proxy/worker.js`** — In `fetchFREDSeries()`, the return statement currently provides `current` and `prior`. Extend it to expose `t2`:
```javascript
// BEFORE:
return {
  id: series.id,
  current: parseFloat(obs[0].value),
  prior:   obs.length >= 2 ? parseFloat(obs[1].value) : null,
  date:    obs[0].date,
  label:   series.label,
};

// AFTER:
return {
  id:      series.id,
  current: parseFloat(obs[0].value),                           // T
  prior:   obs.length >= 2 ? parseFloat(obs[1].value) : null, // T-1
  t2:      obs.length >= 3 ? parseFloat(obs[2].value) : null, // T-2
  date:    obs[0].date,
  label:   series.label,
};
```

The `limit=5` in the FRED URL already fetches enough observations — no URL change needed.

**`docs/app.js`** — `renderYieldCurve(fred)` currently has a branch: if `yieldCurveChart` exists it updates `datasets[0].data` and returns early. This branch must be extended to update all three datasets. Rewrite the full function:

```javascript
function renderYieldCurve(fred) {
  var labels = [], valT = [], valT1 = [], valT2 = [];
  for (var i = 0; i < CURVE_KEYS.length; i++) {
    var d = fred[CURVE_KEYS[i]];
    labels.push(CURVE_LABELS[i]);
    valT.push(d  && d.current != null ? d.current : null);
    valT1.push(d && d.prior   != null ? d.prior   : null);
    valT2.push(d && d.t2      != null ? d.t2      : null);
  }

  var canvas = document.getElementById('yield-curve-canvas');
  var ctx    = canvas.getContext('2d');

  // Dataset definitions
  var datasets = [
    {
      label: 'Today (T)',
      data: valT,
      borderColor: '#3b82f6', backgroundColor: 'rgba(59,130,246,0.08)',
      fill: true, tension: 0.3, borderWidth: 2,
      pointRadius: 5, pointBackgroundColor: '#3b82f6', pointBorderColor: '#0a0e14', pointBorderWidth: 2,
    },
    {
      label: 'T-1',
      data: valT1,
      borderColor: '#64748b', backgroundColor: 'transparent',
      fill: false, tension: 0.3, borderWidth: 1.5, borderDash: [4, 3],
      pointRadius: 3, pointBackgroundColor: '#64748b',
    },
    {
      label: 'T-2',
      data: valT2,
      borderColor: '#374151', backgroundColor: 'transparent',
      fill: false, tension: 0.3, borderWidth: 1, borderDash: [2, 4],
      pointRadius: 2, pointBackgroundColor: '#374151',
    }
  ];

  // Update path (chart already exists)
  if (yieldCurveChart) {
    yieldCurveChart.data.labels          = labels;
    yieldCurveChart.data.datasets[0].data = valT;
    yieldCurveChart.data.datasets[1].data = valT1;
    yieldCurveChart.data.datasets[2].data = valT2;
    yieldCurveChart.update();
    return;
  }

  // Create path (first render)
  yieldCurveChart = new Chart(ctx, {
    type: 'line',
    plugins: [ChartDataLabels],
    data: { labels: labels, datasets: datasets },
    options: {
      responsive: true, maintainAspectRatio: false,
      layout: { padding: { top: 20 } },
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: function(c) {
              return c.dataset.label + ': ' + (c.parsed.y != null ? c.parsed.y.toFixed(2) + '%' : 'N/A');
            }
          }
        },
        datalabels: {
          display: function(c) { return c.datasetIndex === 0; }, // only label Today's curve
          color: '#e6edf3', anchor: 'end', align: 'top', offset: 2,
          font: { size: 10, family: 'Consolas, monospace', weight: '600' },
          formatter: function(v) { return v != null ? v.toFixed(2) + '%' : ''; }
        }
      },
      scales: {
        x: { ticks: { color: '#7d8da1', font: { size: 10 } }, grid: { color: 'rgba(30,42,58,0.5)' } },
        y: {
          ticks: { color: '#7d8da1', font: { size: 10 }, callback: function(v) { return v.toFixed(1) + '%'; } },
          grid: { color: 'rgba(30,42,58,0.5)' }
        }
      }
    }
  });

  // Inline legend — insert after the canvas's parent .chart-container
  var legendDiv = document.createElement('div');
  legendDiv.className = 'yield-curve-legend';
  legendDiv.innerHTML =
    '<span><i class="ycl-swatch" style="background:#3b82f6"></i>Today</span>' +
    '<span><i class="ycl-swatch" style="background:#64748b;opacity:0.8"></i>T-1</span>' +
    '<span><i class="ycl-swatch" style="background:#374151;border:1px solid #64748b"></i>T-2</span>';
  canvas.closest('.chart-container').after(legendDiv);
}
```

**`docs/style.css`** — Add:
```css
.yield-curve-legend {
  display: flex;
  gap: 14px;
  margin-top: 5px;
  padding-left: 2px;
  font-size: 10px;
  color: var(--text-muted);
}
.yield-curve-legend span { display: flex; align-items: center; gap: 5px; }
.ycl-swatch {
  display: inline-block;
  width: 18px;
  height: 3px;
  border-radius: 2px;
  flex-shrink: 0;
}
```

**After this task:** Run `npx wrangler deploy`. Reload dashboard. Yield curve panel should show 3 overlaid lines — solid blue (today), dashed slate (T-1), faint dashed charcoal (T-2).

---

### TASK 4 · News & Intelligence — sort, tag colors, display cap

**Context:** Age filtering (72h) and financial keyword gating are already in the codebase from a prior session. The remaining gaps are sorting priority, tag visual distinctiveness, and display count.

**`docs/app.js`** — In `fetchNews()`, replace the existing `deduped.sort(...)` line with a two-tier sort that pins Federal Reserve and ECB items (highest signal for treasury ops) above all commercial sources:

```javascript
deduped.sort(function(a, b) {
  if (a.isGov && !b.isGov) return -1;  // gov always first
  if (!a.isGov && b.isGov) return 1;
  return new Date(b.date || 0) - new Date(a.date || 0);  // then newest-first
});
```

**`docs/app.js`** — In `renderNews()`, change the display cap from 15 to 20:
```javascript
// BEFORE: for (var i = 0; i < items.length && i < 15; i++) {
// AFTER:
for (var i = 0; i < items.length && i < 20; i++) {
```

**`docs/app.js`** — In `renderNews()`, add a "last updated" micro-timestamp to the panel header. After the existing `countBadge.textContent = items.length;` line, add:
```javascript
var updatedEl = document.getElementById('news-updated');
if (updatedEl && items.length > 0) {
  updatedEl.textContent = 'Updated ' + formatTime(items[0].date);
}
```

**`docs/index.html`** — Add the span to the news panel heading:
```html
<!-- BEFORE: -->
<h2>News & Intelligence <span id="news-count" class="badge"></span></h2>

<!-- AFTER: -->
<h2>News & Intelligence <span id="news-count" class="badge"></span><span id="news-updated" class="news-updated-ts"></span></h2>
```

**`docs/style.css`** — Add the timestamp style and all distinct tag colors:
```css
.news-updated-ts {
  font-size: 9px;
  color: var(--text-dim);
  font-weight: 400;
  margin-left: 6px;
  font-family: var(--font-mono);
  text-transform: none;
  letter-spacing: 0;
}

/* News tag color palette — each category visually distinct */
.news-tag-FED         { background: rgba(59,130,246,0.15);  color: var(--blue);      border: 1px solid rgba(59,130,246,0.3);  }
.news-tag-INFLATION   { background: rgba(249,115,22,0.15);  color: #f97316;          border: 1px solid rgba(249,115,22,0.3);  }
.news-tag-RATES       { background: rgba(6,182,212,0.15);   color: var(--cyan);      border: 1px solid rgba(6,182,212,0.3);   }
.news-tag-LABOR       { background: rgba(234,179,8,0.15);   color: var(--yellow);    border: 1px solid rgba(234,179,8,0.3);   }
.news-tag-GDP         { background: rgba(34,197,94,0.12);   color: var(--green);     border: 1px solid rgba(34,197,94,0.25);  }
.news-tag-COMMODITIES { background: rgba(217,119,6,0.15);   color: #d97706;          border: 1px solid rgba(217,119,6,0.3);   }
.news-tag-MARKETS     { background: rgba(125,141,161,0.12); color: var(--text-muted);border: 1px solid rgba(125,141,161,0.2); }
.news-tag-FX          { background: rgba(34,197,94,0.12);   color: var(--green);     border: 1px solid rgba(34,197,94,0.2);   }
.news-tag-CREDIT      { background: rgba(167,139,250,0.15); color: var(--purple);    border: 1px solid rgba(167,139,250,0.3); }
.news-tag-MACRO       { background: rgba(239,68,68,0.15);   color: var(--red);       border: 1px solid rgba(239,68,68,0.3);   }
```

---

### TASK 5 · Energy Movers — compact horizontal chip strip

**Why:** The current vertical bar list duplicates data already shown in the Commodities panel. The only unique insight is the ranked ordering by % move — a full-width chip strip at the bottom of the dashboard communicates this in a fraction of the vertical space, like a Bloomberg terminal bottom bar.

**`docs/app.js`** — Replace the full `renderMovers(yahoo)` function (currently around line 1172). Keep the same sort logic, change only the output format:

```javascript
function renderMovers(yahoo) {
  var container = document.getElementById('movers-content');
  if (!container) return;
  container.innerHTML = '';

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
    var m       = movers[j];
    var noDollar = m.key === 'VIX' || m.key === 'DXY';
    var prefix  = noDollar ? '' : '$';
    var cls     = m.pct >= 0 ? 'chip-up' : 'chip-down';
    var chip    = document.createElement('div');
    chip.className = 'mover-chip ' + cls;
    chip.innerHTML =
      '<span class="mover-chip-name">'  + MOVERS_LABELS[m.key]                    + '</span>' +
      '<span class="mover-chip-price">' + prefix + m.price.toFixed(2)             + '</span>' +
      '<span class="mover-chip-pct">'   + sign(m.pct) + m.pct.toFixed(2) + '%'   + '</span>';
    strip.appendChild(chip);
  }
  container.appendChild(strip);
}
```

**`docs/style.css`** — Add chip styles and make the panel span full width:

```css
/* Movers — full-width footer chip strip */
#panel-movers {
  grid-column: 1 / -1;
  max-height: 110px;
  overflow: hidden;
}

.movers-strip {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
  padding: 2px 0;
}
.mover-chip {
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 5px 10px;
  border-radius: 4px;
  border: 1px solid var(--border);
  background: var(--bg-card-alt);
  font-family: var(--font-mono);
  font-size: 11px;
  white-space: nowrap;
}
.mover-chip-name  { color: var(--text-muted); font-size: 9px; text-transform: uppercase; letter-spacing: 0.4px; }
.mover-chip-price { color: var(--text); font-weight: 600; }
.mover-chip-pct   { font-weight: 700; }
.mover-chip.chip-up   { border-color: rgba(34,197,94,0.3); }
.mover-chip.chip-down { border-color: rgba(239,68,68,0.3); }
.mover-chip.chip-up   .mover-chip-pct { color: var(--green); }
.mover-chip.chip-down .mover-chip-pct { color: var(--red);   }
```

**`docs/style.css`** — Also remove the old `.mover-row`, `.mover-name`, `.mover-change`, `.mover-bar` rules if they exist — they are no longer used and will clutter the stylesheet.

---

### TASK 6 · Economic Calendar — color-coded impact legend + medium tier

**Why:** The calendar already uses yellow for high-impact events and blue for FOMC, but there is no legend — the color coding is opaque to any new user. Adding a legend and a medium-impact tier (ISM, retail, claims, sentiment) makes event priority immediately readable.

**`docs/app.js`** — Add `MEDIUM_IMPACT_KEYWORDS` to the CONFIG section, directly below `HIGH_IMPACT_KEYWORDS`:
```javascript
// Existing:
var HIGH_IMPACT_KEYWORDS = ['CPI', 'PCE', 'FOMC', 'Nonfarm', 'GDP', 'PPI'];
// Add:
var MEDIUM_IMPACT_KEYWORDS = ['PMI', 'Retail', 'Durable', 'UMich', 'Claims', 'Sentiment', 'ISM'];
```

Add a matching helper next to `isHighImpact()`:
```javascript
function isMediumImpact(eventName) {
  for (var i = 0; i < MEDIUM_IMPACT_KEYWORDS.length; i++) {
    if (eventName.indexOf(MEDIUM_IMPACT_KEYWORDS[i]) !== -1) return true;
  }
  return false;
}
```

**`docs/app.js`** — In `renderCalendar()`, in the `tbody` render loop, after the existing high-impact class assignment, add the medium tier:
```javascript
// Existing:
if (isHighImpact(e.event) || e.fomc) tr.classList.add('cal-urgency-high');
// Add immediately after:
else if (isMediumImpact(e.event)) tr.classList.add('cal-urgency-medium');
```

**`docs/app.js`** — In `renderCalendar()`, insert the legend div **after `container.innerHTML = ''`** and **before the table is appended**. Place it as the first child of `container`:
```javascript
var legend = document.createElement('div');
legend.className = 'cal-legend';
legend.innerHTML =
  '<span class="cal-legend-item"><span class="cal-legend-dot dot-high"></span>High</span>'   +
  '<span class="cal-legend-item"><span class="cal-legend-dot dot-medium"></span>Medium</span>' +
  '<span class="cal-legend-item"><span class="cal-legend-dot dot-fomc"></span>FOMC</span>'    +
  '<span class="cal-legend-item"><span class="cal-legend-dot dot-today"></span>Today</span>';
container.appendChild(legend);
// (append table after this)
```

**`docs/style.css`** — Add:
```css
.cal-legend {
  display: flex;
  gap: 14px;
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
.dot-today  { background: rgba(59,130,246,0.25); border: 1px solid var(--blue); }

/* Medium impact: default text color (brighter than dim, not as urgent as yellow) */
.cal-urgency-medium td { color: var(--text); }
.cal-urgency-medium .cal-event { font-weight: 500; }
```

---

### TASK 7 · Bloomberg TV — verify embed and positioning

**Why:** Bloomberg is confirmed in position (Row 1, Col 2) and should remain there. This is a verification task — no structural changes needed unless the checks below fail.

**Check `docs/app.js` `initLiveStreams()`:**
- `LIVE_CHANNELS` should contain exactly one entry: Bloomberg TV with `channelId: 'UCIALMKvObZNtJ6AmdCLP7Lg'`
- Embed URL must be: `https://www.youtube.com/embed/live_stream?channel=UCIALMKvObZNtJ6AmdCLP7Lg&autoplay=1&mute=1&playsinline=1&modestbranding=1&rel=0`
- The live dot must conditionally apply class `live-dot-off` when `!isMarketOpen()`

**Check `docs/style.css`:**
```css
/* These two rules must exist exactly as written: */
.live-streams { display: grid; grid-template-columns: 1fr; gap: 8px; }
.live-stream-slot iframe { width: 100%; aspect-ratio: 16 / 9; border: 1px solid var(--border); border-radius: 4px; background: #000; }
```

Fix anything that doesn't match. If everything is correct, make no changes.

---

### TASK 8 · Final layout verification

**Confirm the HTML panel source order is exactly:**
```
panel-calendar → panel-live → panel-news →
panel-yields → panel-commodities → panel-forex →
panel-macro → panel-funding → panel-risk →
panel-movers
```

**`panel-equities` must not exist anywhere in the file.**

**`docs/style.css`** — Confirm `#panel-movers { grid-column: 1 / -1; }` is present (added in Task 5). No other layout changes needed — the 3-column grid handles everything else automatically.

---

## Deployment Sequence

```bash
# Step 1 — Deploy worker changes (Tasks 1, 3 require this)
cd proxy
git pull origin main
npx wrangler deploy

# Step 2 — Push client changes
cd ..
git add docs/ proxy/
git commit -m "feat: equity ticker, TradingView fix, T-1/T-2 yields, news sort, movers strip, calendar legend"
git push origin main
# GitHub Pages redeploys automatically in ~2 min
```

**After deploying, clear stale cache and reload:**
```javascript
// Paste in browser console on the live dashboard:
localStorage.clear(); location.reload();
```

---

## Do NOT Touch

| Item | Reason |
|------|--------|
| `WORKER_URL` in `app.js` | Hardcoded to the live worker — changing it breaks everything |
| `renderFunding()` | Confirmed working — SOFR/EFFR/ON RRP render correctly |
| `renderYields()` | Confirmed working — only `renderYieldCurve()` changes |
| `renderMacro()` | Confirmed working |
| `cachedFred` / `cachedYahoo` merge in `tickerRefresh()` | Core data path logic |
| `fetchFREDSeries()` URL and auth block | Only add `t2` to the return object |
| `wrangler.toml` | Worker name and routing — do not modify |
| `@media print` in `style.css` | Print snapshot feature — do not modify |
