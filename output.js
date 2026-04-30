import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function money(n, cur = "USD") {
  if (n == null || Number.isNaN(n)) return "—";
  if (cur === "USD") return `$${Number(n).toFixed(2)}`;
  return `${Number(n).toFixed(2)} ${cur}`;
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
        "| # | Price | Ship | Total | To? | Grade | AI conf | Title |",
      );
        lines.push("|---|------:|-----:|------:|:---:|------:|--------:|-------|");
      items.forEach((row, i) => {
        const g = row.grade;
        const title = (row.title || "").replace(/\|/g, "\\|");
        const link = `[${title.slice(0, 80)}${title.length > 80 ? "…" : ""}](${row.itemWebUrl || "#"})`;
        const st = row.shippingToBuyer?.[country];
        const toCell =
          st?.eligible === true
            ? "yes"
            : st?.eligible === false
              ? "no"
              : "?";
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

export async function writePerCardJson(results, config, outputPrefix = "results") {
  await Promise.all(
    results.map((result, i) =>
      fs.writeFile(
        path.join(__dirname, `${outputPrefix}-${i}.json`),
        strippedJson({
          deliveryCountries: config.deliveryCountries,
          ...result,
        }),
        "utf8",
      ),
    ),
  );
}
