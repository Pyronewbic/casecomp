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
    grading.js        AI pre-grading (8-subgrade v3, Claude/OpenAI)
    preprocessing.js  Card detection, corner crops, SSRF-safe image fetch
    psa.js            PSA pop reports, cert lookup, grading signal
    psaTiers.js       PSA submission tier data
  auth/
    auth.js           Google OAuth token verification, JWT (HS256)
    api-keys.js       Developer key management
  cards/
    card-database.js  TCGdex card DB (29K EN+JP cards), set browser, rarity
    card-identity.js  Canonical IDs, set resolution, SET_TOTAL_MAP
    demo.js           Sample data (3 multi-source cards)
    grading-dataset.js  ML slab image collection from sold listings (eBay, magi, search)
    price-history.js  Sold comp tracking + TCGPlayer seeding
  data/
    analytics.js      Request analytics (Firestore, 30d TTL)
    cache.js          File-based cache (legacy CLI)
    csv.js            CSV export helpers
    email.js          Alert emails via Resend
    firestore.js      Firestore: grade logs, drops, webhooks, cache
    redis-cache.js    Redis cache (optional)
  security/
    rasp.js           RASP middleware, detection rules, anomaly scoring, event logging
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
  unit-test.js        312 unit tests
  api-test.js         103 API integration tests
  smoke-test.js       71 Playwright UI smoke tests
