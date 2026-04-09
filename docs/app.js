/**
 * Treasury Intelligence Dashboard — Client Application
 *
 * REFRESH STRATEGY:
 *   - Energy ticker: 10s during market hours, 60s overnight
 *   - Full dashboard: 15 min
 *   - News: 30 min
 *   - localStorage cache: instant display on load, background refresh
 */

// ============================================
// CONFIG
// ============================================

var WORKER_URL = 'https://treasury-proxy.treasurydashboard.workers.dev';

var REFRESH_MS = 15 * 60 * 1000;
var NEWS_REFRESH_MS = 30 * 60 * 1000;
var TICKER_REFRESH_MS = 10 * 1000;
var TICKER_REFRESH_SLOW = 60 * 1000;

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

var COMMODITY_KEYS = ['WTI', 'Brent', 'NatGas', 'HeatOil', 'Copper', 'Gold', 'Silver'];
var COMMODITY_LABELS = { WTI: 'WTI Crude', Brent: 'Brent Crude', NatGas: 'Henry Hub', HeatOil: 'Heating Oil', Copper: 'Copper', Gold: 'Gold', Silver: 'Silver' };
var ENERGY_KEYS = ['WTI', 'Brent', 'NatGas', 'HeatOil'];
var FOREX_KEYS = ['EURUSD', 'GBPUSD', 'USDJPY', 'AUDUSD', 'USDCAD', 'USDCHF', 'USDCNH'];
var FOREX_LABELS = { EURUSD: 'EUR/USD', GBPUSD: 'GBP/USD', USDJPY: 'USD/JPY', AUDUSD: 'AUD/USD', USDCAD: 'USD/CAD', USDCHF: 'USD/CHF', USDCNH: 'USD/CNH' };

// Expanded currency list for FX converter
var FX_CURRENCIES = ['USD','EUR','GBP','JPY','AUD','CAD','CHF','CNH','NZD','MXN','BRL','SGD','HKD','INR','SEK','NOK'];
var FX_CURRENCY_NAMES = {
  USD:'US Dollar', EUR:'Euro', GBP:'British Pound', JPY:'Japanese Yen',
  AUD:'Australian Dollar', CAD:'Canadian Dollar', CHF:'Swiss Franc', CNH:'Chinese Yuan',
  NZD:'New Zealand Dollar', MXN:'Mexican Peso', BRL:'Brazilian Real', SGD:'Singapore Dollar',
  HKD:'Hong Kong Dollar', INR:'Indian Rupee', SEK:'Swedish Krona', NOK:'Norwegian Krone'
};
var FX_YAHOO_MAP = {
  EUR:'EURUSD', GBP:'GBPUSD', AUD:'AUDUSD', JPY:'USDJPY', CAD:'USDCAD',
  CHF:'USDCHF', CNH:'USDCNH', NZD:'NZDUSD', MXN:'USDMXN', BRL:'USDBRL',
  SGD:'USDSGD', HKD:'USDHKD', INR:'USDINR', SEK:'USDSEK', NOK:'USDNOK'
};
var FX_INVERTED = { JPY:true, CAD:true, CHF:true, CNH:true, MXN:true, BRL:true, SGD:true, HKD:true, INR:true, SEK:true, NOK:true };

// Yield keys: 1M/3M/6M (short-end treasury focus)
var YIELD_KEYS = ['DGS1MO', 'DGS3MO', 'DGS6MO'];
var YIELD_LABELS = { DGS1MO: '1M UST', DGS3MO: '3M UST', DGS6MO: '6M UST' };
var CURVE_KEYS = ['DGS1MO', 'DGS3MO', 'DGS6MO'];
var CURVE_LABELS = ['1M', '3M', '6M'];

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

var HIGH_IMPACT_KEYWORDS = ['CPI', 'PCE', 'FOMC', 'Nonfarm', 'GDP', 'PPI'];
var MEDIUM_IMPACT_KEYWORDS = ['PMI', 'Retail', 'Durable', 'UMich', 'Claims', 'Sentiment'];

function isHighImpact(n) { for (var i = 0; i < HIGH_IMPACT_KEYWORDS.length; i++) { if (n.indexOf(HIGH_IMPACT_KEYWORDS[i]) !== -1) return true; } return false; }
function isMediumImpact(n) { for (var i = 0; i < MEDIUM_IMPACT_KEYWORDS.length; i++) { if (n.indexOf(MEDIUM_IMPACT_KEYWORDS[i]) !== -1) return true; } return false; }

