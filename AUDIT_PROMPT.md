# Treasury Dashboard — Full Audit + High-Value Fix List

## Your first job: read the codebase efficiently

Read these files in order. Do not make any changes yet.

```
Read docs/index.html
Read docs/app.js
Read docs/style.css
Read proxy/worker.js
```

---

## Context you need before auditing

**Local path:** `C:\Users\JORGE-PC\Documents\Treasury\treasury dashboard`
**Live site:** https://jorgejimenez-crypto.github.io/Treasury-Dashboard/
**Worker URL:** https://treasury-proxy.treasurydashboard.workers.dev
**Stack:** Vanilla JS, no framework, no build step. GitHub Pages (static). Cloudflare Worker proxy. Chart.js v4 + chartjs-plugin-datalabels.

**Infrastructure:**
- `/api/market-data` — Yahoo Finance + FRED + NY Fed. Runs every 15 min.
- `/api/ticker` — 9-symbol Yahoo-only. Runs every 10s during market hours.
- FRED key is set as a Cloudflare Worker secret (`FRED_API_KEY`). Currently working.
- Worker is deployed separately from GitHub via `npx wrangler deploy` from the `proxy/` folder.

**What is currently confirmed working:**
- FRED yields, macro, and credit data populating correctly
- Yahoo Finance commodity/forex/equity prices populating
- Bloomberg TV live embed in panel-live (Row 1)
- Scrolling ticker bar with energy + equity symbols
- FX converter
- Economic calendar (hardcoded through May 2026)
- Alert system (VIX, DXY, commodity surge thresholds)
- News feed (Reuters, CNBC, Federal Reserve RSS, age-filtered to 72h)
- Keyboard shortcuts (R, N, C, J, L, ?)
- Quick Notes panel (localStorage)
- Panel collapse on click

**What is confirmed broken or missing:**
- TradingView energy chart widget inside `panel-commodities` — NOT rendering. This is the top priority fix.
- SOFR/EFFR in Funding & Liquidity — NY Fed API is blocking Cloudflare Worker IPs. Shows N/A.

---

## Audit instructions

After reading the files, perform a complete audit across these six dimensions. Be specific — reference actual function names, variable names, line logic, and HTML element IDs where relevant.

### 1. TradingView widget — deep diagnosis (highest priority)

Examine exactly how the widget is currently initialized. Look at:
- The `<script>` block in `index.html` that injects the widget
- The `#tradingview-widget` div and its parent `.chart-container` in `panel-commodities`
- Whether a `.tradingview-widget-container__widget` child div is present before the script runs
- Whether `autosize: true` or `false` is set
- Whether the script is appended to the correct element
- Whether there is a timing conflict between `app.js` loading and the inline script executing
- Whether the widget container has a defined height (required — TradingView will not render into a zero-height container)

Propose a specific, working fix. The correct pattern is:
1. Remove the inline script from `index.html`
2. Create a JS function `initTradingView()` in `app.js` with a one-time guard flag
3. Build the container structure in JS (outer div → inner `.tradingview-widget-container__widget` div → script tag with config as `textContent`)
4. Call `initTradingView()` at the end of `renderDashboard()` so it runs after the DOM is ready
5. The container div must have an explicit `height` set before the script appends

### 2. Data completeness and accuracy

- Are all FRED series IDs correct and returning non-null data? Check `DGS3MO`, `DGS6MO`, `DGS1`, `DGS2`, `DGS5`, `DGS10`, `DGS30`, `RRPONTSYD`, `BAMLC0A0CM`, `BAMLH0A0HYM2`, `FEDFUNDS`, `CPIAUCSL`, `CPILFESL`, `PPIACO`, `UNRATE`, `ICSA`, `A191RL1Q225SBEA`, `WM2NS`
- Are Yahoo Finance symbols correct? Check futures encoding: `CL%3DF`, `BZ%3DF`, `NG%3DF`, `HO%3DF`, `SI%3DF`, `GC%3DF`, `HG%3DF`
- Is the FRED `limit=5` sufficient to always return T, T-1, T-2 observations? (FRED sometimes has gaps from weekends/holidays — is this handled?)
- Is the `prior` field for FRED yields actually the previous business day, or could it be a stale observation?
- Does `fetchYahooSymbol` handle null closes mid-array correctly? (Some days Yahoo returns nulls in the close array before the most recent close)
- Is the 2s10s spread calculation in `renderYields()` correct and labeled clearly?
- Does the `pctChange()` helper handle the case where `prior === 0`?

