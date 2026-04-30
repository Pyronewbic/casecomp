# /casecomp — eBay card comparison search

Run an eBay card price comparison and display a clean summary table.

## Input

The user writes a **plain English sentence** after `/casecomp`. Your job is to extract the intent and map it to CLI flags for `node index.js`.

### Example inputs → CLI mapping

| User says | You run |
|-----------|---------|
| `Giratina V Alt Art` | `node index.js "Giratina V Alt Art"` |
| `show me english & japanese results for giratina V alt art PSA 10, as well as last 10 solds` | `node index.js --lang eng,jp --format slab --slab-provider PSA --slab-grade 10 --sold 10 "Giratina V Alt Art"` |
| `charizard ex raw ungraded, ship to india only` | `node index.js --format raw --raw-suffix ungraded --countries IN "Charizard ex"` |
| `pikachu vmax BGS 9.5 japanese, 10 results` | `node index.js --format slab --slab-provider BGS --slab-grade 9.5 --lang jp --results 10 "Pikachu vmax"` |
| `compare charizard ex and rayquaza V alt art, english only` | Two parallel calls (see Parallel execution below) |
| `giratina V alt art with AI grading, only show grade 8+` | `node index.js --grade --min-grade 8 "Giratina V Alt Art"` |
| `fresh search for umbreon vmax alt art` | `node index.js --refresh "Umbreon vmax Alt Art"` |
| `charizard ex CGC 10 shipped to US, UK and India, 15 solds` | `node index.js --format slab --slab-provider CGC --slab-grade 10 --countries US,GB,IN --sold 15 "Charizard ex"` |
| `show me raw pikachu cards with openai pre-grading` | `node index.js --format raw --grade --grade-mode llm --llm-provider openai "Pikachu"` |

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
| Sold count | `--sold` | `3` | "last 10 solds", "5 sold", "20 recent sales" |
| Refresh cache | `--refresh` | off | "fresh", "refresh", "no cache", "new search" |

### Ambiguity rules

- If the user mentions a grading company + grade number (e.g. "PSA 10"), that means **slab mode** — separate the provider/grade from the card name.
- If the user says "graded" without a specific company, that still means slab (default PSA 10).
- If the user says "pre-grade" or "AI grade", that means `--grade` (AI pre-grading on raw listings), NOT slab.
- **Set numbers stay in the card name.** Numbers in the format `NNN/NNN` (e.g. `217/187`, `093/187`, `015/034`) are set/collector numbers, NOT grades. Always keep them as part of the card name. Example: "Umbreon Ex 217/187 PSA 10" → card is `"Umbreon Ex 217/187"`, slab is PSA 10. Only strip the grading provider + its grade number (e.g. "PSA 10", "BGS 9.5").
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
node index.js --lang eng --parallel "Charizard ex" "Rayquaza V Alt Art"
```

For a **single card**, just run `node index.js` normally (no `--parallel` needed).

Both single and multi-card runs write to `results.json` and `results.md` by default (override with `--output <prefix>`).

3. **Read results.** After the command finishes, read `results.json` from the repo root.

4. **Display the summary.** Do NOT echo the raw node.js logs. Show a clean table:

### Output format

For each card searched, show:

```
## <Card Name>
Search: `<ebay query>`  |  Type: <raw/slab>  |  Lang: <lang>  |  Active: <n>  |  Sold: <n>

### Active listings
| # | Total | Ship | To | Grade | Title |
|---|-------|------|----|-------|-------|
| 1 | $25.00 | free | US:✓ IN:✓ | PSA 10 | [Giratina V Alt Art 111...](url) |

### Recent sold
| # | Price | Date | Title |
|---|-------|------|-------|
| 1 | $22.00 | 2025-04-28 | [Giratina V Alt Art 111...](url) |

**Price trend (sold):** 5d: +2.3% | 15d: +5.1% | 30d: —
```

**IMPORTANT — table width:** The terminal renderer does NOT collapse markdown links — `[text](url)` prints as literal text, so wide tables with many columns overflow and degrade into ugly key-value stacks. Keep tables to **6 columns max** for active listings and **4 columns max** for sold listings. The formats above are the maximum — do not add extra columns.

Rules for the summary table:
- Truncate titles to ~40 chars max, append `…` if truncated.
- Title column is a markdown link: `[truncated title](itemWebUrl)`. Do NOT add a separate Link column.
- "Total" = price + shipping already summed. Do NOT add a separate Price column — just show the total and shipping.
- "To" column: combine all countries into one cell like `US:✓ IN:✗` using the shipToLocations data.
- **Pre-grade columns:** If AI pre-grading was enabled (raw + --grade), show `Pre-Grade` and `AI Conf` columns (these replace Grade, staying within 6 cols). For slab, show the `Grade` column (seller slab grade) but never AI columns. For raw without grading, drop the Grade column entirely.
- Format prices with currency symbol.
- If a card errored, show the error message instead of tables.
- **Price trend line:** After the sold table, show a `**Price trend (sold):**` line with % change over 5d, 15d, and 30d windows. To calculate: find the sold entry closest to N days ago from today and compare its price to the most recent sold price. Formula: `((recent - old) / old) * 100`. Show `+X.X%` / `-X.X%` or `—` if no sold data falls within that window. To ensure enough data for 30-day trends, internally use `--sold 20` for fetching even if the user requests fewer rows to display. Only display the number of rows the user asked for in the table.
- At the bottom, show: `eBay usage: <n>/5000 today` from the results.

5. **Confirm output.** End with: `Results saved to results.md and results.json`