var ECON_CALENDAR = [
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

var yieldCurveChart = null;
var refreshTimer = null;
var newsTimer = null;
var tickerTimer = null;
var cachedYahoo = null;
var cachedFred = null;
var tickerBackoff = TICKER_REFRESH_MS;
var lastManualRefresh = 0;
var fxConverterInitialized = false;

// ============================================
// HELPERS
// ============================================

function fmt(val, dec, prefix) {
  if (dec === undefined) dec = 2;
  if (prefix === undefined) prefix = '$';
  if (val == null || isNaN(val)) return 'N/A';
  return prefix + Number(val).toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec });
}
function pctChange(cur, prev) { if (cur == null || prev == null || prev === 0) return null; return ((cur - prev) / prev) * 100; }
function bpsChange(cur, prev) { if (cur == null || prev == null) return null; return Math.round((cur - prev) * 100); }
function sign(val) { return val == null ? '' : val >= 0 ? '+' : ''; }
function deltaClass(val) { if (val == null || Math.abs(val) < 0.01) return 'delta-flat'; return val > 0 ? 'delta-up' : 'delta-down'; }
function nowET() { return new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' })); }
function isMarketOpen() { var n = nowET(), d = n.getDay(), m = n.getHours() * 60 + n.getMinutes(); return d > 0 && d < 6 && m >= 570 && m < 960; }
function formatTime(dateStr) {
  try { var d = new Date(dateStr); if (isNaN(d)) return ''; var diff = new Date() - d;
    if (diff < 60000) return 'just now'; if (diff < 3600000) return Math.floor(diff / 60000) + 'm ago';
    if (diff < 86400000) return Math.floor(diff / 3600000) + 'h ago';
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  } catch (e) { return ''; }
}

// ============================================
// LOCALSTORAGE CACHE
// ============================================

function cacheData(key, data) { try { localStorage.setItem('td_' + key, JSON.stringify({ t: Date.now(), d: data })); } catch (e) {} }
function getCachedData(key, maxAgeMs) {
  try { var raw = localStorage.getItem('td_' + key); if (!raw) return null; var parsed = JSON.parse(raw);
    if (Date.now() - parsed.t > (maxAgeMs || 300000)) return null; return parsed.d;
  } catch (e) { return null; }
}
function loadLastKnown(key) { try { var raw = localStorage.getItem('td_lk_' + key); return raw ? JSON.parse(raw) : null; } catch (e) { return null; } }
function saveLastKnown(key, data) { try { localStorage.setItem('td_lk_' + key, JSON.stringify(data)); } catch (e) {} }

var lastKnownFunding = loadLastKnown('funding') || {};
var lastKnownYields = loadLastKnown('yields');
var lastKnownMacro  = loadLastKnown('macro');

// ============================================
// METRIC RENDERING
// ============================================

function renderMetric(label, value, delta, dateStr, opts) {
  if (!opts) opts = {};
  var div = document.createElement('div');
  div.className = 'metric' + (opts.inverse ? ' inverse' : '') + (opts.secondary ? ' metric-secondary' : '');
  div.tabIndex = 0;
  var tip = label + ': ' + value; if (delta) tip += ' (' + delta + ')'; if (dateStr) tip += ' — ' + dateStr; if (opts.stale) tip += ' [stale]';
  div.title = tip; div.setAttribute('aria-label', tip);
  var status = opts.stale ? 'yellow' : (value === 'N/A' ? 'red' : 'green'); if (opts.status) status = opts.status;

  var lbl = document.createElement('div'); lbl.className = 'metric-label';
  var dot = document.createElement('span'); dot.className = 'status-dot dot-' + status; dot.setAttribute('aria-hidden', 'true');
  lbl.appendChild(dot); lbl.appendChild(document.createTextNode(label)); div.appendChild(lbl);

  var val = document.createElement('div');
  val.className = 'metric-value' + (value === 'N/A' ? ' value-na' : '') + (opts.sm ? ' sm' : '') + (opts.primary ? ' primary' : '');
  val.textContent = value; div.appendChild(val);

  if (opts.stale) { var badge = document.createElement('span'); badge.className = 'stale-badge'; badge.textContent = 'stale'; val.appendChild(document.createTextNode(' ')); val.appendChild(badge); }

  if (delta != null && delta !== '') {
    var del = document.createElement('div'); del.className = 'metric-delta ' + deltaClass(opts.deltaNum);
    if (opts.deltaNum != null && Math.abs(opts.deltaNum) >= 0.01) {
      var arrowSpan = document.createElement('span'); arrowSpan.className = 'delta-arrow'; arrowSpan.setAttribute('aria-hidden', 'true');
      arrowSpan.textContent = opts.deltaNum > 0 ? '\u25B2 ' : '\u25BC ';
      del.appendChild(arrowSpan);
      var srSpan = document.createElement('span'); srSpan.className = 'sr-only'; srSpan.textContent = opts.deltaNum > 0 ? 'increasing' : 'decreasing'; del.appendChild(srSpan);
    }
    del.appendChild(document.createTextNode(delta)); div.appendChild(del);
  }
  if (dateStr) { var dt = document.createElement('div'); dt.className = 'metric-date'; dt.textContent = dateStr; div.appendChild(dt); }
  return div;
}

function addSourceAttribution(panelId, provider, lastDate) {
  var panel = document.getElementById(panelId); if (!panel) return;
  var existing = panel.querySelector('.panel-source'); if (existing) existing.remove();
  var div = document.createElement('div'); div.className = 'panel-source';
  var provSpan = document.createElement('span'); provSpan.className = 'panel-source-provider'; provSpan.textContent = provider; div.appendChild(provSpan);
  if (lastDate) { var timeSpan = document.createElement('span'); timeSpan.className = 'panel-source-time'; timeSpan.textContent = 'As of ' + lastDate; div.appendChild(timeSpan); }
  panel.appendChild(div);
}

// ============================================
// SCROLLING TICKER
// ============================================

function renderTicker(yahoo) {
  if (!yahoo) return;
  var container = document.getElementById('ticker-content'); if (!container) return;
  var html = '';
  for (var i = 0; i < TICKER_SYMBOLS.length; i++) {
    var key = TICKER_SYMBOLS[i], d = yahoo[key]; if (!d || d.current == null) continue;
    var pct = pctChange(d.current, d.prior);
    var cls = pct == null ? 'ticker-flat' : (pct >= 0 ? 'ticker-up' : 'ticker-down');
    var pctStr = pct != null ? (' ' + sign(pct) + pct.toFixed(2) + '%') : '';
    var prefix = (key === 'VIX' || key === 'DXY' || key === 'SP500' || key === 'DOW' || key === 'NASDAQ') ? '' : '$';
    html += '<span class="ticker-item"><span class="ticker-symbol">' + TICKER_LABELS[key] + '</span>'
      + '<span class="ticker-price">' + prefix + d.current.toFixed(2) + '</span>'
      + '<span class="' + cls + '">' + pctStr + '</span></span>';
  }
  container.innerHTML = html + html;
}

// ============================================
// ALERT COMPUTATION (credit alerts kept as silent sentinel)
// ============================================

function computeAlerts(data) {
  var alerts = [], yahoo = data.yahoo;
  // Commodity surge
  var signals = [];
  for (var i = 0; i < ENERGY_KEYS.length; i++) {
    var k = ENERGY_KEYS[i], d = yahoo[k];
    if (d && d.current != null && d.prior != null) {
      var pct = pctChange(d.current, d.prior);
      if (pct != null && Math.abs(pct) >= THRESHOLDS.commodityPct)
        signals.push(COMMODITY_LABELS[k] + ' ' + (pct > 0 ? 'up' : 'down') + ' ' + Math.abs(pct).toFixed(1) + '%');
    }
  }
  if (signals.length >= THRESHOLDS.multiBooksMin) alerts.push({ level: 'red', msg: 'COMMODITY SURGE: ' + signals.join(', ') });
  else if (signals.length === 1) alerts.push({ level: 'yellow', msg: 'COMMODITY WATCH: ' + signals[0] });

  // VIX
  var vix = yahoo.VIX;
  if (vix && vix.current != null) {
    if (vix.current > THRESHOLDS.vixHigh) alerts.push({ level: 'red', msg: 'VIX at ' + vix.current.toFixed(1) + ' — above ' + THRESHOLDS.vixHigh });
    else { var vpct = pctChange(vix.current, vix.prior); if (vpct != null && Math.abs(vpct) > THRESHOLDS.vixPctSpike) alerts.push({ level: 'yellow', msg: 'VIX moved ' + sign(vpct) + vpct.toFixed(1) + '% DoD' }); }
  }

  // DXY
  var dxy = yahoo.DXY;
  if (dxy && dxy.current != null && (dxy.current < THRESHOLDS.dxyLow || dxy.current > THRESHOLDS.dxyHigh))
    alerts.push({ level: 'yellow', msg: 'DXY at ' + dxy.current.toFixed(2) + ' — outside ' + THRESHOLDS.dxyLow + '-' + THRESHOLDS.dxyHigh });

  // 10Y yield
  var y10 = data.fred && data.fred.DGS10;
  if (y10 && y10.current != null && y10.current > THRESHOLDS.yield10YHigh)
    alerts.push({ level: 'red', msg: '10Y yield at ' + y10.current.toFixed(2) + '% — above ' + THRESHOLDS.yield10YHigh + '%' });

  // Credit spreads (silent sentinel — panel removed, alerts preserved)
  var ig = data.fred && data.fred.BAMLC0A0CM;
  if (ig && ig.current != null && ig.current * 100 > THRESHOLDS.igOasWide)
    alerts.push({ level: 'yellow', msg: 'IG OAS at ' + Math.round(ig.current * 100) + ' bps — wider than ' + THRESHOLDS.igOasWide + ' bps' });
  var hy = data.fred && data.fred.BAMLH0A0HYM2;
  if (hy && hy.current != null && hy.current * 100 > THRESHOLDS.hyOasWide)
    alerts.push({ level: 'red', msg: 'HY OAS at ' + Math.round(hy.current * 100) + ' bps — wider than ' + THRESHOLDS.hyOasWide + ' bps' });

  // FRED availability
  if (data.fred && data.fred.DGS10 && data.fred.DGS10.current == null && data.fred.DGS1MO && data.fred.DGS1MO.current == null)
    alerts.push({ level: 'yellow', msg: 'FRED data unavailable — yields and macro panels showing N/A' });

  return alerts;
}

// ============================================
// YIELDS (1M/3M/6M metric cards)
// ============================================

function renderYields(fred) {
  var grid = document.getElementById('yields-grid'); grid.innerHTML = '';
  var anyLive = false;
  for (var i = 0; i < YIELD_KEYS.length; i++) {
    var sid = YIELD_KEYS[i], d = fred[sid];
    if (d && d.current != null) {
      anyLive = true; var bps = bpsChange(d.current, d.prior); var delta = bps != null ? sign(bps) + bps + ' bps' : '';
      grid.appendChild(renderMetric(YIELD_LABELS[sid], d.current.toFixed(2) + '%', delta, d.date, { deltaNum: bps }));
    } else if (lastKnownYields && lastKnownYields[sid]) {
      grid.appendChild(renderMetric(YIELD_LABELS[sid], lastKnownYields[sid].value, '', lastKnownYields[sid].date, { stale: true }));
    } else { grid.appendChild(renderMetric(YIELD_LABELS[sid], 'N/A', '', '')); }
  }
  if (anyLive) { var snap = {}; for (var j = 0; j < YIELD_KEYS.length; j++) { var s2 = YIELD_KEYS[j], d2 = fred[s2]; if (d2 && d2.current != null) snap[s2] = { value: d2.current.toFixed(2) + '%', date: d2.date }; } lastKnownYields = snap; saveLastKnown('yields', snap); }
  var footer = document.getElementById('yields-footer');
  var m1 = fred.DGS1MO, m6 = fred.DGS6MO;
  if (m1 && m6 && m1.current != null && m6.current != null) {
    var s = Math.round((m6.current - m1.current) * 100); var shape = s < 0 ? 'inverted' : s < 10 ? 'flat' : 'positive';
    footer.textContent = '1M-6M spread: ' + sign(s) + s + ' bps (' + shape + ')';
  } else { footer.textContent = ''; }
}

// ============================================
// YIELD GROUPED BAR CHART (3 clusters x 3 bars: T-1/T-7/T-14)
// ============================================

function renderYieldCurve(yieldsHist) {
  if (!yieldsHist) return;
  var labels = [], valuesT1 = [], valuesT7 = [], valuesT14 = [];
  for (var i = 0; i < CURVE_KEYS.length; i++) {
    var d = yieldsHist[CURVE_KEYS[i]];
    labels.push(CURVE_LABELS[i]);
    valuesT1.push(d && d.t1 != null ? d.t1 : null);
    valuesT7.push(d && d.t7 != null ? d.t7 : null);
    valuesT14.push(d && d.t14 != null ? d.t14 : null);
  }

  var canvas = document.getElementById('yield-curve-canvas');
  var ctx = canvas.getContext('2d');

  var sample = yieldsHist[CURVE_KEYS[0]];
  var t1Label = 'T-1' + (sample && sample.t1Date ? ' (' + sample.t1Date + ')' : '');
  var t7Label = 'T-7' + (sample && sample.t7Date ? ' (' + sample.t7Date + ')' : '');
  var t14Label = 'T-14' + (sample && sample.t14Date ? ' (' + sample.t14Date + ')' : '');

  var datasets = [
    {
      label: t1Label, data: valuesT1,
      backgroundColor: 'rgba(59,130,246,0.85)', borderColor: '#3b82f6', borderWidth: 1, borderRadius: 3,
      datalabels: { display: true, color: '#e6edf3', anchor: 'end', align: 'top', offset: 2,
        font: { size: 10, family: 'Consolas, monospace', weight: '600' },
        formatter: function(v) { return v != null ? v.toFixed(2) + '%' : ''; } }
    },
    {
      label: t7Label, data: valuesT7,
      backgroundColor: 'rgba(99,102,241,0.6)', borderColor: '#6366f1', borderWidth: 1, borderRadius: 3,
      datalabels: { display: true, color: '#a5b4fc', anchor: 'end', align: 'top', offset: 2,
        font: { size: 9, family: 'Consolas, monospace' },
        formatter: function(v) { return v != null ? v.toFixed(2) + '%' : ''; } }
    },
    {
      label: t14Label, data: valuesT14,
      backgroundColor: 'rgba(100,116,139,0.5)', borderColor: '#64748b', borderWidth: 1, borderRadius: 3,
      datalabels: { display: true, color: '#94a3b8', anchor: 'end', align: 'top', offset: 2,
        font: { size: 9, family: 'Consolas, monospace' },
        formatter: function(v) { return v != null ? v.toFixed(2) + '%' : ''; } }
    }
  ];

  if (yieldCurveChart) {
    yieldCurveChart.data.labels = labels;
    yieldCurveChart.data.datasets = datasets;
    yieldCurveChart.update();
  } else {
    yieldCurveChart = new Chart(ctx, {
      type: 'bar',
      plugins: [ChartDataLabels],
      data: { labels: labels, datasets: datasets },
      options: {
        responsive: true, maintainAspectRatio: false,
        layout: { padding: { top: 24 } },
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              afterLabel: function(ctx) {
                // Show bps delta vs T-1 in tooltip
                if (ctx.datasetIndex === 0) return '';
                var t1Val = valuesT1[ctx.dataIndex];
                var thisVal = ctx.parsed.y;
                if (t1Val != null && thisVal != null) {
                  var bps = Math.round((t1Val - thisVal) * 100);
                  return (bps >= 0 ? '+' : '') + bps + ' bps vs T-1';
                }
                return '';
              }
            }
          }
        },
        scales: {
          x: { ticks: { color: '#7d8da1', font: { size: 12, weight: '600' } }, grid: { display: false } },
          y: { ticks: { color: '#7d8da1', font: { size: 10 }, callback: function(v) { return v.toFixed(1) + '%'; } }, grid: { color: 'rgba(30,42,58,0.5)' } }
        }
      }
    });
  }

  // Legend
  var existingLegend = canvas.parentElement.parentElement.querySelector('.yield-curve-legend');
  if (existingLegend) existingLegend.remove();
  var legendDiv = document.createElement('div'); legendDiv.className = 'yield-curve-legend';
  legendDiv.innerHTML =
    '<span><span class="ycl-swatch" style="background:#3b82f6"></span>' + t1Label + '</span>' +
    '<span><span class="ycl-swatch" style="background:#6366f1"></span>' + t7Label + '</span>' +
    '<span><span class="ycl-swatch" style="background:#64748b"></span>' + t14Label + '</span>';
  canvas.parentElement.parentElement.appendChild(legendDiv);
}

