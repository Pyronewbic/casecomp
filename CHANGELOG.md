# Changelog

## 1.0.0-beta.1 (2026-05-10)

Initial public beta.

### Added
- Web dashboard with AI pre-grading detail panel, PSA signal bar, source filters
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
- 105 tests (63 unit + 42 API integration)
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
