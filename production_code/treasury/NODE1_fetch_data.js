// ============================================
// FETCH COMMODITY PULSE DATA (Daily + Saturday)
// n8n Code Node — Production v4.0
// Replaces treasury yield fetching with commodity
// price data relevant to collateral & margin management.
// Tickers: WTI, Brent, Natural Gas, Heating Oil, Copper
// 5 API calls per run (was 7, now more reliable data)
// ============================================

var AV_KEY = 'YOUR_ALPHAVANTAGE_KEY_HERE';

var today = new Date();
var dateStr = today.toISOString().split('T')[0];
var dayName = today.toLocaleDateString('en-US', { weekday: 'long', timeZone: 'America/Puerto_Rico' });
var dateDisplay = dayName + ', ' + today.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'America/Puerto_Rico' });

async function httpGet(url) {
  try {
    return await this.helpers.httpRequest({ method: 'GET', url: url, json: true });
  } catch (e) {
    return null;
  }
}

async function getCommodity(func) {
  try {
    var url = 'https://www.alphavantage.co/query?function=' + func + '&interval=daily&apikey=' + AV_KEY;
    var data = await httpGet.call(this, url);
    if (data && data.data && data.data.length >= 2) {
      return { latest: data.data[0], prior: data.data[1] };
    }
    return null;
  } catch (e) {
    return null;
  }
}

function formatCommodity(result, label, unit) {
  if (!result || !result.latest || result.latest.value === '.' || result.latest.value === null) {
    return { line: label + ': N/A', current: null, change: null, changePct: null, label: label, unit: unit };
  }
  var current = parseFloat(result.latest.value);
  var prior = result.prior ? parseFloat(result.prior.value) : null;
  var change = (prior !== null && !isNaN(prior)) ? (current - prior) : null;
  var changePct = (change !== null && prior !== 0) ? ((change / prior) * 100) : null;
  var sign = (change !== null && change >= 0) ? '+' : '';
  var arrow = change > 0 ? 'UP' : change < 0 ? 'DOWN' : 'FLAT';
  var line = label + ': ' + unit + current.toFixed(2);
  if (change !== null && changePct !== null) {
    line += '  (' + arrow + ' ' + sign + changePct.toFixed(1) + '% / ' + sign + unit + Math.abs(change).toFixed(2) + ' DoD)';
  }
  line += '  [as of ' + result.latest.date + ']';
  return { line: line, current: current, prior: prior, change: change, changePct: changePct, label: label, unit: unit };
}

// Fetch all 5 commodity tickers
var rawWTI = await getCommodity.call(this, 'WTI');
var rawBrent = await getCommodity.call(this, 'BRENT');
var rawGas = await getCommodity.call(this, 'NATURAL_GAS');
var rawHeatOil = await getCommodity.call(this, 'HEATING_OIL');
var rawCopper = await getCommodity.call(this, 'COPPER');

var wti = formatCommodity(rawWTI, 'WTI Crude', '$');
var brent = formatCommodity(rawBrent, 'Brent Crude', '$');
var gas = formatCommodity(rawGas, 'Henry Hub Nat Gas', '$');
var heatOil = formatCommodity(rawHeatOil, 'Heating Oil (ULSD)', '$');
var copper = formatCommodity(rawCopper, 'Copper', '$');

// WTI/Brent spread
var spreadLine = '';
if (wti.current !== null && brent.current !== null) {
  var spread = wti.current - brent.current;
  spreadLine = 'WTI/Brent Spread: ' + (spread >= 0 ? '+' : '') + '$' + spread.toFixed(2);
}

// Automated collateral pressure signal
var pressureSignals = [];
if (wti.changePct !== null && Math.abs(wti.changePct) >= 2) {
  pressureSignals.push('WTI ' + (wti.changePct > 0 ? 'up' : 'down') + ' ' + Math.abs(wti.changePct).toFixed(1) + '%');
}
if (gas.changePct !== null && Math.abs(gas.changePct) >= 3) {
  pressureSignals.push('Nat Gas ' + (gas.changePct > 0 ? 'up' : 'down') + ' ' + Math.abs(gas.changePct).toFixed(1) + '%');
}
if (brent.changePct !== null && Math.abs(brent.changePct) >= 2) {
  pressureSignals.push('Brent ' + (brent.changePct > 0 ? 'up' : 'down') + ' ' + Math.abs(brent.changePct).toFixed(1) + '%');
}
if (heatOil.changePct !== null && Math.abs(heatOil.changePct) >= 2) {
  pressureSignals.push('Heating Oil ' + (heatOil.changePct > 0 ? 'up' : 'down') + ' ' + Math.abs(heatOil.changePct).toFixed(1) + '%');
}

var pressureAssessment = '';
if (pressureSignals.length >= 2) {
  pressureAssessment = 'ELEVATED MARGIN PRESSURE: ' + pressureSignals.join(', ') + '. Multiple books affected — collateral calls likely.';
} else if (pressureSignals.length === 1) {
  pressureAssessment = 'WATCH: ' + pressureSignals[0] + ' — monitor single-book margin exposure.';
} else {
  pressureAssessment = 'Commodity moves within normal range — no elevated collateral alert.';
}

// Build structured marketData block for Claude
var marketData = '## Commodity Pulse — Collateral & Margin Monitor\n\n';
marketData += wti.line + '\n';
marketData += brent.line + '\n';
if (spreadLine) { marketData += spreadLine + '\n'; }
marketData += gas.line + '\n';
marketData += heatOil.line + '\n';
marketData += copper.line + '\n';
marketData += '\n### Pre-computed Collateral Pressure Signal\n';
marketData += pressureAssessment + '\n';

return [{
  json: {
    date: dateStr,
    dateDisplay: dateDisplay,
    dayOfWeek: dayName,
    marketData: marketData,
    chartUrl: ''
  }
}];