// ============================================
// YIELD COMPARISON TABLE (chart=visual, table=precise numbers)
// ============================================

function renderYieldTable(yieldsHist) {
  var wrap = document.getElementById('yields-table-wrap');
  if (!wrap || !yieldsHist) return;
  wrap.innerHTML = '';
  var table = document.createElement('table'); table.className = 'yield-hist-table';
  var thead = document.createElement('thead');
  thead.innerHTML = '<tr><th>Maturity</th><th>T-1 (Latest)</th><th>T-7</th><th>T-14</th><th>\u0394 7d (bps)</th><th>\u0394 14d (bps)</th></tr>';
  table.appendChild(thead);
  var tbody = document.createElement('tbody');

  for (var i = 0; i < CURVE_KEYS.length; i++) {
    var d = yieldsHist[CURVE_KEYS[i]];
    var t1 = d && d.t1 != null ? d.t1 : null;
    var t7 = d && d.t7 != null ? d.t7 : null;
    var t14 = d && d.t14 != null ? d.t14 : null;
    var chg7 = (t1 != null && t7 != null) ? Math.round((t1 - t7) * 100) : null;
    var chg14 = (t1 != null && t14 != null) ? Math.round((t1 - t14) * 100) : null;
    var c7 = chg7 != null ? (chg7 > 0 ? 'delta-up' : chg7 < 0 ? 'delta-down' : 'delta-flat') : '';
    var c14 = chg14 != null ? (chg14 > 0 ? 'delta-up' : chg14 < 0 ? 'delta-down' : 'delta-flat') : '';

    var tr = document.createElement('tr');
    tr.innerHTML =
      '<td class="yht-maturity">' + CURVE_LABELS[i] + '</td>' +
      '<td class="yht-val">' + (t1 != null ? t1.toFixed(2) + '%' : 'N/A') + '</td>' +
      '<td class="yht-val">' + (t7 != null ? t7.toFixed(2) + '%' : 'N/A') + '</td>' +
      '<td class="yht-val">' + (t14 != null ? t14.toFixed(2) + '%' : 'N/A') + '</td>' +
      '<td class="yht-delta ' + c7 + '">' + (chg7 != null ? sign(chg7) + chg7 : '--') + '</td>' +
      '<td class="yht-delta ' + c14 + '">' + (chg14 != null ? sign(chg14) + chg14 : '--') + '</td>';
    tbody.appendChild(tr);
  }
  table.appendChild(tbody); wrap.appendChild(table);
}

