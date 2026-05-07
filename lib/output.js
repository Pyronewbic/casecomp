import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { GRADING_COMPANY_TIERS, PSA_TIERS } from "./psaTiers.js";

const __dirname = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUTPUT_DIR = path.join(__dirname, "output");

// results.json / results.md stay in root; everything else goes in output/
function outPath(prefix, filename) {
  if (prefix === "results") return path.join(__dirname, filename);
  return path.join(OUTPUT_DIR, filename);
}

async function ensureOutputDir() {
  await fs.mkdir(OUTPUT_DIR, { recursive: true });
}

function money(n, cur = "USD") {
  if (n == null || Number.isNaN(n)) return "—";
  const formatted = Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (cur === "USD") return `$${formatted}`;
  return `${formatted} ${cur}`;
}

function shipToCell(row, countries, pincodes) {
  const parts = countries
    .filter((c) => row.shippingToBuyer?.[c]?.eligible !== false)
    .map((c) => (pincodes?.[c] ? `${c}:${pincodes[c]}` : c));
  return parts.length ? parts.join(" ") : "—";
}

function confCell(g) {
  if (!g || g.error) return "—";
  return g.confidence.toFixed(1);
}

const GRADE_RE = /\b(PSA|BGS|CGC|TAG|SGC|HGA|ACE)\s+(\d+(?:\.\d+)?)\b/i;

function psaLabel(n) {
  if (n >= 10) return "Gem Mint";
  if (n >= 9) return "Mint";
  if (n >= 8) return "NM-MT";
  if (n >= 7) return "Near Mint";
  if (n >= 6) return "EX-MT";
  return "EX or below";
}

function gradeDetailTable(items) {
  const graded = items.filter(r => r.grade && !r.grade.error && r.grade.overall != null);
  if (!graded.length) return [];
  const lines = [];
  lines.push("### AI Grade Estimates");
  lines.push("| # | Overall | Centering | Corners | Edges | Surface | Conf. | Notes |");
  lines.push("|---|---------|-----------|---------|-------|---------|-------|-------|");
  for (let i = 0; i < graded.length; i++) {
    const g = graded[i].grade;
    const overall = `**PSA ${g.overall} (${psaLabel(g.overall)})**`;
    const notes = (g.notes || "").replace(/\|/g, "\\|");
    lines.push(`| ${i + 1} | ${overall} | ${g.centering}/10 | ${g.corners}/10 | ${g.edges}/10 | ${g.surface}/10 | ${g.confidence.toFixed(1)} | ${notes} |`);
  }
  const withLimitations = graded.filter(r => r.grade.limitations);
  if (withLimitations.length) {
    lines.push("");
    for (let i = 0; i < withLimitations.length; i++) {
      const idx = graded.indexOf(withLimitations[i]) + 1;
      lines.push(`> **#${idx} limitations:** ${withLimitations[i].grade.limitations}`);
    }
  }
  return lines;
}

function detectMetaFromBlock(block) {
  const activeItems = Object.values(block.activeByCountry || {}).flat();
  const allItems = [...activeItems, ...(block.sold || [])];
  const hasEbay = allItems.some((r) => (r.itemWebUrl || "").includes("ebay.com"));
  const hasMagi = allItems.some((r) => (r.itemWebUrl || "").includes("magi.camp"));
  const hasYahoo = allItems.some((r) => (r.itemWebUrl || "").includes("auctions.yahoo.co.jp"));
  const hasSnkrdunk = allItems.some((r) => (r.itemWebUrl || "").includes("snkrdunk.com"));
  const sources = [...(hasEbay ? ["eBay"] : []), ...(hasMagi ? ["magi"] : []), ...(hasYahoo ? ["Yahoo Auctions JP"] : []), ...(hasSnkrdunk ? ["SNKRDUNK"] : [])];

  // Scan only active listings for provider labels — sold listings may include
  // graded comps even for raw searches (especially from magi), which would
  // incorrectly make raw results appear as slab.
  const providerSet = new Set();
  for (const item of activeItems) {
    const label = item.listingGradeLabel;
    if (label) {
      const m = GRADE_RE.exec(String(label));
      if (m) providerSet.add(`${m[1].toUpperCase()} ${m[2]}`);
    }
  }

  const searchBase = (block.ebaySearchQuery || block.query || "")
    .replace(/\s+(PSA|BGS|CGC|TAG|SGC|HGA|ACE)\s+\d+(?:\.\d+)?$/i, "")
    .trim();

  return { sources, providers: [...providerSet], searchBase };
}

