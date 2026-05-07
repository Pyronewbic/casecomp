#!/usr/bin/env node
import { readFileSync, writeFileSync, copyFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const manifestPath = join(__dirname, "..", "manifest.json");
const backupPath = join(__dirname, "..", "..", "manifest.backup.json");

const LOCALHOST = "http://localhost:3099/*";

const manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));

if (process.argv[2] === "--revert") {
  if (existsSync(backupPath)) {
    copyFileSync(backupPath, manifestPath);
    console.log("Reverted manifest.json from backup.");
  } else {
    console.log("No backup found.");
  }
  process.exit(0);
}

if (!existsSync(backupPath)) {
  copyFileSync(manifestPath, backupPath);
  console.log("Backed up manifest.json → test/manifest.backup.json");
}

if (!manifest.host_permissions.includes(LOCALHOST)) {
  manifest.host_permissions.push(LOCALHOST);
}

const localEntry = manifest.content_scripts.find((cs) =>
  cs.matches.some((m) => m.includes("localhost")),
);
if (!localEntry) {
  manifest.content_scripts.push({
    matches: [LOCALHOST],
    js: ["content/sites/pokemon-center.js", "content/sites/walmart.js", "content/sites/costco.js", "content/queue-monitor.js"],
    run_at: "document_idle",
  });
}

writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
console.log("Patched manifest.json for localhost testing.");
console.log("Reload the extension in chrome://extensions, then visit http://localhost:3099");
console.log("Run with --revert to undo.");