// ============================================
// FUNDING & LIQUIDITY (6 rates: EFFR, SOFR, SOFR30D, OBFR, TSY1M, TSY3M)
// ============================================

function renderFunding(nyfed, fred) {
  var grid = document.getElementById('funding-grid'); grid.innerHTML = '';

  // EFFR (FEDL01)
  var effrLive = nyfed.effr && nyfed.effr.rate != null;
  var effr = effrLive ? nyfed.effr : lastKnownFunding.effr;
  grid.appendChild(effr && effr.rate != null
    ? renderMetric('EFFR', effr.rate.toFixed(2) + '%', !effrLive ? '*' : '', effr.date)
    : renderMetric('EFFR', 'N/A', '', ''));

  // SOFR
  var sofrLive = nyfed.sofr && nyfed.sofr.rate != null;
  var sofr = sofrLive ? nyfed.sofr : lastKnownFunding.sofr;
  if (sofr && sofr.rate != null) {
    var volNote = sofr.volume ? ' ($' + sofr.volume.toFixed(0) + 'B)' : '';
    grid.appendChild(renderMetric('SOFR', sofr.rate.toFixed(2) + '%', volNote + (!sofrLive ? ' *' : ''), sofr.date));
  } else { grid.appendChild(renderMetric('SOFR', 'N/A', '', '')); }

  // SOFR 30-Day Avg (replaces dead 1M LIBOR)
  var sofr30 = fred.SOFR30DAYAVG;
  grid.appendChild(sofr30 && sofr30.current != null
    ? renderMetric('SOFR 30D', sofr30.current.toFixed(2) + '%', '', sofr30.date)
    : renderMetric('SOFR 30D', 'N/A', '', ''));

  // OBFR
  var obfrLive = nyfed.obfr && nyfed.obfr.rate != null;
  var obfr = obfrLive ? nyfed.obfr : lastKnownFunding.obfr;
  grid.appendChild(obfr && obfr.rate != null
    ? renderMetric('OBFR', obfr.rate.toFixed(2) + '%', !obfrLive ? '*' : '', obfr.date)
    : renderMetric('OBFR', 'N/A', '', ''));

  // TSY 1M
  var tsy1m = fred.DGS1MO;
  grid.appendChild(tsy1m && tsy1m.current != null
    ? renderMetric('TSY 1M', tsy1m.current.toFixed(2) + '%', '', tsy1m.date)
    : renderMetric('TSY 1M', 'N/A', '', ''));

  // TSY 3M
  var tsy3m = fred.DGS3MO;
  grid.appendChild(tsy3m && tsy3m.current != null
    ? renderMetric('TSY 3M', tsy3m.current.toFixed(2) + '%', '', tsy3m.date)
    : renderMetric('TSY 3M', 'N/A', '', ''));

  // Persist live data
  var changed = false;
  if (sofrLive) { lastKnownFunding.sofr = nyfed.sofr; changed = true; }
  if (effrLive) { lastKnownFunding.effr = nyfed.effr; changed = true; }
  if (obfrLive) { lastKnownFunding.obfr = nyfed.obfr; changed = true; }
  if (changed) saveLastKnown('funding', lastKnownFunding);

  var footer = document.getElementById('funding-footer');
  footer.textContent = (sofr && effr && sofr.rate != null && effr.rate != null)
    ? 'SOFR-EFFR: ' + sign(Math.round((sofr.rate - effr.rate) * 100)) + Math.round((sofr.rate - effr.rate) * 100) + ' bps'
    : 'SOFR-EFFR: unavailable';
}

// ============================================
// FOREX
// ============================================

function fxDecimals(key) { return (key === 'USDJPY' || key === 'USDCNH') ? 2 : 4; }
function renderForex(yahoo) { renderForexStrip(yahoo); initFxConverter(); }

function renderForexStrip(yahoo) {
  var container = document.getElementById('forex-chips'); if (!container) return;
  var chips = [];
  for (var i = 0; i < FOREX_KEYS.length; i++) {
    var k = FOREX_KEYS[i], d = yahoo[k]; if (!d || d.current == null) continue;
    var pct = pctChange(d.current, d.prior);
    var pctCls = pct == null ? 'delta-flat' : (pct >= 0 ? 'delta-up' : 'delta-down');
    var pctStr = pct != null ? sign(pct) + pct.toFixed(2) + '%' : '';
    chips.push('<span class="forex-chip"><span class="forex-chip-name">' + FOREX_LABELS[k] + '</span>'
      + '<span class="forex-chip-price">' + d.current.toFixed(fxDecimals(k)) + '</span>'
      + (pctStr ? '<span class="forex-chip-pct ' + pctCls + '">' + pctStr + '</span>' : '') + '</span>');
  }
  container.innerHTML = chips.join('');
}

// ============================================
// FX CONVERTER — autocomplete inputs, 250K presets + 5M/10M row
// ============================================

