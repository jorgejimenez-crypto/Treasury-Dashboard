// ============================================
// CLAUDE: GENERATE WEEKLY TREASURY MEMO (Saturday)
// n8n Code Node — Production v3.2
// ============================================

var CLAUDE_API_KEY = 'YOUR_CLAUDE_API_KEY_HERE';

var marketData = $input.first().json.marketData;
var dateDisplay = $input.first().json.dateDisplay;

var systemPrompt = 'You are a senior treasury strategist AI producing a weekly intelligence memo for a Financial Analyst at a commodity/power/rates trading firm. Synthesize the weeks developments into a strategic view of funding conditions, rates trajectory, liquidity, and banking stability.\n\n'
  + 'RULES:\n'
  + '- Memo quality. Professional enough to forward to a Finance Director or CFO.\n'
  + '- INFORM only. Never instruct. Never say what the reader should do.\n'
  + '- Never reference any individuals or the firm by name.\n'
  + '- Length: 1200-1600 words.\n'
  + '- If data unavailable, say so.\n\n'
  + 'Sections:\n'
  + '1. Executive Summary — 3-4 sentence overview of the week.\n'
  + '2. Rates & Fed Policy — Weekly yield moves, curve shape, Fed commentary, FedWatch consensus, auction results, curve moves, 1-3 month outlook.\n'
  + '3. Funding and Liquidity Deep Dive — SOFR/repo trend, ON RRP trend, SRP, QT pace, net assessment.\n'
  + '4. Banking and Credit Intelligence — FDIC actions, bank developments.\n'
  + '5. Short-End Yield Curve Analysis — Shape, pickup analysis, forward view.\n'
  + '6. Strategic Outlook — 3-6 month forward, 2-3 building themes, second-order effects.\n'
  + '7. Week Ahead Calendar — Markdown table: Date | Release | Consensus | Prior. ONLY high-priority US releases.\n\n'
  + 'End with: *This is not financial advice. Internal use only.*\nSee you Monday - Treasury Brief';

var userMessage = 'Today is ' + dateDisplay + ' (Saturday). Generate the Weekly Strategic Treasury Memo covering this past week.\n\nLatest market data from APIs:\n\n' + marketData + '\n\nUse web search extensively for: this weeks economic data results, SOFR weekly trend, ON RRP and SRP weekly data, Fed speaker commentary, CME FedWatch, Treasury auction results, banking/credit news, FDIC actions, repo conditions, next weeks calendar. Synthesize into the Weekly Strategic Treasury Memo.';

var response = await this.helpers.httpRequest({
  method: 'POST',
  url: 'https://api.anthropic.com/v1/messages',
  headers: {
    'Content-Type': 'application/json',
    'x-api-key': CLAUDE_API_KEY,
    'anthropic-version': '2023-06-01'
  },
  body: {
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
  },
  timeout: 240000
});

var memoText = '';
if (response.content && Array.isArray(response.content)) {
  for (var i = 0; i < response.content.length; i++) {
    if (response.content[i].type === 'text') {
      memoText += response.content[i].text + '\n';
    }
  }
}

var subjectLine = 'Weekly Strategic Treasury Memo - ' + $input.first().json.date;
var subjectMatch = memoText.match(/Subject:\s*(.+)/i);
if (subjectMatch) {
  subjectLine = subjectMatch[1].trim();
}

return [{
  json: {
    briefText: memoText,
    subjectLine: subjectLine,
    chartUrl: $input.first().json.chartUrl,
    date: $input.first().json.date
  }
}];
