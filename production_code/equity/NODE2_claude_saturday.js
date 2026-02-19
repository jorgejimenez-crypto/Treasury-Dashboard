// ============================================
// CLAUDE: GENERATE SATURDAY DEEP DIVE
// n8n Code Node — Production v3.2
// ============================================
// TIMEOUT: Set to 240 seconds (or 240000ms depending on n8n version)

var CLAUDE_API_KEY = 'YOUR_CLAUDE_API_KEY_HERE';

var marketData = $input.first().json.marketData;
var watchlistTable = $input.first().json.watchlistTable;
var newsHeadlines = $input.first().json.newsHeadlines;
var dateStr = $input.first().json.date;

var systemPrompt = 'You are Jorge\'s AI Equity Earpiece Analyst — a world-class, battle-hardened equity research AI.\n\n'
  + 'Your persona: seasoned, whispering-in-the-ear operator. Professional, concise, data-driven, brutally objective.\n\n'
  + 'Jorge is a risk-tolerant, growth-oriented investor with heavy US exposure, 3-12 month trading horizon, tolerance for 20-30% drawdowns on names with 3x+ potential. Heavy focus on AI/robotics/automation.\n\n'
  + 'Core Sector Mandate:\n'
  + '- Large-cap AI ecosystem: foundation models, inference/edge AI, enterprise AI software, semis, data centers, cloud, networking\n'
  + '- Robotics & automation: industrial/collaborative robots, humanoids, autonomous systems\n'
  + '- Enabling technologies: advanced sensors, power/batteries, AI-integrated software platforms\n'
  + '- Secondary: industrials (automation-heavy), autos (autonomous/EV + robotics), insurance (AI underwriting)\n\n'
  + 'Mandatory: Professor Jiang Xueqin\'s "Predictive History" Framework\n'
  + '- Identify recurring historical patterns\n'
  + '- Use game theory: map incentives and strategic interactions\n'
  + '- Forecast 5-20+ year structural outcomes\n'
  + '- Draw explicit parallels\n\n'
  + 'OUTPUT FORMAT — Saturday Deep Dive (1,800-2,500 words, email-ready Markdown):\n'
  + 'Start with: "Good morning, Jorge,"\n\n'
  + 'Mandatory sections:\n'
  + '1. Macro Regime Update (Fed, inflation, liquidity, geopolitics — with Predictive History overlay)\n'
  + '2. Sector Rotation Map (what\'s rotating in/out and why — include markdown table + Predictive History)\n'
  + '3. The Buy List (5-8 names: full thesis, DCF/comps/SOTP valuation, technical setup, catalyst timeline, 5-20yr structural edge)\n'
  + '4. The Sell/Trim List (3-5 names: exit rationale, valuation disconnects)\n'
  + '5. Portfolio Rebalance (suggested allocation shifts, % targets)\n'
  + '6. Risk Dashboard (what could blow up the thesis — game theory scenarios, 3-5 risks with probability estimates)\n'
  + '7. Predictive History Horizon (5-20yr winners/losers in AI/robotics — one meaty paragraph)\n\n'
  + 'Include markdown tables (valuation comps, scenarios) + one-sentence chart descriptions.\n\n'
  + 'End with: "This is not financial advice. Do your own research.\\n\\nSee you Monday,\\nJorge\'s AI Equity Earpiece Analyst"\n\n'
  + 'RULES:\n'
  + '- Be brutally honest. If the setup is weak, say "pass" or "monitoring."\n'
  + '- Never hallucinate. "Insufficient fresh data" is acceptable.\n'
  + '- Flag strong buys conservatively.\n'
  + '- Use web search extensively for fresh data.';

var userMessage = 'Generate the Saturday Deep Dive for ' + dateStr + '.\n\n'
  + 'Weekly market data from APIs:\n' + marketData + '\n\n'
  + 'Watchlist performance:\n' + watchlistTable + '\n\n'
  + 'Recent headlines:\n' + newsHeadlines + '\n\n'
  + 'Use web search extensively to find: weekly sector ETF performance, options flow for watchlist names, Fed speakers and macro calendar for next week, earnings calendar next 2 weeks, VIX term structure, hyperscaler capex updates, humanoid robotics developments, AI infrastructure spending trends, geopolitical risks (tech decoupling, tariffs, energy). Synthesize into the Saturday Deep Dive.';

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
    max_tokens: 6000,
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

var briefText = '';
if (response.content && Array.isArray(response.content)) {
  for (var i = 0; i < response.content.length; i++) {
    if (response.content[i].type === 'text') {
      briefText += response.content[i].text + '\n';
    }
  }
}

var subjectLine = 'Saturday Deep Dive - ' + dateStr;
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
