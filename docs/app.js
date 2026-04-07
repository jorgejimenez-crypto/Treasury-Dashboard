/**
 * Treasury Intelligence Dashboard — Client Application
 *
 * Fetches market data + news from the Cloudflare Worker proxy,
 * computes alerts, renders all panels, manages yield curve chart.
 *
 * REFRESH STRATEGY:
 *   - Energy ticker: 10s during market hours, 60s overnight (via Worker fast endpoint)
 *   - Full dashboard: 15 min (via Worker /api/market-data)
 *   - News: 30 min (via Worker /api/news)
 *   - localStorage cache: instant display on load, background refresh
 *   - Exponential backoff on errors: 10s → 15s → 30s → 60s
 */

// ============================================
// CONFIG
// ============================================

var WORKER_URL = 'https://treasury-proxy.treasurydashboard.workers.dev';

var REFRESH_MS = 15 * 60 * 1000;        // 15 min full dashboard
var NEWS_REFRESH_MS = 30 * 60 * 1000;    // 30 min news
var TICKER_REFRESH_MS = 10 * 1000;       // 10s energy ticker (market hours)
var TICKER_REFRESH_SLOW = 60 * 1000;     // 60s ticker (off hours)

var THRESHOLDS = {
  commodityPct: 2.0,
  multiBooksMin: 2,
  vixHigh: 30,
  vixPctSpike: 15,
  dxyLow: 99,
  dxyHigh: 105,
  yield10YHigh: 5.0,
  igOasWide: 150,
  hyOasWide: 500
};

// Labels
var EQUITY_KEYS  = ['SP500', 'DOW', 'NASDAQ', 'RUSSELL'];
var EQUITY_LABELS = { SP500: 'S&P 500', DOW: 'Dow Jones', NASDAQ: 'Nasdaq', RUSSELL: 'Russell 2000' };
var COMMODITY_KEYS = ['WTI', 'Brent', 'NatGas', 'HeatOil', 'Copper', 'Gold'];
var COMMODITY_LABELS = { WTI: 'WTI Crude', Brent: 'Brent Crude', NatGas: 'Henry Hub', HeatOil: 'Heating Oil', Copper: 'Copper', Gold: 'Gold' };
var ENERGY_KEYS = ['WTI', 'Brent', 'NatGas', 'HeatOil'];
var FOREX_KEYS = ['EURUSD', 'GBPUSD', 'USDJPY', 'AUDUSD', 'USDCAD', 'USDCHF', 'USDCNH'];
var FOREX_LABELS = { EURUSD: 'EUR/USD', GBPUSD: 'GBP/USD', USDJPY: 'USD/JPY', AUDUSD: 'AUD/USD', USDCAD: 'USD/CAD', USDCHF: 'USD/CHF', USDCNH: 'USD/CNH' };
var FX_CURRENCIES = ['USD', 'EUR', 'GBP', 'JPY', 'AUD', 'CAD', 'CHF', 'CNH'];
var FX_YAHOO_MAP = { EUR: 'EURUSD', GBP: 'GBPUSD', AUD: 'AUDUSD', JPY: 'USDJPY', CAD: 'USDCAD', CHF: 'USDCHF', CNH: 'USDCNH' };
var FX_INVERTED = { JPY: true, CAD: true, CHF: true, CNH: true };
var YIELD_KEYS = ['DGS2', 'DGS5', 'DGS10', 'DGS30'];
var YIELD_LABELS = { DGS2: '2Y UST', DGS5: '5Y UST', DGS10: '10Y UST', DGS30: '30Y UST' };
var CURVE_KEYS = ['DGS3MO', 'DGS6MO', 'DGS1', 'DGS2', 'DGS5', 'DGS10', 'DGS30'];
var CURVE_LABELS = ['3M', '6M', '1Y', '2Y', '5Y', '10Y', '30Y'];

// Ticker symbols — descriptive labels with exchange symbols
var TICKER_SYMBOLS = ['WTI', 'Brent', 'NatGas', 'HeatOil', 'Gold', 'VIX', 'DXY', 'SP500'];
var TICKER_LABELS = {
  WTI: 'WTI Crude (CL=F)', Brent: 'Brent Crude (BZ=F)', NatGas: 'Nat Gas (NG=F)',
  HeatOil: 'Heating Oil (HO=F)', Gold: 'Gold (GC=F)', VIX: 'CBOE VIX',
  DXY: 'US Dollar (DXY)', SP500: 'S&P 500 (SPX)'
};

var MACRO_DISPLAY = [
  { id: 'FEDFUNDS',        label: 'Fed Funds',     suffix: '%',  dec: 2 },
  { id: 'CPIAUCSL',        label: 'CPI YoY',       suffix: '%',  dec: 1 },
  { id: 'CPILFESL',        label: 'Core CPI YoY',  suffix: '%',  dec: 1 },
  { id: 'PPIACO',          label: 'PPI YoY',        suffix: '%',  dec: 1 },
  { id: 'UNRATE',          label: 'Unemployment',   suffix: '%',  dec: 1 },
  { id: 'ICSA',            label: 'Init. Claims',   suffix: 'K',  dec: 0, divideBy: 1000 },
  { id: 'A191RL1Q225SBEA', label: 'Real GDP',       suffix: '%',  dec: 1 },
  { id: 'WM2NS',           label: 'M2 YoY',        suffix: '%',  dec: 1 },
];

// High-impact calendar events get urgency coloring
var HIGH_IMPACT_KEYWORDS = ['CPI', 'PCE', 'FOMC', 'Nonfarm', 'GDP', 'PPI'];

var ECON_CALENDAR = [
  { date: '2026-04-06', time: '10:00', event: 'ISM Services PMI (Mar)', consensus: '54.8', prior: '56.1' },
  { date: '2026-04-08', time: '14:00', event: 'FOMC Minutes (Mar 18-19)', consensus: null, prior: null, fomc: true },
  { date: '2026-04-09', time: '08:30', event: 'Core PCE Price Index YoY (Feb)', consensus: '2.7%', prior: '2.6%' },
  { date: '2026-04-09', time: '08:30', event: 'Initial Jobless Claims', consensus: '225K', prior: '219K' },
  { date: '2026-04-10', time: '08:30', event: 'CPI MoM (Mar)', consensus: '+0.3%', prior: '+0.2%' },
  { date: '2026-04-10', time: '08:30', event: 'CPI YoY (Mar)', consensus: '3.2%', prior: '2.8%' },
  { date: '2026-04-10', time: '10:00', event: 'UMich Consumer Sentiment (Apr Prelim)', consensus: null, prior: null },
  { date: '2026-04-17', time: '08:30', event: 'Initial Jobless Claims', consensus: null, prior: null },
  { date: '2026-04-17', time: '08:30', event: 'Retail Sales (Mar)', consensus: null, prior: null },
  { date: '2026-04-24', time: '08:30', event: 'Initial Jobless Claims', consensus: null, prior: null },
  { date: '2026-04-24', time: '08:30', event: 'Durable Goods Orders (Mar)', consensus: null, prior: null },
  { date: '2026-04-29', time: 'ALL', event: 'FOMC Meeting Begins', consensus: null, prior: null, fomc: true },
  { date: '2026-04-30', time: '08:30', event: 'GDP Advance (Q1)', consensus: null, prior: null },
  { date: '2026-04-30', time: '14:00', event: 'FOMC Decision', consensus: 'Hold', prior: '4.25-4.50%', fomc: true },
  { date: '2026-05-01', time: '08:30', event: 'Nonfarm Payrolls (Apr)', consensus: null, prior: null },
  { date: '2026-05-01', time: '10:00', event: 'ISM Manufacturing PMI (Apr)', consensus: null, prior: null },
  { date: '2026-05-07', time: '14:00', event: 'FOMC Decision (if scheduled)', consensus: null, prior: null, fomc: true },
  { date: '2026-05-13', time: '08:30', event: 'CPI (Apr)', consensus: null, prior: null },
  { date: '2026-05-14', time: '08:30', event: 'PPI (Apr)', consensus: null, prior: null },
  { date: '2026-05-29', time: '08:30', event: 'GDP 2nd Estimate (Q1)', consensus: null, prior: null },
  { date: '2026-05-29', time: '08:30', event: 'PCE Price Index (Apr)', consensus: null, prior: null },
];

