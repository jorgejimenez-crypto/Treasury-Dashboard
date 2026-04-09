/**
 * ══════════════════════════════════════════════════════════════
 *  Treasury Desk — Funding Intelligence  |  app.js
 *  Redesigned: focused short-term treasury / funding desk tool
 *
 *  WHAT'S HERE (focused scope):
 *    • Treasury Yields — hero grouped bar chart + data table
 *    • Funding & Liquidity — 6 metric cards (SOFR, EFFR, etc.)
 *    • FX Converter — polished notional converter
 *    • Silent alert computation (threshold monitoring)
 *
 *  REMOVED FROM UI (logic kept for alerts where noted):
 *    • Commodities / Energy movers / Macro chips
 *    • Economic Calendar / News feed
 *    • Risk & Credit (alert logic preserved silently)
 *    • TradingView widgets / Bloomberg live stream
 *
 *  REFRESH STRATEGY:
 *    Full dashboard : every 15 min (FRED + NY Fed + Yahoo)
 *    FX rate ticker : every 10s market hours, 60s off-hours
 *    localStorage   : instant render on page load
 * ══════════════════════════════════════════════════════════════
 */

// ============================================================
// CONFIG
// ============================================================

var WORKER_URL = 'https://treasury-proxy.treasurydashboard.workers.dev';

var REFRESH_MS       = 15 * 60 * 1000;   // 15 min full data
var TICKER_REFRESH_MS   = 10 * 1000;     // 10s fast ticker
var TICKER_REFRESH_SLOW = 60 * 1000;     // 60s off-hours

// Silent alert thresholds (background monitoring only)
var THRESHOLDS = {
  commodityPct: 2.0, multiBooksMin: 2,
  vixHigh: 30, vixPctSpike: 15,
  dxyLow: 99, dxyHigh: 105,
  yield10YHigh: 5.0,
  igOasWide: 150, hyOasWide: 500
};

// ── Yield curve maturities ──────────────────────────────────
var CURVE_KEYS   = ['DGS3MO','DGS6MO','DGS1','DGS2','DGS5','DGS10','DGS30'];
var CURVE_LABELS = ['3M', '6M', '1Y', '2Y', '5Y', '10Y', '30Y'];

// ── FX configuration ────────────────────────────────────────
var FOREX_KEYS    = ['EURUSD','GBPUSD','USDJPY','AUDUSD','USDCAD','USDCHF','USDCNH'];
var FOREX_LABELS  = { EURUSD:'EUR/USD', GBPUSD:'GBP/USD', USDJPY:'USD/JPY',
                      AUDUSD:'AUD/USD', USDCAD:'USD/CAD', USDCHF:'USD/CHF', USDCNH:'USD/CNH' };
var FX_CURRENCIES = ['USD','EUR','GBP','JPY','AUD','CAD','CHF','CNH'];
var FX_YAHOO_MAP  = { EUR:'EURUSD', GBP:'GBPUSD', AUD:'AUDUSD',
                      JPY:'USDJPY', CAD:'USDCAD', CHF:'USDCHF', CNH:'USDCNH' };
var FX_INVERTED   = { JPY:true, CAD:true, CHF:true, CNH:true };

// Full currency names for the converter selects
var FX_CURRENCY_NAMES = {
  USD: 'USD — US Dollar',
  EUR: 'EUR — Euro',
  GBP: 'GBP — British Pound',
  JPY: 'JPY — Japanese Yen',
  AUD: 'AUD — Australian Dollar',
  CAD: 'CAD — Canadian Dollar',
  CHF: 'CHF — Swiss Franc',
  CNH: 'CNH — Chinese Renminbi'
};

// ── Minimal ticker (FX + key rates only) ───────────────────
var TICKER_SYMBOLS = ['EURUSD','GBPUSD','USDJPY','USDCAD','USDCHF','DXY','VIX'];
var TICKER_LABELS  = {
  EURUSD:'EUR/USD', GBPUSD:'GBP/USD', USDJPY:'USD/JPY',
  USDCAD:'USD/CAD', USDCHF:'USD/CHF', DXY:'DXY', VIX:'VIX'
};

// ── Keys still needed for alert computation ─────────────────
var ENERGY_KEYS     = ['WTI','Brent','NatGas','HeatOil'];
var COMMODITY_KEYS  = ['WTI','Brent','NatGas','HeatOil','Copper','Gold','Silver'];
var COMMODITY_LABELS= { WTI:'WTI Crude', Brent:'Brent Crude', NatGas:'Henry Hub',
                        HeatOil:'Heating Oil', Copper:'Copper', Gold:'Gold', Silver:'Silver' };


// ============================================================
// STATE
// ============================================================

var yieldBarChart      = null;   // Chart.js instance for grouped bar chart
var refreshTimer       = null;
var tickerTimer        = null;
var cachedYahoo        = null;
var cachedFred         = null;
var tickerBackoff      = TICKER_REFRESH_MS;
var lastManualRefresh  = 0;
var fxConverterInitialized = false;
var fetchRetryCount    = 0;
var lastRefreshTime    = 0;
var fetchInFlight      = 0;


// ============================================================
// PERSISTENCE HELPERS (localStorage)
// ============================================================

