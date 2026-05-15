# /practices — Casecomp coding practices

Reference guide for patterns and conventions observed in this codebase. Use when writing new code to stay consistent.

## API endpoint pattern

```javascript
app.get("/api/endpoint", apiAuthMiddleware, async (req, res) => {
  try {
    // validate input
    // business logic
    res.json({ data });
  } catch (e) {
    logError("endpoint-name", e.message, req.originalUrl, req.requestId);
    res.status(500).json({ error: safeErrorMessage(e), requestId: req.requestId });
  }
});
```

- Always use `safeErrorMessage(e)` — never leak raw `e.message`
- Always include `requestId` in error responses
- Use `apiAuthMiddleware` for read endpoints (allows `?demo=true`)
- Use `authMiddleware` for write endpoints (no demo bypass)
- Use `ownerOnly` for admin endpoints
- Use `isAdminUser(req)` for Google OAuth admin checks

## Auth levels

```
ownerOnly          → CASECOMP_API_KEY only
isAdminUser(req)   → CASECOMP_ADMIN_SUB match or owner key
authMiddleware     → owner + sandbox + JWT + developer keys
apiAuthMiddleware  → authMiddleware + ?demo=true bypass
(none)             → public endpoint
```

## AI grading pipeline (v3)

8 subgrades: `centering_front`, `centering_back`, `corners_front`, `corners_back`, `edges_front`, `edges_back`, `surface_front`, `surface_back`.

Pipeline: `detectAndCropCard()` → `cropCorners()` per side → 8x `gradeSubgrade()` → `roundGrade()`.

```
frontOverall = avg(4 front scores)
backOverall  = avg(4 back scores)
raw = (frontOverall * 0.60) + (backOverall * 0.40)
overall = roundGrade(min(raw, lowestSubgrade + 1))
```

- Card detection uses Together AI (GLM-4.6V-Flash) when `TOGETHER_API_KEY` set, falls back to Claude Sonnet
- Subgrades use configured model (default Claude Sonnet)
- SSRF protection: `validateImageUrl()` in preprocessing.js — DNS resolution, private IP blocking, blocked hosts
- `gradeSubgrade` receives pre-built image blocks (not URLs) — use `imageBlockFromUrl()` or `imageBlockFromBase64()`
- `cropCorners()` accepts URL or Buffer
- Back-only subgrades skipped when no back image — front score substituted
- Response includes `cardDetection.front`/`.back` with crop bounds + `tiltDeg` when background detected
- `gradeDistribution` field: probability spread across adjacent PSA grades (computed from overall + confidence)
- `centeringHint` in request: optional user-measured ratios, appended to centering prompts via `promptSuffix`
- `GET /api/grade/report/:id` returns shareable PNG (SVG→sharp→PNG, 400x500, cached 24h)
- Mode: `"llm-detailed-v3"` (distinguishes from v2 `"llm-detailed"`)

## Firestore patterns

- Collection per feature: `api-keys`, `portfolios`, `price-history`, `api-analytics`, `error-logs`, `grading-dataset`
- Portfolio path: `portfolios/{userId}/cards/{cardId_escaped}` (slash → underscore)
- Cache collections: `cache-grades`, `cache-psa-pop`, `cache-psa-spec`, `cache-ebay-active`
- Always `try { ... } catch {}` for non-critical Firestore writes (analytics, search frequency)
- Use `Firestore.FieldValue.increment(1)` for counters
- TTL via `ts` field + Firestore TTL policy (api-analytics: 30d)
- **Composite indexes required** for any `where()` + `orderBy()` on different fields. Create via `gcloud firestore indexes composite create`. Current indexes:
  - `api-keys`: ownerId + createdAt desc
  - `grade-logs`: userId + createdAt desc, source + createdAt desc
  - `api-analytics`: userId + ts desc
  - `price-history`: cardKey + recordedAt desc
- **When adding a new compound query:** add the index to `terraform/firestore.tf` in `local.composite_indexes`. CI will create it on merge. Test locally first — Firestore gives a direct link to create the missing index in the error message.

## Error handling

