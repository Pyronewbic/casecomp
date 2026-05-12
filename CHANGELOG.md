# Changelog

## Unreleased

### Added
- Playwright smoke test suite (40 tests): dashboard UI, detail panel, tabs, PSA stats, arbitrage, mobile viewport, static assets
- Sort dropdown on listing tabs (price ascending/descending)
- Result counts in tab labels: "Active (6)" / "Sold (3)"
- Condition badges on raw listing cards using detectedCondition from API
- Price outlier warnings (flagPriceOutliers applied in API pipeline)
- GRADED badge for slab listings in detail panel
- Inline PSA stats in Prices tab with gem progress bar
- Price chart x-axis date labels
- Arbitrage "Best Price" chip and savings summary
- Fade-up entrance animations, sticky frosted header, sticky search bar

### Changed
- Dashboard UI synced with casecomp.xyz frontend: Inter Tight + JetBrains Mono fonts, pill-style tabs/hints, ghost view button
- Moved lib/demo.js to lib/data/, lib/output.js to lib/search/
- Umbreon demo data: added detectedCondition (NM/LP) based on AI grades
- Detail panel: prefer detectedCondition over "Ungraded"
- Consistent shipping display with green "Free shipping"
- CI: unit + smoke run in parallel, test gate job, removed duplicate dev push trigger
- Demo rate limit shown correctly as 360/min

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