function cacheData(key, data) {
  try { localStorage.setItem('td_' + key, JSON.stringify({ t: Date.now(), d: data })); } catch(e){}
}
function getCachedData(key, maxAgeMs) {
  try {
    var raw = localStorage.getItem('td_' + key);
    if (!raw) return null;
    var p = JSON.parse(raw);
    if (Date.now() - p.t > (maxAgeMs || 300000)) return null;
    return p.d;
  } catch(e){ return null; }
}
function loadLastKnown(key) {
  try { var r = localStorage.getItem('td_lk_' + key); return r ? JSON.parse(r) : null; }
  catch(e){ return null; }
}
function saveLastKnown(key, data) {
  try { localStorage.setItem('td_lk_' + key, JSON.stringify(data)); } catch(e){}
}

// Persisted last-known values (survive page reloads + weekends)
var lastKnownFunding = loadLastKnown('funding') || { sofr:null, effr:null, onrrp:null };
var lastKnownYields  = loadLastKnown('yields');


// ============================================================
// MATH HELPERS
// ============================================================

function pctChange(cur, prev) {
  if (cur == null || prev == null || prev === 0) return null;
  return ((cur - prev) / prev) * 100;
}
function bpsChange(cur, prev) {
  if (cur == null || prev == null) return null;
  return Math.round((cur - prev) * 100);
}
function sign(v) { return (v != null && v >= 0) ? '+' : ''; }

function nowET() {
  return new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
}
function isMarketOpen() {
  var n = nowET(), day = n.getDay();
  if (day === 0 || day === 6) return false;
  var m = n.getHours() * 60 + n.getMinutes();
  return m >= 570 && m < 960;   // 9:30 – 16:00 ET
}
function fmtRate(v, dec) {
  if (v == null || isNaN(v)) return '—';
  return v.toFixed(dec != null ? dec : 2) + '%';
}
function fmtBps(bps) {
  if (bps == null) return '—';
  return (bps >= 0 ? '+' : '') + bps + ' bps';
}
function fmtBillion(v) {
  if (v == null || isNaN(v)) return '—';
  return '$' + (v / 1000).toFixed(1) + 'B';
}


// ============================================================
// SCROLLING TICKER BAR
// (FX rates + DXY + VIX only — strips energy/equity noise)
// ============================================================

function renderTicker(yahoo) {
  if (!yahoo) return;
  var container = document.getElementById('ticker-content');
  if (!container) return;
  var html = '';
  for (var i = 0; i < TICKER_SYMBOLS.length; i++) {
    var key = TICKER_SYMBOLS[i];
    var d = yahoo[key];
    if (!d || d.current == null) continue;
    var pct    = pctChange(d.current, d.prior);
    var cls    = pct == null ? 'tk-flat' : (pct >= 0 ? 'tk-up' : 'tk-dn');
    var pctStr = pct != null ? (sign(pct) + Math.abs(pct).toFixed(2) + '%') : '';
    var noPrefix = key === 'DXY' || key === 'VIX';
    var dec    = (key === 'USDJPY' || key === 'USDCNH') ? 2 : 4;
    var valStr = noPrefix ? d.current.toFixed(2) : d.current.toFixed(dec);
    html += '<span class="tk-item">'
      + '<span class="tk-lbl">' + TICKER_LABELS[key] + '</span>'
      + '<span class="tk-val">' + valStr + '</span>'
      + (pctStr ? '<span class="' + cls + '">' + pctStr + '</span>' : '')
      + '</span>';
  }
  container.innerHTML = html + html;   // duplicate for seamless loop
}


// ============================================================
// SILENT ALERT COMPUTATION
// (runs in background; results shown only if threshold hit)
// ============================================================

function computeAlerts(data) {
  var alerts = [];
  var yahoo = data.yahoo || {};

  // Commodity surge (energy)
  var sigs = [];
  for (var i = 0; i < ENERGY_KEYS.length; i++) {
    var k = ENERGY_KEYS[i], d = yahoo[k];
    if (d && d.current != null && d.prior != null) {
      var pct = pctChange(d.current, d.prior);
      if (Math.abs(pct) >= THRESHOLDS.commodityPct)
        sigs.push(COMMODITY_LABELS[k] + ' ' + (pct > 0 ? '↑' : '↓') + Math.abs(pct).toFixed(1) + '%');
    }
  }
  if (sigs.length >= THRESHOLDS.multiBooksMin)
    alerts.push({ level:'red', msg:'COMMODITY SURGE: ' + sigs.join(', ') });
  else if (sigs.length === 1)
    alerts.push({ level:'yellow', msg:'COMMODITY WATCH: ' + sigs[0] });

  // VIX
  var vix = yahoo.VIX;
  if (vix && vix.current != null) {
    if (vix.current > THRESHOLDS.vixHigh)
      alerts.push({ level:'red', msg:'VIX ' + vix.current.toFixed(1) + ' — elevated volatility' });
    else {
      var vp = pctChange(vix.current, vix.prior);
      if (vp != null && Math.abs(vp) > THRESHOLDS.vixPctSpike)
        alerts.push({ level:'yellow', msg:'VIX moved ' + sign(vp) + vp.toFixed(1) + '% DoD' });
    }
  }

  // DXY
  var dxy = yahoo.DXY;
  if (dxy && dxy.current != null &&
      (dxy.current < THRESHOLDS.dxyLow || dxy.current > THRESHOLDS.dxyHigh))
    alerts.push({ level:'yellow', msg:'DXY ' + dxy.current.toFixed(2) + ' — outside ' +
      THRESHOLDS.dxyLow + '–' + THRESHOLDS.dxyHigh + ' range' });

  // 10Y yield
  var y10 = data.fred && data.fred.DGS10;
  if (y10 && y10.current != null && y10.current > THRESHOLDS.yield10YHigh)
    alerts.push({ level:'red', msg:'10Y yield ' + y10.current.toFixed(2) + '% — above ' + THRESHOLDS.yield10YHigh + '%' });

  // IG credit
  var ig = data.fred && data.fred.BAMLC0A0CM;
  if (ig && ig.current != null && ig.current * 100 > THRESHOLDS.igOasWide)
    alerts.push({ level:'yellow', msg:'IG OAS ' + Math.round(ig.current * 100) + ' bps — widening' });

  return alerts;
}