function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function mean(values) {
  if (!values.length) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

// gradeDecision shape: { companies: { PSA: { g9: block, g10: block }, BGS: ..., CGC: ... } }
export function gradingDecisionLines(rawBlock, gradeDecision) {
  const rawSoldPrices = (rawBlock?.sold || []).map(s => Number(s.price)).filter(v => v > 0);
  const rawMedian = mean(rawSoldPrices);

  const companies = gradeDecision?.companies || {};
  const companyNames = Object.keys(companies);

  const fmtAvg = (m, count) => {
    if (m == null) return "—";
    const warn = count < 3 ? ` ⚠ ${count} comp${count !== 1 ? "s" : ""}` : "";
    return `${money(m)}${warn}`;
  };
  const fmtUp = (v) => v == null ? "—" : `${v >= 0 ? "+" : ""}${v.toFixed(0)}%`;

  const lines = [];
  const companyLabel = companyNames.join(" · ") || "PSA";
  lines.push(`**Grading Decision** (${companyLabel})`);
  lines.push("");

  const rawWarn = rawSoldPrices.length < 3 ? ` ⚠ ${rawSoldPrices.length} comp${rawSoldPrices.length !== 1 ? "s" : ""}` : "";
  lines.push(`Raw sold avg: ${rawMedian != null ? money(rawMedian) : "—"}${rawWarn}`);
  lines.push("");

  for (const company of companyNames) {
    const { g9: g9Block, g10: g10Block } = companies[company];

    const g9Prices  = (g9Block?.sold  || []).map(s => Number(s.price)).filter(v => v > 0);
    const g10Prices = (g10Block?.sold || []).map(s => Number(s.price)).filter(v => v > 0);
    const g9Median  = mean(g9Prices);
    const g10Median = mean(g10Prices);

    // EV: only for PSA (requires PSA pop signal)
    const sig = company === "PSA" ? rawBlock?.psaSignal : null;
    let p10 = null, p9 = null, pOther = null;
    if (sig?.psa10Chance != null) {
      p10 = sig.psa10Chance / 100;
      if (sig.psa9to10Ratio != null) {
        p9 = p10 * sig.psa9to10Ratio;
        if (p10 + p9 > 1) p9 = 1 - p10;
        pOther = 1 - p10 - p9;
      } else {
        pOther = 1 - p10;
      }
    }
    const hasEV = p10 != null && g10Median != null && rawMedian != null;

    lines.push(`**${company}** — ${company} 9 avg: ${fmtAvg(g9Median, g9Prices.length)} | ${company} 10 avg: ${fmtAvg(g10Median, g10Prices.length)}`);
    lines.push("");

    const tiers = GRADING_COMPANY_TIERS[company] ?? PSA_TIERS;

    if (hasEV) {
      lines.push(`| Tier | Fee | Net ${company} 9 | Upside | Net ${company} 10 | Upside | EV | vs Raw |`);
      lines.push(`|------|----:|${"-".repeat(company.length + 8)}:|-------:|${"-".repeat(company.length + 9)}:|-------:|---:|-------:|`);
    } else {
      lines.push(`| Tier | Fee | Net ${company} 9 | Upside | Net ${company} 10 | Upside |`);
      lines.push(`|------|----:|${"-".repeat(company.length + 8)}:|-------:|${"-".repeat(company.length + 9)}:|-------:|`);
    }

    for (const { name, fee } of tiers) {
      const net9  = g9Median  != null ? Math.round(g9Median  - fee) : null;
      const net10 = g10Median != null ? Math.round(g10Median - fee) : null;
      const up9   = net9  != null && rawMedian ? (net9  - rawMedian) / rawMedian * 100 : null;
      const up10  = net10 != null && rawMedian ? (net10 - rawMedian) / rawMedian * 100 : null;
      if (hasEV) {
        let ev;
        if (p9 != null && g9Median != null) {
          ev = p10 * (g10Median - fee) + p9 * (g9Median - fee) + pOther * rawMedian;
        } else {
          ev = p10 * (g10Median - fee) + (1 - p10) * rawMedian;
        }
        ev = Math.round(ev);
        const evUp = (ev - rawMedian) / rawMedian * 100;
        lines.push(`| ${name} | $${fee} | ${net9 != null ? money(net9) : "—"} | ${fmtUp(up9)} | ${net10 != null ? money(net10) : "—"} | ${fmtUp(up10)} | ${money(ev)} | ${fmtUp(evUp)} |`);
      } else {
        lines.push(`| ${name} | $${fee} | ${net9 != null ? money(net9) : "—"} | ${fmtUp(up9)} | ${net10 != null ? money(net10) : "—"} | ${fmtUp(up10)} |`);
      }
    }

    lines.push("");
    if (hasEV) {
      const evNote = p9 != null
        ? `PSA pop: ${(p10 * 100).toFixed(1)}% PSA 10, ${(p9 * 100).toFixed(1)}% PSA 9`
        : `PSA pop: ${(p10 * 100).toFixed(1)}% PSA 10`;
      lines.push(`_Net = sold avg − fee. EV = probability-weighted return (${evNote}). Upside vs raw._`);
    } else {
      if (company === "PSA") {
        const noEvReason = !sig
          ? (process.env.PSA_AUTH_TOKEN ? "PSA pop unavailable — set name needed for first lookup" : "PSA pop unavailable — resets daily at 100 req/day")
          : "PSA 10 rate unknown";
        lines.push(`_Net = sold avg − fee. Upside vs raw. EV not shown (${noEvReason})._`);
      } else {
        lines.push(`_Net = sold avg − fee. Upside vs raw sold avg._`);
      }
    }
    lines.push("");
  }

  return lines;
}

function gradingSignalLines(sig) {
  if (!sig) return [];
  const pct = sig.psa10Chance != null ? `${sig.psa10Chance.toFixed(1)}%` : "—";
  const pop = sig.psaPopulation != null ? sig.psaPopulation.toLocaleString("en-US") : "—";
  const ratio = sig.psa9to10Ratio != null ? `${sig.psa9to10Ratio.toFixed(2)} : 1` : "—";
  return [
    "**Grading Signal** (PSA)",
    `| Difficulty | PSA 10 Chance | Population | PSA 9/10 |`,
    `|:----------:|:-------------:|:----------:|:--------:|`,
    `| **${sig.difficulty}** | ${pct} | ${pop} | ${ratio} |`,
  ];
}

function linkLabel(url) {
  if (!url) return "—";
  if (url.includes("magi.camp")) return "magi";
  if (url.includes("auctions.yahoo.co.jp")) return "Yahoo";
  if (url.includes("snkrdunk.com")) return "SNKRDUNK";
  return "eBay";
}

function soldGradeLabel(s) {
  if (s.listingGradeLabel) return String(s.listingGradeLabel).trim().replace(/\|/g, "\\|");
  const m = GRADE_RE.exec(s.title || "");
  return m ? `${m[1].toUpperCase()} ${m[2]}` : "—";
}

/** AI `--grade` → `Pre-Graded: …`; seller Condition / title → slab text e.g. `PSA 10` (no prefix). */
function activeGradeDisplay(row) {
  const g = row.grade;
  if (g && !g.error && g.overall != null && `${g.overall}`.trim() !== "") {
    return `Pre-Graded: ${g.overall}`;
  }
  const seller = row.listingGradeLabel;
  if (seller != null && String(seller).trim() !== "") {
    return String(seller).trim().replace(/\|/g, "\\|");
  }
  return "—";
}

export async function writeMarkdown(results, config, meta) {
  const lines = [];
  for (const block of results) {
    const {
      query,
      lang,
      activeByCountry,
      sold,
      counts,
      error,
      listingDescription,
      psaSignal,
    } = block;
    lines.push(`## ${query}`);
    if (error) {
      lines.push(`**Error:** ${error}`);
      lines.push("");
      lines.push("---");
      lines.push("");
      continue;
    }
    const { sources, providers, searchBase } = detectMetaFromBlock(block);
    lines.push(`**Search:** \`${searchBase}\``);
    if (sources.length) lines.push(`**Sources:** ${sources.join(", ")}`);
    if (providers.length) {
      lines.push(`**Listing type:** slab (${providers.join(" + ")})`);
    } else if (listingDescription) {
      lines.push(`**Listing type:** ${listingDescription}`);
    }
    lines.push("");
    lines.push(
      `**Language:** ${lang} | **Found:** ${counts.activeTotal} active, ${counts.sold} sold`,
    );
    lines.push("");
    if (block.gradeDecision) {
      const decLines = gradingDecisionLines(block, block.gradeDecision);
      decLines.forEach(l => lines.push(l));
      lines.push("");
    }
    const sigLines = gradingSignalLines(psaSignal);
    if (sigLines.length) { sigLines.forEach(l => lines.push(l)); lines.push(""); }
    const seenActiveIds = new Set();
    const mergedActive = [];
    for (const country of config.deliveryCountries) {
      for (const row of (activeByCountry[country] || [])) {
        const key = row.itemId || row.itemWebUrl;
        if (!seenActiveIds.has(key)) { seenActiveIds.add(key); mergedActive.push(row); }
      }
    }
    mergedActive.sort((a, b) => (a.totalCost ?? Infinity) - (b.totalCost ?? Infinity));
    lines.push(`### Active listings`);
    lines.push("| # | Total | Ship | To | Grade | Title | Link |");
    lines.push("|---|------:|------|-------|-------|------|------|");
    mergedActive.forEach((row, i) => {
      const title = (row.title || "").replace(/\|/g, "\\|");
      const url = (row.itemWebUrl || "").split("?")[0];
      const link = url ? `[${linkLabel(url)}](${url})` : "—";
      const toCell = shipToCell(row, config.deliveryCountries, config.deliveryPincodes);
      lines.push(
        `| ${i + 1} | ${money(row.totalCost, row.priceCurrency)} | ${row.shippingLabel} | ${toCell} | ${activeGradeDisplay(row)} | ${title} | ${link} |`,
      );
    });
    lines.push("");
    const mdHasAI = mergedActive.some(r => r.grade && !r.grade.error);
    if (mdHasAI) {
      const gdLines = gradeDetailTable(mergedActive);
      gdLines.forEach(l => lines.push(l));
      if (gdLines.length) lines.push("");
    }
    lines.push(`### Last ${(sold || []).length} sold`);
    lines.push("| # | Price | Date | Grade | Title | Link |");
    lines.push("|---|------:|------|-------|-------|------|");
    (sold || []).forEach((s, i) => {
      const title = (s.title || "").replace(/\|/g, "\\|");
      const url = (s.itemWebUrl || "").split("?")[0];
      const link = url ? `[${linkLabel(url)}](${url})` : "—";
      lines.push(`| ${i + 1} | ${money(s.price, s.currency)} | ${s.endedDate || "—"} | ${soldGradeLabel(s)} | ${title} | ${link} |`);
    });
    lines.push("");
    lines.push("---");
    lines.push("");
  }
  if (meta?.footer) {
    lines.push(meta.footer);
  }
  const pfx = meta?.outputPrefix || "results";
  await ensureOutputDir();
  await fs.writeFile(outPath(pfx, `${pfx}.md`), lines.join("\n"), "utf8");
}

function priceTrend(sold, todayStr) {
  if (!sold?.length) return "5d: — | 15d: — | 30d: —";
  const today = new Date(todayStr);
  const recent = sold[0];
  const recentPrice = Number(recent.price);
  if (!recentPrice) return "5d: — | 15d: — | 30d: —";

  function windowResult(days) {
    const target = new Date(today);
    target.setDate(target.getDate() - days);
    // find closest entry to target that is NOT the most recent
    const candidates = sold.slice(1);
    if (!candidates.length) return "—";
    let best = null, bestDiff = Infinity;
    for (const s of candidates) {
      const d = Math.abs(new Date(s.endedDate) - target);
      if (d < bestDiff) { bestDiff = d; best = s; }
    }
    if (!best) return "—";
    const oldPrice = Number(best.price);
    if (!oldPrice) return "—";
    const pct = ((recentPrice - oldPrice) / oldPrice) * 100;
    return (pct >= 0 ? "+" : "") + pct.toFixed(1) + "%";
  }

  return `5d: ${windowResult(5)} | 15d: ${windowResult(15)} | 30d: ${windowResult(30)}`;
}

export function printSummary(results, config) {
  const today = new Date().toISOString().slice(0, 10);
  const lines = [];
  for (const block of results) {
    const { query, lang, activeByCountry, sold, counts, error, listingFormat, psaSignal } = block;
    lines.push(`## ${query}`);
    if (error) { lines.push(`**Error:** ${error}`); lines.push(""); lines.push("---"); lines.push(""); continue; }

    const type = listingFormat || "raw";
    const { sources: pSources, providers: pProviders, searchBase: pBase } = detectMetaFromBlock(block);
    const sourceStr = pSources.length ? pSources.join("+") : "eBay";
    const typeStr = pProviders.length ? `slab (${pProviders.join("+")})` : type;
    lines.push(`Search: \`${pBase}\`  |  Sources: ${sourceStr}  |  Type: ${typeStr}  |  Lang: ${lang}  |  Active: ${counts?.activeTotal ?? "?"}  |  Sold: ${counts?.sold ?? "?"}`);
    lines.push("");
    if (block.gradeDecision) {
      const decLines = gradingDecisionLines(block, block.gradeDecision);
      decLines.forEach(l => lines.push(l));
      lines.push("");
    }
    const pSigLines = gradingSignalLines(psaSignal);
    if (pSigLines.length) { pSigLines.forEach(l => lines.push(l)); lines.push(""); }

    const seenIds = new Set();
    const allActive = [];
    for (const country of (config.deliveryCountries || [])) {
      for (const row of (activeByCountry?.[country] || [])) {
        const key = row.itemId || row.itemWebUrl;
        if (!seenIds.has(key)) { seenIds.add(key); allActive.push(row); }
      }
    }
    allActive.sort((a, b) => (a.totalCost ?? Infinity) - (b.totalCost ?? Infinity));
    const items = allActive.slice(0, config.resultsPerCard || 5);
    const hasGrade = type === "slab" || items.some(r => r.grade && !r.grade.error);
    const hasAI = type !== "slab" && items.some(r => r.grade && !r.grade.error);

    lines.push("### Active listings");
    lines.push("| # | Total | Ship | To | Grade | Title | Link |");
    lines.push("|---|------:|------|-------|-------|------|------|");
    for (let i = 0; i < items.length; i++) {
      const row = items[i];
      const title = (row.title || "").replace(/\|/g, "\\|");
      const url = (row.itemWebUrl || "").split("?")[0];
      const link = url ? `[${linkLabel(url)}](${url})` : "—";
      const to = shipToCell(row, config.deliveryCountries || [], config.deliveryPincodes || {});
      lines.push(`| ${i + 1} | ${money(row.totalCost, row.priceCurrency)} | ${row.shippingLabel} | ${to} | ${activeGradeDisplay(row)} | ${title} | ${link} |`);
    }
    lines.push("");

    if (hasAI) {
      const gdLines = gradeDetailTable(items);
      gdLines.forEach(l => lines.push(l));
      if (gdLines.length) lines.push("");
    }

    const soldRows = (sold || []).slice(0, config.soldListingsLimit || 5);
    lines.push("### Recent sold");
    lines.push("| # | Price | Date | Grade | Title | Link |");
    lines.push("|---|------:|------|-------|-------|------|");
    for (let i = 0; i < soldRows.length; i++) {
      const s = soldRows[i];
      const title = (s.title || "").replace(/\|/g, "\\|");
      const url = (s.itemWebUrl || "").split("?")[0];
      const link = url ? `[${linkLabel(url)}](${url})` : "—";
      lines.push(`| ${i + 1} | ${money(s.price, s.currency)} | ${s.endedDate || "—"} | ${soldGradeLabel(s)} | ${title} | ${link} |`);
    }
    lines.push("");
    lines.push(`**Price trend (sold):** ${priceTrend(soldRows, today)}`);
    lines.push("");
    lines.push("---");
    lines.push("");
  }
  process.stdout.write(lines.join("\n") + "\n");
}

const JSON_STRIP_KEYS = new Set(["raw"]);

function strippedJson(obj) {
  return JSON.stringify(
    obj,
    (key, val) => (JSON_STRIP_KEYS.has(key) ? undefined : val),
    2,
  );
}

export async function writeJson(payload, outputPrefix = "results") {
  await ensureOutputDir();
  await fs.writeFile(
    outPath(outputPrefix, `${outputPrefix}.json`),
    strippedJson(payload),
    "utf8",
  );
}

const COMBINED_JSON = path.join(OUTPUT_DIR, "resultsCombined.json");
const COMBINED_MD = path.join(OUTPUT_DIR, "resultsCombined.md");

export async function appendCombinedMarkdown(results, config) {
  // Load existing combined store
  let store = { entries: [] };
  try {
    store = JSON.parse(await fs.readFile(COMBINED_JSON, "utf8"));
  } catch {
    // first run — start fresh
  }

  for (const newResult of results) {
    if (newResult.error) continue;

    const matchKey = newResult.ebaySearchQuery || newResult.query;
    const idx = store.entries.findIndex(
      (e) => (e.ebaySearchQuery || e.query) === matchKey,
    );

    if (idx === -1) {
      store.entries.push({
        ...JSON.parse(strippedJson(newResult)),
        lastUpdated: new Date().toISOString(),
      });
    } else {
      const existing = store.entries[idx];

      // Merge active listings per country — dedupe by itemId
      for (const [country, newItems] of Object.entries(
        newResult.activeByCountry || {},
      )) {
        const existingItems = existing.activeByCountry?.[country] || [];
        const seenIds = new Set(existingItems.map((r) => r.itemId).filter(Boolean));
        const toAdd = JSON.parse(strippedJson(newItems)).filter(
          (r) => r.itemId && !seenIds.has(r.itemId),
        );
        existing.activeByCountry[country] = [...existingItems, ...toAdd];
      }

      // Merge sold — dedupe by itemWebUrl, keep sorted newest-first
      const existingSold = existing.sold || [];
      const seenUrls = new Set(
        existingSold.map((s) => s.itemWebUrl).filter(Boolean),
      );
      const newSold = JSON.parse(strippedJson(newResult.sold || [])).filter(
        (s) => s.itemWebUrl && !seenUrls.has(s.itemWebUrl),
      );
      existing.sold = [...existingSold, ...newSold].sort(
        (a, b) => new Date(b.endedDate || 0) - new Date(a.endedDate || 0),
      );

      existing.counts = {
        ...existing.counts,
        activeTotal: Math.max(
          ...Object.values(existing.activeByCountry || {}).map((a) => a.length),
          0,
        ),
        sold: existing.sold.length,
      };
      existing.lastUpdated = new Date().toISOString();
    }
  }

  await ensureOutputDir();
  await fs.writeFile(COMBINED_JSON, JSON.stringify(store, null, 2), "utf8");

  // Regenerate combined MD from the full merged store
  const combinedConfig = {
    ...config,
    soldListingsLimit: Math.max(
      ...store.entries.map((e) => (e.sold || []).length),
      config.soldListingsLimit,
    ),
  };
  const lines = [];
  for (const block of store.entries) {
    const {
      query,
      lang,
      activeByCountry,
      sold,
      counts,
      listingDescription,
      lastUpdated,
    } = block;
    lines.push(`## ${query}`);
    const { sources: cSources, providers: cProviders, searchBase: cBase } = detectMetaFromBlock(block);
    lines.push(`**Search:** \`${cBase}\``);
    if (cSources.length) lines.push(`**Sources:** ${cSources.join(", ")}`);
    if (cProviders.length) {
      lines.push(`**Listing type:** slab (${cProviders.join(" + ")})`);
    } else if (listingDescription) {
      lines.push(`**Listing type:** ${listingDescription}`);
    }
    if (lastUpdated) lines.push(`**Last updated:** ${lastUpdated}`);
    lines.push("");
    lines.push(
      `**Language:** ${lang} | **Found:** ${counts?.activeTotal ?? "?"} active, ${counts?.sold ?? "?"} sold`,
    );
    lines.push("");
    const seenCombinedIds = new Set();
    const mergedCombined = [];
    for (const country of (config.deliveryCountries || [])) {
      for (const row of (activeByCountry?.[country] || [])) {
        const key = row.itemId || row.itemWebUrl;
        if (!seenCombinedIds.has(key)) { seenCombinedIds.add(key); mergedCombined.push(row); }
      }
    }
    mergedCombined.sort((a, b) => (a.totalCost ?? Infinity) - (b.totalCost ?? Infinity));
    lines.push(`### Active listings`);
    lines.push("| # | Total | Ship | To | Grade | Title | Link |");
    lines.push("|---|------:|------|-------|-------|------|------|");
    mergedCombined.forEach((row, i) => {
      const title = (row.title || "").replace(/\|/g, "\\|");
      const url = (row.itemWebUrl || "").split("?")[0];
      const link = url ? `[${linkLabel(url)}](${url})` : "—";
      const toCell = shipToCell(row, config.deliveryCountries, config.deliveryPincodes);
      lines.push(
        `| ${i + 1} | ${money(row.totalCost, row.priceCurrency)} | ${row.shippingLabel} | ${toCell} | ${activeGradeDisplay(row)} | ${title} | ${link} |`,
      );
    });
    lines.push("");
    lines.push(`### ${(sold || []).length} sold (combined)`);
    lines.push("| # | Price | Date | Grade | Title | Link |");
    lines.push("|---|------:|------|-------|-------|------|");
    (sold || []).forEach((s, i) => {
      const title = (s.title || "").replace(/\|/g, "\\|");
      const url = (s.itemWebUrl || "").split("?")[0];
      const link = url ? `[${linkLabel(url)}](${url})` : "—";
      lines.push(`| ${i + 1} | ${money(s.price, s.currency)} | ${s.endedDate || "—"} | ${soldGradeLabel(s)} | ${title} | ${link} |`);
    });
    lines.push("");
    lines.push("---");
    lines.push("");
  }
  await fs.writeFile(COMBINED_MD, lines.join("\n"), "utf8");
}

export async function mergeAndWrite(prefixes, outputPrefix = "results") {
  const cardMaps = new Map();
  let sharedConfig = null;

  for (const prefix of prefixes) {
    for (let i = 0; ; i++) {
      let data;
      try {
        data = JSON.parse(await fs.readFile(path.join(OUTPUT_DIR, `${prefix}-${i}.json`), "utf8"));
      } catch {
        break;
      }
      if (!sharedConfig) {
        sharedConfig = {
          deliveryCountries: data.deliveryCountries || ["US", "IN"],
          deliveryPincodes: data.deliveryPincodes || {},
          soldListingsLimit: 5,
          resultsPerCard: 5,
        };
      }
      if (!cardMaps.has(i)) {
        cardMaps.set(i, JSON.parse(JSON.stringify(data)));
      } else {
        const existing = cardMaps.get(i);
        for (const [country, items] of Object.entries(data.activeByCountry || {})) {
          if (!existing.activeByCountry) existing.activeByCountry = {};
          const existingItems = existing.activeByCountry[country] || [];
          const seenIds = new Set(existingItems.map((r) => r.itemId).filter(Boolean));
          const toAdd = items.filter((r) => r.itemId && !seenIds.has(r.itemId));
          existing.activeByCountry[country] = [...existingItems, ...toAdd];
        }
        const seenUrls = new Set((existing.sold || []).map((s) => s.itemWebUrl).filter(Boolean));
        const newSold = (data.sold || []).filter((s) => s.itemWebUrl && !seenUrls.has(s.itemWebUrl));
        existing.sold = [...(existing.sold || []), ...newSold].sort(
          (a, b) => new Date(b.endedDate || 0) - new Date(a.endedDate || 0),
        );
        existing.counts = {
          ...existing.counts,
          activeTotal: Math.max(...Object.values(existing.activeByCountry || {}).map((a) => a.length), 0),
          sold: (existing.sold || []).length,
        };
      }
    }
  }

  if (!cardMaps.size) {
    process.stderr.write(`mergeAndWrite: no per-card JSON files found for prefixes: ${prefixes.join(", ")}\n`);
    return;
  }

  const results = Array.from({ length: Math.max(...cardMaps.keys()) + 1 }, (_, i) => cardMaps.get(i)).filter(Boolean);
  const config = {
    ...sharedConfig,
    soldListingsLimit: Math.max(...results.map((r) => (r.sold || []).length), sharedConfig.soldListingsLimit),
  };
  printSummary(results, config);
  await writeMarkdown(results, config, { outputPrefix });
  await writeJson({ generatedAt: new Date().toISOString(), results }, outputPrefix);
}

export async function writePerCardJson(results, config, outputPrefix = "results") {
  await ensureOutputDir();
  await Promise.all(
    results.map((result, i) =>
      fs.writeFile(
        path.join(OUTPUT_DIR, `${outputPrefix}-${i}.json`),
        strippedJson({
          deliveryCountries: config.deliveryCountries,
          deliveryPincodes: config.deliveryPincodes ?? {},
          ...result,
        }),
        "utf8",
      ),
    ),
  );
}
