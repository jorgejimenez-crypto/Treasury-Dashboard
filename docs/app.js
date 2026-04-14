/**
 * ═══════════════════════════════════════════════════════════
 *  Treasury Desk — app.js
 *
 *  Focused scope: Yields hero · Funding & Liquidity · FX Converter
 *  Everything else is silent (alerts computed, never displayed).
 *
 *  Data flow:
 *    fetchData()  → /api/market-data (every 15 min)
 *    tickerRefresh() → /api/ticker   (every 10s market hours)
 *    localStorage cache for instant load + weekend fallback
 * ═══════════════════════════════════════════════════════════
 */

// === CONFIG =====================================================

var WORKER_URL          = 'https://treasury-proxy.treasurydashboard.workers.dev';
var REFRESH_MS          = 15 * 60 * 1000;
var TICKER_REFRESH_MS   = 10 * 1000;
var TICKER_REFRESH_SLOW = 60 * 1000;
var NEWS_REFRESH_MS     = 30 * 60 * 1000;

// Silent alert thresholds (background risk monitoring — no panel displayed)
var THRESHOLDS = {
  commodityPct: 2.0, multiBooksMin: 2,
  vixHigh: 30, vixPctSpike: 15,
  dxyLow: 99, dxyHigh: 105,
  yield10YHigh: 5.0,
  igOasWide: 150, hyOasWide: 500
};

// Yield curve (short end: 1M · 3M · 6M)
var CURVE_KEYS   = ['DGS1MO', 'DGS3MO', 'DGS6MO'];
var CURVE_LABELS = ['1M', '3M', '6M'];

// Ticker strip items — yahoo (10s) + fred daily
var TICKER_ITEMS = [
  { key:'SP500',  label:'S&P 500', src:'yahoo', prefix:'',  fmt:0, suffix:'' },
  { key:'DGS2',   label:'2Y UST',  src:'fred',  prefix:'',  fmt:2, suffix:'%', bpsChange:true },
  { key:'DGS10',  label:'10Y UST', src:'fred',  prefix:'',  fmt:2, suffix:'%', bpsChange:true },
  { key:'DXY',    label:'DXY',     src:'yahoo', prefix:'',  fmt:2, suffix:'' },
  { key:'WTI',    label:'WTI',     src:'yahoo', prefix:'$', fmt:2, suffix:'' },
  { key:'Gold',   label:'Gold',    src:'yahoo', prefix:'$', fmt:0, suffix:'' },
  { key:'EURUSD', label:'EUR/USD', src:'yahoo', prefix:'',  fmt:4, suffix:'' },
  { key:'VIX',    label:'VIX',     src:'yahoo', prefix:'',  fmt:2, suffix:'' },
];

// FX converter — 16 currencies
var FX_CURRENCIES = [
  'USD','EUR','GBP','JPY','AUD','CAD','CHF','CNH',
  'NZD','MXN','BRL','SGD','HKD','INR','SEK','NOK'
];
var FX_NAMES = {
  USD:'US Dollar',   EUR:'Euro',              GBP:'British Pound',
  JPY:'Japanese Yen',AUD:'Australian Dollar', CAD:'Canadian Dollar',
  CHF:'Swiss Franc', CNH:'Chinese Yuan',      NZD:'New Zealand Dollar',
  MXN:'Mexican Peso',BRL:'Brazilian Real',    SGD:'Singapore Dollar',
  HKD:'Hong Kong Dollar',INR:'Indian Rupee',  SEK:'Swedish Krona',
  NOK:'Norwegian Krone'
};
var FX_YAHOO_MAP = {
  EUR:'EURUSD', GBP:'GBPUSD', AUD:'AUDUSD', JPY:'USDJPY',
  CAD:'USDCAD', CHF:'USDCHF', CNH:'USDCNH', NZD:'NZDUSD',
  MXN:'USDMXN', BRL:'USDBRL', SGD:'USDSGD', HKD:'USDHKD',
  INR:'USDINR', SEK:'USDSEK', NOK:'USDNOK'
};
var FX_INVERTED = {
  JPY:true,CAD:true,CHF:true,CNH:true,MXN:true,BRL:true,
  SGD:true,HKD:true,INR:true,SEK:true,NOK:true
};

// Energy keys for silent alert computation
var ENERGY_KEYS      = ['WTI','Brent','NatGas','HeatOil'];
var COMMODITY_LABELS = {
  WTI:'WTI Crude',Brent:'Brent Crude',NatGas:'Henry Hub',HeatOil:'Heating Oil'
};

var yieldChart          = null;   // Chart.js line chart instance
var refreshTimer        = null;
var tickerTimer         = null;
var cachedYahoo         = null;
var cachedFred          = null;
var tickerBackoff       = TICKER_REFRESH_MS;
var lastManualRefresh   = 0;
var fxConverterReady    = false;
var liveStreamLoaded    = false;   // Bloomberg iframe injected once
var newsTimer           = null;    // 30-min news refresh
var lastRefreshTime     = 0;
var fetchInFlight       = 0;
var fetchRetryCount     = 0;



// === LOCALSTORAGE ===============================================

function cacheData(k, v) {
  try { localStorage.setItem('td_' + k, JSON.stringify({ t: Date.now(), d: v })); } catch(e){}
}
function getCachedData(k, maxAge) {
  try {
    var r = localStorage.getItem('td_' + k); if (!r) return null;
    var p = JSON.parse(r);
    return (Date.now() - p.t > (maxAge||300000)) ? null : p.d;
  } catch(e){ return null; }
}
function loadKnown(k)  { try { var r = localStorage.getItem('td_lk_'+k); return r ? JSON.parse(r) : null; } catch(e){ return null; } }
function saveKnown(k,v){ try { localStorage.setItem('td_lk_'+k, JSON.stringify(v)); } catch(e){} }

var knownFunding = loadKnown('funding') || {};
var knownYields  = loadKnown('yields');


// === MATH & DATE HELPERS ========================================