- `safeErrorMessage(e)` sanitizes: network errors → "Upstream service unavailable", auth → "Authentication error", Firestore/gRPC → "Internal storage error"
- Fire-and-forget for non-critical ops: `logRequest({...}).catch(() => {})`
- Always catch Firestore writes in analytics/logging paths

## Demo data pattern

```javascript
if (req.query.demo === "true") {
  // return canned data from lib/cards/demo.js
  return res.json({ ...demoData, _demo: true });
}
// ... live data path
```

- `_demo: true` flag in response when serving demo data
- 3 demo cards: sv8a/217-187 (Umbreon), m4/114-083 (Greninja), m2a/234-193 (Pikachu)
- Demo rate limit: 360 req/min

## New secret workflow

1. Add to `terraform/secrets.tf` locals.secrets list
2. Push → CI creates the empty secret
3. `gcloud secrets versions add SECRET_NAME --data-file=- --project=casecomp-495718`
4. Never `gcloud secrets create` (conflicts with Terraform)

## Testing pattern

Unit tests (test/unit-test.js, ~224 tests):
```javascript
test("descriptive name", () => {
  eq(actualValue, expectedValue);
});
```
- Sync test harness, no async support (use dynamic import for modules needing env setup)
- Group with `console.log("\n\x1b[1m=== section ===\x1b[0m")`
- Sections: parseGradeJSON, buildEbaySearchQuery, detectLanguage, tokenizeQuery, extractPokemonName, normalizeListingLanguage, parseListingLanguagesFromInput, filterByLanguage, titleLooksGradedSlab, titleMatchesSlabListing, parseSellerSlabFromConditionText, filterByListingFormat, filterRelevantResults, querySeeksJapaneseMarket, filterToLikelyTcgCards, demo data, detectCondition, filterByCondition, flagPriceOutliers, parseCardIdentity, resolveCardIdToQuery, findDemoByNumber, demo multi-source + sold dates, cornerCropsToImageBlocks, demo image resolution, demo grade confidence, alert email, portfolio, portfolio history + gainers/losers, csvEscape + csvRow, isGradedCard, card database, price trend, JWT auth, findCardByCardId, roundGrade, image block helpers, subgrade prompt keys, computePriceTrend edge cases, API response parsing (mock), card detection bounds, validateAndShape, buildSignal, deriveEra, v3 formula edge cases

API tests (test/api-test.js, ~130 tests):
```javascript
await test("GET /api/endpoint returns expected", async () => {
  const { res, body } = await jsonNoAuth("/api/endpoint?demo=true");
  assert(res.status === 200, `status ${res.status}`);
});
```
- `json()` for auth'd requests, `jsonNoAuth()` for public
- Auth tests accept both success and 401 (local dev disables auth)
- Mock pattern: extract response parsers as pure exported functions, test with sample payloads (no framework needed)
  - `parseAnthropicResponse(data)` / `parseTogetherResponse(data)` in preprocessing.js
  - `validateAndShape(provider, mode, o, raw)`, `buildSignal({...})`, `deriveEra(setCode)` — exported for testing
- Sections: health, drops, webhooks, comps, search, sold, psa, grade, auth, admin keys, condition, card, arbitrage, price-history, track-prices, errors, demo data, portfolio, portfolio/history, portfolio/export, grading-opportunities, card/view, set browser, price trend, collection tracking, google oauth, upload url, developer self-serve, analytics, autocomplete, set detail, grading dataset, grade validation

## Naming conventions

- Endpoints: `/api/noun` (GET list, POST create), `/api/noun/:id` (GET/PATCH/DELETE)
- Firestore collections: kebab-case (`api-keys`, `price-history`)
- Functions: camelCase (`getPortfolio`, `computePriceTrend`)
- Files: kebab-case (`card-database.js`, `price-history.js`, `grading-dataset.js`)
- Card IDs: `setCode/localId-total` (e.g. `sv8a/217-187`)

## Git conventions

- Prefixes: `feat:`, `fix:`, `docs:`, `ci:`, `sec:`, `infra:`, `refactor:`, `test:`, `chore:`
- No Co-Authored-By, no "Generated with Claude Code"
- Push to dev or main directly (no mandatory PR for solo dev)
- CI required: unit + codeql. Smoke is non-blocking.