function renderAlerts(alerts) {
  var bar = document.getElementById('alert-bar');
  if (!bar) return;
  if (!alerts || alerts.length === 0) {
    bar.innerHTML = '';
    bar.style.display = 'none';
    return;
  }
  bar.style.display = 'block';
  bar.innerHTML = alerts.map(function(a) {
    return '<div class="alert alert-' + a.level + '">'
      + '<span class="alert-dot"></span>' + a.msg + '</div>';
  }).join('');
}


// ============================================================
// SECTION 1 — TREASURY YIELDS (HERO)
//
// Grouped bar chart:
//   X-axis  : 7 maturity groups (3M | 6M | 1Y | 2Y | 5Y | 10Y | 30Y)
//   3 bars  : Today (bright blue) | T-1 (indigo) | T-2 (slate)
//
// Data table below chart:
//   Rows: Today | T-1 | T-2 | Δ 1d (bps) | Δ 2d (bps)
//   Color-coded bps deltas
// ============================================================

function renderYieldsHero(fred) {
  if (!fred) return;

  // ── Collect data for all 7 maturities ──────────────────────
  var valuesT  = [], valuesT1 = [], valuesT2 = [], dates = [];
  for (var i = 0; i < CURVE_KEYS.length; i++) {
    var d = fred[CURVE_KEYS[i]];
    valuesT.push( d && d.current != null ? d.current : null);
    valuesT1.push(d && d.prior   != null ? d.prior   : null);
    valuesT2.push(d && d.t2      != null ? d.t2      : null);
    dates.push(d ? (d.date || '') : '');
  }

  // ── Persist for offline use ────────────────────────────────
  var anyLive = valuesT.some(function(v){ return v != null; });
  if (anyLive) {
    var snap = {};
    for (var j = 0; j < CURVE_KEYS.length; j++) {
      if (valuesT[j] != null)
        snap[CURVE_KEYS[j]] = { value: valuesT[j].toFixed(2) + '%', date: dates[j] };
    }
    lastKnownYields = snap;
    saveLastKnown('yields', snap);
  }

  // ── Fill N/A from cache if live data missing ────────────────
  for (var k = 0; k < CURVE_KEYS.length; k++) {
    if (valuesT[k] == null && lastKnownYields && lastKnownYields[CURVE_KEYS[k]]) {
      var cached = parseFloat(lastKnownYields[CURVE_KEYS[k]].value);
      if (!isNaN(cached)) valuesT[k] = cached;
    }
  }

  // ── Build / update grouped bar chart ───────────────────────
  buildYieldBarChart(valuesT, valuesT1, valuesT2);

  // ── Build compact data table ────────────────────────────────
  buildYieldTable(valuesT, valuesT1, valuesT2);

  // ── 2s10s spread badge ──────────────────────────────────────
  var d2  = fred.DGS2,  d10 = fred.DGS10;
  var el  = document.getElementById('yields-2s10s');
  if (el && d2 && d10 && d2.current != null && d10.current != null) {
    var s = Math.round((d10.current - d2.current) * 100);
    var shape = s < 0 ? 'inverted' : s < 20 ? 'flat' : 'positive';
    el.textContent = '2s10s: ' + sign(s) + s + ' bps (' + shape + ')';
    el.className = 'spread-badge spread-' + shape;
  }

  // ── Source label ────────────────────────────────────────────
  var src = document.getElementById('yields-source-label');
  if (src && d10 && d10.date) src.textContent = 'FRED · As of ' + d10.date;
}