function pct(cur, prev) { return (cur==null||prev==null||prev===0) ? null : (cur-prev)/prev*100; }
function bps(cur, prev) { return (cur==null||prev==null) ? null : Math.round((cur-prev)*100); }
function sgn(v)         { return (v==null) ? '' : v>=0 ? '+' : ''; }
function nowET()        { return new Date(new Date().toLocaleString('en-US',{timeZone:'America/New_York'})); }
function isOpen()       { var n=nowET(),d=n.getDay(),m=n.getHours()*60+n.getMinutes(); return d>0&&d<6&&m>=570&&m<960; }
function fmtRate(v,dec) { return (v==null||isNaN(v)) ? '—' : v.toFixed(dec!=null?dec:2)+'%'; }
function fmtBps(b)      { return b==null ? '—' : (b>=0?'+':'')+b+' bps'; }


// === SILENT ALERT COMPUTATION ===================================
// Risk monitoring kept in background even though no Risk panel is shown.

function computeAlerts(data) {
  var alerts = [], y = data.yahoo || {};

  // Commodity surge
  var sigs = [];
  ENERGY_KEYS.forEach(function(k) {
    var d = y[k]; if (!d||d.current==null) return;
    var p = pct(d.current, d.prior);
    if (p!=null && Math.abs(p) >= THRESHOLDS.commodityPct)
      sigs.push(COMMODITY_LABELS[k]+' '+(p>0?'↑':'↓')+Math.abs(p).toFixed(1)+'%');
  });
  if (sigs.length >= THRESHOLDS.multiBooksMin)
    alerts.push({ level:'red',    msg:'COMMODITY SURGE: '+sigs.join(', ') });
  else if (sigs.length === 1)
    alerts.push({ level:'yellow', msg:'COMMODITY WATCH: '+sigs[0] });

  // VIX
  var vix = y.VIX;
  if (vix && vix.current != null) {
    if (vix.current > THRESHOLDS.vixHigh)
      alerts.push({ level:'red',    msg:'VIX '+vix.current.toFixed(1)+' — elevated risk' });
    else {
      var vp = pct(vix.current, vix.prior);
      if (vp!=null && Math.abs(vp) > THRESHOLDS.vixPctSpike)
        alerts.push({ level:'yellow', msg:'VIX '+sgn(vp)+vp.toFixed(1)+'% DoD' });
    }
  }

  // DXY
  var dxy = y.DXY;
  if (dxy && dxy.current!=null &&
     (dxy.current < THRESHOLDS.dxyLow || dxy.current > THRESHOLDS.dxyHigh))
    alerts.push({ level:'yellow', msg:'DXY '+dxy.current.toFixed(2)+' — outside '+THRESHOLDS.dxyLow+'–'+THRESHOLDS.dxyHigh });

  // 10Y yield
  var y10 = data.fred && data.fred.DGS10;
  if (y10 && y10.current!=null && y10.current > THRESHOLDS.yield10YHigh)
    alerts.push({ level:'red', msg:'10Y yield '+y10.current.toFixed(2)+'% — above '+THRESHOLDS.yield10YHigh+'%' });

  // Credit spreads (panel removed, sentinel kept)
  var ig = data.fred && data.fred.BAMLC0A0CM;
  if (ig && ig.current!=null && ig.current*100 > THRESHOLDS.igOasWide)
    alerts.push({ level:'yellow', msg:'IG OAS '+Math.round(ig.current*100)+' bps — wider than '+THRESHOLDS.igOasWide });

  return alerts;
}

function renderAlerts(alerts) {
  var bar = document.getElementById('alert-bar');
  if (!bar) return;
  if (!alerts.length) { bar.innerHTML = ''; bar.style.display = 'none'; return; }
  bar.style.display = 'block';
  bar.innerHTML = alerts.map(function(a) {
    return '<div class="alert-item alert-'+a.level+'"><span class="alert-pip"></span>'+a.msg+'</div>';
  }).join('');
}


// === SECTION 1 — TREASURY YIELDS ================================
//
// renderYieldsSection(fred, yieldsHist)
//   fred       — current FRED series (for metric cards + spread)
//   yieldsHist — historical data {DGS1MO:{t1,t7,t14,...}, ...}
//
// Builds:
//   • Grouped bar chart (Chart.js): 3 maturities × {T-1, T-7, T-14}
//   • Precision data table below chart
//   • 1M–6M spread pill in section header

function renderYieldsSection(fred, yieldsHist) {
  if (!fred) return;

  // ── Collect T-1 / T-7 / T-14 for each maturity ──────────────
  var t1=[], t7=[], t14=[], t1Dates=[], t7Dates=[], t14Dates=[];
  for (var i=0; i<CURVE_KEYS.length; i++) {
    var h = yieldsHist && yieldsHist[CURVE_KEYS[i]];
    // Prefer historical endpoint; fall back to live FRED values
    var live = fred[CURVE_KEYS[i]];
    t1.push(  h && h.t1  != null ? h.t1  : (live && live.current != null ? live.current : null));
    t7.push(  h && h.t7  != null ? h.t7  : null);
    t14.push( h && h.t14 != null ? h.t14 : null);
    t1Dates.push(  h && h.t1Date  ? h.t1Date  : (live ? live.date  : ''));
    t7Dates.push(  h && h.t7Date  ? h.t7Date  : '');
    t14Dates.push( h && h.t14Date ? h.t14Date : '');
  }

  // Persist for offline/weekend fallback.
  // Rule: only write a field to knownYields if we actually have a value.
  // Never overwrite a good cached t7/t14 with null — that destroys the fallback.
  var anyLive = t1.some(function(v){ return v!=null; });
  if (anyLive) {
    if (!knownYields) knownYields = {};
    for (var j=0; j<CURVE_KEYS.length; j++) {
      var key = CURVE_KEYS[j];
      if (!knownYields[key]) knownYields[key] = {};
      // Only update a slot when we have a real value — preserve prior good values
      if (t1[j]  != null) knownYields[key].t1  = t1[j].toFixed(3);
      if (t7[j]  != null) knownYields[key].t7  = t7[j].toFixed(3);
      if (t14[j] != null) knownYields[key].t14 = t14[j].toFixed(3);
      if (t1Dates[j])     knownYields[key].date = t1Dates[j];
    }
    saveKnown('yields', knownYields);
  }
  // Fill gaps from cache — T-1 always, T-7/T-14 only when yieldsHist returned null
  for (var k=0; k<CURVE_KEYS.length; k++) {
    var ky = knownYields && knownYields[CURVE_KEYS[k]];
    if (t1[k]==null  && ky && ky.t1  != null) t1[k]  = parseFloat(ky.t1)  || null;
    if (t7[k]==null  && ky && ky.t7  != null) t7[k]  = parseFloat(ky.t7)  || null;
    if (t14[k]==null && ky && ky.t14 != null) t14[k] = parseFloat(ky.t14) || null;
  }

  // ── Build column labels (use dates if available) ─────────────
  var sample = yieldsHist && yieldsHist[CURVE_KEYS[0]];
  var col1 = 'T-1' + (sample && sample.t1Date  ? '  '+sample.t1Date  : '');
  var col7 = 'T-7' + (sample && sample.t7Date  ? '  '+sample.t7Date  : '');
  var col14= 'T-14'+ (sample && sample.t14Date ? '  '+sample.t14Date : '');

  buildYieldChart(t1, t7, t14, col1, col7, col14);
  buildYieldTable(t1, t7, t14, col1, col7, col14);

  // ── Spread pill: 1M-6M ───────────────────────────────────────
  var pill = document.getElementById('yield-spread-pill');
  var m1 = t1[0], m6 = t1[2];
  if (pill) {
    if (m1!=null && m6!=null) {
      var sp = Math.round((m6-m1)*100);
      var shape = sp<0 ? 'inverted' : sp<15 ? 'flat' : 'positive';
      pill.textContent = '1M–6M: '+sgn(sp)+sp+' bps';
      pill.className = 'spread-pill spread-'+shape;
    } else {
      pill.textContent = ''; pill.className = 'spread-pill';
    }
  }

  // ── Source label ─────────────────────────────────────────────
  var src = document.getElementById('yield-source-lbl');
  if (src && sample && sample.t1Date) src.textContent = 'FRED · '+sample.t1Date;
}