### 3. Refresh and caching logic

- Does `tickerRefresh()` correctly merge ticker data into `cachedYahoo` without overwriting FRED data?
- Is the `Object.assign(cachedYahoo || {}, data.yahoo)` merge pattern safe? What happens on first load before `cachedYahoo` is set?
- Does the `getCachedData()` / `cacheData()` localStorage system handle JSON parse failures or quota exceeded errors?
- Is the 10-min localStorage cache TTL (`600000` ms) for market data appropriate given the 15-min refresh interval?
- Does the exponential backoff in `tickerRefresh()` reset correctly after a successful fetch?
- Is there a risk of multiple concurrent `fetchData()` calls if the user hits R repeatedly?

### 4. Layout and information hierarchy

Look at the panel grid with fresh eyes. After the optimizations applied (equities removed, movers is full-width chip strip at bottom):

- Is the current panel order optimal for a trader who opens this dashboard first thing every morning?
- Is any panel too tall, too short, or wasting vertical space?
- Does the yield curve chart have enough height to be readable?
- Is the News panel scrollable, and is the scroll height appropriate?
- Does the commodities panel feel cramped with 7 metrics in `cols-3` plus the TradingView chart below?
- Is the FX converter worth the space it takes inside `panel-forex`, or should it be a collapsible section?
- Are any two panels showing redundant data (e.g., Risk & Credit DXY/VIX overlap with the ticker)?

### 5. News pipeline quality

- What sources are currently active in `RSS_FEEDS` (worker-side) and `PREMIUM_FEEDS` (client-side)?
- Is the 72-hour age filter working correctly with all date formats from all sources? (Reuters, CNBC, and Fed use different date formats)
- Is the financial relevance keyword filter broad enough? Are any clearly relevant articles being dropped? Are any off-topic articles slipping through?
- Is `classifyClientArticle()` covering all meaningful tag categories? Are there gaps?
- Is the gov-pinning sort working as expected, or could it bury very recent market-moving CNBC/Reuters stories below old Fed press releases?
- Is the news count badge accurate?
- Are duplicate articles from overlapping sources (Reuters + Yahoo Finance often duplicate) being properly deduplicated?

### 6. Code quality and robustness

- Are there any global variable name collisions or unsafe patterns?
- Are there any `renderXxx()` functions that will throw if their target DOM element doesn't exist (missing null checks)?
- Does `initFxConverter()` correctly guard against double event listener attachment on repeated `renderForex()` calls?
- Is the `yieldCurveChart` Chart.js instance properly updated (not re-created) on subsequent `renderYieldCurve()` calls?
- Does the keyboard shortcut handler correctly ignore key events when focus is inside `<input>` or `<textarea>`?
- Is there any memory leak risk from the `tickerTimer` / `refreshTimer` / `newsTimer` not being cleared on error?
- Are there any hardcoded pixel values or color hex codes that should reference CSS variables?
- Is the economic calendar `ECON_CALENDAR` array going to be stale by the time the next session happens, and is there a maintainability plan?

---

## Output format

After completing the audit, produce output in exactly this structure:

---

### CRITICAL (fix immediately — breaks functionality)

For each issue: name it, explain the root cause in one sentence, and give the exact fix with file name and specific code change.

---

### HIGH VALUE (significantly improves daily usability)

For each issue: name it, explain why it matters for a macro/treasury dashboard, and give a clear implementation direction. Prioritize fixes that add signal without adding noise.

---

### MEDIUM (polish and robustness)

For each issue: name it and describe the fix concisely.

---

### LOW / FUTURE (good to have, low urgency)

List only, no detailed description needed.

---

### TradingView fix — implementation plan

Write out the complete implementation plan for the TradingView widget fix as a numbered step-by-step sequence. Include the exact code to add to `app.js`, the exact lines to remove from `index.html`, and what to verify in `style.css` (the container needs a defined height). This should be ready to implement immediately after the audit without any further clarification.

---

## After the audit is complete

Do not implement anything yet. Present the full audit output and wait for approval before touching any file. The implementation will happen in a separate session.
