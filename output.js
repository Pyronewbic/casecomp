import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

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
      gradingLabel,
      counts,
      error,
      ebaySearchQuery,
      listingDescription,
    } = block;
    lines.push(`## ${query}`);
    if (error) {
      lines.push(`**Error:** ${error}`);
      lines.push("");
      lines.push("---");
      lines.push("");
      continue;
    }
    if (ebaySearchQuery) {
      lines.push(`**eBay search:** \`${ebaySearchQuery}\``);
    }
    if (listingDescription) {
      lines.push(`**Listing type:** ${listingDescription}`);
    }
    lines.push("");
    lines.push(
      `**Language:** ${lang} | **Found:** ${counts.activeTotal} active, ${counts.sold} sold | **Grading:** ${gradingLabel}`,
    );
    lines.push("");
    for (const country of config.deliveryCountries) {
      const items = activeByCountry[country] || [];
      lines.push(
        `### Active — ships to **${country}**`,
      );
      lines.push(
        "| # | Price | Ship | Total | To | Grade | AI conf | Title |",
      );
      lines.push("|---|------:|-----:|------:|:---|------:|--------:|-------|");
      items.forEach((row, i) => {
        const g = row.grade;
        const title = (row.title || "").replace(/\|/g, "\\|");
        const link = `[${title.slice(0, 80)}${title.length > 80 ? "…" : ""}](${row.itemWebUrl || "#"})`;
        const toCell = shipToCell(row, config.deliveryCountries, config.deliveryPincodes);
        lines.push(
          `| ${i + 1} | ${money(row.price, row.priceCurrency)} | ${row.shippingLabel} | ${money(row.totalCost, row.priceCurrency)} | ${toCell} | ${activeGradeDisplay(row)} | ${confCell(g)} | ${link} |`,
        );
      });
      lines.push("");
    }
    lines.push(`### Last ${config.soldListingsLimit} sold`);
    (sold || []).forEach((s, i) => {
      const date = s.endedDate || "—";
      const link = s.itemWebUrl
        ? `[${(s.title || "").slice(0, 60)}](${s.itemWebUrl})`
        : s.title || "—";
      lines.push(
        `${i + 1}. ${money(s.price, s.currency)} — ${date} — ${link}`,
      );
    });
    lines.push("");
    lines.push(
      "**Grade:** Seller column shows Condition or title when parsed (e.g. `PSA 10`, `BGS 10`). With `--grade`, `Pre-Graded:` is the numeric AI estimate from the listing photo—not official slab.",
    );
    lines.push(
      "**AI conf:** Model-reported confidence (0–1) for `Pre-Graded:` when `--grade` is on; otherwise `—`. Not the same as a slab grade.",
    );
    lines.push("");
    lines.push("---");
    lines.push("");
  }
  if (meta?.footer) {
    lines.push(meta.footer);
  }
  await fs.writeFile(path.join(__dirname, `${meta?.outputPrefix || "results"}.md`), lines.join("\n"), "utf8");
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
    const { query, lang, activeByCountry, sold, counts, error, ebaySearchQuery, listingFormat } = block;
    lines.push(`## ${query}`);
    if (error) { lines.push(`**Error:** ${error}`); lines.push(""); lines.push("---"); lines.push(""); continue; }

    const type = listingFormat || "raw";
    lines.push(`Search: \`${ebaySearchQuery}\`  |  Type: ${type}  |  Lang: ${lang}  |  Active: ${counts?.activeTotal ?? "?"}  |  Sold: ${counts?.sold ?? "?"}`);
    lines.push("");

    const firstCountry = config.deliveryCountries?.[0] || "US";
    const items = (activeByCountry?.[firstCountry] || []).slice(0, config.resultsPerCard || 5);
    const hasGrade = type === "slab" || items.some(r => r.grade && !r.grade.error);
    const hasAI = type !== "slab" && items.some(r => r.grade && !r.grade.error);

    lines.push("### Active listings");
    if (hasAI) {
      lines.push("| # | Total | Ship | To | Pre-Grade | Title |");
      lines.push("|---|-------|------|----|-----------|-------|");
    } else if (hasGrade) {
      lines.push("| # | Total | Ship | To | Grade | Title |");
      lines.push("|---|-------|------|----|-------|-------|");
    } else {
      lines.push("| # | Total | Ship | To | Title |");
      lines.push("|---|-------|------|----|----|");
    }
    for (let i = 0; i < items.length; i++) {
      const row = items[i];
      const title = (row.title || "").replace(/\|/g, "\\|");
      const trunc = title.length > 40 ? title.slice(0, 40) + "…" : title;
      const url = (row.itemWebUrl || "").split("?")[0];
      const link = `[${trunc}](${url})`;
      const to = shipToCell(row, config.deliveryCountries || [], config.deliveryPincodes || {});
      if (hasAI) {
        const g = row.grade;
        const pre = g && !g.error && g.overall != null ? g.overall : "—";
        lines.push(`| ${i + 1} | ${money(row.totalCost, row.priceCurrency)} | ${row.shippingLabel} | ${to} | ${pre} | ${link} |`);
      } else if (hasGrade) {
        lines.push(`| ${i + 1} | ${money(row.totalCost, row.priceCurrency)} | ${row.shippingLabel} | ${to} | ${activeGradeDisplay(row)} | ${link} |`);
      } else {
        lines.push(`| ${i + 1} | ${money(row.totalCost, row.priceCurrency)} | ${row.shippingLabel} | ${to} | ${link} |`);
      }
    }
    lines.push("");

    const soldRows = (sold || []).slice(0, config.soldListingsLimit || 5);
    lines.push("### Recent sold");
    lines.push("| # | Price | Date | Title |");
    lines.push("|---|-------|------|-------|");
    for (let i = 0; i < soldRows.length; i++) {
      const s = soldRows[i];
      const title = (s.title || "").replace(/\|/g, "\\|");
      const trunc = title.length > 40 ? title.slice(0, 40) + "…" : title;
      const url = (s.itemWebUrl || "").split("?")[0];
      const link = url ? `[${trunc}](${url})` : trunc;
      lines.push(`| ${i + 1} | ${money(s.price, s.currency)} | ${s.endedDate || "—"} | ${link} |`);
    }
    lines.push("");
    lines.push(`**Price trend (sold):** ${priceTrend(soldRows, today)}`);
    lines.push("");
    lines.push("---");
    lines.push("");
  }
  process.stdout.write(lines.join("\n") + "\n");
}

