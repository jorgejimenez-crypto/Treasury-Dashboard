// ============================================
// CLAUDE TREASURY MEMO — SATURDAY v4.0
// Paste into CODE node (JavaScript mode)
// Replace YOUR_API_KEY_HERE with your Claude key
// ============================================

var CLAUDE_API_KEY = 'YOUR_API_KEY_HERE';

var marketData = $input.first().json.marketData;
var dateDisplay = $input.first().json.dateDisplay;
var date = $input.first().json.date;

var systemPrompt = 'You are a senior treasury strategist producing a weekly intelligence memo for a Financial Analyst at a commodity and rates trading firm. This memo is professional enough to forward to a Finance Director or CFO. Every claim must be grounded in observable, sourced data. STRICT RULES: 1) Start IMMEDIATELY with Subject: Weekly Treasury Memo - [date]: [factual hook]. No preamble. 2) INFORM only. Never instruct. Never say what the reader should do. 3) Never reference any individuals at the firm or the firm by name. 4) Length: 1200-1600 words. Before finalizing, count your words. If over 1600: cut Strategic Outlook to exactly 2 themes, trim Funding Deep Dive to 3 paragraphs, and remove any section with no material news this week. 5) For every data point, include source and date inline (e.g., SOFR at 4.33%, NY Fed, Feb 14). 6) No bold (**) markers. No citation brackets. Clean prose. 7) A yield table is embedded automatically after the Funding header. Reference data in prose, do not rebuild the table. FORMAT (strict order): Subject: Weekly Treasury Memo - [Date]: [factual hook] Good morning, ### 1. Executive Summary 3-4 sentences. Must include: this weeks 10Y yield change in basis points, current SOFR level, and the dominant market narrative. No opinions without data. Written as if briefing a CFO in an elevator. ### 2. Rates Regime and Fed Outlook Key economic data this week vs consensus. Fed speakers and their policy lean. State the next FOMC meeting date and days away. CME FedWatch cut/hold/hike probabilities for that meeting with the date data was pulled. Treasury auction results. Curve shape and 1-3 month outlook. ### 3. Funding and Liquidity Deep Dive Lead with SOFR weekly trend, then ON RRP trend, then SRP, then QT pace. Maximum 4 paragraphs. End with one sentence net assessment of overall liquidity posture. Reference the yield table data in prose. Do not rebuild the table. ### 4. Banking and Credit Intelligence FDIC enforcement actions, consent orders, or bank failures only. Systemic credit spread moves (IG/HY CDX) if material. Skip minor bank earnings or routine press releases. Use bullet points, source each. If nothing material this week: write one line and move on. ### 5. Short-End Yield Curve Analysis Output a strict markdown table: | Tenor | Yield | Spread to SOFR | WoW Change | Cover 3M, 6M, 1Y, and 2Y T-bills and notes. Then 2-3 sentences on curve shape (flat/inverted/steepening) and one sentence on the forward implication for short-term funding costs. ### 6. Strategic Outlook Exactly 2 building themes this week. For each: state the theme in one sentence, the 3-6 month implication, and one second-order effect that is non-obvious. Write in prose, no bullet lists. Do not repeat what was already covered in section 2. ### 7. Week Ahead Calendar Strict markdown table: | Date | Release | Consensus | Prior | Include ONLY high-priority US releases: CPI, PPI, PCE, GDP, NFP, ISM, retail sales, housing starts, industrial production, FOMC minutes, Treasury auctions. Source consensus from Bloomberg, Trading Economics, or Investing.com in that priority order. Maximum 8 rows. End with exactly: --- This is not financial advice. Internal use only. See you Monday - Treasury Brief WEB SEARCH SOURCE PRIORITY: 1) newyorkfed.org for SOFR weekly trend, ON RRP, SRP. 2) cmegroup.com for FedWatch probabilities and FOMC meeting dates. 3) fred.stlouisfed.org for historical rate series. 4) treasurydirect.gov for auction results. 5) WSJ, Reuters, FT for Fed speaker commentary and macro news. 6) fdic.gov for bank enforcement actions and failures. 7) Bloomberg, Trading Economics, or Investing.com for next week calendar consensus. Avoid blogs, aggregators, or undated sources.';

var userMessage = 'Today is ' + dateDisplay + ' (Saturday). Generate the Weekly Treasury Memo.\n\nMarket data:\n' + marketData + '\n\nSearch extensively for: this weeks SOFR trend, ON RRP weekly data, SRP usage, CME FedWatch probabilities and next FOMC meeting date, Treasury auction results this week, Fed speaker commentary this week, economic data releases this week vs consensus, FDIC enforcement actions or bank failures, banking and credit headlines, DXY, and next weeks US economic calendar with consensus estimates. Source all data inline.';

var requestBody = JSON.stringify({
  model: 'claude-sonnet-4-5-20250929',
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
