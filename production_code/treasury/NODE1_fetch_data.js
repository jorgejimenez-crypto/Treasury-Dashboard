// ============================================
// FETCH TREASURY DATA (Daily + Saturday)
// n8n Code Node — Production v3.2
// ============================================

var AV_KEY = 'YOUR_ALPHAVANTAGE_KEY_HERE';

var today = new Date();
var dateStr = today.toISOString().split('T')[0];
var dayName = today.toLocaleDateString('en-US', { weekday: 'long', timeZone: 'America/Puerto_Rico' });

var oneWeekAgo = new Date(today);
oneWeekAgo.setDate(today.getDate() - 7);
var oneWeekAgoStr = oneWeekAgo.toISOString().split('T')[0];

var twoWeeksAgo = new Date(today);
twoWeeksAgo.setDate(today.getDate() - 14);
var twoWeeksAgoStr = twoWeeksAgo.toISOString().split('T')[0];

async function httpGet(url) {
  return await this.helpers.httpRequest({ method: 'GET', url: url, json: true });
}

async function getTreasuryYield(maturity) {
  try {
    var url = 'https://www.alphavantage.co/query?function=TREASURY_YIELD&interval=daily&maturity=' + maturity + '&apikey=' + AV_KEY;
    var data = await httpGet.call(this, url);
    if (data && data.data && data.data.length > 0) {
      return data.data.slice(0, 15);
    }
    return null;
  } catch (e) {
    return null;
  }
}

async function getFedFundsRate() {
  try {
    var url = 'https://www.alphavantage.co/query?function=FEDERAL_FUNDS_RATE&interval=daily&apikey=' + AV_KEY;
    var data = await httpGet.call(this, url);
    if (data && data.data && data.data.length > 0) {
      return data.data[0];
    }
    return null;
  } catch (e) {
    return null;
  }
}

function findValueForDate(dataArray, targetDate) {
  if (!dataArray || dataArray.length === 0) return 'N/A';
  var exact = dataArray.find(function(d) { return d.date === targetDate; });
  if (exact) return exact.value;
  var target = new Date(targetDate);
  var closest = null;
  var closestDiff = Infinity;
  for (var i = 0; i < dataArray.length; i++) {
    var itemDate = new Date(dataArray[i].date);
    var diff = Math.abs(target - itemDate);
    if (itemDate <= target && diff < closestDiff) {
      closestDiff = diff;
      closest = dataArray[i];
    }
  }
  return closest ? closest.value : 'N/A';
}

// Fetch all maturities
var maturities = ['3month', '2year', '5year', '7year', '10year', '30year'];
var yieldData = {};
for (var i = 0; i < maturities.length; i++) {
  yieldData[maturities[i]] = await getTreasuryYield.call(this, maturities[i]);
}
var fedFunds = await getFedFundsRate.call(this);

// Build yield table
var marketData = '## Treasury Yields (Latest Available)\n\n';
marketData += '| Maturity | Current | 1 Week Ago | 2 Weeks Ago |\n';
marketData += '|----------|---------|------------|-------------|\n';

for (var j = 0; j < maturities.length; j++) {
  var m = maturities[j];
  var current = findValueForDate(yieldData[m], dateStr);
  var weekAgo = findValueForDate(yieldData[m], oneWeekAgoStr);
  var twoWeekAgo = findValueForDate(yieldData[m], twoWeeksAgoStr);
  marketData += '| ' + m + ' | ' + current + '% | ' + weekAgo + '% | ' + twoWeekAgo + '% |\n';
}

if (fedFunds) {
  marketData += '\nFed Funds Rate (effective): ' + fedFunds.value + '% (as of ' + fedFunds.date + ')\n';
}

// Build chart data for QuickChart
var chartLabels = [];
var chartValues = [];
var shortEnd = ['3month', '2year', '5year', '7year', '10year', '30year'];
for (var k = 0; k < shortEnd.length; k++) {
  chartLabels.push(shortEnd[k]);
  chartValues.push(parseFloat(findValueForDate(yieldData[shortEnd[k]], dateStr)) || 0);
}

var chartConfig = JSON.stringify({
  type: 'line',
  data: {
    labels: chartLabels,
    datasets: [{
      label: 'Yield Curve (' + dateStr + ')',
      data: chartValues,
      borderColor: '#1f2937',
      backgroundColor: 'rgba(31,41,55,0.1)',
      fill: true,
      tension: 0.3
    }]
  },
  options: {
    plugins: { title: { display: true, text: 'US Treasury Yield Curve' } },
    scales: { y: { beginAtZero: false, title: { display: true, text: 'Yield (%)' } } }
  }
});

var chartUrl = 'https://quickchart.io/chart?c=' + encodeURIComponent(chartConfig) + '&w=600&h=300';

var dateDisplay = dayName + ', ' + today.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'America/Puerto_Rico' });

return [{
  json: {
    date: dateStr,
    dateDisplay: dateDisplay,
    dayOfWeek: dayName,
    marketData: marketData,
    chartUrl: chartUrl
  }
}];