function getToUSD(ccy) {
  if (ccy === 'USD') return 1; if (!cachedYahoo) return null;
  var key = FX_YAHOO_MAP[ccy]; if (!key || !cachedYahoo[key] || cachedYahoo[key].current == null) return null;
  return FX_INVERTED[ccy] ? 1 / cachedYahoo[key].current : cachedYahoo[key].current;
}
function getToUSDPrior(ccy) {
  if (ccy === 'USD') return 1; if (!cachedYahoo) return null;
  var key = FX_YAHOO_MAP[ccy]; if (!key || !cachedYahoo[key] || cachedYahoo[key].prior == null) return null;
  return FX_INVERTED[ccy] ? 1 / cachedYahoo[key].prior : cachedYahoo[key].prior;
}

function initFxConverter() {
  var baseInput = document.getElementById('fx-base'), quoteInput = document.getElementById('fx-quote');
  var amountInput = document.getElementById('fx-amount');
  if (!fxConverterInitialized) {
    fxConverterInitialized = true;
    setupCcyAutocomplete(baseInput, document.getElementById('fx-base-list'));
    setupCcyAutocomplete(quoteInput, document.getElementById('fx-quote-list'));

    var compute = function() { computeFxConversion(); };
    baseInput.addEventListener('change', compute);
    quoteInput.addEventListener('change', compute);
    amountInput.addEventListener('input', compute);

    document.getElementById('fx-swap').addEventListener('click', function() {
      var tmp = baseInput.value; baseInput.value = quoteInput.value; quoteInput.value = tmp; computeFxConversion();
    });

    var presetBtns = document.querySelectorAll('.fx-preset-btn');
    for (var j = 0; j < presetBtns.length; j++) {
      (function(btn) { btn.addEventListener('click', function() {
        amountInput.value = btn.getAttribute('data-amount');
        for (var k = 0; k < presetBtns.length; k++) presetBtns[k].classList.remove('active');
        btn.classList.add('active'); computeFxConversion();
      }); })(presetBtns[j]);
    }
  }
  computeFxConversion();
}

function setupCcyAutocomplete(input, listEl) {
  function showList(filter) {
    var val = (filter || '').toUpperCase();
    var matches = FX_CURRENCIES.filter(function(c) {
      if (!val) return true;
      // Fuzzy: match code prefix OR anywhere in full name
      return c.indexOf(val) === 0 || (FX_CURRENCY_NAMES[c] && FX_CURRENCY_NAMES[c].toUpperCase().indexOf(val) !== -1);
    });
    if (matches.length === 0 || (matches.length === 1 && matches[0] === val)) { listEl.style.display = 'none'; return; }
    listEl.innerHTML = '';
    for (var i = 0; i < matches.length; i++) {
      var opt = document.createElement('div'); opt.className = 'fx-ccy-option';
      opt.textContent = matches[i] + ' — ' + (FX_CURRENCY_NAMES[matches[i]] || '');
      opt.setAttribute('data-ccy', matches[i]);
      opt.addEventListener('mousedown', function(e) {
        e.preventDefault(); input.value = this.getAttribute('data-ccy');
        listEl.style.display = 'none'; computeFxConversion();
      });
      listEl.appendChild(opt);
    }
    listEl.style.display = 'block';
  }

  input.addEventListener('focus', function() { showList(input.value); });
  input.addEventListener('input', function() { input.value = input.value.toUpperCase(); showList(input.value); });
  input.addEventListener('blur', function() {
    setTimeout(function() { listEl.style.display = 'none';
      if (FX_CURRENCIES.indexOf(input.value.toUpperCase()) === -1) input.value = 'USD';
      computeFxConversion();
    }, 150);
  });
  input.addEventListener('keydown', function(e) {
    if (e.key === 'Enter' || e.key === 'Tab') { listEl.style.display = 'none'; input.value = input.value.toUpperCase(); computeFxConversion(); }
    if (e.key === 'Escape') listEl.style.display = 'none';
  });
}

function computeFxConversion() {
  var amount = parseFloat(document.getElementById('fx-amount').value);
  var base = document.getElementById('fx-base').value.toUpperCase();
  var quote = document.getElementById('fx-quote').value.toUpperCase();
  var resultEl = document.getElementById('fx-result'), rateEl = document.getElementById('fx-rate-line');
  var reverseEl = document.getElementById('fx-reverse-rate'), trendEl = document.getElementById('fx-rate-trend');
  if (!resultEl) return;

  if (isNaN(amount) || base === quote) {
    resultEl.textContent = base === quote ? fmt(amount, 2, '') + ' ' + quote : '--';
    if (rateEl) rateEl.textContent = ''; if (reverseEl) reverseEl.textContent = ''; if (trendEl) trendEl.textContent = ''; return;
  }
  var baseUSD = getToUSD(base), quoteUSD = getToUSD(quote);
  if (!baseUSD || !quoteUSD) {
    resultEl.textContent = 'Rate unavailable'; if (rateEl) rateEl.textContent = ''; if (reverseEl) reverseEl.textContent = ''; if (trendEl) trendEl.textContent = ''; return;
  }
  var crossRate = baseUSD / quoteUSD, result = amount * crossRate;
  var newText = result.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' ' + quote;
  if (resultEl.textContent !== newText) { resultEl.classList.remove('fx-result-flash'); void resultEl.offsetWidth; resultEl.classList.add('fx-result-flash'); resultEl.textContent = newText; }

  var dec = crossRate > 10 ? 2 : 4;
  if (rateEl) rateEl.textContent = '1 ' + base + ' = ' + crossRate.toFixed(dec) + ' ' + quote;
  if (reverseEl) reverseEl.textContent = '1 ' + quote + ' = ' + (1 / crossRate).toFixed(1 / crossRate > 10 ? 2 : 4) + ' ' + base;

  if (trendEl && cachedYahoo) {
    var bp = getToUSDPrior(base), qp = getToUSDPrior(quote);
    if (bp && qp) { var pct = ((crossRate - bp / qp) / (bp / qp)) * 100; trendEl.textContent = (pct >= 0 ? '+' : '') + pct.toFixed(2) + '% vs prev';
      trendEl.className = 'fx-rate-trend ' + (pct > 0 ? 'trend-up' : pct < 0 ? 'trend-down' : 'trend-flat');
    } else { trendEl.textContent = ''; }
  }
}

// ============================================
// MACRO, CALENDAR, NEWS, MOVERS
// ============================================

