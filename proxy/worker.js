/**
 * Treasury Intelligence Dashboard -- Cloudflare Worker Proxy
 *
 * Endpoints:
 *   GET /api/market-data  -- Full payload: Yahoo Finance + FRED + NY Fed + macro
 *   GET /api/ticker       -- Lightweight: 9 Yahoo symbols only (for 10s ticker refresh)
 *   GET /api/news         -- RSS feeds (Federal Reserve, ECB, Reuters, CNBC)
 *   GET /                 -- Health check + FRED key diagnostic
 *
 * Secrets (set via `npx wrangler secret put <n>`):
 *   FRED_API_KEY   -- REQUIRED. Free key: https://fred.stlouisfed.org/docs/api/api_key.html
 *   NEWSAPI_KEY    -- optional, further enhances news feed
 *
 * Deploy: npx wrangler deploy
 */

// ============================================
// CONFIGURATION
// ============================================

// Full symbol list -- used by /api/market-data (15-min refresh)
var YAHOO_SYMBOLS = [
  { key: 'SP500',   symbol: '%5EGSPC',     group: 'equities'    },
  { key: 'DOW',     symbol: '%5EDJI',      group: 'equities'    },
  { key: 'NASDAQ',  symbol: '%5EIXIC',     group: 'equities'    },
  { key: 'RUSSELL', symbol: '%5ERUT',      group: 'equities'    },
  { key: 'WTI',     symbol: 'CL%3DF',     group: 'commodities' },
  { key: 'Brent',   symbol: 'BZ%3DF',     group: 'commodities' },
  { key: 'NatGas',  symbol: 'NG%3DF',     group: 'commodities' },
  { key: 'HeatOil', symbol: 'HO%3DF',     group: 'commodities' },
  { key: 'Copper',  symbol: 'HG%3DF',     group: 'commodities' },
  { key: 'Gold',    symbol: 'GC%3DF',     group: 'commodities' },
  { key: 'Silver',  symbol: 'SI%3DF',     group: 'commodities' },
  { key: 'EURUSD',  symbol: 'EURUSD%3DX', group: 'forex'       },
  { key: 'GBPUSD',  symbol: 'GBPUSD%3DX', group: 'forex'       },
  { key: 'USDJPY',  symbol: 'JPY%3DX',    group: 'forex'       },
  { key: 'AUDUSD',  symbol: 'AUDUSD%3DX', group: 'forex'       },
  { key: 'USDCAD',  symbol: 'USDCAD%3DX', group: 'forex'       },
  { key: 'USDCHF',  symbol: 'USDCHF%3DX', group: 'forex'       },
  { key: 'USDCNH',  symbol: 'CNH%3DX',    group: 'forex'       },
  { key: 'DXY',     symbol: 'DX-Y.NYB',   group: 'risk'        },
  { key: 'VIX',     symbol: '%5EVIX',     group: 'risk'        },
];

// Lightweight ticker list -- /api/ticker only (10s refresh)
// 9 calls vs 20 -- eliminates FRED/NYFed overhead on every tick
var TICKER_SYMBOLS_WORKER = [
  { key: 'WTI',     symbol: 'CL%3DF',   group: 'commodities' },
  { key: 'Brent',   symbol: 'BZ%3DF',   group: 'commodities' },
  { key: 'NatGas',  symbol: 'NG%3DF',   group: 'commodities' },
  { key: 'HeatOil', symbol: 'HO%3DF',   group: 'commodities' },
  { key: 'Gold',    symbol: 'GC%3DF',   group: 'commodities' },
  { key: 'Silver',  symbol: 'SI%3DF',   group: 'commodities' },
  { key: 'VIX',     symbol: '%5EVIX',   group: 'risk'        },
  { key: 'DXY',     symbol: 'DX-Y.NYB', group: 'risk'        },
  { key: 'SP500',   symbol: '%5EGSPC',  group: 'equities'    },
];