// === SHORT-TERM TREASURY YIELDS — Line Chart ====================
//
// Maturity comparison chart: 3 x-axis points (1M · 3M · 6M)
// 3 series: T-1 (solid blue) · T-7 (dashed red) · T-14 (dotted green)
//
// Not a time-series — this is a snapshot of the yield curve shape
// across maturities at three different points in time.

// Series color palette (dark-theme readable, not neon)
var YLD_BLUE  = '#60a5fa';   // T-1  — blue
var YLD_RED   = '#f87171';   // T-7  — red
var YLD_GREEN = '#34d399';   // T-14 — green

function buildYieldChart(t1, t7, t14, lbl1, lbl7, lbl14) {
  var canvas = document.getElementById('yield-bar-canvas');
  if (!canvas) return;

  var datasets = [
    {
      // T-1 (latest) — most prominent: solid blue, filled area, large points
      label: lbl1,
      data: t1,
      borderColor: YLD_BLUE,
      backgroundColor: 'rgba(96,165,250,0.07)',
      borderWidth: 2.5,
      fill: true,
      tension: 0,
      pointRadius: 7,
      pointHoverRadius: 9,
      pointBackgroundColor: YLD_BLUE,
      pointBorderColor: 'var(--bg-inset, #0b0f17)',
      pointBorderWidth: 2,
      datalabels: {
        display: true,
        anchor: 'end', align: 'top', offset: 6,
        color: '#e2e8f0',
        font: { size: 12, weight: '700', family: "'Cascadia Code','Consolas',monospace" },
        formatter: function(v) { return v!=null ? v.toFixed(2)+'%' : ''; }
      }
    },
    {
      // T-7 — secondary: dashed red, medium points
      label: lbl7,
      data: t7,
      borderColor: 'rgba(248,113,113,0.85)',
      backgroundColor: 'transparent',
      borderWidth: 1.5,
      borderDash: [6, 4],
      fill: false,
      tension: 0,
      pointRadius: 5,
      pointHoverRadius: 7,
      pointBackgroundColor: YLD_RED,
      pointBorderColor: 'var(--bg-inset, #0b0f17)',
      pointBorderWidth: 1.5,
      datalabels: { display: false }
    },
    {
      // T-14 — background reference: dotted green, small points
      label: lbl14,
      data: t14,
      borderColor: 'rgba(52,211,153,0.70)',
      backgroundColor: 'transparent',
      borderWidth: 1.5,
      borderDash: [2, 5],
      fill: false,
      tension: 0,
      pointRadius: 4,
      pointHoverRadius: 6,
      pointBackgroundColor: YLD_GREEN,
      pointBorderColor: 'var(--bg-inset, #0b0f17)',
      pointBorderWidth: 1,
      datalabels: { display: false }
    }
  ];

  var opts = {
    responsive: true,
    maintainAspectRatio: false,
    layout: { padding: { top: 40, bottom: 8, left: 8, right: 8 } },
    plugins: {
      legend: { display: false },
      datalabels: {},
      tooltip: {
        mode: 'index',           // show all 3 series on hover
        intersect: false,
        backgroundColor: 'rgba(10,14,22,0.97)',
        titleColor: '#f1f5f9',
        titleFont: { size: 13, weight: '700' },
        bodyColor: '#94a3b8',
        bodyFont: { size: 12 },
        borderColor: 'rgba(45,63,82,0.9)',
        borderWidth: 1,
        padding: 14,
        cornerRadius: 6,
        displayColors: true,
        callbacks: {
          title: function(items) {
            return items[0].label + ' US Treasury';
          },
          label: function(ctx) {
            var v = ctx.parsed.y;
            if (v == null) return '  ' + ctx.dataset.label + ':  N/A';
            // Show rate + bps delta vs T-1 for T-7 and T-14
            var t1val = ctx.chart.data.datasets[0].data[ctx.dataIndex];
            var line  = '  ' + ctx.dataset.label + ':  ' + v.toFixed(3) + '%';
            if (ctx.datasetIndex > 0 && t1val != null) {
              var chg = Math.round((t1val - v) * 100);
              line += '   ' + sgn(chg) + chg + ' bps vs T-1';
            }
            return line;
          }
        }
      }
    },
    scales: {
      x: {
        grid:  { display: false },
        border:{ display: false },
        ticks: { color: '#94a3b8', font: { size: 14, weight: '700' }, padding: 10 }
      },
      y: {
        grid:  { color: 'rgba(30,41,59,0.55)', drawBorder: false },
        border:{ display: false },
        ticks: {
          color: '#64748b', font: { size: 11 }, padding: 10,
          callback: function(v) { return v.toFixed(2) + '%'; }
        }
      }
    }
  };

  // Destroy old instance if it exists (handles type migration from bar → line)
  if (yieldChart) {
    try { yieldChart.destroy(); } catch(e) {}
    yieldChart = null;
  }

  try {
    yieldChart = new Chart(
      canvas.getContext('2d'),
      { type:'line', plugins:[ChartDataLabels], data:{ labels:CURVE_LABELS, datasets:datasets }, options:opts }
    );
  } catch(e) {
    // Chart.js or ChartDataLabels unavailable (CDN timeout, etc.)
    // Show message inside the chart shell so the data table still renders below
    console.error('[yields] Chart init failed:', e);
    var shell = canvas.parentElement;
    if (shell) shell.innerHTML =
      '<div style="display:flex;align-items:center;justify-content:center;height:100%;'
      + 'color:var(--text-3,#64748b);font-size:12px;font-family:monospace;">'
      + 'Chart unavailable — see data table below</div>';
  }

  // Update legend swatches — colors must match dataset borderColor exactly
  var leg = document.getElementById('chart-legend');
  if (leg) {
    leg.innerHTML =
      '<span class="leg-item"><span class="leg-swatch leg-solid" style="background:'+YLD_BLUE+'"></span>'+(lbl1||'T-1')+'</span>' +
      '<span class="leg-item"><span class="leg-dashed" style="border-color:'+YLD_RED+'"></span>'+(lbl7||'T-7')+'</span>' +
      '<span class="leg-item"><span class="leg-dotted" style="border-color:'+YLD_GREEN+'"></span>'+(lbl14||'T-14')+'</span>';
  }
}

