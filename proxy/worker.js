/**
 * Treasury Intelligence Dashboard -- Cloudflare Worker Proxy
 *
 * Endpoints:
 *   GET /api/market-data  -- Yahoo Finance + FRED + NY Fed + macro indicators
 *   GET /api/ticker       -- Lightweight: 9 Yahoo symbols only (10s ticker refresh)
 *   GET /api/news         -- All RSS feeds (Fed, ECB, CNBC, WSJ, Reuters, MarketWatch, Yahoo, Seeking Alpha)
 *   GET /                 -- Health check
 *
 * Secrets (set via `npx wrangler secret put <n>`):
 *   FRED_API_KEY          -- required for yields, macro, credit spreads
 *   NEWSAPI_KEY           -- optional, enhances news feed
 *
 * Deploy:  npx wrangler deploy
 */

// ============================================
// CONFIGURATION
// ============================================

var YAHOO_SYMBOLS = [
  // Equities (S&P 500 only — DOW/NASDAQ/RUSSELL not used by frontend)
  { key: 'SP500',   symbol: '%5EGSPC',     group: 'equities' },
  // Commodities (WTI, Gold for ticker; Brent/NatGas/HeatOil for energy alerts)
  { key: 'WTI',     symbol: 'CL%3DF',     group: 'commodities' },
  { key: 'Brent',   symbol: 'BZ%3DF',     group: 'commodities' },
  { key: 'NatGas',  symbol: 'NG%3DF',     group: 'commodities' },
  { key: 'HeatOil', symbol: 'HO%3DF',     group: 'commodities' },
  { key: 'Gold',    symbol: 'GC%3DF',     group: 'commodities' },
  // Forex (expanded for treasury FX converter — all 15 pairs)
  { key: 'EURUSD',  symbol: 'EURUSD%3DX', group: 'forex' },
  { key: 'GBPUSD',  symbol: 'GBPUSD%3DX', group: 'forex' },
  { key: 'USDJPY',  symbol: 'JPY%3DX',    group: 'forex' },
  { key: 'AUDUSD',  symbol: 'AUDUSD%3DX', group: 'forex' },
  { key: 'USDCAD',  symbol: 'USDCAD%3DX', group: 'forex' },
  { key: 'USDCHF',  symbol: 'USDCHF%3DX', group: 'forex' },
  { key: 'USDCNH',  symbol: 'USDCNH%3DX', group: 'forex' },
  { key: 'NZDUSD',  symbol: 'NZDUSD%3DX', group: 'forex' },
  { key: 'USDMXN',  symbol: 'USDMXN%3DX', group: 'forex' },
  { key: 'USDBRL',  symbol: 'USDBRL%3DX', group: 'forex' },
  { key: 'USDSGD',  symbol: 'USDSGD%3DX', group: 'forex' },
  { key: 'USDHKD',  symbol: 'USDHKD%3DX', group: 'forex' },
  { key: 'USDINR',  symbol: 'USDINR%3DX', group: 'forex' },
  { key: 'USDSEK',  symbol: 'USDSEK%3DX', group: 'forex' },
  { key: 'USDNOK',  symbol: 'USDNOK%3DX', group: 'forex' },
  // Risk indicators
  { key: 'DXY',     symbol: 'DX-Y.NYB',   group: 'risk' },
  { key: 'VIX',     symbol: '%5EVIX',     group: 'risk' },
];

// Lightweight ticker list -- /api/ticker only (10s refresh)
// Keeps frequent ticker refresh fast: 12 symbols, no FRED/NY Fed overhead
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

var FRED_MARKET = [
  { id: 'DGS1MO', label: '1M UST',  extra: '' },
  { id: 'DGS3MO', label: '3M UST',  extra: '' },
  { id: 'DGS6MO', label: '6M UST',  extra: '' },
  { id: 'DGS1',   label: '1Y UST',  extra: '' },
  { id: 'DGS2',   label: '2Y UST',  extra: '' },
  { id: 'DGS10',  label: '10Y UST', extra: '' },
  { id: 'BAMLC0A0CM',   label: 'IG OAS',       extra: '' },
  { id: 'SOFR',          label: 'SOFR',         extra: '' },
  { id: 'EFFR',          label: 'EFFR',         extra: '' },
  { id: 'SOFR30DAYAVG',  label: 'SOFR 30D Avg', extra: '' },
];

// Short-term yields for grouped bar chart (T-1, T-7, T-14)
var FRED_YIELDS_HIST = [
  { id: 'DGS1MO', label: '1M UST' },
  { id: 'DGS3MO', label: '3M UST' },
  { id: 'DGS6MO', label: '6M UST' },
];

var FRED_MACRO = [
  { id: 'FEDFUNDS',        label: 'Fed Funds Rate', extra: '' },
  { id: 'CPIAUCSL',        label: 'CPI YoY',       extra: '&units=pc1' },
  { id: 'CPILFESL',        label: 'Core CPI YoY',  extra: '&units=pc1' },
  { id: 'PPIACO',          label: 'PPI YoY',        extra: '&units=pc1' },
  { id: 'UNRATE',          label: 'Unemployment',   extra: '' },
  { id: 'ICSA',            label: 'Initial Claims', extra: '' },
  { id: 'A191RL1Q225SBEA', label: 'Real GDP',       extra: '' },
  { id: 'WM2NS',           label: 'M2 YoY',        extra: '&units=pc1' },
];