// ============================================
// STATE
// ============================================

var yieldCurveChart = null;
var refreshTimer = null;
var newsTimer = null;
var tickerTimer = null;
var cachedYahoo = null;
var cachedFred = null;                   // preserved across ticker refreshes
var tickerBackoff = TICKER_REFRESH_MS;   // exponential backoff tracker
var fxConverterInitialized = false;      // track if event listeners are attached

// ============================================
// HELPERS
// ============================================

function fmt(val, dec, prefix) {
  if (dec === undefined) dec = 2;
  if (prefix === undefined) prefix = '$';
  if (val == null || isNaN(val)) return 'N/A';
  return prefix + Number(val).toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec });
}

function pctChange(cur, prev) {
  if (cur == null || prev == null || prev === 0) return null;
  return ((cur - prev) / prev) * 100;
}

function bpsChange(cur, prev) {
  if (cur == null || prev == null) return null;
  return Math.round((cur - prev) * 100);
}

function sign(val) {
  if (val == null) return '';
  return val >= 0 ? '+' : '';
}

function deltaClass(val) {
  if (val == null) return 'delta-flat';
  if (Math.abs(val) < 0.01) return 'delta-flat';
  return val > 0 ? 'delta-up' : 'delta-down';
}

function nowET() {
  return new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
}

function isMarketOpen() {
  var n = nowET();
  var day = n.getDay();
  if (day === 0 || day === 6) return false;
  var mins = n.getHours() * 60 + n.getMinutes();
  return mins >= 570 && mins < 960;
}

function formatTime(dateStr) {
  try {
    var d = new Date(dateStr);
    if (isNaN(d)) return '';
    var diff = new Date() - d;
    if (diff < 3600000) return Math.floor(diff / 60000) + 'm ago';
    if (diff < 86400000) return Math.floor(diff / 3600000) + 'h ago';
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  } catch (e) { return ''; }
}

function isHighImpact(eventName) {
  for (var i = 0; i < HIGH_IMPACT_KEYWORDS.length; i++) {
    if (eventName.indexOf(HIGH_IMPACT_KEYWORDS[i]) !== -1) return true;
  }
  return false;
}

// ============================================
// LOCALSTORAGE CACHE (instant load on refresh)
// ============================================

function cacheData(key, data) {
  try { localStorage.setItem('td_' + key, JSON.stringify({ t: Date.now(), d: data })); } catch (e) {}
}

function getCachedData(key, maxAgeMs) {
  try {
    var raw = localStorage.getItem('td_' + key);
    if (!raw) return null;
    var parsed = JSON.parse(raw);
    if (Date.now() - parsed.t > (maxAgeMs || 300000)) return null;
    return parsed.d;
  } catch (e) { return null; }
}

// ============================================
// METRIC RENDERING
// ============================================

function renderMetric(label, value, delta, dateStr, opts) {
  if (!opts) opts = {};
  var div = document.createElement('div');
  div.className = 'metric' + (opts.inverse ? ' inverse' : '');

  var lbl = document.createElement('div');
  lbl.className = 'metric-label';
  lbl.textContent = label;
  div.appendChild(lbl);

  var val = document.createElement('div');
  val.className = 'metric-value' + (value === 'N/A' ? ' value-na' : '') + (opts.sm ? ' sm' : '');
  val.textContent = value;
  div.appendChild(val);

  if (delta != null && delta !== '') {
    var del = document.createElement('div');
    del.className = 'metric-delta ' + deltaClass(opts.deltaNum);
    del.textContent = delta;
    div.appendChild(del);
  }

  if (dateStr) {
    var dt = document.createElement('div');
    dt.className = 'metric-date';
    dt.textContent = dateStr;
    div.appendChild(dt);
  }

  return div;
}

// ============================================
// SOURCE ATTRIBUTION
// ============================================

function addSourceAttribution(panelId, provider, lastDate) {
  var panel = document.getElementById(panelId);
  if (!panel) return;
  var existing = panel.querySelector('.panel-source');
  if (existing) existing.remove();
  var div = document.createElement('div');
  div.className = 'panel-source';
  var provSpan = document.createElement('span');
  provSpan.className = 'panel-source-provider';
  provSpan.textContent = provider;
  div.appendChild(provSpan);
  if (lastDate) {
    var timeSpan = document.createElement('span');
    timeSpan.className = 'panel-source-time';
    timeSpan.textContent = 'As of ' + lastDate;
    div.appendChild(timeSpan);
  }
  panel.appendChild(div);
}

// ============================================
// SCROLLING TICKER BAR
// ============================================

function renderTicker(yahoo) {
  if (!yahoo) return;
  var container = document.getElementById('ticker-content');
  if (!container) return;
  var html = '';
  for (var i = 0; i < TICKER_SYMBOLS.length; i++) {
    var key = TICKER_SYMBOLS[i];
    var d = yahoo[key];
    if (!d || d.current == null) continue;
    var pct = pctChange(d.current, d.prior);
    var cls = pct == null ? 'ticker-flat' : (pct >= 0 ? 'ticker-up' : 'ticker-down');
    var pctStr = pct != null ? (' ' + sign(pct) + pct.toFixed(2) + '%') : '';
    var dec = (key === 'VIX' || key === 'DXY') ? 2 : 2;
    var prefix = (key === 'VIX' || key === 'DXY' || key === 'SP500') ? '' : '$';
    html += '<span class="ticker-item">'
      + '<span class="ticker-symbol">' + TICKER_LABELS[key] + '</span>'
      + '<span class="ticker-price">' + prefix + d.current.toFixed(dec) + '</span>'
      + '<span class="' + cls + '">' + pctStr + '</span>'
      + '</span>';
  }
  // Duplicate content for seamless scroll loop
  container.innerHTML = html + html;
}

