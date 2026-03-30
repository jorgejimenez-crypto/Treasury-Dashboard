// ============================================
// CLAUDE TREASURY BRIEF — DAILY v4.0
// Paste into CODE node (JavaScript mode)
// Replace YOUR_API_KEY_HERE with your Claude key
// ============================================

var CLAUDE_API_KEY = 'YOUR_API_KEY_HERE';

var marketData = $input.first().json.marketData;
var dateDisplay = $input.first().json.dateDisplay;
var date = $input.first().json.date;

var systemPrompt = 'You are a senior treasury strategist delivering a morning intelligence brief to a peer-level Financial Analyst at a commodity and rates trading firm. Your output is a situational awareness tool, not commentary. Every claim must be grounded in observable, sourced data. STRICT RULES: 1) Start IMMEDIATELY with Subject: Daily Treasury Brief - [date]: [factual hook]. No preamble. 2) INFORM only. Never instruct. Never say what the reader should do. Present facts, data, and measurable context. Let the reader draw conclusions. 3) Never reference any individuals at the firm or the firm by name. 4) Maximum 550 words after the Subject line. Dense, factual, sourced. If you exceed 550 words, cut from section 3 or 4 first. Never cut sections 1, 2, or 5. 5) If data is unavailable, state so in one phrase and move on. Never speculate or fabricate figures. 6) Write clean prose. Use ### headers. Use bullet points (- ) for Banking section only. No bold (**) markers. 7) Do not include citation markers, brackets, or reference numbers in your prose. Write clean inline attribution: example: SOFR printed at 4.33% (NY Fed, Feb 14). 8) A formatted yield table with directional arrows is embedded in the email automatically after the Funding header. Do NOT build a yield table in your text. Reference the yield data in prose only. 9) For every data point you cite (SOFR, ON RRP, FedWatch, DXY, VIX, crude, etc.), include the source and date inline. FORMAT (strict order): Subject: Daily Treasury Brief - [Date]: [factual hook] Good morning, ### 1. Cross-Asset Pulse 2-3 sentences. Risk-on/off, VIX level with source date, equity direction, DXY, front-month crude, fed funds futures nearest expiry. All sourced. One sentence on what the cross-asset setup implies for rates. ### 2. Funding and Liquidity Pulse SOFR with source and date. Fed Funds Effective if available. Reference the yield data provided (do not rebuild the table). ON RRP take-up with source. SRP usage with source. One sentence net assessment of overall liquidity conditions. ### 3. Fed Watch State the next FOMC meeting date and the number of days away. CME FedWatch cut/hold/hike probabilities for that meeting with the date the data was pulled. Any Fed speakers from the past 24 hours and their policy lean. One sentence on which direction consensus is drifting. ### 4. Todays Volatility Windows High-impact releases only with time (ET) and consensus. Fed speakers with topic if known. If holiday or no releases, state in one line. Strict markdown table: | Time (ET) | Event | Consensus | Prior | ### 5. Banking and Credit Stress FDIC enforcement actions, consent orders, or bank failures only. Systemic credit spread moves (IG/HY CDX) if material. Skip minor bank earnings or routine press releases. 3-5 bullet points, each sourced. If nothing material: write "No material banking actions in the past 24h." in one line. ### 6. Economic Calendar This Week Strict markdown table: | Date | Release | Consensus | Prior | Include ONLY high-priority US releases: CPI, PPI, PCE, GDP, NFP, ISM, retail sales, housing starts, industrial production, FOMC minutes, Treasury auctions. Source consensus from Bloomberg, Trading Economics, or Investing.com in that priority order. Max 8 rows. End with exactly: --- This is not financial advice. Internal use only. See you tomorrow - Treasury Brief WEB SEARCH SOURCE PRIORITY: 1) newyorkfed.org for SOFR, ON RRP, SRP. 2) cmegroup.com for FedWatch probabilities. 3) fred.stlouisfed.org for historical rate series. 4) WSJ, Reuters, FT for news and Fed speaker coverage. 5) fdic.gov for bank enforcement actions. 6) Investing.com or Trading Economics for calendar consensus. Avoid blogs, aggregators, or undated sources.';

var userMessage = 'Today is ' + dateDisplay + '. Generate the Daily Treasury Brief.\n\nStructured market data:\n' + marketData + '\n\nSearch the web for: current SOFR rate, ON RRP take-up, SRP usage, CME FedWatch probabilities and next FOMC meeting date, DXY, VIX, front-month crude, fed funds futures, this weeks US economic calendar with consensus estimates, Fed speakers this week, and banking/FDIC headlines. Produce the brief with all data sourced inline.';

var requestBody = JSON.stringify({
  model: 'claude-sonnet-4-5-20250929',
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

// Strip preamble before Subject:
var subjectIndex = briefText.indexOf('Subject:');
if (subjectIndex > 0) {
  briefText = briefText.substring(subjectIndex);
}

// Extract subject line
var subjectLine = 'Daily Treasury Brief - ' + date;
var subjectMatch = briefText.match(/^Subject:\s*(.+)$/m);
if (subjectMatch) {
  subjectLine = subjectMatch[1].trim();
}

// Clean citation artifacts
briefText = briefText.replace(/\[\d+(?:,\s*\d+)*\]/g, '');
briefText = briefText.replace(/\[(?:Source|Via|Per|From)[^\]]*\]/gi, '');

return [{
  json: {
    briefText: briefText,
    subjectLine: subjectLine,
    date: date
  }
}];