// ── Precision data table ──────────────────────────────────────

function buildYieldTable(t1, t7, t14, col1, col7, col14) {
  var table = document.getElementById('yield-data-table');
  if (!table) return;

  var thead = table.querySelector('thead');
  var tbody = table.querySelector('tbody');

  thead.innerHTML = '<tr>'
    + '<th class="yt-hd-mat">Maturity</th>'
    + '<th class="yt-hd-val yt-hd-latest">'+col1+'</th>'
    + '<th class="yt-hd-val yt-hd-t7">'+col7+'</th>'
    + '<th class="yt-hd-val yt-hd-t14">'+col14+'</th>'
    + '<th class="yt-hd-delta">Δ 7d (bps)</th>'
    + '<th class="yt-hd-delta">Δ 14d (bps)</th>'
    + '</tr>';

  tbody.innerHTML = '';
  for (var i=0; i<CURVE_KEYS.length; i++) {
    var v1=t1[i], v7=t7[i], v14=t14[i];
    var d7  = bps(v1, v7);
    var d14 = bps(v1, v14);

    var cls7  = d7  == null ? '' : d7 >0 ? 'yd-up' : d7 <0 ? 'yd-dn' : '';
    var cls14 = d14 == null ? '' : d14>0 ? 'yd-up' : d14<0 ? 'yd-dn' : '';

    var tr = document.createElement('tr');
    tr.innerHTML =
      '<td class="yt-mat">'+CURVE_LABELS[i]+'</td>'
      +'<td class="yt-val yt-latest">'+(v1 !=null?v1.toFixed(3)+'%':'<span class="yt-na">—</span>')+'</td>'
      +'<td class="yt-val">'+(v7 !=null?v7.toFixed(3)+'%':'<span class="yt-na">—</span>')+'</td>'
      +'<td class="yt-val">'+(v14!=null?v14.toFixed(3)+'%':'<span class="yt-na">—</span>')+'</td>'
      +'<td class="yt-delta '+cls7 +'">'+(d7  !=null?sgn(d7 )+d7 :'—')+'</td>'
      +'<td class="yt-delta '+cls14+'">'+(d14 !=null?sgn(d14)+d14:'—')+'</td>';
    tbody.appendChild(tr);
  }
}


// === SECTION 2 — FUNDING & LIQUIDITY ============================
//
// 5 cards: SOFR · SOFR 30D · EFFR · TSY 1M · TSY 3M
// OBFR removed. EFFR at position 3 (policy-rate reference).
// Graceful fallback to knownFunding for weekend / outage resilience.

