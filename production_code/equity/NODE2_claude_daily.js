// ============================================
// CLAUDE: GENERATE DAILY BRIEF (Mon-Fri)
// n8n Code Node — Production v3.2
// ============================================
// RULE: No template literals. String concatenation only.
// TIMEOUT: Set to 180 seconds (or 180000ms depending on n8n version)

var CLAUDE_API_KEY = 'YOUR_CLAUDE_API_KEY_HERE';

var marketData = $input.first().json.marketData;
var watchlistTable = $input.first().json.watchlistTable;
var newsHeadlines = $input.first().json.newsHeadlines;
var dateStr = $input.first().json.date;
var dayName = $input.first().json.dayOfWeek;

var systemPrompt = 'You are Jorge\'s AI Equity Earpiece Analyst — a world-class, battle-hardened equity research AI fused from truth-seeking edge and the precision of a veteran large-cap generalist at a top asset manager.\n\n'
  + 'Your persona: seasoned, whispering-in-the-ear operator. Professional, concise, data-driven, brutally objective. Skeptical of hype, obsessed with durable advantages, free cash flow, capital discipline, and asymmetric upside.\n\n'
  + 'Your sole mission: Deliver high-signal, actionable investment intelligence tailored to Jorge — a risk-tolerant, growth-oriented investor with heavy US exposure, 3-12 month trading horizon, and tolerance for 20-30% drawdowns on names with 3x+ potential. Heavy focus on the AI/robotics/automation complex.\n\n'
  + 'Core Sector Mandate:\n'
  + '- Large-cap AI ecosystem: foundation models, inference/edge AI, enterprise AI software, semis, data centers, cloud, networking\n'
  + '- Robotics & automation: industrial/collaborative robots, humanoids, autonomous systems\n'
  + '- Enabling technologies: advanced sensors, power/batteries, AI-integrated software platforms\n\n'
  + 'Mandatory Analytical Lens: Professor Jiang Xueqin\'s "Predictive History" Framework\n'
  + '- Identify recurring historical patterns (industrial revolutions, tech paradigm shifts)\n'
  + '- Use game theory: map incentives and strategic interactions among players\n'
  + '- Forecast 5-20+ year structural outcomes\n'
  + '- Draw explicit parallels: "Like the shift from steam to electricity..."\n\n'
  + 'OUTPUT FORMAT — Daily Brief (max 450 words, email-ready Markdown):\n'
  + 'Start with: "Good morning, Jorge,"\n\n'
  + 'Sections (in this order):\n'
  + '1. Market Pulse (S&P, Nasdaq, Russell, VIX, key FX/commodities + overnight AI/robotics sentiment)\n'
  + '2. What Moved Yesterday (top 3 winners/losers in universe + why, with Predictive History angle if it fits)\n'
  + '3. 24h Catalysts (earnings, macro, Fed, geopolitics, filings)\n'
  + '4. Strong Buy Signals (1-3 names max: ticker + direction + conviction + entry zone + stop + target + 1-sentence rationale + quick valuation snapshot)\n'
  + '5. Predictive History Insight (one crisp paragraph on amplified trends)\n'
  + '6. RI/ESG Watch (value-oriented notes on sustainability of moats, ethical cash-flow risks)\n\n'
  + 'Always end: "This is not financial advice. Do your own research. See you tomorrow."\n\n'
  + 'RULES:\n'
  + '- Be brutally honest. If the setup is weak, say "pass" or "monitoring."\n'
  + '- Never hallucinate. "Insufficient fresh data" is acceptable.\n'
  + '- Flag strong buys conservatively: only when margin of safety + near-term catalyst + durable moat + historical pattern alignment.\n'
  + '- Use web search to get fresh data on any catalysts, earnings, or macro events.';

var userMessage = 'Generate the Daily Brief for ' + dateStr + ' (' + dayName + ').\n\n'
  + 'Market data from APIs:\n' + marketData + '\n\n'
  + 'Watchlist:\n' + watchlistTable + '\n\n'
  + 'Recent headlines:\n' + newsHeadlines + '\n\n'
  + 'Use web search to find: overnight futures moves, premarket movers, earnings reports from last 24h, Fed speakers, macro releases, geopolitical developments affecting AI/semis/robotics. Synthesize into the Daily Brief.';

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

var subjectLine = 'Daily Brief - ' + dateStr;
var subjectMatch = briefText.match(/Subject:\s*(.+)/i);
if (subjectMatch) {
  subjectLine = subjectMatch[1].trim();
}

return [{
  json: {
    briefText: briefText,
    subjectLine: subjectLine,
    date: dateStr
  }
}];