// FOMC 2026 decision dates (end-of-meeting day)
var FOMC_2026 = [
  '2026-01-29', '2026-03-19', '2026-04-30', '2026-06-18',
  '2026-07-30', '2026-09-17', '2026-11-05', '2026-12-17',
];

// ============================================
// WSJ RSS FEEDS  (fetched separately via fetchWSJFeed)
//
// Three target categories per spec:
//   MARKETS  — RSSMarketsMain.xml  (equity, bond, commodities markets)
//   ECONOMY  — RSSBusiness.xml     (macro, trade, employment, GDP)
//   USNEWS   — WSJcomUSBusiness.xml (broader US business/political economy)
//
// feeds.a.dj.com occasionally rate-limits Cloudflare Worker IPs.
// Each feed is fetched independently so a single failure doesn't
// block the others, and the 10-min cache means most requests
// are served from cache rather than hitting WSJ servers directly.
// ============================================
var WSJ_FEEDS = [
  {
    url:      'https://feeds.a.dj.com/rss/RSSMarketsMain.xml',
    source:   'WSJ Markets',
    category: 'MARKETS',
  },
  {
    url:      'https://feeds.a.dj.com/rss/RSSBusiness.xml',
    source:   'WSJ Economy',
    category: 'ECONOMY',
  },
  {
    url:      'https://feeds.a.dj.com/rss/WSJcomUSBusiness.xml',
    source:   'WSJ US News',
    category: 'USNEWS',
  },
];

var RSS_FEEDS = [
  // ── Government / Central Bank (always pinned, never keyword-filtered) ──────
  { url: 'https://www.federalreserve.gov/feeds/press_monetary.xml', source: 'Federal Reserve', tag: 'FED',     isGov: true  },
  { url: 'https://www.federalreserve.gov/feeds/press_bcreg.xml',    source: 'Fed Banking',     tag: 'FED',     isGov: true  },
  { url: 'https://www.federalreserve.gov/feeds/press_other.xml',    source: 'Fed Other',       tag: 'FED',     isGov: true  },
  { url: 'https://www.ecb.europa.eu/rss/press.html',                source: 'ECB',             tag: 'FED',     isGov: true  },
  // ── Reuters (two endpoints — general business + financial markets) ───────────
  { url: 'https://feeds.reuters.com/reuters/businessNews',          source: 'Reuters',         tag: 'MARKETS', isGov: false },
  { url: 'https://feeds.reuters.com/reuters/financialMarketsNews',  source: 'Reuters Markets', tag: 'MARKETS', isGov: false },
  // ── CNBC (markets, economy, finance — all three IDs) ────────────────────────
  { url: 'https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=20910258', source: 'CNBC',         tag: 'MARKETS', isGov: false },
  { url: 'https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=15839135', source: 'CNBC Economy', tag: 'ECONOMY', isGov: false },
  { url: 'https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=56503479', source: 'CNBC Finance', tag: 'MARKETS', isGov: false },
  // ── Yahoo Finance ────────────────────────────────────────────────────────────
  { url: 'https://finance.yahoo.com/rss/topstories',               source: 'Yahoo Finance',   tag: 'MARKETS', isGov: false },
  // ── MarketWatch (updated path — old /topstories returns 403) ────────────────
  { url: 'https://feeds.marketwatch.com/marketwatch/marketpulse',  source: 'MarketWatch',     tag: 'MARKETS', isGov: false },
  // ── Financial Times US edition ───────────────────────────────────────────────
  { url: 'https://www.ft.com/rss/home/us',                         source: 'Financial Times', tag: 'MARKETS', isGov: false },
  // ── Investopedia (reliable; good for rates + macro context) ─────────────────
  { url: 'https://www.investopedia.com/feedbuilder/feed/getfeed/?feedName=rss_headline', source: 'Investopedia', tag: 'MARKETS', isGov: false },
];

var CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '86400',
};

// ============================================
// MAIN HANDLER
// ============================================

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: CORS });
    }
    var url = new URL(request.url);
    try {
      if (url.pathname === '/api/market-data') return await handleMarketData(env);
      if (url.pathname === '/api/ticker')      return await handleTicker();
      if (url.pathname === '/api/news')        return await handleNews(env);
      if (url.pathname === '/api/calendar')          return await handleCalendar(env);
      if (url.pathname === '/api/calendar-snapshot') return await handleCalendarSnapshot(env);
      if (url.pathname === '/') return jsonResp({
        status: 'ok',
        endpoints: ['/api/market-data', '/api/ticker', '/api/news', '/api/calendar', '/api/calendar-snapshot'],
        fred_key_set: !!(env.FRED_API_KEY),
        te_key_set: !!(env.TRADING_ECONOMICS_KEY),
      });
      return new Response('Not found', { status: 404, headers: CORS });
    } catch (err) {
      return jsonResp({ error: err.message }, 500);
    }
  },
};

function jsonResp(data, status) {
  return new Response(JSON.stringify(data), {
    status: status || 200,
    headers: Object.assign({}, CORS, {
      'Content-Type': 'application/json',
      'Cache-Control': 'public, max-age=8',
    }),
  });
}

// ============================================
// /api/market-data  (original -- untouched)
// ============================================