var FRED_MARKET = [
  { id: 'DGS3MO',       label: '3M UST',  extra: '' },
  { id: 'DGS6MO',       label: '6M UST',  extra: '' },
  { id: 'DGS1',         label: '1Y UST',  extra: '' },
  { id: 'DGS2',         label: '2Y UST',  extra: '' },
  { id: 'DGS5',         label: '5Y UST',  extra: '' },
  { id: 'DGS10',        label: '10Y UST', extra: '' },
  { id: 'DGS30',        label: '30Y UST', extra: '' },
  { id: 'RRPONTSYD',    label: 'ON RRP',  extra: '' },
  { id: 'BAMLC0A0CM',   label: 'IG OAS',  extra: '' },
  { id: 'BAMLH0A0HYM2', label: 'HY OAS',  extra: '' },
];

var FRED_MACRO = [
  { id: 'FEDFUNDS',        label: 'Fed Funds Rate', extra: ''          },
  { id: 'CPIAUCSL',        label: 'CPI YoY',        extra: '&units=pc1' },
  { id: 'CPILFESL',        label: 'Core CPI YoY',   extra: '&units=pc1' },
  { id: 'PPIACO',          label: 'PPI YoY',         extra: '&units=pc1' },
  { id: 'UNRATE',          label: 'Unemployment',    extra: ''          },
  { id: 'ICSA',            label: 'Initial Claims',  extra: ''          },
  { id: 'A191RL1Q225SBEA', label: 'Real GDP',        extra: ''          },
  { id: 'WM2NS',           label: 'M2 YoY',          extra: '&units=pc1' },
];

var FOMC_2026 = [
  '2026-01-29', '2026-03-19', '2026-04-30', '2026-06-18',
  '2026-07-30', '2026-09-17', '2026-11-05', '2026-12-17',
];

// RSS feeds -- WSJ DJ removed (paywalled/blocked), MarketWatch removed (broken path)
// Reuters businessNews and CNBC Economy added as replacements
var RSS_FEEDS = [
  { url: 'https://www.federalreserve.gov/feeds/press_monetary.xml', source: 'Federal Reserve', tag: 'FED',     isGov: true  },
  { url: 'https://www.federalreserve.gov/feeds/press_bcreg.xml',    source: 'Fed Banking',     tag: 'FED',     isGov: true  },
  { url: 'https://www.ecb.europa.eu/rss/press.html',                source: 'ECB',             tag: 'FED',     isGov: true  },
  { url: 'https://feeds.reuters.com/reuters/businessNews',           source: 'Reuters',         tag: 'MARKETS', isGov: false },
  { url: 'https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=20910258', source: 'CNBC', tag: 'MARKETS', isGov: false },
  { url: 'https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=15839135', source: 'CNBC Economy', tag: 'FED', isGov: false },
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
      if (url.pathname === '/') {
        // Health check -- fred_key_set lets you diagnose N/A panels without guessing
        return jsonResp({
          status: 'ok',
          endpoints: ['/api/market-data', '/api/ticker', '/api/news'],
          fred_key_set: !!(env.FRED_API_KEY),
        });
      }
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
// /api/market-data  (full payload, 15-min refresh)
// ============================================

async function handleMarketData(env) {
  var fredKey = env.FRED_API_KEY || '';

  var results = await Promise.all([
    fetchAllYahoo(YAHOO_SYMBOLS),
    fetchAllFRED(FRED_MARKET, fredKey),
    fetchAllFRED(FRED_MACRO, fredKey),
    fetchAllNYFed(),
  ]);

  var yahoo      = results[0];
  var fredMarket = results[1];
  var fredMacro  = results[2];
  var nyfed      = results[3];

  var now      = new Date();
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
    yahoo:  yahoo,
    fred:   fredMarket,
    macro:  fredMacro,
    nyfed:  nyfed,
    fomc: { next: nextFomc, daysAway: fomcDays, dates: FOMC_2026 },
    _meta: { fred_key_set: !!(fredKey) },
  });
}

// ============================================
// /api/ticker  (lightweight, 10s refresh)
// Only 9 Yahoo symbols -- no FRED, no NY Fed
// ============================================

async function handleTicker() {
  var yahoo = await fetchAllYahoo(TICKER_SYMBOLS_WORKER);
  return jsonResp({
    timestamp: new Date().toISOString(),
    yahoo: yahoo,
  });
}