function buildYieldBarChart(valuesT, valuesT1, valuesT2) {
  var canvas = document.getElementById('yield-bar-canvas');
  if (!canvas) return;
  var ctx = canvas.getContext('2d');

  var datasets = [
    {
      label: 'Today',
      data: valuesT,
      backgroundColor: 'rgba(59,130,246,0.85)',
      borderColor: 'rgba(59,130,246,1)',
      borderWidth: 1,
      borderRadius: 3,
      datalabels: {
        display: true,
        anchor: 'end', align: 'top', offset: 2,
        color: '#e2e8f0',
        font: { size: 10, weight: '600', family: 'var(--font-mono)' },
        formatter: function(v) { return v != null ? v.toFixed(2) : ''; }
      }
    },
    {
      label: 'T−1',
      data: valuesT1,
      backgroundColor: 'rgba(99,102,241,0.60)',
      borderColor: 'rgba(99,102,241,0.85)',
      borderWidth: 1,
      borderRadius: 2,
      datalabels: { display: false }
    },
    {
      label: 'T−2',
      data: valuesT2,
      backgroundColor: 'rgba(71,85,105,0.45)',
      borderColor: 'rgba(71,85,105,0.7)',
      borderWidth: 1,
      borderRadius: 2,
      datalabels: { display: false }
    }
  ];

  var chartOpts = {
    responsive: true,
    maintainAspectRatio: false,
    layout: { padding: { top: 28, bottom: 4, left: 4, right: 4 } },
    plugins: {
      legend: { display: false },
      datalabels: {},
      tooltip: {
        callbacks: {
          title: function(items) { return items[0].label + ' UST'; },
          label: function(ctx) {
            var v   = ctx.parsed.y;
            var ds  = ctx.dataset.label;
            if (v == null) return ds + ': N/A';
            var line = ds + ': ' + v.toFixed(2) + '%';
            // Append bps delta vs Today for T-1 and T-2
            if (ctx.datasetIndex === 1 && valuesT[ctx.dataIndex] != null) {
              var bps = bpsChange(valuesT[ctx.dataIndex], v);
              if (bps != null) line += '  (Δ ' + fmtBps(-bps) + ' vs Today)';
            }
            if (ctx.datasetIndex === 2 && valuesT[ctx.dataIndex] != null) {
              var bps2 = bpsChange(valuesT[ctx.dataIndex], v);
              if (bps2 != null) line += '  (Δ ' + fmtBps(-bps2) + ' vs Today)';
            }
            if (ctx.datasetIndex === 0 && valuesT1[ctx.dataIndex] != null) {
              var chg = bpsChange(v, valuesT1[ctx.dataIndex]);
              line += '  Δ 1d: ' + fmtBps(chg);
            }
            return line;
          }
        },
        backgroundColor: 'rgba(17,24,39,0.96)',
        titleColor: '#f1f5f9',
        bodyColor: '#94a3b8',
        borderColor: 'rgba(51,65,85,0.7)',
        borderWidth: 1,
        padding: 10
      }
    },
    scales: {
      x: {
        grid: { color: 'rgba(30,41,59,0.5)', drawBorder: false },
        ticks: { color: '#94a3b8', font: { size: 11, weight: '500' } },
        border: { display: false }
      },
      y: {
        position: 'left',
        grid: { color: 'rgba(30,41,59,0.5)', drawBorder: false },
        ticks: {
          color: '#94a3b8',
          font: { size: 10 },
          callback: function(v) { return v.toFixed(1) + '%'; }
        },
        border: { display: false }
      }
    }
  };

  if (yieldBarChart) {
    // Update existing chart
    yieldBarChart.data.labels   = CURVE_LABELS;
    yieldBarChart.data.datasets = datasets;
    yieldBarChart.update('active');
  } else {
    yieldBarChart = new Chart(ctx, {
      type: 'bar',
      plugins: [ChartDataLabels],
      data: { labels: CURVE_LABELS, datasets: datasets },
      options: chartOpts
    });
  }

  // Inline legend
  var legendEl = document.getElementById('yield-bar-legend');
  if (legendEl && !legendEl.hasChildNodes()) {
    legendEl.innerHTML =
      '<span class="ybl-item"><span class="ybl-swatch" style="background:rgba(59,130,246,0.85)"></span>Today</span>' +
      '<span class="ybl-item"><span class="ybl-swatch" style="background:rgba(99,102,241,0.60)"></span>T−1</span>' +
      '<span class="ybl-item"><span class="ybl-swatch" style="background:rgba(71,85,105,0.45)"></span>T−2</span>';
  }
}

function buildYieldTable(valuesT, valuesT1, valuesT2) {
  var table = document.getElementById('yield-data-table');
  if (!table) return;

  // Header row
  var thead = table.querySelector('thead');
  thead.innerHTML = '<tr>'
    + '<th class="yt-label">Maturity</th>'
    + CURVE_LABELS.map(function(l){ return '<th>' + l + '</th>'; }).join('')
    + '</tr>';

  // Compute deltas
  var delta1d = [], delta2d = [];
  for (var i = 0; i < CURVE_KEYS.length; i++) {
    delta1d.push(bpsChange(valuesT[i], valuesT1[i]));
    delta2d.push(bpsChange(valuesT[i], valuesT2[i]));
  }

  function makeRow(label, values, fmt, extraClass) {
    var cells = values.map(function(v, idx) {
      var text = (fmt === 'bps') ? fmtBps(v) : fmtRate(v);
      var cls  = '';
      if (fmt === 'bps' && v != null) cls = v > 0 ? 'bps-up' : v < 0 ? 'bps-dn' : '';
      return '<td class="yt-val ' + cls + '">' + text + '</td>';
    });
    return '<tr class="' + (extraClass||'') + '">'
      + '<td class="yt-label">' + label + '</td>'
      + cells.join('') + '</tr>';
  }

  var tbody = table.querySelector('tbody');
  tbody.innerHTML =
    makeRow('Today',   valuesT,  'pct', 'yt-today') +
    makeRow('T−1',     valuesT1, 'pct', 'yt-prior') +
    makeRow('T−2',     valuesT2, 'pct', 'yt-prior yt-t2') +
    makeRow('Δ 1d',    delta1d,  'bps', 'yt-delta') +
    makeRow('Δ 2d',    delta2d,  'bps', 'yt-delta yt-delta2');
}