```

## API server

`api.js` is the primary entry point for production. Express 5 with:

- **Auth middleware**: owner key (`CC_LIVE_`) → sandbox → JWT (Google OAuth) → Firestore developer keys (30s cache). `apiAuthMiddleware` adds demo bypass.
- **Rate limiting**: 60/min authenticated, 360/min demo, 5/min sandbox, 10/min auth endpoint.
- **Security**: Helmet headers, trust proxy = 1, request IDs, compression, `safeErrorMessage()` on all errors. Global JSON 404 catch-all + error handler at bottom of file. RASP middleware on all routes.
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
| Artifact Registry (API) | us (multi-region) | `us-docker.pkg.dev`, accessible globally |

Deploy workflow: build once → cosign sign → SBOM attest → SLSA attest → deploy to both regions via GitHub Actions matrix (parallel, fail-fast: false) → health check → ZAP DAST.

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
| `api-analytics` | 30 days | Request analytics (tier, path, latency) |
| `grading-dataset` | permanent | ML training data: slab images + parsed grades |

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

1. `POST /auth/google`: verifies Google ID token → returns JWT (HS256, 24h expiry) + user profile.
2. `authMiddleware`: checks `Authorization: Bearer` header or `?key=` param. Tries JWT first (Google OAuth users), falls back to owner → sandbox → Firestore developer keys. Local dev (`K_SERVICE` unset) bypasses auth.
3. `apiAuthMiddleware`: wraps `authMiddleware` with a `?demo=true` bypass that serves canned sample data (360 req/min).
4. `ownerOnly`: requires the owner `CASECOMP_API_KEY`. Used for admin, error management, check-alerts.
5. `portfolioUserId`: JWT users get Google `sub` as userId. API key users get SHA256 hash of key (first 16 chars).
6. Developer self-serve: `GET/POST/DELETE /api/developer/keys` + `GET /api/developer/stats`. Keys linked to Google account via `ownerId`. Usage stats aggregated from `api-analytics` collection.

## AI grading pipeline (v3)

1. Listing images fetched, upgraded to `s-l1600` resolution for eBay.
2. **Card detection**: Sonnet (or Together AI GLM-4.6V) identifies 4 card corners. Tilt angle calculated and corrected via `sharp.rotate()`. If card fills <80% of frame, crops to card. Skips for clean listing images.
3. **SSRF protection**: all image URLs validated — DNS resolution, private IP blocking, blocked hosts (metadata endpoints).
4. `preprocessing.js` crops 4 corners (20% region) from front and back separately via `sharp`.
5. **8 parallel LLM calls**: centering/corners/edges/surface x front/back. Each receives only its target side image.
6. Centering subgrades return `lr`/`tb` ratio fields (e.g. "55/45", "52/48") for frontend overlay positioning.
7. Overall = `(frontAvg x 0.60) + (backAvg x 0.40)`, capped at `lowestSubgrade + 1` (excessive defect rule).
8. Rounding: <0.25 down, 0.25-0.74 to .5, >=0.75 up.
9. Falls back to single combined prompt for non-Claude providers or missing back image.
10. Token usage + estimated cost tracked per grade ($3/$15 per 1M for Claude).
11. `gradeDistribution` computed from overall + confidence (e.g. `{"8": 65, "8.5": 12, "7.5": 23}`).
12. Optional `centeringHint` in request — user-measured ratios appended to centering prompts.
13. `GET /api/grade/report/:id` generates shareable PNG card (SVG→sharp→PNG).
14. Grade logs store `userId` + `cardId` for per-user history and ML training data.
15. `GET /api/grades/mine` returns user's grade history. `DELETE /api/grades/:id` removes a grade.

**Firestore composite indexes** (managed in `terraform/firestore.tf`):

| Collection | Fields | Purpose |
|---|---|---|
| `api-keys` | ownerId + createdAt desc | List keys by owner |
| `grade-logs` | userId + createdAt desc | User grade history |
| `grade-logs` | source + createdAt desc | Filter grades by source |
| `api-analytics` | userId + ts desc | Per-user analytics |
| `price-history` | cardKey + recordedAt desc | Card price history |

**ML dataset pipeline**: graded slab images (PSA/BGS/CGC/TAG) are passively collected into `grading-dataset` Firestore collection from multiple sources: eBay sold (via `track-prices` and `/api/sold`), magi sold (via `track-prices`), and any search with sold results (`/api/search`). Grade is parsed from listing title or grade label. `GET /api/grading-dataset/stats` monitors collection progress.

## Security pipeline

Three workflows: `ci.yml` (all checks), `deploy.yml` (build + sign + deploy), `terraform.yml` (infra).

**ci.yml** — runs on push to main/dev + PRs to main:

| Job | What | Required? |
|-----|------|-----------|
| unit | 312 unit tests | Yes |
| smoke | 71 Playwright smoke tests | No (continue-on-error) |
| codeql | SAST for JavaScript/TypeScript | Yes |
| scan | SBOM (Syft) + Grype vulnerability scan | No |
| audit | npm audit + lockfile-lint | No |
| secrets | gitleaks secret scan | No |

**deploy.yml** — runs on push to main only:

| Step | What |
|------|------|
| Kaniko v1.23.2 | Build with `--reproducible`, dual tags |
| Cosign sign | Keyless signing via GitHub OIDC → Sigstore Rekor |
| SBOM attest | Syft SPDX JSON from container image, cosign-attested to digest |
| SLSA attest | Provenance attestation (builder, source, commit, entrypoint) |
| Deploy | Matrix deploy to asia-south1 + us-central1 |

**Other tools:**

| Tool | Stage | What |
|------|-------|------|
| Pre-commit hook | Local | Blocks .env, >1MB files, secret patterns |
| apko + Wolfi | Base image | Custom Node 24 image, manual `workflow_dispatch` |
| Dependabot | Weekly | npm + GitHub Actions version updates |
| RASP | Runtime | SQLi/XSS/cmdi/traversal/NoSQLi/proto-pollution detection, anomaly scoring |
| Binary Auth | Cloud Run | REQUIRE_ATTESTATION policy (blocks unattested images) |

## Scheduled tasks

Cloud Scheduler runs two jobs every 6 hours:

- **track-prices**: snapshots portfolio values for all users (capped at 100).
- **check-alerts**: evaluates active alerts against live data, sends email via Resend (6h dedup).

## Configuration

Edit `index.js` to change CLI defaults:

- **`CARDS`** — default search phrases when no card lines are passed.
- **`CONFIG`** — language, delivery countries, results per card, sold limit, raw/slab mode, AI grading settings.

CLI flags override `CONFIG` for that run. See [CLI reference](cli-reference.md).