function renderFunding(nyfed, fred) {
  var grid = document.getElementById('funding-grid');
  if (!grid) return;
  grid.innerHTML = '';

  // Pull live values, fall back to persisted
  var effrLive = nyfed && nyfed.effr && nyfed.effr.rate != null;
  var sofrLive = nyfed && nyfed.sofr && nyfed.sofr.rate != null;

  var effr  = effrLive ? nyfed.effr  : knownFunding.effr;
  var sofr  = sofrLive ? nyfed.sofr  : knownFunding.sofr;

  if (effrLive) knownFunding.effr = nyfed.effr;
  if (sofrLive) knownFunding.sofr = nyfed.sofr;
  if (effrLive || sofrLive) saveKnown('funding', knownFunding);

  var sofr30 = fred && fred.SOFR30DAYAVG;
  var tsy1m  = fred && fred.DGS1MO;
  var tsy3m  = fred && fred.DGS3MO;

  // SOFR–EFFR spread for header
  var spread = document.getElementById('funding-spread');
  if (spread && sofr && effr && sofr.rate!=null && effr.rate!=null) {
    var sp = Math.round((sofr.rate - effr.rate)*100);
    spread.textContent = 'SOFR–EFFR: '+sgn(sp)+sp+' bps';
  } else if (spread) {
    spread.textContent = '';
  }

  // Card definitions — ordered: SOFR · SOFR 30D · EFFR · TSY 1M · TSY 3M
  var cards = [
    {
      label: 'SOFR',
      sub:   'Secured Overnight',
      value: sofr  && sofr.rate  != null ? sofr.rate.toFixed(2)+'%'  : null,
      extra: sofr  && sofr.volume ? '$'+sofr.volume.toFixed(0)+'B vol' : '',
      date:  sofr  && sofr.date  ? sofr.date  : '',
      stale: !sofrLive && !!sofr,
      ok:    sofrLive
    },
    {
      label: 'SOFR 30D',
      sub:   '30-Day Average',
      value: sofr30 && sofr30.current != null ? sofr30.current.toFixed(2)+'%' : null,
      date:  sofr30 && sofr30.date  ? sofr30.date  : '',
      stale: false,
      ok:    sofr30 && sofr30.current != null
    },
    {
      label: 'EFFR',
      sub:   'Effective Fed Funds',
      value: effr  && effr.rate  != null ? effr.rate.toFixed(2)+'%'  : null,
      date:  effr  && effr.date  ? effr.date  : '',
      stale: !effrLive && !!effr,
      ok:    effrLive
    },
    {
      label: 'TSY 1M',
      sub:   '1-Month T-Bill',
      value: tsy1m && tsy1m.current != null ? tsy1m.current.toFixed(2)+'%' : null,
      delta: tsy1m ? bps(tsy1m.current, tsy1m.prior) : null,
      date:  tsy1m && tsy1m.date ? tsy1m.date : '',
      stale: false,
      ok:    tsy1m && tsy1m.current != null
    },
    {
      label: 'TSY 3M',
      sub:   '3-Month T-Bill',
      value: tsy3m && tsy3m.current != null ? tsy3m.current.toFixed(2)+'%' : null,
      delta: tsy3m ? bps(tsy3m.current, tsy3m.prior) : null,
      date:  tsy3m && tsy3m.date ? tsy3m.date : '',
      stale: false,
      ok:    tsy3m && tsy3m.current != null
    }
  ];

  cards.forEach(function(c) {
    var el = document.createElement('div');
    el.className = 'fund-card' + (c.stale ? ' fund-card-stale' : '');

    // Status indicator
    var dot = document.createElement('span');
    dot.className = 'fund-dot ' + (c.stale ? 'fund-dot-warn' : c.ok ? 'fund-dot-ok' : 'fund-dot-na');

    var lbl = document.createElement('div');
    lbl.className = 'fund-label';
    lbl.appendChild(dot);
    lbl.appendChild(document.createTextNode(c.label));

    var sub = document.createElement('div');
    sub.className = 'fund-sub';
    sub.textContent = c.sub;

    var val = document.createElement('div');
    val.className = 'fund-value' + (!c.value ? ' fund-na' : '');
    val.textContent = c.value || '—';
    if (c.stale) {
      var badge = document.createElement('sup');
      badge.className = 'fund-stale'; badge.textContent = '*';
      badge.title = 'Cached — live data unavailable';
      val.appendChild(badge);
    }

    el.appendChild(lbl); el.appendChild(sub); el.appendChild(val);

    // Delta for T-bill cards
    if (c.delta != null) {
      var d = document.createElement('div');
      d.className = 'fund-delta ' + (c.delta>0 ? 'fd-up' : c.delta<0 ? 'fd-dn' : '');
      d.textContent = sgn(c.delta)+c.delta+' bps vs prev';
      el.appendChild(d);
    }
    // Extra (SOFR volume)
    if (c.extra) {
      var ex = document.createElement('div');
      ex.className = 'fund-extra'; ex.textContent = c.extra;
      el.appendChild(ex);
    }
    if (c.date) {
      var dt = document.createElement('div');
      dt.className = 'fund-date'; dt.textContent = c.date;
      el.appendChild(dt);
    }

    grid.appendChild(el);
  });
}


// === SECTION 3 — FX CONVERTER ===================================
//
// Autocomplete text inputs (fuzzy match code + full name).
// Preset rows: 250K / 500K / 750K / 1M  |  5M / 10M / Custom
// Bidirectional rate display + trend badge vs prior close.

function getToUSD(ccy) {
  if (ccy==='USD') return 1;
  if (!cachedYahoo) return null;
  var key = FX_YAHOO_MAP[ccy]; if (!key) return null;
  var d = cachedYahoo[key]; if (!d||d.current==null) return null;
  return FX_INVERTED[ccy] ? 1/d.current : d.current;
}
function getToUSDPrior(ccy) {
  if (ccy==='USD') return 1;
  if (!cachedYahoo) return null;
  var key = FX_YAHOO_MAP[ccy]; if (!key) return null;
  var d = cachedYahoo[key]; if (!d||d.prior==null) return null;
  return FX_INVERTED[ccy] ? 1/d.prior : d.prior;
}

function initFxConverter() {
  var baseIn  = document.getElementById('fx-base');
  var quoteIn = document.getElementById('fx-quote');
  var amtIn   = document.getElementById('fx-amount');
  if (!baseIn || fxConverterReady) { computeFx(); return; }
  fxConverterReady = true;

  // Wire autocomplete dropdowns
  wireAutocomplete(baseIn,  document.getElementById('fx-base-list'));
  wireAutocomplete(quoteIn, document.getElementById('fx-quote-list'));

  var refresh = function() { computeFx(); };
  baseIn.addEventListener('change', refresh);
  quoteIn.addEventListener('change', refresh);
  amtIn.addEventListener('input', refresh);

  // Swap button
  document.getElementById('fx-swap').addEventListener('click', function() {
    var tmp = baseIn.value; baseIn.value = quoteIn.value; quoteIn.value = tmp;
    computeFx();
  });

  // Preset buttons (both rows)
  var presets = document.querySelectorAll('.fx-preset');
  presets.forEach(function(btn) {
    btn.addEventListener('click', function() {
      amtIn.value = btn.getAttribute('data-amount');
      presets.forEach(function(b){ b.classList.remove('fx-preset-active'); });
      btn.classList.add('fx-preset-active');
      computeFx();
    });
  });

  // Custom button — focus + select amount field
  var customBtn = document.getElementById('fx-custom-btn');
  if (customBtn) {
    customBtn.addEventListener('click', function() {
      presets.forEach(function(b){ b.classList.remove('fx-preset-active'); });
      customBtn.classList.add('fx-preset-active');
      amtIn.focus(); amtIn.select();
    });
    amtIn.addEventListener('focus', function() {
      presets.forEach(function(b){ b.classList.remove('fx-preset-active'); });
      customBtn.classList.add('fx-preset-active');
    });
  }

  computeFx();
}

