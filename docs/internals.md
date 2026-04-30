# Internals

## Project layout

| File | Role |
|------|------|
| `index.js` | `CARDS`, `CONFIG`, CLI parsing, main loop |
| `ebay.js` | OAuth, Browse search, Insights + sold scrape fallback |
| `ebayCategories.js` | US category id for Single Cards = `183454` |
| `filters.js` | Language, relevance, raw/slab title filters |
| `listingQuery.js` | Builds eBay `q` for raw vs slab |
| `grading.js` | LLM + site grading adapters, cache, throttling |
| `output.js` | `results.md` / `results.json` (supports `--output` prefix) |
| `cache.js` | Shared cache helpers |
| `.claude/commands/casecomp.md` | Claude Code `/casecomp` skill definition |

## Output and cache files

| File | Purpose | TTL |
|------|---------|-----|
| `results.md` | Human-readable tables | overwritten each run |
| `results.json` | Full structured payload + config snapshot | overwritten each run |
| `ebay-active-cache.json` | Cached active searches | 6h |
| `ebay-sold-cache.json` | Cached sold searches | 24h |
| `ebay-insights-forbidden-cache.json` | Suppresses Insights retries after HTTP 403 | ~14 days |
| `ai-grade-cache.json` | Cached AI grades (key includes model/provider) | 30 days |
| `ebay-usage.json` | Rough daily eBay call counter (vs 5000/day cap) | resets daily |

Use `--refresh` to delete all cache files before a run.

## Configuration

Edit `index.js` to change defaults:

- **`CARDS`** — Default search phrases when no card lines are passed via CLI.
- **`CONFIG`** — Language, delivery countries, results per card, sold limit, raw/slab mode, AI grading settings.

CLI flags override `CONFIG` for that run. See [CLI reference](cli-reference.md).