// ============================================
// ALERT COMPUTATION
// ============================================

function computeAlerts(data) {
  var alerts = [];
  var yahoo = data.yahoo;

  // Commodity price surge detection (reframed from margin pressure)
  var signals = [];
  for (var i = 0; i < ENERGY_KEYS.length; i++) {
    var k = ENERGY_KEYS[i];
    var d = yahoo[k];
    if (d && d.current != null && d.prior != null) {
      var pct = pctChange(d.current, d.prior);
      if (pct != null && Math.abs(pct) >= THRESHOLDS.commodityPct) {
        signals.push(COMMODITY_LABELS[k] + ' ' + (pct > 0 ? 'up' : 'down') + ' ' + Math.abs(pct).toFixed(1) + '%');
      }
    }
  }
  if (signals.length >= THRESHOLDS.multiBooksMin) {
    alerts.push({ level: 'red', msg: 'COMMODITY SURGE: ' + signals.join(', ') + '. Broad-based input cost pressure.' });
  } else if (signals.length === 1) {
    alerts.push({ level: 'yellow', msg: 'COMMODITY WATCH: ' + signals[0] + '. Rising input cost trend.' });
  }

  // VIX
  var vix = yahoo.VIX;
  if (vix && vix.current != null) {
    if (vix.current > THRESHOLDS.vixHigh) {
      alerts.push({ level: 'red', msg: 'VIX at ' + vix.current.toFixed(1) + ' — above ' + THRESHOLDS.vixHigh + ' threshold' });
    } else {
      var vpct = pctChange(vix.current, vix.prior);
      if (vpct != null && Math.abs(vpct) > THRESHOLDS.vixPctSpike) {
        alerts.push({ level: 'yellow', msg: 'VIX moved ' + sign(vpct) + vpct.toFixed(1) + '% DoD' });
      }
    }
  }

  // DXY
  var dxy = yahoo.DXY;
  if (dxy && dxy.current != null) {
    if (dxy.current < THRESHOLDS.dxyLow || dxy.current > THRESHOLDS.dxyHigh) {
      alerts.push({ level: 'yellow', msg: 'DXY at ' + dxy.current.toFixed(2) + ' — outside ' + THRESHOLDS.dxyLow + '-' + THRESHOLDS.dxyHigh + ' range' });
    }
  }

  // 10Y yield
  var y10 = data.fred && data.fred.DGS10;
  if (y10 && y10.current != null && y10.current > THRESHOLDS.yield10YHigh) {
    alerts.push({ level: 'red', msg: '10Y yield at ' + y10.current.toFixed(2) + '% — above ' + THRESHOLDS.yield10YHigh + '% threshold' });
  }

  // Credit spreads
  var ig = data.fred && data.fred.BAMLC0A0CM;
  if (ig && ig.current != null && ig.current * 100 > THRESHOLDS.igOasWide) {
    alerts.push({ level: 'yellow', msg: 'IG OAS at ' + Math.round(ig.current * 100) + ' bps — wider than ' + THRESHOLDS.igOasWide + ' bps' });
  }

  return alerts;
}

// ============================================
// PANEL RENDERERS
// ============================================

function renderEquities(yahoo) {
  var grid = document.getElementById('equities-grid');
  grid.innerHTML = '';
  for (var i = 0; i < EQUITY_KEYS.length; i++) {
    var k = EQUITY_KEYS[i];
    var d = yahoo[k];
    if (d && d.current != null) {
      var pct = pctChange(d.current, d.prior);
      var delta = pct != null ? sign(pct) + pct.toFixed(2) + '%' : '';
      grid.appendChild(renderMetric(EQUITY_LABELS[k], fmt(d.current, 0, ''), delta, d.date, { deltaNum: pct }));
    } else {
      grid.appendChild(renderMetric(EQUITY_LABELS[k], 'N/A', '', ''));
    }
  }
}

function renderYields(fred) {
  var grid = document.getElementById('yields-grid');
  grid.innerHTML = '';
  for (var i = 0; i < YIELD_KEYS.length; i++) {
    var sid = YIELD_KEYS[i];
    var d = fred[sid];
    if (d && d.current != null) {
      var bps = bpsChange(d.current, d.prior);
      var delta = bps != null ? sign(bps) + bps + ' bps' : '';
      grid.appendChild(renderMetric(YIELD_LABELS[sid], d.current.toFixed(2) + '%', delta, d.date, { deltaNum: bps }));
    } else {
      grid.appendChild(renderMetric(YIELD_LABELS[sid], 'N/A', '', ''));
    }
  }
  var footer = document.getElementById('yields-footer');
  var dgs2 = fred.DGS2;
  var dgs10 = fred.DGS10;
  if (dgs2 && dgs10 && dgs2.current != null && dgs10.current != null) {
    var s = Math.round((dgs10.current - dgs2.current) * 100);
    var shape = s < 0 ? 'inverted' : s < 20 ? 'flat' : 'positive';
    footer.textContent = '2s10s: ' + sign(s) + s + ' bps (' + shape + ')';
  } else {
    footer.textContent = '';
  }
}

function renderYieldCurve(fred) {
  var labels = [];
  var values = [];
  for (var i = 0; i < CURVE_KEYS.length; i++) {
    var d = fred[CURVE_KEYS[i]];
    labels.push(CURVE_LABELS[i]);
    values.push(d && d.current != null ? d.current : null);
  }
  var canvas = document.getElementById('yield-curve-canvas');
  var ctx = canvas.getContext('2d');
  if (yieldCurveChart) {
    yieldCurveChart.data.labels = labels;
    yieldCurveChart.data.datasets[0].data = values;
    yieldCurveChart.update();
    return;
  }
  yieldCurveChart = new Chart(ctx, {
    type: 'line',
    plugins: [ChartDataLabels],
    data: {
      labels: labels,
      datasets: [{
        data: values,
        borderColor: '#3b82f6',
        backgroundColor: 'rgba(59, 130, 246, 0.08)',
        fill: true,
        tension: 0.3,
        pointRadius: 5,
        pointBackgroundColor: '#3b82f6',
        pointBorderColor: '#0a0e14',
        pointBorderWidth: 2,
        borderWidth: 2,
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      layout: { padding: { top: 20 } },
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: function(ctx) { return ctx.parsed.y != null ? ctx.parsed.y.toFixed(2) + '%' : 'N/A'; }
          }
        },
        datalabels: {
          color: '#e6edf3',
          anchor: 'end',
          align: 'top',
          offset: 2,
          font: { size: 10, family: 'Consolas, monospace', weight: '600' },
          formatter: function(value) { return value != null ? value.toFixed(2) + '%' : ''; }
        }
      },
      scales: {
        x: {
          ticks: { color: '#7d8da1', font: { size: 10 } },
          grid: { color: 'rgba(30,42,58,0.5)' },
        },
        y: {
          ticks: {
            color: '#7d8da1',
            font: { size: 10 },
            callback: function(v) { return v.toFixed(1) + '%'; }
          },
          grid: { color: 'rgba(30,42,58,0.5)' },
        }
      }
    }
  });
}

