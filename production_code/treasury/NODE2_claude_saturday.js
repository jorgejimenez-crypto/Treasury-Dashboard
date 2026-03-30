// ============================================
// CLAUDE TREASURY MEMO — SATURDAY v4.1
// Paste into CODE node (JavaScript mode)
// Replace YOUR_API_KEY_HERE with your Claude key
// ============================================

var CLAUDE_API_KEY = 'YOUR_API_KEY_HERE';

var marketData = $input.first().json.marketData;
var dateDisplay = $input.first().json.dateDisplay;
var date = $input.first().json.date;

var systemPrompt = 'You are a senior treasury strategist producing a weekly intelligence memo for a Financial Analyst at a commodity and rates trading firm. This memo is professional enough to forward to a Finance Director or CFO. Every claim must be grounded in observable, sourced data. STRICT RULES: 1) Start IMMEDIATELY with Subject: Weekly Treasury Memo - [date]: [factual hook]. No preamble. 2) INFORM only. Never instruct. Never say what the reader should do. 3) Never reference any individuals at the firm or the firm by name. 4) Length: 1200-1600 words. Before finalizing, count your words. If over 1600: cut Strategic Outlook to exactly 2 themes, trim Funding Deep Dive to 3 paragraphs, remove any section with no material news this week. 5) For every data point, include source and date inline (e.g., SOFR at 4.33%, NY Fed, Feb 14). 6) No bold (**) markers. No citation brackets. Clean prose. 7) Commodity pulse data is pre-fetched and provided to you. Use it directly in section 1 — do not search the web for WTI, Brent, natural gas, heating oil, or copper prices. 8) For all other data (SOFR, yields, FedWatch, etc.), search the web and source inline. FORMAT (strict order): Subject: Weekly Treasury Memo - [Date]: [factual hook] Good morning, ### 1. Commodity and Margin Week in Review Use the pre-fetched commodity pulse data. State each commodity: current price and week-on-week direction. Assess whether the weeks commodity moves created elevated, moderate, or normal collateral pressure. 2-3 sentences on which books were most affected and why. ### 2. Executive Summary 3-4 sentences. Must include: this weeks 10Y yield change in bps, current SOFR level, and dominant market narrative. No opinions without data. Written as if briefing a CFO in an elevator. ### 3. Rates Regime and Fed Outlook Key economic data this week vs consensus. Fed speakers and lean. Next FOMC meeting date and days away. CME FedWatch probabilities with pull date. Treasury auction results. Curve shape and 1-3 month outlook. ### 4. Funding and Liquidity Deep Dive SOFR weekly trend, then ON RRP trend, then SRP, then QT pace. Maximum 4 paragraphs. End with one sentence net assessment of liquidity posture. ### 5. Banking and Credit Intelligence FDIC enforcement actions, consent orders, or failures only. IG/HY CDX moves if material. Bullet points, each sourced. If nothing material: one line only. ### 6. Short-End Yield Curve Analysis Strict markdown table: | Tenor | Yield | Spread to SOFR | WoW Change | Cover 3M, 6M, 1Y, 2Y. Then 2-3 sentences on curve shape and one sentence on forward implication for funding costs. ### 7. Strategic Outlook Exactly 2 building themes this week. For each: one sentence theme, 3-6 month implication, one non-obvious second-order effect. Prose only, no bullets. Do not repeat section 3. ### 8. Week Ahead Calendar Strict markdown table: | Date | Release | Consensus | Prior | High-priority US releases only. Max 8 rows. Source consensus from Bloomberg, Trading Economics, or Investing.com in that priority order. End with exactly: --- This is not financial advice. Internal use only. See you Monday - Treasury Brief WEB SEARCH SOURCE PRIORITY: 1) newyorkfed.org for SOFR, ON RRP, SRP. 2) cmegroup.com for FedWatch. 3) fred.stlouisfed.org for yields. 4) treasurydirect.gov for auction results. 5) WSJ, Reuters, FT for news. 6) fdic.gov for bank actions. 7) Bloomberg, Trading Economics, or Investing.com for calendar. Avoid blogs or undated sources.';

var userMessage = 'Today is ' + dateDisplay + ' (Saturday). Generate the Weekly Treasury Memo.\n\nPre-fetched commodity pulse data (use directly, do not re-search these):\n' + marketData + '\n\nSearch the web for: this weeks SOFR trend, ON RRP weekly data, SRP usage, CME FedWatch probabilities and next FOMC meeting date, Treasury auction results this week, Fed speaker commentary this week, economic data this week vs consensus, FDIC actions or bank failures, current Treasury yields (3M, 6M, 1Y, 2Y, 10Y, 30Y) for the pickup table, and next weeks US economic calendar with consensus. Source all data inline.';

var requestBody = JSON.stringify({
  model: 'claude-sonnet-4-6',
  max_tokens: 5000,
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
  timeout: 240000
});

var memoText = '';
if (response.content && Array.isArray(response.content)) {
  for (var i = 0; i < response.content.length; i++) {
    if (response.content[i].type === 'text') {
      memoText += response.content[i].text;
    }
  }
}

if (!memoText) {
  memoText = 'Error: No text in Claude response.';
}

var subjectIndex = memoText.indexOf('Subject:');
if (subjectIndex > 0) {
  memoText = memoText.substring(subjectIndex);
}

var subjectLine = 'Weekly Treasury Memo - ' + date;
var subjectMatch = memoText.match(/^Subject:\s*(.+)$/m);
if (subjectMatch) {
  subjectLine = subjectMatch[1].trim();
}

memoText = memoText.replace(/\[\d+(?:,\s*\d+)*\]/g, '');
memoText = memoText.replace(/\[(?:Source|Via|Per|From)[^\]]*\]/gi, '');

return [{
  json: {
    briefText: memoText,
    subjectLine: subjectLine,
    date: date
  }
}];
