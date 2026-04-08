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
var COMMODITY_KEYS = ['WTI', 'Brent', 'NatGas', 'HeatOil', 'Copper', 'Gold', 'Silver'];
var COMMODITY_LABELS = { WTI: 'WTI Crude', Brent: 'Brent Crude', NatGas: 'Henry Hub', HeatOil: 'Heating Oil', Copper: 'Copper', Gold: 'Gold', Silver: 'Silver' };
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

// Scrolling energy + risk + equity ticker
var TICKER_SYMBOLS = ['WTI', 'Brent', 'NatGas', 'HeatOil', 'Gold', 'Silver', 'VIX', 'DXY', 'SP500', 'DOW', 'NASDAQ'];
var TICKER_LABELS = {
  WTI: 'WTI Crude (CL=F)', Brent: 'Brent Crude (BZ=F)', NatGas: 'Nat Gas (NG=F)',
  HeatOil: 'Heating Oil (HO=F)', Gold: 'Gold (GC=F)', Silver: 'Silver (SI=F)',
  VIX: 'CBOE VIX', DXY: 'US Dollar (DXY)', SP500: 'S&P 500 (SPX)',
  DOW: 'Dow Jones', NASDAQ: 'Nasdaq'
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
var MEDIUM_IMPACT_KEYWORDS = ['PMI', 'Retail', 'Durable', 'UMich', 'Claims', 'Sentiment'];

function isHighImpact(eventName) {
  for (var i = 0; i < HIGH_IMPACT_KEYWORDS.length; i++) {
    if (eventName.indexOf(HIGH_IMPACT_KEYWORDS[i]) !== -1) return true;
  }
  return false;
}
function isMediumImpact(eventName) {
  for (var i = 0; i < MEDIUM_IMPACT_KEYWORDS.length; i++) {
    if (eventName.indexOf(MEDIUM_IMPACT_KEYWORDS[i]) !== -1) return true;
  }
  return false;
}

// ECON_CALENDAR — update 'actual' and 'actualBeat' as results print:
//   actual: '3.2%'    — the printed number
//   actualBeat: true  — green (beat/in-line)  |  false — red (miss)
//   actualBeat: null  — no coloring (not yet released)
var ECON_CALENDAR = [
  // TO ADD ACTUAL RESULTS: set actual:'2.8%' and actualBeat:true (green) or false (red)
  { date: '2026-04-08', time: '14:00', event: 'FOMC Minutes (Mar 18-19)',        consensus: null,    prior: null,          fomc: true,  actual: null, actualBeat: null },
  { date: '2026-04-09', time: '08:30', event: 'Core PCE Price Index YoY (Feb)', consensus: '2.7%',  prior: '2.6%',                     actual: null, actualBeat: null },
  { date: '2026-04-09', time: '08:30', event: 'Initial Jobless Claims',          consensus: '225K',  prior: '219K',                     actual: null, actualBeat: null },
  { date: '2026-04-10', time: '08:30', event: 'CPI MoM (Mar)',                   consensus: '+0.3%', prior: '+0.2%',                    actual: null, actualBeat: null },
  { date: '2026-04-10', time: '08:30', event: 'CPI YoY (Mar)',                   consensus: '3.2%',  prior: '2.8%',                     actual: null, actualBeat: null },
  { date: '2026-04-10', time: '10:00', event: 'UMich Consumer Sentiment (Apr)', consensus: null,    prior: null,                        actual: null, actualBeat: null },
  { date: '2026-04-17', time: '08:30', event: 'Initial Jobless Claims',          consensus: null,    prior: null,                        actual: null, actualBeat: null },
  { date: '2026-04-17', time: '08:30', event: 'Retail Sales (Mar)',              consensus: null,    prior: null,                        actual: null, actualBeat: null },
  { date: '2026-04-24', time: '08:30', event: 'Initial Jobless Claims',          consensus: null,    prior: null,                        actual: null, actualBeat: null },
  { date: '2026-04-24', time: '08:30', event: 'Durable Goods Orders (Mar)',      consensus: null,    prior: null,                        actual: null, actualBeat: null },
  { date: '2026-04-29', time: 'ALL',   event: 'FOMC Meeting Begins',             consensus: null,    prior: null,  fomc: true,            actual: null, actualBeat: null },
  { date: '2026-04-30', time: '08:30', event: 'GDP Advance (Q1)',                consensus: null,    prior: null,                        actual: null, actualBeat: null },
  { date: '2026-04-30', time: '14:00', event: 'FOMC Decision',                  consensus: 'Hold',  prior: '4.25-4.50%', fomc: true,    actual: null, actualBeat: null },
  { date: '2026-05-01', time: '08:30', event: 'Nonfarm Payrolls (Apr)',          consensus: null,    prior: null,                        actual: null, actualBeat: null },
  { date: '2026-05-01', time: '10:00', event: 'ISM Manufacturing PMI (Apr)',     consensus: null,    prior: null,                        actual: null, actualBeat: null },
  { date: '2026-05-13', time: '08:30', event: 'CPI (Apr)',                       consensus: null,    prior: null,                        actual: null, actualBeat: null },
  { date: '2026-05-14', time: '08:30', event: 'PPI (Apr)',                       consensus: null,    prior: null,                        actual: null, actualBeat: null },
  { date: '2026-05-29', time: '08:30', event: 'GDP 2nd Estimate (Q1)',           consensus: null,    prior: null,                        actual: null, actualBeat: null },
  { date: '2026-05-29', time: '08:30', event: 'PCE Price Index (Apr)',           consensus: null,    prior: null,                        actual: null, actualBeat: null },
  { date: '2026-06-18', time: '14:00', event: 'FOMC Decision',                  consensus: null,    prior: null,  fomc: true,            actual: null, actualBeat: null },
  { date: '2026-07-30', time: '14:00', event: 'FOMC Decision',                  consensus: null,    prior: null,  fomc: true,            actual: null, actualBeat: null },
  { date: '2026-09-17', time: '14:00', event: 'FOMC Decision',                  consensus: null,    prior: null,  fomc: true,            actual: null, actualBeat: null },
  { date: '2026-11-05', time: '14:00', event: 'FOMC Decision',                  consensus: null,    prior: null,  fomc: true,            actual: null, actualBeat: null },
  { date: '2026-12-17', time: '14:00', event: 'FOMC Decision',                  consensus: null,    prior: null,  fomc: true,            actual: null, actualBeat: null },
];

// ============================================
// STATE
// ============================================

var tvInitialized = false;

// Currently active commodity symbol for the TradingView chart
var tvCurrentSymbol = 'NYMEX:CL1!';

function initTradingView(symbol) {
  if (symbol) tvCurrentSymbol = symbol;
  if (tvInitialized) return;
  var wrap = document.getElementById('tradingview-widget');
  if (!wrap) return;
  tvInitialized = true;
  renderTVChart(tvCurrentSymbol);
}

function renderTVChart(symbol) {
  var wrap = document.getElementById('tradingview-widget');
  if (!wrap) return;
  wrap.innerHTML = '';

  var container = document.createElement('div');
  container.className = 'tradingview-widget-container';
  container.style.width = '100%';
  container.style.height = '350px';

  var inner = document.createElement('div');
  inner.className = 'tradingview-widget-container__widget';
  inner.style.width = '100%';
  inner.style.height = '100%';
  container.appendChild(inner);

  var config = {
    symbol: symbol || 'NYMEX:CL1!',
    width: '100%',
    height: 350,
    interval: 'D',
    timezone: 'America/New_York',
    theme: 'dark',
    style: '1',
    locale: 'en',
    backgroundColor: 'rgba(10, 14, 20, 1)',
    gridColor: 'rgba(30, 42, 58, 0.5)',
    allow_symbol_change: true,
    watchlist: ['NYMEX:CL1!', 'NYMEX:BZ1!', 'NYMEX:RB1!', 'NYMEX:HO1!'],
    details: false,
    hotlist: false,
    calendar: false,
    show_popup_button: false
  };

  var script = document.createElement('script');
  script.type = 'text/javascript';
  script.src = 'https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js';
  script.async = true;
  script.textContent = JSON.stringify(config);
  container.appendChild(script);
  wrap.appendChild(container);
}

function switchCommodityChart(symbol) {
  tvCurrentSymbol = symbol;
  tvInitialized = false;   // allow re-render
  renderTVChart(symbol);
  tvInitialized = true;    // restore guard
}

function initCommoditySelector() {
  var sel = document.getElementById('commodity-selector');
  if (!sel) return;
  sel.addEventListener('change', function() {
    switchCommodityChart(sel.value);
  });
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
    var prefix = (key === 'VIX' || key === 'DXY' || key === 'SP500' || key === 'DOW' || key === 'NASDAQ') ? '' : '$';
    html += '<span class="ticker-item">'
      + '<span class="ticker-symbol">' + TICKER_LABELS[key] + '</span>'
      + '<span class="ticker-price">' + prefix + d.current.toFixed(2) + '</span>'
      + '<span class="' + cls + '">' + pctStr + '</span>'
      + '</span>';
  }
  // Duplicate content for seamless scroll loop
  container.innerHTML = html + html;
}

