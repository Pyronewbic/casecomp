const STOPWORDS = new Set([
  "a",
  "an",
  "the",
  "and",
  "or",
  "for",
  "to",
  "of",
  "in",
  "on",
  "with",
  "from",
  "by",
  "card",
  "cards",
  "pokemon",
  "pokémon",
  "tcg",
  "nm",
  "mint",
  "lp",
  "mp",
  "hp",
]);

const JP_REGEX =
  /[\u3000-\u303f\u3040-\u309f\u30a0-\u30ff\uff00-\uff9f\u4e00-\u9faf]/;

const BLOCKLIST = [
  "lot",
  "bundle",
  "proxy",
  "custom",
  "fake",
  "replica",
  "art card",
  "metal card",
  "oversized",
];

const ASCII_LATIN_REGEX = /^[\x00-\x7F\u00C0-\u024F\s\d\-&',.+()]+$/u;

export function detectLanguage(title) {
  if (!title || typeof title !== "string") return "unknown";
  const t = title;
  if (JP_REGEX.test(t)) return "jp";
  const lower = t.toLowerCase();
  if (
    lower.includes("japanese") ||
    /\bjp\b/i.test(t) ||
    lower.includes("japan")
  ) {
    return "jp";
  }
  if (ASCII_LATIN_REGEX.test(t)) return "eng";
  return "unknown";
}

export function tokenizeQuery(query) {
  return query
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 1 && !STOPWORDS.has(w));
}

/** First significant token treated as Pokémon name (e.g. Pikachu, Mew). */
export function extractPokemonName(query) {
  const tokens = tokenizeQuery(query);
  return tokens[0] || null;
}

function titleHasBlocklist(title, queryLower) {
  const tl = title.toLowerCase();
  for (const word of BLOCKLIST) {
    if (!queryLower.includes(word) && tl.includes(word)) return word;
  }
  return null;
}

/**
 * Post-filter listings. Assumes language filter already applied when needed.
 * @param {Array<{ title: string }>} results
 * @param {string} query
 * @returns {{ filtered: typeof results, stats: object }}
 */
export function filterRelevantResults(results, query) {
  const stats = {
    input: results.length,
    afterKeywordRatio: 0,
    afterBlocklist: 0,
    afterPokemonName: 0,
  };
  const keywords = tokenizeQuery(query);
  const queryLower = query.toLowerCase();
  const pokemon = extractPokemonName(query);
  const minMatch =
    keywords.length === 0 ? 0 : Math.ceil(keywords.length * 0.6);

  const filtered = results.filter((r) => {
    const title = (r.title || "").toLowerCase();
    if (keywords.length > 0) {
      let matched = 0;
      for (const kw of keywords) {
        if (title.includes(kw)) matched++;
      }
      if (matched < minMatch) return false;
    }
    return true;
  });
  stats.afterKeywordRatio = filtered.length;

  const afterBlock = filtered.filter((r) => {
    const hit = titleHasBlocklist(r.title || "", queryLower);
    return !hit;
  });
  stats.afterBlocklist = afterBlock.length;

  const finalList = afterBlock.filter((r) => {
    if (!pokemon) return true;
    return (r.title || "").toLowerCase().includes(pokemon.toLowerCase());
  });
  stats.afterPokemonName = finalList.length;

  console.log(
    `[filterRelevantResults] query="${query}" in=${stats.input} ≥60%kw=${stats.afterKeywordRatio} blocklist=${stats.afterBlocklist} pokemon=${stats.afterPokemonName}`,
  );

  return { filtered: finalList, stats };
}

export function filterByLanguage(results, lang) {
  if (lang === "any") return results;
  return results.filter((r) => {
    const d = detectLanguage(r.title || "");
    if (lang === "eng") return d === "eng";
    if (lang === "jp") return d === "jp";
    return true;
  });
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Heuristic: title references a third-party slab grade (exclude for raw hunts). */
export function titleLooksGradedSlab(title) {
  const t = title || "";
  return (
    /\b(PSA|BGS|BCCG|CGC|SGC|TAG|ACE|HGA)\s*[0-9]{1,2}(?:\.5)?\b/i.test(t) ||
    /\b(PSA|BGS|CGC|SGC)\s*#/i.test(t)
  );
}

/**
 * For slab mode: title should mention the grader and grade (loose match).
 */
export function titleMatchesSlabListing(title, provider, grade) {
  const t = title || "";
  const pl = String(provider || "").trim();
  const g = String(grade ?? "").trim();
  if (!pl || !g) return true;
  const tl = t.toLowerCase();
  if (!tl.includes(pl.toLowerCase())) return false;
  const gEsc = escapeRe(g);
  const afterProvider = new RegExp(
    `${escapeRe(pl)}\\s*[#:]?\\s*${gEsc}\\b`,
    "i",
  );
  if (afterProvider.test(t)) return true;
  const compact = new RegExp(`${escapeRe(pl)}\\s*${gEsc}\\b`, "i");
  if (compact.test(t)) return true;
  return new RegExp(`\\b${gEsc}\\b`).test(t);
}

/**
 * Post-filter by listing format after language + relevance.
 * @param {Array<{ title: string }>} results
 */
export function filterByListingFormat(results, config) {
  const fmt = config.listingFormat ?? "raw";
  if (fmt === "slab") {
    const p = String(config.slab?.provider ?? "PSA").trim();
    const g = String(config.slab?.grade ?? "10").trim();
    return results.filter((r) => titleMatchesSlabListing(r.title, p, g));
  }
  if (fmt === "raw") {
    return results.filter((r) => !titleLooksGradedSlab(r.title));
  }
  return results;
}