// Cache last known funding values so weekends/holidays don't show all N/A
var lastKnownFunding = { sofr: null, effr: null };

function renderFunding(nyfed, fred) {
  var grid = document.getElementById('funding-grid');
  grid.innerHTML = '';

  // Use live data if available, otherwise fall back to last known
  var sofr = (nyfed.sofr && nyfed.sofr.rate != null) ? nyfed.sofr : lastKnownFunding.sofr;
  var effr = (nyfed.effr && nyfed.effr.rate != null) ? nyfed.effr : lastKnownFunding.effr;

  // Update cache when we get live data
  if (nyfed.sofr && nyfed.sofr.rate != null) lastKnownFunding.sofr = nyfed.sofr;
  if (nyfed.effr && nyfed.effr.rate != null) lastKnownFunding.effr = nyfed.effr;

  if (sofr && sofr.rate != null) {
    var volNote = sofr.volume ? ' ($' + sofr.volume.toFixed(0) + 'B)' : '';
    grid.appendChild(renderMetric('SOFR', sofr.rate.toFixed(2) + '%', volNote, sofr.date));
  } else {
    grid.appendChild(renderMetric('SOFR', 'N/A', 'Weekend/Holiday', ''));
  }
  if (effr && effr.rate != null) {
    grid.appendChild(renderMetric('EFFR', effr.rate.toFixed(2) + '%', '', effr.date));
  } else {
    grid.appendChild(renderMetric('EFFR', 'N/A', 'Weekend/Holiday', ''));
  }
  var onrrp = fred.RRPONTSYD;
  if (onrrp && onrrp.current != null) {
    var valB = (onrrp.current / 1000).toFixed(1);
    grid.appendChild(renderMetric('ON RRP', '$' + valB + 'B', '', onrrp.date));
  } else {
    grid.appendChild(renderMetric('ON RRP', 'N/A', '', ''));
  }
  // Fed Funds rate from macro cache (if available)
  if (cachedFred && cachedFred.FEDFUNDS && cachedFred.FEDFUNDS !== undefined) {
    // Skip — already shown in macro panel
  }
  grid.appendChild(renderMetric('Spread', '', '', '', {}));
  var footer = document.getElementById('funding-footer');
  if (sofr && effr && sofr.rate != null && effr.rate != null) {
    var spread = Math.round((sofr.rate - effr.rate) * 100);
    footer.textContent = 'SOFR-EFFR: ' + sign(spread) + spread + ' bps';
  } else {
    footer.textContent = 'SOFR-EFFR: unavailable (weekend/holiday)';
  }
}

function renderRisk(yahoo, fred) {
  var riskGrid = document.getElementById('risk-grid');
  riskGrid.innerHTML = '';
  var dxy = yahoo.DXY;
  if (dxy && dxy.current != null) {
    var dpct = pctChange(dxy.current, dxy.prior);
    var dd = dpct != null ? sign(dpct) + dpct.toFixed(1) + '%' : '';
    riskGrid.appendChild(renderMetric('DXY', dxy.current.toFixed(2), dd, dxy.date, { deltaNum: dpct }));
  } else {
    riskGrid.appendChild(renderMetric('DXY', 'N/A', '', ''));
  }
  var vix = yahoo.VIX;
  if (vix && vix.current != null) {
    var vpct = pctChange(vix.current, vix.prior);
    var vd = vpct != null ? sign(vpct) + vpct.toFixed(1) + '%' : '';
    riskGrid.appendChild(renderMetric('VIX', vix.current.toFixed(2), vd, vix.date, { inverse: true, deltaNum: vpct }));
  } else {
    riskGrid.appendChild(renderMetric('VIX', 'N/A', '', ''));
  }
  var creditGrid = document.getElementById('credit-grid');
  creditGrid.innerHTML = '';
  var ig = fred.BAMLC0A0CM;
  if (ig && ig.current != null) {
    var igBps = Math.round(ig.current * 100);
    var igChg = ig.prior != null ? Math.round((ig.current - ig.prior) * 100) : null;
    var igD = igChg != null ? sign(igChg) + igChg + ' bps' : '';
    creditGrid.appendChild(renderMetric('IG OAS', igBps + ' bps', igD, ig.date, { deltaNum: igChg }));
  } else {
    creditGrid.appendChild(renderMetric('IG OAS', 'N/A', '', ''));
  }
  var hy = fred.BAMLH0A0HYM2;
  if (hy && hy.current != null) {
    var hyBps = Math.round(hy.current * 100);
    var hyChg = hy.prior != null ? Math.round((hy.current - hy.prior) * 100) : null;
    var hyD = hyChg != null ? sign(hyChg) + hyChg + ' bps' : '';
    creditGrid.appendChild(renderMetric('HY OAS', hyBps + ' bps', hyD, hy.date, { deltaNum: hyChg }));
  } else {
    creditGrid.appendChild(renderMetric('HY OAS', 'N/A', '', ''));
  }
}

function renderCommodities(yahoo) {
  var grid = document.getElementById('commodities-grid');
  grid.innerHTML = '';
  for (var i = 0; i < COMMODITY_KEYS.length; i++) {
    var k = COMMODITY_KEYS[i];
    var d = yahoo[k];
    if (d && d.current != null) {
      var pct = pctChange(d.current, d.prior);
      var delta = pct != null ? sign(pct) + pct.toFixed(1) + '%' : '';
      grid.appendChild(renderMetric(COMMODITY_LABELS[k], fmt(d.current), delta, d.date, { deltaNum: pct, sm: true }));
    } else {
      grid.appendChild(renderMetric(COMMODITY_LABELS[k], 'N/A', '', ''));
    }
  }
  // Footer: WTI/Brent spread + commodity status (reframed from margin pressure)
  var footer = document.getElementById('commodities-footer');
  var txt = '';
  var wti = yahoo.WTI;
  var brent = yahoo.Brent;
  if (wti && brent && wti.current != null && brent.current != null) {
    var spread = wti.current - brent.current;
    txt += 'WTI/Brent: ' + (spread >= 0 ? '+' : '') + '$' + spread.toFixed(2);
  }
  var sigs = [];
  for (var j = 0; j < ENERGY_KEYS.length; j++) {
    var ek = ENERGY_KEYS[j];
    var ed = yahoo[ek];
    if (ed && ed.current != null && ed.prior != null) {
      var epct = pctChange(ed.current, ed.prior);
      if (epct != null && Math.abs(epct) >= THRESHOLDS.commodityPct) {
        sigs.push(COMMODITY_LABELS[ek] + ' ' + (epct > 0 ? 'up' : 'down') + ' ' + Math.abs(epct).toFixed(1) + '%');
      }
    }
  }
  if (sigs.length >= 2) txt += (txt ? ' | ' : '') + 'SURGE: ' + sigs.join(', ');
  else if (sigs.length === 1) txt += (txt ? ' | ' : '') + 'WATCH: ' + sigs[0];
  else txt += (txt ? ' | ' : '') + 'Commodities: stable';
  footer.textContent = txt;
}

