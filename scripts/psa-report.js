#!/usr/bin/env node
import "dotenv/config";
import minimist from "minimist";
import { getPsaGradingSignal } from "./lib/psa.js";
import { PSA_TIERS } from "./lib/psaTiers.js";

const argv = minimist(process.argv.slice(2), {
  alias: { r: "raw-price", 9: "psa9-price", 1: "psa10-price" },
});
const cards = argv._;
if (cards.length === 0) {
  console.error("Usage: node psa-report.js [--raw-price N] [--psa9-price N] [--psa10-price N] <card> [card ...]");
  process.exit(1);
}

const rawPrice  = argv["raw-price"]  != null ? Number(argv["raw-price"])  : null;
const psa9Price = argv["psa9-price"] != null ? Number(argv["psa9-price"]) : null;
const psa10Price = argv["psa10-price"] != null ? Number(argv["psa10-price"]) : null;

const R = "\x1b[0m", B = "\x1b[1m", DIM = "\x1b[2m";
const CYAN = "\x1b[36m", GREEN = "\x1b[32m", YELLOW = "\x1b[33m";
const RED = "\x1b[31m", MAG = "\x1b[35m", WHITE = "\x1b[97m";
const DIFF_COLOR = { Easy: GREEN, Moderate: YELLOW, Hard: RED, Brutal: RED };

function row(label, value, color = WHITE) {
  return `  ${DIM}${label.padEnd(17)}${R}${B}${color}${String(value).padStart(8)}${R}`;
}

function money(n) { return "$" + n.toFixed(2); }

function pct(n) {
  const s = (n >= 0 ? "+" : "") + Math.round(n) + "%";
  const color = n >= 0 ? GREEN : RED;
  return `${color}${s.padStart(6)}${R}`;
}

function tierTable(raw, p9, p10) {
  const hdr = `  ${B}${WHITE}${"Tier".padEnd(15)} ${"Fee".padStart(6)}`;
  const parts = [hdr];
  if (p9 != null)  parts.push(`${"Net PSA 9".padStart(11)}  ${"Upside".padStart(6)}`);
  if (p10 != null) parts.push(`${"Net PSA 10".padStart(11)}  ${"Upside".padStart(6)}`);
  console.log(parts.join("  ") + R);

  const sep = `  ${DIM}${"─".repeat(15)} ${"─".repeat(6)}`;
  const sepParts = [sep];
  if (p9 != null)  sepParts.push(`${"─".repeat(11)}  ${"─".repeat(6)}`);
  if (p10 != null) sepParts.push(`${"─".repeat(11)}  ${"─".repeat(6)}`);
  console.log(sepParts.join("  ") + R);

  for (const { name, fee } of PSA_TIERS) {
    let line = `  ${WHITE}${name.padEnd(15)}${R} ${DIM}${("$" + fee).padStart(6)}${R}`;
    if (p9 != null) {
      const net9 = p9 - fee;
      const up9 = ((net9 - raw) / raw) * 100;
      line += `  ${B}${YELLOW}${money(net9).padStart(11)}${R}  ${pct(up9)}`;
    }
    if (p10 != null) {
      const net10 = p10 - fee;
      const up10 = ((net10 - raw) / raw) * 100;
      line += `  ${B}${GREEN}${money(net10).padStart(11)}${R}  ${pct(up10)}`;
    }
    console.log(line);
  }
}

console.log();
console.log(`${DIM}  ┌─────────────────────────────────────────────────┐${R}`);
console.log(`${DIM}  │${R}${B}${CYAN}  ⚡ PSA Population Report                        ${R}${DIM}│${R}`);
console.log(`${DIM}  └─────────────────────────────────────────────────┘${R}`);

for (const card of cards) {
  console.log();
  console.log(`  ${B}${WHITE}🃏 ${card}${R}`);
  console.log(`${DIM}  ${"─".repeat(49)}${R}`);

  const r = await getPsaGradingSignal(card, { log: (msg) => console.log(`${DIM}${msg}${R}`) });

  if (!r) {
    console.log(`  ${RED}No PSA data found${R}`);
  } else {
    console.log();
    console.log(row("Total Graded", r.psaPopulation?.toLocaleString() ?? "—"));
    console.log(row("PSA 10 Count", r.psa10Count ?? "—", GREEN));
    console.log(row("PSA 9 Count", r.psa9Count ?? "—", YELLOW));
    console.log();
    console.log(row("PSA 10 Rate", r.psa10Chance != null ? r.psa10Chance.toFixed(1) + "%" : "—", GREEN));
    console.log(row("9-to-10 Ratio", r.psa9to10Ratio != null ? r.psa9to10Ratio.toFixed(1) + ":1" : "—", MAG));
    console.log();
    console.log(row("Difficulty", r.difficulty, DIFF_COLOR[r.difficulty] || WHITE));
  }

  if (rawPrice != null && (psa9Price != null || psa10Price != null)) {
    console.log();
    const priceParts = [`${DIM}  Raw avg: ${R}${B}${WHITE}${money(rawPrice)}${R}`];
    if (psa9Price != null) priceParts.push(`${DIM}PSA 9 avg: ${R}${B}${YELLOW}${money(psa9Price)}${R}`);
    if (psa10Price != null) priceParts.push(`${DIM}PSA 10 avg: ${R}${B}${GREEN}${money(psa10Price)}${R}`);
    console.log(priceParts.join(`${DIM}  |  ${R}`));
    console.log();
    tierTable(rawPrice, psa9Price, psa10Price);
  }
}

console.log();
