# <img src="logos/casecomp-logo.svg" width="32" height="32" alt="Casecomp logo" /> Casecomp

**[casecomp.xyz](https://casecomp.xyz)** | **[API](https://api.casecomp.xyz/docs)** | **v1.0.0-beta.1**

Pokemon TCG card research tool. Live listings from eBay, magi.camp, Yahoo Auctions JP, and SNKRDUNK with AI pre-grading, PSA grading signals, and multi-source slab comparison.

![eBay Pokémon card search demo](docs/demo.gif)

---

## Quick start

```bash
yarn install
yarn playwright-install
cp .env.example .env          # add keys (see Environment below)
yarn api                      # dashboard on localhost:3000
```

## Scripts

| Command | What |
|---------|------|
| `yarn api` | Start API + dashboard on :3000 |
| `yarn start` | CLI search (`node index.js`) |
| `yarn test` | Full suite: syntax, unit, secrets, API |
| `yarn test:unit` | Unit tests only (no server) |
| `yarn test:api` | API tests against localhost |
| `yarn test:live` | API tests against api.casecomp.xyz |
| `yarn deploy` | Build + deploy to Cloud Run |
| `yarn scan` | Event & release scanner |

## Architecture

```
api.js              Express API + static dashboard (public/)
index.js            CLI entry point
lib/
  ebay.js           eBay Browse API, OAuth, ship-to filtering
  grading.js        AI pre-grading (Claude/OpenAI), validation, caching
  psa.js            PSA pop reports, cert lookup, grading signal
  magi.js           magi.camp scraper + Haiku JP translation
  yahooauctions.js  Yahoo Auctions JP scraper
  snkrdunk.js       SNKRDUNK JSON API
  filters.js        Language, relevance, slab detection, blocklist
  listingQuery.js   eBay search query builder
  firestore.js      Firestore: grade logs, drops, webhooks, cache
  demo.js           Demo data (3 cards with real listings)
  cache.js          Legacy file cache (migrated to Firestore)
  swagger.js        OpenAPI 3.0.3 spec
extension/          Chrome extension: queue auto-join, drop intel
terraform/          GCP infra: Cloud Run, Firestore, LB, Secret Manager
test/
  unit-test.js      63 unit tests (filters, grading, query, demo data)
  api-test.js       42 API integration tests
```

## Web Dashboard

[api.casecomp.xyz](https://api.casecomp.xyz) — interactive search with detail panel, AI grade breakdown, PSA signal bar, source filters.

Three demos work without keys (`?demo=true`):
- Pikachu ex SAR PSA 10 (multi-source slab: eBay + magi + Yahoo)
- Mega Greninja ex SAR (SNKRDUNK + AI grade)
- Umbreon ex SAR 217/187 (eBay JP + AI grade)

## REST API

Full reference: [api.casecomp.xyz/docs](https://api.casecomp.xyz/docs)

```bash
# Demo (no keys)
curl "https://api.casecomp.xyz/api/search?q=Umbreon+ex+SAR+217/187&demo=true"

# Live search
curl "https://api.casecomp.xyz/api/search?q=Pikachu+ex+SAR&source=magi&format=slab&slab_provider=PSA&slab_grade=10"

# OpenAPI spec
curl "https://api.casecomp.xyz/docs/spec.json"

# Drop intelligence
curl -H "Authorization: Bearer $CASECOMP_KEY" https://api.casecomp.xyz/v1/drops
```

## Claude Code Skills

Two slash commands work inside [Claude Code](https://claude.ai/claude-code) when running in this project:

**`/casecomp`** — search for cards in plain English. Claude parses intent and runs the CLI with the right flags.

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
| `--condition` | `A`, `B`, `C`, `D` | SNKRDUNK condition |
| `--refresh` | | Clear cache |
| `--parallel` | | Concurrent card search |

## Environment

```
EBAY_CLIENT_ID=         # required — developer.ebay.com
EBAY_CLIENT_SECRET=     # required
ANTHROPIC_API_KEY=      # AI grading + magi translation
PSA_AUTH_TOKEN=         # PSA pop reports
```

In production, secrets are stored in GCP Secret Manager and referenced by Cloud Run.

## Caching

All caches use Firestore (shared across Cloud Run instances, persists across deploys):

| Collection | TTL | Content |
|-----------|-----|---------|
| `cache-grades` | 30 days | AI grade results by image hash |
| `cache-psa-pop` | 24 hours | PSA population data |
| `cache-psa-spec` | permanent | PSA spec ID lookups |
| `cache-translations` | permanent | EN-to-JP card name translations |
| `cache-ebay-active` | 6 hours | eBay active listing results |
| `cache-ebay-sold` | 24 hours | eBay sold comp results |

## Infrastructure

GCP (Terraform managed): Cloud Run (asia-south1), Firestore, HTTPS load balancer with managed SSL, Secret Manager for API keys. See `terraform/`.

## Chrome Extension

Queue auto-join for Pokemon Center, Walmart, Costco, Target drops. News monitoring from Discord, X, Reddit. Dashboard with KPI tracking.

Load unpacked from `extension/` in `chrome://extensions`.

## Tests

105 tests: 63 unit (filters, grading, query builder, demo data integrity) + 42 API (health, drops, webhooks, search, sold, PSA, grade, demo validation).

## Terms of Use

Personal, non-commercial use only. Not for scalping, cook groups, or bulk purchasing. See full terms in the codebase.

## Disclaimer

AI grades are estimates from photos, not official PSA/CGC grades. Use as screening hints only.
