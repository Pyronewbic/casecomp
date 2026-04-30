#!/usr/bin/env node
import "dotenv/config";
import minimist from "minimist";
import { bustCaches } from "./cache.js";
import {
  getAccessToken,
  invalidateToken,
  searchActive,
  searchSold,
  testEbayAuth,
  getEbayUsageToday,
  DAILY_CAP,
} from "./ebay.js";
import { filterRelevantResults, detectLanguage } from "./filters.js";
import {
  gradeImage,
  testGradingProvider,
  printSiteGradingHelp,
} from "./grading.js";
import { writeMarkdown, writeJson } from "./output.js";
import { buildEbaySearchQuery, describeListingSearch } from "./listingQuery.js";
import { EBAY_CATEGORY_TCG_SINGLE_CARDS_US } from "./ebayCategories.js";

export const CARDS = [
  "Giratina V Alt Art Japanese"
];

export const CONFIG = {
  language: "any",
  deliveryCountries: ["US", "IN"],
  resultsPerCard: 5,
  soldListingsLimit: 3,
  /** When true, try Playwright (Chromium) before axios for sold HTML (Insights still first). */
  soldBrowser: false,
  /** Narrow Browse + sold scrape to TCG singles category and drop obvious non-card titles. */
  tcgListingFocus: true,
  /** Toys & Hobbies › Collectible Card Games › Single Cards (Buy API: CCG Individual Cards). */
  tcgBrowseCategoryIds: EBAY_CATEGORY_TCG_SINGLE_CARDS_US,
  /** "raw" = ungraded bias; "slab" = graded in case (uses slab.provider + slab.grade). */
  listingFormat: "raw",
  /** Appended to eBay q when listingFormat is raw (e.g. "ungraded", or "" for card name only). */
  rawSearchSuffix: "",
  slab: {
    provider: "PSA",
    grade: "10",
  },
  aiGrading: {
    enabled: false,
    mode: "llm",
    llm: {
      provider: "claude",
      model: "claude-opus-4-7",
      maxTokens: 500,
    },
    site: {
      provider: "local",
    },
    minGradeToReport: 0,
    cacheGrades: true,
  },
};

const argv = minimist(process.argv.slice(2));

function log(msg) {
  const t = new Date().toTimeString().slice(0, 8);
  console.log(`[${t}] ${msg}`);
}

/** Readable axios / fetch-style errors (avoids "[object Object]"). */
function formatRequestError(err) {
  if (err == null) return String(err);
  const res = err.response;
  if (res) {
    const bits = [res.status, res.statusText].filter(Boolean).join(" ");
    let body = res.data;
    if (body != null && typeof body === "object") {
      try {
        body = JSON.stringify(body);
      } catch {
        body = String(body);
      }
    }
    return [bits, body].filter(Boolean).join(" — ").trim() || err.message || String(err);
  }
  return err.message || String(err);
}

function applyArgvToConfig(cfg) {
  const c = structuredClone(cfg);
  if (argv.lang) c.language = argv.lang;
  if (argv.countries) {
    c.deliveryCountries = String(argv.countries)
      .split(",")
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean);
  }
  if (argv.results != null) c.resultsPerCard = Number(argv.results);
  if (argv.sold != null) c.soldListingsLimit = Number(argv.sold);
  if (argv.grade) c.aiGrading.enabled = true;
  if (argv["grade-mode"]) c.aiGrading.mode = argv["grade-mode"];
  if (argv["llm-provider"]) c.aiGrading.llm.provider = argv["llm-provider"];
  if (argv["llm-model"]) c.aiGrading.llm.model = argv["llm-model"];
  if (argv["site-provider"]) c.aiGrading.site.provider = argv["site-provider"];
  if (argv["min-grade"] != null) {
    c.aiGrading.minGradeToReport = Number(argv["min-grade"]);
  }
  if (argv.format) {
    const f = String(argv.format).toLowerCase();
    if (f === "raw" || f === "slab") c.listingFormat = f;
  }
  if (argv["slab-provider"] != null) {
    c.slab.provider = String(argv["slab-provider"]).trim();
  }
  if (argv["slab-grade"] != null) {
    c.slab.grade = String(argv["slab-grade"]).trim();
  }
  if (argv["raw-suffix"] !== undefined) {
    const v = argv["raw-suffix"];
    c.rawSearchSuffix = v === true || v === false ? "" : String(v);
  }
  if (argv["sold-browser"]) {
    c.soldBrowser = true;
  } else {
    const eb = (process.env.EBAY_SOLD_BROWSER || "").toLowerCase();
    c.soldBrowser =
      eb === "1" || eb === "true" || eb === "playwright" || eb === "chromium";
  }
  if (argv["wide-products"]) {
    c.tcgListingFocus = false;
  } else if (process.env.EBAY_TCG_FOCUS === "0") {
    c.tcgListingFocus = false;
  }
  return c;
}

