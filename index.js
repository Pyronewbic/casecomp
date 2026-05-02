#!/usr/bin/env node
import "dotenv/config";
import minimist from "minimist";
import { bustCaches } from "./lib/cache.js";
import {
  getAccessToken,
  invalidateToken,
  searchActive,
  searchSold,
  testEbayAuth,
  getEbayUsageToday,
  DAILY_CAP,
} from "./lib/ebay.js";
import {
  filterRelevantResults,
  detectLanguage,
  normalizeListingLanguage,
  parseListingLanguagesFromInput,
} from "./lib/filters.js";
import {
  gradeImage,
  testGradingProvider,
  printSiteGradingHelp,
} from "./lib/grading.js";
import { writeMarkdown, writeJson, writePerCardJson, appendCombinedMarkdown, printSummary, mergeAndWrite } from "./lib/output.js";
import { buildEbaySearchQuery, describeListingSearch } from "./lib/listingQuery.js";
import { EBAY_CATEGORY_TCG_SINGLE_CARDS_US } from "./lib/ebayCategories.js";
import { searchMagi } from "./lib/magi.js";
import { getPsaGradingSignal } from "./lib/psa.js";

export const CARDS = [
  "Giratina V Alt Art"
];

export const CONFIG = {
  /** Display / JSON: `any` or `eng+jp` style. Use `languages` for wire params (set by `applyArgvToConfig`). */
  language: "any",
  /** Canonical langs for Browse + sold: `[]` = any; otherwise subset of eng, jp, cn. */
  languages: [],
  deliveryCountries: ["US", "IN"],
  deliveryPincodes: { US: "19701", IN: "600028" },
  resultsPerCard: 5,
  soldListingsLimit: 5,
  /** When true, try Playwright (Chromium) before axios for sold HTML (Insights still first). */
  soldBrowser: false,
  /** Toys & Hobbies › Collectible Card Games › Single Cards (always applied; Browse + relevance filter to plausible TCG singles). */
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

const argv = minimist(process.argv.slice(2), {
  boolean: ["refresh", "parallel", "grade", "sold-browser"],
});

/**
 * Card search lines: positional args and/or `--cards` (comma-separated).
 * If neither is provided, uses `defaults` (`CARDS` from this module).
 */
function resolveCardsFromArgv(argvIn, defaults) {
  const pos = (argvIn._ ?? [])
    .map((s) => String(s).trim())
    .filter(Boolean);
  const flag =
    argvIn.cards != null && argvIn.cards !== true
      ? String(argvIn.cards)
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)
      : [];
  const merged = [...pos, ...flag];
  return merged.length ? merged : [...defaults];
}

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
  const langFromArgv =
    argv.lang != null && argv.lang !== true && argv.lang !== false;
  const argvLangRaw = langFromArgv
    ? Array.isArray(argv.lang)
      ? argv.lang.join(",")
      : String(argv.lang).trim()
    : null;
  const incomingMerged =
    argvLangRaw ?? String(c.language ?? "any").trim();

  const warnTok = (msg) => log(msg);
  c.languages = parseListingLanguagesFromInput(incomingMerged, warnTok);
  c.language =
    c.languages.length > 0 ? c.languages.join("+") : "any";
  if (argv.countries) {
    c.deliveryCountries = String(argv.countries)
      .split(",")
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean);
  }
  if (argv.pincodes) {
    const overrides = {};
    String(argv.pincodes)
      .split(",")
      .forEach((pair) => {
        const [iso, code] = pair.split(":").map((s) => s.trim());
        if (iso && code) overrides[iso.toUpperCase()] = code;
      });
    c.deliveryPincodes = { ...c.deliveryPincodes, ...overrides };
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
  if (argv.source) {
    c.source = String(argv.source).toLowerCase().trim();
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
  const results = await Promise.all(
    items.map(async (row) => {
      try {
        const g = await gradeImage(row.imageUrl, config);
        return { row, g, err: null };
      } catch (e) {
        return { row, g: null, err: e };
      }
    }),
  );
  let sum = 0;
  let n = 0;
  const out = results.map(({ row, g, err }) => {
    if (err) {
      log(`  grade error: ${err.message || err}`);
      return { ...row, grade: { error: err.message, raw: null } };
    }
    if (g && !g.error) {
      sum += g.overall;
      n++;
      if (config.aiGrading.mode === "llm") counters.llmCalls += 1;
    }
    return { ...row, grade: g };
  });
  return { rows: out, avg: n ? sum / n : null, graded: n };
}

export async function main() {
  if (argv.merge) {
    const prefixes = String(argv.merge).split(",").map((s) => s.trim());
    const outputPrefix = argv.output != null && argv.output !== true ? String(argv.output) : "results";
    await mergeAndWrite(prefixes, outputPrefix);
    return;
  }

  const refresh = Boolean(argv.refresh);
  // minimist treats --no-ebay as { ebay: false } (not no-ebay: true)
  const noEbay = argv.ebay === false;
  const cardList = resolveCardsFromArgv(argv, CARDS);
  const limit =
    argv.limit != null ? Math.max(1, Number(argv.limit)) : cardList.length;

  if (refresh) {
    await bustCaches([
      "ebay-active-cache.json",
      "ebay-sold-cache.json",
      "ebay-insights-forbidden-cache.json",
      "ai-grade-cache.json",
    ]);
    log("Cache busted (eBay active/sold + Insights skip flag + AI grades).");
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

  if (config.source === "magi") {
    log("Source: magi.camp (skipping eBay auth)");
  } else if (!noEbay) {
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

  const cards = cardList.slice(0, limit);
  const results = [];
  const counters = { llmCalls: 0 };

  const cliCardHint =
    (argv._?.length && argv._.some(Boolean)) ||
    (argv.cards != null && argv.cards !== true && String(argv.cards).trim());
  if (cliCardHint) {
    log(`Card lines from CLI (${cards.length} run): ${cards.map((c) => JSON.stringify(c)).join(", ")}`);
  }

  async function processCard(card, idx, total, { verbose }) {
    if (config.source === "magi") {
      log(`[${idx + 1}/${total}] "${card}" (magi, lang=jp)`);
      return searchMagi(card, config, { log });
    }

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
      const deliveryCountries = config.deliveryCountries;
      const activeRes = await searchActive({
        query: ebayQuery,
        relevanceQuery: card,
        deliveryCountries,
        languages: config.languages,
        config,
        refresh,
        noEbay,
        getToken,
        on401,
      });

      const p = activeRes.pipeline;
      deliveryCountries.forEach((c) => {
        pipelines[c] = { ...p };
      });

      const by = activeRes.itemsByCountry || {};
      const keyed = new Map();
      for (const c of deliveryCountries) {
        for (const r of by[c] || []) keyed.set(r.itemId || r.itemWebUrl, r);
      }

      const mergeRows = [...keyed.values()];
      if (config.aiGrading.enabled && mergeRows.length) {
        const prov = gradingLabel(config);
        log(
          `  Grading ${mergeRows.length} distinct listing image(s) across ${deliveryCountries.join("/")}… via ${prov.split(" ")[0]}…`,
        );
        const gp = await gradeItems(mergeRows, config, counters);
        const batchCost = (gp.graded * 0.02).toFixed(2);
        log(
          `  ... done (avg ${gp.avg != null ? gp.avg.toFixed(1) : "—"}, ~$${batchCost} est. this batch)`,
        );
      } else {
        mergeRows.forEach((r) => {
          /* eslint-disable no-param-reassign */
          if (r) r.grade = r?.grade ?? null;
        });
      }

      activeTotal = deliveryCountries.reduce(
        (n, c) => n + ((by[c] || []).length),
        0,
      );

      for (const country of deliveryCountries) {
        const tcgStep =
          p?.afterTcgFocus != null ? ` → ${p.afterTcgFocus} (tcg)` : "";
        const langFacetTag = p?.browseLanguageFacet
          ? " [Item specifics Language facet]"
          : "";
        log(
          `  Active ships-to ${country}: top ${(by[country] || []).length} (Browse pool ${p?.fetched ?? "?"} → …${tcgStep})${langFacetTag}${activeRes.pipeline?.unrestrictedBrowse ? " [wide Browse+BIN]" : activeRes.pipeline?.deliveryFilterRelaxed ? " [relaxed Browse]" : ""} ship getItems=${p?.shipToGetItemLookups ?? 0}`,
        );
        if (verbose) {
          log(
            `    [verbose] relevance stats: ${JSON.stringify(p?.relevanceStats || {})}`,
          );
        }

        let rows = (by[country] || []).map((r) => ({ ...r }));
        rows = applyMinGrade(rows, config.aiGrading.minGradeToReport);
        activeByCountry[country] = rows;
      }

      const soldRes = await searchSold({
        query: ebayQuery,
        relevanceQuery: card,
        languages: config.languages,
        config,
        refresh,
        noEbay,
        getToken,
        on401,
        soldBrowser: config.soldBrowser,
      });
      const sp = soldRes.pipeline;
      const soldTcg =
        sp?.afterTcgFocus != null ? ` → ${sp.afterTcgFocus} (tcg)` : "";
      const soldFacet =
        sp?.soldBrowseGetItemCalls != null && sp.soldBrowseGetItemCalls > 0
          ? `, ${sp.soldBrowseGetItemCalls} × getItem(lang)`
          : "";
      log(
        `  Sold (${soldRes.source}): ${sp?.fetched ?? 0} → ${sp?.afterLanguage ?? "?"} (lang coarse) → ${sp?.afterRelevance ?? 0} (relevance) → ${sp?.afterListingFormat ?? "?"} (format)${soldTcg} → last ${soldRes.items?.length ?? 0}${soldFacet}`,
      );

      const ebayUsed = await getEbayUsageToday();
      log(`  eBay: ${ebayUsed}/${DAILY_CAP} today | LLM calls: ${counters.llmCalls}`);

      const psaSignal = config.listingFormat === "raw"
        ? await getPsaGradingSignal(card, { log })
        : null;

      return {
        query: card,
        ebaySearchQuery: ebayQuery,
        listingFormat: config.listingFormat,
        listingDescription: listingDesc,
        slab:
          config.listingFormat === "slab"
            ? { ...config.slab }
            : null,
        languages: config.languages,
        lang: config.language,
        activeByCountry,
        sold: soldRes.items,
        soldSource: soldRes.source,
        gradingLabel: gradingLabel(config),
        psaSignal,
        counts: {
          activeTotal,
          sold: soldRes.items?.length ?? 0,
        },
        pipelines: { active: pipelines, sold: sp },
      };
    } catch (e) {
      log(`  ERROR: ${formatRequestError(e)}`);
      return {
        query: card,
        ebaySearchQuery: ebayQuery,
        listingFormat: config.listingFormat,
        listingDescription: listingDesc,
        slab:
          config.listingFormat === "slab"
            ? { ...config.slab }
            : null,
        languages: config.languages,
        lang: config.language,
        error: formatRequestError(e),
        activeByCountry: {},
        sold: [],
        gradingLabel: gradingLabel(config),
        counts: { activeTotal: 0, sold: 0 },
      };
    }
  }

  const total = cards.length;
  const parallel = Boolean(argv.parallel) && total > 1;
  if (total) {
    log(`Startup sequence: eBay + grading verified; running cards${parallel ? ` (${total} in parallel)` : ""} (verbose on first).`);
    if (parallel) {
      const settled = await Promise.all(
        cards.map((card, i) => processCard(card, i, total, { verbose: i === 0 }))
      );
      results.push(...settled);
    } else {
      for (let i = 0; i < total; i++) {
        results.push(await processCard(cards[i], i, total, { verbose: i === 0 }));
      }
    }
  }

  const outputPrefix = argv.output != null && argv.output !== true ? String(argv.output) : "results";
  const usageCount = await getEbayUsageToday();
  printSummary(results, config);
  await Promise.all([
    writeMarkdown(results, config, {
      footer: `Generated with eBay Browse API. Usage logged: ${usageCount}/${DAILY_CAP}.`,
      outputPrefix,
    }),
    writeJson({
      generatedAt: new Date().toISOString(),
      config,
      argv,
      cardQueries: cards,
      results,
    }, outputPrefix),
    writePerCardJson(results, config, outputPrefix),
    appendCombinedMarkdown(results, config),
  ]);
  log(`Wrote ${outputPrefix}.md, ${outputPrefix}.json, and ${results.length} per-card files`);
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
  normalizeListingLanguage,
  parseListingLanguagesFromInput,
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
} from "./lib/grading.js";
export {
  getCachedGrade,
  cacheGrade,
} from "./lib/grading.js";
export { writeMarkdown, writeJson, writePerCardJson, appendCombinedMarkdown, printSummary } from "./lib/output.js";
export { buildEbaySearchQuery, describeListingSearch } from "./lib/listingQuery.js";