// ============================================================
// SECTION 2 — FUNDING & LIQUIDITY
//
// 6 metric cards:
//   SOFR   | EFFR   | Fed Funds
//   ON RRP | 3M UST | 2s10s Spread
//
// Graceful N/A handling:
//   SOFR/EFFR  — fall back to lastKnownFunding (persisted)
//   Fed Funds  — from macro.FEDFUNDS (monthly, may lag)
//   ON RRP     — from fred.RRPONTSYD
//   3M UST     — from fred.DGS3MO
//   2s10s      — computed from DGS2 / DGS10
// ============================================================

function renderFunding(nyfed, fred, macro) {
  var grid = document.getElementById('funding-grid');
  if (!grid) return;
  grid.innerHTML = '';

  // ── SOFR ─────────────────────────────────────────────────
  var sofrLive = nyfed && nyfed.sofr && nyfed.sofr.rate != null;
  var sofr     = sofrLive ? nyfed.sofr : lastKnownFunding.sofr;
  if (sofrLive) { lastKnownFunding.sofr = nyfed.sofr; saveLastKnown('funding', lastKnownFunding); }

  // ── EFFR ─────────────────────────────────────────────────
  var effrLive = nyfed && nyfed.effr && nyfed.effr.rate != null;
  var effr     = effrLive ? nyfed.effr : lastKnownFunding.effr;
  if (effrLive) { lastKnownFunding.effr = nyfed.effr; saveLastKnown('funding', lastKnownFunding); }

  // ── ON RRP (Fed's overnight reverse repo, floor signal) ──
  var onrrpLive = fred && fred.RRPONTSYD && fred.RRPONTSYD.current != null;
  var onrrp     = onrrpLive ? fred.RRPONTSYD : lastKnownFunding.onrrp;
  if (onrrpLive) { lastKnownFunding.onrrp = fred.RRPONTSYD; saveLastKnown('funding', lastKnownFunding); }

  // ── Fed Funds target (from macro, monthly FRED) ──────────
  var ff = macro && macro.FEDFUNDS;

  // ── 3M T-Bill (short-term benchmark) ─────────────────────
  var tbill3m = fred && fred.DGS3MO;

  // ── 2s10s spread ─────────────────────────────────────────
  var d2  = fred && fred.DGS2,  d10 = fred && fred.DGS10;
  var spread2s10s = (d2 && d10 && d2.current != null && d10.current != null)
    ? Math.round((d10.current - d2.current) * 100) : null;

  // ── SOFR-EFFR spread ──────────────────────────────────────
  var sofrEffrBps = (sofr && effr && sofr.rate != null && effr.rate != null)
    ? Math.round((sofr.rate - effr.rate) * 100) : null;
  var spreadEl = document.getElementById('funding-sofr-effr');
  if (spreadEl) {
    spreadEl.textContent = sofrEffrBps != null
      ? 'SOFR–EFFR: ' + sign(sofrEffrBps) + sofrEffrBps + ' bps'
      : '';
  }

  // ── Render 6 cards ────────────────────────────────────────
  var cards = [
    {
      id: 'sofr',
      label: 'SOFR',
      sublabel: 'Secured Overnight',
      value: sofr && sofr.rate != null ? sofr.rate.toFixed(2) + '%' : '—',
      detail: sofr && sofr.volume ? '$' + sofr.volume.toFixed(0) + 'B vol' : '',
      date:   sofr && sofr.date   ? sofr.date : '',
      stale:  !sofrLive && sofr != null,
      status: sofr && sofr.rate != null ? 'green' : 'red'
    },
    {
      id: 'effr',
      label: 'EFFR',
      sublabel: 'Effective Fed Funds',
      value: effr && effr.rate != null ? effr.rate.toFixed(2) + '%' : '—',
      detail: '',
      date:   effr && effr.date ? effr.date : '',
      stale:  !effrLive && effr != null,
      status: effr && effr.rate != null ? 'green' : 'red'
    },
    {
      id: 'fedfunds',
      label: 'Fed Target',
      sublabel: 'FOMC Policy Rate',
      value: ff && ff.current != null ? ff.current.toFixed(2) + '%' : '—',
      detail: ff && ff.date ? 'As of ' + ff.date : 'Monthly',
      date:   '',
      stale:  false,
      status: ff && ff.current != null ? 'green' : 'yellow'
    },
    {
      id: 'onrrp',
      label: 'ON RRP',
      sublabel: 'Overnight Reverse Repo',
      value: onrrp && onrrp.current != null ? fmtBillion(onrrp.current) : '—',
      detail: 'Fed floor facility',
      date:   onrrp && onrrp.date ? onrrp.date : '',
      stale:  !onrrpLive && onrrp != null,
      status: onrrp && onrrp.current != null ? 'green' : 'red'
    },
    {
      id: 'tbill3m',
      label: '3M T-Bill',
      sublabel: 'Short-Term Benchmark',
      value: tbill3m && tbill3m.current != null ? tbill3m.current.toFixed(2) + '%' : '—',
      detail: tbill3m && tbill3m.prior != null
        ? 'Δ ' + fmtBps(bpsChange(tbill3m.current, tbill3m.prior))
        : '',
      date:   tbill3m && tbill3m.date ? tbill3m.date : '',
      stale:  false,
      status: tbill3m && tbill3m.current != null ? 'green' : 'yellow',
      bps:    tbill3m ? bpsChange(tbill3m.current, tbill3m.prior) : null
    },
    {
      id: 'spread2s10s',
      label: '2s10s Spread',
      sublabel: 'Curve Shape',
      value: spread2s10s != null ? sign(spread2s10s) + spread2s10s + ' bps' : '—',
      detail: spread2s10s != null
        ? (spread2s10s < 0 ? 'Inverted ↓' : spread2s10s < 30 ? 'Flat ↔' : 'Positive ↑')
        : '',
      date:   '',
      stale:  false,
      status: spread2s10s != null ? (spread2s10s < -20 ? 'red' : spread2s10s < 0 ? 'yellow' : 'green') : 'red',
      signed: spread2s10s
    }
  ];

  cards.forEach(function(c) {
    var card = document.createElement('div');
    card.className = 'fund-card' + (c.stale ? ' fund-card-stale' : '');

    // Status dot
    var dot = document.createElement('span');
    dot.className = 'fund-dot fund-dot-' + c.status;

    // Label
    var lbl = document.createElement('div');
    lbl.className = 'fund-label';
    lbl.appendChild(dot);
    lbl.appendChild(document.createTextNode(c.label));

    // Sub-label
    var sub = document.createElement('div');
    sub.className = 'fund-sublabel';
    sub.textContent = c.sublabel;

    // Value
    var val = document.createElement('div');
    val.className = 'fund-value' + (c.value === '—' ? ' fund-na' : '');
    // Color the spread / bps change
    if (c.signed != null) {
      val.className += c.signed < 0 ? ' val-red' : c.signed === 0 ? '' : ' val-green';
    }
    if (c.bps != null) {
      val.className += c.bps < 0 ? ' val-red' : c.bps > 0 ? ' val-green' : '';
    }
    val.textContent = c.value;
    if (c.stale) {
      var sb = document.createElement('span');
      sb.className = 'fund-stale-badge';
      sb.textContent = '*';
      sb.title = 'Cached value — live data unavailable';
      val.appendChild(sb);
    }

    // Detail / delta
    var detail = document.createElement('div');
    detail.className = 'fund-detail';
    detail.textContent = c.detail;

    card.appendChild(lbl);
    card.appendChild(sub);
    card.appendChild(val);
    card.appendChild(detail);
    if (c.date) {
      var datEl = document.createElement('div');
      datEl.className = 'fund-date';
      datEl.textContent = c.date;
      card.appendChild(datEl);
    }

    grid.appendChild(card);
  });
}


