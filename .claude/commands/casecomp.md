# /casecomp — eBay card comparison search

Run an eBay card price comparison and display a clean summary table.

## Input

The user writes a **plain English sentence** after `/casecomp`. Your job is to extract the intent and map it to CLI flags for `node index.js`.

### Example inputs → CLI mapping

| User says | You run |
|-----------|---------|
| `Giratina V Alt Art` | `node index.js --refresh "Giratina V Alt Art"` |
| `Giratina V Alt Art PSA 10 japanese, last 10 solds` | `node index.js --refresh --lang jp --format slab --slab-provider PSA --slab-grade 10 --sold 10 "Giratina V Alt Art"` |
| `Charizard ex, Pikachu VMAX jp PSA 10` | `node index.js --refresh --lang jp --format slab --slab-provider PSA --slab-grade 10 --parallel "Charizard ex" "Pikachu VMAX"` |
| `Charizard ex raw ungraded, ship to india only` | `node index.js --refresh --format raw --raw-suffix ungraded --countries IN "Charizard ex"` |
| `Pikachu vmax BGS 9.5 japanese, 10 results` | `node index.js --refresh --format slab --slab-provider BGS --slab-grade 9.5 --lang jp --results 10 "Pikachu vmax"` |
| `Giratina V alt art with AI grading, only show grade 8+` | `node index.js --refresh --grade --min-grade 8 "Giratina V Alt Art"` |
| `Charizard ex CGC 10 shipped to US, UK and India, 15 solds` | `node index.js --refresh --format slab --slab-provider CGC --slab-grade 10 --countries US,GB,IN --sold 15 "Charizard ex"` |
| `Umbreon vmax alt art — use cache` | `node index.js "Umbreon vmax Alt Art"` (no `--refresh`) |

### How to extract fields

Read the sentence and look for these signals. Anything not mentioned uses defaults.

| What to detect | CLI flag | Default | Signals in natural language |
|----------------|----------|---------|-----------------------------|
| Card name(s) | positional `"..."` args | *(required — ask if missing)* | The core noun phrase: pokemon name + set/variant words. Strip grading provider + number from the card name when slab is detected (e.g. "giratina V alt art PSA 10" → card is `"Giratina V Alt Art"`, slab is PSA 10). |
| Language | `--lang` | `any` | "english", "eng", "japanese", "jp", "chinese", "cn", "english & japanese", "eng+jp", "all languages" (= any) |
| Ship-to countries | `--countries` | `US,IN` | "india", "US", "shipped to UK", "only US", country names or ISO codes |
| Listing type | `--format` | `raw` | Mentioning a grading company + number (PSA 10, BGS 9.5, CGC 9) → `slab`. "raw", "ungraded", "no slab" → `raw`. |
| Slab provider | `--slab-provider` | `PSA` | PSA, BGS, CGC, etc. (only when slab detected) |
| Slab grade | `--slab-grade` | `10` | The number after the provider (only when slab detected) |
| Raw suffix | `--raw-suffix` | *(none)* | "ungraded", "nm", "near mint" after the card name in raw mode |
| AI pre-grading | `--grade` | off | "with grading", "AI grade", "pre-grade". **Ignored for slab** (slab already has a grade). |
| Grading provider | `--llm-provider` | `claude` | "with openai", "use claude", "openai grading" |
| Min grade filter | `--min-grade` | *(none)* | "only 8+", "grade 9 or above", "minimum grade 8" |
| Result count | `--results` | `5` | "10 results", "top 20", "show 3" |
| Sold count | `--sold` | `5` | "last 10 solds", "5 sold", "20 recent sales" |
| Refresh cache | `--refresh` | **on** (always passed) | Omit `--refresh` only when user explicitly says "use cache", "cached", "no refresh", or "from cache" |

### Ambiguity rules

- If the user mentions a grading company + grade number (e.g. "PSA 10"), that means **slab mode** — separate the provider/grade from the card name.
- If the user says "graded" without a specific company, that still means slab (default PSA 10).
- If the user says "pre-grade" or "AI grade", that means `--grade` (AI pre-grading on raw listings), NOT slab.
- **Set numbers stay in the card name.** Numbers in the format `NNN/NNN` (e.g. `217/187`, `093/187`, `015/034`) are set/collector numbers, NOT grades. Always keep them as part of the card name. Example: "Umbreon Ex 217/187 PSA 10" → card is `"Umbreon Ex 217/187"`, slab is PSA 10. Only strip the grading provider + its grade number (e.g. "PSA 10", "BGS 9.5").
- **Bare input is valid.** The user doesn't need "show me" or "search for" — just card names (with optional flags) is enough. `Umbreon VMAX PSA 10 japanese` or `Charizard ex, Pikachu VMAX jp` are complete valid inputs.
- **Comma-separated names** without any verb preamble are a multi-card search. Split on commas (respecting set numbers like `217/187`), treat each segment as a card name, apply any shared flags (lang, format, etc.) to all.
- If you can't figure out the card name, ask the user before running anything.
- Preserve the user's card name capitalization style but fix obvious typos in flag-words (e.g. "englsh" → eng).

## Execution

1. **Show what you understood.** Before running, print one line per card confirming:
   `Searching: "<card>" | type: raw/slab | lang: eng | countries: US,IN | sold: 3`
   This lets the user catch mistakes before the search runs.

2. **Run the command(s)** from the repo root (the directory containing `index.js` and `package.json` — use the current working directory) via Bash. Timeout 120000ms.

### Multiple cards

When the user searches for **2+ cards**, pass all card names as separate positional args in a **single** `node index.js` call with `--parallel`. This launches N concurrent Playwright browsers within one process.

Example — user asks for Charizard ex and Rayquaza V Alt Art, english only:
```
node index.js --refresh --lang eng --parallel "Charizard ex" "Rayquaza V Alt Art"
```

For a **single card**, just run `node index.js` normally (no `--parallel` needed).

Both single and multi-card runs write to `results.json` and `results.md` by default (override with `--output <prefix>`).

### Multiple slab providers (e.g. "both PSA and TAG")

When the user asks for **2+ grading providers** for the same cards, run each provider separately with distinct `--output` prefixes, then merge into a single `results.md`:

```
node index.js --refresh [shared flags] --slab-provider PSA --output results-psa [cards]
node index.js --refresh [shared flags] --slab-provider TAG --output results-tag [cards]
node index.js --merge results-psa,results-tag
```

The `--merge` command reads the per-card JSON files from each prefix, combines active listings and sold across all providers (deduped by itemId/URL), and writes the final `results.md` + prints the combined stdout summary. Relay that combined stdout as the result.

3. **Relay stdout directly.** The node script prints formatted markdown tables to stdout as its final step (via `printSummary`). No agents needed — just extract and relay the stdout block that starts after the last `]` log line. It contains one `## CardName` section per card, all combined in order.

4. **Display the summary.** Relay the stdout tables verbatim, then append:
   - `eBay usage: <n>/5000 today` (from the last `eBay: N/5000` log line in stdout)
   - `Results saved to results.md and results.json`
