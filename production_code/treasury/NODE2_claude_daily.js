// ============================================
// CLAUDE TREASURY BRIEF — DAILY v4.1
// Paste into CODE node (JavaScript mode)
// Replace YOUR_API_KEY_HERE with your Claude key
// ============================================

var CLAUDE_API_KEY = 'YOUR_API_KEY_HERE';

var marketData = $input.first().json.marketData;
var dateDisplay = $input.first().json.dateDisplay;
var date = $input.first().json.date;

var systemPrompt = 'You are a senior treasury strategist delivering a morning intelligence brief to a peer-level Financial Analyst at a commodity and rates trading firm. Your output is a situational awareness tool, not commentary. Every claim must be grounded in observable, sourced data. STRICT RULES: 1) Start IMMEDIATELY with Subject: Daily Treasury Brief - [date]: [factual hook]. No preamble. 2) INFORM only. Never instruct. Never say what the reader should do. Present facts, data, and measurable context. Let the reader draw conclusions. 3) Never reference any individuals at the firm or the firm by name. 4) Maximum 550 words after the Subject line. Dense, factual, sourced. If you exceed 550 words, cut from section 3 or 4 first. Never cut sections 1, 2, or 5. 5) If data is unavailable, state so in one phrase and move on. Never speculate or fabricate figures. 6) Write clean prose. Use ### headers. Use bullet points only in the Banking section. No bold (**) markers. 7) No citation markers, brackets, or reference numbers. Write clean inline attribution only: example: SOFR printed at 4.33% (NY Fed, Feb 14). 8) Commodity pulse data is pre-fetched and provided to you. Use it directly — do not search the web for WTI, Brent, natural gas, heating oil, or copper prices. Reference and interpret the provided commodity data in section 1. 9) For all other data (SOFR, ON RRP, FedWatch, DXY, VIX, Treasury yields, etc.), source inline with date. FORMAT (strict order): Subject: Daily Treasury Brief - [Date]: [factual hook] Good morning, ### 1. Commodity and Margin Pulse Open with the pre-fetched collateral pressure signal. State each commodity: price, DoD move in % and $ terms. State the WTI/Brent spread. 2-3 sentences on what the moves mean for margin call exposure today. ### 2. Funding and Liquidity Pulse SOFR with source and date. Fed Funds Effective if available. ON RRP take-up with source. SRP usage with source. One sentence net assessment of liquidity conditions. ### 3. Fed Watch Next FOMC meeting date and days away. CME FedWatch probabilities with pull date. Fed speakers past 24h and lean. One sentence on consensus drift direction. ### 4. Todays Volatility Windows Strict markdown table only: | Time (ET) | Event | Consensus | Prior | High-impact releases only. If none, state in one line. ### 5. Banking and Credit Stress FDIC enforcement actions, consent orders, or failures only. IG/HY CDX moves if material. Skip routine bank news. Bullet points sourced. If nothing material: one line only. ### 6. Economic Calendar This Week Strict markdown table: | Date | Release | Consensus | Prior | High-priority US releases only. Max 8 rows. Source consensus from Bloomberg, Trading Economics, or Investing.com. End with exactly: --- This is not financial advice. Internal use only. See you tomorrow - Treasury Brief WEB SEARCH SOURCE PRIORITY: 1) newyorkfed.org for SOFR, ON RRP, SRP. 2) cmegroup.com for FedWatch. 3) fred.stlouisfed.org for Treasury yields. 4) WSJ, Reuters, FT for news. 5) fdic.gov for bank actions. 6) Investing.com or Trading Economics for calendar. Avoid blogs or undated sources.';

var userMessage = 'Today is ' + dateDisplay + '. Generate the Daily Treasury Brief.\n\nPre-fetched commodity pulse data (use directly, do not re-search these):\n' + marketData + '\n\nSearch the web for: current SOFR rate, ON RRP take-up, SRP usage, CME FedWatch probabilities and next FOMC meeting date, current Treasury yields (2Y, 10Y, 30Y), DXY, VIX, fed funds futures nearest expiry, this weeks US economic calendar with consensus, Fed speakers this week, FDIC and banking headlines. Source all data inline.';

var requestBody = JSON.stringify({
  model: 'claude-sonnet-4-6',
  max_tokens: 3500,
  system: systemPrompt,
  tools: [
    {
      type: 'web_search_20250305',
      name: 'web_search'
    }
  ],
  messages: [
    { role: 'user', content: userMessage }
  ]
});

var response = await this.helpers.httpRequest({
  method: 'POST',
  url: 'https://api.anthropic.com/v1/messages',
  headers: {
    'Content-Type': 'application/json',
    'x-api-key': CLAUDE_API_KEY,
    'anthropic-version': '2023-06-01'
  },
  body: requestBody,
  timeout: 180000
});

var briefText = '';
if (response.content && Array.isArray(response.content)) {
  for (var i = 0; i < response.content.length; i++) {
    if (response.content[i].type === 'text') {
      briefText += response.content[i].text;
    }
  }
}

if (!briefText) {
  briefText = 'Error: No text in Claude response.';
}

var subjectIndex = briefText.indexOf('Subject:');
if (subjectIndex > 0) {
  briefText = briefText.substring(subjectIndex);
}

var subjectLine = 'Daily Treasury Brief - ' + date;
var subjectMatch = briefText.match(/^Subject:\s*(.+)$/m);
if (subjectMatch) {
  subjectLine = subjectMatch[1].trim();
}

briefText = briefText.replace(/\[\d+(?:,\s*\d+)*\]/g, '');
briefText = briefText.replace(/\[(?:Source|Via|Per|From)[^\]]*\]/gi, '');

return [{
  json: {
    briefText: briefText,
    subjectLine: subjectLine,
    date: date
  }
}];