function renderMacro(macro) {
  var container = document.getElementById('macro-chips'); if (!container) return;
  var chips = [], anyLive = false;
  for (var i = 0; i < MACRO_DISPLAY.length; i++) {
    var m = MACRO_DISPLAY[i], d = macro[m.id], valStr = 'N/A', delta = '', deltaNum = null, stale = false;
    if (d && d.current != null) {
      anyLive = true; var val = m.divideBy ? d.current / m.divideBy : d.current; valStr = val.toFixed(m.dec) + m.suffix;
      var priorVal = d.prior != null ? (m.divideBy ? d.prior / m.divideBy : d.prior) : null;
      if (priorVal != null) { var diff = val - priorVal; deltaNum = diff;
        delta = m.suffix === 'K' ? sign(diff) + diff.toFixed(0) + 'K' : sign(diff) + diff.toFixed(m.dec) + (m.suffix === '%' ? 'pp' : ''); }
    } else if (lastKnownMacro && lastKnownMacro[m.id]) { valStr = lastKnownMacro[m.id].value; stale = true; }
    var dCls = deltaNum == null ? 'delta-flat' : (deltaNum > 0 ? 'delta-up' : deltaNum < 0 ? 'delta-down' : 'delta-flat');
    chips.push('<span class="macro-chip' + (stale ? ' macro-chip-stale' : '') + '">'
      + '<span class="macro-chip-name">' + m.label + '</span><span class="macro-chip-value">' + valStr + '</span>'
      + (delta ? '<span class="macro-chip-delta ' + dCls + '">' + delta + '</span>' : '') + '</span>');
  }
  container.innerHTML = chips.join('') + chips.join('');
  if (anyLive) { var snap = {}; for (var j = 0; j < MACRO_DISPLAY.length; j++) { var m2 = MACRO_DISPLAY[j], d2 = macro[m2.id]; if (d2 && d2.current != null) { var v2 = m2.divideBy ? d2.current / m2.divideBy : d2.current; snap[m2.id] = { value: v2.toFixed(m2.dec) + m2.suffix, date: d2.date }; } } lastKnownMacro = snap; saveLastKnown('macro', snap); }
}

function renderCalendar(fomc) {
  var container = document.getElementById('calendar-content'); if (!container) return; container.innerHTML = '';
  var legend = document.createElement('div'); legend.className = 'cal-legend';
  legend.innerHTML = '<span class="cal-legend-item"><span class="cal-legend-dot dot-high"></span>High Impact</span><span class="cal-legend-item"><span class="cal-legend-dot dot-medium"></span>Medium</span><span class="cal-legend-item"><span class="cal-legend-dot dot-fomc"></span>FOMC</span><span class="cal-legend-item"><span class="cal-legend-dot dot-today"></span>Today</span>';
  container.appendChild(legend);
  var todayStr = new Date().toISOString().split('T')[0];
  var upcoming = [];
  for (var i = 0; i < ECON_CALENDAR.length; i++) { if (ECON_CALENDAR[i].date >= todayStr) upcoming.push(ECON_CALENDAR[i]); }
  upcoming = upcoming.slice(0, 12);
  if (upcoming.length === 0) { container.innerHTML += '<div class="news-empty">No upcoming events.</div>'; return; }
  var table = document.createElement('table'); table.className = 'cal-table';
  table.innerHTML = '<thead><tr><th>Date</th><th>Event</th><th>Est.</th><th>Prior</th><th>Actual</th></tr></thead>';
  var tbody = document.createElement('tbody');
  for (var j = 0; j < upcoming.length; j++) {
    var e = upcoming[j], tr = document.createElement('tr');
    if (e.date === todayStr) tr.className = 'today';
    if (isHighImpact(e.event) || e.fomc) tr.classList.add('cal-urgency-high');
    else if (isMediumImpact(e.event)) tr.classList.add('cal-urgency-medium');
    var d = new Date(e.date + 'T12:00:00');
    var dateLabel = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', weekday: 'short' });
    if (e.time && e.time !== 'ALL') dateLabel += ' ' + e.time;
    var eventCell = e.fomc ? '<span class="cal-fomc">' + e.event + '</span>' : e.event;
    if (e.date === todayStr) eventCell += ' <span class="cal-tag cal-tag-today">TODAY</span>';
    var actualCell = '--';
    if (e.actual != null) { var ac = e.actualBeat === true ? 'cal-actual-beat' : e.actualBeat === false ? 'cal-actual-miss' : 'cal-actual-pending'; actualCell = '<span class="' + ac + '">' + e.actual + '</span>'; }
    tr.innerHTML = '<td class="cal-date">' + dateLabel + '</td><td class="cal-event">' + eventCell + '</td><td class="cal-values">' + (e.consensus || '--') + '</td><td class="cal-values">' + (e.prior || '--') + '</td><td class="cal-values cal-actual">' + actualCell + '</td>';
    tbody.appendChild(tr);
  }
  table.appendChild(tbody); container.appendChild(table);
  if (fomc && fomc.next) { var fd = document.createElement('div'); fd.className = 'panel-footer'; fd.textContent = 'Next FOMC: ' + fomc.next + ' (' + fomc.daysAway + ' days)'; container.appendChild(fd); }
}

function renderNews(items) {
  var container = document.getElementById('news-content'), countBadge = document.getElementById('news-count');
  container.innerHTML = '';
  if (!items || items.length === 0) { container.innerHTML = '<div class="news-empty">No news available.</div>'; countBadge.textContent = ''; return; }
  countBadge.textContent = items.length;
  if (items[0].date) { var ts = document.createElement('div'); ts.className = 'news-updated'; ts.textContent = 'Updated ' + formatTime(items[0].date); container.appendChild(ts); }
  for (var i = 0; i < items.length && i < 30; i++) {
    var item = items[i], div = document.createElement('div'); div.className = 'news-item';
    var tagSpan = document.createElement('span'); tagSpan.className = 'news-tag news-tag-' + (item.tag || 'MARKETS'); tagSpan.textContent = item.tag || 'NEWS';
    var body = document.createElement('div'); body.className = 'news-body';
    var titleDiv = document.createElement('div'); titleDiv.className = 'news-title';
    if (item.link) { var a = document.createElement('a'); a.href = item.link; a.target = '_blank'; a.rel = 'noopener'; a.textContent = item.title; titleDiv.appendChild(a); }
    else titleDiv.textContent = item.title;
    var metaDiv = document.createElement('div'); metaDiv.className = 'news-meta'; var mp = '';
    if (item.isGov) mp += '<span class="news-gov">GOV</span> ';
    if (item.source) mp += '<span class="news-source-badge">' + item.source + '</span>';
    if (item.date) mp += ' <span class="news-time">' + formatTime(item.date) + '</span>';
    metaDiv.innerHTML = mp; body.appendChild(titleDiv); body.appendChild(metaDiv);
    div.appendChild(tagSpan); div.appendChild(body); container.appendChild(div);
  }
}

var MOVERS_KEYS = ['WTI', 'Brent', 'NatGas', 'HeatOil', 'Copper', 'Gold', 'Silver', 'VIX', 'DXY'];
var MOVERS_LABELS = { WTI: 'WTI Crude', Brent: 'Brent', NatGas: 'Nat Gas', HeatOil: 'Heat Oil', Copper: 'Copper', Gold: 'Gold', Silver: 'Silver', VIX: 'VIX', DXY: 'DXY' };

function renderMovers(yahoo) {
  var container = document.getElementById('movers-content'); if (!container) return;
  var movers = [];
  for (var i = 0; i < MOVERS_KEYS.length; i++) { var k = MOVERS_KEYS[i], d = yahoo[k];
    if (d && d.current != null && d.prior != null) { var pct = pctChange(d.current, d.prior); if (pct != null) movers.push({ key: k, price: d.current, pct: pct }); } }
  movers.sort(function(a, b) { return Math.abs(b.pct) - Math.abs(a.pct); });
  var strip = document.createElement('div'); strip.className = 'movers-strip';
  for (var j = 0; j < movers.length; j++) { var m = movers[j], isND = m.key === 'VIX' || m.key === 'DXY', prefix = isND ? '' : '$';
    var chip = document.createElement('div'); chip.className = 'mover-chip ' + (m.pct >= 0 ? 'chip-up' : 'chip-down');
    chip.innerHTML = '<span class="mover-chip-name">' + MOVERS_LABELS[m.key] + '</span><span class="mover-chip-price">' + prefix + m.price.toFixed(2) + '</span><span class="mover-chip-pct">' + sign(m.pct) + m.pct.toFixed(2) + '%</span>';
    strip.appendChild(chip); }
  container.innerHTML = ''; container.appendChild(strip);
}

