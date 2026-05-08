# <img src="logos/casecomp-logo.svg" width="32" height="32" alt="Casecomp logo" /> Casecomp

**[casecomp.xyz](https://casecomp.xyz)**

**Casecomp** is a card research tool for collectors. Ask it for a card in plain English — `/casecomp Umbreon ex 217/187 PSA 10 japanese` — and it pulls live listings from eBay and magi.camp, recent sold comps, and (for raw searches) a PSA grading signal showing difficulty, 10 chance, and population. Results land in a clean markdown table with prices, shipping costs, and clickable links.

Results are written to **`results.md`** (human-readable) and **`results.json`** (full data). Every run also appends to **`output/resultsCombined.md`** — a deduplicated running log across all searches.

![eBay Pokémon card search demo](demo.gif)

---

## Using with Claude Code (`/casecomp`) — no terminal experience needed

If you have [Claude Code](https://claude.ai/claude-code) installed, you can search for cards by typing plain English instead of CLI flags. This section walks you through setup from scratch.

### One-time setup

1. **Install Node.js 20+** — download from [nodejs.org](https://nodejs.org/) and run the installer.
2. **Install Claude Code** — follow the instructions at [claude.ai/claude-code](https://claude.ai/claude-code). It works as a CLI in your terminal, a desktop app, or an IDE extension.
3. **Clone or download this project** and open a terminal in the project folder.
4. **Install dependencies** — run:
   ```
   npm install
   npx playwright install chromium
   ```
5. **Set up your eBay API keys:**
   - Go to [developer.ebay.com](https://developer.ebay.com/) and create a free account.
   - Create an application to get a **Client ID** and **Client Secret**.
   - Copy `.env.example` to `.env` and paste your keys:
     ```
     EBAY_CLIENT_ID=your-client-id-here
     EBAY_CLIENT_SECRET=your-client-secret-here
     ```
6. **Start Claude Code** in this project folder (run `claude` in the terminal, or open the folder in the desktop app).

### How to search

Once Claude Code is running in this project, just type `/casecomp` followed by what you want to find. Write it like you'd tell a friend — Claude figures out the flags.

**Examples:**

| You type | What happens |
|----------|--------------|
| `/casecomp Giratina V Alt Art` | Searches eBay for raw (ungraded) listings, 5 results + 5 sold |
| `/casecomp Pikachu VMAX PSA 10` | Searches for PSA 10 graded slabs |
| `/casecomp charizard ex BGS 9.5 japanese, 10 results` | Japanese BGS 9.5 slabs, 10 active results |
| `/casecomp compare Umbreon VMAX alt art and Espeon VMAX alt art` | Searches both cards **in parallel** (faster!) |
| `/casecomp Mew ex, ship to UK only, last 15 solds` | Ships to UK, 15 recent sold comps |
| `/casecomp should I grade Team aqua's kyogre ex japanese?` | Grading decision — shows PSA break-even table by submission tier |
| `/casecomp Umbreon ex 217/187 with AI grading` | AI pre-grades each raw listing from front + back photos |
| `/casecomp Mega Greninja on yahoo auctions` | Searches Yahoo Auctions JP instead of eBay |
| `/casecomp Mega Greninja ex SAR on snkrdunk, condition A` | Searches SNKRDUNK for condition A (Mint) listings |
| `/casecomp fresh search for Rayquaza V alt art` | Clears cache and fetches new data |

Claude will show you a confirmation line before searching, then display a formatted table with prices, shipping, and clickable links.

### What you get back

For **raw searches**, a grading signal panel appears above the listings using live PSA pop report data:

| Difficulty | PSA 10 Chance | Population | PSA 9/10 |
|:----------:|:-------------:|:----------:|:--------:|
| **Hard** | 3.2% | 1,204 | 0.87 : 1 |

Then the active listings table (sources labelled eBay or magi):

| # | Total | Ship | To | Grade | Title | Link |
|---|------:|------|-------|-------|------|------|
| 1 | $619.99 | free | US:19701 IN:600028 | PSA 10 | Umbreon ex SAR 217/187 2024 Pokemon Terastal Festival sv8a Alt Art PSA 10 | [eBay](https://www.ebay.com/itm/318161356194) |
| 2 | $664.71 | — | US:19701 IN:600028 | PSA 10 | 【PSA10】ブラッキーex SAR 217/187 1枚 | [magi](https://magi.camp/items/472702272) |
| 3 | $810.00 | $10.00 | US:19701 IN:600028 | TAG 10 | TAG GEM MINT 10 UMBREON EX 2024 POKÉMON SCARLET & VIOLET JAPANESE #217/187 | [eBay](https://www.ebay.com/itm/376058718185) |

Plus a recent sold table so you can see what cards actually sell for, not just what sellers are asking:

| # | Price | Date | Grade | Title | Link |
|---|------:|------|-------|-------|------|
| 1 | $750.00 | Apr 30, 2026 | PSA 10 | Umbreon EX 217/187 Special Art Rare Pokemon Japanese PSA 10 | [eBay](https://www.ebay.com/itm/406891668625) |
| 2 | $673.54 | — | PSA 10 | 【PSA10】ブラッキーex SAR 217/187 1枚 | [magi](https://magi.camp/items/597154378) |
| 3 | $749.00 | Apr 22, 2026 | TAG 10 | TAG GEM MINT 10 UMBREON EX 2024 POKÉMON SCARLET & VIOLET JAPANESE #217/187 | [eBay](https://www.ebay.com/itm/366361136416) |

**Price trend (sold):** 5d: +25.0% | 15d: -0.3% | 30d: -11.8%

The price trend line compares the most recent sale to the closest sale ~5, 15, and 30 days ago, so you can spot whether a card is trending up or down.

### Grading decision

With `--grade-decision`, a break-even table shows whether submitting for grading is worth it at current comps:

| Tier | Fee | Net PSA 9 | Upside | Net PSA 10 | Upside |
|------|----:|----------:|-------:|-----------:|-------:|
| Economy | $25 | $421.00 | +1% | $717.00 | +73% |
| Regular | $50 | $396.00 | -5% | $692.00 | +67% |
| Express | $150 | $296.00 | -29% | $592.00 | +43% |

_Net = sold avg − submission fee. Upside vs raw median ask. Supports PSA, BGS, CGC side-by-side with `--grade-companies`._

### PSA grading signal

For raw searches, a pop report panel appears automatically:

| Difficulty | PSA 10 Chance | Population | PSA 9/10 |
|:----------:|:-------------:|:----------:|:--------:|
| **Hard** | 3.2% | 1,204 | 0.87 : 1 |

### AI pre-grading (`--grade`)

When `--grade` is enabled, the tool sends each listing's front and back photos to an LLM and returns a grade estimate:

| | Score |
|---|---|
| **Overall** | **PSA 9 (Mint)** — borderline 9/10 |
| Centering (Front) | 9/10 — ~55/45 L/R, close to even T/B |
| Centering (Back) | 8.5–9/10 — border thicker bottom-right, grade limiter |
| Corners | 9/10 — clean, faint softness bottom-left back |
| Edges | 9/10 — clean gold border, micro wear on back top edge |
| Surface | 9.5/10 — no scratches, print lines, or scuffs |

**Minimum photos needed:** a clear front and back shot. Corners and edges are estimated conservatively without close-ups and flagged with a `limitations` note.

---

## Requirements

- **Node.js 20+**
- An **eBay developer** keyset ([developer.ebay.com](https://developer.ebay.com/))

---

## Quick start (CLI)

```bash
npm install
cp .env.example .env        # set EBAY_CLIENT_ID and EBAY_CLIENT_SECRET
npm start                    # runs default cards in index.js
```

Override cards on the fly: `node index.js "Charizard ex" "Pikachu VMAX"`

---

## Common flags

| Flag | Example | What it does |
|------|---------|--------------|
| `--format` | `slab` / `raw` | Graded slab search vs ungraded raw (default: `raw`) |
| `--slab-provider` | `PSA`, `BGS`, `CGC`, `TAG` | Grading company for slab mode |
| `--slab-grade` | `10`, `9.5` | Grade number for slab mode |
| `--lang` | `eng`, `jp`, `eng,jp` | Filter by card language |
| `--countries` | `US,IN`, `US,GB` | Ship-to countries (default: `US,IN`) |
| `--sold` | `10` | Number of recent sold comps (default: `5`) |
| `--results` | `10` | Active listings per card (default: `5`) |
| `--grade` | *(flag)* | AI pre-grading on raw listings |
| `--refresh` | *(flag)* | Clear caches and fetch fresh data |
| `--source` | `magi`, `yahoo`, `snkrdunk` | Force magi.camp, Yahoo Auctions JP, or SNKRDUNK as the listing source instead of eBay |
| `--condition` | `A`, `B`, `C`, `D` | Filter SNKRDUNK raw listings by seller condition grade (A = Mint) |
| `--output` | `results-psa` | Output file prefix (default: `results`) |
| `--merge` | `results-psa,results-tag` | Merge per-card JSON files from multiple runs into one output |
| `--parallel` | *(flag)* | Search multiple cards concurrently |
| `--grade-decision` | *(flag)* | Run raw + PSA 9 + PSA 10 searches in parallel and show a break-even table by submission tier |

Full flag list, raw vs slab details, and example commands: **[docs/cli-reference.md](docs/cli-reference.md)**

---

## Multi-source and multi-provider searches

You can run the same cards against **multiple grading providers** (e.g. PSA and TAG) and then merge the results into a single `results.md`:

```bash
node index.js --refresh --lang jp --format slab --slab-provider PSA --output results-psa "Umbreon ex 217/187"
node index.js --refresh --lang jp --format slab --slab-provider TAG --output results-tag "Umbreon ex 217/187"
node index.js --merge results-psa,results-tag
```

You can also mix **eBay and magi.camp** sources the same way — run each separately with `--output` prefixes, then merge.

Per-card JSON files are written to `output/` so they don't clutter the project root. The final `results.md` and `results.json` always land in the root.

---

## How it works

```mermaid
flowchart TD
  A[node index.js] --> B[Load .env + CONFIG]
  B --> C{Source?}
  C -->|eBay| D[OAuth token]
  C -->|magi| M[magi.camp search\nHaiku translation for JP names]
  C -->|yahoo| Y[Yahoo Auctions JP\nHaiku translation for JP names]
  C -->|snkrdunk| S[SNKRDUNK JSON API\noptional --condition A/B/C/D filter]
  D --> E{Multiple cards?}
  E -->|yes| P[Parallel]
  E -->|no| F
  P --> F[Build query: raw or slab]
  F --> G[Active BIN search + ship-to filtering]
  G --> GD{--grade-decision?}
  GD -->|yes| GD2[Run PSA 9 + PSA 10 searches in parallel\ncompute break-even table]
  GD -->|no| H
  GD2 --> H
  H{Raw + --grade?}
  H -->|yes| I[AI pre-grading on listing photos]
  H -->|no| J[Sold search: Insights or HTML scrape]
  I --> J
  J --> K{Raw format?}
  K -->|yes| L[PSA pop signal]
  K -->|no| N
  L --> N[Write results.md + results.json\noutput/ per-card JSON]
  M --> AI{Raw + --grade?}
  Y --> AI
  S --> AI
  AI -->|yes| I
  AI -->|no| N
```

---

## Environment

Copy `.env.example` to `.env`. Only two variables are required:

```
EBAY_CLIENT_ID=your-client-id
EBAY_CLIENT_SECRET=your-client-secret
```

| Variable | Required | Purpose |
|----------|----------|---------|
| `EBAY_CLIENT_ID` | Yes | eBay Browse API |
| `EBAY_CLIENT_SECRET` | Yes | eBay Browse API |
| `ANTHROPIC_API_KEY` | For `--grade` (Claude) | AI pre-grading |
| `OPENAI_API_KEY` | For `--grade` (OpenAI) | AI pre-grading |
| `ANTHROPIC_HAIKU_KEY` | For magi.camp | Translates English card names to Japanese (uses claude-haiku-4-5) |
| `PSA_AUTH_TOKEN` | Optional | Higher quota for PSA pop report (anonymous = 100 req/day) |

Full list: **[docs/env-vars.md](docs/env-vars.md)**

---

## Project layout, caches, and internals

See **[docs/internals.md](docs/internals.md)** for file descriptions, cache TTLs, and configuration details.

---

## SNKRDUNK source (`--source snkrdunk`)

SNKRDUNK is a Japanese marketplace for trading cards. No API key or auth is required — listings are fetched from their public JSON API.

```bash
# Condition A (Mint) raw listings
node index.js --source snkrdunk --no-ebay --condition A "Mega Greninja ex SAR"

# All raw listings (no condition filter)
node index.js --source snkrdunk --no-ebay "Umbreon ex"

# Graded slabs (PSA 10)
node index.js --source snkrdunk --no-ebay --format slab --slab-provider PSA --slab-grade 10 "Charizard ex"
```

The `--condition` flag maps to SNKRDUNK's seller condition grades: **A** (Mint), **B** (Minor scratches), **C**, **D**. It only applies to raw listings — slab searches filter by grading company and grade instead.

---

## Chrome Extension — Queue Auto-Join + Drop Intelligence

The `extension/` directory contains a Chrome extension for monitoring Pokemon TCG product drops. Paste a product URL, and it auto-opens the page, detects queue activation, joins automatically, and notifies you on status changes. Uses your real browser session — no bots or spoofed requests.

### Features

- **Target-URL driven** — paste a product URL, the extension arms that site automatically. No manual site toggles.
- **Queue detection** — Incapsula (Pokemon Center), Queue-it (Walmart), PerimeterX captcha detection
- **Auto add-to-cart** — after queue clearance, clicks ATC on the product page
- **News Monitor** — aggregates intel from three sources:
  - **Discord** — watches configured channels for keyword matches
  - **X.com** — scans tweets on your feed for PTCG keywords
  - **Reddit** — polls `r/PKMNTCGDeals` and `r/PokemonTCG` every 3 minutes
- **Dashboard** — sidebar-nav layout with KPI strip, 5 panels:
  - Workers (live queue feed with KPI cards), Targets (add/remove/pause URLs), News Monitor (Discord/X/Reddit intel), History (archived worker runs), Logs (raw event table)
- **Tab lifecycle** — closing a monitored tab auto-archives its logs and pauses the target
- **Product listing monitor** — scans Pokemon Center pages for new/restocked items

### Install

1. Open `chrome://extensions` and enable **Developer mode**
2. Click **Load unpacked** → `Cmd+Shift+G` → select the `extension/` folder
3. Click the extension icon → paste a product URL → it's armed
4. Click **Dashboard** for the full monitoring view
5. Go to **News Monitor** tab to configure Discord channels, Reddit subs, and keywords

```mermaid
flowchart TD
  A[Poll every 5s] --> B[Query all open tabs]
  B --> C{Site handler}
  C -->|Pokemon Center| D[Incapsula iframe poll]
  C -->|Walmart| E[Queue-it detection]
  C -->|Costco| F[Incapsula/virtual room]
  C -->|Discord| DC[MutationObserver on chat]
  C -->|X.com| XC[Tweet scanning via data-testid]
  C -->|PC listings| PL[Scan product grid every 10s]
  D --> G{Status?}
  E --> G
  F --> G
  G -->|CAPTCHA| H[Urgent chime — manual solve]
  G -->|Through| I[Auto-ATC if enabled]
  G -->|In queue| J{autoJoin?}
  G -->|Waiting| K[Report position + ETA]
  J -->|yes| L[Click join button]
  J -->|no| K
  L --> K
  DC -->|Keyword match| N
  XC -->|Keyword match| N
  PL -->|New product| N
  R[Reddit poller · 3min] -->|Keyword match| N
  H --> N[Dashboard + popup + notification]
  I --> N
  K --> N
```

---

## REST API

Two options: **self-host** or use the **hosted API** at `api.casecomp.xyz`.

### Hosted API

No setup needed. Get an API key at [casecomp.xyz/developers](https://casecomp.xyz/developers) and start making requests:

```bash
curl https://api.casecomp.xyz/v1/drops?limit=20 \
  -H "Authorization: Bearer $CASECOMP_KEY"
```

The hosted API aggregates drop events from all extension users, provides reliable webhook delivery, and handles infrastructure (Redis, eBay API keys, rate limits) for you.

### Self-hosted

Run your own instance — you'll need your own eBay API keys and optional Redis:

```bash
yarn api   # starts on :3000
```

Swagger docs at [localhost:3000/docs](http://localhost:3000/docs). A self-hosted instance only sees drops from your own extension.

### Card research endpoints (open)

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/search?q=Umbreon+ex&source=snkrdunk&condition=A` | Search card listings |
| `GET` | `/api/sold?q=Umbreon+ex&source=ebay` | Recent sold comps |
| `GET` | `/api/psa?q=Umbreon+ex` | PSA population signal |
| `POST` | `/api/grade` | AI pre-grade from image URL(s) |
| `GET` | `/api/grades?q=Mega+Greninja&limit=100` | Export stored grades (training data) |
| `GET` | `/api/health` | Health check + Redis status |

### v1 API — Drop Intelligence (Bearer auth)

Set `CASECOMP_API_KEY` in `.env` (self-hosted) or use your key from [casecomp.xyz](https://casecomp.xyz/developers). All v1 endpoints require `Authorization: Bearer <key>`.

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/v1/drops?limit=20&site=pokemon` | List recent drop events |
| `GET` | `/v1/drops/:id` | Single drop with queue metrics and timing |
| `GET` | `/v1/comps?sku=sv8-151-booster` | Sold + listed prices from eBay, magi, SNKRDUNK, Yahoo |
| `POST` | `/v1/webhooks` | Register webhook for events |
| `GET` | `/v1/webhooks` | List registered webhooks |
| `DELETE` | `/v1/webhooks/:id` | Remove a webhook |

#### Webhook events

`drop.opened` · `drop.closed` · `queue.joined` · `queue.advanced` · `queue.through` · `checkout.cleared` · `captcha.detected` · `listing.new`

```bash
# Register a webhook
curl -X POST https://api.casecomp.xyz/v1/webhooks \
  -H "Authorization: Bearer $CASECOMP_KEY" \
  -d '{"url":"https://you.dev/hook","events":["drop.opened","queue.through"]}'
```

### Search params

`q` (required), `source` (ebay/snkrdunk/magi/yahoo), `format` (raw/slab), `countries` (US,IN), `lang` (eng/jp/any), `results`, `sold`, `slab_provider`, `slab_grade`, `condition` (A-D), `grade` (true = AI pre-grade)

### AI grading for training data

```bash
# Grade a single image
curl -X POST localhost:3000/api/grade \
  -H "Content-Type: application/json" \
  -d '{"imageUrl":"https://cdn.snkrdunk.com/...","cardName":"Mega Greninja ex SAR"}'

# Export all stored grades
curl "localhost:3000/api/grades?limit=500"
```

Grade results are stored permanently in Redis for future model training. Each record includes card name, source, listing ID, price, condition, provider, model, and the full grade breakdown.

### Redis caching

Optional — falls back to file-based cache if Redis is unavailable. Set `REDIS_URL` in `.env` to enable.

| Cache | TTL |
|-------|-----|
| eBay active listings | 6h |
| eBay sold listings | 24h |
| AI grades | 30d |
| PSA population | 24h |
| Drop events | permanent |
| Webhooks | permanent |
| Grade training log | permanent |

---

## Event & release scanner (`npm run scan`)

The scanner checks upcoming Pokemon TCG events and product releases. It's available as a CLI command or the `/scan` slash command in Claude Code.

```bash
node scan.js "Ninja Spinner"       # scan for a specific set
node scan.js --source pokemon-center --limit 5
```

---

## Terms of Use

**This project is provided for personal, non-commercial use only.**

You may **not** use this software, or any part of it, to:

- Operate a commercial reselling, scalping, or bulk-purchasing service
- Offer paid "cook groups", bots-as-a-service, or queue-bypass tools built on this code
- Resell, sublicense, or redistribute this software (modified or unmodified) for profit
- Run automated purchasing at scale across multiple accounts or sessions

This tool is intended as a **personal research and collection aid** — one user, one session, one cart. If you use it to gain an unfair commercial advantage or at a scale that harms other buyers' access to products, you are misusing it.

The author does not condone or support the use of this project for commercial scalping or any activity that violates retailer terms of service. **Use at your own risk.** The author assumes no liability for account bans, order cancellations, or other consequences arising from use of this software.

## Disclaimer

AI "grades" are **rough estimates from photos**, not official PSA/CGC/etc. grades. Use them only as a screening hint. Respect eBay's [API terms](https://developer.ebay.com/join/api-license-agreement) and rate limits.