// ============================================
// /api/news
// ============================================

async function handleNews(env) {
  var allItems = [];

  var rssResults = await Promise.all(RSS_FEEDS.map(function(feed) {
    return fetchRSS(feed.url, feed.source, feed.tag, feed.isGov);
  }));
  for (var i = 0; i < rssResults.length; i++) {
    allItems = allItems.concat(rssResults[i]);
  }

  var newsapiKey = env.NEWSAPI_KEY || '';
  if (newsapiKey) {
    try {
      var naItems = await fetchNewsAPI(newsapiKey);
      allItems = allItems.concat(naItems);
    } catch (e) { /* continue */ }
  }

  var seen = {}, deduped = [];
  for (var i = 0; i < allItems.length; i++) {
    var norm = allItems[i].title.toLowerCase().replace(/[^a-z0-9]/g, '').substring(0, 60);
    if (!seen[norm]) { seen[norm] = true; deduped.push(allItems[i]); }
  }

  deduped.sort(function(a, b) { return new Date(b.date || 0) - new Date(a.date || 0); });
  deduped = deduped.slice(0, 40);

  return jsonResp({ timestamp: new Date().toISOString(), items: deduped });
}

// ============================================
// YAHOO FINANCE
// v8/finance/chart -- walks back from tail to find two valid non-null closes
// Handles weekends and early-close days cleanly
// ============================================

async function fetchYahooSymbol(sym) {
  try {
    var url = 'https://query1.finance.yahoo.com/v8/finance/chart/' + sym.symbol + '?range=5d&interval=1d';
    var resp = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'application/json',
      },
    });
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    var data   = await resp.json();
    var result = data.chart && data.chart.result && data.chart.result[0];
    if (!result) throw new Error('no result');
    var ts     = result.timestamp;
    var closes = result.indicators.quote[0].close;
    // Walk from end to find last two non-null closes (handles partial trading days)
    var lastIdx = -1, prevIdx = -1;
    for (var i = ts.length - 1; i >= 0; i--) {
      if (closes[i] != null) {
        if (lastIdx === -1) { lastIdx = i; }
        else { prevIdx = i; break; }
      }
    }
    if (lastIdx === -1) throw new Error('no valid close');
    var dateStr = new Date(ts[lastIdx] * 1000).toISOString().split('T')[0];
    return {
      key:     sym.key,
      current: closes[lastIdx],
      prior:   prevIdx !== -1 ? closes[prevIdx] : null,
      date:    dateStr,
      group:   sym.group,
    };
  } catch (e) { /* fall through */ }
  return { key: sym.key, current: null, prior: null, date: null, group: sym.group };
}

async function fetchAllYahoo(symbolList) {
  var results = await Promise.all(symbolList.map(fetchYahooSymbol));
  var out = {};
  for (var i = 0; i < results.length; i++) {
    var r = results[i];
    out[r.key] = { current: r.current, prior: r.prior, date: r.date, group: r.group };
  }
  return out;
}

// ============================================
// FRED API
// ============================================

async function fetchFREDSeries(series, apiKey) {
  if (!apiKey) return { id: series.id, current: null, prior: null, date: null, label: series.label };
  try {
    var url = 'https://api.stlouisfed.org/fred/series/observations'
      + '?series_id=' + series.id
      + '&api_key=' + apiKey
      + '&file_type=json&sort_order=desc&limit=5'
      + (series.extra || '');
    var resp = await fetch(url);
    if (!resp.ok) throw new Error('FRED HTTP ' + resp.status);
    var data = await resp.json();
    var obs  = (data.observations || []).filter(function(o) { return o.value !== '.'; });
    if (obs.length >= 1) {
      return {
        id:      series.id,
        current: parseFloat(obs[0].value),
        prior:   obs.length >= 2 ? parseFloat(obs[1].value) : null,
        date:    obs[0].date,
        label:   series.label,
      };
    }
  } catch (e) { /* fall through */ }
  return { id: series.id, current: null, prior: null, date: null, label: series.label };
}

