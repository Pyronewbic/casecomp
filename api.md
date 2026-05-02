# Casecomp API Benchmark Stats

**Date:** 2026-05-01
**Operation:** Refresh cache + 3-card parallel PSA 10 slab search (JP)

## Summary

| Metric | Value |
|--------|-------|
| Total runtime | ~31s |
| Cards processed | 3 (parallel) |
| Language | Japanese |
| Format | Slab (PSA 10) |
| Cache | Refreshed |

## eBay API Usage

| Metric | Value |
|--------|-------|
| Calls made | 111 |
| Daily limit | 5000 |
| Utilization | 2.22% |

## LLM Usage

| Metric | Value |
|--------|-------|
| LLM calls | 0 |
| AI grading | Not used (slab mode) |

## Per-Card Stats

### Card 1: Team Magma's Groudon ex
| Metric | Value |
|--------|-------|
| Active listings | 10 |
| Sold listings | 1 |
| Active (US) | 5 shown |
| Sold (last 5) | 1 (only 1 found) |

### Card 2: Team Aqua's Kyogre ex
| Metric | Value |
|--------|-------|
| Active listings | 10 |
| Sold listings | 3 |
| Active (US) | 5 shown |
| Sold (last 5) | 3 |

### Card 3: Umbreon ex 217/187 (Terastal Festival)
| Metric | Value |
|--------|-------|
| Active listings | 10 |
| Sold listings | 5 |
| Active (US) | 5 shown |
| Sold (last 5) | 5 |

## Rendering Agents

| Agent | Tokens | Runtime |
|-------|--------|---------|
| Groudon (results-0) | 20,439 | 41,327ms |
| Kyogre (results-1) | 21,393 | 42,400ms |
| Umbreon (results-2) | 23,866 | 132,841ms |
| **Total** | **65,698** | **~216s** |

## Timing Breakdown

| Phase | Duration |
|-------|----------|
| Cache refresh + startup | ~11s |
| Active listings (parallel) | ~17s |
| Sold scrape + lang check | ~11s |
| Total node script | ~31s |
| Agent rendering (sequential) | ~216s |

## Output Files

- `results-0.json` - Team Magma's Groudon ex data
- `results-1.json` - Team Aqua's Kyogre ex data
- `results-2.json` - Umbreon ex 217/187 data
- `results.md` - Combined markdown output
- `results.json` - Combined JSON output