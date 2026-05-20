# CLAUDE.md

## Project

Casecomp — Pokemon TCG card research tool. API at api.casecomp.xyz (Cloud Run `casecomp-api`), frontend at casecomp.xyz (Cloud Run `casecomp-site` + Cloudflare). Chrome extension for drop queue auto-join.

## Git workflow

- **Ask before every shared-state action.** Push, PR, merge, deploy, terraform apply — each requires separate explicit approval. Never chain them. Stop after each action and wait.
- **No Co-Authored-By lines** in commits. No "Generated with Claude Code" in PR descriptions or any public text.
- **Branch flow:** push to dev or main → CI runs → deploy on main push.
- **Commits:** concise message, no attribution trailers.
- **PR template:** .github/PULL_REQUEST_TEMPLATE.md

## Code style

- No comments unless the WHY is non-obvious.
- No emojis in code, commits, or PRs.
- Node 24 pinned across Dockerfile, CI, package.json.
- User-facing language: "sample data" not "demo".

## lib/ structure

```
lib/
  sources/          ebay, magi (cheerio), snkrdunk, yahooauctions, tcgplayer
  grading/          grading (8-subgrade v3), preprocessing (card detection + SSRF + corner crops), psa, psaTiers
  auth/             auth (Google OAuth + JWT), api-keys (developer key CRUD)
  cards/            card-database, card-identity, demo, price-history, grading-dataset
  security/         rasp (RASP middleware, detection rules, anomaly scoring, Firestore event logging)
  data/             firestore, cache, redis-cache, analytics, csv, email
  search/           filters (condition, outlier), listingQuery, ebayCategories, output
  swagger.js        OpenAPI spec
```

## UI design rules

Strict palette — no deviations:
- Backgrounds: `#07070a` (body), `#0c0d12` (panels), `#14151c` (inset)
- Gold accent: `#d9b676` only. No blue, no purple.
- Status: `#7ce0a8` (green), `#ff5d5d` (red). No other greens/reds.
- Borders: `rgba(255,255,255,0.08)` — not solid gray.
- Fonts: Space Grotesk for headings, Inter Tight for body, JetBrains Mono for mono/labels.
- No emojis anywhere.

## Architecture decisions

- **Caching:** Firestore only, no Redis. Stale-while-revalidate on active listings. TCGdex card DB cached (24h TTL). PSA negative caching (7 days).
- **CORS:** Wildcard `*`. API key is the access control layer.
- **Auth:** Owner `CC_LIVE_` (60/min), sandbox (5/min), developer keys (per-key rate limit enforced), demo `?demo=true` (360/min). Local: no auth.
- **authMiddleware** checks owner → sandbox → JWT (Google OAuth) → Firestore developer keys (30s cache). `apiAuthMiddleware` adds demo bypass.
- **Developer self-serve:** auto-key on first Google sign-in, max 3 per user, rotate, revoke. `GET/POST/DELETE /api/developer/keys` + stats.
- **Admin:** `CASECOMP_ADMIN_SUB` env var (Google sub). `GET/PATCH/DELETE /api/admin/keys`.
- **eBay search:** active returned immediately, sold in background. Ship-to skipped. Seller feedback + relevance filtering.
- **Autocomplete:** TCGdex EN+JP (~29K cards) cached in Firestore, instant startup.
- **Error responses:** Sanitized via `safeErrorMessage()`. Never leak internals. Global JSON 404 handler + error handler at bottom of `api.js` — unmatched routes return `{"error":"Not found"}`, unhandled exceptions return sanitized JSON.
- **RASP:** `lib/security/rasp.js` middleware inspects all inputs (query, body, path, headers) for SQLi, XSS, command injection, path traversal, NoSQL injection, prototype pollution. Bot fingerprinting + per-IP anomaly scoring (5-min half-life). Monitor mode by default (`RASP_MODE=block` to enforce). Events logged to `security-events` Firestore collection. `GET /api/security/events` (owner-only).

## AI grading

- **v3 pipeline:** card detection (Sonnet, or Together AI GLM-4.6V when `TOGETHER_API_KEY` set) → crop to card → corner crops per side → 8 parallel subgrade calls.
- 8 subgrades: centering/corners/edges/surface × front/back. Each receives only its target image.
- Overall = `(frontAvg × 0.60) + (backAvg × 0.40)`, capped at lowest subgrade + 1 (excessive defect rule).
- Card detection: 4-corner detection → tilt correction (sharp rotate) → crop. Skips when card fills >80% of frame. SSRF-protected (DNS resolution, private IP blocking).
- Centering subgrades return `lr`/`tb` ratios (e.g. "55/45", "52/48") for frontend overlay positioning.
- Full PSA rubric (grades 5-10). Corner crops via `sharp`. eBay images upgraded to s-l1600.
- Falls back to single prompt for non-Claude or missing back image.
- Token usage + estimated cost tracked per grade ($3/$15 per 1M for Claude, $2.50/$10 for OpenAI).
- **Grade probability distribution:** `gradeDistribution` field in response (e.g. `{"8": 65, "8.5": 12, "7.5": 23}`). Computed from overall + confidence.
- **Centering hint:** POST `/api/grade` accepts optional `centeringHint` with user-measured ratios, appended to centering prompts.
- **Shareable reports:** `GET /api/grade/report/:id` returns PNG card (SVG→sharp→PNG) with scores, distribution, limiter.
- **ML dataset pipeline:** graded slab images passively collected into `grading-dataset` Firestore collection from eBay sold (track-prices + /api/sold), magi sold (track-prices), and search sold results (/api/search). Parses PSA/BGS/CGC/TAG grade from listing title or grade label. `GET /api/grading-dataset/stats` (owner-only) monitors collection.
- **Roadmap:** multi-pass median for deterministic grading, defect heatmap overlay, accuracy calibration once dataset reaches ~500 images.

