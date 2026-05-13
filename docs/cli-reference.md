# CLI reference

The CLI (`node index.js`) searches Pokemon cards across eBay, magi.camp, Yahoo Auctions JP, and SNKRDUNK. For the REST API, see the [OpenAPI spec](https://api.casecomp.xyz/docs).

## Flags

| Flag | What it does |
|------|--------------|
| *(positional)* | Card search lines, e.g. `node index.js "Pikachu vmax"` |
| `--cards` | Comma-separated card lines (merged with positional). Falls back to `CARDS` in `index.js`. |
| `--format` | `raw` (default) or `slab` |
| `--slab-provider` | Grading company: `PSA`, `BGS`, `CGC`, `TAG` |
| `--slab-grade` | Grade string: `10`, `9.5` |
| `--raw-suffix` | Extra words appended to eBay `q` in raw mode |
| `--lang` | `any` \| `eng` \| `jp` \| `cn`. Comma-separate for multiple (`--lang eng,jp`). |
| `--source` | Listing source: `magi`, `yahoo`, `snkrdunk`. Omit for eBay (default). |
| `--condition` | Condition filter: `NM`, `LP`, `MP`, `HP` (EN) or `A`, `B`, `C`, `D` (SNKRDUNK) |
| `--countries` | Comma-separated ship-to ISO codes (default: `US,IN`) |
| `--pincodes` | Override delivery pincodes, e.g. `US:10001,IN:110001` |
| `--results` | Max active rows per destination (default: `5`) |
| `--sold` | Sold listings to keep (default: `5`) |
| `--sold-browser` | Use Playwright for sold HTML. Requires `npx playwright install chromium`. |
| `--grade` | Enable AI pre-grading (no effect with `--format slab`) |
| `--grade-mode` | `llm` or `site` |
| `--grade-decision` | Run raw + graded searches and show PSA break-even table |
| `--grade-companies` | Companies for `--grade-decision` (default: `PSA`). Comma-separated: `PSA`, `BGS`, `CGC`, or `all`. |
| `--llm-provider` | `claude` or `openai` |
| `--llm-model` | Model id, e.g. `claude-opus-4-7`, `gpt-4o` |
| `--site-provider` | `tcgrader`, `pokegrade`, `snapgrade`, `local` |
| `--min-grade` | Drop results below this predicted overall |
| `--parallel` | Run card searches concurrently |
| `--refresh` | Delete cache files and refetch |
| `--limit` | Only process the first N card lines |
| `--output` | Output filename prefix (default: `results`). Writes `.json`, `.md`, and per-card files. |
| `--no-ebay` | Skip eBay (uses cache if present) |
| `--demo` | Use sample data instead of live searches |

**Note:** Uses **minimist**. `--no-ebay` is parsed as `{ ebay: false }`.

---

## Raw vs slab searches

| Mode | eBay query shape | Filtering |
|------|------------------|-----------|
| **raw** | `{card}` plus optional `rawSearchSuffix` | Drops titles with graded slab indicators (PSA/BGS/CGC) |
| **slab** | `{card} {provider} {grade}` | Keeps titles matching that grader + grade. `--grade` is ignored. |

---

## Examples

```bash
# eBay raw search (default)
node index.js "Charizard ex"

# PSA 10 slabs
node index.js --format slab --slab-provider PSA --slab-grade 10 "Giratina V Alt Art"

# Multi-source: magi.camp JP
node index.js --source magi --lang jp "Umbreon ex 217/187"

# AI pre-grading with Claude
node index.js --grade "Mega Greninja ex SAR"

# PSA break-even analysis
node index.js --grade-decision "Umbreon ex 217/187"

# Multiple languages, more results
node index.js --lang eng,jp --results 10 --sold 10 "Pikachu promo"

# Condition filter
node index.js --condition NM "Rayquaza V AA"

# Sample data (no API keys needed)
node index.js --demo

# Concurrent multi-card search
node index.js --parallel --cards "Pikachu vmax,Charizard ex,Umbreon ex"

# Refresh all caches
node index.js --refresh
```

---

## API examples

For the hosted API at `api.casecomp.xyz`. Full spec: [api.casecomp.xyz/docs](https://api.casecomp.xyz/docs)

```bash
# Search (sample data, no key)
curl "https://api.casecomp.xyz/api/search?q=Umbreon+ex+SAR+217/187&demo=true"

# Card view with Raw/Graded split + grading ROI
curl "https://api.casecomp.xyz/api/card/view/sv8a/217-187?demo=true"

# Cross-source arbitrage
curl "https://api.casecomp.xyz/api/arbitrage?q=Pikachu+ex+SAR+234/193+PSA+10&demo=true"

# PSA grading signal
curl "https://api.casecomp.xyz/api/psa?q=Umbreon+ex+SAR+217/187&demo=true"

# Price history
curl "https://api.casecomp.xyz/api/price-history?q=Umbreon+ex+SAR+217/187&days=90&demo=true"

# Card autocomplete (no key, 29K cards)
curl "https://api.casecomp.xyz/api/autocomplete?q=umbreon&limit=6"

# Set browser (no key)
curl "https://api.casecomp.xyz/api/sets"
curl "https://api.casecomp.xyz/api/sets/sv06"

# Collection tracking (which cards in a set do I own?)
curl "https://api.casecomp.xyz/api/portfolio/set/sv8a?demo=true"

# Portfolio
curl "https://api.casecomp.xyz/api/portfolio?demo=true"
curl "https://api.casecomp.xyz/api/portfolio/summary?demo=true"
curl "https://api.casecomp.xyz/api/portfolio/grading-opportunities?demo=true"

# Alerts
curl -X POST -H "Authorization: Bearer $CASECOMP_KEY" \
  -H "Content-Type: application/json" \
  -d '{"email":"you@email.com","query":"Umbreon ex SAR 217/187","type":"arbitrage","spreadThreshold":10}' \
  "https://api.casecomp.xyz/api/alerts"
```
