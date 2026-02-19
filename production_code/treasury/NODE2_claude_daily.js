// ============================================
// CLAUDE: GENERATE DAILY TREASURY BRIEF (Mon-Fri)
// n8n Code Node — Production v3.2
// ============================================

var CLAUDE_API_KEY = 'YOUR_CLAUDE_API_KEY_HERE';

var marketData = $input.first().json.marketData;
var dateDisplay = $input.first().json.dateDisplay;

var systemPrompt = 'You are a senior treasury strategist AI briefing a Financial Analyst at a commodity/power/rates trading firm. Your job is to deliver a concise, high-signal daily intelligence brief focused on funding conditions, rates, liquidity, and banking sector stability.\n\n'
  + 'Tone & Style Rules:\n'
  + '- Professional, peer-level, concise. Written as if from a senior colleague whispering context before the day starts.\n'
  + '- INFORM, never instruct. Present data, context, and implications — never tell the reader what to do.\n'
  + '- Never reference any individuals by name. No company-internal names.\n'
  + '- Keep it scannable. A busy treasury professional should absorb this in under 3 minutes.\n'
  + '- When data is unavailable or stale, say so. Never fabricate rates, prices, or figures.\n\n'
  + 'Sections:\n'
  + '1. Rates Snapshot — Treasury yields table with changes. Key takeaway in 1-2 sentences.\n'
  + '2. Funding & Liquidity — SOFR, ON RRP take-up, SRP usage, repo conditions. Fed facilities status.\n'
  + '3. Fed Watch — FedWatch probabilities, recent Fed speakers, next meeting outlook.\n'
  + '4. Banking & Credit — FDIC actions, bank stress signals, credit conditions.\n'
  + '5. Day Ahead — Key releases, auctions, events for today.\n\n'
  + 'End with: *This is not financial advice. Internal use only.*\nSee you tomorrow - Treasury Brief';

var userMessage = 'Today is ' + dateDisplay + '. Generate the Treasury Brief.\n\nMarket data from APIs:\n\n' + marketData + '\n\nUse web search to find: current SOFR rate, ON RRP take-up amount, SRP usage, CME FedWatch probabilities, DXY, todays economic calendar, Fed speakers, banking/liquidity stress headlines. Synthesize into the Treasury Brief.';

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
    max_tokens: 3000,
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
  timeout: 180000
});

var briefText = '';
if (response.content && Array.isArray(response.content)) {
  for (var i = 0; i < response.content.length; i++) {
    if (response.content[i].type === 'text') {
      briefText += response.content[i].text + '\n';
    }
  }
}

var subjectLine = 'Treasury Brief - ' + $input.first().json.date;
var subjectMatch = briefText.match(/Subject:\s*(.+)/i);
if (subjectMatch) {
  subjectLine = subjectMatch[1].trim();
}

return [{
  json: {
    briefText: briefText,
    subjectLine: subjectLine,
    chartUrl: $input.first().json.chartUrl,
    date: $input.first().json.date
  }
}];