function fxDecimals(key) {
  if (key === 'USDJPY' || key === 'USDCNH') return 2;
  return 4;
}

function renderForex(yahoo) {
  var grid = document.getElementById('forex-grid');
  grid.innerHTML = '';
  for (var i = 0; i < FOREX_KEYS.length; i++) {
    var k = FOREX_KEYS[i];
    var d = yahoo[k];
    if (d && d.current != null) {
      var pct = pctChange(d.current, d.prior);
      var delta = pct != null ? sign(pct) + pct.toFixed(2) + '%' : '';
      grid.appendChild(renderMetric(FOREX_LABELS[k], d.current.toFixed(fxDecimals(k)), delta, d.date, { deltaNum: pct, sm: true }));
    } else {
      grid.appendChild(renderMetric(FOREX_LABELS[k], 'N/A', '', ''));
    }
  }
  initFxConverter();
}

// ============================================
// FX CONVERTER (FIXED: uses cachedYahoo, not stale closure)
// ============================================

function getToUSD(ccy) {
  if (ccy === 'USD') return 1;
  if (!cachedYahoo) return null;
  var key = FX_YAHOO_MAP[ccy];
  if (!key || !cachedYahoo[key] || cachedYahoo[key].current == null) return null;
  var rate = cachedYahoo[key].current;
  return FX_INVERTED[ccy] ? 1 / rate : rate;
}

function initFxConverter() {
  var baseSelect = document.getElementById('fx-base');
  var quoteSelect = document.getElementById('fx-quote');
  if (!fxConverterInitialized) {
    fxConverterInitialized = true;
    baseSelect.innerHTML = '';
    quoteSelect.innerHTML = '';
    for (var i = 0; i < FX_CURRENCIES.length; i++) {
      var c = FX_CURRENCIES[i];
      baseSelect.appendChild(new Option(c, c));
      quoteSelect.appendChild(new Option(c, c));
    }
    baseSelect.value = 'USD';
    quoteSelect.value = 'EUR';
    // Event listeners use cachedYahoo (always fresh) via computeFxConversion()
    var compute = function() { computeFxConversion(); };
    baseSelect.addEventListener('change', compute);
    quoteSelect.addEventListener('change', compute);
    document.getElementById('fx-amount').addEventListener('input', compute);
    document.getElementById('fx-swap').addEventListener('click', function() {
      var tmp = baseSelect.value;
      baseSelect.value = quoteSelect.value;
      quoteSelect.value = tmp;
      computeFxConversion();
    });
  }
  computeFxConversion();
}

function computeFxConversion() {
  var amount = parseFloat(document.getElementById('fx-amount').value);
  var base = document.getElementById('fx-base').value;
  var quote = document.getElementById('fx-quote').value;
  var resultEl = document.getElementById('fx-result');
  var rateEl = document.getElementById('fx-rate-line');
  if (isNaN(amount) || base === quote) {
    resultEl.textContent = base === quote ? fmt(amount, 2, '') + ' ' + quote : '--';
    rateEl.textContent = base === quote ? '1:1' : '';
    return;
  }
  var baseUSD = getToUSD(base);
  var quoteUSD = getToUSD(quote);
  if (!baseUSD || !quoteUSD) {
    resultEl.textContent = 'Rate unavailable';
    rateEl.textContent = '';
    return;
  }
  var crossRate = baseUSD / quoteUSD;
  var result = amount * crossRate;
  resultEl.textContent = result.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' ' + quote;
  rateEl.textContent = '1 ' + base + ' = ' + crossRate.toFixed(crossRate > 10 ? 2 : 6) + ' ' + quote;
}

function renderMacro(macro) {
  var grid = document.getElementById('macro-grid');
  grid.innerHTML = '';
  for (var i = 0; i < MACRO_DISPLAY.length; i++) {
    var m = MACRO_DISPLAY[i];
    var d = macro[m.id];
    if (d && d.current != null) {
      var val = m.divideBy ? d.current / m.divideBy : d.current;
      var valStr = val.toFixed(m.dec) + m.suffix;
      var priorVal = d.prior != null ? (m.divideBy ? d.prior / m.divideBy : d.prior) : null;
      var delta = '';
      var deltaNum = null;
      if (priorVal != null) {
        var diff = val - priorVal;
        deltaNum = diff;
        if (m.suffix === 'K') {
          delta = sign(diff) + diff.toFixed(0) + 'K';
        } else {
          delta = sign(diff) + diff.toFixed(m.dec) + (m.suffix === '%' ? ' pp' : '');
        }
      }
      grid.appendChild(renderMetric(m.label, valStr, delta, d.date, { deltaNum: deltaNum, sm: true }));
    } else {
      grid.appendChild(renderMetric(m.label, 'N/A', '', ''));
    }
  }
}