function wireAutocomplete(input, listEl) {
  function render(filter) {
    var val = (filter||'').toUpperCase();
    var hits = FX_CURRENCIES.filter(function(c) {
      return !val
        || c.indexOf(val) === 0
        || (FX_NAMES[c]||'').toUpperCase().indexOf(val) !== -1;
    });
    if (!hits.length || (hits.length===1 && hits[0]===val)) {
      listEl.style.display='none'; return;
    }
    listEl.innerHTML = '';
    hits.forEach(function(c) {
      var row = document.createElement('div');
      row.className = 'fx-drop-item';
      var code = document.createElement('span'); code.className='fx-drop-code'; code.textContent=c;
      var name = document.createElement('span'); name.className='fx-drop-name'; name.textContent=FX_NAMES[c]||'';
      row.appendChild(code); row.appendChild(name);
      row.setAttribute('data-ccy', c);
      row.addEventListener('mousedown', function(e) {
        e.preventDefault(); input.value=c;
        listEl.style.display='none'; computeFx();
      });
      listEl.appendChild(row);
    });
    listEl.style.display='block';
  }

  input.addEventListener('focus', function(){ render(input.value); });
  input.addEventListener('input', function(){
    input.value = input.value.toUpperCase();
    render(input.value);
    // Recompute immediately when a valid 3-letter currency code is typed directly
    if (FX_CURRENCIES.indexOf(input.value) !== -1) computeFx();
  });
  input.addEventListener('blur',  function(){
    setTimeout(function(){
      listEl.style.display='none';
      if (FX_CURRENCIES.indexOf(input.value.toUpperCase()) === -1) input.value='USD';
      computeFx();
    }, 160);
  });
  input.addEventListener('keydown', function(e){
    if (e.key==='Enter'||e.key==='Tab'){ listEl.style.display='none'; computeFx(); }
    if (e.key==='Escape') listEl.style.display='none';
  });
}

function computeFx() {
  var amount  = parseFloat(document.getElementById('fx-amount').value);
  var base    = (document.getElementById('fx-base').value ||'').toUpperCase();
  var quote   = (document.getElementById('fx-quote').value||'').toUpperCase();

  var resEl   = document.getElementById('fx-result');
  var fwdEl   = document.getElementById('fx-rate-line');
  var revEl   = document.getElementById('fx-reverse-rate');
  var trendEl = document.getElementById('fx-rate-trend');
  if (!resEl) return;

  // Update the base-currency badge next to the amount input
  var badge = document.getElementById('fx-base-badge');
  if (badge && FX_CURRENCIES.indexOf(base) !== -1) badge.textContent = base;

  function clear(msg) {
    resEl.textContent=msg||'—';
    if(fwdEl)   fwdEl.textContent='';
    if(revEl)   revEl.textContent='';
    if(trendEl){ trendEl.textContent=''; trendEl.className='fx-trend'; }
  }

  if (isNaN(amount)||amount<=0) return clear('—');
  if (base===quote) {
    // Same currency: just echo with the currency code
    resEl.textContent = amount.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})+' '+quote;
    if(fwdEl) fwdEl.textContent='1:1'; if(revEl) revEl.textContent=''; return;
  }

  var bUSD = getToUSD(base), qUSD = getToUSD(quote);
  if (!bUSD||!qUSD) return clear('Rate unavailable');

  var cross  = bUSD / qUSD;
  var result = amount * cross;

  // Result: "1,234,567.89 EUR" — number + output currency code
  var newTxt = result.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})+' '+quote;
  if (resEl.textContent !== newTxt) {
    resEl.classList.remove('fx-flash'); void resEl.offsetWidth;
    resEl.classList.add('fx-flash'); resEl.textContent = newTxt;
  }

  // Exchange rate lines
  var dec  = cross    > 10 ? 2 : 4;
  var decR = 1/cross  > 10 ? 2 : 4;
  if (fwdEl) fwdEl.textContent = '1 '+base+' = '+cross.toFixed(dec)+' '+quote;
  if (revEl) revEl.textContent = '1 '+quote+' = '+(1/cross).toFixed(decR)+' '+base;

  // Trend vs prior close
  if (trendEl) {
    var bP=getToUSDPrior(base), qP=getToUSDPrior(quote);
    if (bP&&qP) {
      var priorCross = bP/qP;
      var chg = ((cross-priorCross)/priorCross)*100;
      trendEl.textContent = (chg>=0?'+':'')+chg.toFixed(2)+'% vs prev';
      trendEl.className = 'fx-trend fx-trend-'+(chg>0?'up':chg<0?'dn':'flat');
    } else { trendEl.textContent=''; trendEl.className='fx-trend'; }
  }
}


// === NEWS & INTELLIGENCE — WSJ only =============================
// Filters /api/news response to WSJ sources only.
// Falls back to localStorage cache (2 hr) on fetch failure.

var NEWS_REFRESH_MS_STORED = NEWS_REFRESH_MS; // keep ref

function formatTime(dateStr) {
  try {
    var d = new Date(dateStr);
    if (isNaN(d)) return '';
    var diff = Date.now() - d;
    if (diff < 60000)    return 'just now';
    if (diff < 3600000)  return Math.floor(diff / 60000) + 'm ago';
    if (diff < 86400000) return Math.floor(diff / 3600000) + 'h ago';
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  } catch(e) { return ''; }
}

function renderNews(items) {
  var feed    = document.getElementById('news-list');
  var counter = document.getElementById('news-count');
  var updLbl  = document.getElementById('news-updated-lbl');
  if (!feed) return;

  // Filter to WSJ sources only
  var wsj = (items || []).filter(function(item) {
    return item.source && item.source.indexOf('WSJ') === 0;
  });

  if (!wsj.length) {
    feed.innerHTML = '<div class="news-empty">No WSJ articles available.</div>';
    if (counter) counter.textContent = '';
    return;
  }

  var shown = wsj.slice(0, 10);
  if (counter) counter.textContent = wsj.length;
  if (updLbl && shown[0] && shown[0].date) updLbl.textContent = formatTime(shown[0].date);

  feed.innerHTML = '';
  shown.forEach(function(item) {
    var el = document.createElement('article');
    el.className = 'news-item';

    // Tag pill
    if (item.tag) {
      var tag = document.createElement('span');
      tag.className   = 'news-tag news-tag-' + item.tag.toUpperCase();
      tag.textContent = item.tag;
      el.appendChild(tag);
    }

    // Headline
    var title = document.createElement('div');
    title.className = 'news-title';
    if (item.link) {
      var a = document.createElement('a');
      a.href = item.link; a.target = '_blank'; a.rel = 'noopener';
      a.textContent = item.title;
      title.appendChild(a);
    } else {
      title.textContent = item.title;
    }
    el.appendChild(title);

    // Meta: source · time
    var meta = document.createElement('div');
    meta.className = 'news-meta';
    var parts = [];
    if (item.source) parts.push('<span class="news-source">' + item.source + '</span>');
    if (item.date)   parts.push('<span class="news-time">'   + formatTime(item.date) + '</span>');
    meta.innerHTML = parts.join('<span class="news-sep"> · </span>');
    el.appendChild(meta);

    feed.appendChild(el);
  });
}