async function handleMarketData(env) {
  var fredKey = env.FRED_API_KEY || '';

  // ── Phase 1: fire all market-data fetches in parallel ─────────
  // Count: 40 Yahoo + 17 FRED_MARKET + 8 FRED_MACRO + 3 NY Fed = 68 subrequests.
  // Cloudflare Workers free tier caps concurrent subrequests at 50; paid at 1000.
  // fetchYieldHistory (3 FRED calls) is sequenced AFTER Phase 1 completes so its
  // requests are never part of the 68-way simultaneous burst.
  var results = await Promise.all([
    fetchAllYahoo(),
    fetchAllFRED(FRED_MARKET, fredKey),
    fetchAllFRED(FRED_MACRO, fredKey),
    fetchAllNYFed(),
  ]);

  var yahoo      = results[0];
  var fredMarket = results[1];
  var fredMacro  = results[2];
  var nyfed      = results[3];

  // ── Phase 2: historical yield series (separate — avoids subrequest cap) ──
  var yieldsHist = await fetchYieldHistory(fredKey);

  // Fallback: if NY Fed API is blocked, use FRED SOFR/EFFR series
  if (!nyfed.sofr.rate && fredMarket.SOFR && fredMarket.SOFR.current != null) {
    nyfed.sofr = { rate: fredMarket.SOFR.current, date: fredMarket.SOFR.date, volume: null };
  }
  if (!nyfed.effr.rate && fredMarket.EFFR && fredMarket.EFFR.current != null) {
    nyfed.effr = { rate: fredMarket.EFFR.current, date: fredMarket.EFFR.date, volume: null };
  }

  // Compute next FOMC
  var now = new Date();
  var todayStr = now.toISOString().split('T')[0];
  var nextFomc = null;
  var fomcDays = null;
  for (var i = 0; i < FOMC_2026.length; i++) {
    if (FOMC_2026[i] >= todayStr) {
      nextFomc = FOMC_2026[i];
      fomcDays = Math.ceil((new Date(FOMC_2026[i] + 'T20:00:00Z') - now) / 86400000);
      break;
    }
  }

  return jsonResp({
    timestamp: now.toISOString(),
    fred_key_set: !!(fredKey),   // diagnostic: visible in DevTools Network tab
    yahoo: yahoo,
    fred: fredMarket,
    macro: fredMacro,
    nyfed: nyfed,
    yieldsHist: yieldsHist,
    fomc: {
      next: nextFomc,
      daysAway: fomcDays,
      dates: FOMC_2026,
    },
  });
}

// ============================================
// /api/ticker  (new -- lightweight, 10s refresh)
// Only 12 Yahoo symbols, no FRED or NY Fed overhead
// ============================================

async function handleTicker() {
  var results = await Promise.all(TICKER_SYMBOLS_WORKER.map(fetchYahooSymbol));
  var yahoo = {};
  for (var i = 0; i < results.length; i++) {
    var r = results[i];
    yahoo[r.key] = { current: r.current, prior: r.prior, date: r.date, group: r.group };
  }
  return jsonResp({ timestamp: new Date().toISOString(), yahoo: yahoo });
}

// ============================================
// /api/news  (original -- untouched)
// ============================================

// ============================================
// /api/news  — WSJ (Economy + Markets + US News) + Gov + Wire
//
// Cache strategy (Cloudflare Cache API):
//   - First check caches.default for a cached response (10 min TTL)
//   - On miss: fetch all feeds, build response, store in cache
//   - Cache key is a synthetic URL independent of the real request URL
//
// Fault tolerance:
//   - Each feed fetched independently; failures return []
//   - If ALL WSJ feeds fail: other sources still populate the feed
//   - If entire fetch fails: caller falls back to 2hr localStorage cache
// ============================================

var NEWS_CACHE_TTL = 420;   // 7 minutes
var NEWS_CACHE_KEY = 'https://treasury-news-v4.cache/api/news';  // v4: rss2json proxy fix