// ============================================================
// SECTION 3 — FX CONVERTER
// (two-row presets, full currency names, bidirectional rates)
// ============================================================

function getToUSD(ccy) {
  if (ccy === 'USD') return 1;
  if (!cachedYahoo) return null;
  var key  = FX_YAHOO_MAP[ccy];
  if (!key || !cachedYahoo[key] || cachedYahoo[key].current == null) return null;
  var rate = cachedYahoo[key].current;
  return FX_INVERTED[ccy] ? 1 / rate : rate;
}
function getToUSDPrior(ccy) {
  if (ccy === 'USD') return 1;
  if (!cachedYahoo) return null;
  var key  = FX_YAHOO_MAP[ccy];
  if (!key || !cachedYahoo[key] || cachedYahoo[key].prior == null) return null;
  var rate = cachedYahoo[key].prior;
  return FX_INVERTED[ccy] ? 1 / rate : rate;
}

function initFxConverter() {
  var baseSelect  = document.getElementById('fx-base');
  var quoteSelect = document.getElementById('fx-quote');
  var amountInput = document.getElementById('fx-amount');
  if (!baseSelect || !quoteSelect) return;

  if (!fxConverterInitialized) {
    fxConverterInitialized = true;

    // Populate selects with full currency names
    baseSelect.innerHTML = '';
    quoteSelect.innerHTML = '';
    FX_CURRENCIES.forEach(function(c) {
      var name = FX_CURRENCY_NAMES[c] || c;
      baseSelect.appendChild(new Option(name, c));
      quoteSelect.appendChild(new Option(name, c));
    });
    baseSelect.value  = 'USD';
    quoteSelect.value = 'EUR';

    // ── Event listeners ──────────────────────────────────────
    var compute = function() { computeFxConversion(); };
    baseSelect.addEventListener('change', compute);
    quoteSelect.addEventListener('change', compute);
    amountInput.addEventListener('input',  compute);

    document.getElementById('fx-swap').addEventListener('click', function() {
      var tmp = baseSelect.value;
      baseSelect.value  = quoteSelect.value;
      quoteSelect.value = tmp;
      computeFxConversion();
    });

    // ── Preset buttons (both rows) ───────────────────────────
    var presetBtns = document.querySelectorAll('.fx-preset-btn');
    presetBtns.forEach(function(btn) {
      btn.addEventListener('click', function() {
        amountInput.value = btn.getAttribute('data-amount');
        presetBtns.forEach(function(b){ b.classList.remove('active'); });
        btn.classList.add('active');
        computeFxConversion();
      });
    });

    // ── "Custom" button — focus the amount input ──────────────
    var customBtn = document.getElementById('fx-custom-trigger');
    if (customBtn) {
      customBtn.addEventListener('click', function() {
        presetBtns.forEach(function(b){ b.classList.remove('active'); });
        customBtn.classList.add('active');
        amountInput.focus();
        amountInput.select();
      });
      amountInput.addEventListener('focus', function() {
        presetBtns.forEach(function(b){ b.classList.remove('active'); });
        customBtn.classList.add('active');
      });
    }
  }

  computeFxConversion();
}

