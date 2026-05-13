import { parseGradeJSON } from "../lib/grading/grading.js";
import { cornerCropsToImageBlocks } from "../lib/grading/preprocessing.js";
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
import { isDemoQuery, getDemoResult, getDemoSearchResult, listDemoCards, findDemoByNumber } from "../lib/data/demo.js";
import { parseCardIdentity, buildCardId, SET_NAME_MAP, resolveCardIdToQuery } from "../lib/data/card-identity.js";
import { buildAlertEmailSubject, sendAlertEmail } from "../lib/data/email.js";
import { csvEscape, csvRow } from "../lib/data/csv.js";
import { matchesQuery, searchCards, getAllSets, getSetWithCards } from "../lib/data/card-database.js";

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

// ── Summary ──

console.log(`\n\x1b[1m=== ${passed} passed, ${failed} failed ===\x1b[0m\n`);
process.exit(failed > 0 ? 1 : 0);
