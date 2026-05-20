# <img src="logos/casecomp-logo.svg" width="32" height="32" alt="Casecomp logo" /> Casecomp

[![Version](https://img.shields.io/badge/version-1.3.0-d9b676)](CHANGELOG.md)
[![CI](https://github.com/Pyronewbic/casecomp/actions/workflows/ci.yml/badge.svg)](https://github.com/Pyronewbic/casecomp/actions/workflows/ci.yml)
[![Deploy](https://github.com/Pyronewbic/casecomp/actions/workflows/deploy.yml/badge.svg)](https://github.com/Pyronewbic/casecomp/actions/workflows/deploy.yml)
[![License](https://img.shields.io/badge/license-MIT-blue)](LICENSE)
[![API](https://img.shields.io/badge/API-docs-d9b676)](https://api.casecomp.xyz/docs)
[![SLSA 3](https://img.shields.io/badge/SLSA-Level%203-green)](https://slsa.dev)
[![Sigstore](https://img.shields.io/badge/signed-sigstore-blue)](https://www.sigstore.dev/)

**[casecomp.xyz](https://casecomp.xyz)** | **[API Docs](https://api.casecomp.xyz/docs)** | **[Admin](https://api.casecomp.xyz/admin)** | **[Changelog](CHANGELOG.md)**

Search any Pokemon card across four marketplaces in one query. Get live prices, AI condition estimates, and PSA grading signals instead of manually checking eBay, magi.camp, Yahoo Auctions, and SNKRDUNK separately.

![eBay Pokémon card search demo](docs/demo.gif)

### Features

- **Multi-source search** - eBay, magi.camp, Yahoo Auctions JP, SNKRDUNK in one query
- **Cross-source arbitrage** - compares lowest prices across sources, highlights spread
- **Condition detection** - auto-detects card condition across sources (EN: NM/LP/MP, JP: 状態A/美品)
- **AI pre-grading** - 8-subgrade front/back analysis with card detection, tilt correction, grade distribution, shareable reports
- **Grade history** - track your graded cards, view results, share as social cards
- **Price history** - sold comp tracking over time with line charts and stats
- **PSA grading signals** - population data, difficulty, gem 10%, recommended submission tier
- **Slab comparison** - compare PSA 10 / BGS 9.5 / TAG 10 prices across sources
- **Portfolio** - track cards, ROI, value over time, grading opportunities
- **Admin** - API key management, stats KPIs, error log at `/admin`
- **Set browser** - browse 238 sets with logos, rarity filters, collection tracking (owned/missing)
- **REST API** - authenticated endpoints with rate limiting, per-key caching, OpenAPI spec
- **Claude Code skill** - `/casecomp` for plain-English card search
- **Chrome extension** - queue auto-join for Pokemon Center, Walmart, Costco, Target drops

---

## Quick start

```bash
yarn install
yarn playwright-install
cp .env.example .env          # add keys (see Environment below)
yarn api                      # API on localhost:3000
```

## Scripts

| Command | What |
|---------|------|
| `yarn api` | Start API on :3000 |
| `yarn start` | CLI search (`node index.js`) |
| `yarn test` | Full suite: syntax, unit, secrets, API |
| `yarn test:unit` | Unit tests only (no server) |
| `yarn test:api` | API tests against localhost |
| `yarn test:live` | API tests against api.casecomp.xyz |
| `yarn deploy` | Build + deploy to Cloud Run |
| `yarn scan` | Event & release scanner |

## Architecture

See [docs/internals.md](docs/internals.md) for project layout, caching, security pipeline, multi-region deployment, and AI grading pipeline.

## Frontend

[casecomp.xyz](https://casecomp.xyz) — search, set browser, portfolio, AI grading. Built with TanStack Start, deployed on Cloud Run + Cloudflare.

Three sample cards work without sign-in (`?demo=true`):
- Pikachu ex SAR PSA 10 (multi-source slab: eBay + magi + Yahoo)
- Mega Greninja ex SAR (SNKRDUNK + AI grade)
- Umbreon ex SAR 217/187 (eBay + magi + Yahoo + AI grade)

## REST API

All endpoints except health and sample data require a `CC_LIVE_` API key.

```bash
# Auth: header or query param
-H "Authorization: Bearer CC_LIVE_xxxxx"
# or
?key=CC_LIVE_xxxxx
```

Full reference: [api.casecomp.xyz/docs](https://api.casecomp.xyz/docs)

```bash
# ── Public (no key) ──────────────────────────────────────────
curl "https://api.casecomp.xyz/api/sets"                        # browse 238 sets
curl "https://api.casecomp.xyz/api/sets/sv06"                   # cards in a set
curl "https://api.casecomp.xyz/api/autocomplete?q=umbreon"      # card search (29K cards)
curl "https://api.casecomp.xyz/api/health"                      # service status

# ── Sample data (no key, ?demo=true) ─────────────────────────
curl "https://api.casecomp.xyz/api/search?q=Umbreon+ex+SAR+217/187&demo=true"
curl "https://api.casecomp.xyz/api/card/view/sv8a/217-187?demo=true"
curl "https://api.casecomp.xyz/api/arbitrage?q=Pikachu+ex+SAR+234/193+PSA+10&demo=true"
curl "https://api.casecomp.xyz/api/price-history?q=Umbreon+ex+SAR+217/187&days=90&demo=true"
curl "https://api.casecomp.xyz/api/portfolio?demo=true"
curl "https://api.casecomp.xyz/api/portfolio/set/sv8a?demo=true"

# ── Authenticated (CC_LIVE_ key) ─────────────────────────────
curl -H "Authorization: Bearer $CASECOMP_KEY" \
  "https://api.casecomp.xyz/api/search?q=Pikachu+ex+SAR&source=magi&format=slab&slab_provider=PSA&slab_grade=10"

curl -X POST -H "Authorization: Bearer $CASECOMP_KEY" \
  -H "Content-Type: application/json" \
  -d '{"email":"you@email.com","query":"Umbreon ex SAR 217/187","type":"arbitrage","spreadThreshold":10}' \
  "https://api.casecomp.xyz/api/alerts"
```

### Rate limits

| Endpoint | Limit |
|----------|-------|
| Authenticated (`CC_LIVE_` key) | 60 req/min |
| Sample data (`?demo=true`) | 360 req/min |
| Health, docs, static | No limit |

### Public endpoints (no key)

`GET /api/health` | `GET /api/demo` | `GET /api/sitemap` | `GET /api/autocomplete` | `GET /api/sets` | `GET /api/sets/:setCode` | `GET /docs` | `GET /docs/spec.json` | `?demo=true` (sample data) on search/sold/arbitrage/price-history

## Security

- **Container signing** - Sigstore cosign keyless signing via GitHub OIDC, logged to Rekor transparency log
- **Deploy by digest** - immutable image SHA, not mutable `:latest` tag
- **SBOM** - Syft SPDX JSON generated per deploy, uploaded as build artifact
- **Vulnerability scanning** - Grype scans SBOM for CVEs, SARIF uploaded to GitHub Security tab
- **SAST** - CodeQL static analysis on every PR + weekly schedule
- **Binary Authorization** - GCP policy enforced on both Cloud Run services
- **Reproducible builds** - Kaniko `--reproducible` flag, pinned version
- **Multi-region** - Cloud Run in asia-south1 + us-central1, global LB auto geo-routes to nearest
- **Custom base image** - Wolfi + apko Node 24 image, manual rebuild, zero CVEs by design
- **Supply chain** - SLSA provenance, Dependabot, lockfile-lint, Socket.dev, pre-commit secret blocking

## Claude Code Skills

**`/casecomp`** - search for cards in plain English. Claude parses intent and runs the CLI with the right flags.

```
/casecomp Umbreon ex 217/187 PSA 10 japanese
/casecomp compare Pikachu VMAX alt art and Espeon VMAX alt art
/casecomp should I grade Mega Greninja ex SAR?
/casecomp Charizard ex on magi, condition A, 10 results
```

## CLI

```bash
node index.js "Charizard ex"                                    # raw eBay search
node index.js --format slab --slab-provider PSA "Pikachu VMAX"  # PSA 10 slabs
node index.js --source magi --lang jp "Umbreon ex 217/187"      # magi.camp JP
node index.js --grade "Mega Greninja ex SAR"                    # AI pre-grading
node index.js --grade-decision "Umbreon ex 217/187"             # PSA break-even table
```

### Flags

| Flag | Example | What |
|------|---------|------|
| `--format` | `slab` / `raw` | Slab vs raw (default: `raw`) |
| `--slab-provider` | `PSA`, `BGS`, `CGC`, `TAG` | Grading company |
| `--slab-grade` | `10`, `9.5` | Grade number |
| `--lang` | `eng`, `jp`, `eng,jp` | Card language filter |
| `--source` | `magi`, `yahoo`, `snkrdunk` | Listing source |
| `--countries` | `US,IN` | Ship-to countries |
| `--results` | `10` | Active listings count |
| `--sold` | `10` | Sold comps count |
| `--grade` | | AI pre-grading |
| `--grade-decision` | | PSA break-even table |
| `--condition` | `A`, `nm`, `lp`, `mp` | Condition filter (SNKRDUNK A/B/C/D, eBay NM/LP, magi 状態A/美品) |
| `--refresh` | | Clear cache |
| `--parallel` | | Concurrent card search |

## Environment

```
EBAY_CLIENT_ID=         # required - developer.ebay.com
EBAY_CLIENT_SECRET=     # required
ANTHROPIC_API_KEY=      # AI grading + magi translation
PSA_AUTH_TOKEN=         # PSA pop reports
CASECOMP_API_KEY=       # API auth (CC_LIVE_ prefix)
CASECOMP_SANDBOX_KEY=   # public sandbox key (CC_LIVE_SANDBOX_ prefix, 5/min)
```

In production, secrets are stored in GCP Secret Manager and referenced by Cloud Run.

## Caching

All caches use Firestore (shared across Cloud Run instances, persists across deploys). Owner key gets stale-while-revalidate; third-party keys get isolated per-key caches.

| Collection | TTL | Content |
|-----------|-----|---------|
| `cache-grades` | 30 days | AI grade results by image hash |
| `cache-psa-pop` | 24 hours | PSA population data |
| `cache-psa-spec` | permanent | PSA spec ID lookups |
| `cache-translations` | permanent | EN-to-JP card name translations |
| `cache-ebay-active` | 6 hours | eBay active listing results |
| `cache-ebay-sold` | 24 hours | eBay sold comp results |
| `price-history` | permanent | Sold comp prices over time |
| `api-keys` | permanent | Developer API keys (hashed) |
| `error-logs` | permanent | API errors with request IDs |

## Infrastructure

GCP (Terraform managed): Cloud Run `casecomp-api` (API) + `casecomp-site` (frontend SSR with Cloud CDN), Firestore, HTTPS LB, Secret Manager, Cloud Monitoring, Cloud Scheduler. Cloudflare handles SSL + edge caching for `casecomp.xyz` (~85ms TTFB). GCP managed SSL for `api.casecomp.xyz`. Same LB IP routes by host. Cloud Scheduler runs `track-prices` and `check-alerts` every 6 hours. See `terraform/`.

## Chrome Extension

Queue auto-join for Pokemon Center, Walmart, Costco, Target drops. News monitoring from Discord, X, Reddit.

Load unpacked from `extension/` in `chrome://extensions`.

## Tests

434 tests across three layers. CI required checks: unit + codeql. Smoke is non-blocking.

| Suite | Count | Command | Covers |
|-------|------:|---------|--------|
| **Unit** | 266 | `yarn test:unit` | Filters, grading, query builder, card identity, condition detection, image preprocessing, email alerts, portfolio ROI, CSV export, autocomplete, JWT auth, price trends |
| **API** | 97 | `yarn test:api` | Search, sold, PSA, grade, auth, admin keys, arbitrage, price history, alerts, share pages, portfolio CRUD, card view, upload-url, analytics, collection tracking |
| **Smoke** | 71 | `yarn test:smoke` | API root page, detail panel, tabs, PSA stats, arbitrage, mobile viewport, portfolio, autocomplete, search filters |

## Contributing

Contributions welcome. Fork the repo, create a branch, and open a PR against `dev`. Run `yarn test` before submitting - all tests must pass.

For bug reports or feature requests, open an [issue](https://github.com/Pyronewbic/casecomp/issues).

## Terms of Use

Personal, non-commercial use only. Not for scalping, cook groups, or bulk purchasing. Full terms in [LICENSE](LICENSE).

## Disclaimer

AI grades are estimates from photos, not official PSA/CGC grades. Use as screening hints only.