function renderCalendar(fomc) {
  var container = document.getElementById('calendar-content');
  container.innerHTML = '';
  var todayStr = new Date().toISOString().split('T')[0];
  var upcoming = [];
  for (var i = 0; i < ECON_CALENDAR.length; i++) {
    var ev = ECON_CALENDAR[i];
    if (ev.date >= todayStr) upcoming.push(ev);
  }
  upcoming = upcoming.slice(0, 12);
  if (upcoming.length === 0) {
    container.innerHTML = '<div class="news-empty">No upcoming events. Update ECON_CALENDAR in app.js.</div>';
    return;
  }
  var table = document.createElement('table');
  table.className = 'cal-table';
  var thead = document.createElement('thead');
  thead.innerHTML = '<tr><th>Date</th><th>Event</th><th>Est.</th><th>Prior</th></tr>';
  table.appendChild(thead);
  var tbody = document.createElement('tbody');
  for (var j = 0; j < upcoming.length; j++) {
    var e = upcoming[j];
    var tr = document.createElement('tr');
    if (e.date === todayStr) tr.className = 'today';
    // Color-code high-impact events
    if (isHighImpact(e.event) || e.fomc) tr.classList.add('cal-urgency-high');
    var d = new Date(e.date + 'T12:00:00');
    var dateLabel = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', weekday: 'short' });
    if (e.time && e.time !== 'ALL') dateLabel += ' ' + e.time;
    var eventCell = e.event;
    if (e.fomc) eventCell = '<span class="cal-fomc">' + e.event + '</span>';
    if (e.date === todayStr) eventCell += ' <span class="cal-tag cal-tag-today">TODAY</span>';
    tr.innerHTML = '<td class="cal-date">' + dateLabel + '</td>'
      + '<td class="cal-event">' + eventCell + '</td>'
      + '<td class="cal-values">' + (e.consensus || '--') + '</td>'
      + '<td class="cal-values">' + (e.prior || '--') + '</td>';
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  container.appendChild(table);
  if (fomc && fomc.next) {
    var fomcDiv = document.createElement('div');
    fomcDiv.className = 'panel-footer';
    fomcDiv.textContent = 'Next FOMC: ' + fomc.next + ' (' + fomc.daysAway + ' days)';
    container.appendChild(fomcDiv);
  }
}

function renderNews(items) {
  var container = document.getElementById('news-content');
  var countBadge = document.getElementById('news-count');
  container.innerHTML = '';
  if (!items || items.length === 0) {
    container.innerHTML = '<div class="news-empty">No news available. Refreshes every 30 min.</div>';
    countBadge.textContent = '';
    return;
  }
  countBadge.textContent = items.length;
  for (var i = 0; i < items.length && i < 15; i++) {
    var item = items[i];
    var div = document.createElement('div');
    div.className = 'news-item';
    var tagSpan = document.createElement('span');
    tagSpan.className = 'news-tag news-tag-' + (item.tag || 'MARKETS');
    tagSpan.textContent = item.tag || 'NEWS';
    var body = document.createElement('div');
    body.className = 'news-body';
    var titleDiv = document.createElement('div');
    titleDiv.className = 'news-title';
    if (item.link) {
      var a = document.createElement('a');
      a.href = item.link;
      a.target = '_blank';
      a.rel = 'noopener';
      a.textContent = item.title;
      titleDiv.appendChild(a);
    } else {
      titleDiv.textContent = item.title;
    }
    var metaDiv = document.createElement('div');
    metaDiv.className = 'news-meta';
    var metaText = item.source || '';
    if (item.isGov) metaText = '<span class="news-gov">GOV</span> ' + metaText;
    if (item.date) metaText += ' · ' + formatTime(item.date);
    metaDiv.innerHTML = metaText;
    body.appendChild(titleDiv);
    body.appendChild(metaDiv);
    div.appendChild(tagSpan);
    div.appendChild(body);
    container.appendChild(div);
  }
}

// ============================================
// MAIN RENDER
// ============================================

function renderDashboard(data) {
  var now = nowET();
  var dateStr = now.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  var timeStr = now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true }) + ' ET';
  var refreshLabel = isMarketOpen() ? 'Ticker: 10s' : 'Ticker: 60s';
  document.getElementById('header-meta').textContent = dateStr + '  |  Last refresh: ' + timeStr + '  |  ' + refreshLabel + '  |  Full: 15 min';

  var statusEl = document.getElementById('market-status');
  if (isMarketOpen()) {
    statusEl.textContent = 'MARKET OPEN';
    statusEl.className = 'market-badge open';
  } else {
    statusEl.textContent = 'MARKET CLOSED';
    statusEl.className = 'market-badge closed';
  }

  var fomcEl = document.getElementById('fomc-badge');
  if (data.fomc && data.fomc.next) {
    fomcEl.textContent = 'FOMC: ' + data.fomc.daysAway + 'd';
    fomcEl.title = 'Next FOMC: ' + data.fomc.next;
    fomcEl.className = data.fomc.daysAway <= 7 ? 'fomc-badge imminent' : 'fomc-badge';
  }

  var alertBar = document.getElementById('alert-bar');
  alertBar.innerHTML = '';
  var alerts = computeAlerts(data);
  if (alerts.length === 0) {
    alertBar.innerHTML = '<div class="alert alert-green"><span class="alert-icon"></span> All systems normal — no threshold breaches.</div>';
  } else {
    for (var i = 0; i < alerts.length; i++) {
      alertBar.innerHTML += '<div class="alert alert-' + alerts[i].level + '"><span class="alert-icon"></span> ' + alerts[i].msg + '</div>';
    }
  }

  // Cache for FX converter + ticker + risk panel preservation
  cachedYahoo = data.yahoo;
  cachedFred = data.fred;
  cacheData('market', data);

  // Render all panels
  renderTicker(data.yahoo);
  renderYields(data.fred);
  renderYieldCurve(data.fred);
  renderFunding(data.nyfed, data.fred);
  renderRisk(data.yahoo, data.fred);
  renderEquities(data.yahoo);
  renderCommodities(data.yahoo);
  renderForex(data.yahoo);
  renderMacro(data.macro);
  renderCalendar(data.fomc);
  renderMovers(data.yahoo);

  // Source attribution
  var yDate = data.fred.DGS10 ? data.fred.DGS10.date : null;
  addSourceAttribution('panel-yields', 'FRED', yDate);
  addSourceAttribution('panel-funding', 'NY Fed / FRED', data.nyfed.sofr ? data.nyfed.sofr.date : null);
  addSourceAttribution('panel-risk', 'Yahoo / FRED', data.yahoo.VIX ? data.yahoo.VIX.date : null);
  addSourceAttribution('panel-equities', 'Yahoo Finance', data.yahoo.SP500 ? data.yahoo.SP500.date : null);
  addSourceAttribution('panel-commodities', 'Yahoo Finance', data.yahoo.WTI ? data.yahoo.WTI.date : null);
  addSourceAttribution('panel-forex', 'Yahoo Finance', data.yahoo.EURUSD ? data.yahoo.EURUSD.date : null);
  addSourceAttribution('panel-macro', 'FRED', data.macro.UNRATE ? data.macro.UNRATE.date : null);
  addSourceAttribution('panel-calendar', 'Fed / BLS / BEA', null);
  addSourceAttribution('panel-news', 'Fed / ECB / CNBC RSS', null);
  addSourceAttribution('panel-movers', 'Yahoo Finance', data.yahoo.WTI ? data.yahoo.WTI.date : null);

  document.getElementById('loading').style.display = 'none';
  document.getElementById('dashboard').style.display = 'grid';
}

// ============================================
// DATA FETCHING (with localStorage cache + backoff)
// ============================================

function fetchData() {
  if (WORKER_URL.indexOf('YOUR_SUBDOMAIN') !== -1 || WORKER_URL.indexOf('YOUR_') !== -1) {
    document.getElementById('loading').style.display = 'none';
    document.getElementById('setup-banner').style.display = 'block';
    return;
  }
  fetch(WORKER_URL + '/api/market-data')
    .then(function(resp) {
      if (!resp.ok) throw new Error('Worker returned ' + resp.status);
      return resp.json();
    })
    .then(function(data) {
      tickerBackoff = isMarketOpen() ? TICKER_REFRESH_MS : TICKER_REFRESH_SLOW;
      renderDashboard(data);
    })
    .catch(function(err) {
      var loading = document.getElementById('loading');
      if (loading.style.display !== 'none') {
        loading.innerHTML = '<div class="error-msg">Failed to fetch data: ' + err.message + '<br><small>Check Worker URL and deployment.</small></div>';
      }
    });
}

// Premium RSS feeds fetched client-side via rss2json.com (free, 10K req/day)
var PREMIUM_FEEDS = [
  { url: 'https://feeds.a.dj.com/rss/RSSWorldNews.xml', source: 'WSJ', tag: 'MARKETS' },
  { url: 'https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=20910258', source: 'CNBC', tag: 'MARKETS' },
  { url: 'https://feeds.marketwatch.com/marketwatch/topstories/', source: 'MarketWatch', tag: 'MARKETS' },
  { url: 'https://finance.yahoo.com/news/rssindex', source: 'Yahoo Finance', tag: 'MARKETS' },
];