var yieldCurveChart = null;
var refreshTimer = null;
var newsTimer = null;
var tickerTimer = null;
var cachedYahoo = null;
var cachedFred = null;                   // preserved across ticker refreshes
var tickerBackoff = TICKER_REFRESH_MS;   // exponential backoff tracker
var lastManualRefresh = 0;               // debounce R key / refresh button
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
    if (diff < 60000) return 'just now';
    if (diff < 3600000) return Math.floor(diff / 60000) + 'm ago';
    if (diff < 86400000) return Math.floor(diff / 3600000) + 'h ago';
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  } catch (e) { return ''; }
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
  div.className = 'metric' + (opts.inverse ? ' inverse' : '') + (opts.secondary ? ' metric-secondary' : '');
  div.tabIndex = 0;

  // Tooltip: source + raw value
  var tip = label + ': ' + value;
  if (delta) tip += ' (' + delta + ')';
  if (dateStr) tip += ' — ' + dateStr;
  if (opts.stale) tip += ' [stale]';
  div.title = tip;
  div.setAttribute('aria-label', tip);

  // Status dot
  var status = opts.stale ? 'yellow' : (value === 'N/A' ? 'red' : 'green');
  if (opts.status) status = opts.status;

  var lbl = document.createElement('div');
  lbl.className = 'metric-label';
  var dot = document.createElement('span');
  dot.className = 'status-dot dot-' + status;
  dot.setAttribute('aria-hidden', 'true');
  lbl.appendChild(dot);
  lbl.appendChild(document.createTextNode(label));
  div.appendChild(lbl);

  var val = document.createElement('div');
  val.className = 'metric-value' + (value === 'N/A' ? ' value-na' : '') + (opts.sm ? ' sm' : '') + (opts.primary ? ' primary' : '');
  val.textContent = value;
  div.appendChild(val);

  if (opts.stale) {
    var badge = document.createElement('span');
    badge.className = 'stale-badge';
    badge.textContent = 'stale';
    val.appendChild(document.createTextNode(' '));
    val.appendChild(badge);
  }

  if (delta != null && delta !== '') {
    var del = document.createElement('div');
    del.className = 'metric-delta ' + deltaClass(opts.deltaNum);
    // Add directional arrow for accessibility (not color-only)
    var arrow = '';
    var srText = '';
    if (opts.deltaNum != null && Math.abs(opts.deltaNum) >= 0.01) {
      arrow = opts.deltaNum > 0 ? '\u25B2 ' : '\u25BC ';
      srText = opts.deltaNum > 0 ? 'increasing' : 'decreasing';
    }
    if (arrow) {
      var arrowSpan = document.createElement('span');
      arrowSpan.className = 'delta-arrow';
      arrowSpan.setAttribute('aria-hidden', 'true');
      arrowSpan.textContent = arrow;
      del.appendChild(arrowSpan);
      var srSpan = document.createElement('span');
      srSpan.className = 'sr-only';
      srSpan.textContent = srText;
      del.appendChild(srSpan);
    }
    del.appendChild(document.createTextNode(delta));
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
    alerts.push({ level: 'yellow', msg: 'IG OAS at ' + Math.round(ig.current * 100) + ' bps -- wider than ' + THRESHOLDS.igOasWide + ' bps' });
  }

  // FRED data availability check
  var fredDown = data.fred && data.fred.DGS10 && data.fred.DGS10.current == null
    && data.fred.DGS2 && data.fred.DGS2.current == null;
  if (fredDown) {
    alerts.push({ level: 'yellow', msg: 'FRED data unavailable — yields, macro, and credit panels showing N/A. Check FRED API key.' });
  }

  return alerts;
}

