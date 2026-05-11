import {
  EBAY_CATEGORY_TCG_SINGLE_CARDS_US,
  EBAY_ITEM_SPECIFIC_LANGUAGE_ASPECT_NAME,
  EBAY_ITEM_SPECIFIC_LANGUAGE_ENGLISH,
  EBAY_ITEM_SPECIFIC_LANGUAGE_JAPANESE,
  EBAY_ITEM_SPECIFIC_LANGUAGE_CHINESE,
} from "./ebayCategories.js";

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

function titleSignalsChineseMarket(title) {
  if (!title || typeof title !== "string") return false;
  if (titleLooksChineseRegionalListing(title)) return true;
  const lower = title.toLowerCase();
  if (/\bchinese\b/.test(lower)) return true;
  if (/\bcn\b/.test(lower)) return true;
  if (/\bchina\b/.test(lower)) return true;
  return false;
}

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

/**
 * TCG singles leaf (`leafCategoryIds`) — browse path:
 * Toys & Hobbies › Collectible Card Games › Single Cards (= `ebayCategories`).
 */
export const TCG_LEAF_CATEGORY_IDS = new Set([EBAY_CATEGORY_TCG_SINGLE_CARDS_US]);

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
  if (/\b(psa|bgs|cgc|sgc|ccic)\s*[#:]?\s*\d/.test(t)) return true;
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

/**
 * Canonical `--lang` / `CONFIG.language` tokens used across Browse + filters.
 */
export function normalizeListingLanguage(value) {
  if (value === null || value === undefined) return "any";
  const u = String(value).trim().toLowerCase();
  if (u === "" || u === "any") return "any";
  if (u === "eng" || u === "en" || u === "english") return "eng";
  if (u === "jp" || u === "japanese") return "jp";
  if (u === "cn" || u === "chinese") return "cn";
  return null;
}

const LANG_PARSE_SPLIT = /[,;|]/;

const CANON_LANG_ORDER = { eng: 0, jp: 1, cn: 2 };

/**
 * Parses `--lang english,jp`, semicolons/pipes, or repeated `--lang` joined with commas.
 * `any` (alone or clears list) → `[]`.
 */
export function parseListingLanguagesFromInput(raw, onWarn = null) {
  const warn =
    typeof onWarn === "function"
      ? onWarn
      : (msg) => console.warn(msg);
  let s = "";
  if (Array.isArray(raw)) s = raw.map(String).join(",").trim();
  else s = String(raw ?? "any").trim();
  if (!s || /^any$/i.test(s)) return [];

  const parts = s.split(LANG_PARSE_SPLIT).map((x) => x.trim()).filter(Boolean);
  if (!parts.length) return [];
  const tokens = [];
  for (const p of parts) {
    if (/[\s]/.test(p))
      tokens.push(...p.split(/\s+/).map((x) => x.trim()).filter(Boolean));
    else tokens.push(p);
  }

  const out = [];
  const seen = new Set();
  for (const tok of tokens) {
    if (!tok || /^any$/i.test(tok)) return [];
    const c = normalizeListingLanguage(tok);
    if (c === "any") return [];
    if (c == null) {
      warn?.(`Unknown language token "${tok}" (ignored)`);
      continue;
    }
    if (!seen.has(c)) {
      seen.add(c);
      out.push(c);
    }
  }

  out.sort((a, b) => CANON_LANG_ORDER[a] - CANON_LANG_ORDER[b]);
  return out;
}

export function listingLanguagesCacheTag(langs) {
  return langs && langs.length ? [...langs].sort().join("+") : "any";
}

export function filterByListedLanguages(results, langs) {
  if (!langs || langs.length === 0) return results;
  return results.filter((r) =>
    langs.some((lc) => filterByLanguage([r], lc).length === 1),
  );
}

/** Item specifics Language must match one of the selected facets when Browse returns it. */
export function enforceListingLanguageFacetMatchLangs(results, langs) {
  if (!langs || langs.length === 0) return results;
  const wantLcs = langs.map((lc) => {
    const d =
      lc === "eng"
        ? EBAY_ITEM_SPECIFIC_LANGUAGE_ENGLISH
        : lc === "jp"
          ? EBAY_ITEM_SPECIFIC_LANGUAGE_JAPANESE
          : EBAY_ITEM_SPECIFIC_LANGUAGE_CHINESE;
    return d.toLowerCase();
  });
  return results.filter((r) => {
    const fv = listingLanguageFacetFromItem(r.raw);
    if (!fv) return true;
    return wantLcs.includes(fv.trim().toLowerCase());
  });
}

export function detectLanguage(title) {
  if (!title || typeof title !== "string") return "unknown";
  if (titleSignalsChineseMarket(title)) return "cn";
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

function aspectNameMatchesLanguage(name) {
  return (
    String(name || "").trim().toLowerCase() ===
    EBAY_ITEM_SPECIFIC_LANGUAGE_ASPECT_NAME.toLowerCase()
  );
}

function unwrapLocalizedAspectValue(aspectRoot) {
  if (!aspectRoot || typeof aspectRoot !== "object") return "";
  const vRoot = aspectRoot.localizedAspectValue ?? aspectRoot.aspectValue;
  if (vRoot != null && typeof vRoot !== "object") return String(vRoot).trim();
  if (vRoot != null && typeof vRoot === "object") {
    if (typeof vRoot.localizedAspectValueName === "string")
      return vRoot.localizedAspectValueName.trim();
    if (typeof vRoot.value === "string") return vRoot.value.trim();
  }
  return "";
}

/** Language display from Browse item localizedAspects (Item specifics Language row when API returns it). */
export function listingLanguageFacetFromItem(apiItem) {
  const aspects = apiItem?.localizedAspects;
  if (!Array.isArray(aspects)) return null;
  for (const asp of aspects) {
    const nm = asp.localizedAspectName ?? asp.aspectName ?? asp.name;
    if (!aspectNameMatchesLanguage(nm)) continue;
    let text = unwrapLocalizedAspectValue(asp);
    if (!text && Array.isArray(asp.localizedAspectValues)) {
      for (const piece of asp.localizedAspectValues) {
        if (typeof piece === "string" && piece.trim()) {
          text = piece.trim();
          break;
        }
        const inner =
          piece?.localizedAspectValueName ??
          piece?.localizedAspectValue ??
          piece?.value;
        if (inner != null && String(inner).trim()) {
          text = String(inner).trim();
          break;
        }
      }
    }
    return text.trim() ? text.trim() : null;
  }
  return null;
}

function aspectNameIsCondition(name) {
  const n = String(name || "").trim().toLowerCase();
  return n === "condition" || n === "item condition";
}

/** Browse `localizedAspects` row whose name is Condition (seller-stated grading text often lives here). */
export function listingConditionFacetFromItem(apiItem) {
  const aspects = apiItem?.localizedAspects;
  if (!Array.isArray(aspects)) return null;
  for (const asp of aspects) {
    const nm = asp.localizedAspectName ?? asp.aspectName ?? asp.name;
    if (!aspectNameIsCondition(nm)) continue;
    let text = unwrapLocalizedAspectValue(asp);
    if (!text && Array.isArray(asp.localizedAspectValues)) {
      for (const piece of asp.localizedAspectValues) {
        if (typeof piece === "string" && piece.trim()) {
          text = piece.trim();
          break;
        }
        const inner =
          piece?.localizedAspectValueName ??
          piece?.localizedAspectValue ??
          piece?.value;
        if (inner != null && String(inner).trim()) {
          text = String(inner).trim();
          break;
        }
      }
    }
    return text?.trim() ? text.trim() : null;
  }
  return null;
}

/**
 * Pulls PSA 10-style labels from strings like `Graded - PSA 10: Professionally graded…`.
 * @returns {{ grader: string, grade: string, label: string } | null}
 */
export function parseSellerSlabFromConditionText(text) {
  if (!text || typeof text !== "string") return null;
  const t = text.trim();
  const graded = t.match(
    /graded\s*[-–—]\s*(PSA|BGS|CGC|SGC|BCCG|TAG|ACE|HGA|CCIC)\s*([0-9]{1,2}(?:\.5)?)\b/i,
  );
  if (graded) {
    return {
      grader: graded[1].toUpperCase(),
      grade: graded[2],
      label: `${graded[1].toUpperCase()} ${graded[2]}`,
    };
  }
  const gradedColon = t.match(
    /graded\s*:\s*(PSA|BGS|CGC|SGC|BCCG|TAG|ACE|HGA|CCIC)\s*([0-9]{1,2}(?:\.5)?)\b/i,
  );
  if (gradedColon) {
    return {
      grader: gradedColon[1].toUpperCase(),
      grade: gradedColon[2],
      label: `${gradedColon[1].toUpperCase()} ${gradedColon[2]}`,
    };
  }
  const gradedWord = t.match(
    /^graded\s+(?!by\b)(PSA|BGS|CGC|SGC|BCCG|TAG|ACE|HGA|CCIC)\s+([0-9]{1,2}(?:\.5)?)\b/i,
  );
  if (gradedWord) {
    return {
      grader: gradedWord[1].toUpperCase(),
      grade: gradedWord[2],
      label: `${gradedWord[1].toUpperCase()} ${gradedWord[2]}`,
    };
  }
  const gemMint = t.match(
    /\b(PSA|BGS|CGC|SGC|BCCG|TAG|ACE|HGA|CCIC)\s+GEM\s+MINT\s+([0-9]{1,2}(?:\.5)?)\b/i,
  );
  if (gemMint) {
    return {
      grader: gemMint[1].toUpperCase(),
      grade: gemMint[2],
      label: `${gemMint[1].toUpperCase()} ${gemMint[2]}`,
    };
  }
  const inline = t.match(
    /\b(PSA|BGS|CGC|SGC|BCCG|TAG|ACE|HGA|CCIC)\s*(?:grade\s*)?[#:\/]?\s*([0-9]{1,2}(?:\.5)?)\b/i,
  );
  if (inline) {
    return {
      grader: inline[1].toUpperCase(),
      grade: inline[2],
      label: `${inline[1].toUpperCase()} ${inline[2]}`,
    };
  }
  const compact = t.match(
    /\b(PSA|BGS|CGC|SGC|BCCG|TAG|ACE|HGA|CCIC)(\d{1,2}(?:\.5)?)(?!\d)/i,
  );
  if (compact) {
    return {
      grader: compact[1].toUpperCase(),
      grade: compact[2],
      label: `${compact[1].toUpperCase()} ${compact[2]}`,
    };
  }
  const paren = t.match(
    /\(\s*(PSA|BGS|CGC|SGC|BCCG|TAG|ACE|HGA|CCIC)\s*[#:]?\s*([0-9]{1,2}(?:\.5)?)\s*\)/i,
  );
  if (paren) {
    return {
      grader: paren[1].toUpperCase(),
      grade: paren[2],
      label: `${paren[1].toUpperCase()} ${paren[2]}`,
    };
  }
  return null;
}

/** Display line for seller slab or condition snippet: e.g. `PSA 10` (plain; no `Graded:` prefix). */
export function listingGradeLabelFromSellerCondition(
  conditionFacet,
  conditionFallback,
) {
  const facet =
    typeof conditionFacet === "string" ? conditionFacet.trim() : "";
  const top =
    typeof conditionFallback === "string" ? conditionFallback.trim() : "";
  const slab =
    parseSellerSlabFromConditionText(facet) ||
    parseSellerSlabFromConditionText(top);
  if (slab) return slab.label;

  const rawPrimary = facet || top;
  if (!rawPrimary) return "";

  const afterColon = rawPrimary.includes(":")
    ? rawPrimary.slice(rawPrimary.indexOf(":") + 1).trim().split("|")[0].trim()
    : "";
  if (afterColon && /^graded$/i.test(rawPrimary.split(":")[0].trim())) {
    const retry = parseSellerSlabFromConditionText(afterColon);
    if (retry) return retry.label;
  }

  const head = rawPrimary.split("|")[0].split(":")[0].trim();
  if (/^graded$/i.test(head) || /^graded$/i.test(rawPrimary)) {
    const retry2 =
      parseSellerSlabFromConditionText(afterColon) ||
      parseSellerSlabFromConditionText(rawPrimary);
    if (retry2) return retry2.label;
    if (afterColon) {
      const s =
        afterColon.length > 48 ? `${afterColon.slice(0, 45)}…` : afterColon;
      return s;
    }
    return "";
  }

  const segment = head || rawPrimary;
  const s = segment.length > 48 ? `${segment.slice(0, 45)}…` : segment;
  return s || "";
}

/**
 * Seller-facing grade line: Condition facet + Browse condition, then **title** (many slabs only say PSA 10 in the title).
 */
export function listingGradeLabelFromSellerListing(part = {}) {
  const facet = listingConditionFacetFromItem(part);
  const top = String(
    part.condition != null && String(part.condition).trim() !== ""
      ? part.condition
      : part.conditionId != null
        ? String(part.conditionId).trim()
        : "",
  ).trim();

  const slabInCond =
    parseSellerSlabFromConditionText(facet) ||
    parseSellerSlabFromConditionText(top);
  if (slabInCond) {
    return listingGradeLabelFromSellerCondition(facet, top);
  }

  const titleSlab = parseSellerSlabFromConditionText(
    String(part.title ?? "").trim(),
  );
  if (titleSlab) return titleSlab.label;

  return listingGradeLabelFromSellerCondition(facet, top);
}

/**
 * Drop summaries whose Language facet contradicts Browse `aspect_filter` / `--lang`
 * (handles partial API payloads — only filters when facet value present).
 */
export function enforceListingLanguageFacetMatch(results, lang) {
  if (lang === "any" || lang == null) return results;
  if (lang !== "eng" && lang !== "jp" && lang !== "cn") return results;
  return enforceListingLanguageFacetMatchLangs(results, [lang]);
}

export function filterByLanguage(results, lang) {
  if (lang === "any") return results;
  return results.filter((r) => {
    const d = detectLanguage(r.title || "");
    // eBay titles often use en-dashes, bullets, ™, etc. — those are "unknown"
    // but are still English listings; keep unless we detected another market.
    if (lang === "eng") return d === "eng" || d === "unknown";
    if (lang === "jp") return d === "jp";
    if (lang === "cn") return d === "cn" || d === "unknown";
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
    /\b(PSA|BGS|BCCG|CGC|SGC|TAG|ACE|HGA|CCIC)\s*[0-9]{1,2}(?:\.5)?\b/i.test(t) ||
    /\b(PSA|BGS|CGC|SGC|CCIC)\s*#/i.test(t)
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
