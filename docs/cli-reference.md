# CLI reference

## Flags

| Flag | What it does |
|------|----------------|
| *(positional)* | One or more card search lines after flags, e.g. `node index.js --format slab "Pikachu vmax"` |
| `--cards` | Comma-separated card lines (merged after any positional cards). If neither this nor positional args are set, **`CARDS`** in `index.js` is used. |
| `--lang` | `any` \| `eng` \| `jp` \| `cn` (aliases: `en`/`English`, `Japanese`, `Chinese`/`CN`). Comma-separate for multiple (`--lang eng,jp`). `any` skips language narrowing. Active search uses Browse **Language** facet; sold uses `getItem` to verify. |
| `--countries` | Comma-separated **buyer ship-to** ISO codes (e.g. `US,IN`). Each listing is checked with Browse `getItem` (`shipToLocations`) and, when needed, a light HTML probe for "Doesn't ship to …". Default: `US,IN`. |
| `--pincodes` | Override default delivery pincodes per country, e.g. `US:10001,IN:110001`. Defaults: `US:19701`, `IN:600028`. Shown in the "To" column and passed as `zip` in the eBay Browse context header. |
| `--results` | Max active rows **per destination** after ship-to filtering (default: `5`) |
| `--sold` | How many recent sold rows to keep (default: `5`) |
| `--sold-browser` | Prefer **Playwright (Chromium)** for sold HTML when Marketplace Insights is unavailable. Requires `npx playwright install chromium` once. |
| `--format` | `raw` or `slab` (see Raw vs slab below) |
| `--slab-provider` | Grader label for slab mode, e.g. `PSA`, `BGS`, `CGC` |
| `--slab-grade` | Grade string, e.g. `10`, `9.5` |
| `--raw-suffix` | Extra words appended to eBay `q` in raw mode (default: none) |
| `--grade` | Turn on AI pre-grading (**no effect** with `--format slab`) |
| `--grade-mode` | `llm` or `site` |
| `--llm-provider` | `claude` or `openai` |
| `--llm-model` | Model id, e.g. `claude-opus-4-7`, `gpt-4o` |
| `--site-provider` | `tcgrader`, `pokegrade`, `snapgrade`, `local` |
| `--min-grade` | Drop graded rows below this predicted overall |
| `--refresh` | Delete eBay + AI grade cache files and refetch |
| `--limit` | Only process the first **N** card lines |
| `--output` | Output filename prefix (default: `results`). Writes `<prefix>.json`, `<prefix>.md`, and per-card `<prefix>-N.json` files. Every run also appends to `resultsCombined.md` (deduplicated across runs). |
| `--no-ebay` | Do not call eBay (uses cache if present) |

**Note:** This project uses **minimist**. `--no-ebay` is parsed as `{ ebay: false }`.

---

## Raw vs slab searches

| Mode | eBay query shape | Extra filtering |
|------|------------------|-----------------|
| **raw** | `{card}` plus optional `rawSearchSuffix` | Drops titles that look like graded slabs (PSA/BGS/CGC-style). |
| **slab** | `{card} {provider} {grade}` | Keeps titles that plausibly mention that grader + grade. `--grade` / AI pre-grade is ignored. |

Fuzzy relevance (keywords, Pokémon name, blocklist) uses the card line, not the slab tokens appended to `q`, so matching stays centered on the card name.

```bash
# Raw mode (default)
node index.js --format raw "Charizard ex"

# Raw with extra keywords
node index.js --format raw --raw-suffix "ungraded nm" "Charizard ex"

# Slab: PSA 10
node index.js --format slab --slab-provider PSA --slab-grade 10 "Giratina V Alt Art"

# Slab: CGC 9.5
node index.js --format slab --slab-provider CGC --slab-grade 9.5 "Pikachu VMAX"
```

---

## Example commands

```bash
# Baseline: US + India, English-only, 5 BIN + 5 sold per card
node index.js --lang eng --countries US,IN --results 5 --sold 5

# Multiple languages (English OR Japanese)
node index.js --lang eng,jp --results 5 "Pikachu promo"

# Japanese PSA 10 slab
node index.js --lang jp --format slab --slab-provider PSA --slab-grade 10 "Rayquaza V AA"

# Sold via browser (install chromium first: npx playwright install chromium)
node index.js --lang eng --sold-browser "Umbreon VMAX"

# Comma-separated card lines
node index.js --cards "Pikachu vmax,Charizard ex"

# Refresh all caches
node index.js --refresh

# LLM grading with Claude
node index.js --grade --grade-mode llm --llm-provider claude --llm-model claude-opus-4-7

# LLM grading with OpenAI
node index.js --grade --grade-mode llm --llm-provider openai --llm-model gpt-4o

# Only listings with AI grade 8+
node index.js --grade --min-grade 8

# No live eBay (cache only)
node index.js --no-ebay --limit 1
```
