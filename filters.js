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
  "set",
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

/** eBay US leaf categories that are usually actual TCG singles (not figures/DVDs). */
export const TCG_LEAF_CATEGORY_IDS = new Set(["183454"]);

/**
 * Titles that strongly suggest non-card merchandise (DVDs, figures, stickers, etc.).
 * Does not include the word "movie" alone — many legit promos say "10th movie".
 */
const NON_CARD_TITLE_HINTS = [
  " dvd",
  " blu-ray",
  "bluray",
  " blu ray",
  "bottle cap",
  "keychain",
  "key chain",
  "sticker not",
  "not the real card",
  "not actual card",
  "not official",
  "gag gift",
  "novelty keychain",
  "fan made",
  "custom art card",
  "plush",
  " ornament",
  " light fx",
  "scale figure",
  " mini figure",
  "funko",
  " tomica ",
  "deco chara",
  "premium seat",
  "commemoration premium",
  "figure f/s",
  "figure collection",
  "miniature figure",
  "bottle cap mini",
  "hasbro pokemon",
  "anniversary figure",
  "stickers to choose",
  "sticker card", // often sticker sheets, not TCG
  "display case",
  "acrylic case",
  "magnetic case",
  "one touch",
];

function titleLooksLikeNonCardMerch(title) {
  const t = (title || "").toLowerCase();
  if (/\bdvd\b|blu-?ray/.test(t)) return true;
  if (/^\s*sticker\b/i.test(t)) return true;
  if (/\bsticker\b/i.test(title) && /\bnot\b.*\bcard\b/i.test(t)) return true;
  if (/\*sticker\*/i.test(title)) return true;
  for (const h of NON_CARD_TITLE_HINTS) {
    if (t.includes(h)) return true;
  }
  return false;
}

function titleHasTcgCardSignal(title) {
  const t = (title || "").toLowerCase();
  if (/\b(card|tcg|ccg|jcc)\b/.test(t)) return true;
  if (/\bholo\b|reverse holo|1st edition|first edition|shadowless|\bpromo\b/.test(t))
    return true;
  if (/\bungraded\b|\braw\b/.test(t)) return true;
  if (/\b(psa|bgs|cgc|sgc)\s*[#:]?\s*\d/.test(t)) return true;
  if (/\b\d{1,3}\s*\/\s*\d{2,3}\b/.test(t)) return true;
  if (/pokémon card|pokemon card/.test(t)) return true;
  return false;
}

/**
 * Keep listings that look like trading cards. Uses eBay leaf category when present
 * (Browse `leafCategoryIds`), otherwise title heuristics.
 */
export function filterToLikelyTcgCards(items) {
  return items.filter((r) => {
    const lids = r.leafCategoryIds ?? r.raw?.leafCategoryIds;
    const idList = Array.isArray(lids) ? lids.map(String) : [];
    const inTcgLeaf = idList.some((id) => TCG_LEAF_CATEGORY_IDS.has(id));

    if (inTcgLeaf) {
      return !titleLooksLikeNonCardMerch(r.title);
    }
    if (titleLooksLikeNonCardMerch(r.title)) return false;
    return titleHasTcgCardSignal(r.title);
  });
}

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

/** Card / relevance line mentions Japanese market (not the same as --lang jp). */
export function querySeeksJapaneseMarket(query) {
  const q = (query || "").toLowerCase();
  return (
    /\bjapanese\b/.test(q) || /\bjapan\b/.test(q) || /\bjpn\b/.test(q)
  );
}

/** eBay sellers often tag Simplified / Traditional Chinese product lines. */
function titleLooksChineseRegionalListing(title) {
  const t = (title || "").toLowerCase();
  if (t.includes("s-chinese") || t.includes("s chinese")) return true;
  if (t.includes("simplified chinese")) return true;
  if (
    t.includes("traditional chinese") ||
    t.includes("trad. chinese") ||
    t.includes("trad chinese")
  ) {
    return true;
  }
  if (/\bt-chinese\b/.test(t) || /\bt chinese\b/.test(t)) return true;
  if (t.includes("chinese version")) return true;
  if (/简体中文|繁体中文|繁體中文/.test(title || "")) return true;
  return false;
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
    keywordFallback: false,
  };
  const keywords = tokenizeQuery(query);
  const queryLower = query.toLowerCase();
  const pokemon = extractPokemonName(query);
  const qCompact = queryLower.replace(/\s+/g, "");
  const minMatch =
    keywords.length === 0
      ? 0
      : Math.max(1, Math.ceil(keywords.length * 0.5));

  let filtered = results.filter((r) => {
    const title = (r.title || "").toLowerCase();
    const titleCompact = title.replace(/\s+/g, "");
    if (keywords.length > 0) {
      if (qCompact.length >= 8 && titleCompact.includes(qCompact)) return true;
      let matched = 0;
      for (const kw of keywords) {
        if (title.includes(kw)) matched++;
      }
      if (matched < minMatch) return false;
    }
    return true;
  });

  if (filtered.length === 0 && results.length > 0 && pokemon) {
    const rescue = results.filter((r) => {
      const title = (r.title || "").toLowerCase();
      if (!title.includes(pokemon.toLowerCase())) return false;
      return !titleHasBlocklist(r.title || "", queryLower);
    });
    if (rescue.length > 0) {
      filtered = rescue;
      stats.keywordFallback = true;
    }
  }

  stats.afterKeywordRatio = filtered.length;

  const afterBlock = filtered.filter((r) => {
    const hit = titleHasBlocklist(r.title || "", queryLower);
    return !hit;
  });
  stats.afterBlocklist = afterBlock.length;

  let out = afterBlock.filter((r) => {
    if (!pokemon) return true;
    return (r.title || "").toLowerCase().includes(pokemon.toLowerCase());
  });
  stats.afterPokemonName = out.length;

  if (querySeeksJapaneseMarket(query)) {
    const before = out.length;
    out = out.filter((r) => !titleLooksChineseRegionalListing(r.title));
    stats.afterJapaneseRegional = out.length;
    if (before > out.length) {
      stats.droppedChineseRegional = before - out.length;
    }
  }

  console.log(
    `[filterRelevantResults] query="${query}" in=${stats.input} ≥50%kw=${stats.afterKeywordRatio}${stats.keywordFallback ? " (name+blocklist fallback)" : ""} blocklist=${stats.afterBlocklist} pokemon=${stats.afterPokemonName}${stats.droppedChineseRegional ? ` −CN=${stats.droppedChineseRegional} → ${stats.afterJapaneseRegional}` : ""}`,
  );

  return { filtered: out, stats };
}

export function filterByLanguage(results, lang) {
  if (lang === "any") return results;
  return results.filter((r) => {
    const d = detectLanguage(r.title || "");
    // eBay titles often use en-dashes, bullets, ™, etc. — those are "unknown"
    // but are still English listings; keep them unless we detected Japanese.
    if (lang === "eng") return d === "eng" || d === "unknown";
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
