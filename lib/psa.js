import { cacheGet, cacheSet } from "./firestore.js";

const PSA_API_BASE = "https://api.psacard.com/publicapi";
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

const POP_COLLECTION = "cache-psa-pop";
const SPEC_COLLECTION = "cache-psa-spec";

// ── Helpers ──────────────────────────────────────────────────────────
function difficultyLabel(pct) {
  if (pct == null) return "—";
  if (pct < 1)  return "Brutal";
  if (pct < 5)  return "Hard";
  if (pct < 15) return "Moderate";
  return "Easy";
}

function buildSignal({ pop10, pop9, popTotal }) {
  const psa10Chance = pop10 != null && popTotal ? (pop10 / popTotal) * 100 : null;
  const psa9to10   = pop9  != null && pop10   ? pop9 / pop10 : null;
  return {
    difficulty:    difficultyLabel(psa10Chance),
    psa10Chance,
    psaPopulation: popTotal,
    psa10Count:    pop10,
    psa9Count:     pop9,
    psa9to10Ratio: psa9to10,
  };
}

function tokenize(str) {
  return str.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter(t => t.length > 1);
}

// ── API response parsing ─────────────────────────────────────────────
function parseSpecPopItem(json) {
  const pop = json?.PSAPop;
  if (!pop) return null;
  return { pop10: pop.Grade10 ?? null, pop9: pop.Grade9 ?? null, popTotal: pop.Total ?? null };
}

// ── Spec ID lookup via public cert numbers ───────────────────────────
// Find PSA cert numbers from public sources, then use the cert API to get the SpecID.
// No Playwright needed — just HTTP fetches.

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36";

async function findCertsViaDDG(cardName, { log = () => {} } = {}) {
  const clean = cardName.replace(/['']/g, "").replace(/\d{3,}\/\d{3,}/g, "").trim();
  const q = encodeURIComponent(`gamestop.com PSA ${clean}`);
  const url = `https://html.duckduckgo.com/html/?q=${q}`;
  log(`  psa cert: searching DuckDuckGo → GameStop…`);
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": UA, Accept: "text/html" },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return [];
    const html = await res.text();
    const certs = new Set();
    for (const m of html.matchAll(/PSA(\d{7,10})M/g)) certs.add(m[1]);
    const found = [...certs];
    if (found.length) log(`  psa cert: found ${found.length} cert(s) via DuckDuckGo`);
    return found;
  } catch {
    return [];
  }
}

async function findCertsFromGameStop(cardName, { log = () => {} } = {}) {
  const q = encodeURIComponent(`${cardName} PSA`);
  const url = `https://www.gamestop.com/search/?q=${q}&lang=default`;
  log(`  psa cert: searching GameStop directly…`);
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": UA, Accept: "text/html" },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return [];
    const html = await res.text();
    const certs = new Set();
    for (const m of html.matchAll(/PSA(\d{7,10})M/g)) certs.add(m[1]);
    const found = [...certs];
    if (found.length) log(`  psa cert: found ${found.length} cert(s) from GameStop`);
    return found;
  } catch {
    return [];
  }
}

async function lookupCert(certNumber, token) {
  const url = `${PSA_API_BASE}/cert/GetByCertNumber/${certNumber}`;
  const headers = { Accept: "application/json" };
  if (token) headers.Authorization = `bearer ${token}`;
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(10000) });
  if (!res.ok) return null;
  const json = await res.json();
  const cert = json?.PSACert;
  if (!cert?.SpecID) return null;
  return cert;
}

function scoreCertMatch(cert, tokens) {
  const text = `${cert.Subject ?? ""} ${cert.Brand ?? ""} ${cert.CardNumber ?? ""}`.toLowerCase();
  return tokens.filter(t => text.includes(t)).length;
}

async function findSpecId(cardName, token, { log = () => {} } = {}) {
  const tokens = tokenize(cardName);

  // DuckDuckGo → GameStop (most reliable cert format in URLs)
  let certs = await findCertsViaDDG(cardName, { log });
  if (certs.length === 0) {
    certs = await findCertsFromGameStop(cardName, { log });
  }

  if (certs.length === 0) {
    log(`  psa cert: no cert numbers found`);
    return null;
  }

  // Look up certs and pick the best match by token score
  const limit = Math.min(certs.length, 8);
  let bestSpec = null, bestScore = 0, bestLabel = "";
  for (let i = 0; i < limit; i++) {
    try {
      const cert = await lookupCert(certs[i], token);
      if (!cert) continue;
      const score = scoreCertMatch(cert, tokens);
      const label = `${cert.Subject} (${cert.Brand})`;
      log(`  psa cert: #${certs[i]} → ${label} [score ${score}]`);
      if (score > bestScore) {
        bestScore = score;
        bestSpec = String(cert.SpecID);
        bestLabel = label;
      }
    } catch {}
  }

  if (bestSpec && bestScore >= 2) {
    log(`  psa cert: best match → spec ${bestSpec}: ${bestLabel}`);
    return bestSpec;
  }

  if (bestSpec) log(`  psa cert: best score too low (${bestScore}) — skipping`);
  return null;
}

// ── Authenticated fetch by spec ID ───────────────────────────────────
async function fetchBySpecId(specId, token, { log = () => {} } = {}) {
  const url = `${PSA_API_BASE}/pop/GetPSASpecPopulation/${specId}`;
  log(`  psa pop: GET ${url} (auth)`);
  const res = await fetch(url, {
    headers: { Authorization: `bearer ${token}`, Accept: "application/json" },
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) {
    log(`  psa pop: spec API HTTP ${res.status}`);
    return null;
  }
  return parseSpecPopItem(await res.json());
}

// ── Main entry point ─────────────────────────────────────────────────
export async function getPsaGradingSignal(cardName, { log = console.log } = {}) {
  const key = cardName.toLowerCase().trim().replace(/[/\\. ]+/g, "_");

  const cached = await cacheGet(POP_COLLECTION, key);
  if (cached) {
    log(`  psa pop: cache hit for "${cardName}"`);
    return cached;
  }

  const authToken = process.env.PSA_AUTH_TOKEN?.trim();
  if (!authToken) {
    log(`  psa pop: PSA_AUTH_TOKEN not set — skipping`);
    return null;
  }

  let specId = await cacheGet(SPEC_COLLECTION, key);
  if (!specId) {
    log(`  psa pop: no cached spec ID — searching for cert number…`);
    specId = await findSpecId(cardName, authToken, { log });
    if (specId) await cacheSet(SPEC_COLLECTION, key, specId, 0);
  } else {
    log(`  psa pop: spec ID ${specId} from cache`);
  }

  if (!specId) {
    log(`  psa pop: could not find spec ID`);
    await cacheSet(POP_COLLECTION, key, null, 3_600_000);
    return null;
  }

  let parsed = null;
  try { parsed = await fetchBySpecId(specId, authToken, { log }); }
  catch (e) { log(`  psa pop: spec API error (${e.message})`); }

  if (!parsed) {
    log(`  psa pop: could not parse grade data`);
    await cacheSet(POP_COLLECTION, key, null, 3_600_000);
    return null;
  }

  const signal = buildSignal(parsed);
  log(`  psa pop: pop=${signal.psaPopulation}, PSA10=${signal.psa10Count} (${signal.psa10Chance?.toFixed(1) ?? "?"}%), difficulty=${signal.difficulty}`);

  await cacheSet(POP_COLLECTION, key, signal, CACHE_TTL_MS);
  return signal;
}