function computeFxConversion() {
  var amount    = parseFloat(document.getElementById('fx-amount').value);
  var base      = document.getElementById('fx-base').value;
  var quote     = document.getElementById('fx-quote').value;
  var resultEl  = document.getElementById('fx-result');
  var fwdEl     = document.getElementById('fx-rate-line');
  var revEl     = document.getElementById('fx-reverse-rate');
  var trendEl   = document.getElementById('fx-rate-trend');
  if (!resultEl) return;

  function clear(msg) {
    resultEl.textContent = msg || '--';
    if (fwdEl)   fwdEl.textContent   = '';
    if (revEl)   revEl.textContent   = '';
    if (trendEl) { trendEl.textContent = ''; trendEl.className = 'fx-trend-badge'; }
  }

  if (isNaN(amount) || amount <= 0) return clear('—');
  if (base === quote) {
    resultEl.textContent = amount.toLocaleString('en-US', {minimumFractionDigits:2, maximumFractionDigits:2}) + ' ' + quote;
    if (fwdEl) fwdEl.textContent = '1:1'; if (revEl) revEl.textContent = '';
    return;
  }

  var baseUSD  = getToUSD(base),  quoteUSD = getToUSD(quote);
  if (!baseUSD || !quoteUSD) return clear('Rate unavailable');

  var cross    = baseUSD / quoteUSD;
  var crossRev = 1 / cross;
  var result   = amount * cross;

  // Flash on change
  var newText = result.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2}) + ' ' + quote;
  if (resultEl.textContent !== newText) {
    resultEl.classList.remove('fx-flash');
    void resultEl.offsetWidth;
    resultEl.classList.add('fx-flash');
    resultEl.textContent = newText;
  }

  // Forward / reverse rates
  var dec  = cross    > 10 ? 2 : 4;
  var decR = crossRev > 10 ? 2 : 4;
  if (fwdEl) fwdEl.textContent = '1 ' + base  + ' = ' + cross.toFixed(dec)    + ' ' + quote;
  if (revEl) revEl.textContent = '1 ' + quote + ' = ' + crossRev.toFixed(decR) + ' ' + base;

  // Trend vs yesterday
  if (trendEl) {
    var bP = getToUSDPrior(base), qP = getToUSDPrior(quote);
    if (bP && qP) {
      var priorCross = bP / qP;
      var pct = ((cross - priorCross) / priorCross) * 100;
      trendEl.textContent = sign(pct) + pct.toFixed(2) + '% vs prev';
      trendEl.className   = 'fx-trend-badge ' + (pct > 0 ? 'trend-up' : pct < 0 ? 'trend-dn' : 'trend-flat');
    } else {
      trendEl.textContent = ''; trendEl.className = 'fx-trend-badge';
    }
  }
}


// ============================================================
// HEADER UPDATE
// ============================================================

function updateHeader(data) {
  var now       = nowET();
  var dateStr   = now.toLocaleDateString('en-US',
    { weekday:'short', year:'numeric', month:'short', day:'numeric' });
  var timeStr   = now.toLocaleTimeString('en-US',
    { hour:'numeric', minute:'2-digit', hour12:true }) + ' ET';

  var metaEl = document.getElementById('header-meta');
  if (metaEl) metaEl.textContent = dateStr + '  ·  ' + timeStr + '  ·  Refresh: 15min';

  var statusEl = document.getElementById('market-status');
  if (statusEl) {
    var open = isMarketOpen();
    statusEl.textContent = open ? 'MARKET OPEN' : 'MARKET CLOSED';
    statusEl.className   = 'market-badge ' + (open ? 'open' : 'closed');
  }

  if (data && data.fomc && data.fomc.next) {
    var fe = document.getElementById('fomc-badge');
    if (fe) {
      fe.textContent = 'FOMC: ' + data.fomc.daysAway + 'd';
      fe.title       = 'Next FOMC: ' + data.fomc.next;
      fe.className   = 'fomc-badge' + (data.fomc.daysAway <= 7 ? ' imminent' : '');
    }
  }
}


// ============================================================
// MAIN RENDER (focused — only 3 sections)
// ============================================================

function renderDashboard(data) {
  updateHeader(data);

  // Silent background alerts
  var alerts = computeAlerts(data);
  renderAlerts(alerts);

  // Cache for FX converter
  cachedYahoo = data.yahoo;
  cachedFred  = data.fred;
  cacheData('market', data);

  // ── Section 1: Treasury Yields ──────────────────────────
  renderYieldsHero(data.fred);

  // ── Section 2: Funding & Liquidity ──────────────────────
  renderFunding(data.nyfed, data.fred, data.macro);

  // ── Section 3: FX Converter ─────────────────────────────
  renderTicker(data.yahoo);
  initFxConverter();

  // ── Hide loading, show dashboard ────────────────────────
  document.getElementById('loading').style.display  = 'none';
  document.getElementById('dashboard').style.display = 'block';
}