function fetchNews() {
  if (WORKER_URL.indexOf('YOUR_') !== -1) return;
  fetch(WORKER_URL + '/api/news')
    .then(function(r) { if (!r.ok) throw new Error('news ' + r.status); return r.json(); })
    .then(function(data) {
      var items = (data && data.items) ? data.items : (Array.isArray(data) ? data : []);
      cacheData('news', items);
      renderNews(items);
    })
    .catch(function() {
      var cached = getCachedData('news', 7200000);
      if (cached) renderNews(cached);
    });
}


// === LIVE CATALYST — Bloomberg TV ===============================
// Lazy-injects a muted YouTube live iframe once on first render.
// The outer wrapper uses padding-top: 56.25% for 16:9 aspect ratio.

function initLiveStream() {
  if (liveStreamLoaded) return;
  var wrap = document.getElementById('catalyst-frame-wrap');
  if (!wrap) return;
  liveStreamLoaded = true;

  var iframe = document.createElement('iframe');
  iframe.src = 'https://www.youtube.com/embed/live_stream'
    + '?channel=UCIALMKvObZNtJ6AmdCLP7Lg'
    + '&autoplay=1&mute=1&playsinline=1&modestbranding=1&rel=0';
  iframe.title          = 'Bloomberg Television Live';
  iframe.loading        = 'lazy';
  iframe.allow          = 'autoplay; encrypted-media; picture-in-picture';
  iframe.allowFullscreen = true;
  wrap.innerHTML = '';
  wrap.appendChild(iframe);

  // Live-dot: green during market hours, dim otherwise
  var pip = document.getElementById('live-dot');
  if (pip) pip.className = 'live-indicator ' + (isOpen() ? 'live-on' : 'live-off');
}


function renderTicker(yahoo, fred) {
  var el = document.getElementById('ticker-content');
  if (!el) return;

  var chips = [];

  TICKER_ITEMS.forEach(function(item) {
    var valStr = '', chgStr = '', chgCls = '';

    if (item.src === 'yahoo') {
      var d = yahoo && yahoo[item.key];
      if (!d || d.current == null) return;
      valStr = item.prefix + d.current.toFixed(item.fmt) + item.suffix;
      var cp = pct(d.current, d.prior);
      if (cp != null) {
        chgCls = Math.abs(cp) < 0.005 ? 'tk-flat' : cp > 0 ? 'tk-up' : 'tk-dn';
        chgStr = (cp >= 0 ? '+' : '') + cp.toFixed(2) + '%';
      }
    } else {
      // FRED: show bps change (more natural for yields)
      var f = fred && fred[item.key];
      if (!f || f.current == null) return;
      valStr = item.prefix + f.current.toFixed(item.fmt) + item.suffix;
      var cb = bps(f.current, f.prior);
      if (cb != null) {
        chgCls = Math.abs(cb) < 1 ? 'tk-flat' : cb > 0 ? 'tk-up' : 'tk-dn';
        chgStr = (cb >= 0 ? '+' : '') + cb + ' bps';
      }
    }

    chips.push(
      '<span class="tk-item">'
      + '<span class="tk-lbl">' + item.label + '</span>'
      + '<span class="tk-val">' + valStr + '</span>'
      + (chgStr ? '<span class="tk-chg ' + chgCls + '">' + chgStr + '</span>' : '')
      + '</span>'
    );
  });

  if (!chips.length) return;
  // Duplicate content for seamless infinite scroll loop
  var single = chips.join('<span class="tk-sep">·</span>');
  el.innerHTML = single + '<span class="tk-sep">·</span>' + single;
}


// === HEADER =====================================================



function updateHeader(data) {
  var now = nowET();
  var el  = document.getElementById('header-meta');
  if (el) el.textContent =
    now.toLocaleDateString('en-US',{weekday:'short',month:'short',day:'numeric',year:'numeric'})
    + '  ·  '
    + now.toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit',hour12:true}) + ' ET';

  var ms = document.getElementById('market-status');
  if (ms) {
    var open = isOpen();
    ms.textContent = open ? 'MARKET OPEN' : 'CLOSED';
    ms.className   = 'mkt-badge mkt-' + (open ? 'open' : 'closed');
  }

  if (data && data.fomc && data.fomc.next) {
    var fb = document.getElementById('fomc-badge');
    if (fb) {
      fb.textContent = 'FOMC '+data.fomc.daysAway+'d';
      fb.className   = 'fomc-badge' + (data.fomc.daysAway<=7 ? ' fomc-imminent' : '');
      fb.title       = 'Next FOMC: '+data.fomc.next;
    }
  }
}


// === MAIN RENDER ================================================



function renderDashboard(data) {
  updateHeader(data);

  var alerts = computeAlerts(data);
  renderAlerts(alerts);

  cachedYahoo = data.yahoo;
  cachedFred  = data.fred;
  cacheData('market', data);

  // Section 1: Treasury Yields
  renderYieldsSection(data.fred, data.yieldsHist || {});

  // Section 2: Funding & Liquidity
  renderFunding(data.nyfed, data.fred);

  // Section 3: FX Converter
  initFxConverter();

  // Market ticker (top strip)
  renderTicker(data.yahoo, data.fred);

  // Live Catalyst (lazy — injected once)
  initLiveStream();

  // News — show cached immediately; live fetch runs on separate timer
  var cachedNews = getCachedData('news', 7200000);
  if (cachedNews) renderNews(cachedNews);


  // Show dashboard
  document.getElementById('loading').style.display   = 'none';
  document.getElementById('dashboard').style.display = 'flex';
}