async function handleNews(env) {
  // ── 1. Check Cloudflare edge cache ──────────────────────────
  var cache = caches.default;
  try {
    var cacheReq = new Request(NEWS_CACHE_KEY);
    var hit = await cache.match(cacheReq);
    if (hit) {
      // Re-attach CORS headers (may not be preserved in cache storage)
      var body     = await hit.text();
      var headers  = Object.assign({}, CORS, {
        'Content-Type':  'application/json',
        'Cache-Control': 'public, max-age=' + NEWS_CACHE_TTL,
        'X-Cache':       'HIT',
      });
      return new Response(body, { status: 200, headers: headers });
    }
  } catch (e) { /* cache API unavailable — fall through to fetch */ }

  // ── 2. Fetch all news sources in parallel ───────────────────
  var allItems = [];

  // WSJ (Economy · Markets · US News) — primary source per spec
  try {
    var wsjItems = await fetchAllWSJ();
    allItems = allItems.concat(wsjItems);
  } catch (e) { /* all WSJ failed — continue with other sources */ }

  // Government / wire feeds (Fed, ECB, Reuters, MarketWatch, CNBC, Yahoo)
  var rssResults = await Promise.all(RSS_FEEDS.map(function(feed) {
    return fetchRSS(feed.url, feed.source, feed.tag, feed.isGov);
  }));
  for (var i = 0; i < rssResults.length; i++) {
    allItems = allItems.concat(rssResults[i]);
  }

  // Optional NewsAPI enhancement (uses NEWSAPI_KEY secret)
  var newsapiKey = env.NEWSAPI_KEY || '';
  if (newsapiKey) {
    try {
      var naItems = await fetchNewsAPI(newsapiKey);
      allItems = allItems.concat(naItems);
    } catch (e) { /* continue with RSS only */ }
  }

  // ── 3. Age filter: drop items older than 72 h ───────────────
  var cutoff = Date.now() - (72 * 60 * 60 * 1000);
  allItems = allItems.filter(function(item) {
    if (!item.date) return true;
    var d = new Date(item.date);
    return isNaN(d.getTime()) || d.getTime() >= cutoff;
  });

  // ── 4. Relevance filter (non-gov only) ──────────────────────
  var FIN_KEYWORDS = [
    'fed','fomc','rate','yield','bond','treasury','inflation','cpi','ppi','pce',
    'gdp','economy','economic','market','stock','equity','dollar','currency','forex',
    'oil','crude','energy','commodity','gold','silver','copper','trade','tariff',
    'bank','credit','debt','deficit','fiscal','monetary','employment','jobs','payroll',
    'recession','growth','output','spending','budget','opec','ecb','boe','boj',
    'interest','spread','liquidity','repo','sofr','effr','rrp','mbs','mortgage',
    'earnings','revenue','profit','loss','quarter','annual','guidance',
    'invest','capital','financ','fund','hedge','merger','acquisition','ipo',
    'wall street','sanction','deal','shares','investor','asset','portfolio',
    'volatil','downturn','rally','selloff','correction','bull','bear','risk'
  ];
  allItems = allItems.filter(function(item) {
    if (item.isGov) return true;
    var text = (item.title + ' ' + (item.summary || '')).toLowerCase();
    for (var k = 0; k < FIN_KEYWORDS.length; k++) {
      if (text.indexOf(FIN_KEYWORDS[k]) !== -1) return true;
    }
    return false;
  });

  // ── 5. Deduplicate by normalised title ──────────────────────
  var seen = {};
  var deduped = [];
  for (var d = 0; d < allItems.length; d++) {
    var norm = allItems[d].title.toLowerCase().replace(/[^a-z0-9]/g, '').substring(0, 60);
    if (!seen[norm]) { seen[norm] = true; deduped.push(allItems[d]); }
  }

  // ── 6. Sort: recent gov pinned first, then descending pubDate ─
  var sixHoursAgo = Date.now() - (6 * 60 * 60 * 1000);
  deduped.sort(function(a, b) {
    var aPin = a.isGov && new Date(a.date || 0).getTime() > sixHoursAgo;
    var bPin = b.isGov && new Date(b.date || 0).getTime() > sixHoursAgo;
    if (aPin && !bPin) return -1;
    if (!aPin && bPin) return  1;
    return new Date(b.date || 0) - new Date(a.date || 0);
  });
  deduped = deduped.slice(0, 50);

  // ── 7. Build response, store in edge cache ───────────────────
  // Per-source item counts — visible in DevTools Network → /api/news → Response
  var sourceCounts = {};
  for (var sc = 0; sc < deduped.length; sc++) {
    var src = deduped[sc].source || 'Unknown';
    sourceCounts[src] = (sourceCounts[src] || 0) + 1;
  }

  var payload = JSON.stringify({
    timestamp: new Date().toISOString(),
    total: deduped.length,
    wsj_count: deduped.filter(function(i){ return i.source && i.source.indexOf('WSJ') === 0; }).length,
    source_counts: sourceCounts,
    items: deduped,
  });

  var respHeaders = Object.assign({}, CORS, {
    'Content-Type':  'application/json',
    'Cache-Control': 'public, max-age=' + NEWS_CACHE_TTL,
    'X-Cache':       'MISS',
  });

  // Store in Cloudflare's edge cache (TTL driven by Cache-Control header)
  try {
    var cacheableResp = new Response(payload, {
      status:  200,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=' + NEWS_CACHE_TTL },
    });
    await cache.put(new Request(NEWS_CACHE_KEY), cacheableResp);
  } catch (e) { /* cache write failed — non-fatal */ }

  return new Response(payload, { status: 200, headers: respHeaders });
}

// ============================================
// /api/calendar — Trading Economics Economic Calendar
//
// Proxies the Trading Economics calendar API server-side so:
//   1. API key stays secret (not in client JS)
//   2. No CORS issues (TE API doesn't allow browser origins)
//
// Secret: TRADING_ECONOMICS_KEY (set via `npx wrangler secret put TRADING_ECONOMICS_KEY`)
//
// Returns: { events: [...], count: N, te_key_set: bool }
// If no key: returns { events: [], count: 0, te_key_set: false }
// ============================================

var CALENDAR_CACHE_TTL = 600;  // 10 minutes
var CALENDAR_CACHE_KEY = 'https://treasury-econcal-v1.cache/api/calendar';

