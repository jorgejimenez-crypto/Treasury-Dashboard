# AI Equity Earpiece Analyst & Treasury Intelligence Briefing System

Fully automated AI-powered investment research and treasury intelligence platform. Delivers daily briefs and weekly deep dives via email, powered by Claude API + n8n automation on a DigitalOcean droplet.

## System Overview

**Two independent briefing systems, four n8n workflows:**

| System | Schedule | Output | Model |
|--------|----------|--------|-------|
| Equity Daily Brief | Mon-Fri 6:30 AM AST | ~450 word email | Claude Sonnet 4.5 |
| Equity Saturday Deep Dive | Sat 7:00 AM AST | ~2,000 word research memo | Claude Sonnet 4.5 |
| Treasury Daily Brief | Mon-Fri 6:30 AM AST | ~600 word email | Claude Sonnet 4.5 |
| Treasury Weekly Memo | Sat 7:00 AM AST | ~1,400 word strategic memo | Claude Sonnet 4.5 |

**Monthly cost: ~$22-36**

## Architecture

```
Schedule Trigger → Fetch Market Data (APIs) → Claude API (with web search) → Process Response → Google Drive → Gmail
```

**Data sources:** Finnhub (quotes, news, earnings), Alpha Vantage (yields, FX, commodities), Claude web search (real-time macro, Fed, geopolitics)

## Repo Structure

```
├── production_code/
│   ├── equity/
│   │   ├── NODE1_fetch_market_data.js    # Finnhub + Alpha Vantage data fetcher
│   │   ├── NODE2_claude_daily.js         # Claude API call — daily brief
│   │   ├── NODE2_claude_saturday.js      # Claude API call — Saturday deep dive
│   │   └── NODE3_process_response.js     # Markdown → HTML email + Drive upload
│   └── treasury/
│       ├── NODE1_fetch_data.js           # Treasury yield data fetcher
│       ├── NODE2_claude_daily.js         # Claude API call — daily treasury brief
│       ├── NODE2_claude_saturday.js      # Claude API call — weekly memo
│       └── NODE3_process_response.js     # Markdown → HTML with yield curve chart
├── prompts/
│   ├── equity/
│   │   ├── daily_system_prompt.md        # Full equity analyst persona
│   │   └── saturday_system_prompt.md     # Saturday deep dive spec
│   └── treasury/
│       ├── daily_system_prompt.md        # Treasury strategist persona
│       └── weekly_system_prompt.md       # Weekly memo spec
├── docs/
│   └── QUICK_REFERENCE.txt              # One-page deployment cheat sheet
├── .gitignore
└── README.md
```

## Setup

### Prerequisites

- DigitalOcean droplet (Ubuntu, $6/mo minimum)
- n8n self-hosted on the droplet
- API keys: Anthropic (Claude), Finnhub (free), Alpha Vantage (free)
- Google Cloud project with Gmail + Drive APIs enabled

### Deployment Steps

1. **Replace API keys** in all NODE1 and NODE2 files:
   - `YOUR_FINNHUB_KEY_HERE` → your Finnhub key
   - `YOUR_ALPHAVANTAGE_KEY_HERE` → your Alpha Vantage key
   - `YOUR_CLAUDE_API_KEY_HERE` → your Anthropic API key

2. **Create n8n workflows** (4 total). Each follows the same node chain:
   - Schedule Trigger → Code (NODE1) → Code (NODE2) → Code (NODE3) → Google Drive → Gmail

3. **Paste code** into each Code node:
   - NODE1 and NODE3 are shared between daily and Saturday workflows (within each system)
   - NODE2 is different — daily gets the daily variant, Saturday gets the Saturday variant

4. **Configure Gmail node expressions:**
   - Subject: `{{ $('Process Response').first().json.emailSubject }}`
   - Message: `{{ $('Process Response').first().json.emailHtml }}`

5. **Configure Google Drive node:**
   - Binary field key: `data`

6. **Set Code node timeouts:**
   - Daily NODE2: 180 seconds
   - Saturday NODE2: 240 seconds

### Critical Rules

- **No template literals** — all code uses string concatenation for n8n copy-paste compatibility
- **Code nodes only** for Claude API calls — never use HTTP Request nodes
- **Right-click → Open With → Notepad** when editing .js files on Windows
- **Wait 60s** between manual Claude node tests to avoid rate limits
- **Delete orphan nodes** before adding replacements in n8n

## Equity Analyst Specification

The equity system implements "Jorge's AI Equity Earpiece Analyst" — a large-cap generalist focused on the AI/robotics/automation secular theme. Key features:

- **Predictive History Framework** (Professor Jiang Xueqin): historical pattern matching, game theory analysis, 5-20yr structural forecasting
- **Watchlist:** NVDA, AVGO, AMAT, ANET, TSM, AMD, MU, ARM, MRVL, CSCO, CRWV, TSLA, PLTR, CRM, NOW, ORCL, SMCI, APP, QCOM, INTC, DELL
- **Saturday Deep Dive sections:** Macro Regime, Sector Rotation Map, Buy List (5-8 names with full valuation), Sell/Trim List, Portfolio Rebalance, Risk Dashboard, Predictive History Horizon

## Treasury System Specification

The treasury system delivers institutional-grade funding and rates intelligence:

- Yield curve analysis with embedded QuickChart visualization
- ON RRP / SRP monitoring for liquidity signals
- SOFR tracking, Fed Funds rate, CME FedWatch integration
- Banking and credit stress monitoring
- Weekly strategic outlook with calendar

## Security Notes

- All API keys are replaced with placeholders (`YOUR_*_KEY_HERE`)
- Keep this repo **private** — architecture docs reference infrastructure details
- Rotate API keys periodically
- Fine-grained GitHub tokens recommended (7-day expiry, single-repo scope)

## License

Private. Not for redistribution.