function fetchSingleFeed(feed) {
  var apiUrl = RSS2JSON_BASE + encodeURIComponent(feed.url);
  return fetch(apiUrl)
    .then(function(resp) { return resp.json(); })
    .then(function(data) {
      if (data.status !== 'ok' || !data.items) return [];
      return data.items.slice(0, 8).map(function(item) {
        return {
          title: item.title || '',
          link: item.link || '',
          date: item.pubDate || '',
          summary: (item.description || '').replace(/<[^>]*>/g, '').substring(0, 150),
          source: feed.source,
          tag: feed.tag,
          isGov: false
        };
      });
    })
    .catch(function() { return []; });
}

function fetchNews() {
  if (WORKER_URL.indexOf('YOUR_') !== -1) return;

  // Fetch Worker news (Fed/ECB/CNBC RSS) + premium feeds in parallel
  var workerPromise = fetch(WORKER_URL + '/api/news')
    .then(function(resp) {
      if (!resp.ok) throw new Error('Worker news failed');
      return resp.json();
    })
    .then(function(data) { return data.items || []; })
    .catch(function() { return []; });

  var premiumPromises = PREMIUM_FEEDS.map(fetchSingleFeed);

  Promise.all([workerPromise].concat(premiumPromises))
    .then(function(results) {
      var allItems = [];
      for (var i = 0; i < results.length; i++) {
        allItems = allItems.concat(results[i]);
      }

      // Deduplicate by normalized title (first 50 chars)
      var seen = {};
      var deduped = [];
      for (var j = 0; j < allItems.length; j++) {
        var norm = allItems[j].title.toLowerCase().replace(/[^a-z0-9]/g, '').substring(0, 50);
        if (norm && !seen[norm]) {
          seen[norm] = true;
          deduped.push(allItems[j]);
        }
      }

      // Sort by date descending
      deduped.sort(function(a, b) {
        return new Date(b.date || 0) - new Date(a.date || 0);
      });

      deduped = deduped.slice(0, 40);
      cacheData('news', deduped);
      renderNews(deduped);
    });
}

// Smart ticker refresh: faster during market hours, with backoff on error
function tickerRefresh() {
  if (WORKER_URL.indexOf('YOUR_') !== -1) return;
  fetch(WORKER_URL + '/api/market-data')
    .then(function(resp) {
      if (!resp.ok) throw new Error(resp.status);
      return resp.json();
    })
    .then(function(data) {
      cachedYahoo = data.yahoo;
      if (data.fred) cachedFred = data.fred;
      renderTicker(data.yahoo);
      // Also update volatile panels on ticker refresh
      renderCommodities(data.yahoo);
      renderRisk(data.yahoo, cachedFred || {});
      renderMovers(data.yahoo);
      // Reset backoff on success
      tickerBackoff = isMarketOpen() ? TICKER_REFRESH_MS : TICKER_REFRESH_SLOW;
    })
    .catch(function() {
      // Exponential backoff: 10s → 15s → 30s → 60s max
      tickerBackoff = Math.min(tickerBackoff * 1.5, 60000);
    })
    .finally(function() {
      clearTimeout(tickerTimer);
      tickerTimer = setTimeout(tickerRefresh, tickerBackoff);
    });
}

// ============================================
// QUICK NOTES (localStorage trading journal)
// ============================================

function initNotes() {
  var panel = document.getElementById('notes-panel');
  var textarea = document.getElementById('notes-text');
  var savedMsg = document.getElementById('notes-saved');

  // Load saved notes
  var saved = localStorage.getItem('td_notes') || '';
  textarea.value = saved;

  // Auto-save on input
  var saveTimeout = null;
  textarea.addEventListener('input', function() {
    clearTimeout(saveTimeout);
    saveTimeout = setTimeout(function() {
      localStorage.setItem('td_notes', textarea.value);
      savedMsg.textContent = 'Saved';
      setTimeout(function() { savedMsg.textContent = ''; }, 1500);
    }, 500);
  });

  // Close button
  document.getElementById('notes-close').addEventListener('click', function() {
    panel.style.display = 'none';
  });

  // Clear button
  document.getElementById('notes-clear').addEventListener('click', function() {
    if (confirm('Clear all notes?')) {
      textarea.value = '';
      localStorage.removeItem('td_notes');
    }
  });

  // Toggle button in header
  document.getElementById('btn-notes').addEventListener('click', function() {
    panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
  });
}

// ============================================
// LIVE CATALYSTS (auto-resolving latest video from channel RSS)
// ============================================

// Strategy: YouTube channel RSS feeds are public at a stable URL.
// We fetch via rss2json.com (free proxy), extract the latest video ID,
// and embed it. This ALWAYS works because it uses a real, current video ID.
// If rss2json fails, we fall back to a static placeholder with channel link.
var LIVE_CHANNELS = [
  {
    label: 'Bloomberg TV',
    channelId: 'UCIALMKvObZNtJ6AmdCLP7Lg',
    link: 'https://www.youtube.com/@BloombergTelevision/streams'
  },
  {
    label: 'Yahoo Finance',
    channelId: 'UCEAZeUIeJs0IjQiqTCQoqmA',
    link: 'https://www.youtube.com/@YahooFinance/streams'
  }
];

var RSS2JSON_BASE = 'https://api.rss2json.com/v1/api.json?rss_url=';

function initLiveStreams() {
  var container = document.getElementById('live-streams');
  if (!container) return;
  container.innerHTML = '';

  for (var i = 0; i < LIVE_CHANNELS.length; i++) {
    var ch = LIVE_CHANNELS[i];

    // Create slot immediately with placeholder
    var slot = document.createElement('div');
    slot.className = 'live-stream-slot';
    slot.id = 'live-slot-' + i;

    var labelDiv = document.createElement('div');
    labelDiv.className = 'live-stream-label';
    labelDiv.innerHTML = '<span class="live-dot"></span> ' + ch.label
      + ' <a href="' + ch.link + '" target="_blank" rel="noopener" '
      + 'style="color:var(--text-dim);font-size:9px;margin-left:auto;text-decoration:none;">'
      + 'Open channel &#x2197;</a>';

    // Start with a loading placeholder
    var placeholder = document.createElement('div');
    placeholder.className = 'live-stream-placeholder';
    placeholder.innerHTML = '<div class="live-fallback-text">Loading latest video...</div>';

    slot.appendChild(labelDiv);
    slot.appendChild(placeholder);
    container.appendChild(slot);

    // Fetch the channel's RSS to get latest video ID
    loadChannelLatestVideo(ch, slot, placeholder);
  }
}