// ============================================
// LIVE STREAMS (Bloomberg TV)
// ============================================

function initLiveStreams() {
  var container = document.getElementById('live-streams'); if (!container) return; container.innerHTML = '';
  var dot = document.getElementById('live-dot-indicator');
  if (dot) dot.className = 'live-dot' + (isMarketOpen() ? '' : ' live-dot-off');
  var iframe = document.createElement('iframe');
  iframe.src = 'https://www.youtube.com/embed/live_stream?channel=UCIALMKvObZNtJ6AmdCLP7Lg&autoplay=1&mute=1&playsinline=1&modestbranding=1&rel=0';
  iframe.title = 'Bloomberg TV Live'; iframe.loading = 'lazy';
  iframe.setAttribute('allow', 'autoplay; encrypted-media; picture-in-picture');
  iframe.setAttribute('allowfullscreen', ''); container.appendChild(iframe);
}

// ============================================
// MAIN RENDER
// ============================================

function renderDashboard(data) {
  var now = nowET();
  document.getElementById('header-meta').textContent =
    now.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })
    + '  |  Last refresh: ' + now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true }) + ' ET'
    + '  |  ' + (isMarketOpen() ? 'Ticker: 10s' : 'Ticker: 60s') + '  |  Full: 15 min';

  var statusEl = document.getElementById('market-status');
  statusEl.textContent = isMarketOpen() ? 'MARKET OPEN' : 'MARKET CLOSED';
  statusEl.className = 'market-badge ' + (isMarketOpen() ? 'open' : 'closed');

  var fomcEl = document.getElementById('fomc-badge');
  if (data.fomc && data.fomc.next) { fomcEl.textContent = 'FOMC: ' + data.fomc.daysAway + 'd'; fomcEl.title = 'Next FOMC: ' + data.fomc.next; fomcEl.className = data.fomc.daysAway <= 7 ? 'fomc-badge imminent' : 'fomc-badge'; }

  var alertBar = document.getElementById('alert-bar'); alertBar.innerHTML = '';
  var alerts = computeAlerts(data);
  if (alerts.length === 0) alertBar.innerHTML = '<div class="alert alert-green"><span class="alert-icon"></span> All systems normal — no threshold breaches.</div>';
  else for (var i = 0; i < alerts.length; i++) alertBar.innerHTML += '<div class="alert alert-' + alerts[i].level + '"><span class="alert-icon"></span> ' + alerts[i].msg + '</div>';

  cachedYahoo = data.yahoo; cachedFred = data.fred; cacheData('market', data);

  renderYields(data.fred);
  renderYieldCurve(data.yieldsHist || {});
  renderYieldTable(data.yieldsHist || {});
  renderFunding(data.nyfed, data.fred);
  renderForex(data.yahoo);
  renderMacro(data.macro);
  renderCalendar(data.fomc);
  renderTicker(data.yahoo);
  renderMovers(data.yahoo);

  addSourceAttribution('panel-yields', 'FRED', data.fred.DGS1MO ? data.fred.DGS1MO.date : null);
  addSourceAttribution('panel-funding', 'NY Fed / FRED', data.nyfed.sofr ? data.nyfed.sofr.date : null);
  addSourceAttribution('panel-forex', 'Yahoo Finance', data.yahoo.EURUSD ? data.yahoo.EURUSD.date : null);
  addSourceAttribution('panel-macro', 'FRED', data.macro.UNRATE ? data.macro.UNRATE.date : null);
  addSourceAttribution('panel-calendar', 'Fed / BLS / BEA', null);
  addSourceAttribution('panel-news', 'Fed / ECB / WSJ / Reuters / CNBC / MarketWatch / Yahoo / Seeking Alpha', null);
  addSourceAttribution('panel-movers', 'Yahoo Finance', data.yahoo.WTI ? data.yahoo.WTI.date : null);

  var allPanels = document.querySelectorAll('.panel-error');
  for (var pe = 0; pe < allPanels.length; pe++) allPanels[pe].classList.remove('panel-error');
  document.getElementById('loading').style.display = 'none';
  document.getElementById('dashboard').style.display = 'grid';
}

// ============================================
// DATA FETCHING
// ============================================

var fetchRetryCount = 0;

function fetchData() {
  if (WORKER_URL.indexOf('YOUR_') !== -1) { document.getElementById('loading').style.display = 'none'; document.getElementById('setup-banner').style.display = 'block'; return; }
  beginFetch();
  fetch(WORKER_URL + '/api/market-data').then(function(r) { if (!r.ok) throw new Error('Worker ' + r.status); return r.json(); })
    .then(function(data) { fetchRetryCount = 0; tickerBackoff = isMarketOpen() ? TICKER_REFRESH_MS : TICKER_REFRESH_SLOW; lastRefreshTime = Date.now(); renderDashboard(data); updateAgoCounter(); })
    .catch(function(err) { fetchRetryCount++;
      var cached = getCachedData('market', 3600000); if (cached) { try { renderDashboard(cached); return; } catch (e) {} }
      if (fetchRetryCount >= 3) { var panels = document.querySelectorAll('.panel'); for (var p = 0; p < panels.length; p++) panels[p].classList.add('panel-error'); }
      var loading = document.getElementById('loading');
      if (loading.style.display !== 'none') loading.innerHTML = '<div class="error-msg">Failed to load: ' + err.message + '<br><small>Worker: ' + WORKER_URL + '</small><br><small>Press R to retry.</small></div>';
    }).finally(endFetch);
}

function fetchNews() {
  if (WORKER_URL.indexOf('YOUR_') !== -1) return;
  fetch(WORKER_URL + '/api/news').then(function(r) { if (!r.ok) throw new Error(r.status); return r.json(); })
    .then(function(data) { cacheData('news', data.items || []); renderNews(data.items || []); })
    .catch(function() { var cached = getCachedData('news', 7200000); if (cached) renderNews(cached); });
}

function tickerRefresh() {
  if (WORKER_URL.indexOf('YOUR_') !== -1) return;
  fetch(WORKER_URL + '/api/ticker').then(function(r) { if (!r.ok) throw new Error(r.status); return r.json(); })
    .then(function(data) { cachedYahoo = Object.assign(cachedYahoo || {}, data.yahoo); renderTicker(cachedYahoo); renderMovers(cachedYahoo); renderForexStrip(cachedYahoo); tickerBackoff = isMarketOpen() ? TICKER_REFRESH_MS : TICKER_REFRESH_SLOW; })
    .catch(function() { tickerBackoff = Math.min(tickerBackoff * 1.5, 60000); })
    .finally(function() { clearTimeout(tickerTimer); tickerTimer = setTimeout(tickerRefresh, tickerBackoff); });
}

// ============================================
// UI: NOTES, SHORTCUTS, DENSITY, PANELS
// ============================================

