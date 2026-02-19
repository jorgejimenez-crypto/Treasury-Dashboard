# Treasury Intelligence Briefing System

Fully automated AI-powered treasury intelligence platform. Delivers daily briefs and weekly strategic memos via email, powered by Claude API + n8n automation on a DigitalOcean droplet.

## System Overview

| Workflow | Schedule | Output | Model |
|----------|----------|--------|-------|
| Daily Treasury Brief | Mon-Fri 6:30 AM AST (10:30 UTC) | ~600 word email | Claude Sonnet 4.5 |
| Weekly Strategic Memo | Sat 7:00 AM AST (11:00 UTC) | ~1,400 word research memo | Claude Sonnet 4.5 |

**Monthly cost: ~$14-21**

## Architecture

```
Schedule Trigger → Fetch Treasury Data (Alpha Vantage) → Claude API (with web search) → Process Response → Google Drive → Gmail
```

**Data sources:** Alpha Vantage (Treasury yields across 6 maturities, Fed Funds rate), QuickChart (yield curve visualization), Claude web search (real-time SOFR, ON RRP, SRP, FedWatch, Fed speakers, banking headlines)

## How It Works

### NODE1 — Fetch Treasury Data (shared by both workflows)

Calls Alpha Vantage sequentially to pull yields for 3-month, 2-year, 5-year, 7-year, 10-year, and 30-year Treasuries plus the effective Fed Funds rate. Uses closest-business-day logic so holidays and weekends don't break lookups. Builds a yield curve chart URL via QuickChart for email embedding. Outputs structured JSON with current yields, 1-week-ago, and 2-week-ago comparisons.

### NODE2 — Claude API Call (daily and Saturday variants)

**Daily variant** sends the yield data to Claude Sonnet 4.5 with a senior treasury strategist system prompt. Claude generates a brief covering: Rates Snapshot, Funding & Liquidity (SOFR, ON RRP, SRP), Fed Watch (FedWatch probabilities, speakers), Banking & Credit (FDIC, stress signals), and Day Ahead (releases, auctions). Web search enabled for real-time data. Timeout: 180s.

**Saturday variant** uses a longer prompt requesting a 1,200-1,600 word memo with: Executive Summary, Rates & Fed Policy, Funding and Liquidity Deep Dive, Banking and Credit Intelligence, Short-End Yield Curve Analysis, Strategic Outlook (3-6 month forward), and Week Ahead Calendar. Max tokens: 5,000. Timeout: 240s.

### NODE3 — Process Response (shared by both workflows)

Converts Claude's Markdown to styled inline-CSS HTML for Gmail. Embeds the QuickChart yield curve image after the Funding section. Creates a `.md` binary for Google Drive archival.

### Google Drive + Gmail (configured in n8n UI)

Drive uploads the `.md` archive. Gmail sends the HTML email using n8n expressions.

## Repo Structure

```
├── production_code/
│   └── treasury/
│       ├── NODE1_fetch_data.js           # Alpha Vantage yield fetcher + QuickChart
│       ├── NODE2_claude_daily.js         # Claude API — daily treasury brief
│       ├── NODE2_claude_saturday.js      # Claude API — weekly strategic memo
│       └── NODE3_process_response.js     # Markdown → HTML email + yield curve chart
├── prompts/
│   └── treasury/
│       ├── daily_system_prompt.md        # Treasury strategist persona (daily)
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
- API keys: Anthropic (Claude), Alpha Vantage (free tier)
- Google Cloud project with Gmail + Drive APIs enabled

### Deployment Steps

1. **Replace API keys** in NODE1 and NODE2 files:
   - `YOUR_ALPHAVANTAGE_KEY_HERE` → your Alpha Vantage key
   - `YOUR_CLAUDE_API_KEY_HERE` → your Anthropic API key

2. **Create 2 n8n workflows.** Each follows the same node chain:
   - Schedule Trigger → Code (NODE1) → Code (NODE2) → Code (NODE3) → Google Drive → Gmail

3. **Paste code** into each Code node:
   - NODE1 and NODE3 are shared between daily and Saturday workflows
   - NODE2 is different — daily gets `NODE2_claude_daily.js`, Saturday gets `NODE2_claude_saturday.js`

4. **Configure Gmail node expressions:**
   - Subject: `{{ $('Process Response').first().json.emailSubject }}`
   - Message: `{{ $('Process Response').first().json.emailHtml }}`

5. **Configure Google Drive node:**
   - Binary field key: `data`

6. **Set Code node timeouts:**
   - Daily NODE2: 180 seconds
   - Saturday NODE2: 240 seconds

### Critical Rules (Post-Mortem Lessons)

1. ALWAYS use Code nodes for Claude API calls — never HTTP Request nodes
2. NEVER use template literals (backticks) in n8n code — copy-paste breaks them
3. Right-click .js files → Open With → Notepad on Windows — never double-click
4. After pasting API key, verify closing single-quote + semicolon
5. Wait 60s between manual Claude node tests to avoid rate limits
6. Binary field key = "data" (must match Google Drive config)
7. Use explicit node refs: `$('Node Name').first().json.field`
8. Use closest-business-day logic for all date-based API lookups
9. Delete orphan nodes before adding replacements in n8n

## Cost Breakdown

| Service | Monthly Cost |
|---------|-------------|
| DigitalOcean droplet | $6 |
| Claude API (Sonnet 4.5) | $8-15 |
| Alpha Vantage | $0 (free tier, 25 calls/day) |
| Google/Gmail | $0 |
| **Total** | **$14-21** |

Alpha Vantage free tier uses 6 calls per run. Both workflows on the same day = 12 calls, leaving 13 for manual testing.

## Security Notes

- All API keys replaced with placeholders (`YOUR_*_KEY_HERE`)
- Keep this repo **private**
- Rotate API keys periodically

## License

Private. Not for redistribution.
