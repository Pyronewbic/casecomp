# Environment variables

Copy **`.env.example`** to **`.env`** and fill in the required values.

## Required

| Variable | Purpose |
|----------|---------|
| `EBAY_CLIENT_ID` | eBay developer Client ID ([developer.ebay.com](https://developer.ebay.com/)) |
| `EBAY_CLIENT_SECRET` | eBay developer Client Secret |

## eBay (optional)

| Variable | Default | Purpose |
|----------|---------|---------|
| `EBAY_API_BASE` | `https://api.ebay.com` | Use sandbox URL only with sandbox keysets |
| `EBAY_OAUTH_SCOPE` | Browse-only | Add Marketplace Insights scope if eBay approved your app |
| `EBAY_TRY_INSIGHTS_SCOPE` | off | `1` to request Insights on the token; falls back to Browse-only on `invalid_scope` |
| `EBAY_SKIP_MARKETPLACE_INSIGHTS` | off | `1` — never call Insights (HTML sold only) |
| `EBAY_SOLD_BROWSER` | off | `1` — use Playwright for sold HTML (same as `--sold-browser`) |
| `EBAY_BROWSE_CONTEXT_COUNTRY` | `US` | Marketplace context for pricing/sort |
| `EBAY_BROWSE_CATEGORY_IDS` | `183454` | TCG single cards category |
| `EBAY_SHIP_LOOKUP_MAX_POOL` | `96` | Max listings in ship-to refinement pool |
| `EBAY_ACTIVE_SHIP_GETITEM_CAP` | `64` | Max `getItem` calls per card for ship-to |
| `EBAY_ACTIVE_ITEM_FIELDGROUPS` | `EXTENDED` | Browse `getItem` fieldgroups |
| `EBAY_INSIGHTS_SORT` | *(none)* | Rarely needed; leave unset unless eBay documents a sort value |
| `EBAY_SHIP_LOOKUP_ENABLED` | off | `1` to enable per-listing ship-to verification (skipped by default) |

## AI grading

| Variable | Purpose |
|----------|---------|
| `ANTHROPIC_API_KEY` | Claude API key for `--grade` with `--llm-provider claude` |
| `OPENAI_API_KEY` | OpenAI key for `--grade` with `--llm-provider openai` |
| `LOCAL_GRADER_URL` | Self-hosted grader URL for `--site-provider local` |
| `TCGRADER_API_URL` / `TCGRADER_API_KEY` | TCGrader endpoint + key |
| `POKEGRADE_API_URL` / `POKEGRADE_API_KEY` | PokeGrade endpoint + key |
| `SNAPGRADE_API_URL` / `SNAPGRADE_API_KEY` | SnapGrade endpoint + key |

## PSA

| Variable | Purpose |
|----------|---------|
| `PSA_AUTH_TOKEN` | Higher-quota PSA API token. Anonymous access: 100 req/day, cached 24h. |

## API server

| Variable | Default | Purpose |
|----------|---------|---------|
| `API_PORT` | `3000` | Server listen port |
| `API_URL` | `http://localhost:3000` | API base URL (used in responses) |
| `CASECOMP_API_KEY` | *(none)* | Owner API key (`CC_LIVE_` prefix, 60 req/min) |
| `CASECOMP_SANDBOX_KEY` | *(none)* | Public sandbox key (`CC_LIVE_SANDBOX_` prefix, 5 req/min) |
| `CASECOMP_JWT_SECRET` | *(none)* | Secret for signing/verifying JWT tokens (HS256) |
| `CASECOMP_ADMIN_SUB` | *(none)* | Google account `sub` claim for admin access |
| `GOOGLE_OAUTH_CLIENT_ID` | *(none)* | Google OAuth client ID for sign-in (popup flow) |
| `TOGETHER_API_KEY` | *(none)* | Together AI key for card detection (GLM-4.6V, falls back to Claude Sonnet) |
| `RASP_MODE` | `monitor` | RASP enforcement mode: `monitor` (log only) or `block` (reject malicious requests) |

## Email notifications

| Variable | Purpose |
|----------|---------|
| `RESEND_API_KEY` | [Resend](https://resend.com) API key for alert emails. Graceful no-op when unset. |
| `RESEND_VERIFIED_DOMAIN` | Set after verifying casecomp.xyz in Resend to send from `alerts@casecomp.xyz` |

## Caching

| Variable | Default | Purpose |
|----------|---------|---------|
| `REDIS_URL` | *(none)* | Redis connection string. Falls back to Firestore if unavailable. |

## Google Cloud

| Variable | Default | Purpose |
|----------|---------|---------|
| `GCLOUD_PROJECT` | `casecomp-495718` | GCP project ID. Auto-detected on Cloud Run. |
| `K_SERVICE` | *(auto)* | Cloud Run service name. Used to detect local vs cloud (disables auth locally). |

## Chrome extension

| Variable | Purpose |
|----------|---------|
| `DISCORD_CHANNELS` | Comma-separated Discord channel names to watch for drop alerts |
| `DISCORD_KEYWORDS` | Comma-separated keywords that trigger alerts in watched channels |

## Marketplace Insights notes

Default OAuth scopes are **Browse-only**, so Insights is intentionally skipped. Sold data uses HTML scrape instead. To enable Insights you need:

1. eBay's **restricted-API approval** for `buy.marketplace.insights`
2. A token granted with that scope

If sold comps always show `http` / `playwright` / `scrape`, that's expected. `--refresh` clears `ebay-insights-forbidden-cache.json` when you retry after gaining access.