async function handleCalendar(env) {
  var teKey = env.TRADING_ECONOMICS_KEY || '';

  // No key — return clean empty response (frontend shows fallback state)
  if (!teKey) {
    return jsonResp({ events: [], count: 0, te_key_set: false });
  }

  // ── Check Cloudflare edge cache ────────────────────────────────
  var cache = caches.default;
  try {
    var cacheReq = new Request(CALENDAR_CACHE_KEY);
    var hit = await cache.match(cacheReq);
    if (hit) {
      var body = await hit.text();
      var headers = Object.assign({}, CORS, {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=' + CALENDAR_CACHE_TTL,
        'X-Cache': 'HIT',
      });
      return new Response(body, { status: 200, headers: headers });
    }
  } catch (e) { /* cache API unavailable — fall through */ }

  // ── Fetch from Trading Economics ───────────────────────────────
  try {
    var today = new Date().toISOString().split('T')[0];
    // Get 3 days of events (today + next 2 days) for a useful forward view
    var endDate = new Date(Date.now() + 2 * 86400000).toISOString().split('T')[0];
    var teUrl = 'https://api.tradingeconomics.com/calendar/country/united%20states/'
      + today + '/' + endDate + '?c=' + teKey + '&f=json';

    console.log('[calendar] fetching TE API: ' + today + ' to ' + endDate);
    var resp = await fetch(teUrl, {
      headers: { 'Accept': 'application/json' },
    });

    if (!resp.ok) {
      console.error('[calendar] TE API HTTP ' + resp.status);
      return jsonResp({ events: [], count: 0, te_key_set: true, error: 'te_http_' + resp.status });
    }

    var raw = await resp.json();
    if (!Array.isArray(raw)) {
      console.error('[calendar] TE API unexpected response shape');
      return jsonResp({ events: [], count: 0, te_key_set: true, error: 'bad_shape' });
    }

    // Filter to medium/high importance (2 = medium, 3 = high)
    var filtered = raw.filter(function(e) {
      return (e.Importance || 0) >= 2;
    });

    // Sort by date ascending
    filtered.sort(function(a, b) {
      return new Date(a.Date || 0) - new Date(b.Date || 0);
    });

    console.log('[calendar] TE returned ' + raw.length + ' raw → ' + filtered.length + ' filtered (importance ≥ 2)');

    var payload = JSON.stringify({
      timestamp: new Date().toISOString(),
      events: filtered,
      count: filtered.length,
      te_key_set: true,
    });

    var respHeaders = Object.assign({}, CORS, {
      'Content-Type': 'application/json',
      'Cache-Control': 'public, max-age=' + CALENDAR_CACHE_TTL,
      'X-Cache': 'MISS',
    });

    // Store in edge cache
    try {
      var cacheableResp = new Response(payload, {
        status: 200,
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=' + CALENDAR_CACHE_TTL },
      });
      await cache.put(new Request(CALENDAR_CACHE_KEY), cacheableResp);
    } catch (e) { /* cache write failed — non-fatal */ }

    return new Response(payload, { status: 200, headers: respHeaders });

  } catch (e) {
    console.error('[calendar] exception: ' + e.message);
    return jsonResp({ events: [], count: 0, te_key_set: true, error: e.message }, 500);
  }
}


// ============================================
// /api/calendar-snapshot — Recently released economic data
//
// Uses TE /calendar/updates endpoint for "just released" events.
// Short cache (2 min) since this is real-time signal data.
// Frontend uses this ONLY for alert-banner items, not a table.
// ============================================

var SNAPSHOT_CACHE_TTL = 120;  // 2 minutes
var SNAPSHOT_CACHE_KEY = 'https://treasury-econcal-snap-v1.cache/api/calendar-snapshot';

async function handleCalendarSnapshot(env) {
  var teKey = env.TRADING_ECONOMICS_KEY || '';
  if (!teKey) {
    return jsonResp({ releases: [], count: 0, te_key_set: false });
  }

  // ── Check edge cache ──────────────────────────────────────────
  var cache = caches.default;
  try {
    var hit = await cache.match(new Request(SNAPSHOT_CACHE_KEY));
    if (hit) {
      var body = await hit.text();
      return new Response(body, { status: 200, headers: Object.assign({}, CORS, {
        'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=' + SNAPSHOT_CACHE_TTL, 'X-Cache': 'HIT',
      })});
    }
  } catch (e) {}

  // ── Fetch recent updates from TE ──────────────────────────────
  try {
    var teUrl = 'https://api.tradingeconomics.com/calendar/updates?c=' + teKey + '&f=json';
    var resp = await fetch(teUrl, { headers: { 'Accept': 'application/json' } });
    if (!resp.ok) {
      return jsonResp({ releases: [], count: 0, te_key_set: true, error: 'te_http_' + resp.status });
    }

    var raw = await resp.json();
    if (!Array.isArray(raw)) raw = [];

    // Filter: US only, importance >= 2, has Actual value, released within last 60 min
    var cutoff = Date.now() - 60 * 60 * 1000;
    var releases = raw.filter(function(e) {
      if (!e.Country || e.Country !== 'United States') return false;
      if ((e.Importance || 0) < 2) return false;
      if (e.Actual == null || e.Actual === '') return false;
      var d = new Date(e.Date || 0);
      return !isNaN(d.getTime()) && d.getTime() >= cutoff;
    });

    releases.sort(function(a, b) { return new Date(b.Date) - new Date(a.Date); });
    releases = releases.slice(0, 5);

    console.log('[snapshot] TE updates: ' + raw.length + ' raw → ' + releases.length + ' US releases (last 60 min)');

    var payload = JSON.stringify({
      timestamp: new Date().toISOString(),
      releases: releases,
      count: releases.length,
      te_key_set: true,
    });

    var headers = Object.assign({}, CORS, {
      'Content-Type': 'application/json',
      'Cache-Control': 'public, max-age=' + SNAPSHOT_CACHE_TTL,
      'X-Cache': 'MISS',
    });

    try {
      await cache.put(new Request(SNAPSHOT_CACHE_KEY), new Response(payload, {
        status: 200, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=' + SNAPSHOT_CACHE_TTL },
      }));
    } catch (e) {}

    return new Response(payload, { status: 200, headers: headers });
  } catch (e) {
    console.error('[snapshot] exception: ' + e.message);
    return jsonResp({ releases: [], count: 0, te_key_set: true, error: e.message }, 500);
  }
}


