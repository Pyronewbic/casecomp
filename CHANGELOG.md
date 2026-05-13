# Changelog

## Unreleased

### Added
- Card autocomplete: GET /api/autocomplete with TCGdex EN+JP database (29K cards), card preview images, EN→JP name mapping
- Search filters: format (raw/slab), multi-select source pills, condition dropdown, slab provider+grade selectors
- Autocomplete dropdown on dashboard: card thumbnails, card preview panel on hover, keyboard navigation
- Lazy PSA loading: search returns results without waiting for PSA, frontend fetches PSA separately
- Pre-warm cache: track-prices scheduler pre-caches active listings + PSA for tracked cards
- Fast card-first search: autocomplete → card share → demo search → render in 2-3s (was 30s)
- Client-side format filtering: Raw excludes slabs, Slab matches provider+grade
- Client-side condition filtering: instant without re-fetch
- Sort by grade (high to low) added to sort dropdown
- Pagination: 25 listings per page with "Show more" button
- Autocomplete suppressed on hint chip clicks
- Card-centric view: GET /api/card/view/:setCode/:number returns raw + graded data with PSA + grading ROI comparison
- Public sitemap: GET /api/sitemap returns all indexable URLs (static + card pages), supports ?format=xml for Google
- eBay relevance filtering: blocklist expanded (art case, sleeves, playmat, booster, etc.), applied to active+sold
- Arbitrage alerts: notify when cross-source spread exceeds threshold (POST /api/alerts with type "arbitrage")
- Price drop alerts: notify when price falls below target (POST /api/alerts with type "price")
- check-alerts endpoint (owner-only): evaluates all active alerts against live data
- Live price tracking: track-prices fetches real eBay sold + magi comps (was demo-only)
- Cloud Scheduler: track-prices + check-alerts run every 6 hours
- Grading ROI card: "Grade This Card?" panel with raw price, grading cost, total, gem rate, verdict
- Population-aware expected outcome: maps AI pre-grade to likely PSA grade with scarcity indicator
- TCGPlayer market price reference in price chart (with wrong-card sanity filter)
- Ungraded listing indicators: dash chip on cards + "AI grading unavailable" note in detail panel
- Playwright smoke test suite (40 tests): dashboard UI, detail panel, tabs, PSA stats, arbitrage, mobile viewport
- Sort dropdown on listing tabs (price ascending/descending)
- Result counts in tab labels: "Active (6)" / "Sold (3)"
- Condition badges on raw listing cards using detectedCondition from API
- Price outlier warnings (flagPriceOutliers applied in API pipeline)
- GRADED badge for slab listings in detail panel
- Inline PSA stats in Prices tab with gem progress bar
- Price chart x-axis date labels, redraws on tab switch (fixes blank canvas)
- Arbitrage "Best Price" chip and savings summary
- Fade-up entrance animations, sticky frosted header, sticky search bar
- Alert form: toggle between Price Drop and Arbitrage Spread types
- Developers nav link in dashboard header
- AI grading: corner crop preprocessing via sharp (8 magnified crops from front+back for corners subgrade)
- AI grading: all listing images passed to centering/edges/surface (corners uses front+back + crops only)
- eBay image resolution upgrade: s-l500 (500px) to s-l1600 (full resolution)
- Email notifications: Resend integration for price and arbitrage alerts with 6h dedup
- Portfolio tracker: Firestore CRUD, 5 API endpoints (GET/POST/DELETE/PATCH /api/portfolio + /api/portfolio/summary)
- Portfolio demo data: 3 cards (Umbreon, Greninja, Pikachu) with purchase prices and current values
- Portfolio dashboard UI section with stats grid and card list showing ROI
- Portfolio value history: GET /api/portfolio/history with daily snapshots, track-prices scheduler extension
- Portfolio gainers/losers: extended summary with top 3 gainers/losers by price change %
- Portfolio CSV export: GET /api/portfolio/export?format=csv with UTF-8 BOM, card identity enrichment
- Portfolio grading opportunities: GET /api/portfolio/grading-opportunities flags ungraded cards worth grading

