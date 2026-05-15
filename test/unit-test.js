import { parseGradeJSON, roundGrade, validateAndShape } from "../lib/grading/grading.js";
import { buildSignal } from "../lib/grading/psa.js";
import { deriveEra } from "../lib/cards/card-database.js";
import { cornerCropsToImageBlocks, imageBlockFromUrl, imageBlockFromBase64, parseAnthropicResponse, parseTogetherResponse } from "../lib/grading/preprocessing.js";
import { buildEbaySearchQuery, describeListingSearch } from "../lib/search/listingQuery.js";
import {
  filterByCondition,
  detectCondition,
  flagPriceOutliers,
  detectLanguage,
  tokenizeQuery,
  extractPokemonName,
  normalizeListingLanguage,
  parseListingLanguagesFromInput,
  filterByLanguage,
  filterByListingFormat,
  titleLooksGradedSlab,
  titleMatchesSlabListing,
  parseSellerSlabFromConditionText,
  filterRelevantResults,
  querySeeksJapaneseMarket,
  filterToLikelyTcgCards,
  isGradedCard,
} from "../lib/search/filters.js";
import { isDemoQuery, getDemoResult, getDemoSearchResult, listDemoCards, findDemoByNumber } from "../lib/cards/demo.js";
import { parseCardIdentity, buildCardId, SET_NAME_MAP, resolveCardIdToQuery } from "../lib/cards/card-identity.js";
import { buildAlertEmailSubject, sendAlertEmail } from "../lib/data/email.js";
import { csvEscape, csvRow } from "../lib/data/csv.js";
import { matchesQuery, searchCards, getAllSets, getSetWithCards } from "../lib/cards/card-database.js";
import { computePriceTrend } from "../lib/cards/price-history.js";
import { findCardByCardId } from "../lib/cards/card-database.js";

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  \x1b[32m✓\x1b[0m ${name}`);
    passed++;
  } catch (e) {
    console.log(`  \x1b[31m✗\x1b[0m ${name} — ${e.message}`);
    failed++;
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg || "assertion failed");
}

function eq(a, b, msg) {
  assert(a === b, msg || `expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
}

// ── parseGradeJSON ──

console.log("\n\x1b[1m=== parseGradeJSON ===\x1b[0m");

test("parses clean JSON", () => {
  const r = parseGradeJSON('{"overall": 9.5}');
  assert(r.ok, "should parse");
  eq(r.ok.overall, 9.5);
});

test("extracts from markdown fence", () => {
  const r = parseGradeJSON('```json\n{"overall": 8}\n```');
  assert(r.ok);
  eq(r.ok.overall, 8);
});

test("extracts from prose + JSON", () => {
  const r = parseGradeJSON('Here is the grade: {"overall": 7, "centering": 6} and that is it.');
  assert(r.ok);
  eq(r.ok.overall, 7);
});

test("returns error for empty input", () => {
  const r = parseGradeJSON("");
  assert(r.error);
});

test("returns error for null", () => {
  const r = parseGradeJSON(null);
  assert(r.error);
});

test("returns error for garbage", () => {
  const r = parseGradeJSON("not json at all");
  assert(r.error);
});

// ── buildEbaySearchQuery ──

console.log("\n\x1b[1m=== buildEbaySearchQuery ===\x1b[0m");

test("raw format returns card name only", () => {
  eq(buildEbaySearchQuery("Pikachu VMAX", { listingFormat: "raw" }), "Pikachu VMAX");
});

test("raw with suffix appends it", () => {
  eq(buildEbaySearchQuery("Pikachu", { listingFormat: "raw", rawSearchSuffix: "-lot -bundle" }), "Pikachu -lot -bundle");
});

test("slab appends provider and grade", () => {
  eq(buildEbaySearchQuery("Umbreon ex", { listingFormat: "slab", slab: { provider: "PSA", grade: "10" } }), "Umbreon ex PSA 10");
});

test("slab defaults to PSA 10", () => {
  eq(buildEbaySearchQuery("Charizard", { listingFormat: "slab" }), "Charizard PSA 10");
});

test("trims whitespace", () => {
  eq(buildEbaySearchQuery("  Mew  ", { listingFormat: "raw" }), "Mew");
});

// ── describeListingSearch ──

console.log("\n\x1b[1m=== describeListingSearch ===\x1b[0m");

test("slab description", () => {
  const r = describeListingSearch({ listingFormat: "slab", slab: { provider: "BGS", grade: "9.5" } });
  assert(r.includes("BGS 9.5"));
});

test("raw description without suffix", () => {
  const r = describeListingSearch({ listingFormat: "raw" });
  assert(r.includes("non-slab"));
});

// ── detectLanguage ──

console.log("\n\x1b[1m=== detectLanguage ===\x1b[0m");

test("English title", () => {
  eq(detectLanguage("Pikachu VMAX Alt Art 188/184"), "eng");
});

test("Japanese title with katakana", () => {
  eq(detectLanguage("ピカチュウex SAR 234/193"), "jp");
});

test("title with 'Japanese' keyword", () => {
  eq(detectLanguage("Umbreon ex SAR Japanese Pokemon"), "jp");
});

test("Chinese market signal", () => {
  eq(detectLanguage("Pikachu S-Chinese version"), "cn");
});

test("empty returns unknown", () => {
  eq(detectLanguage(""), "unknown");
});

// ── tokenizeQuery ──

console.log("\n\x1b[1m=== tokenizeQuery ===\x1b[0m");

test("removes stopwords", () => {
  const tokens = tokenizeQuery("the Pokemon card Pikachu");
  assert(!tokens.includes("the"));
  assert(!tokens.includes("card"));
  assert(tokens.includes("pikachu"));
});

test("lowercases", () => {
  const tokens = tokenizeQuery("CHARIZARD EX");
  assert(tokens.includes("charizard"));
  assert(tokens.includes("ex"));
});

// ── extractPokemonName ──

console.log("\n\x1b[1m=== extractPokemonName ===\x1b[0m");

test("extracts first significant token", () => {
  eq(extractPokemonName("Umbreon VMAX Alt Art"), "umbreon");
});

test("returns null for empty", () => {
  eq(extractPokemonName(""), null);
});

// ── normalizeListingLanguage ──

console.log("\n\x1b[1m=== normalizeListingLanguage ===\x1b[0m");

test("eng variants", () => {
  eq(normalizeListingLanguage("eng"), "eng");
  eq(normalizeListingLanguage("en"), "eng");
  eq(normalizeListingLanguage("english"), "eng");
});

test("jp variants", () => {
  eq(normalizeListingLanguage("jp"), "jp");
  eq(normalizeListingLanguage("japanese"), "jp");
});

test("any/null/empty", () => {
  eq(normalizeListingLanguage(null), "any");
  eq(normalizeListingLanguage(""), "any");
  eq(normalizeListingLanguage("any"), "any");
});

test("unknown returns null", () => {
  eq(normalizeListingLanguage("klingon"), null);
});

// ── parseListingLanguagesFromInput ──

console.log("\n\x1b[1m=== parseListingLanguagesFromInput ===\x1b[0m");

test("parses comma-separated", () => {
  const r = parseListingLanguagesFromInput("eng,jp");
  assert(r.includes("eng"));
  assert(r.includes("jp"));
});

test("any returns empty array", () => {
  eq(parseListingLanguagesFromInput("any").length, 0);
});

// ── filterByLanguage ──

console.log("\n\x1b[1m=== filterByLanguage ===\x1b[0m");

test("filters to English", () => {
  const items = [
    { title: "Pikachu VMAX English" },
    { title: "ピカチュウex SAR" },
  ];
  const r = filterByLanguage(items, "eng");
  eq(r.length, 1);
});

test("filters to Japanese", () => {
  const items = [
    { title: "Pikachu VMAX English card" },
    { title: "ピカチュウex SAR" },
    { title: "Umbreon ex Japanese Pokemon" },
  ];
  const r = filterByLanguage(items, "jp");
  eq(r.length, 2);
});

test("any returns all", () => {
  const items = [{ title: "a" }, { title: "b" }];
  eq(filterByLanguage(items, "any").length, 2);
});

// ── titleLooksGradedSlab ──

console.log("\n\x1b[1m=== titleLooksGradedSlab ===\x1b[0m");

test("PSA 10 detected", () => {
  assert(titleLooksGradedSlab("Pikachu VMAX PSA 10 Gem Mint"));
});

test("BGS 9.5 detected", () => {
  assert(titleLooksGradedSlab("Charizard BGS 9.5"));
});

test("CGC 9 detected", () => {
  assert(titleLooksGradedSlab("Mew ex CGC 9"));
});

test("raw title not detected", () => {
  assert(!titleLooksGradedSlab("Pikachu VMAX Alt Art Near Mint"));
});

// ── titleMatchesSlabListing ──

console.log("\n\x1b[1m=== titleMatchesSlabListing ===\x1b[0m");

test("matches PSA 10", () => {
  assert(titleMatchesSlabListing("Pikachu VMAX PSA 10 Gem Mint", "PSA", "10"));
});

test("rejects wrong provider", () => {
  assert(!titleMatchesSlabListing("Pikachu VMAX BGS 10", "PSA", "10"));
});

test("rejects wrong grade", () => {
  assert(!titleMatchesSlabListing("Pikachu PSA 9", "PSA", "10"));
});

// ── parseSellerSlabFromConditionText ──

console.log("\n\x1b[1m=== parseSellerSlabFromConditionText ===\x1b[0m");

test("parses 'Graded - PSA 10'", () => {
  const r = parseSellerSlabFromConditionText("Graded - PSA 10: Professionally graded");
  assert(r);
  eq(r.grader, "PSA");
  eq(r.grade, "10");
  eq(r.label, "PSA 10");
});

test("parses 'BGS 9.5'", () => {
  const r = parseSellerSlabFromConditionText("BGS 9.5");
  assert(r);
  eq(r.grader, "BGS");
  eq(r.grade, "9.5");
});

test("parses 'CGC 8'", () => {
  const r = parseSellerSlabFromConditionText("CGC 8");
  assert(r);
  eq(r.label, "CGC 8");
});

test("returns null for ungraded", () => {
  eq(parseSellerSlabFromConditionText("Near Mint"), null);
});

test("returns null for empty", () => {
  eq(parseSellerSlabFromConditionText(""), null);
});

// ── filterByListingFormat ──

console.log("\n\x1b[1m=== filterByListingFormat ===\x1b[0m");

test("raw removes slab titles", () => {
  const items = [
    { title: "Pikachu VMAX Near Mint" },
    { title: "Pikachu VMAX PSA 10 Gem Mint" },
    { title: "Pikachu VMAX BGS 9.5" },
  ];
  const r = filterByListingFormat(items, { listingFormat: "raw" });
  eq(r.length, 1);
  assert(r[0].title.includes("Near Mint"));
});

test("slab keeps matching slabs only", () => {
  const items = [
    { title: "Pikachu VMAX Near Mint" },
    { title: "Pikachu VMAX PSA 10 Gem Mint" },
    { title: "Pikachu VMAX BGS 9.5" },
  ];
  const r = filterByListingFormat(items, { listingFormat: "slab", slab: { provider: "PSA", grade: "10" } });
  eq(r.length, 1);
  assert(r[0].title.includes("PSA 10"));
});

// ── filterRelevantResults ──

console.log("\n\x1b[1m=== filterRelevantResults ===\x1b[0m");

test("keeps relevant titles", () => {
  const items = [
    { title: "Pikachu VMAX Alt Art 188/184" },
    { title: "Charizard Base Set Holo" },
    { title: "Pikachu VMAX Rainbow Rare" },
  ];
  const { filtered } = filterRelevantResults(items, "Pikachu VMAX");
  assert(filtered.length >= 2);
  assert(filtered.every(r => r.title.toLowerCase().includes("pikachu")));
});

test("removes blocklisted titles", () => {
  const items = [
    { title: "Pikachu VMAX Alt Art" },
    { title: "Pikachu VMAX lot bundle 10 cards" },
    { title: "Pikachu VMAX proxy custom" },
  ];
  const { filtered } = filterRelevantResults(items, "Pikachu VMAX");
  eq(filtered.length, 1);
});

// ── querySeeksJapaneseMarket ──

console.log("\n\x1b[1m=== querySeeksJapaneseMarket ===\x1b[0m");

test("detects 'japanese'", () => {
  assert(querySeeksJapaneseMarket("Umbreon ex Japanese"));
});

test("detects 'japan'", () => {
  assert(querySeeksJapaneseMarket("Pikachu japan exclusive"));
});

test("no match on English query", () => {
  assert(!querySeeksJapaneseMarket("Pikachu VMAX Alt Art"));
});

// ── filterToLikelyTcgCards ──

console.log("\n\x1b[1m=== filterToLikelyTcgCards ===\x1b[0m");

test("keeps card listings", () => {
  const items = [
    { title: "Pikachu VMAX 188/184 Pokemon card holo" },
    { title: "Pokemon Pikachu plush toy" },
  ];
  const r = filterToLikelyTcgCards(items);
  eq(r.length, 1);
  assert(r[0].title.includes("188/184"));
});

test("removes DVDs and figures", () => {
  const items = [
    { title: "Pokemon Pikachu DVD collection" },
    { title: "Pokemon scale figure Charizard" },
    { title: "Pikachu PSA 10 234/193 card" },
  ];
  const r = filterToLikelyTcgCards(items);
  eq(r.length, 1);
});

// ── Demo data integrity ──

console.log("\n\x1b[1m=== demo data ===\x1b[0m");

test("listDemoCards returns 3 cards", () => {
  const cards = listDemoCards();
  eq(cards.length, 3);
});

test("isDemoQuery matches exact keys", () => {
  assert(isDemoQuery("mega greninja ex sar"));
  assert(isDemoQuery("Umbreon ex SAR 217/187"));
  assert(isDemoQuery("Pikachu ex SAR 234/193 PSA 10"));
});

test("isDemoQuery rejects unknown", () => {
  assert(!isDemoQuery("Nonexistent Card"));
});

test("getDemoResult returns _demo flag", () => {
  const r = getDemoResult("mega greninja ex sar");
  assert(r);
  assert(r._demo);
  eq(r.source, "multi");
});

test("getDemoResult partial match works", () => {
  const r = getDemoResult("greninja");
  assert(r);
  assert(r._demo);
});

test("getDemoSearchResult filters by condition", () => {
  const r = getDemoSearchResult("Mega Greninja ex SAR", { condition: "A" });
  const items = r.activeByCountry?.US || [];
  assert(items.length >= 5, `expected at least 5 matching condition A, got ${items.length}`);
  assert(items.length < 11, `expected fewer than all 11, got ${items.length}`);
});

test("getDemoSearchResult unknown card returns _demoNote", () => {
  const r = getDemoSearchResult("Totally Fake Card");
  assert(r._demo);
  assert(r._demoNote);
  eq(r.counts.activeTotal, 0);
});

test("all demo listings have required fields", () => {
  for (const query of listDemoCards()) {
    const r = getDemoResult(query);
    assert(r.query, `missing query on ${query}`);
    assert(r.source, `missing source on ${query}`);
    assert(r.counts, `missing counts on ${query}`);
    const items = r.activeByCountry?.US || [];
    for (const item of items) {
      assert(item.itemId, `missing itemId in ${query}`);
      assert(item.title, `missing title in ${query}`);
      assert(typeof item.price === "number", `bad price in ${query}: ${item.itemId}`);
      assert(item.priceCurrency, `missing currency in ${query}: ${item.itemId}`);
    }
  }
});

test("AI graded demos have valid grade objects", () => {
  for (const key of ["mega greninja ex sar", "umbreon ex sar 217/187"]) {
    const r = getDemoResult(key);
    const items = r.activeByCountry?.US || [];
    for (const item of items) {
      if (!item.grade) continue;
      assert(item.grade.overall >= 1 && item.grade.overall <= 10, `bad overall in ${key}: ${item.itemId}`);
      assert(item.grade.centering >= 1 && item.grade.centering <= 10);
      assert(item.grade.corners >= 1 && item.grade.corners <= 10);
      assert(item.grade.edges >= 1 && item.grade.edges <= 10);
      assert(item.grade.surface >= 1 && item.grade.surface <= 10);
      assert(item.grade.confidence > 0 && item.grade.confidence <= 1);
    }
  }
});

test("slab demo has null grades + listingGradeLabel", () => {
  const r = getDemoResult("pikachu ex sar 234/193 psa 10");
  const items = r.activeByCountry?.US || [];
  const slabs = items.filter(i => i.listingGradeLabel && i.listingGradeLabel !== "Ungraded");
  assert(slabs.length >= 3, `expected at least 3 slabs, got ${slabs.length}`);
  for (const item of slabs) {
    eq(item.grade, null, `slab should have null grade: ${item.itemId}`);
  }
});

test("PSA signals have tier + reason", () => {
  for (const key of ["mega greninja ex sar", "umbreon ex sar 217/187"]) {
    const r = getDemoResult(key);
    assert(r.psaSignal, `missing psaSignal in ${key}`);
    assert(r.psaSignal.tier, `missing tier in ${key}`);
    assert(r.psaSignal.estCost, `missing estCost in ${key}`);
    assert(r.psaSignal.tierReason, `missing tierReason in ${key}`);
    assert(r.psaSignal.totalPop > 0, `bad totalPop in ${key}`);
    assert(r.psaSignal.gem10Pct > 0, `bad gem10Pct in ${key}`);
  }
});

// ── Condition detection ──

console.log("\n\x1b[1m=== detectCondition ===\x1b[0m");

test("detects Mint from SNKRDUNK", () => {
  eq(detectCondition({ condition: "A — Mint", title: "" }), "Mint");
});

test("detects NM from eBay", () => {
  eq(detectCondition({ condition: "", title: "Umbreon ex SAR NM Japanese" }), "NM");
});

test("detects condition from Japanese title", () => {
  eq(detectCondition({ condition: "", title: "〔状態A-〕メガゲッコウガex SAR" }), "NM");
});

test("detects Ungraded", () => {
  eq(detectCondition({ condition: "Ungraded", title: "" }), "Ungraded");
});

test("returns null for unknown", () => {
  eq(detectCondition({ condition: "", title: "Pokemon card" }), null);
});

// ── Condition filter ──

console.log("\n\x1b[1m=== filterByCondition ===\x1b[0m");

test("filters to NM", () => {
  const items = [
    { title: "Card NM", condition: "" },
    { title: "Card LP", condition: "" },
    { title: "Card", condition: "A — Mint" },
  ];
  const r = filterByCondition(items, "nm");
  eq(r.length, 2);
});

test("returns all if no condition", () => {
  const items = [{ title: "a" }, { title: "b" }];
  eq(filterByCondition(items, "").length, 2);
  eq(filterByCondition(items, null).length, 2);
});

// ── Price outliers ──

console.log("\n\x1b[1m=== flagPriceOutliers ===\x1b[0m");

test("flags items below 40% of median", () => {
  const items = [
    { price: 100 },
    { price: 400 },
    { price: 410 },
    { price: 420 },
    { price: 430 },
  ];
  const r = flagPriceOutliers(items);
  assert(r[0]._priceOutlier === true, "100 should be outlier");
  assert(r[1]._priceOutlier === false, "400 should not be outlier");
});

test("no outliers with less than 3 items", () => {
  const items = [{ price: 100 }, { price: 500 }];
  const r = flagPriceOutliers(items);
  assert(!r[0]._priceOutlier);
});

// ── Card identity ──

console.log("\n\x1b[1m=== parseCardIdentity ===\x1b[0m");

test("parses card with set code", () => {
  const r = parseCardIdentity("Umbreon ex SAR 217/187 sv8a");
  eq(r.cardId, "sv8a/217-187");
  eq(r.rarity, "SAR");
  assert(r.name.includes("Umbreon"));
});

test("resolves set from card number denominator", () => {
  const r = parseCardIdentity("Pikachu ex SAR 234/193 PSA 10");
  eq(r.cardId, "m2a/234-193");
  eq(r.rarity, "SAR");
});

test("resolves set from set name", () => {
  const r = parseCardIdentity("Umbreon ex Terastal Festival 217/187");
  eq(r.cardId, "sv8a/217-187");
});

test("preserves Japanese names", () => {
  const r = parseCardIdentity("ブラッキーex SAR 217/187");
  eq(r.cardId, "sv8a/217-187");
  assert(r.name.includes("ブラッキー"));
});

test("resolves SWSH era cards", () => {
  const r = parseCardIdentity("Umbreon VMAX 215/203");
  eq(r.cardId, "swsh7/215-203");
});

test("resolves Fusion Strike", () => {
  const r = parseCardIdentity("Gengar VMAX Alt Art 271/264");
  eq(r.cardId, "swsh8/271-264");
});

test("returns null cardId when no number", () => {
  const r = parseCardIdentity("Charizard ex");
  eq(r.cardId, null);
  assert(r.name.includes("Charizard"));
});

test("buildCardId formats correctly", () => {
  eq(buildCardId("sv8a", "217/187"), "sv8a/217-187");
  eq(buildCardId("m4", "114/083"), "m4/114-083");
  eq(buildCardId(null, "217/187"), null);
});

test("SET_NAME_MAP has entries for major sets", () => {
  assert(SET_NAME_MAP["sv8a"], "missing sv8a");
  assert(SET_NAME_MAP["swsh7"], "missing swsh7");
  assert(SET_NAME_MAP["m4"], "missing m4");
  assert(SET_NAME_MAP["sv2a"], "missing sv2a");
});

// ── resolveCardIdToQuery ──

console.log("\n\x1b[1m=== resolveCardIdToQuery ===\x1b[0m");

test("resolves sv8a/217-187 to Terastal Festival query", () => {
  const q = resolveCardIdToQuery("sv8a/217-187");
  assert(q.includes("217/187"), "missing card number");
  assert(q.includes("Terastal Festival"), "missing set name");
});

test("resolves m4/114-083 to Ninja Spinner query", () => {
  const q = resolveCardIdToQuery("m4/114-083");
  assert(q.includes("114/083"));
  assert(q.includes("Ninja Spinner"));
});

test("returns input for invalid card ID", () => {
  eq(resolveCardIdToQuery("not-a-card"), "not-a-card");
});

// ── findDemoByNumber ──

console.log("\n\x1b[1m=== findDemoByNumber ===\x1b[0m");

test("finds Umbreon by 217-187", () => {
  const r = findDemoByNumber("217-187");
  assert(r, "not found");
  assert(r._demo);
  assert(r.query.includes("Umbreon"));
});

test("finds Greninja by 114-083 (from listing titles)", () => {
  const r = findDemoByNumber("114-083");
  assert(r, "not found");
  assert(r.query.includes("Greninja"));
});

test("finds Pikachu by 234-193", () => {
  const r = findDemoByNumber("234-193");
  assert(r, "not found");
  assert(r.query.includes("Pikachu"));
});

test("returns null for unknown number", () => {
  eq(findDemoByNumber("999-999"), null);
});

// ── Demo data: multi-source + sold dates ──

console.log("\n\x1b[1m=== demo multi-source + sold dates ===\x1b[0m");

test("all demo cards are multi-source", () => {
  for (const query of listDemoCards()) {
    const r = getDemoResult(query);
    eq(r.source, "multi", `${query} should be multi-source`);
  }
});

test("all demo sold have soldDate spanning 7+ days", () => {
  for (const query of listDemoCards()) {
    const r = getDemoResult(query);
    const dates = (r.sold || []).map(s => s.soldDate).filter(Boolean);
    assert(dates.length >= 3, `${query}: expected 3+ sold dates, got ${dates.length}`);
    const sorted = dates.sort();
    const first = new Date(sorted[0]);
    const last = new Date(sorted[sorted.length - 1]);
    const span = (last - first) / (1000 * 60 * 60 * 24);
    assert(span >= 7, `${query}: date span ${span} days, expected 7+`);
  }
});

test("Umbreon raw listings have detectedCondition", () => {
  const r = getDemoResult("umbreon ex sar 217/187");
  const items = r.activeByCountry?.US || [];
  const raw = items.filter(i => !i.listingGradeLabel || i.listingGradeLabel === "Ungraded");
  assert(raw.length >= 5, `expected at least 5 raw listings, got ${raw.length}`);
  assert(raw.every(i => i.detectedCondition), "not all raw have detectedCondition");
});

test("condition filter with detectedCondition works", () => {
  const r = getDemoSearchResult("Mega Greninja ex SAR", { condition: "mint" });
  const items = r.activeByCountry?.US || [];
  assert(items.length >= 5, `expected at least 5 mint, got ${items.length}`);
});

// ── cornerCropsToImageBlocks ──

console.log("\n\x1b[1m=== cornerCropsToImageBlocks ===\x1b[0m");

test("converts crops to Anthropic image blocks", () => {
  const crops = [
    { name: "top-left", base64: "abc123", mediaType: "image/jpeg" },
    { name: "top-right", base64: "def456", mediaType: "image/jpeg" },
  ];
  const blocks = cornerCropsToImageBlocks(crops);
  eq(blocks.length, 2);
  eq(blocks[0].type, "image");
  eq(blocks[0].source.type, "base64");
  eq(blocks[0].source.media_type, "image/jpeg");
  eq(blocks[0].source.data, "abc123");
});

test("returns empty array for empty input", () => {
  const blocks = cornerCropsToImageBlocks([]);
  eq(blocks.length, 0);
});

// ── Demo image resolution ──

console.log("\n\x1b[1m=== demo image resolution ===\x1b[0m");

test("eBay demo images use s-l1600 resolution", () => {
  for (const query of listDemoCards()) {
    const r = getDemoResult(query);
    const items = r.activeByCountry?.US || [];
    for (const item of items) {
      if (item.imageUrl?.includes("ebayimg.com")) {
        assert(item.imageUrl.includes("s-l1600"), `${item.itemId} still uses low-res: ${item.imageUrl}`);
      }
    }
    for (const s of r.sold || []) {
      if (s.imageUrl?.includes("ebayimg.com")) {
        assert(s.imageUrl.includes("s-l1600"), `sold ${s.itemId} still uses low-res`);
      }
    }
  }
});

test("no s-l500 URLs remain in demo data", () => {
  for (const query of listDemoCards()) {
    const r = getDemoResult(query);
    const json = JSON.stringify(r);
    assert(!json.includes("s-l500"), `${query} still has s-l500 URLs`);
  }
});

// ── Demo grade confidence (conservative with new prompts) ──

console.log("\n\x1b[1m=== demo grade confidence ===\x1b[0m");

test("graded demo listings have conservative confidence", () => {
  for (const key of ["mega greninja ex sar", "umbreon ex sar 217/187"]) {
    const r = getDemoResult(key);
    const items = (r.activeByCountry?.US || []).filter(i => i.grade);
    for (const item of items) {
      assert(item.grade.confidence <= 0.7, `${item.itemId} confidence ${item.grade.confidence} too high for listing photos`);
    }
  }
});

test("graded demos have descriptive detail text", () => {
  for (const key of ["mega greninja ex sar", "umbreon ex sar 217/187"]) {
    const r = getDemoResult(key);
    const items = (r.activeByCountry?.US || []).filter(i => i.grade);
    for (const item of items) {
      const details = item.grade.subgradeDetails;
      assert(details.centering.detail.length > 30, `${item.itemId} centering detail too short`);
      assert(details.corners.detail.length > 30, `${item.itemId} corners detail too short`);
      assert(details.edges.detail.length > 30, `${item.itemId} edges detail too short`);
      assert(details.surface.detail.length > 30, `${item.itemId} surface detail too short`);
    }
  }
});

// ── Alert email ──

console.log("\n\x1b[1m=== alert email ===\x1b[0m");

test("buildAlertEmailSubject returns price subject", () => {
  const alert = { type: "price", query: "Umbreon ex SAR 217/187" };
  const triggerData = { currentPrice: 350 };
  const subject = buildAlertEmailSubject(alert, triggerData);
  eq(subject, "Price alert: Umbreon ex SAR 217/187 below $350");
});

test("buildAlertEmailSubject returns arbitrage subject", () => {
  const alert = { type: "arbitrage", query: "Pikachu ex SAR" };
  const triggerData = { spreadPct: 15 };
  const subject = buildAlertEmailSubject(alert, triggerData);
  eq(subject, "Arbitrage alert: Pikachu ex SAR spread 15%");
});

test("sendAlertEmail returns skipped when no API key", async () => {
  const origKey = process.env.RESEND_API_KEY;
  delete process.env.RESEND_API_KEY;
  try {
    const result = await sendAlertEmail(
      { type: "price", email: "test@example.com", query: "Test Card" },
      { currentPrice: 100 }
    );
    assert(result.skipped === true, "should have skipped");
    eq(result.reason, "no_api_key");
  } finally {
    if (origKey) process.env.RESEND_API_KEY = origKey;
  }
});

// ── Portfolio ──

console.log("\n\x1b[1m=== portfolio ===\x1b[0m");

test("cardId escaping replaces / with _", () => {
  eq("sv8a/217-187".replace(/\//g, "_"), "sv8a_217-187");
  eq("m4/114-083".replace(/\//g, "_"), "m4_114-083");
  eq("m2a/234-193".replace(/\//g, "_"), "m2a_234-193");
});

test("ROI calculation: positive gain", () => {
  const purchase = 370;
  const current = 400;
  const roi = Math.round(((current - purchase) / purchase) * 10000) / 100;
  eq(roi, 8.11);
});

test("ROI calculation: negative loss", () => {
  const purchase = 400;
  const current = 370;
  const roi = Math.round(((current - purchase) / purchase) * 10000) / 100;
  eq(roi, -7.5);
});

test("ROI calculation: zero purchase returns 0", () => {
  const purchase = 0;
  const current = 400;
  const roi = purchase > 0 ? Math.round(((current - purchase) / purchase) * 10000) / 100 : 0;
  eq(roi, 0);
});

test("demo portfolio has 3 cards with valid fields", () => {
  const DEMO_PORTFOLIO = [
    { cardId: "sv8a/217-187", query: "Umbreon ex SAR 217/187", purchasePrice: 370, purchaseSource: "ebay", quantity: 1 },
    { cardId: "m4/114-083", query: "Mega Greninja ex SAR", purchasePrice: 310, purchaseSource: "snkrdunk", quantity: 1 },
    { cardId: "m2a/234-193", query: "Pikachu ex SAR 234/193 PSA 10", purchasePrice: 720, purchaseSource: "magi", quantity: 1 },
  ];
  eq(DEMO_PORTFOLIO.length, 3);
  for (const card of DEMO_PORTFOLIO) {
    assert(card.cardId, "missing cardId");
    assert(card.query, "missing query");
    assert(typeof card.purchasePrice === "number", "purchasePrice must be number");
    assert(card.purchasePrice > 0, "purchasePrice must be positive");
    assert(card.purchaseSource, "missing purchaseSource");
    assert(card.quantity >= 1, "quantity must be >= 1");
    assert(/^[a-z0-9.]+\/[\d]+-[\d]+$/i.test(card.cardId), `invalid cardId format: ${card.cardId}`);
  }
});

test("portfolio stats calculation", () => {
  const cards = [
    { purchasePrice: 370, currentPrice: 400, quantity: 1 },
    { purchasePrice: 310, currentPrice: 384, quantity: 1 },
    { purchasePrice: 720, currentPrice: 741, quantity: 1 },
  ];
  const totalCost = cards.reduce((s, c) => s + c.purchasePrice * c.quantity, 0);
  const totalValue = cards.reduce((s, c) => s + c.currentPrice * c.quantity, 0);
  eq(totalCost, 1400);
  eq(totalValue, 1525);
  const totalROI = totalValue - totalCost;
  eq(totalROI, 125);
  const roiPercent = Math.round((totalROI / totalCost) * 10000) / 100;
  eq(roiPercent, 8.93);
});

test("portfolio stats with quantity > 1", () => {
  const cards = [
    { purchasePrice: 100, currentPrice: 120, quantity: 3 },
  ];
  const totalCost = cards.reduce((s, c) => s + c.purchasePrice * c.quantity, 0);
  const totalValue = cards.reduce((s, c) => s + c.currentPrice * c.quantity, 0);
  eq(totalCost, 300);
  eq(totalValue, 360);
});

// ── Portfolio history + gainers/losers ──

console.log("\n\x1b[1m=== portfolio history + gainers/losers ===\x1b[0m");

test("demo portfolio history generates correct number of days", () => {
  function getDemoPortfolioHistory(days) {
    const history = [];
    let totalValue = 1525;
    const totalCost = 1400;
    for (let i = 0; i < days; i++) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const date = d.toISOString().split("T")[0];
      const modifier = 1 - ((i * 37 + 13) % 100) / 100 * 0.002 - 0.003;
      history.unshift({ date, totalValue: Math.round(totalValue * 100) / 100, totalCost });
      totalValue = totalValue * modifier;
    }
    return history;
  }
  eq(getDemoPortfolioHistory(30).length, 30);
  eq(getDemoPortfolioHistory(7).length, 7);
  eq(getDemoPortfolioHistory(1).length, 1);
});

test("demo portfolio history totalCost stays constant", () => {
  function getDemoPortfolioHistory(days) {
    const history = [];
    let totalValue = 1525;
    const totalCost = 1400;
    for (let i = 0; i < days; i++) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const date = d.toISOString().split("T")[0];
      const modifier = 1 - ((i * 37 + 13) % 100) / 100 * 0.002 - 0.003;
      history.unshift({ date, totalValue: Math.round(totalValue * 100) / 100, totalCost });
      totalValue = totalValue * modifier;
    }
    return history;
  }
  const history = getDemoPortfolioHistory(30);
  assert(history.every(h => h.totalCost === 1400), "totalCost should stay at 1400");
});

test("demo gainers/losers has correct order", () => {
  const demo = {
    gainers: [
      { cardId: "m4/114-083", query: "Mega Greninja ex SAR", currentPrice: 384, priceNDaysAgo: 298.46, changePercent: 28.65, changeDollars: 85.54 },
      { cardId: "sv8a/217-187", query: "Umbreon ex SAR 217/187", currentPrice: 400, priceNDaysAgo: 385, changePercent: 3.90, changeDollars: 15 },
    ],
    losers: [
      { cardId: "m2a/234-193", query: "Pikachu ex SAR 234/193 PSA 10", currentPrice: 741, priceNDaysAgo: 748, changePercent: -0.94, changeDollars: -7 },
    ],
  };
  eq(demo.gainers[0].cardId, "m4/114-083");
  assert(demo.gainers[0].changePercent > demo.gainers[1].changePercent, "Greninja should be first gainer");
  eq(demo.losers[0].cardId, "m2a/234-193");
  assert(demo.losers[0].changePercent < 0, "Pikachu should be a loser");
});

// ── CSV export ──

console.log("\n\x1b[1m=== csvEscape + csvRow ===\x1b[0m");

test("csvEscape handles commas", () => {
  eq(csvEscape("hello, world"), '"hello, world"');
});

test("csvEscape handles double quotes", () => {
  eq(csvEscape('say "hi"'), '"say ""hi"""');
});

test("csvEscape handles null/undefined", () => {
  eq(csvEscape(null), "");
  eq(csvEscape(undefined), "");
});

test("csvRow joins fields", () => {
  eq(csvRow(["a", "b", "c"]), "a,b,c");
});

// ── isGradedCard ──

console.log("\n\x1b[1m=== isGradedCard ===\x1b[0m");

test("isGradedCard detects PSA 10", () => {
  assert(isGradedCard("Pikachu ex SAR 234/193 PSA 10"));
});

test("isGradedCard detects BGS 9.5", () => {
  assert(isGradedCard("Umbreon ex BGS 9.5"));
});

test("isGradedCard rejects raw card query", () => {
  assert(!isGradedCard("Umbreon ex SAR 217/187"));
});

// ── Card database / autocomplete ──

console.log("\n\x1b[1m=== card database ===\x1b[0m");

test("matchesQuery: prefix match scores 3", () => {
  const card = { id: "SV8a-217", name: "Umbreon ex", nameJa: "ブラッキーex", localId: "217", setCode: "SV8a" };
  eq(matchesQuery(card, "umbr"), 3);
});

test("matchesQuery: contains match scores 2", () => {
  const card = { id: "SV8a-217", name: "Umbreon ex", nameJa: "ブラッキーex", localId: "217", setCode: "SV8a" };
  eq(matchesQuery(card, "breon"), 2);
});

test("matchesQuery: JP name prefix scores 3", () => {
  const card = { id: "SV8a-217", name: "Umbreon ex", nameJa: "ブラッキーex", localId: "217", setCode: "SV8a" };
  eq(matchesQuery(card, "ブラッキー"), 3);
});

test("matchesQuery: localId prefix scores 1", () => {
  const card = { id: "SV8a-217", name: "Umbreon ex", nameJa: "ブラッキーex", localId: "217", setCode: "SV8a" };
  eq(matchesQuery(card, "217"), 1);
});

test("matchesQuery: id contains scores 1", () => {
  const card = { id: "SV8a-217", name: "Umbreon ex", nameJa: null, localId: "217", setCode: "SV8a" };
  eq(matchesQuery(card, "sv8a-217"), 1);
});

test("matchesQuery: no match returns 0", () => {
  const card = { id: "SV8a-217", name: "Umbreon ex", nameJa: "ブラッキーex", localId: "217", setCode: "SV8a" };
  eq(matchesQuery(card, "charizard"), 0);
});

test("matchesQuery: empty query returns 0", () => {
  const card = { id: "SV8a-217", name: "Umbreon ex", nameJa: null, localId: "217", setCode: "SV8a" };
  eq(matchesQuery(card, ""), 0);
});

test("matchesQuery: query under 2 chars returns 0", () => {
  const card = { id: "SV8a-217", name: "Umbreon ex", nameJa: null, localId: "217", setCode: "SV8a" };
  eq(matchesQuery(card, "u"), 0);
});

test("searchCards: empty query returns empty", () => {
  eq(searchCards("", 8).length, 0);
});

test("searchCards: query under 2 chars returns empty", () => {
  eq(searchCards("a", 8).length, 0);
});

test("getAllSets: returns empty array when no cards loaded", () => {
  const sets = getAllSets();
  eq(Array.isArray(sets), true);
});

test("getSetWithCards: returns null for nonexistent set", () => {
  eq(getSetWithCards("zzz999"), null);
});

// ── Price trend ──

console.log("\n\x1b[1m=== price trend ===\x1b[0m");

const now = new Date("2026-05-10T12:00:00Z");
function daysAgo(n) { return new Date(now.getTime() - n * 86400000).toISOString(); }
function mkHistory(points) { return points.map(([daysBack, price, source]) => ({ price, recordedAt: daysAgo(daysBack), source: source || "ebay" })); }

test("computePriceTrend: returns null for empty history", () => {
  eq(computePriceTrend([]), null);
});

test("computePriceTrend: returns null for < 3 data points", () => {
  eq(computePriceTrend(mkHistory([[1, 100], [5, 95]]), now), null);
});

test("computePriceTrend: returns null when all dates are the same", () => {
  const same = [{ price: 100, recordedAt: daysAgo(1), source: "ebay" }, { price: 105, recordedAt: daysAgo(1), source: "ebay" }, { price: 110, recordedAt: daysAgo(1), source: "magi" }];
  eq(computePriceTrend(same, now), null);
});

test("computePriceTrend: detects rising trend", () => {
  const h = mkHistory([[1, 400], [2, 395], [3, 390], [10, 350], [20, 340], [30, 330]]);
  const t = computePriceTrend(h, now);
  eq(t.direction, "rising");
  eq(t.signal, "wait");
  eq(t.change7d.percent > 0, true);
});

test("computePriceTrend: detects falling trend", () => {
  const h = mkHistory([[1, 330], [2, 335], [3, 340], [10, 390], [20, 400], [30, 410]]);
  const t = computePriceTrend(h, now);
  eq(t.direction, "falling");
  eq(t.signal, "good_buy");
});

test("computePriceTrend: detects stable trend", () => {
  const h = mkHistory([[1, 400], [2, 398], [3, 402], [10, 399], [20, 401], [30, 400]]);
  const t = computePriceTrend(h, now);
  eq(t.direction, "stable");
  eq(t.signal, "fair");
});

test("computePriceTrend: per-source breakdown", () => {
  const h = mkHistory([[1, 400, "ebay"], [2, 395, "ebay"], [10, 380, "ebay"], [1, 350, "magi"], [2, 355, "magi"], [10, 370, "magi"]]);
  const t = computePriceTrend(h, now);
  eq("ebay" in t.bySource, true);
  eq("magi" in t.bySource, true);
});

test("computePriceTrend: summary contains direction", () => {
  const h = mkHistory([[1, 400], [2, 395], [3, 390], [10, 350], [20, 340], [30, 330]]);
  const t = computePriceTrend(h, now);
  eq(t.summary.includes("Up"), true);
});

test("computePriceTrend: bestSource tracks source with most negative 7d change", () => {
  const h = mkHistory([[1, 380, "ebay"], [2, 385, "ebay"], [5, 370, "ebay"], [1, 300, "magi"], [2, 305, "magi"], [5, 360, "magi"]]);
  const t = computePriceTrend(h, now);
  eq(typeof t.bestSource, "string");
  eq(t.bySource[t.bestSource].change7d.percent < 0, true);
});

test("computePriceTrend: handles all data older than 7 days", () => {
  const h = mkHistory([[0.5, 400], [1, 398], [1.5, 402], [10, 350], [20, 340]]);
  const t = computePriceTrend(h, now);
  eq(t !== null, true);
  eq(t.change30d !== null, true);
  eq(typeof t.direction, "string");
});

// ── JWT auth ──

console.log("\n\x1b[1m=== JWT auth ===\x1b[0m");

{
  process.env.CASECOMP_JWT_SECRET = "test-secret-key-for-unit-tests-only";
  const { generateJwt, verifyJwt } = await import("../lib/auth/auth.js");

  test("generateJwt: returns 3-part token", () => {
    const jwt = generateJwt({ sub: "123", email: "test@test.com" });
    eq(jwt.split(".").length, 3);
  });

  test("verifyJwt: validates a generated token", () => {
    const jwt = generateJwt({ sub: "456", email: "a@b.com" });
    const payload = verifyJwt(jwt);
    eq(payload.sub, "456");
    eq(payload.email, "a@b.com");
  });

  test("verifyJwt: returns null for tampered token", () => {
    const jwt = generateJwt({ sub: "789", email: "x@y.com" });
    const tampered = jwt.slice(0, -3) + "xxx";
    eq(verifyJwt(tampered), null);
  });

  test("verifyJwt: returns null for expired token", () => {
    const jwt = generateJwt({ sub: "exp", email: "e@e.com" });
    const [h, p, s] = jwt.split(".");
    const data = JSON.parse(Buffer.from(p, "base64url").toString());
    data.exp = 1;
    const newP = Buffer.from(JSON.stringify(data)).toString("base64url");
    eq(verifyJwt(`${h}.${newP}.${s}`), null);
  });

  test("verifyJwt: returns null for empty string", () => {
    eq(verifyJwt(""), null);
  });

  test("verifyJwt: returns null for non-JWT string", () => {
    eq(verifyJwt("not-a-jwt"), null);
  });

  test("verifyJwt: returns null for null input", () => {
    eq(verifyJwt(null), null);
  });
}

// ── findCardByCardId ──

console.log("\n\x1b[1m=== findCardByCardId ===\x1b[0m");

test("findCardByCardId: returns null for null input", () => {
  eq(findCardByCardId(null), null);
});

test("findCardByCardId: returns null for empty string", () => {
  eq(findCardByCardId(""), null);
});

test("findCardByCardId: returns null for invalid format (no slash)", () => {
  eq(findCardByCardId("sv8a-217-187"), null);
});

test("findCardByCardId: returns null for missing number part", () => {
  eq(findCardByCardId("sv8a/"), null);
});

// ── roundGrade (v3 grading formula) ──

console.log("\n\x1b[1m=== roundGrade ===\x1b[0m");

test("roundGrade: 8.0 stays 8", () => {
  eq(roundGrade(8.0), 8);
});

test("roundGrade: 8.1 rounds down to 8", () => {
  eq(roundGrade(8.1), 8);
});

test("roundGrade: 8.24 rounds down to 8", () => {
  eq(roundGrade(8.24), 8);
});

test("roundGrade: 8.25 rounds to 8.5", () => {
  eq(roundGrade(8.25), 8.5);
});

test("roundGrade: 8.5 stays 8.5", () => {
  eq(roundGrade(8.5), 8.5);
});

test("roundGrade: 8.74 rounds to 8.5", () => {
  eq(roundGrade(8.74), 8.5);
});

test("roundGrade: 8.75 rounds up to 9", () => {
  eq(roundGrade(8.75), 9);
});

test("roundGrade: 8.99 rounds up to 9", () => {
  eq(roundGrade(8.99), 9);
});

test("roundGrade: 10.0 stays 10", () => {
  eq(roundGrade(10.0), 10);
});

test("roundGrade: v3 overall formula — front 9 avg, back 7 avg, 60/40 weighting", () => {
  const frontOverall = (9 + 9 + 9 + 9) / 4;
  const backOverall = (7 + 7 + 7 + 7) / 4;
  const raw = (frontOverall * 0.60) + (backOverall * 0.40);
  eq(raw, 8.2);
  eq(roundGrade(raw), 8);
});

test("roundGrade: v3 excessive defect cap — raw 8.6 but lowest is 6, capped at 7", () => {
  const raw = 8.6;
  const lowestSubgrade = 6;
  const capped = Math.min(raw, lowestSubgrade + 1);
  eq(roundGrade(capped), 7);
});

test("roundGrade: v3 cap doesn't apply when no single subgrade drags", () => {
  const raw = 8.5;
  const lowestSubgrade = 8;
  const capped = Math.min(raw, lowestSubgrade + 1);
  eq(roundGrade(capped), 8.5);
});

// ── imageBlockFromUrl / imageBlockFromBase64 ──

console.log("\n\x1b[1m=== image block helpers ===\x1b[0m");

test("imageBlockFromUrl: correct structure", () => {
  const block = imageBlockFromUrl("https://example.com/card.jpg");
  eq(block.type, "image");
  eq(block.source.type, "url");
  eq(block.source.url, "https://example.com/card.jpg");
});

test("imageBlockFromBase64: correct structure with default mediaType", () => {
  const block = imageBlockFromBase64("abc123");
  eq(block.type, "image");
  eq(block.source.type, "base64");
  eq(block.source.media_type, "image/jpeg");
  eq(block.source.data, "abc123");
});

test("imageBlockFromBase64: custom mediaType", () => {
  const block = imageBlockFromBase64("abc123", "image/png");
  eq(block.source.media_type, "image/png");
});

// ── SUBGRADE_PROMPTS keys ──

console.log("\n\x1b[1m=== subgrade prompt keys ===\x1b[0m");

test("parseGradeJSON: v3 response shape with front/back subgrades", () => {
  const json = JSON.stringify({
    score: 8, confidence: 0.85, detail: "Minor whitening on bottom-left corner"
  });
  const r = parseGradeJSON(json);
  assert(!r.error, `unexpected error: ${r.error}`);
  eq(r.ok.score, 8);
  eq(r.ok.confidence, 0.85);
  assert(r.ok.detail.includes("whitening"), "detail should mention whitening");
});

test("roundGrade: v3 full pipeline simulation — mixed front/back scores", () => {
  const front = { centering: 9, corners: 8, edges: 9, surface: 8 };
  const back = { centering: 7, corners: 6, edges: 7, surface: 7 };
  const frontAvg = (front.centering + front.corners + front.edges + front.surface) / 4;
  const backAvg = (back.centering + back.corners + back.edges + back.surface) / 4;
  eq(frontAvg, 8.5);
  eq(backAvg, 6.75);
  const raw = (frontAvg * 0.60) + (backAvg * 0.40);
  eq(raw, 7.8);
  const lowest = Math.min(front.centering, front.corners, front.edges, front.surface,
    back.centering, back.corners, back.edges, back.surface);
  eq(lowest, 6);
  const capped = Math.min(raw, lowest + 1);
  eq(capped, 7);
  eq(roundGrade(capped), 7);
});

test("roundGrade: v3 front-only mode — back copies front scores", () => {
  const front = { centering: 9, corners: 9, edges: 8, surface: 9 };
  const frontAvg = (front.centering + front.corners + front.edges + front.surface) / 4;
  const backAvg = frontAvg;
  const raw = (frontAvg * 0.60) + (backAvg * 0.40);
  eq(raw, frontAvg);
  eq(roundGrade(raw), 9);
});

// ── computePriceTrend edge cases ──

console.log("\n\x1b[1m=== computePriceTrend edge cases ===\x1b[0m");

test("computePriceTrend: single source falling", () => {
  const now = new Date();
  const history = [
    { recordedAt: new Date(now - 25 * 86400000).toISOString(), price: 100, source: "ebay" },
    { recordedAt: new Date(now - 15 * 86400000).toISOString(), price: 90, source: "ebay" },
    { recordedAt: new Date(now - 5 * 86400000).toISOString(), price: 70, source: "ebay" },
    { recordedAt: new Date(now - 2 * 86400000).toISOString(), price: 65, source: "ebay" },
    { recordedAt: new Date(now - 1 * 86400000).toISOString(), price: 60, source: "ebay" },
  ];
  const trend = computePriceTrend(history, now);
  assert(trend !== null, "trend should not be null for 5 entries");
  eq(trend.direction, "falling");
  assert(trend.bySource.ebay, "should have ebay source");
});

test("computePriceTrend: stable prices within 5%", () => {
  const now = new Date();
  const history = [
    { recordedAt: new Date(now - 25 * 86400000).toISOString(), price: 100, source: "ebay" },
    { recordedAt: new Date(now - 15 * 86400000).toISOString(), price: 101, source: "ebay" },
    { recordedAt: new Date(now - 5 * 86400000).toISOString(), price: 100, source: "magi" },
    { recordedAt: new Date(now - 1 * 86400000).toISOString(), price: 99, source: "magi" },
  ];
  const trend = computePriceTrend(history, now);
  assert(trend !== null, "trend should not be null");
  eq(trend.direction, "stable");
});

test("computePriceTrend: rising prices give wait signal", () => {
  const now = new Date();
  const history = [
    { recordedAt: new Date(now - 25 * 86400000).toISOString(), price: 50, source: "ebay" },
    { recordedAt: new Date(now - 15 * 86400000).toISOString(), price: 60, source: "ebay" },
    { recordedAt: new Date(now - 5 * 86400000).toISOString(), price: 80, source: "ebay" },
    { recordedAt: new Date(now - 2 * 86400000).toISOString(), price: 85, source: "ebay" },
    { recordedAt: new Date(now - 1 * 86400000).toISOString(), price: 90, source: "ebay" },
  ];
  const trend = computePriceTrend(history, now);
  assert(trend !== null, "trend should not be null");
  eq(trend.direction, "rising");
  eq(trend.signal, "wait");
});

// ── API response parsing (mock payloads) ──

console.log("\n\x1b[1m=== API response parsing ===\x1b[0m");

test("parseAnthropicResponse: extracts text and tokens from valid response", () => {
  const data = {
    content: [{ type: "text", text: '{"x": 100, "y": 50, "width": 400, "height": 560}' }],
    usage: { input_tokens: 1800, output_tokens: 42 },
  };
  const r = parseAnthropicResponse(data);
  eq(r.text, '{"x": 100, "y": 50, "width": 400, "height": 560}');
  eq(r.tokens.input, 1800);
  eq(r.tokens.output, 42);
});

test("parseAnthropicResponse: handles missing content gracefully", () => {
  const r = parseAnthropicResponse({});
  eq(r.text, "");
  eq(r.tokens.input, 0);
  eq(r.tokens.output, 0);
});

test("parseAnthropicResponse: handles null data", () => {
  const r = parseAnthropicResponse(null);
  eq(r.text, "");
  eq(r.tokens.input, 0);
  eq(r.tokens.output, 0);
});

test("parseAnthropicResponse: filters non-text content blocks", () => {
  const data = {
    content: [
      { type: "image", source: {} },
      { type: "text", text: '{"fills_frame": true}' },
    ],
    usage: { input_tokens: 500, output_tokens: 10 },
  };
  const r = parseAnthropicResponse(data);
  eq(r.text, '{"fills_frame": true}');
});

test("parseTogetherResponse: extracts text and tokens from OpenAI format", () => {
  const data = {
    choices: [{ message: { content: '{"x": 120, "y": 80, "width": 400, "height": 560}' } }],
    usage: { prompt_tokens: 2000, completion_tokens: 35 },
  };
  const r = parseTogetherResponse(data);
  eq(r.text, '{"x": 120, "y": 80, "width": 400, "height": 560}');
  eq(r.tokens.input, 2000);
  eq(r.tokens.output, 35);
});

test("parseTogetherResponse: handles empty choices", () => {
  const r = parseTogetherResponse({ choices: [] });
  eq(r.text, "");
  eq(r.tokens.input, 0);
  eq(r.tokens.output, 0);
});

test("parseTogetherResponse: handles null data", () => {
  const r = parseTogetherResponse(null);
  eq(r.text, "");
  eq(r.tokens.input, 0);
  eq(r.tokens.output, 0);
});

test("parseTogetherResponse: fills_frame response", () => {
  const data = {
    choices: [{ message: { content: '{"fills_frame": true}' } }],
    usage: { prompt_tokens: 1500, completion_tokens: 8 },
  };
  const r = parseTogetherResponse(data);
  const parsed = JSON.parse(r.text);
  eq(parsed.fills_frame, true);
});

test("both parsers: same JSON output parsed identically", () => {
  const json = '{"x": 100, "y": 50, "width": 400, "height": 560}';
  const anthropic = parseAnthropicResponse({ content: [{ type: "text", text: json }], usage: {} });
  const together = parseTogetherResponse({ choices: [{ message: { content: json } }], usage: {} });
  eq(anthropic.text, together.text);
  eq(JSON.parse(anthropic.text).x, JSON.parse(together.text).x);
});

// ── card detection bounds parsing ──

console.log("\n\x1b[1m=== card detection bounds ===\x1b[0m");

test("bounds parsing: fills_frame skips crop", () => {
  const bounds = { fills_frame: true };
  eq(bounds.fills_frame, true);
});

test("bounds parsing: valid bounding box", () => {
  const bounds = { x: 120, y: 80, width: 400, height: 560 };
  const imgW = 800, imgH = 1000;
  const bx = Math.max(0, Math.round(bounds.x));
  const by = Math.max(0, Math.round(bounds.y));
  const bw = Math.min(Math.round(bounds.width), imgW - bx);
  const bh = Math.min(Math.round(bounds.height), imgH - by);
  eq(bx, 120);
  eq(by, 80);
  eq(bw, 400);
  eq(bh, 560);
  const ratio = (bw * bh) / (imgW * imgH);
  assert(ratio < 0.80, `area ratio ${ratio} should be below threshold`);
});

test("bounds parsing: card fills >80% skips crop", () => {
  const bounds = { x: 10, y: 10, width: 780, height: 980 };
  const imgW = 800, imgH = 1000;
  const bw = Math.min(bounds.width, imgW - bounds.x);
  const bh = Math.min(bounds.height, imgH - bounds.y);
  const ratio = (bw * bh) / (imgW * imgH);
  assert(ratio >= 0.80, `area ratio ${ratio} should exceed threshold`);
});

test("bounds parsing: too-small detection rejected", () => {
  const bounds = { x: 0, y: 0, width: 50, height: 50 };
  assert(bounds.width < 100 || bounds.height < 100, "should reject small detections");
});

test("bounds parsing: clamps to image dimensions", () => {
  const bounds = { x: 700, y: 900, width: 500, height: 500 };
  const imgW = 800, imgH = 1000;
  const bw = Math.min(Math.round(bounds.width), imgW - bounds.x);
  const bh = Math.min(Math.round(bounds.height), imgH - bounds.y);
  eq(bw, 100);
  eq(bh, 100);
});

test("bounds parsing: negative coords clamped to 0", () => {
  const bx = Math.max(0, Math.round(-50));
  eq(bx, 0);
});

// ── v3 overall formula edge cases ──

console.log("\n\x1b[1m=== v3 formula edge cases ===\x1b[0m");

test("v3 formula: all 10s gives 10", () => {
  const frontAvg = 10, backAvg = 10;
  const raw = (frontAvg * 0.60) + (backAvg * 0.40);
  eq(roundGrade(Math.min(raw, 10 + 1)), 10);
});

test("v3 formula: one axis at 5 caps overall at 6", () => {
  const frontAvg = (10 + 10 + 10 + 10) / 4;
  const backAvg = (5 + 10 + 10 + 10) / 4;
  const raw = (frontAvg * 0.60) + (backAvg * 0.40);
  const lowestSubgrade = 5;
  const capped = Math.min(raw, lowestSubgrade + 1);
  eq(capped, 6);
  eq(roundGrade(capped), 6);
});

test("v3 formula: symmetric front/back gives same as single-side", () => {
  const avg = 8.5;
  const raw = (avg * 0.60) + (avg * 0.40);
  eq(raw, avg);
});

// ── validateAndShape (mock grade responses) ──

console.log("\n\x1b[1m=== validateAndShape ===\x1b[0m");

test("validateAndShape: valid grade object", () => {
  const r = validateAndShape("claude", "llm", {
    overall: 8.5, centering: 9, corners: 8, edges: 8, surface: 9,
    confidence: 0.85, notes: "Good card", limitations: "",
  }, {});
  eq(r.provider, "claude");
  eq(r.overall, 8.5);
  eq(r.centering, 9);
  eq(r.confidence, 0.85);
  eq(r.notes, "Good card");
  assert(!r.error, "should not have error");
});

test("validateAndShape: clamps scores above 10", () => {
  const r = validateAndShape("claude", "llm", {
    overall: 12, centering: 11, corners: 10, edges: 10, surface: 10,
    confidence: 1.5,
  }, {});
  eq(r.overall, 10);
  eq(r.centering, 10);
  eq(r.confidence, 1);
});

test("validateAndShape: clamps scores below 1", () => {
  const r = validateAndShape("claude", "llm", {
    overall: 0, centering: -1, corners: 1, edges: 1, surface: 1,
    confidence: -0.5,
  }, {});
  eq(r.overall, 1);
  eq(r.centering, 1);
  eq(r.confidence, 0);
});

test("validateAndShape: returns error for missing fields", () => {
  const r = validateAndShape("claude", "llm", { overall: 8 }, {});
  assert(r.error, "should return error for missing subgrades");
});

test("validateAndShape: null overall clamps to 1", () => {
  const r = validateAndShape("claude", "llm", {
    overall: null, centering: 8, corners: 8, edges: 8, surface: 8,
  }, {});
  eq(r.overall, 1);
  assert(!r.error, "should not error — null clamps to 1");
});

test("validateAndShape: non-string notes defaults to empty", () => {
  const r = validateAndShape("claude", "llm", {
    overall: 8, centering: 8, corners: 8, edges: 8, surface: 8,
    notes: 123, limitations: null,
  }, {});
  eq(r.notes, "");
  eq(r.limitations, "");
});

// ── buildSignal (mock PSA pop data) ──

console.log("\n\x1b[1m=== buildSignal ===\x1b[0m");

test("buildSignal: normal pop data — 5% gem rate = Moderate", () => {
  const s = buildSignal({ pop10: 50, pop9: 200, popTotal: 1000 });
  eq(s.psa10Chance, 5);
  eq(s.psa10Count, 50);
  eq(s.psa9Count, 200);
  eq(s.psa9to10Ratio, 4);
  eq(s.psaPopulation, 1000);
  eq(s.difficulty, "Moderate");
});

test("buildSignal: zero pop total — no division by zero", () => {
  const s = buildSignal({ pop10: 0, pop9: 0, popTotal: 0 });
  eq(s.psa10Chance, null);
  eq(s.psa9to10Ratio, null);
});

test("buildSignal: null pop10", () => {
  const s = buildSignal({ pop10: null, pop9: 100, popTotal: 500 });
  eq(s.psa10Chance, null);
  eq(s.psa10Count, null);
});

test("buildSignal: pop10 is 0 with nonzero total = Brutal", () => {
  const s = buildSignal({ pop10: 0, pop9: 300, popTotal: 1000 });
  eq(s.psa10Chance, 0);
  eq(s.psa9to10Ratio, null);
  eq(s.difficulty, "Brutal");
});

test("buildSignal: high gem rate = Easy", () => {
  const s = buildSignal({ pop10: 800, pop9: 100, popTotal: 1000 });
  eq(s.psa10Chance, 80);
  eq(s.difficulty, "Easy");
});

// ── deriveEra (set classification) ──

console.log("\n\x1b[1m=== deriveEra ===\x1b[0m");

test("deriveEra: sv prefix = Scarlet & Violet", () => {
  eq(deriveEra("sv8a"), "Scarlet & Violet");
  eq(deriveEra("sv1"), "Scarlet & Violet");
});

test("deriveEra: m prefix = Scarlet & Violet", () => {
  eq(deriveEra("m2a"), "Scarlet & Violet");
  eq(deriveEra("m4"), "Scarlet & Violet");
});

test("deriveEra: swsh prefix = Sword & Shield", () => {
  eq(deriveEra("swsh1"), "Sword & Shield");
  eq(deriveEra("swsh12pt5"), "Sword & Shield");
});

test("deriveEra: s prefix (JP) = Sword & Shield", () => {
  eq(deriveEra("s1"), "Sword & Shield");
  eq(deriveEra("s8a"), "Sword & Shield");
});

test("deriveEra: sm prefix = Sun & Moon", () => {
  eq(deriveEra("sm1"), "Sun & Moon");
  eq(deriveEra("sm115"), "Sun & Moon");
});

test("deriveEra: xy prefix = XY", () => {
  eq(deriveEra("xy1"), "XY");
});

test("deriveEra: a prefix = Pocket", () => {
  eq(deriveEra("a1"), "Pokemon TCG Pocket");
  eq(deriveEra("a2"), "Pokemon TCG Pocket");
});

test("deriveEra: classic sets", () => {
  eq(deriveEra("base1"), "Classic");
  eq(deriveEra("gym1"), "Classic");
  eq(deriveEra("neo1"), "Classic");
});

test("deriveEra: dp prefix = Diamond & Pearl", () => {
  eq(deriveEra("dp1"), "Diamond & Pearl");
});

test("deriveEra: bw prefix = Black & White", () => {
  eq(deriveEra("bw1"), "Black & White");
});

test("deriveEra: unknown prefix = Other", () => {
  eq(deriveEra("zzz999"), "Other");
});

// ── Summary ──

console.log(`\n\x1b[1m=== ${passed} passed, ${failed} failed ===\x1b[0m\n`);
process.exit(failed > 0 ? 1 : 0);
