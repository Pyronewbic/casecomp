#!/usr/bin/env node
import "dotenv/config";
import minimist from "minimist";
import { scanAll, formatScanResults } from "./lib/scan.js";

const argv = minimist(process.argv.slice(2), {
  string: ["source"],
  default: { limit: 10 },
});

function log(msg) {
  const t = new Date().toTimeString().slice(0, 8);
  console.log(`[${t}] ${msg}`);
}

const queries = (argv._ ?? []).map(s => String(s).trim()).filter(Boolean);

if (!queries.length) {
  console.log(`
Usage: node scan.js [options] "Set or card name"

Options:
  --source <api|pokebeach|pokemon>   Limit to one source (default: all)
  --limit <n>                        Max results per source (default: 10)

Examples:
  node scan.js "Terastal Festival"
  node scan.js --source pokebeach "Ninja Spinner"
  node scan.js "Prismatic Evolutions" "Surging Sparks"
`);
  process.exit(0);
}

const source = argv.source || null;
const limit = Number(argv.limit) || 10;

for (const query of queries) {
  log(`Scanning for "${query}"...`);
  const results = await scanAll(query, { log, limit, source });
  console.log("");
  console.log(formatScanResults(query, results));
  console.log("");
}