// ============================================
// YAHOO FINANCE  (original -- untouched)
// ============================================

async function fetchYahooSymbol(sym) {
  try {
    var url = 'https://query1.finance.yahoo.com/v8/finance/chart/' + sym.symbol + '?range=5d&interval=1d';
    var resp = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    var data = await resp.json();
    var result = data.chart.result[0];
    var ts = result.timestamp;
    var closes = result.indicators.quote[0].close;
    if (ts && closes && ts.length >= 2) {
      // Walk backwards to find last non-null close (Yahoo returns null for incomplete days)
      var lastIdx = -1;
      for (var j = closes.length - 1; j >= 0; j--) {
        if (closes[j] != null) { lastIdx = j; break; }
      }
      if (lastIdx >= 1) {
        var priorIdx = -1;
        for (var j2 = lastIdx - 1; j2 >= 0; j2--) {
          if (closes[j2] != null) { priorIdx = j2; break; }
        }
        var dateStr = new Date(ts[lastIdx] * 1000).toISOString().split('T')[0];
        return { key: sym.key, current: closes[lastIdx], prior: priorIdx >= 0 ? closes[priorIdx] : null, date: dateStr, group: sym.group };
      }
    }
  } catch (e) { /* fall through */ }
  return { key: sym.key, current: null, prior: null, date: null, group: sym.group };
}

async function fetchAllYahoo() {
  var results = await Promise.all(YAHOO_SYMBOLS.map(fetchYahooSymbol));
  var out = {};
  for (var i = 0; i < results.length; i++) {
    var r = results[i];
    out[r.key] = { current: r.current, prior: r.prior, date: r.date, group: r.group };
  }
  return out;
}

// ============================================
// FRED API  (original -- untouched)
// ============================================

async function fetchFREDSeries(series, apiKey) {
  if (!apiKey) return { id: series.id, current: null, prior: null, date: null, label: series.label };
  try {
    var url = 'https://api.stlouisfed.org/fred/series/observations'
      + '?series_id=' + series.id + '&api_key=' + apiKey
      + '&file_type=json&sort_order=desc&limit=5' + (series.extra || '');
    var resp = await fetch(url);
    var data = await resp.json();
    var obs = (data.observations || []).filter(function(o) { return o.value !== '.'; });
    if (obs.length >= 1) {
      return {
        id: series.id,
        current: parseFloat(obs[0].value),
        prior: obs.length >= 2 ? parseFloat(obs[1].value) : null,
        t2:    obs.length >= 3 ? parseFloat(obs[2].value) : null,
        t3:    obs.length >= 4 ? parseFloat(obs[3].value) : null,
        date: obs[0].date,
        label: series.label,
      };
    }
  } catch (e) { /* fall through */ }
  return { id: series.id, current: null, prior: null, t2: null, t3: null, date: null, label: series.label };
}

async function fetchAllFRED(seriesList, apiKey) {
  var results = await Promise.all(seriesList.map(function(s) { return fetchFREDSeries(s, apiKey); }));
  var out = {};
  for (var i = 0; i < results.length; i++) {
    var r = results[i];
    out[r.id] = { current: r.current, prior: r.prior, t2: r.t2, date: r.date, label: r.label };
  }
  return out;
}

// ============================================
// NY FED API  (original -- untouched)
// ============================================

async function fetchNYFedRate(rateName) {
  try {
    var url = 'https://markets.newyorkfed.org/api/rates/' + rateName + '/last/1.json';
    var resp = await fetch(url);
    var data = await resp.json();
    var ref = data.refRates[0];
    return {
      rate: parseFloat(ref.percentRate),
      date: ref.effectiveDate,
      volume: ref.volumeInBillions ? parseFloat(ref.volumeInBillions) : null,
    };
  } catch (e) {
    return { rate: null, date: null, volume: null };
  }
}

async function fetchAllNYFed() {
  var results = await Promise.all([fetchNYFedRate('sofr'), fetchNYFedRate('effr'), fetchNYFedRate('obfr')]);
  return { sofr: results[0], effr: results[1], obfr: results[2] };
}

// ============================================
// YIELD HISTORY (T-1, T-7, T-14 for short-term yields)
// Fetches 20 obs per series, finds nearest business day to target dates.
// ============================================