function initNotes() {
  var panel = document.getElementById('notes-panel'), textarea = document.getElementById('notes-text');
  textarea.value = localStorage.getItem('td_notes') || '';
  var saveTimeout = null;
  textarea.addEventListener('input', function() { clearTimeout(saveTimeout); saveTimeout = setTimeout(function() { localStorage.setItem('td_notes', textarea.value); var msg = document.getElementById('notes-saved'); msg.textContent = 'Saved'; setTimeout(function() { msg.textContent = ''; }, 1500); }, 500); });
  document.getElementById('notes-close').addEventListener('click', function() { panel.style.display = 'none'; });
  document.getElementById('notes-clear').addEventListener('click', function() { if (confirm('Clear all notes?')) { textarea.value = ''; localStorage.removeItem('td_notes'); } });
  document.getElementById('btn-notes').addEventListener('click', function() { panel.style.display = panel.style.display === 'none' ? 'block' : 'none'; });
}

function initShortcuts() {
  document.addEventListener('keydown', function(e) {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') { if (e.key === 'Escape') { document.getElementById('notes-panel').style.display = 'none'; e.target.blur(); } return; }
    var modal = document.getElementById('shortcuts-modal');
    if (e.key === 'Escape') { modal.style.display = 'none'; document.getElementById('notes-panel').style.display = 'none'; return; }
    if (e.key === '?' || e.key === '/') { e.preventDefault(); modal.style.display = modal.style.display === 'none' ? 'flex' : 'none'; return; }
    if (e.key === 'r' || e.key === 'R') { e.preventDefault(); if (Date.now() - lastManualRefresh < 3000) return; lastManualRefresh = Date.now(); fetchData(); fetchNews(); return; }
    if (e.key === 'n' || e.key === 'N') { e.preventDefault(); document.getElementById('panel-news').classList.toggle('collapsed'); return; }
    if (e.key === 'c' || e.key === 'C') { e.preventDefault(); document.getElementById('panel-calendar').classList.toggle('collapsed'); return; }
    if (e.key === 'j' || e.key === 'J') { e.preventDefault(); var np = document.getElementById('notes-panel'); np.style.display = np.style.display === 'none' ? 'block' : 'none'; if (np.style.display === 'block') document.getElementById('notes-text').focus(); return; }
    if (e.key === 'l' || e.key === 'L') { e.preventDefault(); var liveEl = document.getElementById('panel-live'); if (liveEl) liveEl.classList.toggle('collapsed'); return; }
  });
  document.getElementById('btn-refresh').addEventListener('click', function() { if (Date.now() - lastManualRefresh < 3000) return; lastManualRefresh = Date.now(); fetchData(); fetchNews(); });
  document.getElementById('btn-shortcuts').addEventListener('click', function() { var m = document.getElementById('shortcuts-modal'); m.style.display = m.style.display === 'none' ? 'flex' : 'none'; });
  document.getElementById('modal-close').addEventListener('click', function() { document.getElementById('shortcuts-modal').style.display = 'none'; });
  document.getElementById('shortcuts-modal').addEventListener('click', function(e) { if (e.target === this) this.style.display = 'none'; });
  var panels = document.querySelectorAll('.panel h2');
  for (var i = 0; i < panels.length; i++) panels[i].addEventListener('click', function() { this.parentElement.classList.toggle('collapsed'); savePanelPrefs(); });
}

function showSkeletons() {
  var grids = [['yields-grid', 3], ['funding-grid', 6]];
  for (var i = 0; i < grids.length; i++) { var g = document.getElementById(grids[i][0]); if (!g || g.children.length > 0) continue;
    for (var j = 0; j < grids[i][1]; j++) { var sk = document.createElement('div'); sk.className = 'metric'; sk.innerHTML = '<div class="skeleton-line sk-sm"></div><div class="skeleton-line sk-lg"></div><div class="skeleton-line sk-sm"></div>'; g.appendChild(sk); } }
}

var lastRefreshTime = 0, fetchInFlight = 0;
function beginFetch() { fetchInFlight++; var btn = document.getElementById('btn-refresh'); if (btn) btn.classList.add('refreshing'); }
function endFetch() { fetchInFlight = Math.max(0, fetchInFlight - 1); if (fetchInFlight === 0) { var btn = document.getElementById('btn-refresh'); if (btn) btn.classList.remove('refreshing'); } }
function updateAgoCounter() { if (!lastRefreshTime) return; var secs = Math.round((Date.now() - lastRefreshTime) / 1000); var label = secs < 60 ? secs + 's ago' : Math.floor(secs / 60) + 'm ago'; var el = document.getElementById('updated-ago'); if (!el) { el = document.createElement('span'); el.id = 'updated-ago'; var meta = document.getElementById('header-meta'); if (meta) meta.appendChild(el); } el.textContent = ' | Updated ' + label; }

function initDensityToggle() {
  if (localStorage.getItem('td_density') === 'compact') document.body.classList.add('density-compact');
  var btn = document.getElementById('btn-density'); if (!btn) return;
  btn.textContent = document.body.classList.contains('density-compact') ? 'Comfortable' : 'Compact';
  btn.addEventListener('click', function() { document.body.classList.toggle('density-compact'); var c = document.body.classList.contains('density-compact'); btn.textContent = c ? 'Comfortable' : 'Compact'; localStorage.setItem('td_density', c ? 'compact' : 'comfortable'); });
}

function loadPanelPrefs() { try { var prefs = JSON.parse(localStorage.getItem('td_panel_prefs') || '{}'); var ids = Object.keys(prefs); for (var i = 0; i < ids.length; i++) { if (prefs[ids[i]].collapsed) { var el = document.getElementById(ids[i]); if (el) el.classList.add('collapsed'); } } } catch (e) {} }
function savePanelPrefs() { var panels = document.querySelectorAll('.panel[id]'), prefs = {}; for (var i = 0; i < panels.length; i++) { if (panels[i].classList.contains('collapsed')) prefs[panels[i].id] = { collapsed: true }; } try { localStorage.setItem('td_panel_prefs', JSON.stringify(prefs)); } catch (e) {} }

function lazyInit(panelId, initFn) { var panel = document.getElementById(panelId); if (!panel) { initFn(); return; } if ('IntersectionObserver' in window) { var obs = new IntersectionObserver(function(entries) { if (entries[0].isIntersecting) { initFn(); obs.disconnect(); } }, { rootMargin: '300px' }); obs.observe(panel); } else setTimeout(initFn, 1500); }

// ============================================
// INIT
// ============================================

document.getElementById('dashboard').style.display = 'grid';
showSkeletons(); loadPanelPrefs(); initDensityToggle();

var cachedMarket = getCachedData('market', 600000);
if (cachedMarket) { try { renderDashboard(cachedMarket); } catch (e) {} }
var cachedNews = getCachedData('news', 3600000);
if (cachedNews) { try { renderNews(cachedNews); } catch (e) {} }

fetchData(); fetchNews();
refreshTimer = setInterval(fetchData, REFRESH_MS);
newsTimer = setInterval(fetchNews, NEWS_REFRESH_MS);
tickerTimer = setTimeout(tickerRefresh, tickerBackoff);
initShortcuts(); initNotes();
lazyInit('panel-live', initLiveStreams);
setInterval(updateAgoCounter, 10000);
