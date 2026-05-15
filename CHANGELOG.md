# Changelog

## Unreleased

## 1.3.0 (2026-05-15)

- AI grading v3: 8 subgrades (front/back), 60/40 weighting, centering ratios (lr/tb), tilt correction
- Card detection: 4-corner detection, auto-crop + straighten from user photos, SSRF protection
- Together AI provider for card detection (GLM-4.6V-Flash, ~90% cost reduction)
- ML dataset pipeline: passive slab image collection from eBay sold listings
- Demo data upgraded to v3 format with centering ratios
- lib/ restructured: auth/, cards/, data/ separated by concern
- 215 unit tests, ~130 API tests

## 1.2.0 (2026-05-15)

- Google OAuth sign-in with JWT, developer self-serve API keys (create/rotate/revoke)
- Admin key management (CASECOMP_ADMIN_SUB), per-key rate limiting
- Request analytics endpoint (owner-only)

## 1.1.0 (2026-05-15)

- Set browser: 238 sets with logos, era groups, rarity filters, collection tracking
- Price trend signals: buy/wait/fair with 7d/30d changes, per-source breakdown
- Card-centric view with raw/graded tabs, grading ROI comparison
- Autocomplete: 29K cards (EN+JP) from TCGdex, cached in Firestore
- Security pipeline: Sigstore signing, Binary Authorization, SBOM/Grype, CodeQL SAST
- Multi-region deployment: asia-south1 + us-central1 with global HTTPS LB
- Custom Wolfi base image (0 CVEs), Terraform CI/CD
- Portfolio: value tracking, history, gainers/losers, CSV export, grading opportunities
- Email alerts via Resend (price drop + arbitrage), Cloud Scheduler
- Search: 200ms cached, relevance filtering, seller feedback, condition detection

## 1.0.0-beta.1 (2026-05-10)

- Multi-source search: eBay, magi.camp, Yahoo Auctions JP, SNKRDUNK
- AI pre-grading: per-subgrade (centering, corners, edges, surface) with PSA rubric
- Cross-source arbitrage detection
- PSA population data + submission tier recommendations
- REST API with key auth, rate limiting, Firestore caching
- Consumer dashboard + admin panel
- Chrome extension: drop queue auto-join
- Cloud Run + Terraform + GitHub Actions CI/CD