const JSON_STRIP_KEYS = new Set(["raw", "additionalImages"]);

function strippedJson(obj) {
  return JSON.stringify(
    obj,
    (key, val) => (JSON_STRIP_KEYS.has(key) ? undefined : val),
    2,
  );
}

export async function writeJson(payload, outputPrefix = "results") {
  await fs.writeFile(
    path.join(__dirname, `${outputPrefix}.json`),
    strippedJson(payload),
    "utf8",
  );
}

const COMBINED_JSON = path.join(__dirname, "resultsCombined.json");
const COMBINED_MD = path.join(__dirname, "resultsCombined.md");

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
      gradingLabel,
      counts,
      ebaySearchQuery,
      listingDescription,
      lastUpdated,
    } = block;
    lines.push(`## ${query}`);
    if (ebaySearchQuery) lines.push(`**eBay search:** \`${ebaySearchQuery}\``);
    if (listingDescription) lines.push(`**Listing type:** ${listingDescription}`);
    if (lastUpdated) lines.push(`**Last updated:** ${lastUpdated}`);
    lines.push("");
    lines.push(
      `**Language:** ${lang} | **Found:** ${counts?.activeTotal ?? "?"} active, ${counts?.sold ?? "?"} sold | **Grading:** ${gradingLabel ?? "—"}`,
    );
    lines.push("");
    for (const country of (config.deliveryCountries || [])) {
      const items = activeByCountry?.[country] || [];
      lines.push(`### Active — ships to **${country}**`);
      lines.push("| # | Price | Ship | Total | To | Grade | AI conf | Title |");
      lines.push("|---|------:|-----:|------:|:---|------:|--------:|-------|");
      items.forEach((row, i) => {
        const g = row.grade;
        const title = (row.title || "").replace(/\|/g, "\\|");
        const link = `[${title.slice(0, 80)}${title.length > 80 ? "…" : ""}](${row.itemWebUrl || "#"})`;
        const toCell = shipToCell(row, config.deliveryCountries, config.deliveryPincodes);
        lines.push(
          `| ${i + 1} | ${money(row.price, row.priceCurrency)} | ${row.shippingLabel} | ${money(row.totalCost, row.priceCurrency)} | ${toCell} | ${activeGradeDisplay(row)} | ${confCell(g)} | ${link} |`,
        );
      });
      lines.push("");
    }
    lines.push(`### ${(sold || []).length} sold (combined)`);
    (sold || []).forEach((s, i) => {
      const date = s.endedDate || "—";
      const link = s.itemWebUrl
        ? `[${(s.title || "").slice(0, 60)}](${s.itemWebUrl})`
        : s.title || "—";
      lines.push(`${i + 1}. ${money(s.price, s.currency)} — ${date} — ${link}`);
    });
    lines.push("");
    lines.push("---");
    lines.push("");
  }
  await fs.writeFile(COMBINED_MD, lines.join("\n"), "utf8");
}

export async function writePerCardJson(results, config, outputPrefix = "results") {
  await Promise.all(
    results.map((result, i) =>
      fs.writeFile(
        path.join(__dirname, `${outputPrefix}-${i}.json`),
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
