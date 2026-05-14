# Internals

## Project layout

```
api.js                Express API server + dashboard (port 3000)
index.js              CLI entry point (minimist)
scan.js               Event & release scanner

lib/
  sources/
    ebay.js           eBay Browse API, OAuth, ship-to, sold scrape
    magi.js           magi.camp scraper (fetch + cheerio)
    yahooauctions.js  Yahoo Auctions JP scraper (cheerio)
    snkrdunk.js       SNKRDUNK JSON API
    tcgplayer.js      TCGPlayer price seeding
  grading/
    grading.js        AI pre-grading (per-subgrade, Claude/OpenAI)
    preprocessing.js  Corner crop extraction via sharp
    psa.js            PSA pop reports, cert lookup, grading signal
    psaTiers.js       PSA submission tier data
  data/
    firestore.js      Firestore: grade logs, drops, webhooks, cache
    api-keys.js       Developer key management
    card-identity.js  Canonical IDs, set resolution, SET_TOTAL_MAP
    card-database.js  TCGdex card DB (29K EN+JP cards), set browser, rarity
    price-history.js  Sold comp tracking + TCGPlayer seeding
    demo.js           Sample data (3 multi-source cards)
    cache.js          File-based cache (legacy CLI)
    redis-cache.js    Redis cache (optional)
    email.js          Alert emails via Resend
    csv.js            CSV export helpers
    portfolio.js      Portfolio CRUD (Firestore subcollection)
  search/
    filters.js        Language, relevance, condition detection, outlier flagging
    listingQuery.js   eBay search query builder (raw vs slab)
    ebayCategories.js eBay category IDs (TCG singles: 183454)
    output.js         Markdown/JSON formatters (CLI output)
  scan.js             Event scanning logic
  swagger.js          OpenAPI 3.0.3 spec

public/               Dashboard frontend (search, grade, arbitrage, portfolio)
public/admin/         Admin panel (keys, stats, errors)
extension/            Chrome extension: queue auto-join, drop intel
terraform/            GCP infra (Cloud Run, Firestore, LB, CDN, Scheduler)
test/
  unit-test.js        130 unit tests
  api-test.js         96 API integration tests
  smoke-test.js       74 Playwright UI smoke tests
```

## API server

`api.js` is the primary entry point for production. Express 5 with:

- **Auth middleware**: owner key (`CC_LIVE_`) → sandbox → Firestore developer keys (30s cache). `apiAuthMiddleware` adds demo bypass.
- **Rate limiting**: 60/min authenticated, 360/min demo, 5/min sandbox.
- **Security**: Helmet headers, trust proxy = 1, request IDs, compression, `safeErrorMessage()` on all errors.
- **CORS**: wildcard `*` — API key is the access control layer.
- **Dashboard**: static files from `public/` served at `/` and `/admin`.
- **Docs**: Swagger UI at `/docs`, spec at `/docs/spec.json`.

On startup: eBay OAuth token pre-fetched, TCGdex card database loaded from Firestore cache (24h TTL), set names + logos loaded in parallel.

## Multi-region deployment

Both `casecomp-api` and `casecomp-site` run in asia-south1 (Mumbai) and us-central1 (Iowa). The global HTTPS LB auto-routes requests to the nearest healthy region.

| Component | Region | Notes |
|---|---|---|
| Cloud Run (API + site) | asia-south1, us-central1 | `for_each` in Terraform, matrix deploy in CI |
| Firestore | asia-south1 only | Locked at creation. US reads ~150ms, mitigated by caching |
| Secret Manager | Global (auto-replicated) | No region changes |
| Cloud Scheduler | asia-south1 | Hits LB domain, auto-routes |
| HTTPS LB | Global | Backend services have NEGs in both regions |
| Artifact Registry (frontend) | us (multi-region) | `us-docker.pkg.dev`, accessible from both regions |
| GCR (API) | us (multi-region) | `gcr.io`, accessible globally |

