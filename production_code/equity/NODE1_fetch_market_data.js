// ============================================
// FETCH MARKET DATA (Daily Brief + Saturday Deep Dive)
// n8n Code Node — Production v3.2
// ============================================
// SETUP: Replace API keys below with your actual keys.
// RULE: No template literals (backticks) — n8n copy-paste breaks them.

var FINNHUB_KEY = 'YOUR_FINNHUB_KEY_HERE';
var AV_KEY = 'YOUR_ALPHAVANTAGE_KEY_HERE';

var today = new Date();
var dateStr = today.toISOString().split('T')[0];
var dayName = today.toLocaleDateString('en-US', { weekday: 'long', timeZone: 'America/Puerto_Rico' });

// --- WATCHLIST ---
var coreTickers = ['NVDA','AVGO','AMAT','ANET','TSM','AMD','MU','ARM','MRVL','CSCO','CRWV'];
var secondaryTickers = ['TSLA','PLTR','CRM','NOW','ORCL','SMCI','APP','QCOM','INTC','DELL'];
var allTickers = coreTickers.concat(secondaryTickers);

async function httpGet(url) {
  return await this.helpers.httpRequest({ method: 'GET', url: url, json: true });
}

async function getQuote(ticker) {
  try {
    var data = await httpGet.call(this, 'https://finnhub.io/api/v1/quote?symbol=' + ticker + '&token=' + FINNHUB_KEY);
    return {
      ticker: ticker,
      close: data.c || 0,
      prevClose: data.pc || 0,
      change_pct: data.pc ? (((data.c - data.pc) / data.pc) * 100).toFixed(2) : '0.00',
      high: data.h || 0,
      low: data.l || 0
    };
  } catch (e) {
    return { ticker: ticker, close: 0, prevClose: 0, change_pct: '0.00', high: 0, low: 0, error: e.message };
  }
}

async function getIndices() {
  var results = {};
  var indexMap = { SPX: 'SPY', NDX: 'QQQ', RUT: 'IWM', VIX: 'VIXY' };
  var labels = ['SPX', 'NDX', 'RUT', 'VIX'];
  for (var i = 0; i < labels.length; i++) {
    var label = labels[i];
    var symbol = indexMap[label];
    try {
      var data = await httpGet.call(this, 'https://finnhub.io/api/v1/quote?symbol=' + symbol + '&token=' + FINNHUB_KEY);
      results[label] = {
        close: data.c || 0,
        change_pct: data.pc ? (((data.c - data.pc) / data.pc) * 100).toFixed(2) : '0.00'
      };
    } catch (e) {
      results[label] = { close: 0, change_pct: '0.00', error: e.message };
    }
  }
  return results;
}

async function getMacro() {
  var results = {};
  try {
    var oilData = await httpGet.call(this, 'https://www.alphavantage.co/query?function=GLOBAL_QUOTE&symbol=USO&apikey=' + AV_KEY);
    results.WTI = oilData['Global Quote'] ? oilData['Global Quote']['05. price'] : 'N/A';
  } catch (e) { results.WTI = 'N/A'; }
  try {
    var dxyData = await httpGet.call(this, 'https://www.alphavantage.co/query?function=GLOBAL_QUOTE&symbol=UUP&apikey=' + AV_KEY);
    results.DXY = dxyData['Global Quote'] ? dxyData['Global Quote']['05. price'] : 'N/A';
  } catch (e) { results.DXY = 'N/A'; }
  return results;
}

async function getNews(ticker) {
  try {
    var fromDate = new Date(Date.now() - 86400000).toISOString().split('T')[0];
    var toDate = dateStr;
    var data = await httpGet.call(this, 'https://finnhub.io/api/v1/company-news?symbol=' + ticker + '&from=' + fromDate + '&to=' + toDate + '&token=' + FINNHUB_KEY);
    return (data || []).slice(0, 3).map(function(n) { return { headline: n.headline, source: n.source, ticker: ticker }; });
  } catch (e) {
    return [];
  }
}

// Execute fetches sequentially to respect rate limits
var indices = await getIndices.call(this);
var macro = await getMacro.call(this);

var tickerQuotes = [];
for (var t = 0; t < allTickers.length; t++) {
  tickerQuotes.push(await getQuote.call(this, allTickers[t]));
}

// Get news for top movers
var sorted = tickerQuotes.slice().sort(function(a, b) {
  return Math.abs(parseFloat(b.change_pct)) - Math.abs(parseFloat(a.change_pct));
});
var topMovers = sorted.slice(0, 5);
var allNews = [];
for (var m = 0; m < topMovers.length; m++) {
  var news = await getNews.call(this, topMovers[m].ticker);
  allNews = allNews.concat(news);
}

var marketDataStr = '';
marketDataStr += '- S&P 500: ' + indices.SPX.close + ' (' + indices.SPX.change_pct + '%)\n';
marketDataStr += '- Nasdaq: ' + indices.NDX.close + ' (' + indices.NDX.change_pct + '%)\n';
marketDataStr += '- Russell 2000: ' + indices.RUT.close + ' (' + indices.RUT.change_pct + '%)\n';
marketDataStr += '- VIX: ' + indices.VIX.close + ' (' + indices.VIX.change_pct + '%)\n';
marketDataStr += '- DXY (UUP proxy): ' + macro.DXY + ' | WTI (USO proxy): ' + macro.WTI + '\n';

var watchlistStr = '| Ticker | Close | Change % |\n|--------|-------|----------|\n';
for (var q = 0; q < tickerQuotes.length; q++) {
  watchlistStr += '| ' + tickerQuotes[q].ticker + ' | $' + tickerQuotes[q].close + ' | ' + tickerQuotes[q].change_pct + '% |\n';
}

var newsStr = '';
if (allNews.length > 0) {
  for (var n = 0; n < Math.min(allNews.length, 10); n++) {
    newsStr += '- [' + allNews[n].ticker + '] ' + allNews[n].headline + ' (' + allNews[n].source + ')\n';
  }
} else {
  newsStr = 'No recent headlines available.';
}

return [{
  json: {
    date: dateStr,
    dayOfWeek: dayName,
    marketData: marketDataStr,
    watchlistTable: watchlistStr,
    newsHeadlines: newsStr,
    rawQuotes: tickerQuotes,
    rawIndices: indices
  }
}];