### Changed
- Dashboard UI synced with casecomp.xyz frontend: Inter Tight + JetBrains Mono fonts, pill-style tabs/hints, ghost view button
- Moved lib/demo.js to lib/data/, lib/output.js to lib/search/
- Umbreon demo data: now multi-source (eBay + magi + Yahoo) with detectedCondition NM/LP
- All demo sold data spans 30+ days with realistic date spreads
- Detail panel: prefer detectedCondition over "Ungraded"
- Consistent shipping display with green "Free shipping"
- CI: unit + smoke run in parallel, both required by branch protection
- TCGPlayer search: full query first, fallback to simplified, price sanity check
- Demo rate limit shown correctly as 360/min
- PR template: added breaking changes + demo data check sections
- Yahoo Auctions: relevance filtering applied (removes 1-yen box auctions, unrelated cards)
- Card identity: cleaned up long names (strips pack names, condition text from titles)
- track-prices: now also tracks cards from active alerts, not just 3 hardcoded defaults
- Demo condition filter: checks detectedCondition in addition to raw condition field
- Tests: 290 total (128 unit + 88 API + 74 smoke), up from 183
- AI grading prompts: full PSA rubric (5-10), perspective correction, per-corner/edge detail, holo-specific surface guidance
- Demo grades re-evaluated with improved prompts (more conservative scores, honest confidence)
- Removed dead code: Redis import from api.js, updateCardField from card-identity.js

## 1.0.0-beta.1 (2026-05-10)

Initial public beta.

### Added
- Consumer dashboard at /dashboard: search, arbitrage, price history, grade breakdown
- Admin dashboard at /admin: stats KPIs, developer key CRUD, error log viewer
- Cross-source arbitrage: /api/arbitrage compares prices across eBay, magi, Yahoo, SNKRDUNK
- Condition detection: auto-detects NM/LP/MP from EN + JP markers (状態A/美品)
- Condition filter: ?condition=nm works across all sources
- Price outlier flagging: listings >40% below median flagged
- Card identity: /api/card with canonical IDs, set resolution from card numbers
- Price history: /api/price-history tracks sold comp prices over time
- TCGPlayer integration: seeds price history when no data exists
- Scheduled price tracking: /api/track-prices for Cloud Scheduler
- Developer API key management: create, rotate, revoke, delete via Firestore
- Detail panel tabs: Grade / Prices to reduce scrolling
- Multi-source slab search: compare PSA 10 prices across eBay, magi.camp, Yahoo Auctions
- Per-subgrade AI grading: centering, corners, edges, surface graded independently in parallel
- Front + back image analysis with subgradeDetails (score, confidence, detail per attribute)
- PSA tier recommendations (Value/Regular/Express) with reasoning per card value
- REST API with CC_LIVE_ key auth + CC_LIVE_SANDBOX_ public sandbox key
- Rate limiting: 60/min auth, 20/min sample data, 5/min sandbox
- Firestore caching with stale-while-revalidate, per-key cache isolation
- Magi search migrated from Playwright to fetch+cheerio (~10x faster)
- eBay sold scrape retry with backoff on 503
- OAuth token pre-fetched on server startup
- Security: helmet headers, error sanitization, request IDs, trust proxy
- 143 tests (81 unit + 62 API integration)
- GitHub Actions CI on push/PR, auto-deploy on merge to main
- Chrome extension: queue auto-join for Pokemon Center, Walmart, Costco, Target
- Claude Code `/casecomp` skill for plain-English card search
- GitHub release v1.0.0-beta.1 with Chrome extension zip

### Infrastructure
- Cloud Run `casecomp-api` (API) + `casecomp-site` (frontend SSR with Cloud CDN)
- HTTPS LB routes by host: casecomp.xyz → site, api.casecomp.xyz → API
- Cloudflare SSL + edge caching for casecomp.xyz (~85ms TTFB, down from 1,210ms)
- GCP managed SSL for api.casecomp.xyz
- Firestore, Secret Manager (incl. sandbox key)
- Cloud Monitoring: error alerts + uptime check on /api/health
- Terraform with GCS state backend
- Workload Identity Federation for GitHub Actions → GCP (no stored keys)
- Kaniko layer caching for Cloud Build
- Branch protection on main: CI required before merge