async function fetchAllFRED(seriesList, apiKey) {
  var results = await Promise.all(seriesList.map(function(s) { return fetchFREDSeries(s, apiKey); }));
  var out = {};
  for (var i = 0; i < results.length; i++) {
    var r = results[i];
    out[r.id] = { current: r.current, prior: r.prior, date: r.date, label: r.label };
  }
  return out;
}

// ============================================
// NY FED API
// ============================================

async function fetchNYFedRate(rateName) {
  try {
    var url  = 'https://markets.newyorkfed.org/api/rates/' + rateName + '/last/1.json';
    var resp = await fetch(url);
    var data = await resp.json();
    var ref  = data.refRates[0];
    return {
      rate:   parseFloat(ref.percentRate),
      date:   ref.effectiveDate,
      volume: ref.volumeInBillions ? parseFloat(ref.volumeInBillions) : null,
    };
  } catch (e) {
    return { rate: null, date: null, volume: null };
  }
}

async function fetchAllNYFed() {
  var r = await Promise.all([fetchNYFedRate('sofr'), fetchNYFedRate('effr')]);
  return { sofr: r[0], effr: r[1] };
}

// ============================================
// RSS FEED PARSING
// ============================================

async function fetchRSS(url, sourceName, tag, isGov) {
  try {
    var resp = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (!resp.ok) throw new Error('RSS HTTP ' + resp.status);
    var xml = await resp.text();
    return parseRSS(xml, sourceName, tag, isGov !== false);
  } catch (e) { return []; }
}

function parseRSS(xml, sourceName, tag, isGov) {
  var items = [], itemRegex = /<item>([\s\S]*?)<\/item>/gi, match;
  while ((match = itemRegex.exec(xml)) !== null && items.length < 15) {
    var block   = match[1];
    var title   = extractXmlTag(block, 'title');
    var link    = extractXmlTag(block, 'link');
    var pubDate = extractXmlTag(block, 'pubDate');
    var desc    = extractXmlTag(block, 'description');
    if (title) {
      items.push({
        title:   decodeEntities(title),
        link:    link || '',
        date:    pubDate || '',
        summary: desc ? decodeEntities(desc).substring(0, 200) : '',
        source:  sourceName,
        tag:     classifyArticle(title, desc, tag),
        isGov:   isGov,
      });
    }
  }
  return items;
}

function classifyArticle(title, desc, defaultTag) {
  var t = ((title || '') + ' ' + (desc || '')).toLowerCase();
  if (/inflation|cpi|price index/.test(t)) return 'INFLATION';
  if (/employment|jobs|unemployment|payroll/.test(t)) return 'LABOR';
  if (/fomc|federal open market|interest rate|monetary policy/.test(t)) return 'FED';
  if (/\bgdp\b|gross domestic/.test(t)) return 'GDP';
  if (/treasury|yield|bond/.test(t)) return 'RATES';
  if (/\boil\b|commodity|crude|energy|opec/.test(t)) return 'COMMODITIES';
  if (/forex|dollar|currency|yuan/.test(t)) return 'FX';
  if (/banking|credit spread/.test(t)) return 'CREDIT';
  if (/tariff|trade war|sanction/.test(t)) return 'MACRO';
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
// NEWSAPI (OPTIONAL)
// ============================================

async function fetchNewsAPI(apiKey) {
  var q    = encodeURIComponent('Federal Reserve OR treasury yields OR inflation OR interest rates OR FOMC OR tariff');
  var url  = 'https://newsapi.org/v2/everything?q=' + q + '&language=en&sortBy=publishedAt&pageSize=10&apiKey=' + apiKey;
  var resp = await fetch(url);
  var data = await resp.json();
  if (!data.articles) return [];
  return data.articles.map(function(a) {
    return {
      title:   a.title || '',
      link:    a.url || '',
      date:    a.publishedAt || '',
      summary: (a.description || '').substring(0, 200),
      source:  a.source ? a.source.name : 'NewsAPI',
      tag:     classifyArticle(a.title, a.description, 'MARKETS'),
      isGov:   false,
    };
  });
}
