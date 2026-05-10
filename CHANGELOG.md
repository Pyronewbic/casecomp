# Changelog

## 1.0.0-beta.1 (2026-05-10)

Initial public beta.

### Added
- Web dashboard with AI pre-grading detail panel, PSA signal bar, source filters
- Multi-source slab search: compare PSA 10 prices across eBay, magi.camp, Yahoo Auctions
- AI pre-grading from listing photos (centering, corners, edges, surface + confidence)
- PSA tier recommendations (Value/Regular/Express) with reasoning per card value
- REST API with CC_LIVE_ key auth, rate limiting (60/min auth, 20/min demo), error monitoring
- Firestore caching with stale-while-revalidate, per-key cache isolation
- Magi search migrated from Playwright to fetch+cheerio (~10x faster)
- eBay sold scrape retry with backoff on 503
- 105 tests (63 unit + 42 API integration)
- GitHub Actions CI on push/PR
- Chrome extension: queue auto-join for Pokemon Center, Walmart, Costco, Target
- Claude Code `/casecomp` skill for plain-English card search

### Infrastructure
- GCP Cloud Run (asia-south1), Firestore, HTTPS load balancer, managed SSL
- Secret Manager for API keys (EBAY, ANTHROPIC, PSA, CASECOMP)
- Cloud Monitoring alert policy (email on >5 errors/5min)
- Terraform with GCS state backend