## Set browser

- `GET /api/sets` — 238 sets with logos, era groups, officialCards/secretCards
- `GET /api/sets/:setCode` — cards with rarity (~4K tagged)
- `GET /api/portfolio/set/:setCode` — collection tracking (owned cardIds)

## Key endpoints

- `/api/search` — multi-source search
- `/api/autocomplete` — card name autocomplete (29K cards)
- `/api/sets`, `/api/sets/:setCode` — set browser
- `/api/card/view/:setCode/:number` — card view with raw/graded, PSA, grading ROI
- `/api/price-history` — historical prices + trend signal
- `/api/psa` — PSA grading signal
- `/api/grade` — AI pre-grade (accepts cardId + centeringHint, returns gradeId + gradeDistribution)
- `/api/grade/report/:id` — shareable grade report as PNG
- `/api/grades/mine` — user's grade history
- `/api/grades/:id` (DELETE) — delete a grade
- `/api/upload-url` — signed GCS upload URL for card images
- `/api/portfolio` — portfolio CRUD
- `/api/portfolio/set/:setCode` — collection progress
- `/api/developer/keys` — self-serve API key CRUD
- `/api/developer/stats` — per-user usage stats
- `/api/admin/keys` — admin key management
- `/api/analytics` — request analytics (owner-only)
- `/api/grading-dataset/stats` — ML dataset collection stats (owner-only)
- `/api/security/events` — RASP security event log (owner-only)
- `/auth/google` — Google OAuth → JWT

## Free tier strategy

**Public (no key):** card DB, sets, autocomplete, sitemap, docs, health.
**Demo (`?demo=true`):** 3 hardcoded sample cards. No live API calls.
**Gated (requires key):** live search, AI grading, alerts, portfolio CRUD, admin.

## Infrastructure

- GCP: Cloud Run in asia-south1 + us-central1, Firestore (asia-south1), HTTPS LB (global, geo-routes), Cloud CDN, Secret Manager, Cloud Scheduler
- Terraform: GCS state, 8 files by resource type, CI plan/apply, `for_each` over regions
- **CI (ci.yml):** single workflow. Jobs: unit, api (demo-based, continue-on-error), smoke (non-blocking), codeql, scan (SBOM+Grype), audit (npm+lockfile-lint), secrets (gitleaks). Required: unit + codeql.
- **Deploy:** Kaniko v1.23.2 --reproducible → cosign sign → Binary Auth attestation (KMS) → SBOM attest (Syft SPDX from container) → build provenance (actions/attest-build-provenance) → deploy by digest → both regions → health check → OWASP ZAP DAST
- **Custom Wolfi base image:** us-docker.pkg.dev/casecomp-495718/casecomp-node24/node24. Built with apko. 9 smoke tests. 0 CVEs.
- **Supply chain:** SBOM + SLSA attestations on image digest, SHA-pinned GitHub Actions, Dependabot, lockfile-lint, Socket.dev, pre-commit hook (blocks .env, secrets, large files)
- **Binary Authorization:** ENFORCED on both Cloud Run services, KMS-backed attestor, deploy pipeline creates attestations
- **Secret workflow:** Add to secrets.tf → CI creates → `gcloud secrets versions add` for value. Never `gcloud secrets create`.
- Secrets: EBAY_CLIENT_ID/SECRET, ANTHROPIC_API_KEY, TOGETHER_API_KEY, PSA_AUTH_TOKEN, CASECOMP_API_KEY, CASECOMP_SANDBOX_KEY, RESEND_API_KEY, CASECOMP_JWT_SECRET, GOOGLE_OAUTH_CLIENT_ID, CASECOMP_ADMIN_SUB

## Frontend (casecomp.xyz)

- Separate repo: Pyronewbic/casecomp-drop
- TanStack Start SSR, Cloudflare Workers
- 63 Lovable prompts. 9 routes: /, /search, /sets, /set/$, /card/$, /portfolio, /price-guide, /developers, /install
- Auth: GoogleLogin popup → JWT → authFetch. isAdmin flag for admin features.
- GradeCard.tsx: 2-step upload (front/back), card autocomplete selection (cardId), cloud grading + WebLLM local, v3 8-subgrade display with tap-to-expand, post-grade centering lines, grade probability distribution bar, share button, "Add to collection" post-grade
- Portfolio: graded cards history section (GET /api/grades/mine), expandable subgrade details, delete grades
- Landing: nav cards (clickable feature grid), supported sources, pricing. Agent-ready (.well-known/*).
- CardSearch.tsx: TrendBadge, Raw/Graded tabs, ROI card, Grade/Prices detail panel, AlertForm, Add to Portfolio
- MyApiKeys.tsx, AdminKeys.tsx on /developers
- Nav: Search · Sets · Portfolio · API + avatar dropdown (My Portfolio, Sign Out)

## Backlog

- **Defect heatmap overlay** — LLM outputs bounding boxes for detected defects, overlay on image via sharp
- **Grading accuracy eval** — benchmark script once dataset hits ~500 images, publish accuracy vs PSA
- **Self-hosted vLLM** — RunPod serverless with GLM-4.6V-Flash when volume justifies (~$4/1K grades vs $7.40 Together)
- **TCGPlayer seeding** — accumulate daily
- **Price comparison table** — side-by-side 2-3 cards
- **Grading batch calculator** — multi-card ROI