function loadChannelLatestVideo(channel, slot, placeholder) {
  var rssUrl = 'https://www.youtube.com/feeds/videos.xml?channel_id=' + channel.channelId;
  var apiUrl = RSS2JSON_BASE + encodeURIComponent(rssUrl);

  fetch(apiUrl)
    .then(function(resp) { return resp.json(); })
    .then(function(data) {
      if (data.status === 'ok' && data.items && data.items.length > 0) {
        // Extract video ID from the link (youtube.com/watch?v=VIDEO_ID)
        var link = data.items[0].link || '';
        var match = link.match(/[?&]v=([^&]+)/);
        var videoId = match ? match[1] : null;

        if (videoId) {
          var iframe = document.createElement('iframe');
          iframe.src = 'https://www.youtube.com/embed/' + videoId
            + '?autoplay=1&mute=1&playsinline=1&modestbranding=1&rel=0';
          iframe.title = channel.label;
          iframe.setAttribute('allow', 'autoplay; encrypted-media; picture-in-picture');
          iframe.setAttribute('allowfullscreen', '');
          placeholder.replaceWith(iframe);
          return;
        }
      }
      // If parsing failed, show fallback
      showStreamFallback(placeholder, channel);
    })
    .catch(function() {
      showStreamFallback(placeholder, channel);
    });
}

function showStreamFallback(placeholder, channel) {
  placeholder.className = 'live-stream-placeholder';
  placeholder.innerHTML = '<div class="live-fallback-text">'
    + 'Latest video unavailable'
    + '<br><a href="' + channel.link + '" target="_blank" rel="noopener">'
    + 'Watch live on YouTube &#x2197;</a></div>';
}

// ============================================
// ENERGY MOVERS (sorted by % change)
// ============================================

var MOVERS_KEYS = ['WTI', 'Brent', 'NatGas', 'HeatOil', 'Copper', 'Gold', 'VIX', 'DXY'];
var MOVERS_LABELS = {
  WTI: 'WTI Crude', Brent: 'Brent', NatGas: 'Nat Gas', HeatOil: 'Heat Oil',
  Copper: 'Copper', Gold: 'Gold', VIX: 'VIX', DXY: 'DXY'
};

function renderMovers(yahoo) {
  var container = document.getElementById('movers-content');
  if (!container) return;
  container.innerHTML = '';

  // Build sortable array of movers
  var movers = [];
  for (var i = 0; i < MOVERS_KEYS.length; i++) {
    var k = MOVERS_KEYS[i];
    var d = yahoo[k];
    if (d && d.current != null && d.prior != null) {
      var pct = pctChange(d.current, d.prior);
      if (pct != null) {
        movers.push({ key: k, price: d.current, pct: pct });
      }
    }
  }

  // Sort by absolute % change descending (biggest movers first)
  movers.sort(function(a, b) { return Math.abs(b.pct) - Math.abs(a.pct); });

  var list = document.createElement('div');
  list.className = 'movers-list';

  for (var j = 0; j < movers.length; j++) {
    var m = movers[j];
    var isNonDollar = m.key === 'VIX' || m.key === 'DXY';
    var prefix = isNonDollar ? '' : '$';
    var cls = m.pct >= 0 ? 'mover-up' : 'mover-down';

    var row = document.createElement('div');
    row.className = 'mover-row ' + cls;
    row.innerHTML = '<span class="mover-name">' + MOVERS_LABELS[m.key] + '</span>'
      + '<span class="mover-price">' + prefix + m.price.toFixed(2) + '</span>'
      + '<span class="mover-change">' + sign(m.pct) + m.pct.toFixed(2) + '%</span>';

    // Mini bar proportional to % move (max 60px at 5%)
    var bar = document.createElement('div');
    bar.className = 'mover-bar';
    bar.style.width = Math.min(Math.abs(m.pct) / 5 * 60, 60) + 'px';
    var changeCell = row.querySelector('.mover-change');
    if (changeCell) changeCell.appendChild(bar);

    list.appendChild(row);
  }

  container.appendChild(list);
}

// ============================================
// KEYBOARD SHORTCUTS
// ============================================

function initShortcuts() {
  document.addEventListener('keydown', function(e) {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') {
      if (e.key === 'Escape') {
        document.getElementById('notes-panel').style.display = 'none';
        e.target.blur();
      }
      return;
    }

    var modal = document.getElementById('shortcuts-modal');

    if (e.key === 'Escape') {
      modal.style.display = 'none';
      document.getElementById('notes-panel').style.display = 'none';
      return;
    }
    if (e.key === '?' || e.key === '/') {
      e.preventDefault();
      modal.style.display = modal.style.display === 'none' ? 'flex' : 'none';
      return;
    }
    if (e.key === 'r' || e.key === 'R') {
      e.preventDefault();
      fetchData();
      fetchNews();
      return;
    }
    if (e.key === 'n' || e.key === 'N') {
      e.preventDefault();
      document.getElementById('panel-news').classList.toggle('collapsed');
      return;
    }
    if (e.key === 'c' || e.key === 'C') {
      e.preventDefault();
      document.getElementById('panel-calendar').classList.toggle('collapsed');
      return;
    }
    if (e.key === 'j' || e.key === 'J') {
      e.preventDefault();
      var np = document.getElementById('notes-panel');
      np.style.display = np.style.display === 'none' ? 'block' : 'none';
      if (np.style.display === 'block') document.getElementById('notes-text').focus();
      return;
    }
    if (e.key === 'l' || e.key === 'L') {
      e.preventDefault();
      document.getElementById('panel-live').classList.toggle('collapsed');
      return;
    }
  });

  document.getElementById('btn-refresh').addEventListener('click', function() {
    fetchData();
    fetchNews();
  });
  document.getElementById('btn-shortcuts').addEventListener('click', function() {
    var modal = document.getElementById('shortcuts-modal');
    modal.style.display = modal.style.display === 'none' ? 'flex' : 'none';
  });
  document.getElementById('modal-close').addEventListener('click', function() {
    document.getElementById('shortcuts-modal').style.display = 'none';
  });
  document.getElementById('shortcuts-modal').addEventListener('click', function(e) {
    if (e.target === this) this.style.display = 'none';
  });

  var panels = document.querySelectorAll('.panel h2');
  for (var i = 0; i < panels.length; i++) {
    panels[i].addEventListener('click', function() {
      this.parentElement.classList.toggle('collapsed');
    });
  }
}

// ============================================
// INIT
// ============================================

// 1. Show cached data instantly if available
var cachedMarket = getCachedData('market', 600000); // 10 min cache
if (cachedMarket) {
  try { renderDashboard(cachedMarket); } catch (e) {}
}
var cachedNews = getCachedData('news', 3600000); // 1 hr cache
if (cachedNews) {
  try { renderNews(cachedNews); } catch (e) {}
}

// 2. Background fresh fetch
fetchData();
fetchNews();

// 3. Set up refresh timers
refreshTimer = setInterval(fetchData, REFRESH_MS);
newsTimer = setInterval(fetchNews, NEWS_REFRESH_MS);

// 4. Start smart ticker refresh (10s during market hours)
tickerTimer = setTimeout(tickerRefresh, tickerBackoff);

// 5. Init interactive features
initShortcuts();
initNotes();
initLiveStreams();
