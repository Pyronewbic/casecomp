import { parseGradeJSON } from "../lib/grading.js";
import { buildEbaySearchQuery, describeListingSearch } from "../lib/listingQuery.js";
import {
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
} from "../lib/filters.js";
import { isDemoQuery, getDemoResult, getDemoSearchResult, listDemoCards } from "../lib/demo.js";

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
  eq(r.source, "snkrdunk");
});

test("getDemoResult partial match works", () => {
  const r = getDemoResult("greninja");
  assert(r);
  assert(r._demo);
});

test("getDemoSearchResult filters by condition", () => {
  const r = getDemoSearchResult("Mega Greninja ex SAR", { condition: "A" });
  const items = r.activeByCountry?.US || [];
  assert(items.every(i => i.condition.startsWith("A")));
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
      assert(item.grade, `missing grade in ${key}: ${item.itemId}`);
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
  for (const item of items) {
    eq(item.grade, null, `slab should have null grade: ${item.itemId}`);
    assert(item.listingGradeLabel, `missing listingGradeLabel: ${item.itemId}`);
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

// ── Summary ──

console.log(`\n\x1b[1m=== ${passed} passed, ${failed} failed ===\x1b[0m\n`);
process.exit(failed > 0 ? 1 : 0);
