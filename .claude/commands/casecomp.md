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

3. **Render results — parallel agents.** The node script writes per-card JSON files named `results-0.json`, `results-1.json`, … (one per card). Spawn **one Agent per card, all in parallel in a single message**, to read and render tables concurrently. This is critical for speed — do NOT read and render cards sequentially.

   Each agent prompt must be **self-contained** (agents have no conversation context). Include in every agent prompt:
   - The per-card JSON file path to read (e.g. `results-0.json` in the repo root)
   - The number of sold rows to display (user-requested count)
   - Today's date (for price trend calculation)
   - The full output format and rules (copy the Output format section below into each prompt verbatim)

   Use `description: "Render <card name>"`, `subagent_type: "general-purpose"`, and `model: "haiku"` for each agent.

   When all agents return, **relay their output verbatim** to the user in card order (results-0 first, then results-1, etc.). Do NOT regenerate or reformat — just paste each agent's markdown output with `---` between cards.

4. **Display the summary.** Do NOT echo the raw node.js logs. Relay agent outputs as described above, then append the eBay usage and confirmation lines.

### Output format (include this in each agent prompt)

Each agent reads its per-card JSON file and produces this exact markdown format:

```
## <Card Name>
Search: `<ebaySearchQuery>`  |  Type: <listingFormat>  |  Lang: <lang>  |  Active: <counts.activeTotal>  |  Sold: <counts.sold>

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
- **Active listings table:** Show only the items from the **first delivery country** in `deliveryCountries` (e.g. US). Do NOT repeat the same listings for every country — the items are nearly identical across countries.
- Truncate titles to ~40 chars max, append `…` if truncated.
- Title column is a markdown link: `[truncated title](url)`. Do NOT add a separate Link column. **Strip URLs** to just `https://www.ebay.com/itm/<id>` — remove all query params (`?_skw=...&hash=...`). The `itemWebUrl` field has the full URL; truncate at the first `?`.
- "Total" = price + shipping already summed (`totalCost` field). Do NOT add a separate Price column — just show the total and shipping.
- "To" column: combine all countries into one cell like `US:? IN:?` using the `shippingToBuyer` data. `eligible: true` → `✓`, `eligible: false` → `✗`, `eligible: null` → `?`.
- **Pre-grade columns:** If AI pre-grading was enabled (raw + --grade), show `Pre-Grade` and `AI Conf` columns (these replace Grade, staying within 6 cols). For slab, show the `Grade` column (`listingGradeLabel`) but never AI columns. For raw without grading, drop the Grade column entirely.
- Format prices with currency symbol (e.g. `$2,903.85`).
- If a card errored (has `error` field), show the error message instead of tables.
- **Price trend line:** After the sold table, show a `**Price trend (sold):**` line with % change over 5d, 15d, and 30d windows. To calculate: find the sold entry closest to N days ago from today and compare its price to the most recent sold price. Formula: `((recent - old) / old) * 100`. Show `+X.X%` / `-X.X%` or `—` if no sold data falls within that window or if the closest entry IS the most recent entry.

5. **eBay usage.** After all agent outputs are relayed, show the eBay usage from the node stdout: `eBay usage: <n>/5000 today`

6. **Confirm output.** End with: `Results saved to results.md and results.json`