function printSetupInstructions(missing) {
  console.log(`
=== Setup ===
${missing.map((m) => `• Missing: ${m}`).join("\n")}

eBay Browse API:
  1) Create a developer account at https://developer.ebay.com/
  2) Create a keyset (Client ID / Client Secret)
  3) Copy to .env:
       EBAY_CLIENT_ID=...
       EBAY_CLIENT_SECRET=...
  See .env.example for all variables.

Optional LLM grading (when --grade --grade-mode llm):
  • Claude: ANTHROPIC_API_KEY in .env
  • OpenAI: OPENAI_API_KEY in .env

Optional site grading (when --grade --grade-mode site):
  • Set provider URLs/keys (TCGRADER_*, POKEGRADE_*, SNAPGRADE_*) or LOCAL_GRADER_URL
`);
}

function verifyEnv(config, noEbay) {
  const missing = [];
  const gradingMissing = [];
  if (!noEbay) {
    if (!process.env.EBAY_CLIENT_ID) missing.push("EBAY_CLIENT_ID");
    if (!process.env.EBAY_CLIENT_SECRET) missing.push("EBAY_CLIENT_SECRET");
  }
  if (config.aiGrading.enabled && config.aiGrading.mode === "llm") {
    if (config.aiGrading.llm.provider === "claude") {
      if (!process.env.ANTHROPIC_API_KEY) gradingMissing.push("ANTHROPIC_API_KEY");
    } else if (config.aiGrading.llm.provider === "openai") {
      if (!process.env.OPENAI_API_KEY) gradingMissing.push("OPENAI_API_KEY");
    }
  }
  if (config.aiGrading.enabled && config.aiGrading.mode === "site") {
    const p = config.aiGrading.site.provider;
    const need = [];
    if (p === "tcgrader") {
      if (!process.env.TCGRADER_API_URL) need.push("TCGRADER_API_URL");
      if (!process.env.TCGRADER_API_KEY) need.push("TCGRADER_API_KEY");
    } else if (p === "pokegrade") {
      if (!process.env.POKEGRADE_API_URL) need.push("POKEGRADE_API_URL");
      if (!process.env.POKEGRADE_API_KEY) need.push("POKEGRADE_API_KEY");
    } else if (p === "snapgrade") {
      if (!process.env.SNAPGRADE_API_URL) need.push("SNAPGRADE_API_URL");
      if (!process.env.SNAPGRADE_API_KEY) need.push("SNAPGRADE_API_KEY");
    } else if (p === "local") {
      if (!process.env.LOCAL_GRADER_URL) need.push("LOCAL_GRADER_URL");
    }
    if (need.length) {
      printSiteGradingHelp();
      gradingMissing.push(...need);
    }
  }
  return { missing, gradingMissing };
}

function gradingLabel(config) {
  if (!config.aiGrading.enabled) return "off";
  if (config.aiGrading.mode === "llm") {
    return `${config.aiGrading.llm.provider} (${config.aiGrading.llm.model})`;
  }
  return `site (${config.aiGrading.site.provider})`;
}

function applyMinGrade(items, min) {
  if (!min || min <= 0) return items;
  return items.filter((row) => {
    if (!row.grade || row.grade.error) return true;
    return row.grade.overall >= min;
  });
}

async function gradeItems(items, config, counters) {
  const out = [];
  let sum = 0;
  let n = 0;
  for (const row of items) {
    try {
      const g = await gradeImage(row.imageUrl, config);
      if (g && !g.error) {
        sum += g.overall;
        n++;
        if (config.aiGrading.mode === "llm") counters.llmCalls += 1;
      }
      out.push({ ...row, grade: g });
    } catch (e) {
      log(`  grade error: ${e.message || e}`);
      out.push({ ...row, grade: { error: e.message, raw: null } });
    }
  }
  return { rows: out, avg: n ? sum / n : null, graded: n };
}