async function fetchYieldHistory(apiKey) {
  if (!apiKey) return {};
  var results = await Promise.all(FRED_YIELDS_HIST.map(function(s) {
    return fetchFREDYieldSeries(s, apiKey);
  }));
  var out = {};
  for (var i = 0; i < results.length; i++) out[results[i].id] = results[i];
  return out;
}

async function fetchFREDYieldSeries(series, apiKey) {
  var empty = { id: series.id, label: series.label, t1: null, t1Date: null, t7: null, t7Date: null, t14: null, t14Date: null };
  if (!apiKey) return empty;
  try {
    var url = 'https://api.stlouisfed.org/fred/series/observations'
      + '?series_id=' + series.id + '&api_key=' + apiKey
      + '&file_type=json&sort_order=desc&limit=30';
    var resp = await fetch(url);
    // Surface FRED API errors (bad key, rate limit, etc.) rather than silently returning empty
    if (!resp.ok) {
      console.error('[yieldsHist] FRED HTTP ' + resp.status + ' for ' + series.id);
      return Object.assign({}, empty, { error: 'FRED HTTP ' + resp.status });
    }
    var data = await resp.json();
    var obs = (data.observations || []).filter(function(o) { return o.value !== '.'; });
    if (obs.length === 0) {
      console.error('[yieldsHist] No valid observations for ' + series.id + ' (raw count: ' + (data.observations||[]).length + ')');
      return Object.assign({}, empty, { error: 'no_obs' });
    }

    var t1Val = parseFloat(obs[0].value);
    var t1Date = obs[0].date;
    var latestMs = new Date(t1Date + 'T12:00:00Z').getTime();

    var t7 = findClosestObs(obs, latestMs - 7 * 86400000);
    var t14 = findClosestObs(obs, latestMs - 14 * 86400000);

    if (!t7)  console.error('[yieldsHist] ' + series.id + ' T-7  miss: target=' + new Date(latestMs - 7*86400000).toISOString().slice(0,10)  + ' range=' + obs[obs.length-1].date + '..' + obs[0].date);
    if (!t14) console.error('[yieldsHist] ' + series.id + ' T-14 miss: target=' + new Date(latestMs - 14*86400000).toISOString().slice(0,10) + ' range=' + obs[obs.length-1].date + '..' + obs[0].date);

    return {
      id: series.id, label: series.label,
      t1: t1Val, t1Date: t1Date,
      t7: t7 ? parseFloat(t7.value) : null, t7Date: t7 ? t7.date : null,
      t14: t14 ? parseFloat(t14.value) : null, t14Date: t14 ? t14.date : null,
    };
  } catch (e) {
    console.error('[yieldsHist] Exception for ' + series.id + ': ' + e.message);
    return Object.assign({}, empty, { error: e.message });
  }
}

function findClosestObs(obs, targetMs) {
  var best = null, bestDiff = Infinity;
  for (var i = 0; i < obs.length; i++) {
    var d = new Date(obs[i].date + 'T12:00:00Z').getTime();
    var diff = Math.abs(d - targetMs);
    if (diff < bestDiff) { bestDiff = diff; best = obs[i]; }
  }
  return bestDiff <= 5 * 86400000 ? best : null;  // 5-day tolerance — handles 4-day holiday weekends
}

// ============================================
// WSJ RSS FETCHING  via rss2json.com proxy
//
// ROOT CAUSE of prior failure:
//   feeds.a.dj.com blocks ALL Cloudflare datacenter IPs at the ASN
//   level — this is a Dow Jones WAF rule, not a rate-limit or UA
//   check. Every fetch() from any CF Worker gets a 403 regardless
//   of User-Agent, Referer, or retry count.
//
// FIX:
//   Route through rss2json.com — a residential-IP RSS→JSON proxy.
//   It fetches feeds.a.dj.com from non-datacenter IPs, which are
//   not blocked. No API key required for free-tier usage.
//
// rss2json response shape:
//   { status:"ok", items:[{ title, link, pubDate:"YYYY-MM-DD HH:MM:SS",
//     description, author }] }
//
// Note: pubDate is NOT RFC 822 — it uses "YYYY-MM-DD HH:MM:SS" format.
// The date is stored as-is; renderNews/formatTime handle it gracefully.
// ============================================

var RSS2JSON_BASE = 'https://api.rss2json.com/v1/api.json?rss_url=';

async function fetchWSJFeed(feedDef) {
  try {
    var proxyUrl = RSS2JSON_BASE + encodeURIComponent(feedDef.url);
    var resp = await fetch(proxyUrl, {
      headers: { 'Accept': 'application/json' },
      cf: { cacheTtl: 300 },   // 5-min Cloudflare edge cache on the proxy response
    });
    if (!resp.ok) return [];

    var data = await resp.json();
    if (!data || data.status !== 'ok' || !Array.isArray(data.items)) return [];

    var items = [];
    for (var i = 0; i < data.items.length && items.length < 15; i++) {
      var item = data.items[i];
      if (!item.title) continue;

      var title = item.title  || '';
      var desc  = item.description || item.content || '';
      var resolvedCategory = classifyWSJ(title, desc, feedDef.category);

      items.push({
        title:   decodeEntities(title),
        link:    item.link || '',
        date:    item.pubDate || '',   // "YYYY-MM-DD HH:MM:SS" — handled by formatTime
        summary: decodeEntities(desc).substring(0, 200),
        source:  feedDef.source,      // "WSJ Markets" | "WSJ Economy" | "WSJ US News"
        tag:     resolvedCategory,
        isGov:   false,
      });
    }
    return items;
  } catch (e) {
    return [];
  }
}

