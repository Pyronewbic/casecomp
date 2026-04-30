# Environment variables

Copy **`.env.example`** to **`.env`** and fill in the required values.

## Required

| Variable | Purpose |
|----------|---------|
| `EBAY_CLIENT_ID` | Your eBay developer Client ID |
| `EBAY_CLIENT_SECRET` | Your eBay developer Client Secret |

## Optional — eBay

| Variable | Default | Purpose |
|----------|---------|---------|
| `EBAY_API_BASE` | `https://api.ebay.com` | Use `https://api.sandbox.ebay.com` only with sandbox keysets |
| `EBAY_OAUTH_SCOPE` | Browse-only | Add Marketplace Insights scope only if eBay approved your app |
| `EBAY_TRY_INSIGHTS_SCOPE` | off | Set to `1` to request Insights on the token; falls back to Browse-only on `invalid_scope` |
| `EBAY_SKIP_MARKETPLACE_INSIGHTS` | off | `1`/`true` — never call Marketplace Insights (HTML sold scrape only) |
| `EBAY_SOLD_BROWSER` | off | `1`/`true`/`playwright` — same as `--sold-browser` |
| `EBAY_INSIGHTS_SORT` | *(none)* | Rarely needed; leave unset unless eBay documents a valid sort for Insights |
| `EBAY_BROWSE_CATEGORY_IDS` | `183454` | Toys & Hobbies > Collectible Card Games > Single Cards |
| `EBAY_BROWSE_CONTEXT_COUNTRY` | `US` | `X-EBAY-C-ENDUSERCTX` contextual location for Browse sort/price |
| `EBAY_SHIP_LOOKUP_MAX_POOL` | `96` | Max cheapest listings considered before per-listing ship `getItem` calls |
| `EBAY_ACTIVE_SHIP_GETITEM_CAP` | `64` | Max `getItem` calls per card for ship-to refinement |
| `EBAY_ACTIVE_ITEM_FIELDGROUPS` | `EXTENDED` | Browse `getItem` `fieldgroups` for ship lookup |

## Optional — AI grading

| Variable | Purpose |
|----------|---------|
| `ANTHROPIC_API_KEY` | `--grade` with `--llm-provider claude` |
| `OPENAI_API_KEY` | `--grade` with `--llm-provider openai` |
| `LOCAL_GRADER_URL` | Site mode with `--site-provider local` |
| `TCGRADER_*`, `POKEGRADE_*`, `SNAPGRADE_*` | Matching site providers |

## Marketplace Insights notes

Default OAuth scopes are **Browse-only**, so Insights is intentionally skipped. Sold data uses HTML scrape instead. To enable Insights you need:

1. eBay's **restricted-API approval** for `buy.marketplace.insights`
2. A token granted with that scope

If sold comps always show `http` / `playwright` / `scrape`, that's expected. `--refresh` clears `ebay-insights-forbidden-cache.json` when you retry after gaining access.

See: [eBay Marketplace Insights docs](https://developer.ebay.com/api-docs/buy/marketplace-insights/static/overview.html)