export async function main() {
  const refresh = Boolean(argv.refresh);
  // minimist treats --no-ebay as { ebay: false } (not no-ebay: true)
  const noEbay = argv.ebay === false;
  const limit =
    argv.limit != null ? Math.max(1, Number(argv.limit)) : CARDS.length;

  if (refresh) {
    await bustCaches([
      "ebay-active-cache.json",
      "ebay-sold-cache.json",
      "ai-grade-cache.json",
    ]);
    log("Cache busted (eBay active/sold + AI grades).");
  }

  let config = applyArgvToConfig(CONFIG);
  if (config.listingFormat === "slab") {
    if (config.aiGrading.enabled) {
      log(
        "Slab listings already carry a seller grade — AI pre-grade disabled.",
      );
    }
    config.aiGrading.enabled = false;
  }
  const { missing, gradingMissing } = verifyEnv(config, noEbay);
  const allMissing = [...missing, ...gradingMissing];
  if (allMissing.length) {
    printSetupInstructions(allMissing);
    if (!noEbay && missing.length) {
      process.exit(1);
    }
    if (config.aiGrading.enabled && gradingMissing.length) {
      log("Disabling AI grading (incomplete configuration).");
      config.aiGrading.enabled = false;
    }
  }

  const clientId = process.env.EBAY_CLIENT_ID;
  const clientSecret = process.env.EBAY_CLIENT_SECRET;

  async function getToken() {
    return getAccessToken(clientId, clientSecret);
  }
  async function on401() {
    invalidateToken();
  }

  if (!noEbay) {
    try {
      await testEbayAuth(clientId, clientSecret);
      log("eBay OAuth: OK");
    } catch (e) {
      log(`eBay OAuth failed: ${formatRequestError(e)}`);
      process.exit(1);
    }
  } else {
    log("--no-ebay: skipping eBay authentication.");
  }

  if (config.aiGrading.enabled) {
    const t = await testGradingProvider(config);
    if (!t.ok) {
      log(
        `Grading provider smoke test failed: ${t.error?.message || t.error}. Disabling grading.`,
      );
      if (config.aiGrading.mode === "site") printSiteGradingHelp();
      config.aiGrading.enabled = false;
    } else {
      log(`Grading provider smoke test: OK (${gradingLabel(config)})`);
    }
  }

  const cards = CARDS.slice(0, limit);
  const results = [];
  const counters = { llmCalls: 0 };

  async function processCard(card, idx, total, { verbose }) {
    const ebayQuery = buildEbaySearchQuery(card, config);
    const listingDesc = describeListingSearch(config);
    log(
      `[${idx + 1}/${total}] "${card}" (lang=${config.language}, ${listingDesc})`,
    );
    log(`  eBay q: ${ebayQuery}`);
    if (verbose) {
      log("  (startup: full pipeline logging for this card)");
    }

    const activeByCountry = {};
    const pipelines = {};
    let activeTotal = 0;

    try {
      for (const country of config.deliveryCountries) {
      const res = await searchActive({
        query: ebayQuery,
        relevanceQuery: card,
        country,
        lang: config.language,
        config,
        refresh,
        noEbay,
        getToken,
        on401,
      });
      const p = res.pipeline;
      const items = res.items || [];
      pipelines[country] = p;

      const tcgStep =
        config.tcgListingFocus !== false && p?.afterTcgFocus != null
          ? ` → ${p.afterTcgFocus} (tcg)`
          : "";
      log(
        `  Active ${country}: ${p?.fetched ?? items.length} → ${p?.afterLanguage ?? "?"} (lang) → ${p?.afterRelevance ?? items.length} (relevance) → ${p?.afterListingFormat ?? "?"} (format)${tcgStep} → top ${items.length}${p?.cardOnlyBrowseFallback ? " [card-only Browse]" : ""}${p?.unrestrictedBrowse ? " [wide Browse+BIN: verify listing]" : p?.deliveryFilterRelaxed ? " [relaxed Browse filters]" : ""}`,
      );
      if (verbose) {
        log(
          `    [verbose] relevance stats: ${JSON.stringify(p?.relevanceStats || {})}`,
        );
      }

      let gradedPack = { rows: items, avg: null, graded: 0 };
      if (config.aiGrading.enabled && items.length) {
        const prov = gradingLabel(config);
        log(`  Grading ${items.length} images via ${prov.split(" ")[0]}...`);
        gradedPack = await gradeItems(items, config, counters);
        const batchCost = (gradedPack.graded * 0.02).toFixed(2);
        log(
          `  ... done (avg ${gradedPack.avg != null ? gradedPack.avg.toFixed(1) : "—"}, ~$${batchCost} est. this batch)`,
        );
      } else {
        gradedPack = {
          rows: items.map((r) => ({ ...r, grade: null })),
          avg: null,
          graded: 0,
        };
      }

      let rows = gradedPack.rows;
      rows = applyMinGrade(rows, config.aiGrading.minGradeToReport);
      activeByCountry[country] = rows;
      activeTotal += rows.length;
      }

      const soldRes = await searchSold({
      query: ebayQuery,
      relevanceQuery: card,
      lang: config.language,
      config,
      refresh,
      noEbay,
      getToken,
      on401,
      soldBrowser: config.soldBrowser,
    });
      const sp = soldRes.pipeline;
      const soldTcg =
        config.tcgListingFocus !== false && sp?.afterTcgFocus != null
          ? ` → ${sp.afterTcgFocus} (tcg)`
          : "";
      log(
        `  Sold (${soldRes.source}): ${sp?.fetched ?? 0} → ${sp?.afterLanguage ?? "?"} (lang) → ${sp?.afterRelevance ?? 0} (relevance) → ${sp?.afterListingFormat ?? "?"} (format)${soldTcg} → last ${soldRes.items?.length ?? 0}`,
      );

      const ebayUsed = await getEbayUsageToday();
      log(`  eBay: ${ebayUsed}/${DAILY_CAP} today | LLM calls: ${counters.llmCalls}`);

      results.push({
        query: card,
        ebaySearchQuery: ebayQuery,
        listingFormat: config.listingFormat,
        listingDescription: listingDesc,
        slab:
          config.listingFormat === "slab"
            ? { ...config.slab }
            : null,
        lang: config.language,
        activeByCountry,
        sold: soldRes.items,
        soldSource: soldRes.source,
        gradingLabel: gradingLabel(config),
        counts: {
          activeTotal,
          sold: soldRes.items?.length ?? 0,
        },
        pipelines: { active: pipelines, sold: sp },
      });
    } catch (e) {
      log(`  ERROR: ${formatRequestError(e)}`);
      results.push({
        query: card,
        ebaySearchQuery: ebayQuery,
        listingFormat: config.listingFormat,
        listingDescription: listingDesc,
        slab:
          config.listingFormat === "slab"
            ? { ...config.slab }
            : null,
        lang: config.language,
        error: formatRequestError(e),
        activeByCountry: {},
        sold: [],
        gradingLabel: gradingLabel(config),
        counts: { activeTotal: 0, sold: 0 },
      });
    }
  }

  const total = cards.length;
  if (total) {
    log("Startup sequence: eBay + grading verified; running cards (verbose on first).");
    for (let i = 0; i < total; i++) {
      await processCard(cards[i], i, total, { verbose: i === 0 });
    }
  }

  await writeMarkdown(results, config, {
    footer: `Generated with eBay Browse API. Usage logged: ${await getEbayUsageToday()}/${DAILY_CAP}.`,
  });
  await writeJson({
    generatedAt: new Date().toISOString(),
    config,
    argv,
    results,
  });
  log("Wrote results.md and results.json");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

export {
  getAccessToken,
  searchActive,
  searchSold,
  filterRelevantResults,
  detectLanguage,
  gradeImage,
};
export {
  gradeViaLLM,
  gradeViaClaude,
  gradeViaOpenAI,
  gradeViaSite,
  gradeViaTCGrader,
  gradeViaPokeGrade,
  gradeViaSnapGrade,
  gradeViaLocal,
  parseGradeJSON,
} from "./grading.js";
export {
  getCachedGrade,
  cacheGrade,
} from "./grading.js";
export { writeMarkdown, writeJson } from "./output.js";
export { buildEbaySearchQuery, describeListingSearch } from "./listingQuery.js";