// ============================================================
// DATA FETCHING (unchanged infrastructure)
// ============================================================

function fetchData() {
  if (WORKER_URL.indexOf('YOUR_') !== -1) {
    document.getElementById('loading').style.display   = 'none';
    document.getElementById('setup-banner').style.display = 'block';
    return;
  }
  beginFetch();
  fetch(WORKER_URL + '/api/market-data')
    .then(function(r) {
      if (!r.ok) throw new Error('Worker ' + r.status);
      return r.json();
    })
    .then(function(data) {
      fetchRetryCount = 0;
      tickerBackoff   = isMarketOpen() ? TICKER_REFRESH_MS : TICKER_REFRESH_SLOW;
      lastRefreshTime = Date.now();
      renderDashboard(data);
      updateAgoCounter();
    })
    .catch(function(err) {
      fetchRetryCount++;
      var cached = getCachedData('market', 3600000);
      if (cached) { try { renderDashboard(cached); } catch(e){} return; }
      var el = document.getElementById('loading');
      if (el) el.innerHTML = '<div class="error-msg">Failed to load: ' + err.message + '<br><small>Will retry. Press R to retry now.</small></div>';
    })
    .finally(endFetch);
}

function tickerRefresh() {
  if (WORKER_URL.indexOf('YOUR_') !== -1) return;
  fetch(WORKER_URL + '/api/ticker')
    .then(function(r) { if (!r.ok) throw new Error(r.status); return r.json(); })
    .then(function(data) {
      cachedYahoo   = Object.assign(cachedYahoo || {}, data.yahoo);
      renderTicker(cachedYahoo);
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


// ============================================================
// UTILITY: refresh indicator
// ============================================================

var fetchInFlight2 = 0;
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
  var secs  = Math.round((Date.now() - lastRefreshTime) / 1000);
  var label = secs < 60 ? secs + 's ago' : Math.floor(secs / 60) + 'm ago';
  var el = document.getElementById('updated-ago');
  if (!el) {
    el = document.createElement('span');
    el.id = 'updated-ago';
    var meta = document.getElementById('header-meta');
    if (meta) meta.appendChild(el);
  }
  el.textContent = '  ·  ' + label;
}


// ============================================================
// QUICK NOTES
// ============================================================

function initNotes() {
  var panel   = document.getElementById('notes-panel');
  var textarea = document.getElementById('notes-text');
  var saved   = localStorage.getItem('td_notes') || '';
  textarea.value = saved;

  var saveT = null;
  textarea.addEventListener('input', function() {
    clearTimeout(saveT);
    saveT = setTimeout(function() {
      localStorage.setItem('td_notes', textarea.value);
      var msg = document.getElementById('notes-saved');
      if (msg) { msg.textContent = 'Saved'; setTimeout(function(){ msg.textContent=''; }, 1500); }
    }, 500);
  });
  document.getElementById('notes-close').addEventListener('click', function(){
    panel.style.display = 'none';
  });
  document.getElementById('notes-clear').addEventListener('click', function(){
    if (confirm('Clear all notes?')) {
      textarea.value = '';
      localStorage.removeItem('td_notes');
    }
  });
  document.getElementById('btn-notes').addEventListener('click', function(){
    panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
    if (panel.style.display === 'block') textarea.focus();
  });
}


// ============================================================
// KEYBOARD SHORTCUTS
// ============================================================

function initShortcuts() {
  document.addEventListener('keydown', function(e) {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' ||
        e.target.tagName === 'SELECT') {
      if (e.key === 'Escape') { e.target.blur(); }
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
    if ((e.key === 'r' || e.key === 'R') && !e.ctrlKey) {
      e.preventDefault();
      if (Date.now() - lastManualRefresh < 3000) return;
      lastManualRefresh = Date.now();
      fetchData();
      return;
    }
    if (e.key === 'j' || e.key === 'J') {
      e.preventDefault();
      var np = document.getElementById('notes-panel');
      np.style.display = np.style.display === 'none' ? 'block' : 'none';
      if (np.style.display === 'block') document.getElementById('notes-text').focus();
      return;
    }
  });

  document.getElementById('btn-refresh').addEventListener('click', function() {
    if (Date.now() - lastManualRefresh < 3000) return;
    lastManualRefresh = Date.now();
    fetchData();
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
}


// ============================================================
// INIT
// ============================================================

// Show dashboard immediately (no skeleton — clean initial state)
document.getElementById('dashboard').style.display = 'block';

// 1. Load from cache for instant display
var cachedMarket = getCachedData('market', 600000);
if (cachedMarket) {
  try { renderDashboard(cachedMarket); } catch(e) {}
}

// 2. Fresh fetch in background
fetchData();

// 3. Timers
refreshTimer = setInterval(fetchData, REFRESH_MS);

// 4. Fast ticker refresh
tickerTimer = setTimeout(tickerRefresh, tickerBackoff);

// 5. Interactivity
initShortcuts();
initNotes();

// 6. Updated-ago counter
setInterval(updateAgoCounter, 10000);