// === DATA FETCHING ==============================================



function fetchData() {
  if (WORKER_URL.indexOf('YOUR_') !== -1) {
    document.getElementById('loading').style.display   = 'none';
    document.getElementById('setup-banner').style.display = 'block';
    return;
  }
  beginFetch();
  fetch(WORKER_URL + '/api/market-data')
    .then(function(r) { if (!r.ok) throw new Error('HTTP '+r.status); return r.json(); })
    .then(function(data) {
      fetchRetryCount = 0;
      tickerBackoff   = isOpen() ? TICKER_REFRESH_MS : TICKER_REFRESH_SLOW;
      lastRefreshTime = Date.now();
      renderDashboard(data);
      updateAgo();
    })
    .catch(function(err) {
      fetchRetryCount++;
      var cached = getCachedData('market', 3600000);
      if (cached) { try { renderDashboard(cached); } catch(e){} return; }
      var el = document.getElementById('loading');
      if (el) {
        el.style.display = 'flex';  // restore visibility (hidden in init)
        el.innerHTML = '<div class="load-err">Failed to load: '+err.message+'<br><small>Press R to retry.</small></div>';
      }
    })
    .finally(endFetch);
}

// Lightweight ticker refresh — keeps FX converter rates fresh
function tickerRefresh() {
  if (WORKER_URL.indexOf('YOUR_') !== -1) return;
  fetch(WORKER_URL + '/api/ticker')
    .then(function(r){ if (!r.ok) throw new Error(r.status); return r.json(); })
    .then(function(data){
      cachedYahoo   = Object.assign(cachedYahoo||{}, data.yahoo);
      tickerBackoff = isOpen() ? TICKER_REFRESH_MS : TICKER_REFRESH_SLOW;
      // Update top ticker strip with fresh Yahoo prices
      renderTicker(cachedYahoo, cachedFred);
      // Recompute FX if converter is visible
      if (fxConverterReady) computeFx();
    })
    .catch(function(){ tickerBackoff = Math.min(tickerBackoff*1.5, 60000); })
    .finally(function(){
      clearTimeout(tickerTimer);
      tickerTimer = setTimeout(tickerRefresh, tickerBackoff);
    });
}




function beginFetch() { fetchInFlight++; var b=document.getElementById('btn-refresh'); if(b) b.classList.add('spinning'); }
function endFetch()   { fetchInFlight=Math.max(0,fetchInFlight-1); if(!fetchInFlight){ var b=document.getElementById('btn-refresh'); if(b) b.classList.remove('spinning'); } }

function updateAgo() {
  if (!lastRefreshTime) return;
  var s   = Math.round((Date.now()-lastRefreshTime)/1000);
  var lbl = s<60 ? s+'s ago' : Math.floor(s/60)+'m ago';
  var el  = document.getElementById('updated-ago');
  if (!el) { el=document.createElement('span'); el.id='updated-ago'; var m=document.getElementById('header-meta'); if(m) m.appendChild(el); }
  el.textContent = '  ·  '+lbl;
}

function initNotes() {
  var panel = document.getElementById('notes-panel');
  var ta    = document.getElementById('notes-text');
  ta.value  = localStorage.getItem('td_notes')||'';
  var t=null;
  ta.addEventListener('input', function(){
    clearTimeout(t); t=setTimeout(function(){
      localStorage.setItem('td_notes',ta.value);
      var m=document.getElementById('notes-saved'); m.textContent='Saved';
      setTimeout(function(){m.textContent='';},1500);
    },500);
  });
  document.getElementById('notes-close').addEventListener('click',  function(){ panel.style.display='none'; });
  document.getElementById('notes-clear').addEventListener('click',  function(){ if(confirm('Clear notes?')){ ta.value=''; localStorage.removeItem('td_notes'); } });
  document.getElementById('btn-notes'  ).addEventListener('click',  function(){ panel.style.display = panel.style.display==='none'?'block':'none'; if(panel.style.display==='block') ta.focus(); });
}

function initShortcuts() {
  document.addEventListener('keydown', function(e) {
    if (e.target.tagName==='INPUT'||e.target.tagName==='TEXTAREA') {
      if (e.key==='Escape') e.target.blur(); return;
    }
    var modal = document.getElementById('shortcuts-modal');
    if (e.key==='Escape'){ modal.style.display='none'; document.getElementById('notes-panel').style.display='none'; return; }
    if (e.key==='?'||e.key==='/'){ e.preventDefault(); modal.style.display=modal.style.display==='none'?'flex':'none'; return; }
    if ((e.key==='r'||e.key==='R')&&!e.ctrlKey){ e.preventDefault(); if(Date.now()-lastManualRefresh<3000) return; lastManualRefresh=Date.now(); fetchData(); return; }
    if (e.key==='j'||e.key==='J'){ e.preventDefault(); var np=document.getElementById('notes-panel'); np.style.display=np.style.display==='none'?'block':'none'; if(np.style.display==='block') document.getElementById('notes-text').focus(); return; }
  });
  document.getElementById('btn-refresh'  ).addEventListener('click', function(){ if(Date.now()-lastManualRefresh<3000) return; lastManualRefresh=Date.now(); fetchData(); });
  document.getElementById('btn-shortcuts').addEventListener('click', function(){ var m=document.getElementById('shortcuts-modal'); m.style.display=m.style.display==='none'?'flex':'none'; });
  document.getElementById('modal-close'  ).addEventListener('click', function(){ document.getElementById('shortcuts-modal').style.display='none'; });
  document.getElementById('shortcuts-modal').addEventListener('click', function(e){ if(e.target===this) this.style.display='none'; });
}


// === INIT =======================================================

document.getElementById('dashboard').style.display = 'flex';
document.getElementById('loading').style.display   = 'none';
updateHeader(null);
initLiveStream();
initFxConverter();
var cached = getCachedData('market', 600000);
if (cached) { try { renderDashboard(cached); } catch(e) {} }

fetchData();
fetchNews();
refreshTimer = setInterval(fetchData, REFRESH_MS);
newsTimer    = setInterval(fetchNews, NEWS_REFRESH_MS);
tickerTimer  = setTimeout(tickerRefresh, tickerBackoff);
initShortcuts();
initNotes();
setInterval(updateAgo, 10000);