Deploy workflow: build once → cosign sign → deploy to both regions via GitHub Actions matrix (parallel, fail-fast: false).

## Caching

All caches use Firestore (shared across Cloud Run instances, single region). No Redis in production.

| Collection | TTL | Content |
|-----------|-----|---------|
| `cache-grades` | 30 days | AI grade results by image hash |
| `cache-psa-pop` | 24 hours | PSA population data |
| `cache-psa-spec` | permanent | PSA spec ID lookups (negative cache: 7 days) |
| `cache-translations` | permanent | EN-to-JP card name translations |
| `cache-ebay-active` | 6 hours | eBay active listing results |
| `cache-ebay-sold` | 24 hours | eBay sold comp results |
| `price-history` | permanent | Sold comp prices over time |
| `api-keys` | permanent | Developer API keys (hashed) |
| `error-logs` | permanent | API errors with request IDs |

Stale-while-revalidate on active listings for owner key. File-based cache (`.json` files) still used by the CLI.

## CLI cache files

| File | TTL |
|------|-----|
| `ebay-active-cache.json` | 6h |
| `ebay-sold-cache.json` | 24h |
| `ebay-insights-forbidden-cache.json` | ~14 days |
| `ai-grade-cache.json` | 30 days |
| `ebay-usage.json` | resets daily |

Use `--refresh` to delete all cache files before a run.

## Authentication flow

1. `authMiddleware`: checks `Authorization: Bearer` header or `?key=` param. Matches owner → sandbox → Firestore developer keys. Local dev (`K_SERVICE` unset) bypasses auth.
2. `apiAuthMiddleware`: wraps `authMiddleware` with a `?demo=true` bypass that serves canned sample data (360 req/min).
3. `ownerOnly`: requires the owner `CASECOMP_API_KEY`. Used for admin, error management, check-alerts.

## AI grading pipeline

1. Listing images fetched, upgraded to `s-l1600` resolution for eBay.
2. `preprocessing.js` crops 4 corners (20% region) from front + back via `sharp` (~100ms).
3. Four parallel LLM calls: centering, corners, edges, surface — each with the full PSA rubric (grades 5-10).
4. Corners subgrade receives front + back URLs + 8 magnified corner crops. Others receive all listing images.
5. Overall = minimum of all subgrades (matches PSA methodology).
6. Falls back to single combined prompt for non-Claude providers or missing back image.

## Security pipeline

Deploy workflow: Build (Kaniko) → Get digest → Sign (cosign keyless) → Deploy (by digest) → Scan (parallel).

| Tool | Stage | What |
|------|-------|------|
| Kaniko v1.23.2 | Build | Pinned version, `--reproducible`, dual tags (latest + SHA) |
| Cosign | Post-build | Keyless signing via GitHub OIDC → Sigstore Rekor |
| Syft | Post-deploy | SBOM generation (SPDX JSON), 90-day artifact retention |
| Grype | Post-deploy | CVE scan from SBOM, SARIF → GitHub Security tab |
| CodeQL | PR + weekly | SAST for JavaScript/TypeScript |
| Binary Auth | Cloud Run | GCP policy, DRYRUN audit mode (logs unsigned deploys) |

The scan job runs in parallel after deploy — adds zero time to the deploy critical path. CodeQL runs on PRs only (~60s).

## Scheduled tasks

Cloud Scheduler runs two jobs every 6 hours:

- **track-prices**: snapshots portfolio values for all users (capped at 100).
- **check-alerts**: evaluates active alerts against live data, sends email via Resend (6h dedup).

## Configuration

Edit `index.js` to change CLI defaults:

- **`CARDS`** — default search phrases when no card lines are passed.
- **`CONFIG`** — language, delivery countries, results per card, sold limit, raw/slab mode, AI grading settings.

CLI flags override `CONFIG` for that run. See [CLI reference](cli-reference.md).