// ============================================
// PANEL RENDERERS
// ============================================

function renderYields(fred) {
  var grid = document.getElementById('yields-grid');
  grid.innerHTML = '';
  var anyLive = false;
  for (var i = 0; i < YIELD_KEYS.length; i++) {
    var sid = YIELD_KEYS[i];
    var d = fred[sid];
    if (d && d.current != null) {
      anyLive = true;
      var bps = bpsChange(d.current, d.prior);
      var delta = bps != null ? sign(bps) + bps + ' bps' : '';
      grid.appendChild(renderMetric(YIELD_LABELS[sid], d.current.toFixed(2) + '%', delta, d.date, { deltaNum: bps }));
    } else if (lastKnownYields && lastKnownYields[sid]) {
      var cached = lastKnownYields[sid];
      grid.appendChild(renderMetric(YIELD_LABELS[sid], cached.value, '', cached.date, { stale: true }));
    } else {
      grid.appendChild(renderMetric(YIELD_LABELS[sid], 'N/A', '', ''));
    }
  }
  // Save live data for next time
  if (anyLive) {
    var snapshot = {};
    for (var j = 0; j < YIELD_KEYS.length; j++) {
      var s2 = YIELD_KEYS[j];
      var d2 = fred[s2];
      if (d2 && d2.current != null) snapshot[s2] = { value: d2.current.toFixed(2) + '%', date: d2.date };
    }
    lastKnownYields = snapshot;
    saveLastKnown('yields', snapshot);
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
  var labels = [], valuesT = [], valuesT1 = [], valuesT2 = [], valuesT3 = [];
  for (var i = 0; i < CURVE_KEYS.length; i++) {
    var d = fred[CURVE_KEYS[i]];
    labels.push(CURVE_LABELS[i]);
    valuesT.push(d && d.current != null ? d.current : null);
    valuesT1.push(d && d.prior   != null ? d.prior   : null);
    valuesT2.push(d && d.t2      != null ? d.t2      : null);
    valuesT3.push(d && d.t3      != null ? d.t3      : null);
  }
  var canvas = document.getElementById('yield-curve-canvas');
  var ctx = canvas.getContext('2d');

  var datasets = [
    {
      label: 'Today',
      data: valuesT,
      borderColor: '#3b82f6',
      backgroundColor: 'rgba(59,130,246,0.07)',
      fill: true, tension: 0.3, pointRadius: 4,
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
      borderColor: '#6366f1',
      backgroundColor: 'transparent',
      fill: false, tension: 0.3, pointRadius: 2,
      borderDash: [5, 3], borderWidth: 1.5,
      datalabels: { display: false }
    },
    {
      label: 'T-2',
      data: valuesT2,
      borderColor: '#64748b',
      backgroundColor: 'transparent',
      fill: false, tension: 0.3, pointRadius: 2,
      borderDash: [3, 4], borderWidth: 1.5,
      datalabels: { display: false }
    },
    {
      label: 'T-3',
      data: valuesT3,
      borderColor: '#374151',
      backgroundColor: 'transparent',
      fill: false, tension: 0.3, pointRadius: 2,
      borderDash: [2, 5], borderWidth: 1,
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
      '<span><span class="ycl-swatch" style="background:#6366f1;border-style:dashed"></span>T-1</span>' +
      '<span><span class="ycl-swatch" style="background:#64748b;border-style:dashed"></span>T-2</span>' +
      '<span><span class="ycl-swatch" style="background:#374151;border-style:dashed"></span>T-3</span>';
    canvas.parentElement.parentElement.appendChild(legendDiv);
  }
}

// Cache last known values so FRED outages/weekends don't show all N/A.
// Persisted to localStorage so they survive page reloads.
var lastKnownFunding = loadLastKnown('funding') || { sofr: null, effr: null, onrrp: null };

function loadLastKnown(key) {
  try {
    var raw = localStorage.getItem('td_lk_' + key);
    return raw ? JSON.parse(raw) : null;
  } catch (e) { return null; }
}
function saveLastKnown(key, data) {
  try { localStorage.setItem('td_lk_' + key, JSON.stringify(data)); } catch (e) {}
}

var lastKnownYields = loadLastKnown('yields');
var lastKnownMacro  = loadLastKnown('macro');
var lastKnownCredit = loadLastKnown('credit');

function renderFunding(nyfed, fred) {
  var grid = document.getElementById('funding-grid');
  grid.innerHTML = '';

  // Prefer live data; fall back to last known (persisted across page loads via localStorage)
  var sofrLive = nyfed.sofr && nyfed.sofr.rate != null;
  var effrLive = nyfed.effr && nyfed.effr.rate != null;
  var sofr = sofrLive ? nyfed.sofr : lastKnownFunding.sofr;
  var effr = effrLive ? nyfed.effr : lastKnownFunding.effr;

  // ON RRP comes from FRED — persist it too so weekends don't blank the panel
  var onrrp = (fred.RRPONTSYD && fred.RRPONTSYD.current != null)
    ? fred.RRPONTSYD
    : lastKnownFunding.onrrp;

  // Update in-memory + localStorage when we get fresh data
  var changed = false;
  if (sofrLive)                                    { lastKnownFunding.sofr  = nyfed.sofr;      changed = true; }
  if (effrLive)                                    { lastKnownFunding.effr  = nyfed.effr;      changed = true; }
  if (fred.RRPONTSYD && fred.RRPONTSYD.current != null) { lastKnownFunding.onrrp = fred.RRPONTSYD; changed = true; }
  if (changed) saveLastKnown('funding', lastKnownFunding);

  if (sofr && sofr.rate != null) {
    var volNote = sofr.volume ? ' ($' + sofr.volume.toFixed(0) + 'B)' : '';
    // Append * when showing a cached (stale) value so user knows source age
    var sofrNote = volNote + (!sofrLive && sofr ? ' *' : '');
    grid.appendChild(renderMetric('SOFR', sofr.rate.toFixed(2) + '%', sofrNote, sofr.date));
  } else {
    grid.appendChild(renderMetric('SOFR', 'N/A', '', ''));
  }
  if (effr && effr.rate != null) {
    var effrNote = !effrLive && effr ? '*' : '';
    grid.appendChild(renderMetric('EFFR', effr.rate.toFixed(2) + '%', effrNote, effr.date));
  } else {
    grid.appendChild(renderMetric('EFFR', 'N/A', '', ''));
  }
  if (onrrp && onrrp.current != null) {
    var valB = (onrrp.current / 1000).toFixed(1);
    var onrrpNote = (fred.RRPONTSYD && fred.RRPONTSYD.current != null) ? '' : '*';
    grid.appendChild(renderMetric('ON RRP', '$' + valB + 'B', onrrpNote, onrrp.date));
  } else {
    grid.appendChild(renderMetric('ON RRP', 'N/A', '', ''));
  }
  var footer = document.getElementById('funding-footer');
  if (sofr && effr && sofr.rate != null && effr.rate != null) {
    var spread = Math.round((sofr.rate - effr.rate) * 100);
    footer.textContent = 'SOFR-EFFR: ' + sign(spread) + spread + ' bps';
  } else {
    footer.textContent = 'SOFR-EFFR: unavailable';
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
  var anyCreditLive = false;
  var ig = fred.BAMLC0A0CM;
  if (ig && ig.current != null) {
    anyCreditLive = true;
    var igBps = Math.round(ig.current * 100);
    var igChg = ig.prior != null ? Math.round((ig.current - ig.prior) * 100) : null;
    var igD = igChg != null ? sign(igChg) + igChg + ' bps' : '';
    creditGrid.appendChild(renderMetric('IG OAS', igBps + ' bps', igD, ig.date, { deltaNum: igChg }));
  } else if (lastKnownCredit && lastKnownCredit.ig) {
    creditGrid.appendChild(renderMetric('IG OAS', lastKnownCredit.ig.value, '', lastKnownCredit.ig.date, { stale: true }));
  } else {
    creditGrid.appendChild(renderMetric('IG OAS', 'N/A', '', ''));
  }
  var hy = fred.BAMLH0A0HYM2;
  if (hy && hy.current != null) {
    anyCreditLive = true;
    var hyBps = Math.round(hy.current * 100);
    var hyChg = hy.prior != null ? Math.round((hy.current - hy.prior) * 100) : null;
    var hyD = hyChg != null ? sign(hyChg) + hyChg + ' bps' : '';
    creditGrid.appendChild(renderMetric('HY OAS', hyBps + ' bps', hyD, hy.date, { deltaNum: hyChg }));
  } else if (lastKnownCredit && lastKnownCredit.hy) {
    creditGrid.appendChild(renderMetric('HY OAS', lastKnownCredit.hy.value, '', lastKnownCredit.hy.date, { stale: true }));
  } else {
    creditGrid.appendChild(renderMetric('HY OAS', 'N/A', '', ''));
  }
  if (anyCreditLive) {
    var snap = {};
    if (ig && ig.current != null) snap.ig = { value: Math.round(ig.current * 100) + ' bps', date: ig.date };
    if (hy && hy.current != null) snap.hy = { value: Math.round(hy.current * 100) + ' bps', date: hy.date };
    lastKnownCredit = snap;
    saveLastKnown('credit', snap);
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
  var baseSelect  = document.getElementById('fx-base');
  var quoteSelect = document.getElementById('fx-quote');
  var amountInput = document.getElementById('fx-amount');
  if (!fxConverterInitialized) {
    fxConverterInitialized = true;
    baseSelect.innerHTML = '';
    quoteSelect.innerHTML = '';
    for (var i = 0; i < FX_CURRENCIES.length; i++) {
      var c = FX_CURRENCIES[i];
      baseSelect.appendChild(new Option(c, c));
      quoteSelect.appendChild(new Option(c, c));
    }
    baseSelect.value  = 'USD';
    quoteSelect.value = 'EUR';

    var compute = function() { computeFxConversion(); };
    baseSelect.addEventListener('change', compute);
    quoteSelect.addEventListener('change', compute);
    amountInput.addEventListener('input', compute);

    document.getElementById('fx-swap').addEventListener('click', function() {
      var tmp = baseSelect.value;
      baseSelect.value  = quoteSelect.value;
      quoteSelect.value = tmp;
      computeFxConversion();
    });

    // Preset amount buttons
    var presetBtns = document.querySelectorAll('.fx-preset-btn');
    for (var j = 0; j < presetBtns.length; j++) {
      (function(btn) {
        btn.addEventListener('click', function() {
          amountInput.value = btn.getAttribute('data-amount');
          // Active state
          for (var k = 0; k < presetBtns.length; k++) presetBtns[k].classList.remove('active');
          btn.classList.add('active');
          computeFxConversion();
        });
      })(presetBtns[j]);
    }
  }
  computeFxConversion();
}

function computeFxConversion() {
  var amount = parseFloat(document.getElementById('fx-amount').value);
  var base = document.getElementById('fx-base').value;
  var quote = document.getElementById('fx-quote').value;
  var resultEl   = document.getElementById('fx-result');
  var rateEl     = document.getElementById('fx-rate-line');
  var reverseEl  = document.getElementById('fx-reverse-rate');
  var trendEl    = document.getElementById('fx-rate-trend');

  if (!resultEl) return;

  if (isNaN(amount) || base === quote) {
    resultEl.textContent = base === quote ? fmt(amount, 2, '') + ' ' + quote : '--';
    if (rateEl)    rateEl.textContent = '';
    if (reverseEl) reverseEl.textContent = '';
    if (trendEl)   trendEl.textContent = '';
    return;
  }
  var baseUSD  = getToUSD(base);
  var quoteUSD = getToUSD(quote);
  if (!baseUSD || !quoteUSD) {
    resultEl.textContent = 'Rate unavailable';
    if (rateEl)    rateEl.textContent = '';
    if (reverseEl) reverseEl.textContent = '';
    if (trendEl)   trendEl.textContent = '';
    return;
  }
  var crossRate    = baseUSD / quoteUSD;
  var crossRateRev = 1 / crossRate;
  var result = amount * crossRate;

  // Main result — animated via CSS class toggle
  var newText = result.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' ' + quote;
  if (resultEl.textContent !== newText) {
    resultEl.classList.remove('fx-result-flash');
    void resultEl.offsetWidth; // force reflow
    resultEl.classList.add('fx-result-flash');
    resultEl.textContent = newText;
  }

  // Forward rate line
  var dec = crossRate > 10 ? 2 : 4;
  if (rateEl) rateEl.textContent = '1 ' + base + ' = ' + crossRate.toFixed(dec) + ' ' + quote;

  // Reverse rate line
  var decRev = crossRateRev > 10 ? 2 : 4;
  if (reverseEl) reverseEl.textContent = '1 ' + quote + ' = ' + crossRateRev.toFixed(decRev) + ' ' + base;

  // Trend vs yesterday (rate change direction)
  if (trendEl && cachedYahoo) {
    // Try to find prior rate for this pair
    var baseUSDPrior  = getToUSDPrior(base);
    var quoteUSDPrior = getToUSDPrior(quote);
    if (baseUSDPrior && quoteUSDPrior) {
      var priorCross = baseUSDPrior / quoteUSDPrior;
      var pct = ((crossRate - priorCross) / priorCross) * 100;
      var sign = pct >= 0 ? '+' : '';
      trendEl.textContent = sign + pct.toFixed(2) + '% vs prev';
      trendEl.className = 'fx-rate-trend ' + (pct > 0 ? 'trend-up' : pct < 0 ? 'trend-down' : 'trend-flat');
    } else {
      trendEl.textContent = '';
    }
  }
}

function getToUSDPrior(ccy) {
  if (ccy === 'USD') return 1;
  if (!cachedYahoo) return null;
  var key = FX_YAHOO_MAP[ccy];
  if (!key || !cachedYahoo[key] || cachedYahoo[key].prior == null) return null;
  var rate = cachedYahoo[key].prior;
  return FX_INVERTED[ccy] ? 1 / rate : rate;
}

function renderMacro(macro) {
  var grid = document.getElementById('macro-grid');
  grid.innerHTML = '';
  var anyLive = false;
  for (var i = 0; i < MACRO_DISPLAY.length; i++) {
    var m = MACRO_DISPLAY[i];
    var d = macro[m.id];
    if (d && d.current != null) {
      anyLive = true;
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
    } else if (lastKnownMacro && lastKnownMacro[m.id]) {
      var cached = lastKnownMacro[m.id];
      grid.appendChild(renderMetric(m.label, cached.value, '', cached.date, { sm: true, stale: true }));
    } else {
      grid.appendChild(renderMetric(m.label, 'N/A', '', ''));
    }
  }
  if (anyLive) {
    var snapshot = {};
    for (var j = 0; j < MACRO_DISPLAY.length; j++) {
      var m2 = MACRO_DISPLAY[j];
      var d2 = macro[m2.id];
      if (d2 && d2.current != null) {
        var v2 = m2.divideBy ? d2.current / m2.divideBy : d2.current;
        snapshot[m2.id] = { value: v2.toFixed(m2.dec) + m2.suffix, date: d2.date };
      }
    }
    lastKnownMacro = snapshot;
    saveLastKnown('macro', snapshot);
  }
}

// ============================================
// CUSTOM ECONOMIC CALENDAR
// ============================================
// Hardcoded upcoming events with color-coded urgency tiers.
// FOMC badge in header uses worker-provided FOMC_2026 dates.

function renderCalendar(fomc) {
  var container = document.getElementById('calendar-content');
  if (!container) return;
  container.innerHTML = '';

  // Legend
  var legend = document.createElement('div');
  legend.className = 'cal-legend';
  legend.innerHTML =
    '<span class="cal-legend-item"><span class="cal-legend-dot dot-high"></span>High Impact</span>' +
    '<span class="cal-legend-item"><span class="cal-legend-dot dot-medium"></span>Medium</span>' +
    '<span class="cal-legend-item"><span class="cal-legend-dot dot-fomc"></span>FOMC</span>' +
    '<span class="cal-legend-item"><span class="cal-legend-dot dot-today"></span>Today</span>';
  container.appendChild(legend);

  var todayStr = new Date().toISOString().split('T')[0];
  var upcoming = [];
  for (var i = 0; i < ECON_CALENDAR.length; i++) {
    if (ECON_CALENDAR[i].date >= todayStr) upcoming.push(ECON_CALENDAR[i]);
  }
  upcoming = upcoming.slice(0, 12);

  if (upcoming.length === 0) {
    container.innerHTML += '<div class="news-empty">No upcoming events. Update ECON_CALENDAR in app.js.</div>';
    return;
  }

  var table = document.createElement('table');
  table.className = 'cal-table';
  var thead = document.createElement('thead');
  thead.innerHTML = '<tr><th>Date</th><th>Event</th><th>Est.</th><th>Prior</th><th>Actual</th></tr>';
  table.appendChild(thead);
  var tbody = document.createElement('tbody');

  for (var j = 0; j < upcoming.length; j++) {
    var e = upcoming[j];
    var tr = document.createElement('tr');
    if (e.date === todayStr) tr.className = 'today';
    if (isHighImpact(e.event) || e.fomc) tr.classList.add('cal-urgency-high');
    else if (isMediumImpact(e.event))    tr.classList.add('cal-urgency-medium');

    var d = new Date(e.date + 'T12:00:00');
    var dateLabel = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', weekday: 'short' });
    if (e.time && e.time !== 'ALL') dateLabel += ' ' + e.time;

    var eventCell = e.event;
    if (e.fomc) eventCell = '<span class="cal-fomc">' + e.event + '</span>';
    if (e.date === todayStr) eventCell += ' <span class="cal-tag cal-tag-today">TODAY</span>';

    var actualCell = '--';
    if (e.actual != null) {
      var actualClass = e.actualBeat === true  ? 'cal-actual-beat' :
                        e.actualBeat === false ? 'cal-actual-miss' : 'cal-actual-pending';
      actualCell = '<span class="' + actualClass + '">' + e.actual + '</span>';
    }
    tr.innerHTML = '<td class="cal-date">' + dateLabel + '</td>'
      + '<td class="cal-event">' + eventCell + '</td>'
      + '<td class="cal-values">' + (e.consensus || '--') + '</td>'
      + '<td class="cal-values">' + (e.prior    || '--') + '</td>'
      + '<td class="cal-values cal-actual">' + actualCell + '</td>';
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

// ============================================
// TRADINGVIEW S&P 500 HEATMAP
// ============================================
// Full-width panel, lazy-loaded via IntersectionObserver for performance.

var tvHeatmapLoaded = false;

function initTVHeatmap() {
  var container = document.getElementById('heatmap-content');
  if (!container) return;

  // Clear and rebuild — TV heatmap widgets don't auto-refresh; must re-inject script
  container.innerHTML = '';
  var widgetDiv = document.createElement('div');
  widgetDiv.className = 'tradingview-widget-container';
  widgetDiv.style.height = '100%';
  widgetDiv.style.width = '100%';

  var inner = document.createElement('div');
  inner.className = 'tradingview-widget-container__widget';
  widgetDiv.appendChild(inner);

  var config = {
    dataSource: 'SPX500',
    blockSize: 'market_cap_basic',
    blockColor: 'change',
    grouping: 'sector',
    locale: 'en',
    symbolUrl: '',
    colorTheme: 'dark',
    hasTopBar: false,
    isDataSet498Enabled: false,
    isZoomEnabled: true,
    hasSymbolTooltip: true,
    isMonoSize: false,
    width: '100%',
    height: 400
  };

  var script = document.createElement('script');
  script.type = 'text/javascript';
  script.src = 'https://s3.tradingview.com/external-embedding/embed-widget-stock-heatmap.js';
  script.async = true;
  script.textContent = JSON.stringify(config);
  widgetDiv.appendChild(script);

  container.appendChild(widgetDiv);

  // Timestamp label
  var ts = document.createElement('div');
  ts.className = 'heatmap-timestamp';
  var now = new Date();
  ts.textContent = 'Updated ' + now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
  container.appendChild(ts);
  tvHeatmapLoaded = true;
}

// Lazy-load heatmap when panel scrolls into view
function lazyLoadHeatmap() {
  var panel = document.getElementById('panel-heatmap');
  if (!panel) return;

  if (!tvHeatmapLoaded) {
    if ('IntersectionObserver' in window) {
      var observer = new IntersectionObserver(function(entries) {
        if (entries[0].isIntersecting) {
          initTVHeatmap();
          observer.disconnect();
        }
      }, { rootMargin: '200px' });
      observer.observe(panel);
    } else {
      setTimeout(initTVHeatmap, 2000);
    }
  } else {
    // Already loaded once — refresh the widget by rebuilding it
    initTVHeatmap();
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
  // Last-updated timestamp
  if (items.length > 0 && items[0].date) {
    var tsSpan = document.createElement('div');
    tsSpan.className = 'news-updated';
    tsSpan.textContent = 'Updated ' + formatTime(items[0].date);
    container.appendChild(tsSpan);
  }
  // Show up to 30 items (increased from 20 — worker now provides 50)
  for (var i = 0; i < items.length && i < 30; i++) {
    var item = items[i];
    var div = document.createElement('div');
    div.className = 'news-item';
    // Category tag
    var tagSpan = document.createElement('span');
    tagSpan.className = 'news-tag news-tag-' + (item.tag || 'MARKETS');
    tagSpan.textContent = item.tag || 'NEWS';
    // Article body
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
    // Source badge + timestamp meta line
    var metaDiv = document.createElement('div');
    metaDiv.className = 'news-meta';
    var metaParts = '';
    if (item.isGov) metaParts += '<span class="news-gov">GOV</span> ';
    if (item.source) metaParts += '<span class="news-source-badge">' + item.source + '</span>';
    if (item.date) metaParts += ' <span class="news-time">' + formatTime(item.date) + '</span>';
    metaDiv.innerHTML = metaParts;
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
  renderYields(data.fred);
  renderYieldCurve(data.fred);
  renderFunding(data.nyfed, data.fred);
  renderRisk(data.yahoo, data.fred);
  renderCommodities(data.yahoo);
  renderForex(data.yahoo);
  renderMacro(data.macro);
  renderCalendar(data.fomc);
  renderTicker(data.yahoo);
  renderMovers(data.yahoo);

  // Source attribution
  var yDate = data.fred.DGS10 ? data.fred.DGS10.date : null;
  addSourceAttribution('panel-yields', 'FRED', yDate);
  addSourceAttribution('panel-funding', 'NY Fed / FRED', data.nyfed.sofr ? data.nyfed.sofr.date : null);
  addSourceAttribution('panel-risk', 'Yahoo / FRED', data.yahoo.VIX ? data.yahoo.VIX.date : null);
  addSourceAttribution('panel-commodities', 'Yahoo Finance', data.yahoo.WTI ? data.yahoo.WTI.date : null);
  addSourceAttribution('panel-forex', 'Yahoo Finance', data.yahoo.EURUSD ? data.yahoo.EURUSD.date : null);
  addSourceAttribution('panel-macro', 'FRED', data.macro.UNRATE ? data.macro.UNRATE.date : null);
  addSourceAttribution('panel-calendar', 'Fed / BLS / BEA', null);
  addSourceAttribution('panel-news', 'Fed / ECB / WSJ / Reuters / CNBC / MarketWatch / Yahoo / Seeking Alpha', null);
  addSourceAttribution('panel-movers', 'Yahoo Finance', data.yahoo.WTI ? data.yahoo.WTI.date : null);

  initTradingView();
  initCommoditySelector();

  // Clear error states on successful render
  var allPanels = document.querySelectorAll('.panel-error');
  for (var pe = 0; pe < allPanels.length; pe++) allPanels[pe].classList.remove('panel-error');

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
  beginFetch();
  fetch(WORKER_URL + '/api/market-data')
    .then(function(resp) {
      if (!resp.ok) throw new Error('Worker returned ' + resp.status);
      return resp.json();
    })
    .then(function(data) {
      fetchRetryCount = 0;
      tickerBackoff = isMarketOpen() ? TICKER_REFRESH_MS : TICKER_REFRESH_SLOW;
      lastRefreshTime = Date.now();
      renderDashboard(data);
      updateAgoCounter();
    })
    .catch(function(err) {
      fetchRetryCount++;
      var cached = getCachedData('market', 3600000);
      if (cached) {
        try { renderDashboard(cached); return; } catch (e) {}
      }
      // After 3 retries, show error state on panels
      if (fetchRetryCount >= 3) {
        var panels = document.querySelectorAll('.panel');
        for (var p = 0; p < panels.length; p++) panels[p].classList.add('panel-error');
      }
      var loading = document.getElementById('loading');
      if (loading.style.display !== 'none') {
        loading.innerHTML = '<div class="error-msg">Failed to load market data: ' + err.message
          + '<br><small>Worker: ' + WORKER_URL + '</small>'
          + '<br><small>Will retry in 15 minutes. Press R to retry now.</small></div>';
      }
    })
    .finally(endFetch);
}

// All news now fetched worker-side (Fed, ECB, CNBC, WSJ, Reuters, MarketWatch,
// Yahoo Finance, Seeking Alpha). No rss2json dependency, no client-side rate limits.
function fetchNews() {
  if (WORKER_URL.indexOf('YOUR_') !== -1) return;

  fetch(WORKER_URL + '/api/news')
    .then(function(resp) {
      if (!resp.ok) throw new Error('Worker news ' + resp.status);
      return resp.json();
    })
    .then(function(data) {
      var items = data.items || [];
      cacheData('news', items);
      renderNews(items);
    })
    .catch(function(err) {
      // Fall back to cached news on failure
      var cached = getCachedData('news', 7200000); // 2hr stale cache for fallback
      if (cached) renderNews(cached);
    });
}

// Smart ticker refresh -- hits lightweight /api/ticker endpoint (9 symbols only).
// Full /api/market-data stays on the 15-min timer -- no FRED/NY Fed overhead every 10s.
function tickerRefresh() {
  if (WORKER_URL.indexOf('YOUR_') !== -1) return;
  fetch(WORKER_URL + '/api/ticker')
    .then(function(resp) {
      if (!resp.ok) throw new Error(resp.status);
      return resp.json();
    })
    .then(function(data) {
      // Merge ticker symbols into cached full dataset so other panels stay intact
      cachedYahoo = Object.assign(cachedYahoo || {}, data.yahoo);
      renderTicker(cachedYahoo);
      renderCommodities(cachedYahoo);
      renderRisk(cachedYahoo, cachedFred || {});
      renderMovers(cachedYahoo);
      tickerBackoff = isMarketOpen() ? TICKER_REFRESH_MS : TICKER_REFRESH_SLOW;
    })
    .catch(function() {
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
// LIVE CATALYSTS — Bloomberg TV + CNBC (dual-screen, stacked)
// ============================================

// Bloomberg only — live stream now embedded inside the Treasury Yields panel
var LIVE_CHANNELS = [
  { label: 'Bloomberg TV', channelId: 'UCIALMKvObZNtJ6AmdCLP7Lg', link: 'https://www.youtube.com/@BloombergTelevision/live' }
];

function initLiveStreams() {
  var container = document.getElementById('live-streams');
  if (!container) return;
  container.innerHTML = '';

  var live = isMarketOpen();

  // Update the pre-rendered live dot in the Yields panel header
  var dot = document.getElementById('live-dot-indicator');
  if (dot) {
    dot.className = 'live-dot' + (live ? '' : ' live-dot-off');
  }

  // Bloomberg only — single iframe, no loop needed
  var ch = LIVE_CHANNELS[0];
  var iframe = document.createElement('iframe');
  iframe.src = 'https://www.youtube.com/embed/live_stream?channel=' + ch.channelId
    + '&autoplay=1&mute=1&playsinline=1&modestbranding=1&rel=0';
  iframe.title = ch.label + ' Live';
  iframe.loading = 'lazy';
  iframe.setAttribute('allow', 'autoplay; encrypted-media; picture-in-picture');
  iframe.setAttribute('allowfullscreen', '');
  container.appendChild(iframe);
}

// ============================================
// ENERGY MOVERS (sorted by % change)
// ============================================

var MOVERS_KEYS = ['WTI', 'Brent', 'NatGas', 'HeatOil', 'Copper', 'Gold', 'Silver', 'VIX', 'DXY'];
var MOVERS_LABELS = {
  WTI: 'WTI Crude', Brent: 'Brent', NatGas: 'Nat Gas', HeatOil: 'Heat Oil',
  Copper: 'Copper', Gold: 'Gold', Silver: 'Silver', VIX: 'VIX', DXY: 'DXY'
};

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
      if (Date.now() - lastManualRefresh < 3000) return;
      lastManualRefresh = Date.now();
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
      var liveEl = document.getElementById('panel-live');
      if (liveEl) liveEl.classList.toggle('collapsed');
      return;
    }
  });

  document.getElementById('btn-refresh').addEventListener('click', function() {
    if (Date.now() - lastManualRefresh < 3000) return;
    lastManualRefresh = Date.now();
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
      savePanelPrefs();
    });
  }
}

// ============================================
// SKELETON LOADING (per-panel placeholders)
// ============================================

function showSkeletons() {
  var grids = ['yields-grid', 'forex-grid', 'commodities-grid', 'macro-grid', 'funding-grid', 'risk-grid', 'credit-grid'];
  for (var i = 0; i < grids.length; i++) {
    var g = document.getElementById(grids[i]);
    if (!g || g.children.length > 0) continue;
    var count = grids[i] === 'commodities-grid' ? 7 : 4;
    for (var j = 0; j < count; j++) {
      var sk = document.createElement('div');
      sk.className = 'metric';
      sk.innerHTML = '<div class="skeleton-line sk-sm"></div><div class="skeleton-line sk-lg"></div><div class="skeleton-line sk-sm"></div>';
      g.appendChild(sk);
    }
  }
}

// ============================================
// REFRESH INDICATOR (spin button + updated-ago counter)
// ============================================

var lastRefreshTime = 0;
var fetchInFlight = 0;

function beginFetch() {
  fetchInFlight++;
  var btn = document.getElementById('btn-refresh');
  if (btn) btn.classList.add('refreshing');
}
function endFetch() {
  fetchInFlight = Math.max(0, fetchInFlight - 1);
  if (fetchInFlight === 0) {
    var btn = document.getElementById('btn-refresh');
    if (btn) btn.classList.remove('refreshing');
  }
}
function updateAgoCounter() {
  if (!lastRefreshTime) return;
  var secs = Math.round((Date.now() - lastRefreshTime) / 1000);
  var label = secs < 60 ? secs + 's ago' : Math.floor(secs / 60) + 'm ago';
  var el = document.getElementById('updated-ago');
  if (!el) {
    el = document.createElement('span');
    el.id = 'updated-ago';
    var meta = document.getElementById('header-meta');
    if (meta) meta.appendChild(el);
  }
  el.textContent = ' | Updated ' + label;
}

// ============================================
// DENSITY TOGGLE
// ============================================

function initDensityToggle() {
  var saved = localStorage.getItem('td_density');
  if (saved === 'compact') document.body.classList.add('density-compact');
  var btn = document.getElementById('btn-density');
  if (!btn) return;
  btn.textContent = document.body.classList.contains('density-compact') ? 'Comfortable' : 'Compact';
  btn.addEventListener('click', function() {
    document.body.classList.toggle('density-compact');
    var isCompact = document.body.classList.contains('density-compact');
    btn.textContent = isCompact ? 'Comfortable' : 'Compact';
    localStorage.setItem('td_density', isCompact ? 'compact' : 'comfortable');
  });
}

// ============================================
// PANEL PREFS (persist collapsed state)
// ============================================

function loadPanelPrefs() {
  try {
    var prefs = JSON.parse(localStorage.getItem('td_panel_prefs') || '{}');
    var ids = Object.keys(prefs);
    for (var i = 0; i < ids.length; i++) {
      if (prefs[ids[i]].collapsed) {
        var el = document.getElementById(ids[i]);
        if (el) el.classList.add('collapsed');
      }
    }
  } catch (e) {}
}

function savePanelPrefs() {
  var panels = document.querySelectorAll('.panel[id]');
  var prefs = {};
  for (var i = 0; i < panels.length; i++) {
    if (panels[i].classList.contains('collapsed')) {
      prefs[panels[i].id] = { collapsed: true };
    }
  }
  try { localStorage.setItem('td_panel_prefs', JSON.stringify(prefs)); } catch (e) {}
}

// ============================================
// LAZY INIT UTILITY (IntersectionObserver)
// ============================================

function lazyInit(panelId, initFn) {
  var panel = document.getElementById(panelId);
  if (!panel) { initFn(); return; }
  if ('IntersectionObserver' in window) {
    var obs = new IntersectionObserver(function(entries) {
      if (entries[0].isIntersecting) { initFn(); obs.disconnect(); }
    }, { rootMargin: '300px' });
    obs.observe(panel);
  } else {
    setTimeout(initFn, 1500);
  }
}

// ============================================
// ERROR RETRY COUNTER
// ============================================

var fetchRetryCount = 0;

// ============================================
// INIT
// ============================================

// 0. Show dashboard grid immediately with skeletons
document.getElementById('dashboard').style.display = 'grid';
showSkeletons();
loadPanelPrefs();
initDensityToggle();

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

// 6. Lazy-init heavy widgets
lazyInit('panel-live', initLiveStreams);

// 7. Updated-ago counter (ticks every 10s)
setInterval(updateAgoCounter, 10000);
