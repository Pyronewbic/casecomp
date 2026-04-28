import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function money(n, cur = "USD") {
  if (n == null || Number.isNaN(n)) return "—";
  if (cur === "USD") return `$${Number(n).toFixed(2)}`;
  return `${Number(n).toFixed(2)} ${cur}`;
}

function gradeCell(g) {
  if (!g || g.error) return "—";
  return String(g.overall);
}

function confCell(g) {
  if (!g || g.error) return "—";
  return g.confidence.toFixed(1);
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
      lines.push(`### Active — ${country} delivery (top ${config.resultsPerCard})`);
      lines.push(
        "| # | Price | Ship | Total | Grade | Conf | Title |",
      );
      lines.push("|---|------:|-----:|------:|------:|-----:|-------|");
      items.forEach((row, i) => {
        const g = row.grade;
        const title = (row.title || "").replace(/\|/g, "\\|");
        const link = `[${title.slice(0, 80)}${title.length > 80 ? "…" : ""}](${row.itemWebUrl || "#"})`;
        lines.push(
          `| ${i + 1} | ${money(row.price, row.priceCurrency)} | ${row.shippingLabel} | ${money(row.totalCost, row.priceCurrency)} | ${gradeCell(g)} | ${confCell(g)} | ${link} |`,
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
      "*AI pre-grade is a rough estimate from a listing photo, not an official PSA grade. Use as a filtering hint only.*",
    );
    lines.push("");
    lines.push("---");
    lines.push("");
  }
  if (meta?.footer) {
    lines.push(meta.footer);
  }
  await fs.writeFile(path.join(__dirname, "results.md"), lines.join("\n"), "utf8");
}

export async function writeJson(payload) {
  await fs.writeFile(
    path.join(__dirname, "results.json"),
    JSON.stringify(payload, null, 2),
    "utf8",
  );
}
