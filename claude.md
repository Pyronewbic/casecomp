# casecomp Benchmark — 2026-05-01 22:36:50

## Operation
- Cards: 3 (Team magma's groudon ex · Team aqua's kyogre ex · Terastal festival Umbreon Ex 217/187)
- Flags: `--lang jp --format slab --slab-provider PSA --slab-grade 10 --results 5 --sold 5 --refresh --parallel`

---

## Phase 1 — Node.js scraper (`index.js`)

| Metric | Value |
|--------|-------|
| Wall-clock runtime | 29 s (22:36:50 → 22:37:19) |
| Execution model | 3 cards in parallel (Playwright + Browse API) |
| Cache | Busted (--refresh) |
| eBay Browse API calls (today) | 171 / 5000 |
| LLM grading calls | 0 (--grade not enabled) |

### Per-card scraper detail

| Card | Active pool | getItem (ship) | Sold raw rows | Sold getItem (lang) | Sold returned |
|------|-------------|----------------|---------------|----------------------|---------------|
| Team magma's groudon ex | 17 | 17 × 2 countries = 34 | 13 | 13 | 1 |
| Team aqua's kyogre ex | 25 → 24 | 24 × 2 countries = 48 | 11 | 11 | 3 |
| Terastal festival Umbreon Ex 217/187 | 30 | 30 × 2 countries = 60 | 60 | 9 | 5 |
| **Total** | — | **142** | **84** | **33** | **9** |

---

## Phase 2 — Rendering agents (parallel Haiku)

Model: `claude-haiku-4-5-20251001`  |  3 agents launched simultaneously

| Agent | Card | Total tokens | Tool uses | Latency |
|-------|------|-------------|-----------|---------|
| results-0 | Team magma's groudon ex | 25,645 | 1 (Read) | 7,210 ms |
| results-1 | Team aqua's kyogre ex | 26,172 | 1 (Read) | 9,002 ms |
| results-2 | Terastal festival Umbreon Ex 217/187 | 26,546 | 1 (Read) | 9,389 ms |
| **Total** | — | **78,363** | **3** | **9,389 ms** (wall-clock, parallel) |

> Token split (input/output) not reported by agent metadata — total only.

---

## End-to-end summary

| Metric | Value |
|--------|-------|
| Total wall-clock | ~38 s (29 s scrape + 9.4 s render, sequential phases) |
| Scraper latency | 29 s |
| Render latency | 9,389 ms (parallel max) |
| Rendering tokens (combined) | 78,363 |
| eBay API budget consumed | 171 / 5000 (3.4%) |
| Cards successfully rendered | 3 / 3 |
| Sold results available | Groudon: 1, Kyogre: 3, Umbreon: 5 (limited by eBay sold history) |
