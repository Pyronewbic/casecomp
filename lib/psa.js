import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PSA_API_BASE = "https://api.psacard.com/publicapi";
const POP_CACHE_FILE = path.join(__dirname, "psa-pop-cache.json");
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24h — pop data moves slowly

let _cache = null;

async function loadCache() {
  if (!_cache) {
    try { _cache = JSON.parse(await fs.readFile(POP_CACHE_FILE, "utf8")); }
    catch { _cache = {}; }
  }
  return _cache;
}

async function saveCache() {
  try { await fs.writeFile(POP_CACHE_FILE, JSON.stringify(_cache, null, 2), "utf8"); } catch {}
}

// PSA API returns items in several different shapes depending on endpoint version.
// Parse whichever is present: grades as flat object, array of grade objects, or top-level fields.
function parsePopItem(item) {
  if (!item) return null;

  let pop10 = null, pop9 = null, popTotal = null;

  const grades = item.grades ?? item.PSAGrade ?? item.Grades ?? null;

  if (grades && !Array.isArray(grades)) {
    // Flat object: { grade10: N, grade9: N, ... }
    pop10 = grades.grade10 ?? grades["10"] ?? grades.Grade10 ?? null;
    pop9  = grades.grade9  ?? grades["9"]  ?? grades.Grade9  ?? null;
  } else if (Array.isArray(grades)) {
    // Array: [{ Grade: "PSA 10", PopulationCount: N }, ...]
    for (const g of grades) {
      const label = String(g.Grade ?? g.grade ?? "").replace(/PSA\s*/i, "").trim();
      const count = g.PopulationCount ?? g.count ?? g.Count ?? 0;
      if (label === "10") pop10 = count;
      if (label === "9")  pop9  = count;
    }
  }

  // totalPopulation may be top-level or inside grades
  popTotal = item.totalPopulation
    ?? item.TotalPopulation
    ?? item.total
    ?? grades?.total
    ?? null;

  // Fallback: sum numeric grade fields if total missing
  if (popTotal == null && grades && !Array.isArray(grades)) {
    popTotal = Object.entries(grades)
      .filter(([k]) => /^\d+$/.test(k.replace(/grade/i, "")))
      .reduce((s, [, v]) => s + (Number(v) || 0), 0) || null;
  }

  return (pop10 != null || popTotal != null) ? { pop10, pop9, popTotal } : null;
}

// Pick the best matching item from the API result set.
// Strategy: prefer items whose name/subject contains the most tokens from the query.
function bestMatch(items, cardName) {
  const tokens = cardName.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter(Boolean);
  let best = null, bestScore = -1;
  for (const item of items) {
    const name = (item.subject ?? item.CardName ?? item.name ?? item.title ?? "").toLowerCase();
    const score = tokens.filter(t => name.includes(t)).length;
    if (score > bestScore) { bestScore = score; best = item; }
  }
  return best;
}

function difficultyLabel(pct) {
  if (pct == null) return "—";
  if (pct < 1)  return "Brutal";
  if (pct < 5)  return "Hard";
  if (pct < 15) return "Moderate";
  return "Easy";
}

export async function getPsaGradingSignal(cardName, { log = console.log } = {}) {
  const key = cardName.toLowerCase().trim();
  const cache = await loadCache();

  const cached = cache[key];
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    log(`  psa pop: cache hit for "${cardName}"`);
    return cached.data;
  }

  try {
    const url = `${PSA_API_BASE}/pop/GetPopulationByCriteria?${new URLSearchParams({ title: cardName })}`;
    log(`  psa pop: GET ${url}`);

    const psaKey = process.env.PSA_AUTH_TOKEN;
    const headers = { Accept: "application/json" };
    if (psaKey) headers["Authorization"] = `bearer ${psaKey}`;

    let res = await fetch(url, { headers, signal: AbortSignal.timeout(10000) });

    // Authenticated endpoint returns 404 for title-search (only specID endpoint is in swagger).
    // Fall back to anonymous which supports GetPopulationByCriteria.
    if (res.status === 404 && psaKey) {
      log(`  psa pop: bearer 404, retrying anonymous`);
      const anonHeaders = { Accept: "application/json" };
      res = await fetch(url, { headers: anonHeaders, signal: AbortSignal.timeout(10000) });
    }

    if (res.status === 429) {
      log(`  psa pop: rate limited (100 req/day anonymous quota — resets daily)`);
      return null;
    }
    if (!res.ok) {
      log(`  psa pop: HTTP ${res.status}`);
      return null;
    }

    const raw = await res.json();
    log(`  psa pop: raw response keys: ${Object.keys(Array.isArray(raw) ? (raw[0] ?? {}) : raw).join(", ")}`);

    // Normalise: root may be array, or wrapped in {PSASet:{PSACards:[]}}, {items:[]}, etc.
    const items = Array.isArray(raw)
      ? raw
      : raw?.PSASet?.PSACards ?? raw?.items ?? raw?.results ?? [raw];

    const match = bestMatch(items, cardName);
    const parsed = parsePopItem(match);

    if (!parsed) {
      log(`  psa pop: could not parse grade data — raw: ${JSON.stringify(raw).slice(0, 300)}`);
      // Cache a null result for 1h to avoid hammering on bad data
      cache[key] = { fetchedAt: Date.now() - CACHE_TTL_MS + 3_600_000, data: null };
      await saveCache();
      return null;
    }

    const { pop10, pop9, popTotal } = parsed;
    const psa10Chance = pop10 != null && popTotal ? (pop10 / popTotal) * 100 : null;
    const psa9to10   = pop9  != null && pop10   ? pop9 / pop10 : null;

    const signal = {
      difficulty:    difficultyLabel(psa10Chance),
      psa10Chance,
      psaPopulation: popTotal,
      psa10Count:    pop10,
      psa9Count:     pop9,
      psa9to10Ratio: psa9to10,
    };

    log(`  psa pop: pop=${popTotal}, PSA10=${pop10} (${psa10Chance?.toFixed(1) ?? "?"}%), difficulty=${signal.difficulty}`);

    cache[key] = { fetchedAt: Date.now(), data: signal };
    await saveCache();
    return signal;

  } catch (e) {
    log(`  psa pop: failed (${e.message})`);
    return null;
  }
}