// Lightweight classifier for WSJ items.
// Preserves feed-level category as default; overrides only on strong signals.
function classifyWSJ(title, desc, defaultCategory) {
  var text = ((title || '') + ' ' + (desc || '')).toLowerCase();
  if (/\bfomc\b|federal open market|interest rate decision|monetary policy/.test(text)) return 'FED';
  if (/\binflation\b|\bcpi\b|price index|core pce/.test(text))                          return 'FED';
  if (/\byield curve\b|\btreasury yield\b|\bsofr\b|\beffr\b/.test(text))               return 'RATES';
  if (/\bgdp\b|gross domestic product/.test(text))                                       return 'ECONOMY';
  if (/\bnonfarm payroll|\bunemployment rate|\bjobless claims/.test(text))               return 'ECONOMY';
  return defaultCategory;
}

async function fetchAllWSJ() {
  var results = await Promise.all(WSJ_FEEDS.map(fetchWSJFeed));
  var combined = [];
  for (var i = 0; i < results.length; i++) combined = combined.concat(results[i]);
  return combined;
}


// ============================================
// RSS FEED PARSING  (original -- untouched)
// ============================================

async function fetchRSS(url, sourceName, tag, isGov) {
  try {
    var resp = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept':     'application/rss+xml, application/xml, text/xml, */*',
      },
    });
    var xml = await resp.text();
    return parseRSS(xml, sourceName, tag, isGov !== false);
  } catch (e) {
    return [];
  }
}

function parseRSS(xml, sourceName, tag, isGov) {
  var items = [];
  var itemRegex = /<item>([\s\S]*?)<\/item>/gi;
  var match;
  while ((match = itemRegex.exec(xml)) !== null && items.length < 20) {
    var block = match[1];
    var title = extractXmlTag(block, 'title');
    var link = extractXmlTag(block, 'link');
    var pubDate = extractXmlTag(block, 'pubDate');
    var desc = extractXmlTag(block, 'description');
    if (title) {
      var autoTag = classifyArticle(title, desc, tag);
      items.push({
        title: decodeEntities(title),
        link: link || '',
        date: pubDate || '',
        summary: desc ? decodeEntities(desc).substring(0, 200) : '',
        source: sourceName,
        tag: autoTag,
        isGov: isGov,
      });
    }
  }
  return items;
}

function classifyArticle(title, desc, defaultTag) {
  var text = ((title || '') + ' ' + (desc || '')).toLowerCase();
  if (text.indexOf('inflation') !== -1 || text.indexOf('cpi') !== -1 || text.indexOf('price index') !== -1) return 'INFLATION';
  if (text.indexOf('employment') !== -1 || text.indexOf('jobs') !== -1 || text.indexOf('unemployment') !== -1 || text.indexOf('payroll') !== -1) return 'LABOR';
  if (text.indexOf('fomc') !== -1 || text.indexOf('federal open market') !== -1 || text.indexOf('interest rate') !== -1 || text.indexOf('monetary policy') !== -1) return 'FED';
  if (text.indexOf('gdp') !== -1 || text.indexOf('gross domestic') !== -1) return 'GDP';
  if (text.indexOf('treasury') !== -1 || text.indexOf('yield') !== -1 || text.indexOf('bond') !== -1) return 'RATES';
  if (text.indexOf('oil') !== -1 || text.indexOf('commodity') !== -1 || text.indexOf('crude') !== -1 || text.indexOf('energy') !== -1 || text.indexOf('opec') !== -1) return 'COMMODITIES';
  if (text.indexOf('forex') !== -1 || text.indexOf('dollar') !== -1 || text.indexOf('currency') !== -1 || text.indexOf('yuan') !== -1) return 'FX';
  if (text.indexOf('banking') !== -1 || text.indexOf('credit') !== -1) return 'CREDIT';
  return defaultTag;
}

function extractXmlTag(xml, tagName) {
  var regex = new RegExp('<' + tagName + '[^>]*>([\\s\\S]*?)<\\/' + tagName + '>', 'i');
  var m = regex.exec(xml);
  if (!m) return null;
  return m[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').trim();
}

function decodeEntities(str) {
  return str
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&apos;/g, "'");
}

// ============================================
// NEWSAPI (OPTIONAL)  (original -- untouched)
// ============================================

async function fetchNewsAPI(apiKey) {
  var q = encodeURIComponent('Federal Reserve OR treasury yields OR inflation OR interest rates OR FOMC');
  var url = 'https://newsapi.org/v2/everything?q=' + q
    + '&language=en&sortBy=publishedAt&pageSize=10&apiKey=' + apiKey;
  var resp = await fetch(url);
  var data = await resp.json();
  if (!data.articles) return [];
  return data.articles.map(function(a) {
    var autoTag = classifyArticle(a.title, a.description, 'MARKETS');
    return {
      title: a.title || '',
      link: a.url || '',
      date: a.publishedAt || '',
      summary: (a.description || '').substring(0, 200),
      source: a.source ? a.source.name : 'NewsAPI',
      tag: autoTag,
      isGov: false,
    };
  });
}
